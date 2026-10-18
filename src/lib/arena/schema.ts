import { z } from 'zod';

/**
 * Multiplayer arena maps. Like platformer levels, maps are data, never code:
 * Gemma may only emit platforms, spawns, pickups and whitelisted rules, and
 * everything is clamped here (shared by the server route and the client, so a
 * map received over the wire is re-validated before it is played).
 */

/** Arena world in px (16:9, bigger than one screen: the camera follows you). */
export const ARENA_WORLD = { width: 2400, height: 1350 } as const;

export const MAX_PLATFORMS = 40;
export const MAX_SPAWNS = 8;
export const MIN_SPAWNS = 4;
export const MAX_PICKUPS = 14;
export const MAX_HAZARDS = 10;

export const WEAPON_PICKUPS = ['rifle', 'flamethrower', 'chainsaw', 'rockets', 'grenades'] as const;
export const BUFF_PICKUPS = ['shield', 'speed', 'double_jump', 'jetfuel', 'damage'] as const;
export const PICKUPS = ['health', 'ammo', ...WEAPON_PICKUPS, ...BUFF_PICKUPS] as const;
export type PickupKind = (typeof PICKUPS)[number];

/** Near-misses the model writes, mapped onto the whitelist. */
const PICKUP_ALIASES: Record<string, PickupKind> = {
  gun: 'rifle', sniper: 'rifle', enhanced_gun: 'rifle', flame: 'flamethrower', fire: 'flamethrower',
  saw: 'chainsaw', rocket: 'rockets', rocket_launcher: 'rockets', grenade: 'grenades', bomb: 'grenades',
  armor: 'shield', armour: 'shield', boots: 'speed', speed_boost: 'speed', jump: 'double_jump',
  fuel: 'jetfuel', jetpack: 'jetfuel', power: 'damage', damage_boost: 'damage', medkit: 'health', heart: 'health',
};
export function toPickupKind(v: unknown): PickupKind | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (PICKUPS as readonly string[]).includes(k) ? (k as PickupKind) : PICKUP_ALIASES[k] ?? null;
}

export const HAZARDS = ['lava', 'water', 'spikes'] as const;
export type HazardKind = (typeof HAZARDS)[number];

export const ENEMY_KINDS = ['walker', 'flyer', 'turret'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];
export const MAX_ENEMIES = 8;

/** What the map maker asks for. Gemma gets it as constraints; applyOptions enforces it. */
export const MapOptionsSchema = z.object({
  enemies: z.number().int().min(0).max(MAX_ENEMIES).default(3),
  pickups: z.enum(['few', 'normal', 'lots']).default('normal'),
  weapons: z.boolean().default(true),
  buffs: z.boolean().default(true),
  lava: z.boolean().default(true),
  water: z.boolean().default(true),
  spikes: z.boolean().default(true),
  crumble: z.boolean().default(true),
});
export type MapOptions = z.infer<typeof MapOptionsSchema>;
export const DEFAULT_OPTIONS: MapOptions = MapOptionsSchema.parse({});

export const ArenaRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gravity'), value: z.number() }),
  z.object({ kind: z.literal('jetpack_power'), value: z.number() }),
  z.object({ kind: z.literal('fire_rate'), value: z.number() }),
  z.object({ kind: z.literal('bullet_damage'), value: z.number() }),
  z.object({ kind: z.literal('night_mode') }),
]);
export type ArenaRule = z.infer<typeof ArenaRuleSchema>;

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
/** A platform; `crumble` ones fall away shortly after someone stands on them, then grow back. */
const Platform = Rect.extend({ crumble: z.boolean().optional() });
/** Lava burns, spikes stab; water slows you, lifts you and `flow` (-1..1) pushes you sideways. */
const Hazard = Rect.extend({ kind: z.enum(HAZARDS), flow: z.number().optional() });
const Point = z.object({ x: z.number(), y: z.number() });
const Enemy = Point.extend({ kind: z.enum(ENEMY_KINDS) });
export type Enemy = z.infer<typeof Enemy>;
export type Hazard = z.infer<typeof Hazard>;
export type Platform = z.infer<typeof Platform>;

/** Strict, final shape (normalized 0-1 coords, origin top-left). */
export const ArenaMapSchema = z.object({
  title: z.string().max(60),
  story: z.string().max(240),
  platforms: z.array(Platform).min(1).max(MAX_PLATFORMS + 1),
  hazards: z.array(Hazard).max(MAX_HAZARDS).default([]),
  enemies: z.array(Enemy).max(MAX_ENEMIES).default([]),
  spawns: z.array(Point).min(1).max(MAX_SPAWNS),
  pickups: z.array(Point.extend({ kind: z.enum(PICKUPS) })).max(MAX_PICKUPS),
  rules: z.array(ArenaRuleSchema).max(5),
  /** Sample drawing to show faintly behind the platforms (only /public/samples ids). */
  sampleId: z.string().regex(/^[0-9a-z-]{1,40}$/).optional(),
  /** The cleaned drawing (small JPEG data URL) so the backdrop lines up with the marks. */
  backdrop: z.string().max(160_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).optional(),
  seed: z.number().int(),
});
export type ArenaMap = z.infer<typeof ArenaMapSchema>;

export type ArenaMapResponse = { map: ArenaMap; source: 'model' | 'procedural'; ms: number; note?: string };

/* ---------- lenient model-output parsing ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().finite());
const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ');
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

function toRect(raw: unknown): Platform | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const [x, y, w, h] = [r.x, r.y, r.w ?? r.width, r.h ?? r.height].map((v) => num.safeParse(v));
  if (!x.success || !y.success || !w.success || !h.success) return null;
  return { x: x.data, y: y.data, w: w.data, h: h.data, ...(r.crumble === true || r.kind === 'crumble' ? { crumble: true } : {}) };
}

function toHazard(raw: unknown): Hazard | null {
  const rect = toRect(raw);
  if (!rect) return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === 'string' ? r.kind.trim().toLowerCase() : '';
  const k: HazardKind | null = /spike|thorn|zigzag|saw|cactus/.test(kind) ? 'spikes' : /lava|fire|acid|magma/.test(kind) ? 'lava' : /water|river|pool|flow|sea/.test(kind) ? 'water' : null;
  if (!k) return null;
  const flow = num.safeParse(r.flow);
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, kind: k, ...(k === 'water' && flow.success ? { flow: flow.data } : {}) };
}

function toEnemy(raw: unknown): Enemy | null {
  const pt = toPoint(raw);
  if (!pt) return null;
  const k = String((raw as Record<string, unknown>).kind ?? '').toLowerCase();
  const kind: EnemyKind = /fly|drone|bird|bat|ghost/.test(k) ? 'flyer' : /turret|tower|cannon|gun/.test(k) ? 'turret' : 'walker';
  return { ...pt, kind };
}

/** The bits of a map Gemma can add (theme mode, or "extras" around a drawing). */
const PieceArrays = {
  platforms: z.array(z.unknown()).catch([]),
  hazards: z.array(z.unknown()).catch([]),
  spawns: z.array(z.unknown()).catch([]),
  pickups: z.array(z.unknown()).catch([]),
  enemies: z.array(z.unknown()).catch([]),
};
type Pieces = Pick<DraftArena, 'platforms' | 'hazards' | 'spawns' | 'pickups' | 'enemies'>;
function toPieces(o: { [K in keyof typeof PieceArrays]: unknown[] }): Pieces {
  return {
    platforms: o.platforms.map(toRect).filter((r) => r !== null),
    hazards: o.hazards.map(toHazard).filter((h) => h !== null),
    spawns: o.spawns.map(toPoint).filter((p) => p !== null),
    pickups: o.pickups
      .map((p) => {
        const pt = toPoint(p);
        const kind = toPickupKind((p as { kind?: unknown })?.kind);
        return pt && kind ? { ...pt, kind } : null;
      })
      .filter((p) => p !== null),
    enemies: o.enemies.map(toEnemy).filter((e) => e !== null),
  };
}

function toPoint(raw: unknown): z.infer<typeof Point> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const x = num.safeParse(r.x);
  const y = num.safeParse(r.y);
  return x.success && y.success ? { x: x.data, y: y.data } : null;
}

export function normalizeArenaRule(raw: unknown): ArenaRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.kind === 'string') r.kind = r.kind.trim().toLowerCase();
  if ('value' in r) {
    const n = num.safeParse(r.value);
    if (!n.success) return null;
    r.value = n.data;
  }
  const parsed = ArenaRuleSchema.safeParse(r);
  if (!parsed.success) return null;
  const rule = parsed.data;
  switch (rule.kind) {
    case 'gravity': return { ...rule, value: clamp(rule.value, 0.4, 1.6) };
    case 'jetpack_power': return { ...rule, value: clamp(rule.value, 0.5, 2) };
    case 'fire_rate': return { ...rule, value: clamp(rule.value, 0.5, 2) };
    case 'bullet_damage': return { ...rule, value: clamp(rule.value, 0.5, 2) };
    default: return rule;
  }
}

export type DraftArena = {
  title: string;
  story: string;
  platforms: Platform[];
  hazards: Hazard[];
  enemies: Enemy[];
  spawns: z.infer<typeof Point>[];
  pickups: (z.infer<typeof Point> & { kind: PickupKind })[];
  rules: ArenaRule[];
};

/** What Gemma returns when designing a map from a theme (or nothing). */
export const ArenaFromModel = z
  .object({
    title: z.unknown(),
    story: z.unknown(),
    ...PieceArrays,
    platforms: z.array(z.unknown()),
    rules: z.array(z.unknown()).catch([]),
  })
  .transform((o): DraftArena => ({
    title: words(str(o.title, 'Ink Arena'), 5),
    story: str(o.story, 'Everyone brought a pen. Nobody brought a plan.').slice(0, 200),
    ...toPieces(o),
    rules: o.rules.map(normalizeArenaRule).filter((r) => r !== null),
  }))
  .refine((d) => d.platforms.length >= 3, { message: 'platforms must contain at least 3 valid {x,y,w,h} rects', path: ['platforms'] });

/** Gemma's answer when it turns a drawing's numbered marks into an arena. */
export const ARENA_ROLES = ['platform', 'crumble', 'spikes', 'lava', 'water', 'enemy', 'spawn', 'health', 'ammo', 'weapon', 'buff', 'decoration'] as const;
export const ArenaLabelsFromModel = z
  .object({
    title: z.unknown(),
    story: z.unknown(),
    labels: z.array(z.unknown()),
    rules: z.array(z.unknown()).catch([]),
    /** More pieces in the same spirit, so the map isn't limited to what was drawn. */
    extras: z.object(PieceArrays).catch({ platforms: [], hazards: [], spawns: [], pickups: [], enemies: [] }).default({ platforms: [], hazards: [], spawns: [], pickups: [], enemies: [] }),
  })
  .transform((o) => ({
    title: words(str(o.title, 'Doodle Warzone'), 5),
    story: str(o.story, 'Your drawing just became a battlefield.').slice(0, 200),
    labels: o.labels
      .map((l) => {
        if (!l || typeof l !== 'object') return null;
        const r = l as Record<string, unknown>;
        const id = num.safeParse(typeof r.id === 'string' ? r.id.replace(/^#/, '') : r.id);
        const role = typeof r.role === 'string' ? r.role.trim().toLowerCase() : '';
        if (!id.success) return null;
        const alias: Record<string, (typeof ARENA_ROLES)[number]> = { hazard: 'spikes', spike: 'spikes', zigzag: 'spikes', monster: 'enemy', pickup: 'buff', powerup: 'buff', gun: 'weapon' };
        return { id: Math.round(id.data), role: (ARENA_ROLES as readonly string[]).includes(role) ? (role as (typeof ARENA_ROLES)[number]) : alias[role] ?? 'platform' };
      })
      .filter((l) => l !== null),
    rules: o.rules.map(normalizeArenaRule).filter((r) => r !== null),
    extras: toPieces(o.extras),
  }))
  .refine((d) => d.labels.length > 0, { message: 'labels must label the numbered marks', path: ['labels'] });

/* ---------- clamping + playability ---------- */

/** Player box in normalized coords (matches ArenaScene). */
const PW = 30 / ARENA_WORLD.width;
const PH = 44 / ARENA_WORLD.height;

const overlaps = (a: z.infer<typeof Rect>, b: z.infer<typeof Rect>) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Deterministic PRNG so the same seed gives the same map on every client. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clamp every number, guarantee a floor, and make sure there are at least
 * MIN_SPAWNS spread-out spawn points standing on top of platforms.
 */
export function finalizeArena(d: DraftArena, seed: number, sampleId?: string): ArenaMap {
  const platforms: Platform[] = d.platforms
    .map((r) => {
      const w = clamp(r.w, 0.02, 0.7);
      const h = clamp(r.h, 0.012, 0.2);
      return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0.08, 1 - h), w, h, ...(r.crumble ? { crumble: true } : {}) };
    })
    .slice(0, MAX_PLATFORMS);

  // A solid floor so nobody falls forever (the world bounds also stop you).
  const isFloor = (p: z.infer<typeof Rect>) => p.y + p.h > 0.9 && p.w > 0.35;
  for (const p of platforms) if (isFloor(p)) delete p.crumble;
  if (!platforms.some(isFloor)) platforms.push({ x: 0, y: 0.955, w: 1, h: 0.045 });

  const hazards: Hazard[] = d.hazards.slice(0, MAX_HAZARDS).map((hz) => {
    // lava pits stay pits, not a whole floor of lava
    const w = clamp(hz.w, 0.03, hz.kind === 'lava' ? 0.32 : 1);
    const h = clamp(hz.h, 0.015, hz.kind === 'water' ? 0.35 : 0.06);
    const cx = hz.x + hz.w / 2;
    const out: Hazard = { x: clamp(hz.kind === 'lava' ? cx - w / 2 : hz.x, 0, 1 - w), y: clamp(hz.y, 0.1, 1 - h), w, h, kind: hz.kind };
    if (hz.kind === 'water') out.flow = clamp(hz.flow ?? 0, -1, 1);
    return reachable(out, platforms);
  });
  const lava = hazards.filter((hz) => hz.kind !== 'water');

  const free = (pt: { x: number; y: number }) => {
    const box = { x: pt.x - PW / 2, y: pt.y - PH, w: PW, h: PH };
    return box.x >= 0 && box.x + box.w <= 1 && box.y >= 0 && !platforms.some((p) => overlaps(box, p)) && !lava.some((l) => overlaps(box, l));
  };
  /** Drop a point straight down onto the first platform top below it. */
  const land = (pt: { x: number; y: number }) => {
    const x = clamp(pt.x, PW, 1 - PW);
    const under = platforms
      .filter((p) => x >= p.x && x <= p.x + p.w && p.y >= pt.y - 0.02)
      .sort((a, b) => a.y - b.y)[0];
    return under ? { x, y: under.y - 0.002 } : { x, y: 0.95 };
  };

  const spawns: { x: number; y: number }[] = [];
  const farEnough = (pt: { x: number; y: number }) => spawns.every((s) => Math.hypot(s.x - pt.x, (s.y - pt.y) * 0.56) > 0.12);
  for (const s of d.spawns) {
    const pt = land({ x: clamp(s.x, 0, 1), y: clamp(s.y, 0, 1) });
    if (free(pt) && farEnough(pt) && spawns.length < MAX_SPAWNS) spawns.push(pt);
  }
  // Top up with platform tops, widest first, spread across the map.
  const rand = mulberry32(seed ^ 0x5eed);
  const tops = [...platforms].filter((p) => !p.crumble).sort((a, b) => b.w - a.w);
  for (let tries = 0; spawns.length < MIN_SPAWNS && tries < 200; tries++) {
    const p = tops[tries % tops.length];
    const pt = { x: p.x + PW + rand() * Math.max(0, p.w - 2 * PW), y: p.y - 0.002 };
    if (free(pt) && (farEnough(pt) || tries > 120)) spawns.push(pt);
  }
  if (spawns.length === 0) spawns.push({ x: 0.5, y: 0.95 });

  const pickups = d.pickups
    .slice(0, MAX_PICKUPS)
    .map((p) => ({ ...land({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }), kind: p.kind }))
    .filter(free);

  const enemies: Enemy[] = d.enemies.slice(0, MAX_ENEMIES).map((e) => {
    const pt = { x: clamp(e.x, 0.03, 0.97), y: clamp(e.y, 0.1, 0.95) };
    return e.kind === 'flyer' ? { ...pt, kind: e.kind } : { ...land(pt), kind: e.kind };
  });

  const seen = new Set<string>();
  const rules = d.rules.filter((r) => (seen.has(r.kind) ? false : (seen.add(r.kind), true)));

  return {
    title: words(d.title, 5).slice(0, 60) || 'Ink Arena',
    story: d.story.slice(0, 240),
    platforms,
    hazards,
    enemies,
    spawns,
    pickups,
    rules,
    ...(sampleId ? { sampleId } : {}),
    seed: Math.trunc(seed),
  };
}

/** Re-validate a map that came over the network (another player's client). */
export function parseWireMap(raw: unknown): ArenaMap | null {
  const r = ArenaMapSchema.safeParse(raw);
  if (!r.success) return null;
  const m = r.data;
  const out = finalizeArena({ ...m, rules: m.rules.map(normalizeArenaRule).filter((x) => x !== null) }, m.seed, m.sampleId);
  return m.backdrop ? { ...out, backdrop: m.backdrop } : out;
}

/** Derived tuning (multipliers on ArenaScene's base numbers). */
export function arenaTuning(rules: ArenaRule[]) {
  const t = { gravity: 1, jetpack: 1, fireRate: 1, damage: 1, night: false };
  for (const r of rules) {
    if (r.kind === 'gravity') t.gravity = r.value;
    if (r.kind === 'jetpack_power') t.jetpack = r.value;
    if (r.kind === 'fire_rate') t.fireRate = r.value;
    if (r.kind === 'bullet_damage') t.damage = r.value;
    if (r.kind === 'night_mode') t.night = true;
  }
  return t;
}

/**
 * A hazard nobody can touch is pointless (Gemma put lava *under* the floor).
 * Lava and spikes rest on the surface below them; then anything a solid
 * platform covers (no head-room for a player above it) is lifted on top.
 */
function reachable(hz: Hazard, platforms: Platform[]): Hazard {
  const solid = platforms.filter((p) => !p.crumble);
  const under = (p: Platform) => Math.min(p.x + p.w, hz.x + hz.w) - Math.max(p.x, hz.x) > Math.min(hz.w, p.w) * 0.3;
  const out = { ...hz };
  if (out.kind !== 'water') {
    const below = solid.filter((p) => under(p) && p.y >= out.y + out.h * 0.5).sort((a, b) => a.y - b.y)[0];
    out.y = below ? below.y - out.h : 1 - out.h;
  }
  for (let i = 0; i < 4; i++) {
    const room = { x: out.x, y: out.y - PH * 1.5, w: out.w, h: out.h + PH * 1.5 };
    const cover = solid.filter((p) => under(p) && overlaps(room, p) && p.y < out.y + out.h - 0.002).sort((a, b) => a.y - b.y)[0];
    if (!cover) break;
    out.y = cover.y - out.h;
  }
  out.y = clamp(out.y, 0.1, 1 - out.h);
  return out;
}

/* ---------- options + "more like this" ---------- */

const PICKUP_COUNT = { few: 5, normal: 9, lots: 14 } as const;

/**
 * Enforce what the map maker asked for, whatever the model did: drop
 * disallowed kinds, then top up enemies, pickups and hazards to match.
 */
export function applyOptions(d: DraftArena, o: MapOptions, seed: number): DraftArena {
  const r = mulberry32(seed ^ 0xa11ce);
  const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const allowedHazard = (k: HazardKind) => o[k];
  const kinds: PickupKind[] = ['health', 'ammo', ...(o.weapons ? WEAPON_PICKUPS : []), ...(o.buffs ? BUFF_PICKUPS : [])];
  const solid = d.platforms.filter((p) => !p.crumble && p.w >= 0.05);
  const onTop = (): { x: number; y: number } => {
    const p = pickOne(solid.length ? solid : d.platforms);
    return p ? { x: p.x + 0.02 + r() * Math.max(0, p.w - 0.04), y: p.y } : { x: r(), y: 0.95 };
  };

  const out: DraftArena = {
    ...d,
    platforms: d.platforms.map((p) => (o.crumble ? p : { ...p, crumble: undefined })),
    hazards: d.hazards.filter((h) => allowedHazard(h.kind)),
    pickups: d.pickups.filter((p) => kinds.includes(p.kind)),
    enemies: d.enemies.slice(0, o.enemies),
  };
  // some crumbling ledges if wanted and none were drawn
  if (o.crumble && !out.platforms.some((p) => p.crumble)) {
    const small = out.platforms.filter((p) => p.y < 0.85 && p.w < 0.25);
    for (const p of small.slice(0, 3)) p.crumble = true;
  }
  while (out.enemies.length < o.enemies) {
    const kind = pickOne(ENEMY_KINDS);
    out.enemies.push(kind === 'flyer' ? { x: 0.1 + r() * 0.8, y: 0.15 + r() * 0.4, kind } : { ...onTop(), kind });
  }
  const want = PICKUP_COUNT[o.pickups];
  out.pickups = out.pickups.slice(0, want);
  // guarantee variety: at least one weapon / buff crate when enabled
  if (o.weapons && !out.pickups.some((p) => (WEAPON_PICKUPS as readonly string[]).includes(p.kind))) out.pickups.push({ ...onTop(), kind: pickOne(WEAPON_PICKUPS) });
  if (o.buffs && !out.pickups.some((p) => (BUFF_PICKUPS as readonly string[]).includes(p.kind))) out.pickups.push({ ...onTop(), kind: pickOne(BUFF_PICKUPS) });
  while (out.pickups.length < want) out.pickups.push({ ...onTop(), kind: pickOne(kinds) });

  const has = (k: HazardKind) => out.hazards.some((h) => h.kind === k);
  if (o.lava && !has('lava')) {
    const pit = { x: 0.4 + r() * 0.05, y: 0.93, w: 0.12 + r() * 0.06, h: 0.026 };
    if (!out.hazards.some((h) => overlaps(h, pit))) out.hazards.push({ ...pit, kind: 'lava' });
  }
  if (o.spikes && !has('spikes')) {
    const p = pickOne(solid.filter((q) => q.w > 0.1 && q.y < 0.9));
    if (p) out.hazards.push({ x: p.x + p.w * 0.3, y: p.y - 0.022, w: Math.min(0.08, p.w * 0.4), h: 0.022, kind: 'spikes' });
  }
  if (o.water && !has('water')) {
    // a stream on whichever side doesn't already have a hazard
    const sides = r() < 0.5 ? [true, false] : [false, true];
    for (const left of sides) {
      const pool = { x: left ? 0 : 0.8, y: 0.8, w: 0.2, h: 0.155 };
      if (out.hazards.some((h) => overlaps(h, pool))) continue;
      out.hazards.push({ ...pool, kind: 'water', flow: left ? 0.6 : -0.6 });
      break;
    }
  }
  return out;
}

/**
 * A drawing only covers part of the page: mirror what was drawn into the
 * emptier half and fill empty regions with ledges in the same spirit, so an
 * upload grows into a full arena instead of being limited to it.
 */
export function growDrawing(d: DraftArena, seed: number): DraftArena {
  const r = mulberry32(seed ^ 0x9e0);
  const platforms = [...d.platforms];
  const hazards = [...d.hazards];
  const clash = (a: { x: number; y: number; w: number; h: number }) =>
    platforms.some((p) => a.x < p.x + p.w + 0.03 && a.x + a.w > p.x - 0.03 && a.y < p.y + p.h + 0.05 && a.y + a.h > p.y - 0.05);
  // mirror left/right
  for (const p of d.platforms) {
    const m = { ...p, x: 1 - p.x - p.w };
    if (Math.abs(m.x - p.x) > 0.08 && !clash(m)) platforms.push(m);
  }
  for (const h of d.hazards) {
    const m = { ...h, x: 1 - h.x - h.w, ...(h.flow !== undefined ? { flow: -h.flow } : {}) };
    if (Math.abs(m.x - h.x) > 0.08) hazards.push(m);
  }
  // fill empty cells of a 6x4 grid with ledges
  const avgH = d.platforms.length ? d.platforms.reduce((a, p) => a + Math.min(p.h, 0.05), 0) / d.platforms.length : 0.025;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      if (platforms.length >= MAX_PLATFORMS - 2) break;
      const cell = { x: gx / 6, y: 0.18 + gy * 0.19, w: 1 / 6, h: 0.19 };
      const busy = platforms.some((p) => p.x < cell.x + cell.w && p.x + p.w > cell.x && p.y < cell.y + cell.h && p.y + p.h > cell.y);
      if (busy || r() < 0.3) continue;
      const w = 0.06 + r() * 0.08;
      const ledge = { x: cell.x + r() * (cell.w - w), y: cell.y + 0.04 + r() * 0.1, w, h: clamp(avgH, 0.018, 0.04), crumble: r() < 0.2 };
      if (!clash(ledge)) platforms.push(ledge);
    }
  }
  return { ...d, platforms, hazards: hazards.slice(0, MAX_HAZARDS) };
}
