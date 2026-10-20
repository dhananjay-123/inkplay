import Link from 'next/link';

export const metadata = { title: 'Page not found' };

/** Our own 404, so it stays on paper (Next's default one turns black in dark mode). */
export default function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-2xl justify-items-start gap-5 px-4 py-16 sm:py-24">
      <p className="font-hand text-xl text-pop">page 404, torn out</p>
      <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
        This page <span className="highlight">isn&rsquo;t in the sketchbook.</span>
      </h1>
      <p className="max-w-lg text-lg text-graphite">The link might be old, or the level was never saved. Draw a new one, or go see what other people made.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/create" className="btn-game px-6 py-3">
          Draw a level
        </Link>
        <Link href="/gallery" className="btn-ghost px-5 py-3">
          Open the gallery
        </Link>
        <Link href="/" className="btn-ghost px-5 py-3">
          Home
        </Link>
      </div>
    </div>
  );
}
