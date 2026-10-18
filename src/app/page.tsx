import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DoodleCard } from '@/components/gallery/doodle-card';
import { HeroDoodle } from '@/components/home/hero-doodle';
import { Reveal, Scribble } from '@/components/home/reveal';
import { hasSupabase } from '@/lib/env';
import { listLevels } from '@/lib/supabase/server';

const MEANING = [
  { drawn: 'cactus', role: 'hazard', note: 'ouch' },
  { drawn: 'trampoline', role: 'bouncy', note: 'boing' },
  { drawn: 'cloud', role: 'platform', note: 'surprisingly solid' },
  { drawn: 'dog', role: 'enemy', note: 'chases you' },
  { drawn: 'chai cup', role: 'power-up', note: 'obviously' },
] as const;

const ROLE_CHIP: Record<(typeof MEANING)[number]['role'], string> = {
  hazard: 'bg-hazard text-white',
  enemy: 'bg-hazard text-white',
  bouncy: 'bg-sun text-accent-ink',
  platform: 'bg-sky text-accent-ink',
  'power-up': 'bg-pop text-white',
};

const RULES = [
  { written: 'low gravity', becomes: 'gravity × 0.55' },
  { written: 'enemies get faster', becomes: 'enemy speed ramps over time' },
  { written: 'coins = speed boost', becomes: 'pickups → player speed × 1.4' },
  { written: 'boss: angry mess uncle throws rotis', becomes: 'boss fight, projectile = roti' },
  { written: 'its night', becomes: 'night mode, torch radius' },
] as const;

const STEPS = [
  { n: '01', t: 'Draw', d: 'Any paper, any single pen. A line is ground, a zigzag is spikes, P is you. Everything else, Gemma works out.' },
  { n: '02', t: 'Snap', d: 'Upload or point your camera. OpenCV cleans the page and numbers every mark so Gemma can point at them.' },
  { n: '03', t: 'Play', d: 'Your own ink becomes the level. Your dog walks, your coins vanish, and Gemma roasts your run at the end.' },
] as const;

export default function Home() {
  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pt-10 pb-20 sm:px-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="font-display text-[clamp(4rem,14vw,10.5rem)] leading-[0.85] font-extrabold tracking-[-0.04em]">INKPLAY</h1>
          <p className="font-display mt-6 max-w-xl text-2xl sm:text-3xl">
            Draw it. <span className="highlight">Write the rules.</span> Play it.
          </p>
          <p className="font-hand mt-4 max-w-md text-xl text-graphite">
            A pen, a page, and Gemma 4 reading what you <em>meant</em>. In the cloud, or fully offline on a laptop.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/create" className="label inline-flex items-center gap-2 btn-game px-6 py-4">
              Start drawing →
            </Link>
            <Link href="/guide" className="label px-2 py-4 text-graphite hover:text-ink">
              How to draw a level
            </Link>
          </div>
        </div>
        <HeroDoodle />
      </section>

      {/* ------------------------------------------------- colours vs meaning */}
      <section className="border-y border-ink/10 bg-paper-deep/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-8">
          <Reveal>
            <p className="label text-graphite">what&apos;s new</p>
            <h2 className="font-display relative mt-3 inline-block text-4xl font-extrabold tracking-tight sm:text-6xl">
              They read colours. We read <span className="relative inline-block">meaning.<Scribble className="absolute -bottom-3 left-0 h-4 w-full text-hazard" /></span>
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-8 md:grid-cols-[1fr_2fr]">
            <Reveal className="rounded-sm border border-dashed border-graphite/50 p-6">
              <p className="label text-graphite">other draw-a-game apps</p>
              <ul className="mt-5 space-y-3 font-mono text-sm">
                <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#d33]" aria-hidden />red marker = lava</li>
                <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#36c]" aria-hidden />blue marker = water</li>
                <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#3a3]" aria-hidden />green marker = goal</li>
              </ul>
              <p className="font-hand mt-6 text-lg text-graphite">Learn the legend. Buy the markers. Draw what the app expects.</p>
            </Reveal>
            <Reveal className="rounded-sm bg-card p-6 shadow-[var(--shadow)]">
              <p className="label text-graphite">inkplay · one pen, no legend</p>
              <ul className="mt-5 divide-y divide-ink/10">
                {MEANING.map((m) => (
                  <li key={m.drawn} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                    <span className="font-hand w-32 text-2xl">{m.drawn}</span>
                    <span className="label text-graphite">→</span>
                    <span className={`label rounded-full px-2.5 py-1 ${ROLE_CHIP[m.role]}`}>{m.role}</span>
                    <span className="font-hand ml-auto text-lg text-graphite">{m.note}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ write the rules */}
      <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-8">
        <Reveal>
          <p className="label text-graphite">rules are words</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold tracking-tight sm:text-6xl">Write the rules in the margin.</h2>
          <p className="mt-4 max-w-2xl text-lg text-graphite">
            Gemma turns handwriting into mechanics, but only from a whitelisted set of rule types with every number clamped on the server.
            Rules are data, never code.
          </p>
        </Reveal>
        <ol className="mt-12 space-y-4">
          {RULES.map((r, i) => (
            <Reveal as="li" key={r.written} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
              <span className="font-hand text-3xl" style={{ transform: `rotate(${(i % 2 ? 1 : -1) * 1.2}deg)` }}>“{r.written}”</span>
              <span className="label text-graphite" aria-hidden>
                ——→
              </span>
              <code className="label w-fit rounded-sm border border-ink/15 bg-card px-3 py-2 text-ink">{r.becomes}</code>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* -------------------------------------------------------------- steps */}
      <section className="bg-ink text-paper">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-24 sm:px-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <Reveal key={s.n}>
              <p className="label text-accent">{s.n}</p>
              <h3 className="font-display mt-2 text-5xl font-extrabold tracking-tight">{s.t}</h3>
              <p className="mt-4 text-paper/75">{s.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ offline */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-24 sm:px-8 md:grid-cols-2">
        <Reveal>
          <p className="label text-graphite">open + offline</p>
          <h2 className="font-display mt-3 text-4xl font-extrabold tracking-tight sm:text-6xl">
            Pull the Wi-Fi. <span className="highlight">Keep playing.</span>
          </h2>
          <p className="mt-4 text-lg text-graphite">
            The same open Gemma 4 family runs this site in the cloud and runs on a laptop through Ollama. Fonts, OpenCV, samples and sounds ship
            with the app. The gallery needs a database; the game never does.
          </p>
        </Reveal>
        <Reveal className="self-center rounded-sm bg-card p-6 font-mono text-sm shadow-[var(--shadow)]">
          <p className="label text-graphite">terminal</p>
          <pre className="mt-4 overflow-x-auto leading-7 whitespace-pre">
            <span className="text-graphite">$</span> ollama pull gemma4:e4b{'\n'}
            <span className="text-graphite">$</span> pnpm build{'\n'}
            <span className="text-graphite">$</span> pnpm demo{'   '}
            <span className="text-graphite"># MODEL_PROVIDER=ollama</span>
          </pre>
          <p className="font-hand mt-4 text-lg text-graphite">airplane mode: on. fun: unaffected.</p>
        </Reveal>
      </section>

      {/* ------------------------------------------------------ gallery peek */}
      <Suspense fallback={null}>
        <GalleryPeek />
      </Suspense>

      <footer className="mt-auto border-t border-ink/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-8">
          <p className="label text-graphite">INKPLAY · MIT · built with Gemma 4 for Hacktoberfest Hack Day Gwalior</p>
          <Link href="/about" className="label text-graphite hover:text-ink">
            How it works →
          </Link>
        </div>
      </footer>
    </>
  );
}

/** Latest doodles; hidden entirely without Supabase or on any failure. */
async function GalleryPeek() {
  await connection();
  if (!hasSupabase) return null;
  const levels = await listLevels(0, 3);
  if (!levels.length) return null;
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Hall of Doodles</h2>
        <Link href="/gallery" className="label text-graphite hover:text-ink">
          See all →
        </Link>
      </div>
      <div className="mt-10 columns-1 gap-6 sm:columns-3">
        {levels.map((l, i) => (
          <DoodleCard key={l.id} level={l} index={i} />
        ))}
      </div>
    </section>
  );
}
