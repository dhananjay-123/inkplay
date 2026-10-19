/**
 * The drawing conventions, each with a little hand-drawn glyph. Shared by
 * /guide (full) and /create (compact legend).
 */

type Glyph = () => React.ReactElement;

const svg = (children: React.ReactNode, label: string) => (
  <svg viewBox="0 0 64 48" className="h-12 w-16 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
    {children}
  </svg>
);

const Line: Glyph = () => svg(<path d="M6 30 C 20 27, 40 33, 58 29" />, 'a straight line');
const Zigzag: Glyph = () => svg(<path d="M6 36 L14 18 L22 36 L30 18 L38 36 L46 18 L54 36" stroke="var(--hazard)" />, 'a zigzag');
const P: Glyph = () => svg(<path d="M24 40 L24 9 C 44 6, 46 24, 25 25" strokeWidth="3.5" />, 'the letter P');
const Goal: Glyph = () =>
  svg(<path d="M32 6 L37 18 L50 19 L40 27 L44 40 L32 32 L20 40 L24 27 L14 19 L27 18 Z" />, 'a star');
const Coin: Glyph = () =>
  svg(<><path d="M40 14 C 34 9, 22 11, 24 19 C 26 26, 41 22, 41 31 C 41 39, 27 40, 22 34" /><path d="M32 6 L32 42" /></>, 'a dollar sign');
const Enemy: Glyph = () =>
  svg(<><path d="M28 9 L12 9 L12 39 L28 39 M12 24 L24 24" stroke="var(--hazard)" /><path d="M36 24 L58 24 M50 17 L58 24 L50 31" /></>, 'the letter E with an arrow');
const Doodle: Glyph = () =>
  svg(
    <>
      <path d="M32 42 L32 10 C 32 6, 38 6, 38 10 L38 42 M32 26 L24 26 L24 18 M38 22 L46 22 L46 14" />
      <path d="M18 42 L50 42" />
    </>,
    'a cactus',
  );
const Words: Glyph = () =>
  svg(<text x="4" y="31" fontSize="15" stroke="none" fill="currentColor" className="font-hand">low grav</text>, 'handwritten words');

export const SYMBOLS = [
  { Glyph: Line, mark: 'straight line', becomes: 'ground / platform', note: 'the hero runs on your actual stroke; slanted lines become ramps' },
  { Glyph: Zigzag, mark: 'zigzag', becomes: 'spikes', note: 'touch it and you pop' },
  { Glyph: P, mark: 'P', becomes: 'you, the player', note: 'a stick figure works too' },
  { Glyph: Goal, mark: 'G or ★', becomes: 'goal', note: 'flags and doors work too' },
  { Glyph: Coin, mark: '$', becomes: 'coin', note: 'the $ you drew is what vanishes' },
  { Glyph: Enemy, mark: 'E (+ arrow)', becomes: 'enemy', note: 'the arrow sets its direction' },
  { Glyph: Doodle, mark: 'anything else', becomes: 'the AI decides', note: 'cactus = hazard, cloud = platform, dog = enemy…' },
  { Glyph: Words, mark: 'words', becomes: 'rules', note: 'write them anywhere on the page' },
] as const;

/** Compact legend for /create. */
export function SymbolLegend() {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {SYMBOLS.map(({ Glyph, mark, becomes }) => (
        <li key={mark} className="flex items-center gap-3">
          <Glyph />
          <span className="leading-tight">
            <span className="font-hand block text-lg">{mark}</span>
            <span className="block text-sm font-semibold text-pop">{becomes}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
