import Link from 'next/link';
import type { SavedLevel } from '@/lib/api-types';

const fmtTime = (s: number) => (s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

/** One saved drawing, pinned to the page like a polaroid. */
export function DoodleCard({ level, index }: { level: SavedLevel; index: number }) {
  // Deterministic tilt so server and client agree.
  const tilt = ((index * 37) % 7) - 3;
  const winRate = level.plays ? Math.round((level.wins / level.plays) * 100) : null;
  return (
    <Link
      href={`/play/${level.id}`}
      style={{ '--tilt': `${tilt * 0.6}deg` } as React.CSSProperties}
      className="doodle-card group mb-6 block break-inside-avoid rounded-sm bg-card p-3 pb-4 shadow-[var(--shadow)]"
    >
      <div className="relative overflow-hidden rounded-[2px] bg-paper-deep">
        {/* Supabase public URL; next/image would need remotePatterns per project. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={level.imageUrl}
          alt={`Hand-drawn level: ${level.title}`}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full mix-blend-multiply transition-transform duration-500 group-hover:scale-[1.03] dark:mix-blend-normal dark:invert"
        />
        <span className="label absolute top-2 right-2 rounded-full bg-accent px-2 py-1 text-[0.6rem] text-accent-ink opacity-0 transition-opacity group-hover:opacity-100">
          Play →
        </span>
      </div>
      <h2 className="font-hand mt-3 text-2xl leading-tight">{level.title}</h2>
      <p className="label mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6rem] text-graphite">
        <span>diff {level.difficulty}/10</span>
        <span>{level.plays} plays</span>
        {winRate !== null && <span>{winRate}% cleared</span>}
        {level.bestTime !== null && <span>best {fmtTime(level.bestTime)}</span>}
      </p>
    </Link>
  );
}
