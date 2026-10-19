/**
 * Little ink doodles that come alive when their row is hovered, focused or
 * tapped (CSS only: see `.doodle-*` in globals.css). Server-renderable.
 */

export type DoodleKind = 'cactus' | 'trampoline' | 'cloud' | 'dog' | 'chai';

const base = 'h-14 w-20 shrink-0 overflow-visible text-ink';
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function Doodle({ kind }: { kind: DoodleKind }) {
  switch (kind) {
    case 'cactus':
      return (
        <svg viewBox="0 0 80 56" className={`${base} doodle-cactus`} aria-hidden>
          <g className="dd-sway" {...stroke}>
            <path d="M36 52 V14 c0-8 10-8 10 0 V52" />
            <path d="M36 34 h-8 c-4 0-5-3-5-6 V20 c0-5 7-5 7 0 v8" />
            <path d="M46 28 h7 c4 0 5-3 5-6 v-6 c0-5-7-5-7 0 v6" />
            <g className="dd-spines" stroke="var(--hazard)" strokeWidth="2.2">
              <path d="M33 22 l-4 -2 M49 18 l4 -2 M33 40 l-4 1 M49 38 l4 1 M41 8 v-4" />
            </g>
          </g>
          <path d="M14 52 H66" {...stroke} />
        </svg>
      );
    case 'trampoline':
      return (
        <svg viewBox="0 0 80 56" className={`${base} doodle-trampoline`} aria-hidden>
          <g {...stroke}>
            <path d="M16 52 L22 34 M64 52 L58 34" />
            <path className="dd-mat" d="M14 34 Q 40 34 66 34" />
            <circle className="dd-ball" cx="40" cy="20" r="7" fill="var(--sun)" />
          </g>
        </svg>
      );
    case 'cloud':
      return (
        <svg viewBox="0 0 80 56" className={`${base} doodle-cloud`} aria-hidden>
          <g className="dd-drift" {...stroke}>
            <path d="M20 40 c-10 0 -12 -14 -2 -16 c0 -12 18 -14 22 -4 c6 -8 22 -4 20 8 c10 2 9 12 0 12 z" fill="var(--card)" />
          </g>
          <g className="dd-hop" {...stroke}>
            <ellipse cx="40" cy="20" rx="5" ry="6" fill="currentColor" stroke="none" />
          </g>
        </svg>
      );
    case 'dog':
      return (
        <svg viewBox="0 0 80 56" className={`${base} doodle-dog`} aria-hidden>
          <g className="dd-trot" {...stroke}>
            <path d="M22 30 h30 c4 0 6 3 6 6 v2 h-36 z" />
            <path d="M58 32 c2 -10 10 -12 14 -6 c2 4 0 8 -6 8" />
            <path d="M64 24 l-2 -6 l5 3" />
            <circle cx="66" cy="29" r="1.2" fill="currentColor" />
            <path className="dd-tail" d="M22 32 c-6 -2 -8 -8 -6 -12" />
            <path className="dd-leg-a" d="M26 38 v12 M50 38 v12" />
            <path className="dd-leg-b" d="M32 38 v12 M56 38 v12" />
          </g>
        </svg>
      );
    case 'chai':
      return (
        <svg viewBox="0 0 80 56" className={`${base} doodle-chai`} aria-hidden>
          <g {...stroke}>
            <path d="M24 26 h28 l-3 24 h-22 z" fill="var(--sun)" fillOpacity="0.35" />
            <path d="M52 30 c8 0 8 12 -2 12" />
            <g className="dd-steam" strokeWidth="2.4">
              <path d="M31 20 c-3 -4 3 -6 0 -10" />
              <path d="M38 20 c-3 -4 3 -6 0 -10" />
              <path d="M45 20 c-3 -4 3 -6 0 -10" />
            </g>
          </g>
        </svg>
      );
  }
}

/** Animated icons for Draw / Snap / Play (play when their Reveal enters). */
export function StepIcon({ step }: { step: 'draw' | 'snap' | 'play' }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (step === 'draw')
    return (
      <svg viewBox="0 0 96 64" className="step-icon step-draw h-16 w-24" aria-hidden>
        <path className="si-line" pathLength={1} d="M6 50 C 20 36, 30 58, 44 44 S 66 34, 72 46" {...s} stroke="var(--pop)" />
        <g className="si-pencil" {...s}>
          <path d="M60 46 L84 14 l8 6 L68 52 z" fill="var(--sun)" />
          <path d="M60 46 l-2 10 l10 -4" />
          <path d="M80 19 l8 6" />
        </g>
      </svg>
    );
  if (step === 'snap')
    return (
      <svg viewBox="0 0 96 64" className="step-icon step-snap h-16 w-24" aria-hidden>
        <g {...s}>
          <rect x="14" y="18" width="62" height="40" rx="6" />
          <path d="M32 18 l5 -8 h16 l5 8" />
          <circle cx="45" cy="38" r="11" />
          <circle cx="45" cy="38" r="4" fill="currentColor" />
        </g>
        <g className="si-flash" stroke="var(--hazard)" strokeWidth="3.5" strokeLinecap="round">
          <path d="M84 12 l8 -6 M86 22 h9 M80 4 l2 -4" />
        </g>
      </svg>
    );
  return (
    <svg viewBox="0 0 96 64" className="step-icon step-play h-16 w-24" aria-hidden>
      <g {...s}>
        <path d="M22 20 h52 c10 0 16 10 14 22 c-2 12 -10 16 -16 10 l-8 -8 h-32 l-8 8 c-6 6 -14 2 -16 -10 c-2 -12 4 -22 14 -22 z" />
        <path d="M28 30 v12 M22 36 h12" />
      </g>
      <circle className="si-btn-a" cx="64" cy="31" r="4.5" fill="var(--hazard)" />
      <circle className="si-btn-b" cx="72" cy="39" r="4.5" fill="var(--sky)" />
    </svg>
  );
}

/** A handwritten margin note with a drawn arrow. */
export function MarginNote({ children, className = '', arrow = 'left' }: { children: React.ReactNode; className?: string; arrow?: 'left' | 'down' | 'right' }) {
  const d =
    arrow === 'left'
      ? 'M58 10 C 40 4, 18 8, 6 20 M6 20 l2 -10 M6 20 l10 -1'
      : arrow === 'right'
        ? 'M4 10 C 22 4, 44 8, 56 20 M56 20 l-2 -10 M56 20 l-10 -1'
        : 'M30 2 C 22 14, 24 26, 32 38 M32 38 l-9 -4 M32 38 l3 -9';
  return (
    <span className={`margin-note pointer-events-none inline-flex items-center gap-2 font-hand text-lg text-pop ${className}`}>
      {arrow === 'left' && (
        <svg viewBox="0 0 62 40" className="h-7 w-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path pathLength={1} className="mn-path" d={d} />
        </svg>
      )}
      <span className="rotate-[-3deg]">{children}</span>
      {arrow !== 'left' && (
        <svg viewBox="0 0 62 40" className="h-7 w-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path pathLength={1} className="mn-path" d={d} />
        </svg>
      )}
    </span>
  );
}
