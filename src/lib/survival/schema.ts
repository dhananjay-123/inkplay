import { z } from 'zod';

/**
 * Survival mode: an endless runner. The track is a stream of chunks, and a
 * chunk is data, never code: ground pieces (the holes between them are gaps),
 * floating ledges, ground hazards, low bars to slide under, mobs and pickups.
 * `finalizeChunk` clamps every number and drops anything the runner could not
 * survive at the current speed, whoever wrote the chunk (the seeded generator
 * today, a model later).
 */

/** Physics shared by the scene and the clamps below (px, px/s, px/s²). */
export const RUN = {
  view: { width: 1280, height: 720 },
  groundY: 600,
  gravity: 2400,
  jumpVelocity: 940,
  baseSpeed: 380,
  maxSpeed: 820,
  /** Seconds from base to max speed. */
  rampSeconds: 210,
  /** Player hitbox: standing and sliding. */
  standH: 58,
  slideH: 26,
  playerW: 36,
} as const;

/** Time in the air for a full jump, and how far that carries at `speed`. */
export function jumpReach(speed: number): { height: number; width: number } {
  const air = (2 * RUN.jumpVelocity) / RUN.gravity;
  return { height: (RUN.jumpVelocity * RUN.jumpVelocity) / (2 * RUN.gravity), width: air * speed };
}

export const HAZARD_KINDS = ['spikes', 'lava'] as const;
export const MOB_KINDS = ['walker', 'flyer', 'shooter'] as const;
export const PICKUP_KINDS = ['coin', 'heart', 'shield', 'magnet', 'boost'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export type MobKind = (typeof MOB_KINDS)[number];
export type PickupKind = (typeof PICKUP_KINDS)[number];

/** Near-misses a model might write, mapped onto the whitelist. */
const PICKUP_ALIASES: Record<string, PickupKind> = {
  gem: 'coin', star: 'coin', health: 'heart', heal: 'heart', medkit: 'heart', armor: 'shield', armour: 'shield',
  speed: 'boost', speed_boost: 'boost', jetpack: 'boost', rocket: 'boost',
};
export function toPickupKind(v: unknown): PickupKind | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (PICKUP_KINDS as readonly string[]).includes(k) ? (k as PickupKind) : PICKUP_ALIASES[k] ?? null;
}

export const MAX_LEDGES = 4;
export const MAX_HAZARDS = 6;
export const MAX_BARS = 3;
export const MAX_MOBS = 6;
export const MAX_PICKUPS = 40;

const Span = z.object({ x: z.number(), w: z.number() });
/** All x are px from the chunk start; heights `h` are px above the ground line. */
export const DraftChunkSchema = z.object({
  length: z.number(),
  ground: z.array(Span.extend({ crumble: z.boolean().optional() })).max(40),
  ledges: z.array(Span.extend({ h: z.number() })).max(20).default([]),
  hazards: z.array(Span.extend({ kind: z.enum(HAZARD_KINDS) })).max(30).default([]),
  bars: z.array(Span).max(20).default([]),
  mobs: z.array(z.object({ x: z.number(), kind: z.enum(MOB_KINDS), h: z.number().optional() })).max(30).default([]),
  pickups: z.array(z.object({ x: z.number(), h: z.number(), kind: z.string() })).max(120).default([]),
});
export type DraftChunk = z.input<typeof DraftChunkSchema>;

export type Chunk = {
  length: number;
  ground: { x: number; w: number; crumble: boolean }[];
  ledges: { x: number; w: number; h: number }[];
  hazards: { x: number; w: number; kind: HazardKind }[];
  bars: { x: number; w: number }[];
  mobs: { x: number; kind: MobKind; h: number }[];
  pickups: { x: number; h: number; kind: PickupKind }[];
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** First and last px of every chunk are plain ground, so chunk seams are always safe. */
export const SAFE_START = 260;
export const SAFE_END = 160;

/**
 * Clamp and clean a chunk for a runner moving at `speed` px/s:
 * - gaps and hazards are never wider than a comfortable jump;
 * - there is always room to land and jump again between two dangers;
 * - hazards, bars, walkers and shooters sit on solid ground;
 * - counts are capped and pickup kinds are whitelisted.
 */
export function finalizeChunk(draft: unknown, speed: number): Chunk {
  const d = DraftChunkSchema.parse(draft);
  const v = clamp(speed, RUN.baseSpeed, RUN.maxSpeed);
  const reach = jumpReach(v).width;
  const maxGap = Math.round(reach * 0.62);
  const maxHazard = Math.round(reach * 0.55);
  const spacing = Math.round(v * 0.5); // landing room between two dangers
  const length = Math.round(clamp(d.length, 900, 3600));

  // ---------- ground: sorted, non-overlapping, gaps within reach
  const raw = d.ground
    .map((g) => ({ x: clamp(g.x, 0, length), w: clamp(g.w, 0, length), crumble: Boolean(g.crumble) }))
    .map((g) => ({ ...g, w: Math.min(g.w, length - g.x) }))
    .filter((g) => g.w >= 40)
    .sort((a, b) => a.x - b.x);
  const ground: Chunk['ground'] = [];
  for (const g of raw) {
    const prev = ground[ground.length - 1];
    if (!prev) {
      ground.push({ ...g, w: g.w + g.x, x: 0 }); // the chunk starts on ground
      continue;
    }
    const end = prev.x + prev.w;
    let x = g.x;
    let w = g.w;
    if (x < end) {
      w -= end - x;
      x = end;
    }
    if (w < 80) continue;
    const gap = x - end;
    if (gap > 0 && gap < 70) prev.w += gap; // slivers aren't worth a jump
    else if (gap > maxGap) prev.w += gap - maxGap;
    if (g.crumble) w = Math.min(w, 420);
    ground.push({ x, w, crumble: g.crumble });
  }
  if (ground.length === 0) ground.push({ x: 0, w: length, crumble: false });
  const last = ground[ground.length - 1];
  last.w = length - last.x; // ...and ends on ground
  // safe seams: solid at both ends, and a real landing strip
  for (const g of ground) {
    if (g.x < SAFE_START || g.x + g.w > length - SAFE_END) g.crumble = false;
  }
  if (ground[0].w < SAFE_START) ground[0].w = SAFE_START;
  // re-tidy after the seam fix-ups (they can only overlap at the end)
  for (let i = ground.length - 1; i > 0; i--) {
    const a = ground[i - 1];
    const b = ground[i];
    if (b.x < a.x + a.w) {
      const end = Math.max(a.x + a.w, b.x + b.w);
      a.w = end - a.x;
      a.crumble = a.crumble && b.crumble;
      ground.splice(i, 1);
    }
  }
  const tail = ground[ground.length - 1];
  tail.w = length - tail.x;

  const solidAt = (x0: number, x1: number) => ground.some((g) => !g.crumble && g.x <= x0 && g.x + g.w >= x1);

  // ---------- dangers in x order, keeping landing room between them
  const dangers: [number, number][] = [];
  for (let i = 1; i < ground.length; i++) dangers.push([ground[i - 1].x + ground[i - 1].w, ground[i].x]);
  for (const g of ground) if (g.crumble) dangers.push([g.x, g.x + g.w]);
  const fits = (x0: number, x1: number) => {
    if (x0 < SAFE_START || x1 > length - SAFE_END) return false;
    if (dangers.some(([a, b]) => x0 < b + spacing && x1 > a - spacing)) return false;
    dangers.push([x0, x1]);
    return true;
  };

  type Item =
    | { t: 'hazard'; x: number; w: number; kind: HazardKind }
    | { t: 'bar'; x: number; w: number }
    | { t: 'mob'; x: number; kind: MobKind; h: number };
  const items: Item[] = [
    ...d.hazards.map((h) => ({ t: 'hazard' as const, kind: h.kind, x: h.x, w: clamp(h.w, h.kind === 'lava' ? 80 : 40, maxHazard) })),
    ...d.bars.map((b) => ({ t: 'bar' as const, x: b.x, w: clamp(b.w, 60, 280) })),
    ...d.mobs.map((m) => ({ t: 'mob' as const, x: m.x, kind: m.kind, h: m.kind === 'flyer' ? clamp(m.h ?? 40, 34, 170) : 0 })),
  ].sort((a, b) => a.x - b.x);

  const hazards: Chunk['hazards'] = [];
  const bars: Chunk['bars'] = [];
  const mobs: Chunk['mobs'] = [];
  for (const it of items) {
    const x = Math.round(clamp(it.x, 0, length));
    if (it.t === 'hazard') {
      if (hazards.length < MAX_HAZARDS && solidAt(x, x + it.w) && fits(x, x + it.w)) hazards.push({ x, w: Math.round(it.w), kind: it.kind });
    } else if (it.t === 'bar') {
      if (bars.length < MAX_BARS && solidAt(x - 40, x + it.w + 40) && fits(x, x + it.w)) bars.push({ x, w: Math.round(it.w) });
    } else if (mobs.length < MAX_MOBS) {
      // walkers come toward you, so they need extra room; shooters stay put
      const span: [number, number] = it.kind === 'walker' ? [x - 40, x + 120] : [x - 30, x + 30];
      const grounded = it.kind === 'flyer' || solidAt(span[0], span[1]);
      if (grounded && fits(span[0], span[1])) mobs.push({ x, kind: it.kind, h: Math.round(it.h) });
    }
  }

  // ---------- ledges: never over a bar (you'd be squeezed)
  const ledges = d.ledges
    .map((l) => ({ x: Math.round(clamp(l.x, 0, length - 120)), w: Math.round(clamp(l.w, 120, 480)), h: Math.round(clamp(l.h, 100, 160)) }))
    .map((l) => ({ ...l, w: Math.min(l.w, length - l.x) }))
    .filter((l) => !bars.some((b) => l.x < b.x + b.w + 60 && l.x + l.w > b.x - 60))
    .slice(0, MAX_LEDGES);

  const pickups = d.pickups
    .map((p) => ({ x: Math.round(clamp(p.x, 0, length)), h: Math.round(clamp(p.h, 24, 280)), kind: toPickupKind(p.kind) }))
    .filter((p): p is Chunk['pickups'][number] => p.kind !== null)
    .slice(0, MAX_PICKUPS);

  return {
    length,
    ground: ground.map((g) => ({ x: Math.round(g.x), w: Math.round(g.x + g.w) - Math.round(g.x), crumble: g.crumble })),
    ledges,
    hazards,
    bars,
    mobs,
    pickups,
  };
}
