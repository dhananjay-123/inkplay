import type { BBox, Mark, Rule } from '@/lib/schema';

/** Fixed game world; the cleaned drawing is warped to the same 16:9 ratio. */
export const WORLD = { width: 1600, height: 900 } as const;

export const BASE = {
  gravity: 1500, // px/s²
  runSpeed: 320, // px/s
  jumpVelocity: 780, // px/s
  bounceVelocity: 1250,
  enemySpeed: 90,
  coyoteMs: 110,
  jumpBufferMs: 130,
} as const;

export type Tuning = {
  gravity: number;
  runSpeed: number;
  jumpVelocity: number;
  enemySpeed: number;
  inverted: boolean;
};

export function tuningFor(rules: Rule[]): Tuning {
  const t: Tuning = {
    gravity: BASE.gravity,
    runSpeed: BASE.runSpeed,
    jumpVelocity: BASE.jumpVelocity,
    enemySpeed: BASE.enemySpeed,
    inverted: false,
  };
  for (const r of rules) {
    if (r.kind === 'gravity') t.gravity = BASE.gravity * r.value;
    if (r.kind === 'player_speed') t.runSpeed = BASE.runSpeed * r.value;
    if (r.kind === 'jump_power') t.jumpVelocity = BASE.jumpVelocity * r.value;
    if (r.kind === 'enemy_speed') t.enemySpeed = BASE.enemySpeed * r.value;
    if (r.kind === 'invert_gravity') t.inverted = true;
  }
  return t;
}

/** Peak jump height and horizontal distance covered while airborne, in px. */
export function jumpReach(t: Tuning): { height: number; width: number } {
  const height = (t.jumpVelocity * t.jumpVelocity) / (2 * t.gravity);
  const airTime = (2 * t.jumpVelocity) / t.gravity;
  return { height, width: airTime * t.runSpeed };
}

/** A walkable top surface, as a polyline in normalized coords (left → right). */
export type Surface = [number, number][];

/**
 * Top profile of a mark. The vision pipeline already emits the top profile as
 * the polyline; fall back to the bbox top edge.
 */
export function surfaceOf(mark: Pick<Mark, 'bbox' | 'polyline'>): Surface {
  if (mark.polyline.length >= 2) return mark.polyline;
  const { x, y, w } = mark.bbox;
  return [[x, y], [x + w, y]];
}

export function surfaceOfBox(b: BBox): Surface {
  return [[b.x, b.y], [b.x + b.w, b.y]];
}

/** Height of a surface (normalized y) at normalized x, or null if outside. */
export function surfaceYAt(s: Surface, x: number): number | null {
  if (x < s[0][0] || x > s[s.length - 1][0]) return null;
  for (let i = 1; i < s.length; i++) {
    const [x1, y1] = s[i - 1];
    const [x2, y2] = s[i];
    if (x >= x1 && x <= x2) return x2 === x1 ? Math.min(y1, y2) : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
  }
  return null;
}

export const boxesOverlap = (a: BBox, b: BBox) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
