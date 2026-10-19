import * as Phaser from 'phaser';
import type { BotState, NetMsg, NpcShot, NpcState, PlayerMeta, Shot, Transport } from '@/lib/arena/net';
import { ARENA_WORLD, MAX_BOTS, arenaTuning, type ArenaMap, type EnemyKind, type PickupKind } from '@/lib/arena/schema';
import { BUFFS, BUFF_IDS, CHAINSAW_SECONDS, MAX_GRENADES, SHIELD_HP, START_GRENADES, WEAPONS, WEAPON_IDS, type BuffId, type WeaponId } from '@/lib/arena/weapons';
import { sampleSrc } from '@/lib/samples';
import { ARENA_COLORS, PALETTE, drawArena, drawCrumble, drawEnemy, drawPickup, drawPlayer, hex } from './art';
import type { ArenaBus } from './arena-events';
import { play } from './sfx';

/**
 * Mini Militia-style arena. Netcode (simple client-authoritative, see docs/DECISIONS.md):
 * - every client simulates its own player and broadcasts state at 10 Hz;
 *   remote players are drawn ~120 ms in the past, interpolated between snapshots
 * - shots ride along in the state message; every client simulates every
 *   projectile (bullets, flames, saw teeth, rockets, grenades) the same way
 * - the player who gets hit decides it (victim-authoritative) and broadcasts
 *   `die` with the killer, so nobody has to trust anyone else's hit claims
 * - hostile enemies are simulated by the room host (earliest joiner) and
 *   broadcast like players; the host also decides hits on them
 */

export type ArenaSceneConfig = {
  map: ArenaMap;
  me: PlayerMeta;
  net: Transport;
  bus: ArenaBus;
  handFont: string;
  autofire: boolean;
  /** The map's round + author: state from players on another map is ignored. */
  round: number;
  mapFrom: string;
};

const W = ARENA_WORLD.width;
const H = ARENA_WORLD.height;
export const ARENA_VIEW = { width: 1280, height: 720 } as const;

const BASE = {
  gravity: 1400,
  run: 330,
  jump: 560,
  jetThrust: 3200,
  maxRise: 470,
  fuelDrain: 0.45,
  fuelRegenAir: 0.1,
  fuelRegenGround: 0.75,
  reloadMs: 1400,
  hp: 100,
  respawnMs: 3000,
  protectMs: 1500,
  sendMs: 100,
  /** Remote players are drawn this far in the past (two send intervals + jitter). */
  interpMs: 150,
  /** A remote with no message for this long has left. Hidden tabs keep sending ~1/s. */
  staleMs: 5000,
  pickupRespawnMs: 15000,
  /** Auto-aim locks onto targets this close (the trigger also needs the weapon's reach). */
  lockRange: 900,
  lavaDps: 45,
  spikeHit: 30,
  crumbleMs: 650,
  regrowMs: 5000,
  /** Monsters come back this long after dying, at a random spot away from players. */
  npcRespawnMs: 20000,
  /** Grace period after a map starts before the first monsters appear (staggered). */
  npcGraceMs: 4000,
  npcSafeDist: 420,
} as const;

const SCALE = 0.7; // drawPlayer canvas is 56x64
const BODY = { w: 30, h: 42 };
const ENEMY = {
  walker: { hp: 60, speed: 75, fireMs: 950, range: 620, size: [40, 44] },
  flyer: { hp: 40, speed: 120, fireMs: 1200, range: 560, size: [40, 34] },
  turret: { hp: 90, speed: 0, fireMs: 650, range: 700, size: [40, 44] },
} as const satisfies Record<EnemyKind, unknown>;

type Snap = { t: number; x: number; y: number; aim: number };
type Target = { x: number; y: number; alive: boolean };

type Remote = Target & {
  id: string;
  sprite: Phaser.GameObjects.Image;
  gfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  buf: (Snap & { hp: number; alive: boolean; jet: boolean; w: number; sh: boolean })[];
  last: number;
  color: string;
  name: string;
  /** Smallest (receive time - sender clock) seen: maps sender timestamps onto our clock without jitter. */
  offset: number;
  away: boolean;
  /** Join time, for electing the room host. */
  j: number;
};

type Npc = Target & {
  id: number;
  kind: EnemyKind;
  home: { x: number; y: number };
  patrol: [number, number] | null;
  dir: number;
  hp: number;
  aim: number;
  nextShot: number;
  respawnAt: number;
  sprite: Phaser.GameObjects.Image;
  gfx: Phaser.GameObjects.Graphics;
  buf: Snap[];
};

/** An AI player (host-simulated with a real physics body; others interpolate it). */
type Bot = Target & {
  idx: number;
  id: string;
  name: string;
  color: string;
  img: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  gfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hp: number;
  aim: number;
  jet: boolean;
  fuel: number;
  ammo: number;
  reloadUntil: number;
  nextShot: number;
  respawnAt: number;
  protectedUntil: number;
  spikeCd: number;
  kills: number;
  deaths: number;
  wanderX: number;
  wanderUntil: number;
  lastHitBy: string | null;
  buf: (Snap & { jet: boolean })[];
};

const BOT_NAMES = ['Chotu', 'Pappu', 'Golu', 'Bunty', 'Tinku', 'Monu', 'Sonu', 'Babloo'];

type Proj = { x: number; y: number; vx: number; vy: number; age: number; owner: string; w: WeaponId; mul: number; color: number };

type Pickup = { x: number; y: number; kind: PickupKind; img: Phaser.GameObjects.Image; readyAt: number };

type Crumble = { rect: Phaser.Geom.Rectangle; zone: Phaser.GameObjects.Zone; img: Phaser.GameObjects.Image; touchedAt: number; brokenUntil: number };

type Zone = { rect: Phaser.Geom.Rectangle; kind: 'lava' | 'water' | 'spikes'; flow: number };

/** Interpolate a snapshot buffer at `at` (falls back to the newest snapshot). */
function sample<T extends Snap>(buf: T[], at: number): { x: number; y: number; s: T } {
  let s = buf[buf.length - 1];
  for (let i = buf.length - 1; i > 0; i--) {
    if (buf[i - 1].t <= at) {
      const a = buf[i - 1];
      const b = buf[i];
      const k = Phaser.Math.Clamp((at - a.t) / Math.max(1, b.t - a.t), 0, 1);
      s = k < 0.5 ? a : b;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s };
    }
  }
  return { x: s.x, y: s.y, s };
}

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaSceneConfig;
  private t = arenaTuning([]);
  private solid: Phaser.Geom.Rectangle[] = [];
  private crumbles: Crumble[] = [];
  private zones: Zone[] = [];
  private player!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private myGfx!: Phaser.GameObjects.Graphics;
  private myLabel!: Phaser.GameObjects.Text;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private hazGfx!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Graphics;
  private night: Phaser.GameObjects.RenderTexture | null = null;
  private nightBrush: Phaser.GameObjects.Image | null = null;
  private keys!: Record<'left' | 'right' | 'jet' | 'reload' | 'grenade', Phaser.Input.Keyboard.Key[]>;
  private touch = { left: false, right: false, jet: false, grenade: false };
  private usingMouse = false;
  private remotes = new Map<string, Remote>();
  private metas = new Map<string, PlayerMeta>();
  private npcs: Npc[] = [];
  private bots: Bot[] = [];
  private botTarget = 0;
  private pendingBotShots: NpcShot[] = [];
  private nextBoard = 0;
  private solidGroup!: Phaser.Physics.Arcade.StaticGroup;
  private crumbleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private projs: Proj[] = [];
  private pickups: Pickup[] = [];
  private pendingShots: Shot[] = [];
  private pendingNpcShots: NpcShot[] = [];
  /** This client simulates the monsters (elected each frame: earliest joiner still playing). */
  private host = false;
  private lastSentAt = 0;
  private minimap!: Phaser.GameObjects.Graphics;
  // ---- me
  private hp: number = BASE.hp;
  private shieldHp = 0;
  private fuel = 1;
  private weapon: WeaponId = 'smg';
  private ammo: number = WEAPONS.smg.ammo;
  private sawUntil = 0;
  private grenades: number = START_GRENADES;
  private buffs: Partial<Record<BuffId, number>> = {};
  private reloadUntil = 0;
  private nextShot = 0;
  private nextNade = 0;
  private nadePrev = false;
  private jetPrev = false;
  private airJumps = 0;
  private spikeCd = 0;
  private alive = true;
  private respawnAt = 0;
  private protectedUntil = 0;
  private aim = 0;
  private jetting = false;
  private lastHitBy: string | null = null;
  private lastHitAt = 0;
  private lastHurtSfx = 0;
  private lockTarget: Target | null = null;
  private nextSend = 0;
  private nextHud = 0;
  private autofire = true;
  private unsub: (() => void)[] = [];

  constructor() {
    super('arena');
  }

  init(cfg: ArenaSceneConfig) {
    this.cfg = cfg;
    this.t = arenaTuning(cfg.map.rules);
    this.autofire = cfg.autofire;
    this.remotes = new Map();
    this.npcs = [];
    this.bots = [];
    this.botTarget = cfg.map.bots ?? 0;
    this.pendingBotShots = [];
    this.projs = [];
    this.pickups = [];
    this.crumbles = [];
    this.pendingShots = [];
    this.pendingNpcShots = [];
    this.lockTarget = null;
    this.unsub = [];
  }

  private backdropKey(): string | null {
    const { backdrop, sampleId, seed } = this.cfg.map;
    return backdrop ? `backdrop-${seed}-${backdrop.length}` : sampleId ? `sample-${sampleId}` : null;
  }

  preload() {
    const key = this.backdropKey();
    if (!key || this.textures.exists(key)) return;
    this.load.image(key, this.cfg.map.backdrop ?? sampleSrc(this.cfg.map.sampleId!));
  }

  create() {
    const { map, me, net, bus } = this.cfg;
    const bk = this.backdropKey();
    const under = bk && this.textures.exists(bk) ? (this.textures.get(bk).getSourceImage() as HTMLImageElement) : undefined;
    const px = (r: { x: number; y: number; w: number; h: number }) => new Phaser.Geom.Rectangle(r.x * W, r.y * H, r.w * W, r.h * H);

    // ---------- world
    this.physics.world.setBounds(0, 0, W, H);
    this.physics.world.gravity.y = BASE.gravity * this.t.gravity;
    const solidPlatforms = map.platforms.filter((p) => !p.crumble);
    const spikes = map.hazards.filter((h) => h.kind === 'spikes');
    const bgKey = `arena-bg-${map.seed}-${map.platforms.length}-${map.hazards.length}`;
    if (!this.textures.exists(bgKey)) this.textures.addCanvas(bgKey, drawArena(ARENA_WORLD, solidPlatforms, under, spikes));
    this.add.image(0, 0, bgKey).setOrigin(0).setDepth(0);
    this.zones = map.hazards.map((h) => ({ rect: px(h), kind: h.kind, flow: h.flow ?? 0 }));
    this.hazGfx = this.add.graphics().setDepth(4);

    const solids = this.physics.add.staticGroup();
    this.solidGroup = solids;
    this.solid = solidPlatforms.map(px);
    for (const r of this.solid) solids.add(this.add.zone(r.centerX, r.centerY, r.width, r.height));
    const crumbleGroup = this.physics.add.staticGroup();
    this.crumbleGroup = crumbleGroup;
    this.crumbles = map.platforms
      .filter((p) => p.crumble)
      .map((p, i) => {
        const rect = px(p);
        const key = `crumble-${Math.round(rect.width)}-${Math.round(rect.height)}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, drawCrumble(rect.width, rect.height));
        const zone = this.add.zone(rect.centerX, rect.centerY, rect.width, rect.height);
        crumbleGroup.add(zone);
        const img = this.add.image(rect.x - 4, rect.y - 4, key).setOrigin(0).setDepth(3);
        return { rect, zone, img, touchedAt: 0, brokenUntil: 0, i };
      });

    // ---------- pickups
    this.pickups = map.pickups.map((p) => {
      const key = `pickup-${p.kind}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, drawPickup(p.kind));
      const y = p.y * H - 20;
      const img = this.add.image(p.x * W, y, key).setDepth(5);
      this.tweens.add({ targets: img, y: y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      return { x: p.x * W, y, kind: p.kind, readyAt: 0, img };
    });

    // ---------- hostile enemies
    this.npcs = map.enemies.map((e, i) => {
      const key = `enemy-${e.kind}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, drawEnemy(e.kind));
      const hx = e.x * W;
      const hy = e.kind === 'flyer' ? e.y * H : e.y * H - 22;
      const under = e.kind === 'walker' ? solidPlatforms.find((p) => e.x >= p.x && e.x <= p.x + p.w && Math.abs(p.y - e.y) < 0.012) : undefined;
      return {
        id: i,
        kind: e.kind,
        home: { x: hx, y: hy },
        patrol: under ? ([under.x * W + 20, (under.x + under.w) * W - 20] as [number, number]) : null,
        dir: i % 2 ? 1 : -1,
        x: hx,
        y: hy,
        hp: ENEMY[e.kind].hp,
        alive: false,
        aim: 0,
        nextShot: 0,
        respawnAt: performance.now() + BASE.npcGraceMs + i * 1500,
        sprite: this.add.image(hx, hy, key).setScale(0.75).setDepth(17).setVisible(false),
        gfx: this.add.graphics().setDepth(18),
        buf: [],
      };
    });

    // ---------- me
    this.player = this.physics.add.image(0, 0, this.heroTexture(me.color)).setScale(SCALE).setDepth(20);
    this.player.body.setSize(BODY.w / SCALE, BODY.h / SCALE).setOffset((56 - BODY.w / SCALE) / 2, 64 - BODY.h / SCALE);
    this.player.setCollideWorldBounds(true);
    this.player.body.setMaxVelocity(900, 1100);
    this.physics.add.collider(this.player, solids);
    this.physics.add.collider(this.player, crumbleGroup);
    this.myGfx = this.add.graphics().setDepth(21);
    this.myLabel = this.nameTag(me.name).setDepth(22);
    this.fxGfx = this.add.graphics().setDepth(30);
    this.crosshair = this.add.graphics().setDepth(60);
    this.spawn();

    // ---------- camera
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.startFollow(this.player, true, 0.14, 0.14);

    if (this.t.night) {
      this.night = this.add.renderTexture(0, 0, ARENA_VIEW.width, ARENA_VIEW.height).setOrigin(0).setScrollFactor(0).setDepth(50);
      const brush = document.createElement('canvas');
      brush.width = brush.height = 520;
      const g = brush.getContext('2d')!;
      const grad = g.createRadialGradient(260, 260, 40, 260, 260, 260);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 520, 520);
      if (!this.textures.exists('night-brush')) this.textures.addCanvas('night-brush', brush);
      this.nightBrush = this.make.image({ key: 'night-brush', add: false });
    }

    // ---------- input
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
      right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
      jet: [kb.addKey(K.W), kb.addKey(K.UP), kb.addKey(K.SPACE)],
      reload: [kb.addKey(K.R)],
      grenade: [kb.addKey(K.G), kb.addKey(K.Q)],
    };
    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) this.usingMouse = true;
    });

    // ---------- network + React
    this.unsub.push(
      net.onMessage((m) => this.onNet(m)),
      // Presence only refreshes names/colours. Players are added and removed by
      // their own state messages: presence can briefly drop someone who is
      // still playing, which used to make them vanish for some viewers.
      bus.on('peers', (list) => {
        this.metas = new Map(list.map((p) => [p.id, p]));
        for (const r of this.remotes.values()) this.refreshRemoteLook(r);
      }),
      bus.on('touch', (t) => Object.assign(this.touch, t)),
      bus.on('autofire', (on) => (this.autofire = on)),
      bus.on('bots', (n) => (this.botTarget = Phaser.Math.Clamp(Math.round(n), 0, MAX_BOTS))),
    );
    // Keepalive: a hidden tab stops Phaser's loop; keep telling the room we're here (marked away).
    const keepalive = window.setInterval(() => {
      if (performance.now() - this.lastSentAt > 450) this.sendState(true);
    }, 500);
    this.unsub.push(() => window.clearInterval(keepalive));
    this.buildMinimap();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsub.forEach((u) => u()));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unsub.forEach((u) => u()));
  }

  /* ---------------- helpers ---------------- */

  private heroTexture(color: string): string {
    const key = `hero-${color}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, drawPlayer(color));
    return key;
  }

  private nameTag(name: string) {
    return this.add.text(0, 0, name, { fontFamily: this.cfg.handFont, fontSize: '20px', color: PALETTE.ink }).setOrigin(0.5, 1);
  }

  /** Solid rects right now (crumbled ledges don't count). */
  private walls(): Phaser.Geom.Rectangle[] {
    const now = performance.now();
    return [...this.solid, ...this.crumbles.filter((c) => now >= c.brokenUntil).map((c) => c.rect)];
  }

  private blocked(x0: number, y0: number, x1: number, y1: number, walls = this.walls()): boolean {
    const line = new Phaser.Geom.Line(x0, y0, x1, y1);
    return walls.some((r) => Phaser.Geom.Intersects.LineToRectangle(line, r));
  }

  private npcRect(n: Npc) {
    const [w, h] = ENEMY[n.kind].size;
    return new Phaser.Geom.Rectangle(n.x - w / 2, n.y - h / 2, w, h);
  }

  /** Farthest spawn point from everyone alive. */
  private spawn() {
    const others: Target[] = [...this.remotes.values(), ...this.npcs].filter((r) => r.alive);
    const pts = this.cfg.map.spawns.map((s) => ({ x: s.x * W, y: s.y * H }));
    const best = pts
      .map((p) => ({ p, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y))) : Math.random() }))
      .sort((a, b) => b.d - a.d)[0].p;
    this.player.body.reset(best.x, best.y - (64 * SCALE) / 2 - 2);
    this.player.setVisible(true);
    this.player.body.enable = true;
    this.hp = BASE.hp;
    this.shieldHp = 0;
    this.fuel = 1;
    this.weapon = 'smg';
    this.ammo = WEAPONS.smg.ammo;
    this.grenades = START_GRENADES;
    this.buffs = {};
    this.reloadUntil = 0;
    this.alive = true;
    this.lastHitBy = null;
    this.protectedUntil = performance.now() + BASE.protectMs;
  }

  private has(b: BuffId, now = performance.now()) {
    return (this.buffs[b] ?? 0) > now;
  }

  private splat(x: number, y: number, color: number) {
    for (let i = 0; i < 9; i++) {
      const dot = this.add.circle(x, y, 3 + Math.random() * 6, i % 3 === 0 ? color : hex(PALETTE.ink)).setDepth(25);
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 60;
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.4, duration: 600, ease: 'Cubic.out', onComplete: () => dot.destroy() });
    }
  }

  private splatSmall(x: number, y: number) {
    const dot = this.add.circle(x, y, 5, hex(PALETTE.ink)).setDepth(26);
    this.tweens.add({ targets: dot, scale: 0.2, alpha: 0, duration: 220, onComplete: () => dot.destroy() });
  }

  /** All damage to me goes through here (shield first, then hp). */
  private hurt(amount: number, from: string | null) {
    const now = performance.now();
    if (!this.alive || now < this.protectedUntil || amount <= 0) return;
    if (from && from !== this.cfg.me.id) {
      this.lastHitBy = from;
      this.lastHitAt = now;
    }
    if (this.shieldHp > 0 && this.has('shield', now)) {
      const absorbed = Math.min(this.shieldHp, amount);
      this.shieldHp -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    if (now - this.lastHurtSfx > 120) {
      this.lastHurtSfx = now;
      play('hurt');
      this.cameras.main.shake(70, 0.004);
    }
    if (this.hp <= 0) {
      const killer = from && from !== this.cfg.me.id ? from : now - this.lastHitAt < 4000 ? this.lastHitBy : null;
      this.die(killer);
    }
  }

  private die(killer: string | null) {
    if (!this.alive) return;
    this.alive = false;
    this.respawnAt = performance.now() + BASE.respawnMs;
    this.splat(this.player.x, this.player.y, hex(this.cfg.me.color));
    this.player.setVisible(false);
    this.player.body.enable = false;
    this.player.body.setVelocity(0, 0);
    play('death');
    if (this.host) this.creditBot(killer);
    this.cfg.net.send({ t: 'die', victim: this.cfg.me.id, killer });
    this.cfg.bus.emit('died', { killer });
    this.sendState(true);
  }

  private damageMul() {
    return this.has('damage') ? 2 : 1;
  }

  private fire(angle: number) {
    const w = WEAPONS[this.weapon];
    const now = performance.now();
    const mul = this.damageMul();
    for (let i = 0; i < w.pellets; i++) {
      const a = angle + (Math.random() - 0.5) * w.spread;
      const x = this.player.x + Math.cos(a) * 26;
      const y = this.player.y + Math.sin(a) * 26;
      this.addProj(x, y, a, this.weapon, mul, this.cfg.me.id, hex(this.cfg.me.color));
      this.pendingShots.push([Math.round(x), Math.round(y), +a.toFixed(3), WEAPON_IDS.indexOf(this.weapon), mul * 10]);
    }
    this.nextShot = now + w.fireMs / this.t.fireRate;
    if (this.weapon === 'chainsaw') {
      if (now >= this.sawUntil) this.dropToSmg();
    } else {
      this.ammo -= 1;
      if (this.ammo <= 0) {
        if (this.weapon === 'smg') this.reloadUntil = now + BASE.reloadMs;
        else this.dropToSmg();
      }
    }
    if (this.weapon !== 'flamethrower' || Math.random() < 0.25) play('shoot');
  }

  private dropToSmg() {
    this.weapon = 'smg';
    this.ammo = WEAPONS.smg.ammo;
    this.reloadUntil = 0;
  }

  private throwGrenade() {
    const now = performance.now();
    if (this.grenades <= 0 || now < this.nextNade) return;
    this.grenades -= 1;
    this.nextNade = now + WEAPONS.grenade.fireMs;
    const a = this.aim;
    const x = this.player.x + Math.cos(a) * 20;
    const y = this.player.y + Math.sin(a) * 20 - 6;
    const mul = this.damageMul();
    this.addProj(x, y, a, 'grenade', mul, this.cfg.me.id, hex(this.cfg.me.color));
    this.pendingShots.push([Math.round(x), Math.round(y), +a.toFixed(3), WEAPON_IDS.indexOf('grenade'), mul * 10]);
    play('jump');
  }

  private addProj(x: number, y: number, a: number, w: WeaponId, mul: number, owner: string, color: number) {
    const s = WEAPONS[w].speed;
    this.projs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (w === 'grenade' ? 220 : 0), age: 0, owner, w, mul, color });
  }

  private explode(x: number, y: number, p: Proj) {
    const w = WEAPONS[p.w];
    const r = w.radius ?? 120;
    // visuals
    const ring = this.add.circle(x, y, r * 0.3, 0xffcf3f, 0.85).setDepth(27).setStrokeStyle(4, hex(PALETTE.ink));
    this.tweens.add({ targets: ring, scale: 3.3, alpha: 0, duration: 380, ease: 'Cubic.out', onComplete: () => ring.destroy() });
    this.splat(x, y, 0xff4a3d);
    if (Math.hypot(this.player.x - x, this.player.y - y) < 700) this.cameras.main.shake(160, 0.009);
    play('stomp');
    const falloff = (d: number) => w.damage * p.mul * this.t.damage * (1 - 0.6 * (d / r));
    // me (victim-authoritative; your own blasts hurt you half)
    if (this.alive) {
      const d = Math.hypot(this.player.x - x, this.player.y - y);
      if (d < r) this.hurt(falloff(d) * (p.owner === this.cfg.me.id ? 0.5 : 1), p.owner);
    }
    // enemies (the host decides)
    if (this.host && !p.owner.startsWith('npc:')) {
      for (const n of this.npcs) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (n.alive && d < r) this.hurtNpc(n, falloff(d), p.owner);
      }
    }
    if (this.host) {
      for (const b of this.bots) {
        const d = Math.hypot(b.x - x, b.y - y);
        if (b.alive && d < r) this.hurtBot(b, falloff(d) * (p.owner === b.id ? 0.5 : 1), p.owner);
      }
    }
  }

  private hurtNpc(n: Npc, amount: number, by: string) {
    if (!n.alive) return;
    n.hp -= amount;
    if (n.hp > 0) return;
    n.alive = false;
    n.respawnAt = performance.now() + BASE.npcRespawnMs;
    this.splat(n.x, n.y, 0x9b5cff);
    this.cfg.net.send({ t: 'npcdie', id: n.id, killer: by });
    this.cfg.bus.emit('npcdie', { killer: by });
  }

  private sendState(force = false) {
    const now = performance.now();
    if (!force && now < this.nextSend) return;
    this.nextSend = now + BASE.sendMs;
    this.lastSentAt = now;
    const b = this.player.body;
    const { me, round, mapFrom } = this.cfg;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const hostPart = this.host && !hidden
      ? {
          ...(this.npcs.length
            ? {
                n: this.npcs.map((n): NpcState => [n.id, Math.round(n.x), Math.round(n.y), Math.round(n.hp), n.alive ? 1 : 0, +n.aim.toFixed(2)]),
                ns: this.pendingNpcShots,
              }
            : {}),
          bn: this.bots.length,
          b: this.bots.map((b): BotState => [b.idx, Math.round(b.x), Math.round(b.y), Math.round(b.hp), b.alive ? 1 : 0, +b.aim.toFixed(2), b.jet ? 1 : 0, b.kills, b.deaths]),
          bs: this.pendingBotShots,
        }
      : {};
    this.pendingNpcShots = [];
    this.pendingBotShots = [];
    this.cfg.net.send({
      t: 'st',
      id: me.id,
      ts: Math.round(now),
      r: round,
      mf: mapFrom,
      nm: me.name,
      c: me.color,
      j: me.joinedAt,
      away: hidden,
      ...hostPart,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      vx: Math.round(b.velocity.x),
      vy: Math.round(b.velocity.y),
      aim: +this.aim.toFixed(2),
      hp: Math.max(0, Math.round(this.hp)),
      alive: this.alive,
      jet: this.jetting,
      w: WEAPON_IDS.indexOf(this.weapon),
      sh: this.shieldHp > 0 && this.has('shield', now),
      shots: this.pendingShots,
    });
    this.pendingShots = [];
  }

  /** Earliest joiner among the players actually here (and not in a background tab) runs the monsters. */
  private electHost(now: number): boolean {
    const me = this.cfg.me;
    if (typeof document !== 'undefined' && document.hidden) return false;
    let best = { j: me.joinedAt, id: me.id };
    for (const r of this.remotes.values()) {
      if (r.away || now - r.last > 2500) continue;
      if (r.j < best.j || (r.j === best.j && r.id < best.id)) best = { j: r.j, id: r.id };
    }
    return best.id === me.id;
  }

  /* ---------------- network ---------------- */

  private remote(id: string, name: string, color: string): Remote {
    let r = this.remotes.get(id);
    if (r) return r;
    r = {
      id,
      sprite: this.add.image(0, 0, this.heroTexture(color)).setScale(SCALE).setDepth(18),
      gfx: this.add.graphics().setDepth(19),
      label: this.nameTag(name).setDepth(22),
      buf: [],
      last: performance.now(),
      x: -999,
      y: -999,
      alive: true,
      color,
      name,
      offset: Infinity,
      away: false,
      j: Number.MAX_SAFE_INTEGER,
    };
    this.remotes.set(id, r);
    return r;
  }

  private setLook(r: Remote, name: string, color: string) {
    if (color !== r.color && /^#[0-9A-Fa-f]{6}$/.test(color)) {
      r.color = color;
      r.sprite.setTexture(this.heroTexture(color));
    }
    if (name && name !== r.name) {
      r.name = name.slice(0, 16);
      r.label.setText(r.name);
    }
  }

  private refreshRemoteLook(r: Remote) {
    const meta = this.metas.get(r.id);
    if (meta) this.setLook(r, meta.name, meta.color);
  }

  private dropRemote(r: Remote) {
    if (this.lockTarget === r) this.lockTarget = null;
    r.sprite.destroy();
    r.gfx.destroy();
    r.label.destroy();
    this.remotes.delete(r.id);
  }

  private onNet(m: NetMsg) {
    const now = performance.now();
    if (m.t === 'st') {
      if (m.id === this.cfg.me.id) return;
      const { round, mapFrom } = this.cfg;
      if (m.r !== round || m.mf !== mapFrom) {
        // On another map: don't draw them in the wrong place; fetch theirs if it's newer.
        if (m.r > round || (m.r === round && m.mf < mapFrom)) this.cfg.bus.emit('newerMap', undefined);
        const stale = this.remotes.get(m.id);
        if (stale) this.dropRemote(stale);
        return;
      }
      const r = this.remote(m.id, m.nm ?? '...', m.c ?? PALETTE.graphite);
      this.setLook(r, m.nm, m.c);
      r.last = now;
      r.away = !!m.away;
      r.j = m.j ?? r.j;
      // Sender clock -> our clock (removes network jitter from interpolation).
      const ts = typeof m.ts === 'number' ? m.ts : now;
      r.offset = Math.min(r.offset, now - ts);
      const t = ts + r.offset;
      const lastT = r.buf.length ? r.buf[r.buf.length - 1].t : -Infinity;
      if (t > lastT) {
        r.buf.push({ t, x: m.x, y: m.y, aim: m.aim, hp: m.hp, alive: m.alive, jet: m.jet, w: m.w ?? 0, sh: !!m.sh });
        if (r.buf.length > 20) r.buf.splice(0, r.buf.length - 20);
      }
      const color = hex(r.color);
      for (const [x, y, a, wi, m10] of m.shots.slice(0, 24)) {
        const w = WEAPON_IDS[wi] ?? 'smg';
        this.addProj(x, y, a, w, Phaser.Math.Clamp((m10 ?? 10) / 10, 0.5, 2), m.id, color);
      }
      // Monsters from the room host.
      if (m.n && !this.host) {
        for (const [id, x, y, hp, alive, aim] of m.n) {
          const n = this.npcs[id];
          if (!n) continue;
          if (!n.alive && alive) n.buf = []; // respawned elsewhere: jump, don't slide
          n.buf.push({ t, x, y, aim });
          if (n.buf.length > 20) n.buf.splice(0, n.buf.length - 20);
          n.hp = hp;
          if (n.alive && !alive) this.splat(n.x, n.y, 0x9b5cff);
          n.alive = alive === 1;
        }
        for (const [x, y, a, id] of (m.ns ?? []).slice(0, 24)) this.addProj(x, y, a, 'smg', 0.7, `npc:${id}`, 0x9b5cff);
      }
      // AI players from the room host.
      if (typeof m.bn === 'number' && !this.host) {
        this.setBotCount(Phaser.Math.Clamp(m.bn, 0, MAX_BOTS));
        for (const [idx, x, y, hp, alive, aim, jet, kills, deaths] of m.b ?? []) {
          const b = this.bots[idx];
          if (!b) continue;
          if (!b.alive && alive) b.buf = [];
          b.buf.push({ t, x, y, aim, jet: jet === 1 });
          if (b.buf.length > 20) b.buf.splice(0, b.buf.length - 20);
          b.hp = hp;
          if (b.alive && !alive) this.splat(b.x, b.y, hex(b.color));
          b.alive = alive === 1;
          b.kills = kills;
          b.deaths = deaths;
        }
        for (const [x, y, a, idx] of (m.bs ?? []).slice(0, 24)) {
          const b = this.bots[idx];
          if (b) this.addProj(x, y, a, 'smg', 0.8, b.id, hex(b.color));
        }
      }
    } else if (m.t === 'bots') {
      if (m.r === this.cfg.round) this.botTarget = Phaser.Math.Clamp(Math.round(m.n), 0, MAX_BOTS);
    } else if (m.t === 'die') {
      if (this.host) this.creditBot(m.killer);
      const r = this.remotes.get(m.victim);
      if (r && r.alive) {
        r.alive = false;
        this.splat(r.x, r.y, hex(r.color));
      }
    } else if (m.t === 'pick') {
      const p = this.pickups[m.i];
      if (p) p.readyAt = now + BASE.pickupRespawnMs;
    } else if (m.t === 'npcdie') {
      const n = this.npcs[m.id];
      if (n && n.alive) {
        n.alive = false;
        this.splat(n.x, n.y, 0x9b5cff);
      }
    }
  }

  /* ---------------- enemies ---------------- */

  private simulateNpcs(dt: number, now: number, walls: Phaser.Geom.Rectangle[]) {
    const players: Target[] = [
      ...(this.alive ? [{ x: this.player.x, y: this.player.y, alive: true }] : []),
      ...[...this.remotes.values()].filter((r) => r.alive && !r.away),
      ...this.bots.filter((b) => b.alive),
    ];
    for (const n of this.npcs) {
      const spec = ENEMY[n.kind];
      if (!n.alive) {
        if (now >= n.respawnAt) {
          const spot = this.npcSpot(n.kind, players, walls);
          if (!spot) {
            n.respawnAt = now + 1500; // everywhere is too close to someone: try again soon
            continue;
          }
          n.alive = true;
          n.hp = spec.hp;
          n.x = spot.x;
          n.y = spot.y;
          n.patrol = spot.patrol;
          n.nextShot = now + 1200; // a beat before it starts shooting
          this.spawnPuff(n.x, n.y);
        }
        continue;
      }
      const near = players
        .map((p) => ({ p, d: Math.hypot(p.x - n.x, p.y - n.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (n.kind === 'walker' && n.patrol) {
        n.x += n.dir * spec.speed * dt;
        if (n.x < n.patrol[0] || n.x > n.patrol[1]) {
          n.dir = -n.dir;
          n.x = Phaser.Math.Clamp(n.x, n.patrol[0], n.patrol[1]);
        }
      } else if (n.kind === 'flyer') {
        let dx: number;
        let dy: number;
        if (near && near.d < BASE.lockRange) {
          const a = Math.atan2(near.p.y - 60 - n.y, near.p.x - n.x);
          const go = near.d > 220 ? 1 : -0.4;
          dx = Math.cos(a) * spec.speed * go * dt;
          dy = Math.sin(a) * spec.speed * go * dt;
        } else {
          dx = (n.home.x + Math.sin(now / 1300 + n.id) * 120 - n.x) * dt;
          dy = (n.home.y + Math.cos(now / 900 + n.id) * 40 - n.y) * dt;
        }
        this.flyerMove(n, dx, dy, walls, dt);
      }
      if (near && near.d < spec.range && !this.blocked(n.x, n.y, near.p.x, near.p.y, walls)) {
        n.aim = Math.atan2(near.p.y - n.y, near.p.x - n.x);
        if (n.kind === 'walker') n.dir = Math.sign(near.p.x - n.x) || n.dir;
        if (now >= n.nextShot) {
          n.nextShot = now + spec.fireMs * (0.8 + Math.random() * 0.4);
          const a = n.aim + (Math.random() - 0.5) * 0.1;
          const x = n.x + Math.cos(a) * 24;
          const y = n.y + Math.sin(a) * 24;
          this.addProj(x, y, a, 'smg', 0.7, `npc:${n.id}`, 0x9b5cff);
          this.pendingNpcShots.push([Math.round(x), Math.round(y), +a.toFixed(3), n.id]);
        }
      }
    }
  }

  /** Flyers collide with platforms: slide along a wall, climb over it when boxed in, and escape if pushed inside one. */
  private flyerMove(n: Npc, dx: number, dy: number, walls: Phaser.Geom.Rectangle[], dt: number) {
    const R = 22;
    const hits = (x: number, y: number) => walls.some((r) => x > r.x - R && x < r.right + R && y > r.y - R && y < r.bottom + R);
    if (hits(n.x, n.y)) {
      // stuck inside (spawned or shoved): float straight up and out
      n.y -= 160 * dt;
    } else if (!hits(n.x + dx, n.y + dy)) {
      n.x += dx;
      n.y += dy;
    } else if (!hits(n.x + dx, n.y)) {
      n.x += dx;
    } else if (!hits(n.x, n.y + dy)) {
      n.y += dy;
    } else if (!hits(n.x, n.y - 100 * dt)) {
      n.y -= 100 * dt; // boxed in: climb over the obstacle
    }
    n.x = Phaser.Math.Clamp(n.x, 30, W - 30);
    n.y = Phaser.Math.Clamp(n.y, 40, H - 40);
  }

  /** A random place for a monster of this kind, well away from every player. */
  private npcSpot(kind: EnemyKind, players: Target[], walls: Phaser.Geom.Rectangle[]): { x: number; y: number; patrol: [number, number] | null } | null {
    const ledges = this.solid.filter((p) => p.width >= 90);
    for (let i = 0; i < 30; i++) {
      let x: number;
      let y: number;
      let patrol: [number, number] | null = null;
      if (kind === 'flyer' || !ledges.length) {
        x = W * (0.08 + Math.random() * 0.84);
        y = H * (0.12 + Math.random() * 0.5);
      } else {
        const p = ledges[Math.floor(Math.random() * ledges.length)];
        x = p.x + 30 + Math.random() * (p.width - 60);
        y = p.y - 22;
        if (kind === 'walker') patrol = [p.x + 20, p.right - 20];
      }
      // keep clear of walls (a monster body is ~40 px wide)
      const body = kind === 'flyer' ? { top: y - 26, bottom: y + 26, pad: 26 } : { top: y - 24, bottom: y + 18, pad: 20 };
      if (walls.some((r) => x > r.x - body.pad && x < r.right + body.pad && r.y < body.bottom && r.bottom > body.top)) continue;
      if (this.zones.some((z) => z.kind !== 'water' && Phaser.Geom.Rectangle.Contains(z.rect, x, y + 20))) continue;
      if (players.some((pl) => Math.hypot(pl.x - x, pl.y - y) < BASE.npcSafeDist)) continue;
      return { x, y, patrol };
    }
    return null;
  }

  private spawnPuff(x: number, y: number) {
    const ring = this.add.circle(x, y, 10, 0x9b5cff, 0.35).setDepth(16).setStrokeStyle(3, 0x9b5cff);
    this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 500, ease: 'Cubic.out', onComplete: () => ring.destroy() });
  }

  /* ---------------- AI players ---------------- */

  private setBotCount(n: number) {
    while (this.bots.length > n) {
      const b = this.bots.pop()!;
      if (this.lockTarget === b) this.lockTarget = null;
      b.img.destroy();
      b.gfx.destroy();
      b.label.destroy();
    }
    while (this.bots.length < n) {
      const idx = this.bots.length;
      const color = ARENA_COLORS[(idx + 3) % ARENA_COLORS.length];
      const img = this.physics.add.image(-200, -200, this.heroTexture(color)).setScale(SCALE).setDepth(18).setVisible(false);
      img.body.setSize(BODY.w / SCALE, BODY.h / SCALE).setOffset((56 - BODY.w / SCALE) / 2, 64 - BODY.h / SCALE);
      img.setCollideWorldBounds(true);
      img.body.setMaxVelocity(900, 1100);
      img.body.enable = false;
      this.physics.add.collider(img, this.solidGroup);
      this.physics.add.collider(img, this.crumbleGroup);
      const name = `${BOT_NAMES[idx % BOT_NAMES.length]} (bot)`;
      this.bots.push({
        idx,
        id: `bot:${idx}`,
        name,
        color,
        img,
        gfx: this.add.graphics().setDepth(19),
        label: this.nameTag(name).setDepth(22).setVisible(false),
        x: -200,
        y: -200,
        alive: false,
        hp: BASE.hp,
        aim: 0,
        jet: false,
        fuel: 1,
        ammo: WEAPONS.smg.ammo,
        reloadUntil: 0,
        nextShot: 0,
        respawnAt: performance.now() + 1500 + idx * 700,
        protectedUntil: 0,
        spikeCd: 0,
        kills: 0,
        deaths: 0,
        wanderX: W / 2,
        wanderUntil: 0,
        lastHitBy: null,
        buf: [],
      });
    }
  }

  /** Host: a player or bot died to `killer`; if that was a bot, it scores. */
  private creditBot(killer: string | null) {
    if (!killer?.startsWith('bot:')) return;
    const b = this.bots[Number(killer.slice(4))];
    if (b) b.kills += 1;
  }

  private hurtBot(b: Bot, amount: number, by: string | null) {
    const now = performance.now();
    if (!b.alive || now < b.protectedUntil || amount <= 0) return;
    if (by && by !== b.id) b.lastHitBy = by;
    b.hp -= amount;
    if (b.hp > 0) return;
    b.alive = false;
    b.deaths += 1;
    b.respawnAt = now + BASE.respawnMs;
    b.img.body.enable = false;
    this.splat(b.x, b.y, hex(b.color));
    const killer = by && by !== b.id ? by : b.lastHitBy;
    this.creditBot(killer);
    this.cfg.net.send({ t: 'die', victim: b.id, killer });
    this.cfg.bus.emit('botdie', { victim: b.id, killer });
  }

  /** Host: move, fly, aim and shoot like a (slightly worse) player. */
  private simulateBots(dt: number, now: number, walls: Phaser.Geom.Rectangle[]) {
    const humans: (Target & { id: string })[] = [
      ...(this.alive ? [{ id: this.cfg.me.id, x: this.player.x, y: this.player.y, alive: true }] : []),
      ...[...this.remotes.values()].filter((r) => r.alive && !r.away),
    ];
    for (const b of this.bots) {
      const body = b.img.body;
      if (!b.alive) {
        if (now < b.respawnAt) continue;
        const others: Target[] = [...humans, ...this.bots.filter((o) => o.alive)];
        const pts = this.cfg.map.spawns.map((sp) => ({ x: sp.x * W, y: sp.y * H }));
        const best = pts
          .map((p) => ({ p, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y))) : Math.random() }))
          .sort((a, c) => c.d - a.d)[0].p;
        body.enable = true;
        body.reset(best.x, best.y - (64 * SCALE) / 2 - 2);
        b.alive = true;
        b.hp = BASE.hp;
        b.fuel = 1;
        b.ammo = WEAPONS.smg.ammo;
        b.reloadUntil = 0;
        b.lastHitBy = null;
        b.protectedUntil = now + BASE.protectMs;
        b.x = b.img.x;
        b.y = b.img.y;
        continue;
      }
      b.x = b.img.x;
      b.y = b.img.y;
      // pick a target: nearest visible enemy, else the nearest one to chase
      const foes: Target[] = [...humans, ...this.bots.filter((o) => o !== b && o.alive), ...this.npcs.filter((n) => n.alive)];
      const ranked = foes.map((f) => ({ f, d: Math.hypot(f.x - b.x, f.y - b.y) })).sort((a, c) => a.d - c.d);
      const seen = ranked.find((o) => o.d < 1000 && !this.blocked(b.x, b.y, o.f.x, o.f.y, walls));
      const chase = seen ?? ranked.find((o) => o.d < 1500);
      let dir = 0;
      if (chase) {
        const dx = chase.f.x - b.x;
        if (seen && chase.d < 200) dir = -Math.sign(dx);
        else if (!seen || chase.d > 380) dir = Math.sign(dx);
        else dir = Math.sin(now / 650 + b.idx * 2) > 0 ? 1 : -1; // strafe
      } else {
        if (now > b.wanderUntil || Math.abs(b.wanderX - b.x) < 30) {
          b.wanderX = W * (0.05 + Math.random() * 0.9);
          b.wanderUntil = now + 4000;
        }
        dir = Math.sign(b.wanderX - b.x);
      }
      const grounded = body.blocked.down;
      const target = dir * BASE.run * 0.85;
      body.setVelocityX(grounded ? target : Phaser.Math.Linear(body.velocity.x, target, Math.min(1, dt * 8)));
      // fly: to reach a higher target, over walls, and away from lava/spikes ahead
      const ahead = { x: b.x + dir * 50, y: b.y + 50 };
      const danger = this.zones.some((z) => z.kind !== 'water' && Phaser.Geom.Rectangle.Contains(z.rect, ahead.x, ahead.y));
      const blockedSide = (dir > 0 && body.blocked.right) || (dir < 0 && body.blocked.left);
      const want = danger || blockedSide || (!!chase && chase.f.y < b.y - 70) || (!grounded && body.velocity.y > 300 && danger);
      b.jet = want && b.fuel > 0.05;
      if (b.jet) {
        body.setVelocityY(Math.max(-BASE.maxRise * this.t.jetpack, body.velocity.y - BASE.jetThrust * this.t.jetpack * dt));
        b.fuel = Math.max(0, b.fuel - BASE.fuelDrain * dt);
      } else {
        b.fuel = Math.min(1, b.fuel + (grounded ? BASE.fuelRegenGround : BASE.fuelRegenAir) * dt);
      }
      // hazards hurt bots too
      const rect = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
      for (const z of this.zones) {
        if (!Phaser.Geom.Intersects.RectangleToRectangle(z.rect, rect)) continue;
        if (z.kind === 'lava') this.hurtBot(b, BASE.lavaDps * dt, null);
        else if (z.kind === 'spikes' && now >= b.spikeCd) {
          b.spikeCd = now + 500;
          body.setVelocityY(-480);
          this.hurtBot(b, BASE.spikeHit, null);
        } else if (z.kind === 'water') body.setVelocityX(body.velocity.x + z.flow * 190);
      }
      if (!b.alive) continue;
      // aim + shoot (a little wobbly so bots are beatable)
      b.aim = seen ? Math.atan2(seen.f.y - b.y, seen.f.x - b.x) : dir < 0 ? Math.PI : dir > 0 ? 0 : b.aim;
      if (b.reloadUntil && now >= b.reloadUntil) {
        b.reloadUntil = 0;
        b.ammo = WEAPONS.smg.ammo;
      }
      if (seen && seen.d < 720 && !b.reloadUntil && now >= b.nextShot) {
        const a = b.aim + (Math.random() - 0.5) * 0.22;
        const x = b.x + Math.cos(a) * 26;
        const y = b.y + Math.sin(a) * 26;
        this.addProj(x, y, a, 'smg', 0.8, b.id, hex(b.color));
        this.pendingBotShots.push([Math.round(x), Math.round(y), +a.toFixed(3), b.idx]);
        b.nextShot = now + 150 + Math.random() * 110;
        b.ammo -= 1;
        if (b.ammo <= 0) b.reloadUntil = now + 1700;
      }
    }
  }

  /** Every frame, on every client: place + draw the AI players. */
  private renderBots(now: number, renderAt: number) {
    for (const b of this.bots) {
      if (!this.host && b.buf.length) {
        const { x, y, s } = sample(b.buf, renderAt);
        b.x = x;
        b.y = y;
        b.aim = s.aim;
        b.jet = s.jet;
        b.img.setPosition(x, y);
      }
      const prot = this.host && now < b.protectedUntil;
      b.img.setVisible(b.alive).setAlpha(prot ? 0.5 : 1);
      b.label.setPosition(b.x, b.y - 36).setVisible(b.alive);
      b.gfx.clear();
      if (b.alive) this.drawKit(b.gfx, b.x, b.y, b.aim, b.hp, b.jet, hex(b.color), 0, false);
    }
    if (now >= this.nextBoard) {
      this.nextBoard = now + 400;
      this.cfg.bus.emit('botboard', this.bots.map((b) => ({ id: b.id, name: b.name, color: b.color, kills: b.kills, deaths: b.deaths })));
    }
  }

  /* ---------------- minimap ---------------- */

  private static readonly MINI = { x: 12, y: 12, w: 224, h: 126 };

  /** Platforms + hazards drawn once into a small texture; live dots drawn every frame on top. */
  private buildMinimap() {
    const { w, h, x, y } = ArenaScene.MINI;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255,250,240,0.72)';
    g.fillRect(0, 0, w, h);
    const sx = w / W;
    const sy = h / H;
    for (const z of this.zones) {
      g.fillStyle = z.kind === 'water' ? 'rgba(92,200,255,0.55)' : 'rgba(255,74,61,0.85)';
      g.fillRect(z.rect.x * sx, z.rect.y * sy, Math.max(2, z.rect.width * sx), Math.max(2, z.rect.height * sy));
    }
    g.fillStyle = 'rgba(29,27,24,0.75)';
    for (const r of this.solid) g.fillRect(r.x * sx, r.y * sy, Math.max(1.5, r.width * sx), Math.max(1.5, r.height * sy));
    g.fillStyle = 'rgba(110,103,92,0.6)';
    for (const cr of this.crumbles) g.fillRect(cr.rect.x * sx, cr.rect.y * sy, Math.max(1.5, cr.rect.width * sx), Math.max(1.5, cr.rect.height * sy));
    g.strokeStyle = 'rgba(29,27,24,0.9)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    const key = `minimap-${this.cfg.map.seed}-${this.cfg.round}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
    this.add.image(x, y, key).setOrigin(0).setScrollFactor(0).setDepth(70).setAlpha(0.9);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(71);
  }

  private drawMinimap() {
    const { w, h, x: ox, y: oy } = ArenaScene.MINI;
    const g = this.minimap;
    const sx = w / W;
    const sy = h / H;
    g.clear();
    const cam = this.cameras.main;
    g.lineStyle(1.5, 0x2d5bff, 0.9).strokeRect(ox + cam.scrollX * sx, oy + cam.scrollY * sy, cam.width * sx, cam.height * sy);
    for (const n of this.npcs) if (n.alive) g.fillStyle(0x9b5cff, 1).fillRect(ox + n.x * sx - 2, oy + n.y * sy - 2, 4, 4);
    for (const b of this.bots) {
      if (!b.alive) continue;
      g.fillStyle(hex(PALETTE.ink), 1).fillCircle(ox + b.x * sx, oy + b.y * sy, 3.5);
      g.fillStyle(hex(b.color), 1).fillCircle(ox + b.x * sx, oy + b.y * sy, 2.5);
    }
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      g.fillStyle(hex(PALETTE.ink), 1).fillCircle(ox + r.x * sx, oy + r.y * sy, 4);
      g.fillStyle(hex(r.color), r.away ? 0.4 : 1).fillCircle(ox + r.x * sx, oy + r.y * sy, 3);
    }
    if (this.alive) {
      const px = ox + this.player.x * sx;
      const py = oy + this.player.y * sy;
      g.fillStyle(hex(PALETTE.ink), 1).fillCircle(px, py, 5.5);
      g.fillStyle(hex(this.cfg.me.color), 1).fillCircle(px, py, 4);
    }
  }

  /* ---------------- frame ---------------- */

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    const now = performance.now();
    const held = (k: Phaser.Input.Keyboard.Key[]) => k.some((x) => x.isDown);
    const cam = this.cameras.main;
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(cam);
    const walls = this.walls();
    const renderAt = now - BASE.interpMs;
    const wasHost = this.host;
    this.host = this.electHost(now);
    if (this.host !== wasHost) {
      // Bot bodies only simulate on the host.
      for (const b of this.bots) {
        b.img.body.enable = this.host && b.alive;
        if (this.host && b.alive) b.img.body.reset(b.x, b.y);
        b.buf = [];
      }
    }
    if (this.host && !wasHost) {
      // Taking over the monsters: dead ones come back after a cooldown, live ones keep walking.
      for (const n of this.npcs) {
        if (!n.alive && n.respawnAt < now) n.respawnAt = now + 5000;
        if (n.alive && n.kind === 'walker') {
          const p = this.solid.find((q) => n.x >= q.x && n.x <= q.right && Math.abs(q.y - (n.y + 22)) < 12);
          n.patrol = p ? [p.x + 20, p.right - 20] : null;
        }
      }
    }

    // ---------- remotes: interpolate ~120 ms in the past
    for (const r of this.remotes.values()) {
      if (now - r.last > BASE.staleMs) {
        this.dropRemote(r);
        continue;
      }
      if (!r.buf.length) continue;
      const { x, y, s } = sample(r.buf, renderAt);
      r.x = x;
      r.y = y;
      r.alive = r.buf[r.buf.length - 1].alive;
      r.sprite.setPosition(x, y).setVisible(r.alive).setAlpha(r.away ? 0.4 : 1);
      r.label.setPosition(x, y - 36).setVisible(r.alive).setAlpha(r.away ? 0.5 : 1);
      r.gfx.clear();
      if (r.alive) this.drawKit(r.gfx, x, y, s.aim, s.hp, s.jet, hex(r.color), s.w, s.sh);
    }

    // ---------- enemies
    if (this.host) {
      if (this.bots.length !== this.botTarget) this.setBotCount(this.botTarget);
      this.simulateBots(dt, now, walls);
      this.simulateNpcs(dt, now, walls);
    }
    this.renderBots(now, renderAt);
    for (const n of this.npcs) {
      if (!this.host && n.buf.length) {
        const { x, y, s } = sample(n.buf, renderAt);
        n.x = x;
        n.y = y;
        n.aim = s.aim;
      }
      const bob = n.kind === 'flyer' ? Math.sin(now / 160 + n.id) * 3 : 0;
      n.sprite.setPosition(n.x, n.y + bob).setVisible(n.alive).setFlipX(Math.cos(n.aim) < 0);
      n.gfx.clear();
      if (n.alive) {
        const spec = ENEMY[n.kind];
        n.gfx.lineStyle(6, hex(PALETTE.ink), 1).lineBetween(n.x, n.y + bob, n.x + Math.cos(n.aim) * 26, n.y + bob + Math.sin(n.aim) * 26);
        n.gfx.fillStyle(hex(PALETTE.ink), 0.85).fillRect(n.x - 21, n.y - spec.size[1] / 2 - 12, 42, 6);
        n.gfx.fillStyle(0x9b5cff, 1).fillRect(n.x - 20, n.y - spec.size[1] / 2 - 11, (40 * Math.max(0, n.hp)) / spec.hp, 4);
      }
    }

    // ---------- crumbling ledges: anyone standing on one starts the clock
    const feet: { x: number; y: number }[] = [
      ...(this.alive ? [{ x: this.player.x, y: this.player.body.bottom }] : []),
      ...[...this.remotes.values()].filter((r) => r.alive).map((r) => ({ x: r.x, y: r.y + 22 })),
      ...this.npcs.filter((n) => n.alive && n.kind === 'walker').map((n) => ({ x: n.x, y: n.y + 22 })),
      ...this.bots.filter((b) => b.alive).map((b) => ({ x: b.x, y: b.y + 22 })),
    ];
    for (const c of this.crumbles) {
      if (now < c.brokenUntil) continue;
      if (c.brokenUntil && now >= c.brokenUntil) {
        // regrow (unless someone is inside it)
        const inside = feet.some((f) => Phaser.Geom.Rectangle.Contains(c.rect, f.x, f.y - 10));
        if (inside) {
          c.brokenUntil = now + 500;
          continue;
        }
        c.brokenUntil = 0;
        (c.zone.body as Phaser.Physics.Arcade.StaticBody).enable = true;
        c.img.setAlpha(1).setPosition(c.rect.x - 4, c.rect.y - 4);
      }
      const on = feet.some((f) => f.x >= c.rect.x - 4 && f.x <= c.rect.right + 4 && Math.abs(f.y - c.rect.y) < 9);
      if (on && !c.touchedAt) c.touchedAt = now;
      if (c.touchedAt) {
        c.img.x = c.rect.x - 4 + (Math.random() - 0.5) * 4;
        if (now - c.touchedAt > BASE.crumbleMs) {
          c.touchedAt = 0;
          c.brokenUntil = now + BASE.regrowMs;
          (c.zone.body as Phaser.Physics.Arcade.StaticBody).enable = false;
          this.tweens.add({ targets: c.img, y: c.rect.y + 30, alpha: 0.12, duration: 350, ease: 'Quad.in' });
          this.splatSmall(c.rect.centerX, c.rect.centerY);
        }
      }
    }

    // ---------- me
    const body = this.player.body;
    const myRect = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
    if (this.alive) {
      const water = this.zones.find((z) => z.kind === 'water' && Phaser.Geom.Intersects.RectangleToRectangle(z.rect, myRect));
      const dir = (held(this.keys.right) || this.touch.right ? 1 : 0) - (held(this.keys.left) || this.touch.left ? 1 : 0);
      const grounded = body.blocked.down;
      if (grounded) this.airJumps = 0;
      const run = BASE.run * (this.has('speed', now) ? 1.55 : 1) * (water ? 0.7 : 1);
      const target = dir * run + (water ? water.flow * 190 : 0);
      body.setVelocityX(grounded ? target : Phaser.Math.Linear(body.velocity.x, target, Math.min(1, dt * 10)));

      const jetHeld = held(this.keys.jet) || this.touch.jet;
      const pressed = jetHeld && !this.jetPrev;
      this.jetPrev = jetHeld;
      let jumped = false;
      if (pressed && grounded) {
        body.setVelocityY(-BASE.jump);
        jumped = true;
      } else if (pressed && this.has('double_jump', now) && this.airJumps < 1) {
        body.setVelocityY(-BASE.jump);
        this.airJumps += 1;
        jumped = true;
        this.splatSmall(this.player.x, body.bottom);
      }
      if (jumped) play('jump');
      const endless = this.has('jetfuel', now);
      this.jetting = !jumped && jetHeld && (endless || this.fuel > 0.01);
      if (this.jetting) {
        body.setVelocityY(Math.max(-BASE.maxRise * this.t.jetpack, body.velocity.y - BASE.jetThrust * this.t.jetpack * dt));
        if (!endless) this.fuel = Math.max(0, this.fuel - BASE.fuelDrain * dt);
      } else {
        this.fuel = Math.min(1, this.fuel + (grounded ? BASE.fuelRegenGround : BASE.fuelRegenAir) * dt);
      }
      if (water) {
        // buoyancy + drag: you float up slowly and can't fall fast
        body.setVelocityY(Phaser.Math.Clamp(body.velocity.y - BASE.gravity * this.t.gravity * 0.75 * dt, -BASE.maxRise, 220));
      }

      // hazards
      for (const z of this.zones) {
        if (!Phaser.Geom.Intersects.RectangleToRectangle(z.rect, myRect)) continue;
        if (z.kind === 'lava') this.hurt(BASE.lavaDps * dt, null);
        else if (z.kind === 'spikes' && now >= this.spikeCd) {
          this.spikeCd = now + 500;
          body.setVelocityY(-480);
          this.hurt(BASE.spikeHit, null);
        }
      }
    }

    if (this.alive) {
      // Auto-aim (Mini Militia): with autofire on, lock onto the nearest
      // enemy (player or monster) in range with a clear line of sight.
      const targets: Target[] = [...[...this.remotes.values()].filter((r) => r.alive && !r.away), ...this.bots.filter((b) => b.alive), ...this.npcs.filter((n) => n.alive)];
      const near = targets
        .map((e) => ({ e, d: Math.hypot(e.x - this.player.x, e.y - this.player.y) }))
        .filter((o) => o.d < BASE.lockRange && !this.blocked(this.player.x, this.player.y, o.e.x, o.e.y, walls))
        .sort((a, b) => a.d - b.d)[0];
      const lock = this.autofire ? near ?? null : null;
      this.lockTarget = lock?.e ?? null;
      const dir = (held(this.keys.right) || this.touch.right ? 1 : 0) - (held(this.keys.left) || this.touch.left ? 1 : 0);
      if (lock) this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, lock.e.x, lock.e.y);
      else if (this.usingMouse) this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
      else if (dir !== 0) this.aim = dir > 0 ? 0 : Math.PI;

      // weapons wear off
      if (this.weapon === 'chainsaw' && now >= this.sawUntil) this.dropToSmg();
      if (this.reloadUntil && now >= this.reloadUntil) {
        this.reloadUntil = 0;
        this.ammo = WEAPONS.smg.ammo;
      }
      if (held(this.keys.reload) && this.weapon === 'smg' && !this.reloadUntil && this.ammo < WEAPONS.smg.ammo) this.reloadUntil = now + BASE.reloadMs;

      // fire: autofire when the locked target is within the weapon's reach, or manual (mouse down)
      if (!this.reloadUntil && now >= this.nextShot) {
        const reach = WEAPONS[this.weapon].reach;
        const manual = this.usingMouse && pointer.isDown && pointer.leftButtonDown();
        if ((lock && lock.d < reach) || manual) this.fire(this.aim);
      }

      // grenade: G / Q, right mouse button, or the touch button
      const nade = held(this.keys.grenade) || this.touch.grenade || (this.usingMouse && pointer.rightButtonDown());
      if (nade && !this.nadePrev) this.throwGrenade();
      this.nadePrev = nade;

      // pickups
      for (const [i, p] of this.pickups.entries()) {
        if (now < p.readyAt) continue;
        if (Math.abs(p.x - this.player.x) > 34 || Math.abs(p.y - this.player.y) > 40) continue;
        if (!this.applyPickup(p.kind, now)) continue;
        p.readyAt = now + BASE.pickupRespawnMs;
        this.cfg.net.send({ t: 'pick', i, by: this.cfg.me.id });
        play('coin');
      }
    } else {
      this.jetting = false;
      if (now >= this.respawnAt) this.spawn();
    }
    for (const p of this.pickups) p.img.setVisible(now >= p.readyAt);

    const prot = now < this.protectedUntil;
    this.player.setAlpha(prot ? 0.45 + 0.35 * Math.sin(now / 60) : 1);
    this.myGfx.clear();
    if (this.alive) {
      this.drawKit(this.myGfx, this.player.x, this.player.y, this.aim, this.hp, this.jetting, hex(this.cfg.me.color), WEAPON_IDS.indexOf(this.weapon), this.shieldHp > 0 && this.has('shield', now));
      if (this.has('speed', now)) this.myGfx.lineStyle(3, 0x5cc8ff, 0.8).lineBetween(this.player.x - 30, this.player.y + 10, this.player.x - 14, this.player.y + 10);
    }
    this.myLabel.setPosition(this.player.x, this.player.y - 36).setVisible(this.alive);

    this.stepProjectiles(dt, walls, myRect);
    this.drawHazards(now);
    this.drawMinimap();

    // ---------- crosshair + lock-on marker
    this.crosshair.clear();
    const lt = this.alive ? this.lockTarget : null;
    if (lt && lt.alive) {
      const r = 26 + Math.sin(now / 90) * 3;
      this.crosshair.lineStyle(3, hex(PALETTE.hazard), 1).strokeCircle(lt.x, lt.y, r);
      this.crosshair.lineBetween(lt.x - r - 8, lt.y, lt.x - r + 4, lt.y).lineBetween(lt.x + r - 4, lt.y, lt.x + r + 8, lt.y);
    }
    if (this.usingMouse && this.alive) {
      const cx = pointer.worldX;
      const cy = pointer.worldY;
      this.crosshair.lineStyle(3, hex(PALETTE.ink), 1).strokeCircle(cx, cy, 11);
      this.crosshair.lineBetween(cx - 17, cy, cx - 6, cy).lineBetween(cx + 6, cy, cx + 17, cy);
      this.crosshair.lineBetween(cx, cy - 17, cx, cy - 6).lineBetween(cx, cy + 6, cx, cy + 17);
    }

    // ---------- night
    if (this.night && this.nightBrush) {
      this.night.clear().fill(0x0b0a12, 0.86);
      this.night.erase(this.nightBrush, this.player.x - cam.scrollX, this.player.y - cam.scrollY);
    }

    this.sendState();
    if (now >= this.nextHud) {
      this.nextHud = now + 120;
      const w = WEAPONS[this.weapon];
      this.cfg.bus.emit('hud', {
        hp: Math.max(0, Math.round(this.hp)),
        shield: this.has('shield', now) ? Math.round(this.shieldHp) : 0,
        fuel: this.has('jetfuel', now) ? 1 : this.fuel,
        weapon: w.name,
        ammo: this.weapon === 'chainsaw' ? `${Math.ceil((this.sawUntil - now) / 1000)}s` : this.weapon === 'smg' ? `${this.ammo}/${w.ammo}` : `${this.ammo}`,
        reloading: this.reloadUntil > 0,
        grenades: this.grenades,
        buffs: BUFF_IDS.filter((b) => this.has(b, now)).map((b) => ({ name: BUFFS[b].name, s: Math.ceil(((this.buffs[b] ?? 0) - now) / 1000) })),
        respawnIn: this.alive ? null : Math.max(0, (this.respawnAt - now) / 1000),
        autofire: this.autofire,
      });
    }
  }

  /** Returns false when the pickup is useless right now (full health), so it stays for someone else. */
  private applyPickup(kind: PickupKind, now: number): boolean {
    switch (kind) {
      case 'health':
        if (this.hp >= BASE.hp) return false;
        this.hp = Math.min(BASE.hp, this.hp + 45);
        return true;
      case 'ammo':
        this.ammo = WEAPONS[this.weapon].ammo === Infinity ? this.ammo : WEAPONS[this.weapon].ammo;
        this.reloadUntil = 0;
        this.grenades = Math.min(MAX_GRENADES, this.grenades + 1);
        return true;
      case 'grenades':
        if (this.grenades >= MAX_GRENADES) return false;
        this.grenades = Math.min(MAX_GRENADES, this.grenades + 2);
        return true;
      case 'rifle':
      case 'flamethrower':
      case 'rockets':
        this.weapon = kind;
        this.ammo = WEAPONS[kind].ammo;
        this.reloadUntil = 0;
        return true;
      case 'chainsaw':
        this.weapon = 'chainsaw';
        this.sawUntil = now + CHAINSAW_SECONDS * 1000;
        this.reloadUntil = 0;
        return true;
      default: {
        const b = kind as BuffId;
        this.buffs[b] = now + BUFFS[b].seconds * 1000;
        if (b === 'shield') this.shieldHp = SHIELD_HP;
        if (b === 'jetfuel') this.fuel = 1;
        return true;
      }
    }
  }

  private stepProjectiles(dt: number, walls: Phaser.Geom.Rectangle[], myRect: Phaser.Geom.Rectangle) {
    const g = this.fxGfx;
    g.clear();
    const meId = this.cfg.me.id;
    const keep: Proj[] = [];
    const remoteRects = [...this.remotes.values()].filter((r) => r.alive && !r.away).map((r) => ({ id: r.id, rect: new Phaser.Geom.Rectangle(r.x - BODY.w / 2, r.y - BODY.h / 2, BODY.w, BODY.h) }));
    for (const p of this.projs) {
      const w = WEAPONS[p.w];
      p.age += dt;
      const ox = p.x;
      const oy = p.y;
      if (w.kind === 'grenade') p.vy += BASE.gravity * this.t.gravity * dt;
      if (w.kind === 'flame') {
        p.vx *= 1 - 1.6 * dt;
        p.vy = p.vy * (1 - 1.6 * dt) - 60 * dt;
      }
      let nx = p.x + p.vx * dt;
      let ny = p.y + p.vy * dt;
      const expired = p.age >= w.life;
      const seg = new Phaser.Geom.Line(ox, oy, nx, ny);
      const wall = nx < 0 || nx > W || ny < 0 || ny > H || walls.some((r) => Phaser.Geom.Intersects.LineToRectangle(seg, r));

      if (w.kind === 'grenade') {
        if (wall) {
          // bounce: flip whichever axis brought us into the wall
          const hitX = walls.some((r) => r.contains(nx, oy)) || nx < 0 || nx > W;
          const hitY = walls.some((r) => r.contains(ox, ny)) || ny < 0 || ny > H;
          if (hitX) p.vx *= -0.5;
          if (hitY || !hitX) {
            p.vy *= -0.45;
            p.vx *= 0.8;
          }
          nx = ox;
          ny = oy;
        }
        if (expired) {
          this.explode(ox, oy, p);
          continue;
        }
        p.x = nx;
        p.y = ny;
        g.fillStyle(hex(PALETTE.ink), 1).fillCircle(p.x, p.y, 7);
        g.fillStyle(p.color, 1).fillCircle(p.x, p.y, 3);
        keep.push(p);
        continue;
      }

      let hit = wall || expired;
      // me (victim-authoritative)
      if (!hit && this.alive && p.owner !== meId && Phaser.Geom.Intersects.LineToRectangle(seg, myRect)) {
        hit = true;
        if (w.kind !== 'rocket') this.hurt(w.damage * p.mul * this.t.damage, p.owner);
      }
      // other players stop it (they decide their own damage)
      if (!hit) hit = remoteRects.some((r) => r.id !== p.owner && Phaser.Geom.Intersects.LineToRectangle(seg, r.rect));
      // AI players stop any shot but their own; the host applies the damage
      if (!hit) {
        for (const b of this.bots) {
          if (!b.alive || b.id === p.owner) continue;
          if (!Phaser.Geom.Intersects.LineToRectangle(seg, new Phaser.Geom.Rectangle(b.x - BODY.w / 2, b.y - BODY.h / 2, BODY.w, BODY.h))) continue;
          hit = true;
          if (this.host && w.kind !== 'rocket') this.hurtBot(b, w.damage * p.mul * this.t.damage, p.owner);
          break;
        }
      }
      // enemies: players' shots only; the host applies the damage
      if (!hit && !p.owner.startsWith('npc:')) {
        for (const n of this.npcs) {
          if (!n.alive || !Phaser.Geom.Intersects.LineToRectangle(seg, this.npcRect(n))) continue;
          hit = true;
          if (this.host && w.kind !== 'rocket') this.hurtNpc(n, w.damage * p.mul * this.t.damage, p.owner);
          break;
        }
      }
      if (hit) {
        if (w.kind === 'rocket') this.explode(ox, oy, p);
        else if (!expired && w.kind === 'bullet') this.splatSmall(nx, ny);
        continue;
      }
      // draw
      if (w.kind === 'bullet') {
        g.lineStyle(p.w === 'rifle' ? 5 : 4, hex(PALETTE.ink), 1).lineBetween(ox, oy, nx, ny);
        g.lineStyle(2, p.color, 1).lineBetween(ox, oy, nx, ny);
      } else if (w.kind === 'flame') {
        const k = p.age / w.life;
        g.fillStyle(k < 0.4 ? 0xffcf3f : 0xff4a3d, 0.85 - k * 0.6).fillCircle(nx, ny, 6 + k * 18);
      } else if (w.kind === 'rocket') {
        g.lineStyle(9, hex(PALETTE.ink), 1).lineBetween(nx - Math.cos(Math.atan2(p.vy, p.vx)) * 18, ny - Math.sin(Math.atan2(p.vy, p.vx)) * 18, nx, ny);
        g.fillStyle(0xff4a3d, 1).fillCircle(nx, ny, 5);
        g.fillStyle(0xffcf3f, 0.8).fillCircle(nx - p.vx * 0.03, ny - p.vy * 0.03, 6 + Math.random() * 4);
      }
      p.x = nx;
      p.y = ny;
      keep.push(p);
    }
    this.projs = keep.length > 600 ? keep.slice(-600) : keep;
  }

  private drawHazards(now: number) {
    const g = this.hazGfx;
    g.clear();
    for (const z of this.zones) {
      const r = z.rect;
      if (z.kind === 'water') {
        g.fillStyle(0x5cc8ff, 0.38).fillRect(r.x, r.y, r.width, r.height);
        g.lineStyle(3, 0x2d5bff, 0.9).beginPath();
        for (let x = 0; x <= r.width; x += 12) {
          const y = r.y + Math.sin((x + now * 0.12) / 18) * 3;
          if (x === 0) g.moveTo(r.x, y);
          else g.lineTo(r.x + x, y);
        }
        g.strokePath();
        // current: dashes drifting with the flow
        if (z.flow !== 0) {
          g.lineStyle(2, 0x2d5bff, 0.6);
          const off = ((now * 0.08 * z.flow) % 60 + 60) % 60;
          for (let y = r.y + 18; y < r.bottom - 6; y += 22) {
            for (let x = off; x < r.width - 14; x += 60) g.lineBetween(r.x + x, y, r.x + x + 14 * Math.sign(z.flow), y);
          }
        }
      } else if (z.kind === 'lava') {
        g.fillStyle(0xff4a3d, 0.9).fillRect(r.x, r.y, r.width, r.height);
        g.lineStyle(3, 0xffcf3f, 1).beginPath();
        for (let x = 0; x <= r.width; x += 10) {
          const y = r.y + Math.sin((x + now * 0.2) / 14) * 3;
          if (x === 0) g.moveTo(r.x, y);
          else g.lineTo(r.x + x, y);
        }
        g.strokePath();
        g.lineStyle(2.5, hex(PALETTE.ink), 1).strokeRect(r.x, r.y, r.width, r.height);
        for (let i = 0; i < r.width / 60; i++) {
          const t = ((now / 900 + i * 0.37) % 1) * 1;
          g.fillStyle(0xffcf3f, 1 - t).fillCircle(r.x + ((i * 53) % r.width), r.y + r.height * (1 - t), 3 + t * 4);
        }
      }
    }
  }

  /** Gun (by weapon), jet flame, shield bubble and health bar around a player at (x, y). */
  private drawKit(g: Phaser.GameObjects.Graphics, x: number, y: number, aim: number, hp: number, jet: boolean, color: number, wi: number, shield: boolean) {
    const id = WEAPON_IDS[wi] ?? 'smg';
    const cos = Math.cos(aim);
    const sin = Math.sin(aim);
    const ink = hex(PALETTE.ink);
    const len = { smg: 28, rifle: 40, flamethrower: 30, chainsaw: 36, rockets: 34, grenade: 28 }[id];
    const width = { smg: 7, rifle: 5, flamethrower: 9, chainsaw: 11, rockets: 12, grenade: 7 }[id];
    g.lineStyle(width, ink, 1).lineBetween(x + cos * 8, y + sin * 8, x + cos * len, y + sin * len);
    if (id === 'flamethrower') g.fillStyle(0xff9e3d, 1).fillCircle(x + cos * len, y + sin * len, 5);
    if (id === 'rockets') g.fillStyle(0xff4a3d, 1).fillCircle(x + cos * len, y + sin * len, 6);
    if (id === 'rifle') g.lineStyle(3, color, 1).lineBetween(x + cos * 14, y + sin * 14, x + cos * 24, y + sin * 24);
    if (id === 'chainsaw') {
      // teeth along the blade
      g.lineStyle(2.5, 0xb6ff2e, 1);
      for (let k = 14; k < len; k += 6) {
        const jit = (Math.random() - 0.5) * 3;
        g.lineBetween(x + cos * k - sin * (6 + jit), y + sin * k + cos * (6 + jit), x + cos * (k + 3) + sin * (6 + jit), y + sin * (k + 3) - cos * (6 + jit));
      }
    }
    if (jet) {
      const fx = x - 10;
      const fy = y + 18;
      g.fillStyle(0xffcf3f, 1).fillTriangle(fx - 6, fy, fx + 6, fy, fx, fy + 16 + Math.random() * 10);
      g.fillStyle(0xff4a3d, 1).fillTriangle(fx - 3, fy, fx + 3, fy, fx, fy + 8 + Math.random() * 6);
    }
    if (shield) g.lineStyle(3, 0x5cc8ff, 0.9).strokeCircle(x, y, 32).lineStyle(1.5, 0x2d5bff, 0.6).strokeCircle(x, y, 36);
    const bw = 40;
    g.fillStyle(ink, 0.85).fillRect(x - bw / 2 - 1, y - 30, bw + 2, 6);
    g.fillStyle(hp > 35 ? color : 0xff4a3d, 1).fillRect(x - bw / 2, y - 29, (bw * Math.max(0, hp)) / BASE.hp, 4);
  }
}
