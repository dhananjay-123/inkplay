import * as Phaser from 'phaser';
import type { CurrentLevel } from '@/lib/store';
import type { BBox, Mark, MarkLabel, Rule, RunStats } from '@/lib/schema';
import { BASE, WORLD, surfaceOf, surfaceOfBox, surfaceYAt, tuningFor, type Surface, type Tuning } from '@/lib/physics';
import { PLAYER_SIZE } from '@/lib/fixer';
import { PALETTE, cutOut, drawBoss, drawDot, drawPlayer, drawProjectile, drawRescuePlatform, hex } from './art';
import type { GameBus } from './events';
import { play } from './sfx';

export type SceneConfig = {
  data: CurrentLevel;
  bus: GameBus;
  /** Self-playing demo (landing page): a simple bot drives the hero. */
  autoplay?: boolean;
  handFont: string;
};

type Effect = { kind: 'speed_boost' | 'tiny' | 'giant'; until: number } | null;

type Enemy = {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  label: MarkLabel;
  dir: number;
  originX: number;
  originY: number;
  phase: number;
  nextHop: number;
  dead: boolean;
};

const STEP = 6; // px between surface samples for sloped platforms
const MAX_DEATHS = 30;

export class LevelScene extends Phaser.Scene {
  private cfg!: SceneConfig;
  private t!: Tuning;
  private rules: Rule[] = [];
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private bouncers!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private pickups!: Phaser.Physics.Arcade.Group;
  private goal!: Phaser.Types.Physics.Arcade.SpriteWithStaticBody;
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private surfaces: Surface[] = [];
  private keys!: { left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[]; jump: Phaser.Input.Keyboard.Key[] };
  private touch = { left: false, right: false, jump: false };
  private jumpHeldPrev = false;
  private lastGrounded = -9999;
  private jumpPressedAt = -9999;
  private airJumps = 0;
  private canDoubleJump = false;
  private shield = false;
  private effect: Effect = null;
  private deaths = 0;
  private coins = 0;
  private startedAt = 0;
  private ended = false;
  private dying = false;
  private lastCause = '';
  private enemySpeedMul = 1;
  private nextAccel = Infinity;
  private timeLimit: number | null = null;
  private liveTimer = 0;
  private wasGrounded = false;
  private boss: Phaser.GameObjects.Image | null = null;
  private nextThrow = 0;
  private nightMask: Phaser.GameObjects.Graphics | null = null;
  private mirror = false;
  private unsub: (() => void)[] = [];
  private bot = { stuckSince: 0, lastX: 0 };

  constructor() {
    super('level');
  }

  init(cfg: SceneConfig) {
    // Phaser reuses this instance on scene.restart(): reset every per-run field.
    this.cfg = cfg;
    this.enemies = [];
    this.surfaces = [];
    this.touch = { left: false, right: false, jump: false };
    this.jumpHeldPrev = false;
    this.lastGrounded = -9999;
    this.jumpPressedAt = -9999;
    this.airJumps = 0;
    this.canDoubleJump = false;
    this.shield = false;
    this.effect = null;
    this.deaths = 0;
    this.coins = 0;
    this.ended = false;
    this.dying = false;
    this.lastCause = '';
    this.enemySpeedMul = 1;
    this.liveTimer = 0;
    this.wasGrounded = false;
    this.boss = null;
    this.nextThrow = 0;
    this.nightMask = null;
    this.unsub = [];
    this.bot = { stuckSince: 0, lastX: 0 };
    this.rules = cfg.data.level.rules;
    this.t = tuningFor(this.rules);
    this.mirror = this.rules.some((r) => r.kind === 'mirror_world');
    const tl = this.rules.find((r) => r.kind === 'time_limit');
    this.timeLimit = tl && tl.kind === 'time_limit' ? tl.seconds : null;
    const acc = this.rules.find((r) => r.kind === 'enemies_accelerate');
    this.nextAccel = acc && acc.kind === 'enemies_accelerate' ? acc.everySeconds * 1000 : Infinity;
  }

  preload() {
    const img = this.cfg.data.image;
    if (this.textures.exists('drawing')) return; // restart: already loaded
    // The loader handles data URLs; remote (gallery) images need CORS for canvas reads.
    if (!img.startsWith('data:')) this.load.setCORS('anonymous');
    this.load.image('drawing', img);
  }

  create() {
    const { level, marks } = this.cfg.data;
    const markById = new Map<number, Mark>(marks.map((m) => [m.id, m]));
    const byRole = (role: MarkLabel['role']) =>
      level.labels.filter((l) => l.role === role && markById.has(l.id)).map((l) => ({ label: l, mark: markById.get(l.id)! }));

    this.physics.world.setBounds(0, -400, WORLD.width, WORLD.height + 800);
    this.physics.world.OVERLAP_BIAS = 10;
    this.physics.world.gravity.y = this.t.inverted ? -this.t.gravity : this.t.gravity;

    // ---------- background: the user's drawing, with live marks cut out
    const src = this.textures.get('drawing').getSourceImage() as HTMLImageElement;
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = WORLD.width;
    bgCanvas.height = WORLD.height;
    bgCanvas.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0, WORLD.width, WORLD.height);

    const platformBoxes = byRole('platform').map((p) => p.mark.bbox);
    const cut = (id: number, box: BBox) => {
      const key = `mark-${id}`;
      const sprite = cutOut(bgCanvas, box, platformBoxes); // always erase from this run's background
      if (!this.textures.exists(key)) this.textures.addCanvas(key, sprite);
      return key;
    };
    const live = {
      enemies: byRole('enemy').map((e) => ({ ...e, key: cut(e.label.id, e.mark.bbox) })),
      pickups: [...byRole('collectible'), ...byRole('powerup')].map((e) => ({ ...e, key: cut(e.label.id, e.mark.bbox) })),
      goal: byRole('goal').map((e) => ({ ...e, key: cut(e.label.id, e.mark.bbox) }))[0],
      player: byRole('player')[0],
    };
    if (live.player) cutOut(bgCanvas, live.player.mark.bbox, platformBoxes); // the hero replaces the drawn P
    if (this.textures.exists('bg-live')) this.textures.remove('bg-live');
    this.textures.addCanvas('bg-live', bgCanvas);
    this.add.image(0, 0, 'bg-live').setOrigin(0).setDepth(0);

    // ---------- textures
    if (!this.textures.exists('hero')) this.textures.addCanvas('hero', drawPlayer());
    if (!this.textures.exists('ink-dot')) this.textures.addCanvas('ink-dot', drawDot(5, PALETTE.ink));
    if (!this.textures.exists('accent-dot')) this.textures.addCanvas('accent-dot', drawDot(4, PALETTE.accent));
    if (!this.textures.exists('roti')) this.textures.addCanvas('roti', drawProjectile());
    if (!this.textures.exists('boss')) this.textures.addCanvas('boss', drawBoss());
    if (!this.textures.exists('zone')) this.textures.addCanvas('zone', drawDot(1, '#000000'));

    // ---------- platforms (one-way, from the top: forgiving for sketchy levels)
    this.platforms = this.physics.add.staticGroup();
    this.bouncers = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();
    for (const { mark } of byRole('platform')) {
      const s = surfaceOf(mark);
      this.surfaces.push(s);
      this.addSurfaceBodies(this.platforms, s);
    }
    level.rescue.forEach((r, i) => {
      const s = surfaceOfBox(r.bbox);
      this.surfaces.push(s);
      this.addSurfaceBodies(this.platforms, s);
      const key = `rescue-${i}`;
      const w = r.bbox.w * WORLD.width;
      const h = r.bbox.h * WORLD.height;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, drawRescuePlatform(w, h));
      this.add.image(r.bbox.x * WORLD.width - 4, r.bbox.y * WORLD.height - 4, key).setOrigin(0).setDepth(1);
      this.add
        .text(r.bbox.x * WORLD.width + w / 2, r.bbox.y * WORLD.height + h + 6, 'auto-added ✦', {
          fontFamily: this.cfg.handFont, fontSize: '16px', color: PALETTE.graphite,
        })
        .setOrigin(0.5, 0)
        .setDepth(1);
    });
    for (const { mark } of byRole('bouncy')) this.addSurfaceBodies(this.bouncers, surfaceOf(mark));
    for (const { mark } of byRole('hazard')) {
      const b = mark.bbox;
      const z = this.hazards.create((b.x + b.w / 2) * WORLD.width, (b.y + b.h / 2) * WORLD.height + b.h * WORLD.height * 0.1, 'zone') as Phaser.Physics.Arcade.Sprite;
      z.setVisible(false);
      z.setDisplaySize(Math.max(8, b.w * WORLD.width * 0.8), Math.max(8, b.h * WORLD.height * 0.75));
      z.refreshBody();
      z.setData('what', level.labels.find((l) => l.id === mark.id)?.what ?? 'a hazard');
    }

    // ---------- player
    const spawn = this.spawnPoint();
    this.player = this.physics.add.sprite(spawn.x, spawn.y, 'hero').setDepth(5);
    this.player.setOrigin(0.5, 1);
    this.player.body.setSize(PLAYER_SIZE.w * WORLD.width, PLAYER_SIZE.h * WORLD.height, false);
    this.player.body.setOffset((56 - PLAYER_SIZE.w * WORLD.width) / 2, 64 - PLAYER_SIZE.h * WORLD.height);
    this.player.body.setMaxVelocity(900, 1400);
    this.player.setFlipY(this.t.inverted);
    this.canDoubleJump = false;

    // ---------- goal
    const goalKey = live.goal?.key;
    const gx = level.goal.x * WORLD.width;
    const gy = level.goal.y * WORLD.height;
    if (goalKey && live.goal) {
      this.goal = this.physics.add.staticSprite(gx, gy, goalKey).setOrigin(0.5, 1).setDepth(3);
    } else {
      if (!this.textures.exists('flag')) this.textures.addCanvas('flag', drawFlag());
      this.goal = this.physics.add.staticSprite(gx, gy, 'flag').setOrigin(0.5, 1).setDepth(3);
    }
    this.goal.refreshBody();
    this.tweens.add({ targets: this.goal, angle: { from: -4, to: 4 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    // ---------- pickups
    this.pickups = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const p of live.pickups) {
      const b = p.mark.bbox;
      const s = this.pickups.create((b.x + b.w / 2) * WORLD.width, (b.y + b.h / 2) * WORLD.height, p.key) as Phaser.Physics.Arcade.Sprite;
      s.setDepth(3).setData('role', p.label.role).setData('what', p.label.what);
      this.tweens.add({ targets: s, y: s.y - 8, duration: 700 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // ---------- enemies
    this.enemyGroup = this.physics.add.group();
    for (const e of live.enemies) {
      const b = e.mark.bbox;
      // Spawn a little above the drawn position so it settles onto its line
      // instead of starting embedded in a one-way platform.
      const sprite = this.physics.add.sprite((b.x + b.w / 2) * WORLD.width, (b.y + b.h) * WORLD.height - 24, e.key) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
      sprite.setOrigin(0.5, 1).setDepth(4);
      this.enemyGroup.add(sprite);
      const behaviour = e.label.behaviour ?? 'patrol';
      sprite.body.setSize(sprite.width * 0.8, sprite.height * 0.85, false).setOffset(sprite.width * 0.1, sprite.height * 0.15);
      sprite.body.setAllowGravity(behaviour !== 'fly');
      const dir = e.label.direction === 'left' ? -1 : e.label.direction === 'right' ? 1 : Math.random() < 0.5 ? -1 : 1;
      this.enemies.push({ sprite, label: { ...e.label, behaviour }, dir, originX: sprite.x, originY: sprite.y, phase: Math.random() * 6, nextHop: 0, dead: false });
      if (e.label.personality) {
        const tag = this.add
          .text(sprite.x, sprite.y - sprite.height - 6, `“${e.label.personality}”`, {
            fontFamily: this.cfg.handFont, fontSize: '17px', color: PALETTE.graphite, align: 'center', wordWrap: { width: 220 },
          })
          .setOrigin(0.5, 1)
          .setDepth(6);
        this.tweens.add({ targets: tag, alpha: 0, delay: 3500, duration: 800, onComplete: () => tag.destroy() });
      }
    }

    // ---------- boss
    const boss = this.rules.find((r) => r.kind === 'boss');
    this.projectiles = this.physics.add.group({ allowGravity: false });
    if (boss && boss.kind === 'boss') {
      this.boss = this.add.image(WORLD.width * 0.78, 130, 'boss').setDepth(4).setScale(0.8);
      this.add
        .text(this.boss.x, this.boss.y + 62, boss.name, { fontFamily: this.cfg.handFont, fontSize: '22px', color: PALETTE.hazard })
        .setOrigin(0.5, 0)
        .setDepth(4);
      this.tweens.add({ targets: this.boss, x: { from: WORLD.width * 0.55, to: WORLD.width * 0.9 }, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.nextThrow = 2500;
    }

    // ---------- collisions
    const platformCollider = (obj: Phaser.Types.Physics.Arcade.ArcadeColliderType) => this.physics.add.collider(obj, this.platforms);
    platformCollider(this.player);
    platformCollider(this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.bouncers);
    this.physics.add.collider(this.player, this.bouncers, () => this.onBounce());
    this.physics.add.overlap(this.player, this.hazards, (_p, h) => this.die(`ran into ${(h as Phaser.GameObjects.GameObject).getData('what') ?? 'a hazard'}`));
    this.physics.add.overlap(this.player, this.pickups, (_p, s) => this.collect(s as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.enemyGroup, (_p, e) => this.hitEnemy(e as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody));
    this.physics.add.overlap(this.player, this.projectiles, (_p, pr) => {
      (pr as Phaser.GameObjects.GameObject).destroy();
      const b = this.rules.find((r) => r.kind === 'boss');
      this.die(b && b.kind === 'boss' ? `${b.name} (${b.attack})` : 'a flying thing');
    });
    this.physics.add.overlap(this.player, this.goal, () => this.win());

    // ---------- night mode: darkness with a lantern around the hero
    if (this.rules.some((r) => r.kind === 'night_mode')) {
      const dark = this.add.rectangle(0, 0, WORLD.width, WORLD.height, 0x0b0d14, 0.9).setOrigin(0).setDepth(20);
      this.nightMask = this.make.graphics({}, false);
      const mask = this.nightMask.createGeometryMask();
      mask.setInvertAlpha(true);
      dark.setMask(mask);
    }

    // ---------- input
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: [kb.addKey(K.LEFT), kb.addKey(K.A)],
      right: [kb.addKey(K.RIGHT), kb.addKey(K.D)],
      jump: [kb.addKey(K.SPACE), kb.addKey(K.UP), kb.addKey(K.W)],
    };
    kb.addCapture([K.SPACE, K.UP, K.DOWN, K.LEFT, K.RIGHT]);
    kb.addKey(K.R).on('down', () => this.restartRun());

    const bus = this.cfg.bus;
    this.unsub.push(
      bus.on('touch', (t) => Object.assign(this.touch, t)),
      bus.on('restart', () => this.restartRun()),
      bus.on('giveUp', () => this.end('death')),
    );
    this.events.once('shutdown', () => this.unsub.forEach((u) => u()));

    this.startedAt = this.time.now;
    this.bot.lastX = this.player.x;
    bus.emit('ready');
  }

  /* ---------------- building ---------------- */

  private addSurfaceBodies(group: Phaser.Physics.Arcade.StaticGroup, s: Surface) {
    const x0 = s[0][0] * WORLD.width;
    const x1 = s[s.length - 1][0] * WORLD.width;
    // Merge runs of near-equal height into one body.
    let runStart = x0;
    let runY = (surfaceYAt(s, s[0][0]) ?? s[0][1]) * WORLD.height;
    const flush = (end: number, y: number) => {
      const w = Math.max(STEP, end - runStart);
      const body = group.create(runStart + w / 2, y + 7, 'zone') as Phaser.Physics.Arcade.Sprite;
      body.setVisible(false).setDisplaySize(w, 14).refreshBody();
      const b = body.body as Phaser.Physics.Arcade.StaticBody;
      // One-way: land on top, pass through from below and the sides.
      b.checkCollision.down = this.t.inverted;
      b.checkCollision.up = !this.t.inverted;
      b.checkCollision.left = false;
      b.checkCollision.right = false;
    };
    for (let x = x0 + STEP; x <= x1 + 0.01; x += STEP) {
      const y = (surfaceYAt(s, Math.min(x, x1) / WORLD.width) ?? runY / WORLD.height) * WORLD.height;
      if (Math.abs(y - runY) > 1.5) {
        flush(x, runY);
        runStart = x;
        runY = y;
      }
    }
    flush(x1, runY);
  }

  private spawnPoint() {
    const { spawn } = this.cfg.data.level;
    return { x: spawn.x * WORLD.width, y: spawn.y * WORLD.height - 4 };
  }

  /* ---------------- loop ---------------- */

  update(time: number, delta: number) {
    if (this.ended) return;
    const elapsed = time - this.startedAt;
    const body = this.player.body;
    const grounded = this.t.inverted ? body.blocked.up || body.touching.up : body.blocked.down || body.touching.down;

    // timers & rules
    if (this.timeLimit !== null && elapsed / 1000 >= this.timeLimit) return this.end('timeout');
    if (elapsed >= this.nextAccel) {
      this.enemySpeedMul = Math.min(3, this.enemySpeedMul * 1.15);
      const acc = this.rules.find((r) => r.kind === 'enemies_accelerate');
      this.nextAccel += acc && acc.kind === 'enemies_accelerate' ? acc.everySeconds * 1000 : Infinity;
      this.floatText(this.player.x, this.player.y - 80, 'enemies speed up!', PALETTE.hazard);
    }
    if (this.effect && time > this.effect.until) this.clearEffect();

    if (!this.dying) {
      // input
      let left = this.keys.left.some((k) => k.isDown) || this.touch.left;
      let right = this.keys.right.some((k) => k.isDown) || this.touch.right;
      let jumpHeld = this.keys.jump.some((k) => k.isDown) || this.touch.jump;
      if (this.cfg.autoplay) ({ left, right, jumpHeld } = this.botInput(time, grounded));
      if (this.mirror) [left, right] = [right, left];

      const speed = this.t.runSpeed * (this.effect?.kind === 'speed_boost' ? 1.5 : 1);
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      const accel = grounded ? 0.35 : 0.2;
      body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target * speed, accel));
      if (target !== 0) this.player.setFlipX(target < 0);

      if (grounded) {
        this.lastGrounded = time;
        this.airJumps = 0;
      }
      const jumpPressed = jumpHeld && !this.jumpHeldPrev;
      if (jumpPressed) this.jumpPressedAt = time;
      const sign = this.t.inverted ? 1 : -1;
      const canCoyote = time - this.lastGrounded <= BASE.coyoteMs;
      const buffered = time - this.jumpPressedAt <= BASE.jumpBufferMs;
      if (buffered && canCoyote) {
        this.jump(sign * this.t.jumpVelocity);
      } else if (jumpPressed && !canCoyote && this.canDoubleJump && this.airJumps < 1) {
        this.airJumps++;
        this.jump(sign * this.t.jumpVelocity * 0.9);
        this.burst(this.player.x, this.player.y, 'accent-dot', 6);
      }
      // variable jump height: release early → shorter hop
      if (!jumpHeld && this.jumpHeldPrev && body.velocity.y * sign > 0) body.setVelocityY(body.velocity.y * 0.5);
      this.jumpHeldPrev = jumpHeld;

      // landing squash
      if (grounded && !this.wasGrounded) {
        this.squash(1.25, 0.78, 90);
        this.burst(this.player.x, this.player.y, 'ink-dot', 4, 0.35);
      }
      this.wasGrounded = grounded;

      // fell off the page
      if (this.player.y > WORLD.height + 120 || this.player.y < -260) this.die('fell off the page');
    }

    this.updateEnemies(time, elapsed);
    this.updateBoss(elapsed);
    if (this.nightMask) {
      this.nightMask.clear();
      this.nightMask.fillStyle(0xffffff);
      this.nightMask.fillCircle(this.player.x, this.player.y - 24, 170);
    }

    this.liveTimer += delta;
    if (this.liveTimer > 200) {
      this.liveTimer = 0;
      this.cfg.bus.emit('live', {
        deaths: this.deaths,
        coins: this.coins,
        timeSeconds: elapsed / 1000,
        timeLeft: this.timeLimit !== null ? Math.max(0, this.timeLimit - elapsed / 1000) : null,
        effect: this.effect?.kind ?? (this.shield ? 'shield' : this.canDoubleJump ? 'double_jump' : null),
      });
    }
  }

  private jump(vy: number) {
    this.player.body.setVelocityY(vy);
    this.lastGrounded = -9999;
    this.jumpPressedAt = -9999;
    this.squash(0.75, 1.3, 110);
    play('jump');
  }

  private squash(sx: number, sy: number, ms: number) {
    const base = this.sizeScale();
    this.tweens.killTweensOf(this.player);
    this.player.setScale(base * sx, base * sy);
    this.tweens.add({ targets: this.player, scaleX: base, scaleY: base, duration: ms * 2, ease: 'Back.out' });
  }

  private sizeScale() {
    return this.effect?.kind === 'tiny' ? 0.6 : this.effect?.kind === 'giant' ? 1.5 : 1;
  }

  private updateEnemies(time: number, elapsed: number) {
    const speed = this.t.enemySpeed * this.enemySpeedMul;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const s = e.sprite;
      const b = s.body;
      switch (e.label.behaviour) {
        case 'static':
          b.setVelocityX(0);
          break;
        case 'fly':
          b.setVelocity(e.dir * speed * 0.8, Math.cos(elapsed / 420 + e.phase) * 90);
          if (Math.abs(s.x - e.originX) > 160) e.dir = s.x > e.originX ? -1 : 1;
          break;
        case 'jump':
          b.setVelocityX(e.dir * speed * 0.6);
          if (b.blocked.down && time > e.nextHop) {
            b.setVelocityY(-560);
            e.nextHop = time + 1400 + Math.random() * 900;
          }
          this.turnAtEdges(e);
          break;
        case 'chase': {
          const dx = this.player.x - s.x;
          if (Math.abs(dx) < 460 && Math.abs(this.player.y - s.y) < 260 && !this.dying) {
            e.dir = Math.sign(dx) || e.dir;
            b.setVelocityX(e.dir * speed * 1.35);
          } else {
            b.setVelocityX(e.dir * speed * 0.7);
            this.turnAtEdges(e);
          }
          break;
        }
        default:
          b.setVelocityX(e.dir * speed);
          this.turnAtEdges(e);
      }
      s.setFlipX(e.dir > 0 === (e.label.direction === 'left'));
      if (s.y > WORLD.height + 200) e.dead = true;
    }
  }

  /** Patrollers turn around at platform edges instead of walking off. */
  private turnAtEdges(e: Enemy) {
    const s = e.sprite;
    if (!s.body.blocked.down && !s.body.touching.down) return;
    const aheadX = (s.x + e.dir * (s.width / 2 + 8)) / WORLD.width;
    const footY = s.y / WORLD.height;
    const ground = this.surfaces.some((surf) => {
      const y = surfaceYAt(surf, aheadX);
      return y !== null && Math.abs(y - footY) < 0.05;
    });
    if (!ground || s.x < 20 || s.x > WORLD.width - 20 || s.body.blocked.left || s.body.blocked.right) e.dir *= -1;
  }

  private updateBoss(elapsed: number) {
    if (!this.boss || elapsed < this.nextThrow || this.dying) return;
    this.nextThrow = elapsed + 2200;
    const p = this.projectiles.create(this.boss.x, this.boss.y + 30, 'roti') as Phaser.Physics.Arcade.Sprite;
    const angle = Phaser.Math.Angle.Between(p.x, p.y, this.player.x, this.player.y - 20);
    const v = 260 + Math.min(200, elapsed / 300);
    p.setVelocity(Math.cos(angle) * v, Math.sin(angle) * v);
    p.setAngularVelocity(240).setDepth(6);
    this.time.delayedCall(6000, () => p.destroy());
  }

  /* ---------------- interactions ---------------- */

  private onBounce() {
    const body = this.player.body;
    const landed = this.t.inverted ? body.touching.up : body.touching.down;
    if (!landed) return;
    body.setVelocityY((this.t.inverted ? 1 : -1) * BASE.bounceVelocity * Math.sqrt(this.t.gravity / BASE.gravity));
    this.squash(0.7, 1.4, 140);
    play('bounce');
  }

  private collect(s: Phaser.Physics.Arcade.Sprite) {
    if (!s.active) return;
    const role = s.getData('role') as string;
    s.disableBody(true, false);
    this.tweens.add({ targets: s, scale: 1.6, alpha: 0, y: s.y - 30, duration: 260, onComplete: () => s.destroy() });
    this.burst(s.x, s.y, 'accent-dot', 10);
    play('coin');
    if (role === 'collectible') this.coins++;
    const rule = this.rules.find((r) => r.kind === 'collectible_effect');
    const effect = rule && rule.kind === 'collectible_effect' ? rule.effect : role === 'powerup' ? 'speed_boost' : null;
    if (!effect) return;
    const now = this.time.now;
    if (effect === 'double_jump') this.canDoubleJump = true;
    else if (effect === 'shield') this.shield = true;
    else this.effect = { kind: effect, until: now + (effect === 'speed_boost' ? 5000 : 8000) };
    if (this.shield) this.player.setTint(hex(PALETTE.accent));
    if (effect === 'tiny' || effect === 'giant') this.player.setScale(this.sizeScale());
    this.floatText(s.x, s.y - 30, effect.replace('_', ' ') + '!', PALETTE.ink);
  }

  private clearEffect() {
    const wasSize = this.effect?.kind === 'tiny' || this.effect?.kind === 'giant';
    this.effect = null;
    if (wasSize) this.player.setScale(1);
  }

  private hitEnemy(sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody) {
    const e = this.enemies.find((x) => x.sprite === sprite);
    if (!e || e.dead || this.dying) return;
    const pb = this.player.body;
    const stomp = this.t.inverted ? pb.velocity.y < 0 && pb.top > sprite.body.bottom - 18 : pb.velocity.y > 0 && pb.bottom < sprite.body.top + 18;
    if (stomp) {
      e.dead = true;
      sprite.body.enable = false;
      this.tweens.add({ targets: sprite, scaleY: 0.2, alpha: 0, duration: 250, onComplete: () => sprite.destroy() });
      pb.setVelocityY((this.t.inverted ? 1 : -1) * this.t.jumpVelocity * 0.6);
      this.burst(sprite.x, sprite.y - 10, 'ink-dot', 8);
      play('stomp');
      return;
    }
    this.die(`got caught by ${e.label.what}`);
  }

  private die(cause: string) {
    if (this.dying || this.ended) return;
    if (this.shield) {
      this.shield = false;
      this.player.clearTint();
      this.player.body.setVelocityY((this.t.inverted ? 1 : -1) * this.t.jumpVelocity * 0.7);
      this.floatText(this.player.x, this.player.y - 70, 'shield saved you!', PALETTE.ink);
      return;
    }
    this.dying = true;
    this.deaths++;
    this.lastCause = cause;
    play('death');
    this.cameras.main.shake(180, 0.008);
    this.burst(this.player.x, this.player.y - 20, 'ink-dot', 22, 1);
    this.player.setVisible(false);
    this.player.body.enable = false;
    if (this.deaths >= MAX_DEATHS) {
      this.time.delayedCall(500, () => this.end('death'));
      return;
    }
    this.time.delayedCall(650, () => this.respawn());
  }

  private respawn() {
    const p = this.spawnPoint();
    this.player.body.enable = true;
    this.player.body.reset(p.x, p.y);
    this.player.setVisible(true).setAlpha(0.4).setScale(1);
    this.tweens.add({ targets: this.player, alpha: 1, duration: 400 });
    this.clearEffect();
    this.dying = false;
    this.wasGrounded = false;
  }

  private restartRun() {
    this.cfg.bus.emit('live', { deaths: 0, coins: 0, timeSeconds: 0, timeLeft: this.timeLimit, effect: null });
    this.scene.restart(this.cfg);
  }

  private win() {
    if (this.ended || this.dying) return;
    play('win');
    this.burst(this.goal.x, this.goal.y - 40, 'accent-dot', 30, 1.4);
    this.end('win');
  }

  private end(result: RunStats['result']) {
    if (this.ended) return;
    this.ended = true;
    this.physics.pause();
    const stats: RunStats = {
      result,
      deaths: this.deaths,
      timeSeconds: Math.round(((this.time.now - this.startedAt) / 1000) * 10) / 10,
      coins: this.coins,
      ...(this.lastCause ? { causeOfDeath: this.lastCause.slice(0, 80) } : {}),
    };
    if (this.cfg.autoplay) {
      this.time.delayedCall(1200, () => this.scene.restart(this.cfg));
      return;
    }
    this.cfg.bus.emit('end', stats);
  }

  /* ---------------- juice ---------------- */

  private burst(x: number, y: number, key: string, n: number, power = 0.6) {
    const em = this.add.particles(x, y, key, {
      speed: { min: 60 * power, max: 380 * power },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: { min: 250, max: 650 },
      gravityY: 600,
      emitting: false,
    });
    em.setDepth(8);
    em.explode(n);
    this.time.delayedCall(800, () => em.destroy());
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontFamily: this.cfg.handFont, fontSize: '26px', color }).setOrigin(0.5).setDepth(9);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1100, ease: 'Sine.out', onComplete: () => t.destroy() });
  }

  /* ---------------- demo bot ---------------- */

  private botInput(time: number, grounded: boolean) {
    const goalX = this.goal.x;
    const dir = goalX > this.player.x ? 1 : -1;
    const aheadX = (this.player.x + dir * 50) / WORLD.width;
    const footY = this.player.y / WORLD.height;
    const groundAhead = this.surfaces.some((s) => {
      const y = surfaceYAt(s, aheadX);
      return y !== null && y >= footY - 0.02 && y - footY < 0.08;
    });
    const hazardAhead = this.hazards.getChildren().some((h) => {
      const hb = (h as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.StaticBody;
      return Math.abs(hb.center.x - (this.player.x + dir * 90)) < hb.halfWidth + 30 && Math.abs(hb.center.y - this.player.y) < 80;
    });
    if (Math.abs(this.player.x - this.bot.lastX) > 4) {
      this.bot.lastX = this.player.x;
      this.bot.stuckSince = time;
    }
    const stuck = time - this.bot.stuckSince > 500;
    const higher = this.goal.y < this.player.y - 60 && Math.abs(goalX - this.player.x) < 380;
    const jumpHeld = grounded && (!groundAhead || hazardAhead || stuck || higher || Math.random() < 0.01);
    return { left: dir < 0, right: dir > 0, jumpHeld };
  }
}

function drawFlag(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 60;
  c.height = 110;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, 108);
  ctx.lineTo(10, 6);
  ctx.stroke();
  ctx.fillStyle = PALETTE.accent;
  ctx.beginPath();
  ctx.moveTo(10, 8);
  ctx.lineTo(56, 22);
  ctx.lineTo(10, 38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return c;
}
