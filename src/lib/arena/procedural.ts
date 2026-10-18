import type { Mark } from '@/lib/schema';
import { finalizeArena, mulberry32, type ArenaMap, type ArenaRule, type DraftArena } from './schema';

const TITLES = ['Margin Mayhem', 'Graph Paper Gulag', 'Staple Fortress', 'Eraser Ridge', 'Notebook Nightmare', 'Hostel Rooftops'];

/**
 * Seeded map with no model: used when Gemma is unavailable or slow, and by
 * MODEL_PROVIDER=mock. Mirrored left/right so neither side is favoured.
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
      platforms.push({ x, y, w, h }, { x: 1 - x - w, y, w, h });
    }
  }
  // a centre tower, and cover blocks on the floor
  platforms.push({ x: 0.47, y: 0.5 + r() * 0.1, w: 0.06, h: 0.18 });
  const cx = 0.15 + r() * 0.15;
  platforms.push({ x: cx, y: 0.88, w: 0.04, h: 0.075 }, { x: 1 - cx - 0.04, y: 0.88, w: 0.04, h: 0.075 });
  const pickups: DraftArena['pickups'] = [
    { x: 0.5, y: 0.3, kind: 'health' },
    { x: 0.1, y: 0.5, kind: 'ammo' },
    { x: 0.9, y: 0.5, kind: 'ammo' },
  ];
  const rules: ArenaRule[] = r() < 0.3 ? [{ kind: 'gravity', value: 0.7 }] : [];
  return {
    title: TITLES[Math.floor(r() * TITLES.length)],
    story: 'Gemma was busy, so the ruler drew this one. Still pointy.',
    platforms,
    spawns: [],
    pickups,
    rules,
  };
}

export const proceduralArena = (seed: number): ArenaMap => finalizeArena(proceduralDraft(seed), seed);

export type MarkRole = 'platform' | 'spawn' | 'health' | 'ammo' | 'decoration';

/** Drawing mode: turn labelled marks into platforms / spawns / pickups. */
export function draftFromMarks(
  marks: Mark[],
  labels: { id: number; role: MarkRole }[],
  meta: { title: string; story: string; rules: ArenaRule[] },
): DraftArena {
  const roleOf = new Map(labels.map((l) => [l.id, l.role]));
  const d: DraftArena = { ...meta, platforms: [], spawns: [], pickups: [] };
  for (const m of marks) {
    const role = roleOf.get(m.id) ?? 'platform';
    const b = m.bbox;
    const cx = b.x + b.w / 2;
    if (role === 'platform') d.platforms.push({ x: b.x, y: b.y, w: b.w, h: Math.max(b.h, 0.018) });
    else if (role === 'spawn') d.spawns.push({ x: cx, y: b.y + b.h });
    else if (role === 'health' || role === 'ammo') d.pickups.push({ x: cx, y: b.y + b.h, kind: role });
  }
  return d;
}

/** Mock labels: wide marks are platforms, small compact ones alternate spawn/health. */
export function mockMarkLabels(marks: Mark[]) {
  return marks.map((m, i) => ({
    id: m.id,
    role: (m.aspect > 1.6 || m.bbox.w > 0.12 ? 'platform' : i % 3 === 0 ? 'health' : 'spawn') as MarkRole,
  }));
}
