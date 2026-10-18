/**
 * Tiny margin doodles scattered around the page, the kind you draw while
 * waiting for the lecture to end. Decorative only.
 */

type Kind = 'star' | 'spiral' | 'squiggle' | 'sparkle' | 'heart' | 'arrow';

const PATHS: Record<Kind, React.ReactNode> = {
  star: <path d="M24 4 L29 18 L44 19 L32 28 L36 43 L24 34 L12 43 L16 28 L4 19 L19 18 Z" />,
  spiral: <path d="M24 24 c0 -3 4 -3 4 0 c0 6 -9 6 -9 0 c0 -9 14 -9 14 0 c0 12 -19 12 -19 0 c0 -15 24 -15 24 0" />,
  squiggle: <path d="M4 28 C 10 14, 16 42, 22 28 S 34 14, 40 28" />,
  sparkle: <path d="M24 6 V18 M24 30 V42 M6 24 H18 M30 24 H42 M12 12 L17 17 M31 31 L36 36 M36 12 L31 17 M17 31 L12 36" />,
  heart: <path d="M24 40 C 8 30, 4 18, 12 12 C 18 8, 23 12, 24 17 C 25 12, 30 8, 36 12 C 44 18, 40 30, 24 40 Z" />,
  arrow: <path d="M6 34 C 16 10, 32 8, 42 20 M42 20 L32 19 M42 20 L40 10" />,
};

export function Scrawl({ kind, className = '', fill = 'none' }: { kind: Kind; className?: string; fill?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`pointer-events-none ${className}`}
      fill={fill}
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[kind]}
    </svg>
  );
}
