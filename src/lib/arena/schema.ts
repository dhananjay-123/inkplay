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
export const MAX_PICKUPS = 8;

const PICKUPS = ['health', 'ammo'] as const;
export type PickupKind = (typeof PICKUPS)[number];

export const ArenaRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gravity'), value: z.number() }),
  z.object({ kind: z.literal('jetpack_power'), value: z.number() }),
  z.object({ kind: z.literal('fire_rate'), value: z.number() }),
  z.object({ kind: z.literal('bullet_damage'), value: z.number() }),
  z.object({ kind: z.literal('night_mode') }),
]);
export type ArenaRule = z.infer<typeof ArenaRuleSchema>;

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Point = z.object({ x: z.number(), y: z.number() });

/** Strict, final shape (normalized 0-1 coords, origin top-left). */
export const ArenaMapSchema = z.object({
  title: z.string().max(60),
  story: z.string().max(240),
  platforms: z.array(Rect).min(1).max(MAX_PLATFORMS + 1),
  spawns: z.array(Point).min(1).max(MAX_SPAWNS),
  pickups: z.array(Point.extend({ kind: z.enum(PICKUPS) })).max(MAX_PICKUPS),
  rules: z.array(ArenaRuleSchema).max(5),
  /** Sample drawing to show faintly behind the platforms (only /public/samples ids). */
  sampleId: z.string().regex(/^[0-9a-z-]{1,40}$/).optional(),
  seed: z.number().int(),
});
export type ArenaMap = z.infer<typeof ArenaMapSchema>;

export type ArenaMapResponse = { map: ArenaMap; source: 'model' | 'procedural'; ms: number; note?: string };

/* ---------- lenient model-output parsing ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().finite());
const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ');
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

function toRect(raw: unknown): z.infer<typeof Rect> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const [x, y, w, h] = [r.x, r.y, r.w ?? r.width, r.h ?? r.height].map((v) => num.safeParse(v));
  if (!x.success || !y.success || !w.success || !h.success) return null;
  return { x: x.data, y: y.data, w: w.data, h: h.data };
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
  platforms: z.infer<typeof Rect>[];
  spawns: z.infer<typeof Point>[];
  pickups: (z.infer<typeof Point> & { kind: PickupKind })[];
  rules: ArenaRule[];
};

/** What Gemma returns when designing a map from a theme (or nothing). */
export const ArenaFromModel = z
  .object({
    title: z.unknown(),
    story: z.unknown(),
    platforms: z.array(z.unknown()),
    spawns: z.array(z.unknown()).catch([]),
    pickups: z.array(z.unknown()).catch([]),
    rules: z.array(z.unknown()).catch([]),
  })
  .transform((o): DraftArena => ({
    title: words(str(o.title, 'Ink Arena'), 5),
    story: str(o.story, 'Everyone brought a pen. Nobody brought a plan.').slice(0, 200),
    platforms: o.platforms.map(toRect).filter((r) => r !== null),
    spawns: o.spawns.map(toPoint).filter((p) => p !== null),
    pickups: o.pickups
      .map((p) => {
        const pt = toPoint(p);
        const kind = (p as { kind?: unknown })?.kind;
        return pt ? { ...pt, kind: (kind === 'ammo' ? 'ammo' : 'health') as PickupKind } : null;
      })
      .filter((p) => p !== null),
    rules: o.rules.map(normalizeArenaRule).filter((r) => r !== null),
  }))
  .refine((d) => d.platforms.length >= 3, { message: 'platforms must contain at least 3 valid {x,y,w,h} rects', path: ['platforms'] });

/** Gemma's answer when it turns a drawing's numbered marks into an arena. */
export const ARENA_ROLES = ['platform', 'spawn', 'health', 'ammo', 'decoration'] as const;
export const ArenaLabelsFromModel = z
  .object({
    title: z.unknown(),
    story: z.unknown(),
    labels: z.array(z.unknown()),
    rules: z.array(z.unknown()).catch([]),
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
        return { id: Math.round(id.data), role: (ARENA_ROLES as readonly string[]).includes(role) ? (role as (typeof ARENA_ROLES)[number]) : 'platform' };
      })
      .filter((l) => l !== null),
    rules: o.rules.map(normalizeArenaRule).filter((r) => r !== null),
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
  const platforms = d.platforms
    .map((r) => {
      const w = clamp(r.w, 0.02, 0.7);
      const h = clamp(r.h, 0.012, 0.2);
      return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0.08, 1 - h), w, h };
    })
    .slice(0, MAX_PLATFORMS);

  // A floor so nobody falls forever (the world bounds also stop you).
  const hasFloor = platforms.some((p) => p.y + p.h > 0.9 && p.w > 0.35);
  if (!hasFloor) platforms.push({ x: 0, y: 0.955, w: 1, h: 0.045 });

  const free = (pt: { x: number; y: number }) => {
    const box = { x: pt.x - PW / 2, y: pt.y - PH, w: PW, h: PH };
    return box.x >= 0 && box.x + box.w <= 1 && box.y >= 0 && !platforms.some((p) => overlaps(box, p));
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
  const tops = [...platforms].sort((a, b) => b.w - a.w);
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

  const seen = new Set<string>();
  const rules = d.rules.filter((r) => (seen.has(r.kind) ? false : (seen.add(r.kind), true)));

  return {
    title: words(d.title, 5).slice(0, 60) || 'Ink Arena',
    story: d.story.slice(0, 240),
    platforms,
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
  return finalizeArena({ ...m, rules: m.rules.map(normalizeArenaRule).filter((x) => x !== null) }, m.seed, m.sampleId);
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
