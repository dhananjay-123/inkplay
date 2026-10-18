import type { Mark } from '@/lib/schema';
import { ARENA_ROLES, BUFF_PICKUPS, DEFAULT_OPTIONS, WEAPON_PICKUPS, applyOptions, finalizeArena, growDrawing, mulberry32, type ArenaMap, type ArenaRule, type DraftArena, type MapOptions, type PickupKind } from './schema';

const TITLES = ['Margin Mayhem', 'Graph Paper Gulag', 'Staple Fortress', 'Eraser Ridge', 'Notebook Nightmare', 'Hostel Rooftops'];

/**
 * Seeded map with no model: used when Gemma is unavailable or slow, and by
 * MODEL_PROVIDER=mock. Mirrored left/right so neither side is favoured, with
 * a lava pit, a flowing stream, crumbling ledges and weapon/buff crates.
 */
export function proceduralDraft(seed: number): DraftArena {
  const r = mulberry32(seed);
  const platforms: DraftArena['platforms'] = [];
  const tiers = 4 + Math.floor(r() * 2);
  for (let t = 0; t < tiers; t++) {
    const y = 0.22 + (t / tiers) * 0.62 + (r() - 0.5) * 0.04;
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = 0.08 + r() * 0.14;
      const x = 0.03 + r() * (0.45 - w);
      const h = 0.02 + r() * 0.015;
      const crumble = r() < 0.25;
      platforms.push({ x, y, w, h, crumble }, { x: 1 - x - w, y, w, h, crumble });
    }
  }
  // a centre tower, and cover blocks on the floor
  platforms.push({ x: 0.47, y: 0.5 + r() * 0.1, w: 0.06, h: 0.18 });
  const cx = 0.15 + r() * 0.15;
  platforms.push({ x: cx, y: 0.88, w: 0.04, h: 0.075 }, { x: 1 - cx - 0.04, y: 0.88, w: 0.04, h: 0.075 });

  const hazards: DraftArena['hazards'] = [{ x: 0.42, y: 0.93, w: 0.16, h: 0.026, kind: 'lava' }];
  if (r() < 0.7) {
    // a stream on one side, flowing toward the middle
    const left = r() < 0.5;
    hazards.push({ x: left ? 0 : 0.78, y: 0.78, w: 0.22, h: 0.175, kind: 'water', flow: left ? 0.6 : -0.6 });
  }

  const weapons = [...WEAPON_PICKUPS].sort(() => r() - 0.5);
  const buffs = [...BUFF_PICKUPS].sort(() => r() - 0.5);
  const pickups: DraftArena['pickups'] = [
    { x: 0.5, y: 0.3, kind: weapons[0] },
    { x: 0.12, y: 0.5, kind: weapons[1] },
    { x: 0.88, y: 0.5, kind: weapons[1] },
    { x: 0.3, y: 0.7, kind: buffs[0] },
    { x: 0.7, y: 0.7, kind: buffs[0] },
    { x: 0.5, y: 0.85, kind: buffs[1] },
    { x: 0.2, y: 0.3, kind: 'health' },
    { x: 0.8, y: 0.3, kind: 'health' },
    { x: 0.5, y: 0.6, kind: weapons[2] },
  ];
  const rules: ArenaRule[] = r() < 0.3 ? [{ kind: 'gravity', value: 0.7 }] : [];
  return {
    title: TITLES[Math.floor(r() * TITLES.length)],
    story: 'Gemma was busy, so the ruler drew this one. Still pointy.',
    platforms,
    hazards,
    enemies: [
      { x: 0.25, y: 0.2, kind: 'flyer' },
      { x: 0.75, y: 0.95, kind: 'walker' },
    ],
    spawns: [],
    pickups,
    rules,
  };
}

export const proceduralArena = (seed: number, opts: MapOptions = DEFAULT_OPTIONS): ArenaMap =>
  finalizeArena(applyOptions(proceduralDraft(seed), opts, seed), seed);

type Pieces = Pick<DraftArena, 'platforms' | 'hazards' | 'enemies' | 'spawns' | 'pickups'>;

/**
 * Drawing → arena: measured zigzags are always spikes (measurement beats a
 * guess, like D12), Gemma's extras are added, then the drawing is grown to
 * fill the page and the map maker's options are enforced.
 */
export function arenaFromDrawing(
  marks: Mark[],
  labels: { id: number; role: MarkRole }[],
  meta: { title: string; story: string; rules: ArenaRule[] },
  extras: Pieces | null,
  opts: MapOptions,
  seed: number,
  sampleId?: string,
): ArenaMap {
  const zig = new Set(marks.filter((m) => m.zigzag).map((m) => m.id));
  const fixed = labels.map((l) => (zig.has(l.id) && l.role !== 'lava' ? { ...l, role: 'spikes' as const } : l));
  for (const id of zig) if (!fixed.some((l) => l.id === id)) fixed.push({ id, role: 'spikes' });
  const d = draftFromMarks(marks, fixed, meta);
  if (extras) {
    d.platforms.push(...extras.platforms);
    d.hazards.push(...extras.hazards);
    d.enemies.push(...extras.enemies);
    d.spawns.push(...extras.spawns);
    d.pickups.push(...extras.pickups);
  }
  return finalizeArena(applyOptions(growDrawing(d, seed), opts, seed), seed, sampleId);
}

export type MarkRole = (typeof ARENA_ROLES)[number];

/** Drawing mode: turn labelled marks into platforms / hazards / spawns / pickups. */
export function draftFromMarks(
  marks: Mark[],
  labels: { id: number; role: MarkRole }[],
  meta: { title: string; story: string; rules: ArenaRule[] },
): DraftArena {
  const roleOf = new Map(labels.map((l) => [l.id, l.role]));
  const d: DraftArena = { ...meta, platforms: [], hazards: [], enemies: [], spawns: [], pickups: [] };
  for (const m of marks) {
    const role = roleOf.get(m.id) ?? 'platform';
    const b = m.bbox;
    const cx = b.x + b.w / 2;
    const pick = (kind: PickupKind) => d.pickups.push({ x: cx, y: b.y + b.h, kind });
    if (role === 'platform' || role === 'crumble') d.platforms.push({ x: b.x, y: b.y, w: b.w, h: Math.max(b.h, 0.018), crumble: role === 'crumble' });
    else if (role === 'spikes') d.hazards.push({ x: b.x, y: b.y, w: b.w, h: Math.max(b.h, 0.02), kind: 'spikes' });
    else if (role === 'enemy') d.enemies.push({ x: cx, y: b.y + b.h, kind: b.y < 0.45 ? 'flyer' : 'walker' });
    else if (role === 'lava') d.hazards.push({ x: b.x, y: b.y, w: b.w, h: Math.max(b.h, 0.02), kind: 'lava' });
    else if (role === 'water') d.hazards.push({ x: b.x, y: b.y, w: b.w, h: Math.max(b.h, 0.04), kind: 'water', flow: cx < 0.5 ? 0.5 : -0.5 });
    else if (role === 'spawn') d.spawns.push({ x: cx, y: b.y + b.h });
    else if (role === 'health' || role === 'ammo') pick(role);
    else if (role === 'weapon') pick(WEAPON_PICKUPS[m.id % WEAPON_PICKUPS.length]);
    else if (role === 'buff') pick(BUFF_PICKUPS[m.id % BUFF_PICKUPS.length]);
  }
  return d;
}

/** Mock labels: wide marks are platforms, small compact ones become spawns / crates. */
export function mockMarkLabels(marks: Mark[]): { id: number; role: MarkRole }[] {
  return marks.map((m, i) => ({
    id: m.id,
    role: m.zigzag ? 'spikes' : m.aspect > 1.6 || m.bbox.w > 0.12 ? 'platform' : (['spawn', 'weapon', 'buff', 'enemy'] as const)[i % 4],
  }));
}
