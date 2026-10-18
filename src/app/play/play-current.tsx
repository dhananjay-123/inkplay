'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PlayScreen } from '@/components/game/play-screen';
import { useInkplay } from '@/lib/store';

export function PlayCurrent() {
  const current = useInkplay((s) => s.current);
  // Wait for sessionStorage rehydration before deciding there's no level.
  const [hydrated, setHydrated] = useState(() => useInkplay.persist.hasHydrated());
  useEffect(() => useInkplay.persist.onFinishHydration(() => setHydrated(true)), []);

  if (!hydrated) return null;
  if (!current) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-24 text-center">
        <h1 className="font-display text-5xl font-extrabold tracking-tight">Nothing on the page yet.</h1>
        <p className="font-hand mt-4 text-2xl text-graphite">Draw something first. Gemma is ready with a red pen.</p>
        <Link href="/create" className="label mt-8 btn-game px-6 py-4">
          Start drawing →
        </Link>
      </section>
    );
  }
  return <PlayScreen data={current} />;
}
