import * as Phaser from 'phaser';
import { proceduralChunk, difficultyAt, speedAt } from '@/lib/survival/procedural';
import { RUN, type Chunk, type MobKind, type PickupKind } from '@/lib/survival/schema';
import { PALETTE, drawDot, drawEnemy, drawPlayer } from './art';
import {
  SKETCH, drawBar, drawBlot, drawBoostBadge, drawCap, drawCoin, drawGroundTile, drawHeart, drawLavaTile, drawLedgeTile,
  drawMagnet, drawPaperTile, drawShieldBadge, drawSlide, drawSpikeTile,
} from './survival-art';
import type { SurvivalBus, SurvivalHud } from './survival-events';
import { play } from './sfx';

export const SURVIVAL_VIEW = RUN.view;

export type SurvivalConfig = {
  bus: SurvivalBus;
  handFont: string;
  /** Fixed seed (a shared run); otherwise every run rolls a new one. */
  seed?: number;
  /** Best distance so far, in metres: marked on the track (read per run). */
  getBest?: () => number;
};

type Span = { x0: number; x1: number; crumble: boolean; alive: boolean };
type Built = { end: number; objs: Phaser.GameObjects.GameObject[] };
type Mob = { sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody; kind: MobKind; baseY: number; phase: number; nextShot: number; dead: boolean };
type State = 'ready' | 'running' | 'dead';

const G = RUN.groundY;
const PX_PER_M = 40;
const MAX_HP = 100;
const RUNNER_X = 330; // where the hero sits on screen
const INTRO = 640; // flat runway before the first chunk
const DAMAGE = { spikes: 20, lava: 30, bar: 20, mob: 20, blot: 15, pit: 25 } as const;
const HEAL = 30;
const COYOTE_MS = 110;
const BUFFER_MS = 130;
const EFFECT_MS = { magnet: 10000, boost: 4000, shield: 15000 } as const;

const PICKUP_TEX: Record<PickupKind, string> = { coin: 'sv-coin', heart: 'sv-heart', shield: 'sv-shield', magnet: 'sv-magnet', boost: 'sv-boost' };
const MOB_TEX: Record<MobKind, string> = { walker: 'sv-walker', flyer: 'sv-flyer', shooter: 'sv-shooter' };

export class SurvivalScene extends Phaser.Scene {
  private cfg!: SurvivalConfig;
  private seed = 1;
  private state: State = 'ready';
  private paused = false;
  private reduced = false;
  private runner!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private look!: Phaser.GameObjects.Image;
  private paper!: Phaser.GameObjects.TileSprite;
  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private crumbles!: Phaser.Physics.Arcade.StaticGroup;
  private ledges!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private pickups!: Phaser.Physics.Arcade.Group;
  private mobGroup!: Phaser.Physics.Arcade.Group;
  private blots!: Phaser.Physics.Arcade.Group;
  private mobs: Mob[] = [];
  private spans: Span[] = [];
  private built: Built[] = [];
  private lava: Phaser.GameObjects.TileSprite[] = [];
  private chunkIndex = 0;
  private nextChunkX = 0;
  private keys!: { jump: Phaser.Input.Keyboard.Key[]; slide: Phaser.Input.Keyboard.Key[] };
  private jumpHeldPrev = false;
  private lastGrounded = -9999;
  private jumpPressedAt = -9999;
  private slideUntil = 0;
  private sliding = false;
  private wasGrounded = true;
  private gesture: { x: number; y: number; at: number; used: boolean } | null = null;
  private touchJump = false;
  private touchSlide = false;
  private runMs = 0;
  private speed: number = RUN.baseSpeed;
  private hp = MAX_HP;
  private coins = 0;
  private stomps = 0;
  private shieldUntil = 0;
  private magnetUntil = 0;
  private boostUntil = 0;
  private invulnUntil = 0;
  private cause = '';
  private hudTimer = 0;
  private unsub: (() => void)[] = [];
  private best = 0;
  private groundEnd = -Infinity;

  constructor() {
    super('survival');
  }

  init(cfg: SurvivalConfig) {
    // Phaser reuses this instance on scene.restart(): reset every per-run field.
    this.cfg = cfg;
    this.seed = cfg.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.state = 'ready';
    this.paused = false;
    this.mobs = [];
    this.spans = [];
    this.built = [];
    this.lava = [];
    this.chunkIndex = 0;
    this.nextChunkX = INTRO;
    this.groundEnd = -Infinity;
    this.jumpHeldPrev = false;
    this.lastGrounded = -9999;
    this.jumpPressedAt = -9999;
    this.slideUntil = 0;
    this.sliding = false;
    this.wasGrounded = true;
    this.gesture = null;
    this.touchJump = false;
    this.touchSlide = false;
    this.runMs = 0;
    this.speed = RUN.baseSpeed;
    this.hp = MAX_HP;
    this.coins = 0;
    this.stomps = 0;
    this.shieldUntil = 0;
    this.magnetUntil = 0;
    this.boostUntil = 0;
    this.invulnUntil = 0;
    this.cause = '';
    this.hudTimer = 0;
    this.unsub = [];
    this.best = cfg.getBest?.() ?? 0;
    this.reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  create() {
    // scene.restart() rebuilds physics and tweens but keeps the clock's paused flag:
    // R pressed while paused would start a run whose timers never fire.
    this.time.paused = false;
    this.makeTextures();
    this.physics.world.gravity.y = RUN.gravity;
    this.physics.world.OVERLAP_BIAS = 12;
    this.cameras.main.setBackgroundColor(SKETCH.paper);

    this.paper = this.add.tileSprite(0, 0, SURVIVAL_VIEW.width, SURVIVAL_VIEW.height, 'sv-paper').setOrigin(0).setScrollFactor(0).setDepth(-10);

    this.solids = this.physics.add.staticGroup();
    this.crumbles = this.physics.add.staticGroup();
    this.ledges = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();
    this.pickups = this.physics.add.group({ allowGravity: false, immovable: true });
    this.mobGroup = this.physics.add.group();
    this.blots = this.physics.add.group({ allowGravity: false });

    // runway, then the first chunks
    this.buildGround(-SURVIVAL_VIEW.width, INTRO, false, { end: INTRO, objs: [] });
    this.fillAhead(0);

    // the hero: an invisible physics body, with the drawn hero following it
    this.look = this.add.image(160, G, 'hero').setOrigin(0.5, 1).setDepth(6);
    this.runner = this.physics.add.sprite(160, G - 1, 'hero').setOrigin(0.5, 1).setVisible(false);
    this.setStance(false);
    this.runner.body.setMaxVelocity(2000, 1800);

    this.physics.add.collider(this.runner, this.solids);
    this.physics.add.collider(this.runner, this.crumbles, (_r, z) => this.onCrumble(z as Phaser.Physics.Arcade.Sprite));
    this.physics.add.collider(this.runner, this.ledges);
    this.physics.add.collider(this.mobGroup, this.solids);
    this.physics.add.collider(this.mobGroup, this.crumbles);
    this.physics.add.overlap(this.runner, this.hazards, (_r, h) => {
      const z = h as Phaser.Physics.Arcade.Sprite;
      this.hurt(z.getData('dmg') as number, z.getData('cause') as string, z.getData('pop') as boolean);
    });
    this.physics.add.overlap(this.runner, this.pickups, (_r, p) => this.collect(p as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.runner, this.mobGroup, (_r, m) => this.touchMob(m as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody));
    this.physics.add.overlap(this.runner, this.blots, (_r, b) => {
      (b as Phaser.GameObjects.GameObject).destroy();
      this.hurt(DAMAGE.blot, 'got splatted by an ink blot');
    });

    // ---------- input
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      jump: [kb.addKey(K.SPACE), kb.addKey(K.UP), kb.addKey(K.W)],
      slide: [kb.addKey(K.DOWN), kb.addKey(K.S)],
    };
    kb.addCapture([K.SPACE, K.UP, K.DOWN]);
    kb.addKey(K.R).on('down', () => this.restart());
    // Touch / mouse: swipe up or tap to jump, swipe down to slide.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.gesture = { x: p.x, y: p.y, at: this.time.now, used: false };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const g = this.gesture;
      if (!g || g.used || !p.isDown) return;
      const dy = p.y - g.y;
      if (Math.abs(dy) < 30 || Math.abs(dy) < Math.abs(p.x - g.x)) return;
      g.used = true;
      if (dy < 0) this.touchJump = true;
      else this.touchSlide = true;
    });
    this.input.on('pointerup', () => {
      const g = this.gesture;
      this.gesture = null;
      if (g && !g.used && this.time.now - g.at < 400) this.touchJump = true;
    });

    const bus = this.cfg.bus;
    this.unsub.push(
      bus.on('restart', () => this.restart()),
      bus.on('pause', (p) => this.setPaused(p)),
    );
    this.events.on('postupdate', this.sync, this);
    // game.destroy() (React unmount) fires DESTROY but not SHUTDOWN.
    const cleanup = () => {
      this.events.off('shutdown', cleanup);
      this.events.off('destroy', cleanup);
      this.unsub.forEach((u) => u());
      this.events.off('postupdate', this.sync, this);
    };
    this.events.once('shutdown', cleanup);
    this.events.once('destroy', cleanup);

    this.cameras.main.scrollX = this.runner.x - RUNNER_X;
    if (!this.reduced) this.tweens.add({ targets: this.look, scaleY: 0.94, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.emitHud();
    bus.emit('ready');
  }

  /* ---------------- textures ---------------- */

  private makeTextures() {
    const add = (key: string, make: () => HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    };
    add('hero', () => drawPlayer());
    add('sv-slide', () => drawSlide(drawPlayer()));
    add('sv-paper', drawPaperTile);
    add('sv-ground', () => drawGroundTile(false));
    add('sv-crumble', () => drawGroundTile(true));
    add('sv-ledge', drawLedgeTile);
    add('sv-cap', () => drawCap());
    add('sv-spike', drawSpikeTile);
    add('sv-lava', drawLavaTile);
    add('sv-coin', drawCoin);
    add('sv-heart', drawHeart);
    add('sv-shield', drawShieldBadge);
    add('sv-magnet', drawMagnet);
    add('sv-boost', drawBoostBadge);
    add('sv-blot', drawBlot);
    add('sv-walker', () => drawEnemy('walker'));
    add('sv-flyer', () => drawEnemy('flyer'));
    add('sv-shooter', () => drawEnemy('turret'));
    add('sv-zone', () => drawDot(1, '#000000'));
    add('ink-dot', () => drawDot(5, PALETTE.ink));
    add('accent-dot', () => drawDot(4, PALETTE.accent));
  }

  /* ---------------- track ---------------- */

  private fillAhead(scrollX: number) {
    while (this.nextChunkX < scrollX + SURVIVAL_VIEW.width * 2.2) {
      // Build for the speed the runner will have when it gets there.
      const eta = (this.runMs + ((this.nextChunkX - scrollX) / this.speed) * 1000) / 1000;
      const chunk = proceduralChunk(this.seed, this.chunkIndex, difficultyAt(eta), speedAt(eta));
      this.buildChunk(chunk, this.nextChunkX);
      this.nextChunkX += chunk.length;
      this.chunkIndex++;
    }
  }

  private buildChunk(c: Chunk, X: number) {
    const built: Built = { end: X + c.length, objs: [] };
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      built.objs.push(o);
      return o;
    };
    for (const g of c.ground) this.buildGround(X + g.x, X + g.x + g.w, g.crumble, built);

    for (const l of c.ledges) {
      const x0 = X + l.x;
      const top = G - l.h;
      keep(this.add.tileSprite(x0, top - 4, l.w, 26, 'sv-ledge').setOrigin(0).setDepth(2));
      const z = keep(this.zone(this.ledges, x0 + l.w / 2, top + 7, l.w, 14));
      const b = z.body as Phaser.Physics.Arcade.StaticBody;
      b.checkCollision.down = false;
      b.checkCollision.left = false;
      b.checkCollision.right = false;
    }

    for (const h of c.hazards) {
      const x0 = X + h.x;
      if (h.kind === 'spikes') {
        keep(this.add.tileSprite(x0, G - 34, h.w, 34, 'sv-spike').setOrigin(0).setDepth(3));
        const z = keep(this.zone(this.hazards, x0 + h.w / 2, G - 11, Math.max(16, h.w - 14), 22));
        z.setData({ dmg: DAMAGE.spikes, cause: 'stepped on spikes', pop: true });
      } else {
        const t = keep(this.add.tileSprite(x0, G - 14, h.w, 40, 'sv-lava').setOrigin(0).setDepth(3));
        this.lava.push(t);
        const z = keep(this.zone(this.hazards, x0 + h.w / 2, G - 5, Math.max(20, h.w - 12), 14));
        z.setData({ dmg: DAMAGE.lava, cause: 'paddled in lava', pop: true });
      }
    }

    for (const bar of c.bars) {
      const x0 = X + bar.x;
      const bottom = G - 34;
      const key = `sv-bar-${Math.round(bar.w / 20) * 20}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, drawBar(Math.round(bar.w / 20) * 20, bottom));
      keep(this.add.image(x0, 0, key).setOrigin(0).setDisplaySize(bar.w + 8, bottom).setDepth(4));
      const z = keep(this.zone(this.hazards, x0 + bar.w / 2 + 4, bottom - 40, bar.w - 6, 80));
      z.setData({ dmg: DAMAGE.bar, cause: 'forgot to slide under a beam', pop: false });
    }

    for (const m of c.mobs) {
      const x = X + m.x;
      const flyer = m.kind === 'flyer';
      const y = flyer ? G - m.h - 15 : G - 2;
      const s = this.physics.add.sprite(x, y, MOB_TEX[m.kind]) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
      s.setOrigin(0.5, flyer ? 0.5 : 1).setDepth(5).setFlipX(true);
      this.mobGroup.add(s);
      s.body.setAllowGravity(!flyer);
      if (flyer) s.body.setSize(40, 30).setOffset(12, 12);
      else s.body.setSize(44, 42).setOffset(10, 14);
      this.mobs.push({ sprite: s, kind: m.kind, baseY: y, phase: x / 97, nextShot: 0, dead: false });
    }

    for (const p of c.pickups) {
      const s = this.pickups.create(X + p.x, G - p.h, PICKUP_TEX[p.kind]) as Phaser.Physics.Arcade.Sprite;
      s.setDepth(4).setData('kind', p.kind);
      if (p.kind !== 'coin' && !this.reduced) this.tweens.add({ targets: s, y: s.y - 8, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // margin notes: every 100 m, and your best run
    const m0 = Math.ceil((X - 160) / PX_PER_M / 100) * 100;
    for (let m = m0; m * PX_PER_M + 160 < X + c.length; m += 100) {
      if (m <= 0) continue;
      keep(this.add.text(m * PX_PER_M + 160, 70, `${m} m`, { fontFamily: this.cfg.handFont, fontSize: '30px', color: SKETCH.pop }).setOrigin(0.5).setDepth(1).setAngle(-4));
    }
    const best = this.best;
    const bx = best * PX_PER_M + 160;
    if (best > 20 && bx >= X && bx < X + c.length) {
      keep(this.add.rectangle(bx, G / 2, 4, G, Phaser.Display.Color.HexStringToColor(PALETTE.hazard).color, 0.35).setDepth(1));
      keep(this.add.text(bx + 10, 120, 'your best', { fontFamily: this.cfg.handFont, fontSize: '28px', color: PALETTE.hazard }).setDepth(1).setAngle(-3));
    }
    this.built.push(built);
  }

  private buildGround(x0: number, x1: number, crumble: boolean, built: Built) {
    const w = x1 - x0;
    const tile = this.add.tileSprite(x0, G - 6, w, crumble ? 70 : 140, crumble ? 'sv-crumble' : 'sv-ground').setOrigin(0).setDepth(2);
    tile.tilePositionX = x0 % 240;
    built.objs.push(tile);
    // cliff edges only where there's a gap (chunk seams and crumble joints stay seamless)
    if (Number.isFinite(this.groundEnd) && x0 > this.groundEnd + 1) {
      built.objs.push(this.add.image(this.groundEnd - 7, G - 2, 'sv-cap').setOrigin(0).setDepth(2));
      built.objs.push(this.add.image(x0 - 3, G - 2, 'sv-cap').setOrigin(0).setDepth(2));
    }
    this.groundEnd = x1;
    const z = this.zone(crumble ? this.crumbles : this.solids, x0 + w / 2, G + (crumble ? 30 : 60), w, crumble ? 60 : 120);
    const span: Span = { x0, x1, crumble, alive: true };
    z.setData({ img: tile, span, armed: false });
    built.objs.push(z);
    this.spans.push(span);
  }

  private zone(group: Phaser.Physics.Arcade.StaticGroup, x: number, y: number, w: number, h: number): Phaser.Physics.Arcade.Sprite {
    const z = group.create(x, y, 'sv-zone') as Phaser.Physics.Arcade.Sprite;
    z.setVisible(false).setDisplaySize(w, h).refreshBody();
    return z;
  }

  private cleanup(scrollX: number) {
    const behind = scrollX - 260;
    while (this.built.length && this.built[0].end < behind) {
      const b = this.built.shift()!;
      for (const o of b.objs) {
        if (o instanceof Phaser.GameObjects.TileSprite) this.lava = this.lava.filter((t) => t !== o);
        o.destroy();
      }
    }
    this.spans = this.spans.filter((s) => s.x1 > behind);
    for (const m of this.mobs) if (!m.dead && m.sprite.x < behind) this.killMob(m, false);
    this.mobs = this.mobs.filter((m) => m.sprite.active);
    for (const g of [this.pickups, this.blots]) {
      for (const o of g.getChildren().slice()) if ((o as Phaser.Physics.Arcade.Sprite).x < behind) o.destroy();
    }
  }

  /* ---------------- loop ---------------- */

  update(time: number, delta: number) {
    if (this.paused || this.state === 'dead') return;
    const body = this.runner.body;
    const grounded = body.blocked.down || body.touching.down;
    const boosting = time < this.boostUntil;

    const jumpHeld = this.keys.jump.some((k) => k.isDown);
    const slideHeld = this.keys.slide.some((k) => k.isDown);
    // JustDown is latched until read, so even a tap shorter than a frame counts.
    const justDown = (ks: Phaser.Input.Keyboard.Key[]) => ks.reduce((any, k) => Phaser.Input.Keyboard.JustDown(k) || any, false);
    const jumpPressed = justDown(this.keys.jump) || this.touchJump;
    const slidePressed = justDown(this.keys.slide) || this.touchSlide;
    if (this.touchSlide) this.slideUntil = time + 650;
    else if (slidePressed) this.slideUntil = time + 480;
    this.touchJump = false;
    this.touchSlide = false;

    if (this.state === 'ready') {
      this.jumpHeldPrev = jumpHeld;
      if (jumpPressed) this.begin(time);
      return;
    }

    this.runMs += delta;
    this.speed = speedAt(this.runMs / 1000);
    body.setVelocityX(this.speed * (boosting ? 1.5 : 1));

    if (boosting) {
      body.setVelocityY((G - 250 - this.runner.y) * 5);
      if (this.sliding) this.setStance(false);
    } else {
      if (!body.allowGravity) {
        body.setAllowGravity(true);
        this.invulnUntil = Math.max(this.invulnUntil, time + 1500);
      }
      if (grounded) this.lastGrounded = time;
      if (jumpPressed) {
        this.jumpPressedAt = time;
        this.slideUntil = 0;
      }
      const wantSlide = time < this.slideUntil || slideHeld;
      if (time - this.jumpPressedAt <= BUFFER_MS && time - this.lastGrounded <= COYOTE_MS) this.jump();
      // variable jump height on keys: let go early for a short hop
      if (!jumpHeld && this.jumpHeldPrev && body.velocity.y < 0) body.setVelocityY(body.velocity.y * 0.5);
      // slide on the ground, slam down in the air
      if (!grounded && slidePressed) body.setVelocityY(Math.max(body.velocity.y, 1300));
      const slide = grounded && wantSlide;
      if (slide !== this.sliding) this.setStance(slide);

      if (grounded && !this.wasGrounded) {
        this.squash(1.2, 0.8, 80);
        this.burst(this.runner.x, this.runner.y, 'ink-dot', 4, 0.3);
      }
      // forgiving ledge catch: clipped a cliff by a few px → step up onto it
      if (body.blocked.right && this.runner.y > G && this.runner.y < G + 28) {
        body.reset(this.runner.x + 6, G - 1);
        body.setVelocityX(this.speed);
      }
      if (this.runner.y > G + 170) this.rescue(time);
    }
    this.wasGrounded = grounded;
    this.jumpHeldPrev = jumpHeld;

    this.updateMobs(time);
    this.updatePickups(time);
    for (const t of this.lava) t.tilePositionX += delta * 0.03;

    const scrollX = this.runner.x - RUNNER_X;
    this.fillAhead(scrollX);
    this.cleanup(scrollX);

    this.hudTimer += delta;
    if (this.hudTimer > 150) {
      this.hudTimer = 0;
      this.emitHud();
    }
  }

  /** Camera, background and the drawn hero follow the body after physics has moved it. */
  private sync() {
    const cam = this.cameras.main;
    cam.scrollX = this.runner.x - RUNNER_X;
    this.paper.tilePositionX = cam.scrollX * 0.5;
    this.look.setPosition(this.runner.x, this.runner.y);
    const now = this.time.now;
    const flashing = this.state === 'running' && now < this.invulnUntil;
    this.look.setAlpha(flashing ? (this.reduced ? 0.55 : Math.floor(now / 80) % 2 ? 0.25 : 1) : 1);
    const boosting = now < this.boostUntil;
    const shielded = now < this.shieldUntil;
    if (boosting) this.look.setTint(Phaser.Display.Color.HexStringToColor(SKETCH.lime).color);
    else if (shielded) this.look.setTint(Phaser.Display.Color.HexStringToColor(SKETCH.sky).color);
    else this.look.clearTint();
    if (!this.reduced && this.state === 'running' && this.runner.body.velocity.y === 0 && !this.sliding) this.look.setAngle(Math.sin(now / 60) * 4);
    else this.look.setAngle(0);
  }

  private begin(time: number) {
    this.state = 'running';
    this.tweens.killTweensOf(this.look);
    this.look.setScale(1);
    this.jumpPressedAt = time;
    this.lastGrounded = time;
    this.jump();
    this.cfg.bus.emit('started');
  }

  private jump() {
    this.runner.body.setVelocityY(-RUN.jumpVelocity);
    this.lastGrounded = -9999;
    this.jumpPressedAt = -9999;
    if (this.sliding) this.setStance(false);
    this.squash(0.8, 1.25, 100);
    play('jump');
  }

  /** Standing or sliding hitbox; the body's bottom stays where it is. */
  private setStance(slide: boolean) {
    this.sliding = slide;
    const b = this.runner.body;
    if (slide) b.setSize(48, RUN.slideH, false).setOffset(4, 64 - RUN.slideH);
    else b.setSize(RUN.playerW, RUN.standH, false).setOffset((56 - RUN.playerW) / 2, 64 - RUN.standH);
    this.look.setTexture(slide ? 'sv-slide' : 'hero');
    if (slide) this.burst(this.runner.x - 20, this.runner.y, 'ink-dot', 3, 0.25);
  }

  private squash(sx: number, sy: number, ms: number) {
    if (this.reduced || this.sliding) return;
    this.tweens.killTweensOf(this.look);
    this.look.setScale(sx, sy);
    this.tweens.add({ targets: this.look, scaleX: 1, scaleY: 1, duration: ms * 2, ease: 'Back.out' });
  }

  private updateMobs(time: number) {
    const px = this.runner.x;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const s = m.sprite;
      if (m.kind === 'walker') {
        if (s.x - px < SURVIVAL_VIEW.width) s.body.setVelocityX(-110);
        else s.body.setVelocityX(0);
      } else if (m.kind === 'flyer') {
        s.body.setVelocity(s.x - px < SURVIVAL_VIEW.width ? -60 : 0, 0);
        s.y = m.baseY + Math.sin(time / 260 + m.phase) * (m.baseY > G - 80 ? 5 : 14);
      } else {
        s.body.setVelocityX(0);
        const ahead = s.x - px;
        if (ahead > 220 && ahead < 1050 && time > m.nextShot) {
          if (m.nextShot !== 0) this.shoot(s, time);
          m.nextShot = time + 1500 + ((m.phase * 997) % 900);
        }
      }
      if (s.y > G + 300) this.killMob(m, false);
    }
  }

  private shoot(s: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody, time: number) {
    const high = Math.floor(time / 1000 + s.x) % 2 === 0;
    const b = this.blots.create(s.x - 30, high ? G - 46 : G - 16, 'sv-blot') as Phaser.Physics.Arcade.Sprite;
    b.setDepth(5).setVelocityX(-380);
    (b.body as Phaser.Physics.Arcade.Body).setSize(20, 14);
    this.squashMob(s);
    play('shoot');
  }

  private squashMob(s: Phaser.GameObjects.Sprite) {
    if (this.reduced) return;
    this.tweens.add({ targets: s, scaleX: 1.15, scaleY: 0.85, duration: 90, yoyo: true });
  }

  private updatePickups(time: number) {
    if (time >= this.magnetUntil) return;
    const px = this.runner.x;
    const py = this.runner.y - 30;
    for (const o of this.pickups.getChildren()) {
      const s = o as Phaser.Physics.Arcade.Sprite;
      if (!s.active || s.getData('kind') !== 'coin') continue;
      const d = Phaser.Math.Distance.Between(s.x, s.y, px, py);
      if (d < 300) {
        s.x += (px - s.x) * 0.2;
        s.y += (py - s.y) * 0.2;
        (s.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      }
    }
  }

  /* ---------------- interactions ---------------- */

  private onCrumble(z: Phaser.Physics.Arcade.Sprite) {
    if (z.getData('armed') || !this.runner.body.touching.down) return;
    z.setData('armed', true);
    const img = z.getData('img') as Phaser.GameObjects.TileSprite;
    if (!this.reduced) this.tweens.add({ targets: img, x: img.x + 3, duration: 50, yoyo: true, repeat: 3 });
    this.time.delayedCall(340, () => {
      if (!z.active) return;
      (z.getData('span') as Span).alive = false;
      (z.body as Phaser.Physics.Arcade.StaticBody).enable = false;
      this.tweens.add({ targets: img, y: img.y + 260, alpha: 0, angle: 6, duration: 600, ease: 'Quad.in' });
      play('stomp');
    });
  }

  private collect(s: Phaser.Physics.Arcade.Sprite) {
    if (!s.active || this.state !== 'running') return;
    const kind = s.getData('kind') as PickupKind;
    s.disableBody(true, false);
    this.tweens.add({ targets: s, scale: 1.6, alpha: 0, y: s.y - 30, duration: 240, onComplete: () => s.destroy() });
    const now = this.time.now;
    play('coin');
    if (kind === 'coin') {
      this.coins++;
      return;
    }
    this.burst(s.x, s.y, 'accent-dot', 10);
    if (kind === 'heart') {
      this.hp = Math.min(MAX_HP, this.hp + HEAL);
      this.floatText(s.x, s.y - 30, `+${HEAL} HP`, PALETTE.ink);
    } else if (kind === 'shield') {
      this.shieldUntil = now + EFFECT_MS.shield;
      this.floatText(s.x, s.y - 30, 'shield!', PALETTE.ink);
    } else if (kind === 'magnet') {
      this.magnetUntil = now + EFFECT_MS.magnet;
      this.floatText(s.x, s.y - 30, 'coin magnet!', PALETTE.ink);
    } else {
      this.boostUntil = now + EFFECT_MS.boost;
      this.runner.body.setAllowGravity(false);
      if (this.sliding) this.setStance(false);
      this.floatText(s.x, s.y - 30, 'zoom!', PALETTE.ink);
    }
    this.emitHud();
  }

  private touchMob(sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody) {
    const m = this.mobs.find((x) => x.sprite === sprite);
    if (!m || m.dead || this.state !== 'running') return;
    const pb = this.runner.body;
    const now = this.time.now;
    if (now < this.boostUntil || (pb.velocity.y > 0 && pb.bottom < sprite.body.top + 24)) {
      this.killMob(m, true);
      if (now >= this.boostUntil) pb.setVelocityY(-RUN.jumpVelocity * 0.7);
      return;
    }
    this.hurt(DAMAGE.mob, m.kind === 'shooter' ? 'walked into an ink turret' : m.kind === 'flyer' ? 'got bonked by a flying eye' : 'ran into a walker');
  }

  private killMob(m: Mob, stomped: boolean) {
    m.dead = true;
    const s = m.sprite;
    s.body.enable = false;
    if (!stomped) {
      s.destroy();
      return;
    }
    this.stomps++;
    this.burst(s.x, s.y - 20, 'ink-dot', 8);
    this.floatText(s.x, s.y - 60, '+25', PALETTE.ink);
    play('stomp');
    this.tweens.add({ targets: s, scaleY: 0.2, alpha: 0, duration: 240, onComplete: () => s.destroy() });
  }

  private hurt(dmg: number, cause: string, pop = false) {
    if (this.state !== 'running') return;
    const now = this.time.now;
    if (now < this.boostUntil || now < this.invulnUntil) return;
    if (pop) this.runner.body.setVelocityY(-RUN.jumpVelocity * 0.72);
    if (now < this.shieldUntil) {
      this.shieldUntil = 0;
      this.invulnUntil = now + 900;
      this.floatText(this.runner.x, this.runner.y - 80, 'shield saved you!', PALETTE.ink);
      play('bounce');
      return;
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnUntil = now + 1300;
    this.cause = cause;
    play('hurt');
    if (!this.reduced) this.cameras.main.shake(140, 0.006);
    this.burst(this.runner.x, this.runner.y - 30, 'ink-dot', 10, 0.7);
    this.floatText(this.runner.x, this.runner.y - 90, `-${dmg}`, PALETTE.hazard);
    this.emitHud();
    if (this.hp <= 0) this.die();
  }

  /** Fell into a gap: lift the hero onto the next solid ground, for a price. */
  private rescue(time: number) {
    const x = this.runner.x;
    const next = this.spans.find((s) => s.alive && !s.crumble && s.x1 - 120 > x && s.x0 >= x - 40) ?? this.spans.find((s) => s.alive && !s.crumble && s.x1 > x + 120);
    const tx = next ? Math.max(next.x0 + 50, x) : x + 200;
    this.runner.body.reset(tx, G - 240);
    this.runner.body.setVelocityX(this.speed);
    this.lastGrounded = -9999;
    this.hurt(DAMAGE.pit, 'fell off the page');
    this.invulnUntil = Math.max(this.invulnUntil, time + 900); // a moment to land
  }

  private die() {
    this.state = 'dead';
    play('death');
    if (!this.reduced) this.cameras.main.shake(220, 0.01);
    this.burst(this.runner.x, this.runner.y - 30, 'ink-dot', this.reduced ? 8 : 24, 1);
    this.look.setVisible(false);
    this.physics.pause();
    this.emitHud();
    const stats = {
      distance: this.distance(),
      score: this.score(),
      coins: this.coins,
      stomps: this.stomps,
      timeSeconds: Math.round(this.runMs / 100) / 10,
      seed: this.seed,
      cause: this.cause || 'ran out of ink',
    };
    this.time.delayedCall(800, () => this.cfg.bus.emit('end', stats));
  }

  private restart() {
    this.scene.restart({ ...this.cfg, seed: undefined });
  }

  private setPaused(p: boolean) {
    if (this.state === 'dead') return;
    this.paused = p;
    if (p) {
      this.physics.pause();
      this.tweens.pauseAll();
      this.time.paused = true;
    } else {
      this.physics.resume();
      this.tweens.resumeAll();
      this.time.paused = false;
      for (const k of [...this.keys.jump, ...this.keys.slide]) Phaser.Input.Keyboard.JustDown(k); // drop presses made while paused
    }
  }

  private distance() {
    return Math.max(0, Math.floor((this.runner.x - 160) / PX_PER_M));
  }

  private score() {
    return this.distance() + this.coins * 5 + this.stomps * 25;
  }

  private emitHud() {
    const now = this.time.now;
    const effects: SurvivalHud['effects'] = [];
    if (now < this.boostUntil) effects.push({ name: 'zoom', s: (this.boostUntil - now) / 1000 });
    if (now < this.magnetUntil) effects.push({ name: 'magnet', s: (this.magnetUntil - now) / 1000 });
    this.cfg.bus.emit('hud', {
      hp: this.hp,
      maxHp: MAX_HP,
      distance: this.distance(),
      score: this.score(),
      coins: this.coins,
      pace: this.speed / RUN.baseSpeed,
      effects,
      shield: now < this.shieldUntil,
    });
  }

  /* ---------------- juice ---------------- */

  private burst(x: number, y: number, key: string, n: number, power = 0.6) {
    const em = this.add.particles(x, y, key, {
      speed: { min: 60 * power, max: 380 * power },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: { min: 250, max: 600 },
      gravityY: 600,
      emitting: false,
    });
    em.setDepth(8);
    em.explode(this.reduced ? Math.ceil(n / 3) : n);
    this.time.delayedCall(700, () => em.destroy());
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontFamily: this.cfg.handFont, fontSize: '28px', color }).setOrigin(0.5).setDepth(9);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1000, ease: 'Sine.out', onComplete: () => t.destroy() });
  }
}
