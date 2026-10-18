import Link from 'next/link';
import { StickerGlyph } from '@/components/create/scene-svg';
import { SYMBOLS } from '@/components/guide/symbols';

export const metadata = { title: 'How to draw a level' };

/* What you draw, which role Gemma gives it, and what that does in the game. */
const OPEN_VOCAB = [
  { glyph: 'cactus', drawn: 'cactus, fire, lava, saw', role: 'hazard', chip: 'bg-hazard', what: 'touch it and you pop' },
  { glyph: 'trampoline', drawn: 'trampoline, spring, mushroom', role: 'bouncy', chip: 'bg-sun', what: 'launches you up high' },
  { glyph: 'cloud', drawn: 'cloud, box, brick, log', role: 'platform', chip: 'bg-sky', what: 'solid, you can stand on it' },
  { glyph: 'dog', drawn: 'dog, monster, ghost', role: 'enemy', chip: 'bg-hazard', what: 'walks back and forth, or chases you' },
  { glyph: 'bat', drawn: 'bird, bat, bee', role: 'flying enemy', chip: 'bg-hazard', what: 'comes at you through the air' },
  { glyph: 'chai', drawn: 'chai cup, heart, star-burst', role: 'power-up', chip: 'bg-pop text-white', what: 'grab it for a boost' },
  { glyph: 'gem', drawn: 'gem, apple, key', role: 'collectible', chip: 'bg-accent', what: 'counts as a coin' },
  { glyph: 'door', drawn: 'flag, door, trophy', role: 'goal', chip: 'bg-accent', what: 'reach it to win' },
  { glyph: 'tree', drawn: 'trees, sun, your signature', role: 'decoration', chip: 'bg-paper-deep', what: 'just scenery, ignored' },
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
  'Put the P on or just above a line, and the goal somewhere reachable. INKPLAY adds a rescue platform if it is not.',
  'Write rules in a corner, away from the level, in short phrases.',
  'Photo: even light, no harsh shadow, the whole page in frame. INKPLAY flattens the angle for you.',
  'No paper? Open the canvas on the Create page and draw with a mouse, a pen tablet or your finger. Same rules apply.',
] as const;

const ARENA_KEYS = [
  ['A / D or ← →', 'move'],
  ['W, ↑ or Space', 'jump, hold to jetpack'],
  ['autofire', 'aims at the nearest enemy you can see'],
  ['F', 'autofire off: aim with the mouse, click to fire'],
  ['G, Q or right-click', 'throw a grenade'],
  ['R', 'reload'],
] as const;

export default function GuidePage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-8">
      <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">
        How to draw a <span className="highlight">level</span>
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-graphite">
        These symbols always work. Beyond them, just draw what you mean. Gemma reads doodles, not a fixed legend.
      </p>

      {/* ------------------------------------------------------------ symbols */}
      <Heading n={1} className="mt-16">The symbols</Heading>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {SYMBOLS.map(({ Glyph, mark, becomes, note }) => (
          <li key={mark} className="sketch flex items-center gap-5 p-4">
            <Glyph />
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-hand text-2xl">{mark}</span>
                <span className="font-semibold text-pop">{becomes}</span>
              </p>
              <p className="mt-1 text-sm text-graphite">{note}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------ open vocabulary */}
      <Heading n={2}>Or just draw things</Heading>
      <p className="mt-3 max-w-2xl text-graphite">Common sense decides the role. Some examples Gemma gets right:</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPEN_VOCAB.map((v) => (
          <li key={v.drawn} className="sketch flex items-center gap-4 p-4">
            <StickerGlyph id={v.glyph} className="h-14 w-16 text-ink" />
            <div className="min-w-0">
              <p className="font-hand text-xl leading-tight">{v.drawn}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`rounded-[var(--wobble-btn)] border-2 border-ink px-2.5 py-0.5 text-sm font-bold ${v.chip}`}>{v.role}</span>
                <span className="text-sm text-graphite">{v.what}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------------ rules */}
      <Heading n={3}>Write the rules</Heading>
      <p className="mt-3 max-w-2xl text-graphite">
        Any wording works; Gemma maps it to the closest rule below. Anything that isn&apos;t on this list is politely ignored.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {RULES.map(([write, effect]) => (
          <li key={write} className="rounded-[var(--wobble)] border-2 border-dashed border-ink/25 bg-card/70 px-4 py-3">
            <p className="font-hand text-xl">“{write}”</p>
            <p className="mt-1 text-sm text-graphite">{effect}</p>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------------- tips */}
      <Heading n={4}>Snap it</Heading>
      <ol className="mt-6 space-y-3">
        {TIPS.map((t, i) => (
          <li key={t} className="flex gap-4 text-lg">
            <span className="font-hand mt-0.5 w-5 shrink-0 text-xl text-pop">{i + 1}.</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>

      <Heading n={5}>Play</Heading>
      <p className="mt-3 max-w-2xl text-lg text-graphite">Arrows or WASD to move, Space or ↑ to jump. On a phone, use the on-screen buttons.</p>

      <Heading n={6}>Bring friends to the arena</Heading>
      <p className="mt-3 max-w-2xl text-lg text-graphite">
        Ink Arena is a jetpack shooter on a map Gemma designs. Pick a name and a scarf colour, start a room and share the code. Give Gemma a theme
        like “hostel rooftops”, hand it a drawing (zigzags stay spikes) or let it surprise you. No one free? Add up to 8 bots.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {ARENA_KEYS.map(([key, does]) => (
          <li key={key} className="rounded-[var(--wobble)] border-2 border-dashed border-ink/25 bg-card/70 px-4 py-3">
            <p className="label">{key}</p>
            <p className="mt-1 text-graphite">{does}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-2xl text-graphite">
        Walk over crates for a rifle, flamethrower, chainsaw, rockets, a shield, speed, double jump, endless jet or double damage. Watch for
        lava, currents, spikes, crumbling floors and monsters. On a phone, turn it sideways for full screen and touch controls.
      </p>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link href="/create" className="btn-game px-6 py-3.5 text-lg">
          Start drawing
        </Link>
        <Link href="/create#samples" className="font-hand link-scrawl self-center text-xl text-ink">
          or try a sample
        </Link>
        <Link href="/arena" className="font-hand link-scrawl self-center text-xl text-ink">
          or open the arena
        </Link>
      </div>
    </section>
  );
}

function Heading({ n, children, className = 'mt-20' }: { n: number; children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`font-display flex items-center gap-4 text-3xl font-extrabold tracking-tight sm:text-4xl ${className}`}>
      <span className="circled font-hand text-xl font-normal text-pop">{n}</span>
      {children}
    </h2>
  );
}
