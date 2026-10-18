import * as Phaser from 'phaser';
import type { NetMsg, PlayerMeta, Shot, Transport } from '@/lib/arena/net';
import { ARENA_WORLD, arenaTuning, type ArenaMap } from '@/lib/arena/schema';
import { sampleSrc } from '@/lib/samples';
import { PALETTE, drawArena, drawPickup, drawPlayer, hex } from './art';
import type { ArenaBus } from './arena-events';
import { play } from './sfx';

/**
 * Mini Militia-style arena. Netcode (hackathon-grade, see docs/DECISIONS.md):
 * - every client simulates its own player and broadcasts state at 10 Hz;
 *   remote players are drawn ~120 ms in the past, interpolated between snapshots
 * - shots ride along in the state message; every client simulates every bullet
 * - the player who gets hit decides it (victim-authoritative) and broadcasts
 *   `die` with the killer, so nobody has to trust anyone else's hit claims
 */

export type ArenaSceneConfig = {
  map: ArenaMap;
  me: PlayerMeta;
  net: Transport;
  bus: ArenaBus;
  handFont: string;
  autofire: boolean;
};

const W = ARENA_WORLD.width;
const H = ARENA_WORLD.height;
export const ARENA_VIEW = { width: 1280, height: 720 } as const;

const BASE = {
  gravity: 1400,
  run: 330,
  jetThrust: 3200,
  maxRise: 470,
  fuelDrain: 0.45,
  fuelRegenAir: 0.1,
  fuelRegenGround: 0.75,
  fireMs: 115,
  mag: 30,
  reloadMs: 1400,
  bulletSpeed: 1500,
  bulletLife: 0.55,
  damage: 10,
  range: 760,
  hp: 100,
  respawnMs: 3000,
  protectMs: 1500,
  sendMs: 100,
  interpMs: 120,
  pickupRespawnMs: 15000,
} as const;

const SCALE = 0.7; // drawPlayer canvas is 56x64
const BODY = { w: 30, h: 42 };

type Snap = { t: number; x: number; y: number; aim: number; hp: number; alive: boolean; jet: boolean };

type Remote = {
  id: string;
  sprite: Phaser.GameObjects.Image;
  gfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  buf: Snap[];
  last: number;
  x: number;
  y: number;
  alive: boolean;
  color: string;
};

type Bullet = { x: number; y: number; vx: number; vy: number; life: number; owner: string; color: number };

type Pickup = { x: number; y: number; kind: 'health' | 'ammo'; img: Phaser.GameObjects.Image; readyAt: number };

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaSceneConfig;
  private t = arenaTuning([]);
  private rects: Phaser.Geom.Rectangle[] = [];
  private player!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private myGfx!: Phaser.GameObjects.Graphics;
  private myLabel!: Phaser.GameObjects.Text;
  private bulletGfx!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Graphics;
  private night: Phaser.GameObjects.RenderTexture | null = null;
  private nightBrush: Phaser.GameObjects.Image | null = null;
  private keys!: Record<'left' | 'right' | 'jet' | 'reload', Phaser.Input.Keyboard.Key[]>;
  private touch = { left: false, right: false, jet: false };
  private usingMouse = false;
  private remotes = new Map<string, Remote>();
  private metas = new Map<string, PlayerMeta>();
  private bullets: Bullet[] = [];
  private pickups: Pickup[] = [];
  private pendingShots: Shot[] = [];
  private hp: number = BASE.hp;
  private fuel = 1;
  private ammo: number = BASE.mag;
  private reloadUntil = 0;
  private nextShot = 0;
  private alive = true;
  private respawnAt = 0;
  private protectedUntil = 0;
  private aim = 0;
  private jetting = false;
  private lastHitBy: string | null = null;
  private nextSend = 0;
  private nextHud = 0;
  private autofire = true;
  private lockTarget: Remote | null = null;
  private unsub: (() => void)[] = [];

  constructor() {
    super('arena');
  }

  init(cfg: ArenaSceneConfig) {
    this.cfg = cfg;
    this.t = arenaTuning(cfg.map.rules);
    this.autofire = cfg.autofire;
    this.remotes = new Map();
    this.bullets = [];
    this.pickups = [];
    this.pendingShots = [];
    this.lockTarget = null;
    this.unsub = [];
  }

  preload() {
    const id = this.cfg.map.sampleId;
    if (id && !this.textures.exists(`sample-${id}`)) this.load.image(`sample-${id}`, sampleSrc(id));
  }

  create() {
    const { map, me, net, bus } = this.cfg;
    const id = map.sampleId;
    const under = id && this.textures.exists(`sample-${id}`) ? (this.textures.get(`sample-${id}`).getSourceImage() as HTMLImageElement) : undefined;

    // ---------- world
    this.physics.world.setBounds(0, 0, W, H);
    this.physics.world.gravity.y = BASE.gravity * this.t.gravity;
    const bgKey = `arena-bg-${map.seed}-${map.platforms.length}`;
    if (!this.textures.exists(bgKey)) this.textures.addCanvas(bgKey, drawArena(ARENA_WORLD, map.platforms, under));
    this.add.image(0, 0, bgKey).setOrigin(0).setDepth(0);

    const solids = this.physics.add.staticGroup();
    this.rects = map.platforms.map((p) => new Phaser.Geom.Rectangle(p.x * W, p.y * H, p.w * W, p.h * H));
    for (const r of this.rects) {
      const z = this.add.zone(r.centerX, r.centerY, r.width, r.height);
      solids.add(z);
    }

    // ---------- pickups
    for (const kind of ['health', 'ammo'] as const) {
      if (!this.textures.exists(`pickup-${kind}`)) this.textures.addCanvas(`pickup-${kind}`, drawPickup(kind));
    }
    this.pickups = map.pickups.map((p) => ({
      x: p.x * W,
      y: p.y * H - 20,
      kind: p.kind,
      readyAt: 0,
      img: this.add.image(p.x * W, p.y * H - 20, `pickup-${p.kind}`).setDepth(5),
    }));
    for (const p of this.pickups) {
      this.tweens.add({ targets: p.img, y: p.y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // ---------- me
    this.player = this.physics.add.image(0, 0, this.heroTexture(me.color)).setScale(SCALE).setDepth(20);
    this.player.body.setSize(BODY.w / SCALE, BODY.h / SCALE).setOffset((56 - BODY.w / SCALE) / 2, 64 - BODY.h / SCALE);
    this.player.setCollideWorldBounds(true);
    this.player.body.setMaxVelocity(900, 1100);
    this.physics.add.collider(this.player, solids);
    this.myGfx = this.add.graphics().setDepth(21);
    this.myLabel = this.nameTag(me.name).setDepth(22);
    this.bulletGfx = this.add.graphics().setDepth(30);
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
    };
    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) this.usingMouse = true;
    });

    // ---------- network + React
    this.unsub.push(
      net.onMessage((m) => this.onNet(m)),
      bus.on('peers', (list) => {
        this.metas = new Map(list.map((p) => [p.id, p]));
        for (const [rid, r] of this.remotes) if (!this.metas.has(rid)) this.dropRemote(r);
        for (const r of this.remotes.values()) this.refreshRemoteLook(r);
      }),
      bus.on('touch', (t) => Object.assign(this.touch, t)),
      bus.on('autofire', (on) => (this.autofire = on)),
    );
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
    return this.add
      .text(0, 0, name, { fontFamily: this.cfg.handFont, fontSize: '20px', color: PALETTE.ink })
      .setOrigin(0.5, 1);
  }

  private blocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const line = new Phaser.Geom.Line(x0, y0, x1, y1);
    return this.rects.some((r) => Phaser.Geom.Intersects.LineToRectangle(line, r));
  }

  /** Farthest spawn point from everyone alive. */
  private spawn() {
    const others = [...this.remotes.values()].filter((r) => r.alive);
    const pts = this.cfg.map.spawns.map((s) => ({ x: s.x * W, y: s.y * H }));
    const best = pts
      .map((p) => ({ p, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y))) : Math.random() }))
      .sort((a, b) => b.d - a.d)[0].p;
    this.player.body.reset(best.x, best.y - (64 * SCALE) / 2 - 2);
    this.player.setVisible(true);
    this.player.body.enable = true;
    this.hp = BASE.hp;
    this.fuel = 1;
    this.ammo = BASE.mag;
    this.reloadUntil = 0;
    this.alive = true;
    this.lastHitBy = null;
    this.protectedUntil = performance.now() + BASE.protectMs;
  }

  private splat(x: number, y: number, color: number) {
    for (let i = 0; i < 9; i++) {
      const dot = this.add.circle(x, y, 3 + Math.random() * 6, i % 3 === 0 ? color : hex(PALETTE.ink)).setDepth(25);
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 60;
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.4, duration: 600, ease: 'Cubic.out', onComplete: () => dot.destroy() });
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
    this.cfg.net.send({ t: 'die', victim: this.cfg.me.id, killer });
    this.cfg.bus.emit('died', { killer });
    this.sendState(true);
  }

  private fire(angle: number) {
    const spread = (Math.random() - 0.5) * 0.06;
    const a = angle + spread;
    const x = this.player.x + Math.cos(a) * 26;
    const y = this.player.y + Math.sin(a) * 26;
    this.addBullet(x, y, a, this.cfg.me.id, hex(this.cfg.me.color));
    this.pendingShots.push([Math.round(x), Math.round(y), +a.toFixed(3)]);
    this.ammo -= 1;
    this.nextShot = performance.now() + BASE.fireMs / this.t.fireRate;
    if (this.ammo <= 0) this.reloadUntil = performance.now() + BASE.reloadMs;
    play('shoot');
  }

  private addBullet(x: number, y: number, a: number, owner: string, color: number) {
    this.bullets.push({ x, y, vx: Math.cos(a) * BASE.bulletSpeed, vy: Math.sin(a) * BASE.bulletSpeed, life: BASE.bulletLife, owner, color });
  }

  private sendState(force = false) {
    const now = performance.now();
    if (!force && now < this.nextSend) return;
    this.nextSend = now + BASE.sendMs;
    const b = this.player.body;
    this.cfg.net.send({
      t: 'st',
      id: this.cfg.me.id,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      vx: Math.round(b.velocity.x),
      vy: Math.round(b.velocity.y),
      aim: +this.aim.toFixed(2),
      hp: Math.max(0, Math.round(this.hp)),
      alive: this.alive,
      jet: this.jetting,
      shots: this.pendingShots,
    });
    this.pendingShots = [];
  }

  /* ---------------- network ---------------- */

  private remote(id: string): Remote {
    let r = this.remotes.get(id);
    if (r) return r;
    const meta = this.metas.get(id);
    const color = meta?.color ?? PALETTE.graphite;
    r = {
      id,
      sprite: this.add.image(0, 0, this.heroTexture(color)).setScale(SCALE).setDepth(18),
      gfx: this.add.graphics().setDepth(19),
      label: this.nameTag(meta?.name ?? '...').setDepth(22),
      buf: [],
      last: performance.now(),
      x: -999,
      y: -999,
      alive: true,
      color,
    };
    this.remotes.set(id, r);
    return r;
  }

  private refreshRemoteLook(r: Remote) {
    const meta = this.metas.get(r.id);
    if (!meta) return;
    if (meta.color !== r.color) {
      r.color = meta.color;
      r.sprite.setTexture(this.heroTexture(meta.color));
    }
    if (r.label.text !== meta.name) r.label.setText(meta.name);
  }

  private dropRemote(r: Remote) {
    if (this.lockTarget === r) this.lockTarget = null;
    r.sprite.destroy();
    r.gfx.destroy();
    r.label.destroy();
    this.remotes.delete(r.id);
  }

  private onNet(m: NetMsg) {
    if (m.t === 'st') {
      if (m.id === this.cfg.me.id) return;
      const r = this.remote(m.id);
      const now = performance.now();
      r.last = now;
      r.buf.push({ t: now, x: m.x, y: m.y, aim: m.aim, hp: m.hp, alive: m.alive, jet: m.jet });
      if (r.buf.length > 20) r.buf.splice(0, r.buf.length - 20);
      const color = hex(r.color);
      for (const [x, y, a] of m.shots.slice(0, 12)) this.addBullet(x, y, a, m.id, color);
    } else if (m.t === 'die') {
      const r = this.remotes.get(m.victim);
      if (r && r.alive) {
        r.alive = false;
        this.splat(r.x, r.y, hex(r.color));
      }
    } else if (m.t === 'pick') {
      const p = this.pickups[m.i];
      if (p) p.readyAt = performance.now() + BASE.pickupRespawnMs;
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

    // ---------- remotes: interpolate ~120 ms in the past
    const renderAt = now - BASE.interpMs;
    for (const r of this.remotes.values()) {
      if (now - r.last > 6000) {
        this.dropRemote(r);
        continue;
      }
      const buf = r.buf;
      if (!buf.length) continue;
      let s: Snap = buf[buf.length - 1];
      let x = s.x;
      let y = s.y;
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= renderAt) {
          const a = buf[i - 1];
          const b = buf[i];
          const k = Phaser.Math.Clamp((renderAt - a.t) / Math.max(1, b.t - a.t), 0, 1);
          x = a.x + (b.x - a.x) * k;
          y = a.y + (b.y - a.y) * k;
          s = k < 0.5 ? a : b;
          break;
        }
      }
      r.x = x;
      r.y = y;
      r.alive = buf[buf.length - 1].alive;
      r.sprite.setPosition(x, y).setVisible(r.alive);
      r.label.setPosition(x, y - 36).setVisible(r.alive);
      r.gfx.clear();
      if (r.alive) this.drawKit(r.gfx, x, y, s.aim, s.hp, s.jet, hex(r.color));
    }

    // ---------- me
    const body = this.player.body;
    if (this.alive) {
      const dir = (held(this.keys.right) || this.touch.right ? 1 : 0) - (held(this.keys.left) || this.touch.left ? 1 : 0);
      const grounded = body.blocked.down;
      const target = dir * BASE.run;
      body.setVelocityX(grounded ? target : Phaser.Math.Linear(body.velocity.x, target, Math.min(1, dt * 10)));

      const jetHeld = held(this.keys.jet) || this.touch.jet;
      this.jetting = jetHeld && this.fuel > 0.01;
      if (this.jetting) {
        body.setVelocityY(Math.max(-BASE.maxRise * this.t.jetpack, body.velocity.y - BASE.jetThrust * this.t.jetpack * dt));
        this.fuel = Math.max(0, this.fuel - BASE.fuelDrain * dt);
      } else {
        this.fuel = Math.min(1, this.fuel + (grounded ? BASE.fuelRegenGround : BASE.fuelRegenAir) * dt);
      }

      // Auto-aim (Mini Militia): with autofire on, lock onto the nearest enemy
      // in range with a clear line of sight, on PC and touch alike.
      const enemies = [...this.remotes.values()].filter((r) => r.alive);
      const lock = this.autofire
        ? enemies
            .map((e) => ({ e, d: Math.hypot(e.x - this.player.x, e.y - this.player.y) }))
            .filter((o) => o.d < BASE.range && !this.blocked(this.player.x, this.player.y, o.e.x, o.e.y))
            .sort((a, b) => a.d - b.d)[0]?.e ?? null
        : null;
      this.lockTarget = lock;
      if (lock) this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, lock.x, lock.y);
      else if (this.usingMouse) this.aim = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
      else if (dir !== 0) this.aim = dir > 0 ? 0 : Math.PI;

      // reload
      if (this.reloadUntil && now >= this.reloadUntil) {
        this.reloadUntil = 0;
        this.ammo = BASE.mag;
      }
      if (held(this.keys.reload) && !this.reloadUntil && this.ammo < BASE.mag) this.reloadUntil = now + BASE.reloadMs;

      // fire: autofire at the locked enemy, or manual (mouse down) along your aim
      if (!this.reloadUntil && now >= this.nextShot && this.ammo > 0) {
        if (lock || (this.usingMouse && pointer.isDown && pointer.leftButtonDown())) this.fire(this.aim);
      }

      // pickups
      for (const [i, p] of this.pickups.entries()) {
        if (now < p.readyAt) continue;
        if (Math.abs(p.x - this.player.x) < 34 && Math.abs(p.y - this.player.y) < 40) {
          if (p.kind === 'health' && this.hp >= BASE.hp) continue;
          if (p.kind === 'health') this.hp = Math.min(BASE.hp, this.hp + 45);
          else {
            this.ammo = BASE.mag;
            this.reloadUntil = 0;
          }
          p.readyAt = now + BASE.pickupRespawnMs;
          this.cfg.net.send({ t: 'pick', i, by: this.cfg.me.id });
          play('coin');
        }
      }
    } else {
      this.jetting = false;
      if (now >= this.respawnAt) this.spawn();
    }
    for (const p of this.pickups) p.img.setVisible(now >= p.readyAt);

    const prot = now < this.protectedUntil;
    this.player.setAlpha(prot ? 0.45 + 0.35 * Math.sin(now / 60) : 1);
    this.myGfx.clear();
    if (this.alive) this.drawKit(this.myGfx, this.player.x, this.player.y, this.aim, this.hp, this.jetting, hex(this.cfg.me.color));
    this.myLabel.setPosition(this.player.x, this.player.y - 36).setVisible(this.alive);

    // ---------- bullets
    const me = this.alive ? new Phaser.Geom.Rectangle(body.x - 2, body.y - 2, body.width + 4, body.height + 4) : null;
    const g = this.bulletGfx;
    g.clear();
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      const seg = new Phaser.Geom.Line(b.x, b.y, nx, ny);
      b.life -= dt;
      let dead = b.life <= 0 || nx < 0 || nx > W || ny < 0 || ny > H || this.rects.some((r) => Phaser.Geom.Intersects.LineToRectangle(seg, r));
      if (!dead && me && b.owner !== this.cfg.me.id && Phaser.Geom.Intersects.LineToRectangle(seg, me)) {
        dead = true;
        if (!prot) {
          this.hp -= BASE.damage * this.t.damage;
          this.lastHitBy = b.owner;
          cam.shake(80, 0.004);
          play('hurt');
          if (this.hp <= 0) this.die(this.lastHitBy);
        }
      }
      if (!dead && b.owner === this.cfg.me.id) {
        // visual only: my bullets stop at other players (they decide the damage)
        for (const r of this.remotes.values()) {
          if (r.alive && Phaser.Geom.Intersects.LineToRectangle(seg, new Phaser.Geom.Rectangle(r.x - BODY.w / 2, r.y - BODY.h / 2, BODY.w, BODY.h))) {
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        if (b.life > 0) this.splatSmall(nx, ny);
        continue;
      }
      g.lineStyle(4, hex(PALETTE.ink), 1).lineBetween(b.x, b.y, nx, ny);
      g.lineStyle(2, b.color, 1).lineBetween(b.x, b.y, nx, ny);
      b.x = nx;
      b.y = ny;
      keep.push(b);
    }
    this.bullets = keep.length > 400 ? keep.slice(-400) : keep;

    // ---------- crosshair
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
      this.cfg.bus.emit('hud', {
        hp: Math.max(0, Math.round(this.hp)),
        fuel: this.fuel,
        ammo: this.ammo,
        mag: BASE.mag,
        reloading: this.reloadUntil > 0,
        respawnIn: this.alive ? null : Math.max(0, (this.respawnAt - now) / 1000),
        autofire: this.autofire,
      });
    }
  }

  private splatSmall(x: number, y: number) {
    const dot = this.add.circle(x, y, 5, hex(PALETTE.ink)).setDepth(26);
    this.tweens.add({ targets: dot, scale: 0.2, alpha: 0, duration: 220, onComplete: () => dot.destroy() });
  }

  /** Gun, jet flame and health bar around a player at (x, y). */
  private drawKit(g: Phaser.GameObjects.Graphics, x: number, y: number, aim: number, hp: number, jet: boolean, color: number) {
    const gx = x + Math.cos(aim) * 28;
    const gy = y + Math.sin(aim) * 28;
    g.lineStyle(7, hex(PALETTE.ink), 1).lineBetween(x + Math.cos(aim) * 8, y + Math.sin(aim) * 8, gx, gy);
    if (jet) {
      const fx = x - 10;
      const fy = y + 18;
      g.fillStyle(0xffcf3f, 1).fillTriangle(fx - 6, fy, fx + 6, fy, fx, fy + 16 + Math.random() * 10);
      g.fillStyle(0xff4a3d, 1).fillTriangle(fx - 3, fy, fx + 3, fy, fx, fy + 8 + Math.random() * 6);
    }
    const bw = 40;
    g.fillStyle(hex(PALETTE.ink), 0.85).fillRect(x - bw / 2 - 1, y - 30, bw + 2, 6);
    g.fillStyle(hp > 35 ? color : 0xff4a3d, 1).fillRect(x - bw / 2, y - 29, (bw * Math.max(0, hp)) / BASE.hp, 4);
  }
}
