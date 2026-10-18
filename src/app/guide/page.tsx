import Link from 'next/link';
import { SYMBOLS } from '@/components/guide/symbols';

export const metadata = { title: 'How to draw a level' };

const OPEN_VOCAB = [
  ['cactus, fire, lava, saw', 'hazard'],
  ['trampoline, spring, mushroom', 'bouncy'],
  ['cloud, box, brick, log', 'platform'],
  ['dog, monster, ghost', 'enemy (walks or chases)'],
  ['bird, bat, bee', 'flying enemy'],
  ['chai cup, heart, star-burst', 'power-up'],
  ['gem, apple, key', 'collectible'],
  ['flag, door, trophy', 'goal'],
  ['trees, sun, your signature', 'decoration (ignored)'],
] as const;

const RULES = [
  ['low gravity · moon jump', 'everything floats'],
  ['heavy gravity', 'you fall like a brick'],
  ['upside down', 'gravity flips'],
  ['super speed · slow motion', 'player speed up / down'],
  ['big jumps · tiny hops', 'jump power'],
  ['fast enemies · sleepy enemies', 'enemy speed'],
  ['enemies get faster', 'enemies speed up over time'],
  ['45 second limit', 'countdown timer (10–300 s)'],
  ['coins = speed boost', 'pickups give speed boost, double jump, shield, tiny or giant'],
  ['boss: angry uncle throws rotis', 'a boss fight with that name and attack'],
  ["it's night", 'night mode, you carry a torch'],
  ['mirror world', 'left and right swap'],
] as const;

const TIPS = [
  'One dark pen on plain or lightly ruled paper. Pencil is too faint.',
  'Draw landscape, roughly 16:9. Keep doodles a thumb-width apart so they read as separate things.',
  'Put the P on or just above a line, and the goal somewhere reachable. Gemma adds a rescue platform if it is not.',
  'Write rules in a corner, away from the level, in short phrases.',
  'Photo: even light, no harsh shadow, the whole page in frame. INKPLAY flattens the angle for you.',
] as const;

export default function GuidePage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-8">
      <p className="label text-graphite">guide</p>
      <h1 className="font-display mt-3 text-5xl font-extrabold tracking-tight sm:text-7xl">How to draw a level</h1>
      <p className="font-hand mt-4 max-w-2xl text-xl text-graphite">
        These symbols always work. Beyond them, just draw what you mean. Gemma reads doodles, not a fixed legend.
      </p>

      {/* ------------------------------------------------------------ symbols */}
      <h2 className="font-display mt-14 text-3xl font-extrabold tracking-tight sm:text-4xl">1 · The symbols</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {SYMBOLS.map(({ Glyph, mark, becomes, note }) => (
          <li key={mark} className="flex items-center gap-5 rounded-sm bg-card p-4 shadow-[var(--shadow)] ring-1 ring-ink/10">
            <Glyph />
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-hand text-2xl">{mark}</span>
                <span className="label text-graphite">→ {becomes}</span>
              </p>
              <p className="mt-1 text-sm text-graphite">{note}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------ open vocabulary */}
      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-4xl">2 · Or just draw things</h2>
      <p className="mt-3 max-w-2xl text-graphite">Common sense decides the role. Some examples Gemma gets right:</p>
      <dl className="mt-6 divide-y divide-ink/10 border-y border-ink/10">
        {OPEN_VOCAB.map(([drawn, role]) => (
          <div key={drawn} className="grid gap-1 py-3 sm:grid-cols-[1fr_1fr]">
            <dt className="font-hand text-xl">{drawn}</dt>
            <dd className="label self-center text-graphite">→ {role}</dd>
          </div>
        ))}
      </dl>

      {/* ------------------------------------------------------------ rules */}
      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-4xl">3 · Write the rules</h2>
      <p className="mt-3 max-w-2xl text-graphite">
        Any wording works; Gemma maps it to the closest rule below. Anything that isn&apos;t on this list is politely ignored.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {RULES.map(([write, effect]) => (
          <li key={write} className="rounded-sm border border-dashed border-ink/25 px-4 py-3">
            <p className="font-hand text-xl">“{write}”</p>
            <p className="label mt-1 text-[0.62rem] text-graphite">{effect}</p>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------------- tips */}
      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-4xl">4 · Snap it</h2>
      <ol className="mt-6 space-y-3">
        {TIPS.map((t, i) => (
          <li key={t} className="flex gap-4 text-lg">
            <span className="label mt-1.5 text-graphite">{String(i + 1).padStart(2, '0')}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>

      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-4xl">5 · Play</h2>
      <p className="mt-3 max-w-2xl text-lg text-graphite">Arrows or WASD to move, Space or ↑ to jump. On a phone, use the on-screen buttons.</p>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link href="/create" className="label rounded-full bg-ink px-6 py-4 text-paper">
          Start drawing →
        </Link>
        <Link href="/create#samples" className="label px-2 py-4 text-graphite hover:text-ink">
          or see the samples
        </Link>
      </div>
    </section>
  );
}
