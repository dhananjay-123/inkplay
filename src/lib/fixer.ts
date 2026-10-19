import type { BBox, Level, Mark, MarkLabel, PlayableLevel, RescuePlatform } from '@/lib/schema';
import {
  WORLD, boxesOverlap, jumpReach, surfaceOf, surfaceOfBox, surfaceYAt, tuningFor, type Surface,
} from '@/lib/physics';

const RESCUE_W = 120 / WORLD.width;
const RESCUE_H = 14 / WORLD.height;
const MAX_RESCUE = 8;
/** Player body size in normalized units (kept in sync with the game sprite). */
export const PLAYER_SIZE = { w: 34 / WORLD.width, h: 46 / WORLD.height };

type Node = { surface: Surface; bouncy: boolean };

/**
 * Make a parsed level playable: guarantee a player, a goal, ground, a safe
 * spawn, and a reachable goal (adding minimal rescue platforms if needed).
 * Deterministic and model-free, so it runs the same on cloud and offline.
 */
export function fixLevel(level: Level, marks: Mark[]): PlayableLevel {
  const markById = new Map(marks.map((m) => [m.id, m]));
  const notes: string[] = [];
  let labels: MarkLabel[] = level.labels.map((l) => (markById.has(l.id) ? l : { ...l, role: 'decoration' }));

  const withRole = (role: MarkLabel['role']) =>
    labels.filter((l) => l.role === role).map((l) => markById.get(l.id)!).filter(Boolean);

  // --- player: keep the left-most, demote the rest
  const players = withRole('player').sort((a, b) => a.bbox.x - b.bbox.x);
  if (players.length > 1) {
    const extra = new Set(players.slice(1).map((m) => m.id));
    labels = labels.map((l) => (extra.has(l.id) ? { ...l, role: 'decoration' } : l));
  }
  // --- goal: keep the right-most
  const goals = withRole('goal').sort((a, b) => b.bbox.x - a.bbox.x);
  if (goals.length > 1) {
    const extra = new Set(goals.slice(1).map((m) => m.id));
    labels = labels.map((l) => (extra.has(l.id) ? { ...l, role: 'decoration' } : l));
  }

  const rescue: RescuePlatform[] = [];
  const platforms = withRole('platform');
  const surfaces: Surface[] = platforms.map(surfaceOf);

  // --- no platforms → ground line
  if (surfaces.length === 0) {
    const ground: BBox = { x: 0.02, y: 0.93, w: 0.96, h: RESCUE_H };
    rescue.push({ bbox: ground });
    surfaces.push(surfaceOfBox(ground));
    notes.push('No ground found, so we drew some.');
  }

  // --- spawn
  let spawn: { x: number; y: number };
  if (players[0]) {
    const b = players[0].bbox;
    spawn = { x: b.x + b.w / 2, y: b.y + b.h };
  } else {
    // above the lowest-left platform
    const s = [...surfaces].sort((a, b) => a[0][0] - b[0][0] + (b[0][1] - a[0][1]) * 0.5)[0];
    const x = Math.min(s[0][0] + 0.03, s[s.length - 1][0]);
    spawn = { x, y: (surfaceYAt(s, x) ?? s[0][1]) - 0.01 };
    notes.push('No hero found, so a brave scribble volunteered.');
  }

  // --- nudge spawn out of hazards (up/left)
  const hazards = withRole('hazard').map((m) => m.bbox);
  for (let i = 0; i < 6; i++) {
    const body = playerBox(spawn);
    const hit = hazards.find((h) => boxesOverlap(body, h));
    if (!hit) break;
    spawn = { x: Math.max(PLAYER_SIZE.w, hit.x - PLAYER_SIZE.w), y: Math.max(PLAYER_SIZE.h, hit.y - 0.01) };
  }

  // --- goal
  let goal: { x: number; y: number };
  if (goals[0]) {
    const b = goals[0].bbox;
    goal = { x: b.x + b.w / 2, y: b.y + b.h };
  } else {
    const s = [...surfaces].sort((a, b) => score(b) - score(a))[0];
    const end = s[s.length - 1];
    const x = Math.max(s[0][0], end[0] - 0.03);
    goal = { x, y: surfaceYAt(s, x) ?? end[1] };
    notes.push('No finish line, so we planted a flag.');
  }

  // --- ground under spawn (otherwise the hero falls forever)
  if (!surfaceBelow(surfaces, spawn)) {
    const b: BBox = { x: clamp01(spawn.x - RESCUE_W / 2), y: Math.min(0.95, spawn.y + 0.02), w: RESCUE_W, h: RESCUE_H };
    rescue.push({ bbox: b });
    surfaces.push(surfaceOfBox(b));
  }

  // --- reachability (skipped for inverted gravity: the model is too coarse there)
  const tuning = tuningFor(level.rules);
  if (!tuning.inverted) {
    const reach = jumpReach(tuning);
    const bouncy = withRole('bouncy').map((m) => surfaceOf(m));
    let added = 0;
    while (!goalReachable(surfaces, bouncy, spawn, goal, reach) && added < MAX_RESCUE) {
      const step = nextRescue(surfaces, bouncy, spawn, goal, reach);
      if (!step) break;
      rescue.push({ bbox: step });
      surfaces.push(surfaceOfBox(step));
      added++;
    }
    if (added > 0) notes.push(`Added ${added} rescue platform${added > 1 ? 's' : ''} ✦ so the goal is reachable.`);
  }

  const designerNote = [level.designerNote, ...notes].join(' ');
  return { ...level, labels, designerNote, rescue, spawn, goal };
}

/* ---------------- helpers ---------------- */

const clamp01 = (v: number) => Math.min(1 - RESCUE_W, Math.max(0, v));
const score = (s: Surface) => s[s.length - 1][0] + (1 - s[0][1]) * 0.6;

function playerBox(p: { x: number; y: number }): BBox {
  return { x: p.x - PLAYER_SIZE.w / 2, y: p.y - PLAYER_SIZE.h, w: PLAYER_SIZE.w, h: PLAYER_SIZE.h };
}

/** Index of the first surface the player lands on when dropped at p. */
function surfaceBelow(surfaces: Surface[], p: { x: number; y: number }): Surface | null {
  let best: Surface | null = null;
  let bestY = Infinity;
  for (const s of surfaces) {
    const y = surfaceYAt(s, p.x);
    if (y !== null && y >= p.y - 0.02 && y < bestY) {
      bestY = y;
      best = s;
    }
  }
  return best;
}

/** Sample points along a surface (normalized). */
function samples(s: Surface, step = 0.02): [number, number][] {
  const out: [number, number][] = [];
  const x0 = s[0][0];
  const x1 = s[s.length - 1][0];
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    const y = surfaceYAt(s, Math.min(x, x1));
    if (y !== null) out.push([Math.min(x, x1), y]);
  }
  return out.length ? out : [s[0]];
}

/** Can the player get from point a (standing) to point b (standing / touching)? */
function canJump(a: [number, number], b: [number, number], reach: { height: number; width: number }, boost = 1): boolean {
  const dx = Math.abs(b[0] - a[0]) * WORLD.width;
  const rise = (a[1] - b[1]) * WORLD.height; // positive = b is higher
  const h = reach.height * boost * boost; // height scales with v²
  const w = reach.width * boost;
  if (rise > 0) {
    if (rise > h * 0.9) return false;
    // Horizontal budget shrinks as the target gets higher.
    const frac = Math.sqrt(1 - rise / h);
    return dx <= w * (0.5 + 0.5 * frac) * 0.85;
  }
  // Falling: extra air time while dropping.
  const drop = -rise;
  return dx <= w * 0.85 * (1 + Math.sqrt(drop / Math.max(h, 1)) * 0.5);
}

function reachableNodes(surfaces: Surface[], bouncy: Surface[], spawn: { x: number; y: number }, reach: { height: number; width: number }): Node[] {
  const nodes: Node[] = [
    ...surfaces.map((surface) => ({ surface, bouncy: false })),
    ...bouncy.map((surface) => ({ surface, bouncy: true })),
  ];
  const start = surfaceBelow(nodes.map((n) => n.surface), spawn);
  if (!start) return [];
  const startNode = nodes.find((n) => n.surface === start)!;
  const seen = new Set<Node>([startNode]);
  const queue: Node[] = [startNode];
  while (queue.length) {
    const cur = queue.shift()!;
    const from = samples(cur.surface);
    for (const n of nodes) {
      if (seen.has(n)) continue;
      const to = samples(n.surface);
      const ok = from.some((a) => to.some((b) => canJump(a, b, reach, cur.bouncy ? 1.6 : 1)));
      if (ok) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return [...seen];
}

function goalReachable(surfaces: Surface[], bouncy: Surface[], spawn: { x: number; y: number }, goal: { x: number; y: number }, reach: { height: number; width: number }): boolean {
  const target: [number, number] = [goal.x, goal.y];
  return reachableNodes(surfaces, bouncy, spawn, reach).some((n) =>
    samples(n.surface).some((a) => canJump(a, target, reach, n.bouncy ? 1.6 : 1)),
  );
}

/** One stepping platform from the reachable point closest to the goal, toward the goal. */
function nextRescue(surfaces: Surface[], bouncy: Surface[], spawn: { x: number; y: number }, goal: { x: number; y: number }, reach: { height: number; width: number }): BBox | null {
  const nodes = reachableNodes(surfaces, bouncy, spawn, reach);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    for (const p of samples(n.surface)) {
      const d = Math.hypot((p[0] - goal.x) * WORLD.width, (p[1] - goal.y) * WORLD.height);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  if (!best) return null;
  const maxDx = (reach.width * 0.55) / WORLD.width;
  const maxRise = (reach.height * 0.6) / WORLD.height;
  const dx = Math.max(-maxDx, Math.min(maxDx, goal.x - best[0]));
  const dy = Math.max(-maxRise, Math.min(maxRise, goal.y - best[1]));
  const cx = best[0] + dx;
  const y = Math.max(0.08, Math.min(0.95, best[1] + dy));
  return { x: clamp01(cx - RESCUE_W / 2), y, w: RESCUE_W, h: RESCUE_H };
}
