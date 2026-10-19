import type { Level, Mark, MarkLabel } from '@/lib/schema';

/**
 * MODEL_PROVIDER=mock — geometry-only heuristics, no model.
 *
 * Dev/test only: lets the draw → play loop run without credentials. It cannot
 * read words or recognise doodles, and the UI labels it as "mock" so it is
 * never mistaken for a real model.
 */
export function mockLevel(marks: Mark[]): Level {
  const labels: MarkLabel[] = [];
  const compact = marks.filter((m) => m.aspect <= 4);
  const textLike = new Set(
    compact.filter((m) => m.bbox.y < 0.3 && m.aspect > 2).map((m) => m.id),
  );
  const objects = compact.filter((m) => !textLike.has(m.id));
  const player = [...objects].sort((a, b) => a.bbox.x + (1 - a.bbox.y) * 0.3 - (b.bbox.x + (1 - b.bbox.y) * 0.3))[0];
  const goal = [...objects].filter((m) => m !== player).sort((a, b) => b.bbox.x - b.bbox.y * 0.3 - (a.bbox.x - a.bbox.y * 0.3))[0];

  for (const m of marks) {
    if (m.aspect > 4) labels.push({ id: m.id, what: 'line', role: 'platform' });
    else if (textLike.has(m.id)) labels.push({ id: m.id, what: 'words', role: 'rule_text' });
    else if (m === player) labels.push({ id: m.id, what: 'hero', role: 'player' });
    else if (m === goal) labels.push({ id: m.id, what: 'finish', role: 'goal' });
    else if (m.bbox.w * m.bbox.h < 0.004) labels.push({ id: m.id, what: 'small thing', role: 'collectible' });
    else labels.push({ id: m.id, what: 'doodle', role: 'decoration' });
  }
  return {
    title: 'Mock Mode Level',
    story: 'No model is connected, so this level was guessed from shapes alone.',
    difficulty: 3,
    labels,
    rules: [],
    rawRuleText: [],
    designerNote: 'Mock provider: connect a model to read words and doodles.',
  };
}
