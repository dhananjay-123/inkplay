'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SurvivalBus, type SurvivalHud, type SurvivalStats } from '@/game/survival-events';
import { play as sfx, setMuted } from '@/game/sfx';
import { useInkplay } from '@/lib/store';
import { SurvivalGame } from './survival-game';

type Best = { score: number; distance: number; coins: number };
const BEST_KEY = 'inkplay.survival.best';

function loadBest(): Best | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<Best>;
    return typeof b.score === 'number' && typeof b.distance === 'number' ? { score: b.score, distance: b.distance, coins: b.coins ?? 0 } : null;
  } catch {
    return null;
  }
}
function saveBest(b: Best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* private mode: best lives for this page only */
  }
}
/** Stable for the scene: read at the start of every run. */
const bestDistance = () => loadBest()?.distance ?? 0;

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Real full screen where allowed (inside a click), then try to lock landscape. */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {
      /* iOS Safari: the fixed overlay still covers the page */
    });
}
function exitFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

const EMPTY: SurvivalHud = { hp: 100, maxHp: 100, distance: 0, score: 0, coins: 0, pace: 1, effects: [], shield: false };

export function SurvivalClient() {
  const bus = useMemo(() => new SurvivalBus(), []);
  const [hud, setHud] = useState<SurvivalHud>(EMPTY);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'running'>('loading');
  const [end, setEnd] = useState<{ stats: SurvivalStats; best: Best; isBest: boolean } | null>(null);
  const [paused, setPaused] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const muted = useInkplay((s) => s.muted);
  const toggleMuted = useInkplay((s) => s.toggleMuted);

  useEffect(() => setMuted(muted), [muted]);

  useEffect(() => {
    const offs = [
      bus.on('hud', setHud),
      bus.on('ready', () => {
        setEnd(null);
        setPaused(false);
        setHud(EMPTY);
        setPhase('ready');
      }),
      bus.on('started', () => {
        setPhase('running');
        if (isTouch()) setImmersive(true); // phones: the whole screen is the track
      }),
      bus.on('end', (stats) => {
        const prev = loadBest();
        const isBest = !prev || stats.score > prev.score;
        const best = isBest ? { score: stats.score, distance: stats.distance, coins: stats.coins } : prev;
        if (isBest) saveBest(best);
        setEnd({ stats, best, isBest });
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [bus]);

  const pause = useCallback(
    (p: boolean) => {
      setPaused(p);
      bus.emit('pause', p);
    },
    [bus],
  );

  // P / Esc pause; leaving the tab pauses too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (end && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        return bus.emit('restart');
      }
      if (phase !== 'running' || end) return;
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') pause(!paused);
    };
    const onHide = () => {
      if (document.hidden && phase === 'running' && !end) pause(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [phase, paused, end, pause, bus]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && !isTouch()) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleImmersive = () => {
    if (immersive) {
      setImmersive(false);
      exitFullscreen();
    } else {
      setImmersive(true);
      enterFullscreen();
    }
  };

  const again = () => {
    sfx('click');
    bus.emit('restart');
  };

  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const low = hpPct <= 30;

  return (
    <div
      className={
        immersive
          ? 'fixed inset-0 z-[60] flex flex-col bg-paper px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]'
          : 'relative mx-auto flex h-[calc(100dvh-var(--nav-h))] w-full max-w-[1800px] flex-col px-2 pb-2 sm:px-6'
      }
    >
      {/* HUD: hp, distance, coins | actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pb-1.5 sm:pb-2">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display hidden truncate text-2xl font-extrabold tracking-tight sm:block [@media(max-height:520px)]:hidden">Survival</h1>
          <span className="flex shrink-0 items-center gap-1.5" title={`${Math.ceil(hud.hp)} of ${hud.maxHp} HP`}>
            <span className="label text-[0.62rem]">HP</span>
            <span
              className="relative h-3.5 w-24 overflow-hidden rounded-[var(--wobble-btn)] border-2 border-ink bg-card sm:w-36"
              role="meter"
              aria-label="Health"
              aria-valuemin={0}
              aria-valuemax={hud.maxHp}
              aria-valuenow={Math.ceil(hud.hp)}
            >
              <span className={`absolute inset-y-0 left-0 transition-[width] duration-200 ${low ? 'bg-hazard' : 'bg-accent'}`} style={{ width: `${hpPct}%` }} />
            </span>
            <span className="label text-[0.62rem] tabular-nums">{Math.ceil(hud.hp)}</span>
          </span>
          {hud.shield && <span className="label rounded-[var(--wobble-btn)] border-2 border-ink bg-sky px-1.5 text-[0.6rem]">shield</span>}
          {hud.effects.map((e) => (
            <span key={e.name} className="label rounded-[var(--wobble-btn)] border-2 border-ink bg-accent px-1.5 text-[0.6rem] text-accent-ink tabular-nums">
              {e.name} {Math.ceil(e.s)}s
            </span>
          ))}
        </div>
        <div className="label flex shrink-0 items-center gap-2 tabular-nums sm:gap-3 [&_button]:whitespace-nowrap">
          <span title="Distance">{hud.distance} m</span>
          <span title="Coins" className="hidden min-[420px]:inline">$ {hud.coins}</span>
          <span title="Score">{hud.score} pts</span>
          <span title="Speed" className="hidden text-graphite md:inline">x{hud.pace.toFixed(1)}</span>
          {phase === 'running' && !end && (
            <button type="button" onClick={() => pause(!paused)} className="btn-ghost btn-sm px-3 py-1" aria-pressed={paused}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button type="button" onClick={toggleMuted} className="btn-ghost btn-sm hidden px-3 py-1 sm:inline-flex" aria-pressed={!muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" onClick={toggleImmersive} aria-pressed={immersive} className="btn-ghost btn-sm px-3 py-1" title="Full screen">
            {immersive ? 'Exit full' : 'Full screen'}
          </button>
        </div>
      </div>

      {/* game: the largest 16:9 box that fits */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
        <div className="sketch relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] touch-none select-none overflow-hidden">
          <SurvivalGame bus={bus} getBest={bestDistance} className="absolute inset-0" />
          {phase === 'ready' && !end && <ReadyNote />}
          {paused && !end && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-paper/75 backdrop-blur-[2px]">
              <div className="sketch tape grid justify-items-center gap-3 px-8 py-6 pt-8">
                <p className="font-display text-3xl font-extrabold">Paused</p>
                <button type="button" onClick={() => pause(false)} className="btn-game px-5 py-2.5">
                  Keep running
                </button>
              </div>
            </div>
          )}
          {end && <GameOver stats={end.stats} best={end.best} isBest={end.isBest} onAgain={again} />}
        </div>
      </div>

      <div className={`flex items-center gap-4 px-1 pt-2 ${immersive ? 'hidden' : ''} [@media(max-height:520px)]:hidden`}>
        <p className="font-hand min-w-0 flex-1 truncate text-base text-graphite">The page keeps going. How far does your ink get?</p>
        <p className="font-hand hidden shrink-0 text-base text-graphite lg:block">Space or ↑ to jump, ↓ to slide, P to pause, R to restart</p>
      </div>

      {!portraitOk && (
        <div className="pointer-coarse:portrait:grid fixed inset-0 z-[70] hidden place-items-center bg-paper p-8 text-center" role="dialog" aria-label="Rotate your phone">
          <div className="grid justify-items-center gap-4">
            <svg viewBox="0 0 64 64" className="h-20 w-20 animate-[spin_2.4s_ease-in-out_infinite] motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <rect x="20" y="8" width="24" height="44" rx="4" />
              <path d="M29 46h6" />
            </svg>
            <p className="font-display text-3xl font-extrabold">Turn your phone sideways</p>
            <p className="font-hand text-lg text-graphite">The track runs left to right. Landscape shows what is coming.</p>
            <button type="button" onClick={() => setPortraitOk(true)} className="btn-ghost btn-sm px-4 py-2">
              Play in portrait anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Start hint. Lets taps through to the game underneath. */
function ReadyNote() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[14%] z-10 grid place-items-center px-4 [@media(max-height:520px)]:top-[4%]">
      <div className="sketch tape max-w-md rotate-[-1.5deg] px-6 py-5 pt-7 text-center [@media(max-height:520px)]:px-4 [@media(max-height:520px)]:py-3 [@media(max-height:520px)]:pt-5">
        <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Run as far as you can</p>
        <p className="font-hand mt-2 text-lg leading-snug text-graphite">
          <span className="pointer-coarse:hidden">Space or ↑ to jump, ↓ to slide.</span>
          <span className="pointer-fine:hidden">Tap or swipe up to jump, swipe down to slide.</span> Stomp mobs, grab hearts.
        </p>
        <p className="label mt-3 text-[0.7rem] text-pop">
          <span className="pointer-coarse:hidden">press space to start</span>
          <span className="pointer-fine:hidden">tap to start</span>
        </p>
      </div>
    </div>
  );
}

function GameOver({ stats, best, isBest, onAgain }: { stats: SurvivalStats; best: Best; isBest: boolean; onAgain: () => void }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center overflow-y-auto bg-paper/80 p-3 backdrop-blur-[2px]" role="dialog" aria-label="Run summary">
      <div className="sketch tape w-full max-w-md rotate-[-1deg] p-5 pt-7 sm:p-8 [@media(max-height:520px)]:p-4 [@media(max-height:520px)]:pt-5">
        <p className="font-hand text-lg text-pop">{stats.cause}</p>
        <h2 className="font-display mt-1 text-3xl font-extrabold tracking-tight [@media(max-height:520px)]:text-2xl">
          {isBest ? (
            <>
              New <span className="highlight">best</span>
            </>
          ) : (
            'The ink ran out.'
          )}
        </h2>
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center [@media(max-height:520px)]:mt-2">
          {[
            ['metres', stats.distance],
            ['coins', stats.coins],
            ['stomps', stats.stomps],
            ['score', stats.score],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[var(--wobble)] border-2 border-dashed border-ink/25 bg-card/70 px-1 py-2 [@media(max-height:520px)]:py-1">
              <dd className="font-display text-2xl font-extrabold tabular-nums">{v}</dd>
              <dt className="label text-[0.58rem] text-graphite">{k}</dt>
            </div>
          ))}
        </dl>
        <p className="label mt-3 tabular-nums text-graphite">
          {stats.timeSeconds.toFixed(1)}s · best {best.score} pts ({best.distance} m)
        </p>
        <div className="mt-5 flex flex-wrap gap-3 [@media(max-height:520px)]:mt-3">
          <button type="button" onClick={onAgain} className="btn-game px-5 py-3">
            Run again
          </button>
          <Link href="/create" className="btn-ghost px-5 py-3">
            Draw a level
          </Link>
        </div>
      </div>
    </div>
  );
}
