import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DoodleCard } from '@/components/gallery/doodle-card';
import { Doodle, MarginNote, StepIcon } from '@/components/home/doodles';
import { HeroDoodle } from '@/components/home/hero-doodle';
import { IntroFilm } from '@/components/home/intro-film';
import { Reveal, Scribble } from '@/components/home/reveal';
import { RulesPlayground } from '@/components/home/rules-playground';
import { Scrawl } from '@/components/home/scribbles';
import { hasSupabase } from '@/lib/env';
import { listLevels } from '@/lib/supabase/server';

const MEANING = [
  { drawn: 'cactus', kind: 'cactus', role: 'hazard', note: 'ouch' },
  { drawn: 'trampoline', kind: 'trampoline', role: 'bouncy', note: 'boing' },
  { drawn: 'cloud', kind: 'cloud', role: 'platform', note: 'surprisingly solid' },
  { drawn: 'dog', kind: 'dog', role: 'enemy', note: 'chases you' },
  { drawn: 'chai cup', kind: 'chai', role: 'power-up', note: 'obviously' },
] as const;

const ROLE_CHIP: Record<(typeof MEANING)[number]['role'], string> = {
  hazard: 'bg-hazard text-accent-ink',
  enemy: 'bg-hazard text-accent-ink',
  bouncy: 'bg-sun text-accent-ink',
  platform: 'bg-sky text-accent-ink',
  'power-up': 'bg-pop text-white',
};

const STEPS = [
  { icon: 'draw', t: 'Draw', tilt: -2, tape: '', d: 'Any paper, one dark pen. A line is ground, a zigzag is spikes, P is you. The AI works out the rest.' },
  { icon: 'snap', t: 'Snap', tilt: 1.5, tape: 'tape-pink', d: 'Upload a photo of the page, or skip the paper and draw it on the canvas here. Every mark gets a number so the AI can point at it.' },
  { icon: 'play', t: 'Play', tilt: -1, tape: 'tape-blue', d: 'Your own ink is the level. The dog you drew walks, the coins you drew vanish, and you get a review of your run at the end.' },
] as const;

/* Each letter of the wordmark is stuck on slightly crooked. */
const LETTERS = [
  { c: 'I', r: -4, y: 0 },
  { c: 'N', r: 3, y: -6 },
  { c: 'K', r: -2, y: 4 },
  { c: 'P', r: 5, y: -3 },
  { c: 'L', r: -3, y: 5 },
  { c: 'A', r: 2, y: -4 },
  { c: 'Y', r: -6, y: 2 },
];

export default function Home() {
  return (
    <>
      <IntroFilm />
      {/* ---------------------------------------------------------- hero */}
      <section className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-16 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pt-14 lg:pb-20">
        <Scrawl kind="star" className="bob absolute top-4 right-[46%] hidden h-9 w-9 text-sun lg:block" fill="var(--sun)" />
        <Scrawl kind="spiral" className="bob-slow absolute bottom-6 left-[38%] hidden h-10 w-10 text-pop/60 lg:block" />
        <div className="relative">
          <h1 aria-label="INKPLAY" className="wordmark font-display text-[clamp(3.6rem,15vw,8.25rem)] leading-[0.9] font-extrabold tracking-[-0.03em] whitespace-nowrap">
            {LETTERS.map((l, i) => (
              <span key={i} aria-hidden className="wl" style={{ '--r': `${l.r}deg`, '--y': `${l.y}px` } as React.CSSProperties}>
                {l.c}
              </span>
            ))}
          </h1>
          <p className="font-display mt-6 max-w-xl text-2xl font-semibold sm:text-3xl">
            Draw it. <span className="highlight">Write the rules.</span> Play it.
          </p>
          <p className="mt-4 max-w-md text-lg text-graphite">
            Draw a level on paper, scribble a few rules in the corner and take a photo. INKPLAY reads what you meant, and about fifteen seconds
            later you&apos;re playing it.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5">
            <Link href="/create" className="btn-game px-7 py-4 text-lg">
              Start drawing
              <Scrawl kind="arrow" className="h-6 w-6 rotate-[100deg]" />
            </Link>
            <Link href="/guide" className="font-hand link-scrawl text-xl text-ink">
              how do I draw one?
            </Link>
          </div>
        </div>
        <div className="relative">
          <div className="sketch-soft tape rotate-[1.5deg] p-4 pt-6 sm:p-6">
            <HeroDoodle />
          </div>
          <MarginNote arrow="left" className="absolute -bottom-10 left-6 sm:left-16">
            the P is you
          </MarginNote>
        </div>
      </section>

      {/* ------------------------------------------------- colours vs meaning */}
      <section className="relative bg-paper-deep">
        <TornEdge side="top" />
        <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-8">
          <Reveal>
            <h2 className="font-display relative inline-block text-4xl font-extrabold tracking-tight sm:text-6xl">
              Draw a cactus.{' '}
              <span className="relative inline-block">
                It hurts.
                <Scribble className="absolute -bottom-3 left-0 h-4 w-full text-hazard" />
              </span>
            </h2>
            <p className="mt-5 max-w-2xl text-lg text-graphite">
              Most draw-your-own-game apps make you learn a colour code first. Here you just draw the thing, and the game works out what it does.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-10 md:grid-cols-[1fr_1.8fr] md:items-start">
            <Reveal className="relative rotate-[-2deg] rounded-[var(--wobble)] border-2 border-dashed border-graphite/60 bg-paper p-6">
              <p className="font-hand text-xl text-graphite">the usual way</p>
              <div className="relative mt-4">
                <ul className="space-y-3 font-mono text-sm text-graphite">
                  <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#d33]" aria-hidden />red marker = lava</li>
                  <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#36c]" aria-hidden />blue marker = water</li>
                  <li className="flex items-center gap-3"><span className="h-3 w-8 rounded-sm bg-[#3a3]" aria-hidden />green marker = goal</li>
                </ul>
                {/* crossed out in red pen */}
                <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="pointer-events-none absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] text-hazard" aria-hidden>
                  <path d="M6 20 C 60 40, 130 60, 194 84 M10 86 C 70 60, 120 44, 190 14" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </div>
              <p className="font-hand mt-6 text-lg text-graphite">Learn the legend, buy three markers, draw what the app expects.</p>
            </Reveal>
            <Reveal className="sketch tape tape-pink p-6 sm:p-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-hand text-xl">one pen, no legend</p>
                <MarginNote arrow="down">poke a doodle</MarginNote>
              </div>
              <ul className="mt-3 divide-y-2 divide-dashed divide-ink/10">
                {MEANING.map((m) => (
                  <li key={m.drawn} tabIndex={0} className="meaning-row flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-1 py-2 outline-none focus-visible:bg-paper-deep">
                    <Doodle kind={m.kind} />
                    <span className="font-hand w-28 text-2xl">{m.drawn}</span>
                    <Scrawl kind="squiggle" className="h-5 w-8 text-graphite" />
                    <span className={`rounded-[var(--wobble-btn)] border-2 border-ink px-3 py-0.5 text-sm font-bold ${ROLE_CHIP[m.role]}`}>{m.role}</span>
                    <span className="font-hand ml-auto text-lg text-pop">{m.note}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
        <TornEdge side="bottom" />
      </section>

      {/* ------------------------------------------------------ write the rules */}
      <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-8">
        <Reveal>
          <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
            Write the rules in the <span className="highlight">margin.</span>
          </h2>
          <MarginNote className="mt-3">try “heavy gravity”, then watch the spikes</MarginNote>
          <p className="mt-4 max-w-2xl text-lg text-graphite">
            Your handwriting becomes game mechanics. Write it however you like: low gravity, double jump, the floor is lava. If a rule
            isn&apos;t one the game knows, it&apos;s skipped instead of breaking your level.
          </p>
        </Reveal>
        <Reveal className="mt-12">
          <RulesPlayground />
        </Reveal>
      </section>

      {/* -------------------------------------------------------------- steps */}
      <section className="relative bg-paper-deep">
        <TornEdge side="top" />
        <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-8">
          <Reveal>
            <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">Pen, phone, play.</h2>
          </Reveal>
          <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.t} as="li" className="step">
                <div className={`sketch tape ${s.tape} h-full p-6 pt-8`} style={{ rotate: `${s.tilt}deg` }}>
                  <div className="flex items-start justify-between">
                    <StepIcon step={s.icon} />
                    <span className="circled font-hand text-2xl text-pop">{i + 1}</span>
                  </div>
                  <h3 className="font-display mt-4 text-4xl font-extrabold tracking-tight">{s.t}</h3>
                  <p className="mt-3 text-graphite">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
        <TornEdge side="bottom" />
      </section>

      {/* ------------------------------------------------------- open source */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-24 sm:px-8 md:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
            Free, open, <span className="highlight">yours.</span>
          </h2>
          <p className="mt-4 text-lg text-graphite">
            No account, no ads, nothing to install. INKPLAY is open source, so you can also run your own copy, even on a laptop with the
            Wi-Fi off using a local model. Fonts, the samples and the sounds all ship with the app.
          </p>
        </Reveal>
        <Reveal className="justify-self-center md:justify-self-end">
          <div className="tape relative w-full max-w-sm rotate-[2deg] bg-sun p-6 pt-8 shadow-[var(--shadow)] [border-radius:2px_2px_18px_2px]">
            <p className="font-hand text-xl">run it yourself</p>
            <ol className="mt-3 space-y-1.5 font-mono text-sm">
              <li>1. git clone the repo</li>
              <li>2. pnpm install &amp;&amp; pnpm build</li>
              <li>3. pnpm start</li>
            </ol>
            <a href="https://github.com/dhananjay-123/inkplay" className="font-hand link-scrawl mt-4 inline-block text-lg text-ink">
              setup guide on GitHub
            </a>
          </div>
        </Reveal>
      </section>

      {/* -------------------------------------------------------------- arena */}
      <section className="relative bg-paper-deep">
        <TornEdge side="top" />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-24 sm:px-8 md:grid-cols-[1.4fr_1fr]">
          <Reveal>
            <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
              Bring friends. <span className="highlight">Bring jetpacks.</span>
            </h2>
            <p className="mt-4 max-w-xl text-lg text-graphite">
              Ink Arena is a multiplayer shooter on a map designed from a theme or from your drawing. Share a room code and everyone plays
              the same map live. Autofire aims for you, crates hold rockets and chainsaws, and bots fill the room when your friends are busy.
            </p>
            <Link href="/arena" className="btn-game mt-8 px-6 py-3.5 text-lg">
              Open the arena
            </Link>
          </Reveal>
          <Reveal className="justify-self-center md:justify-self-end">
            <div className="sketch tape tape-blue w-full max-w-xs rotate-[-1.5deg] p-6 pt-8">
              <p className="font-hand text-xl">room code</p>
              <p className="font-display mt-1 text-5xl font-extrabold tracking-[0.12em]">INK42</p>
              <p className="font-hand mt-4 text-lg text-graphite">+ 3 bots, lava on, rockets please</p>
            </div>
          </Reveal>
        </div>
        <TornEdge side="bottom" />
      </section>

      {/* ------------------------------------------------------ gallery peek */}
      <Suspense fallback={null}>
        <GalleryPeek />
      </Suspense>

      <footer className="mt-auto border-t-2 border-dashed border-ink/15">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-8">
          <p className="font-hand text-lg text-graphite">
            INKPLAY is free and open source (MIT).{' '}
            <a href="https://github.com/dhananjay-123/inkplay" className="link-scrawl text-ink">
              Source on GitHub
            </a>
          </p>
          <Link href="/about" className="font-hand link-scrawl text-lg text-ink">
            how it works
          </Link>
        </div>
      </footer>
    </>
  );
}

/** A torn paper edge so the coloured bands look ripped from a pad, not drawn with a ruler. */
function TornEdge({ side }: { side: 'top' | 'bottom' }) {
  // Fixed jitter: same on server and client.
  const jitter = [6, 14, 3, 11, 8, 15, 4, 12, 7, 2, 13, 9, 5, 14, 3, 10, 6, 12, 2, 9, 13, 5, 11, 4];
  const step = 1200 / jitter.length;
  const d = `M0 16 ${jitter.map((y, i) => `L${((i + 0.5) * step).toFixed(0)} ${y}`).join(' ')} L1200 8 L1200 18 L0 18 Z`;
  return (
    <svg
      viewBox="0 0 1200 18"
      preserveAspectRatio="none"
      aria-hidden
      className={`absolute left-0 h-4 w-full text-paper-deep ${side === 'top' ? '-top-[15px]' : '-bottom-[15px] rotate-180'}`}
    >
      <path d={d} fill="currentColor" />
    </svg>
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
        <Link href="/gallery" className="font-hand link-scrawl text-xl text-ink">
          see them all
        </Link>
      </div>
      <div className="mt-12 columns-1 gap-8 sm:columns-3">
        {levels.map((l, i) => (
          <DoodleCard key={l.id} level={l} index={i} />
        ))}
      </div>
    </section>
  );
}
