import { z } from 'zod';

/* ---------- Marks (produced client-side by the vision pipeline) ---------- */

export const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const MarkSchema = z.object({
  id: z.number().int().min(1),
  bbox: BBoxSchema,
  area: z.number().min(0),
  aspect: z.number().min(0),
  /** Simplified main stroke, normalized 0–1 points. */
  polyline: z.array(z.tuple([z.number(), z.number()])).max(64),
});
export type Mark = z.infer<typeof MarkSchema>;

export const MAX_MARKS = 40;

/* ---------- Model output ---------- */

export const ROLES = [
  'platform', 'hazard', 'bouncy', 'enemy', 'collectible', 'powerup',
  'goal', 'player', 'rule_text', 'decoration',
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const BEHAVIOURS = ['static', 'patrol', 'chase', 'fly', 'jump'] as const;
export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export const EFFECTS = ['speed_boost', 'double_jump', 'shield', 'tiny', 'giant'] as const;

export const MarkLabelSchema = z.object({
  id: z.number().int(),
  what: z.string(),
  role: RoleSchema,
  behaviour: z.enum(BEHAVIOURS).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  personality: z.string().optional(),
});
export type MarkLabel = z.infer<typeof MarkLabelSchema>;

export const RuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gravity'), value: z.number() }),
  z.object({ kind: z.literal('invert_gravity') }),
  z.object({ kind: z.literal('player_speed'), value: z.number() }),
  z.object({ kind: z.literal('jump_power'), value: z.number() }),
  z.object({ kind: z.literal('enemy_speed'), value: z.number() }),
  z.object({ kind: z.literal('enemies_accelerate'), everySeconds: z.number() }),
  z.object({ kind: z.literal('time_limit'), seconds: z.number() }),
  z.object({ kind: z.literal('collectible_effect'), effect: z.enum(EFFECTS) }),
  z.object({ kind: z.literal('boss'), name: z.string(), attack: z.string() }),
  z.object({ kind: z.literal('night_mode') }),
  z.object({ kind: z.literal('mirror_world') }),
]);
export type Rule = z.infer<typeof RuleSchema>;
export type RuleKind = Rule['kind'];

/** Strict shape: used for types and as the JSON Schema sent to Ollama. */
export const LevelSchema = z.object({
  title: z.string(),
  story: z.string(),
  difficulty: z.number(),
  labels: z.array(MarkLabelSchema),
  rules: z.array(RuleSchema),
  rawRuleText: z.array(z.string()),
  designerNote: z.string(),
});
export type Level = z.infer<typeof LevelSchema>;

/* ---------- Lenient model-output parsing + clamping ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().finite());
const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ');
const sentences = (s: string, n: number) =>
  (s.trim().match(/[^.!?]+[.!?]*/g) ?? [s]).slice(0, n).join('').trim();

/** Coerce near-misses ("Platform", "spikes") before strict validation. */
const ROLE_ALIASES: Record<string, Role> = {
  ground: 'platform', floor: 'platform', wall: 'platform', block: 'platform',
  spike: 'hazard', spikes: 'hazard', danger: 'hazard', trap: 'hazard',
  spring: 'bouncy', trampoline: 'bouncy', bounce: 'bouncy',
  coin: 'collectible', item: 'collectible', pickup: 'collectible',
  'power-up': 'powerup', power_up: 'powerup',
  exit: 'goal', flag: 'goal', finish: 'goal',
  hero: 'player', start: 'player',
  rule: 'rule_text', text: 'rule_text', word: 'rule_text',
  unknown: 'decoration', scenery: 'decoration',
};

function normalizeLabel(raw: unknown): MarkLabel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = { ...(raw as Record<string, unknown>) };
  if (typeof r.id === 'string') r.id = Number(r.id.replace(/^#/, ''));
  if (typeof r.role === 'string') {
    const k = r.role.trim().toLowerCase();
    r.role = (ROLES as readonly string[]).includes(k) ? k : ROLE_ALIASES[k] ?? 'decoration';
  }
  for (const key of ['behaviour', 'direction'] as const) {
    if (typeof r[key] === 'string') r[key] = (r[key] as string).toLowerCase();
  }
  if (r.behaviour !== undefined && !(BEHAVIOURS as readonly unknown[]).includes(r.behaviour)) delete r.behaviour;
  if (r.direction !== undefined && !(DIRECTIONS as readonly unknown[]).includes(r.direction)) delete r.direction;
  if (r.personality !== undefined && typeof r.personality !== 'string') delete r.personality;
  if (typeof r.what !== 'string') r.what = 'mystery doodle';
  const parsed = MarkLabelSchema.safeParse(r);
  if (!parsed.success) return null;
  const l = parsed.data;
  return {
    ...l,
    what: words(l.what, 6),
    personality: l.role === 'enemy' && l.personality ? words(l.personality, 8) : undefined,
    behaviour: l.role === 'enemy' ? l.behaviour ?? 'patrol' : undefined,
  };
}

function normalizeRule(raw: unknown): Rule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = { ...(raw as Record<string, unknown>) };
  for (const key of ['value', 'everySeconds', 'seconds'] as const) {
    if (key in r) {
      const n = num.safeParse(r[key]);
      if (!n.success) return null;
      r[key] = n.data;
    }
  }
  const parsed = RuleSchema.safeParse(r);
  if (!parsed.success) return null;
  const rule = parsed.data;
  switch (rule.kind) {
    case 'gravity': return { ...rule, value: clamp(rule.value, 0.2, 3) };
    case 'player_speed': return { ...rule, value: clamp(rule.value, 0.5, 2.5) };
    case 'jump_power': return { ...rule, value: clamp(rule.value, 0.5, 2.5) };
    case 'enemy_speed': return { ...rule, value: clamp(rule.value, 0.25, 3) };
    case 'enemies_accelerate': return { ...rule, everySeconds: clamp(rule.everySeconds, 3, 60) };
    case 'time_limit': return { ...rule, seconds: clamp(Math.round(rule.seconds), 10, 300) };
    case 'boss': return { ...rule, name: words(rule.name, 6), attack: words(rule.attack, 8) };
    default: return rule;
  }
}

/**
 * Lenient parser for whatever the model returned. Throws a ZodError only when
 * the output is unusable (not an object, or zero valid labels), which triggers
 * one retry upstream.
 */
export const LevelFromModel = z
  .object({
    title: z.unknown(),
    story: z.unknown(),
    difficulty: z.unknown(),
    labels: z.array(z.unknown()),
    rules: z.array(z.unknown()).catch([]),
    rawRuleText: z.array(z.unknown()).catch([]),
    designerNote: z.unknown(),
  })
  .transform((o): Level => {
    const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
    const diff = num.safeParse(o.difficulty);
    // Keep only the first rule of each kind (later duplicates are model noise).
    const seen = new Set<RuleKind>();
    const rules = o.rules.map(normalizeRule).filter((r): r is Rule => {
      if (!r || seen.has(r.kind)) return false;
      seen.add(r.kind);
      return true;
    });
    return {
      title: words(str(o.title, 'Untitled Doodle'), 5),
      story: sentences(str(o.story, 'A brave scribble sets off across the page.'), 2),
      difficulty: diff.success ? clamp(Math.round(diff.data), 1, 10) : 5,
      labels: o.labels.map(normalizeLabel).filter((l): l is MarkLabel => l !== null),
      rules,
      rawRuleText: o.rawRuleText.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 12),
      designerNote: sentences(str(o.designerNote, 'Bold lines. Bolder choices.'), 1),
    };
  })
  .refine((l) => l.labels.length > 0, { message: 'labels must contain at least one valid mark label', path: ['labels'] });

/** Drop labels for ids that don't exist; add `decoration` for marks the model skipped. */
export function reconcileLabels(level: Level, marks: Mark[]): Level {
  const ids = new Set(marks.map((m) => m.id));
  const byId = new Map<number, MarkLabel>();
  for (const l of level.labels) if (ids.has(l.id) && !byId.has(l.id)) byId.set(l.id, l);
  for (const m of marks) if (!byId.has(m.id)) byId.set(m.id, { id: m.id, what: 'mystery doodle', role: 'decoration' });
  return { ...level, labels: [...byId.values()].sort((a, b) => a.id - b.id) };
}

/* ---------- Review ---------- */

export const RunStatsSchema = z.object({
  result: z.enum(['win', 'death', 'timeout']),
  deaths: z.number().int().min(0).max(9999),
  timeSeconds: z.number().min(0).max(36000),
  coins: z.number().int().min(0).max(9999),
  causeOfDeath: z.string().max(80).optional(),
});
export type RunStats = z.infer<typeof RunStatsSchema>;

export const ReviewSchema = z.object({ verdict: z.string(), stars: z.number() });
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewFromModel = z
  .object({ verdict: z.string().min(1), stars: num })
  .transform((r): Review => ({ verdict: sentences(r.verdict, 2), stars: clamp(Math.round(r.stars), 1, 5) }));

/* ---------- Fixer output ---------- */

/** A platform the fixer added so the goal is reachable (normalized coords). */
export type RescuePlatform = { bbox: BBox };

export type PlayableLevel = Level & {
  rescue: RescuePlatform[];
  /** Spawn / goal positions in normalized coords (bottom-center of the sprite). */
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
};
