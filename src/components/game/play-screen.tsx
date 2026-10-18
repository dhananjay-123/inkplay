'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { GameBus, type LiveStats } from '@/game/events';
import { play as sfx, setMuted } from '@/game/sfx';
import type { ReviewResponse } from '@/lib/api-types';
import { ruleChip } from '@/lib/rules-display';
import type { RunStats } from '@/lib/schema';
import { useInkplay, type CurrentLevel } from '@/lib/store';
import { PhaserGame } from './phaser-game';
import { TouchControls } from './touch-controls';

type Props = { data: CurrentLevel };

export function PlayScreen({ data }: Props) {
  const bus = useMemo(() => new GameBus(), []);
  const [runKey, setRunKey] = useState(0);
  const [live, setLive] = useState<LiveStats>({ deaths: 0, coins: 0, timeSeconds: 0, timeLeft: null, effect: null });
  const [end, setEnd] = useState<RunStats | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const muted = useInkplay((s) => s.muted);
  const toggleMuted = useInkplay((s) => s.toggleMuted);
  const { level, id } = data;

  useEffect(() => setMuted(muted), [muted]);

  useEffect(() => {
    const offs = [
      bus.on('live', setLive),
      bus.on('end', (stats) => {
        setEnd(stats);
        setReview(null);
        fetch('/api/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ levelId: id, title: level.title, stats }),
        })
          .then((r) => (r.ok ? (r.json() as Promise<ReviewResponse>) : Promise.reject(new Error(String(r.status)))))
          .then(setReview)
          .catch(() => setReview({ verdict: 'The playtester fell asleep, but we saw it. Respect.', stars: 3, source: 'canned' }));
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [bus, id, level.title]);

  const again = () => {
    sfx('click');
    setEnd(null);
    setReview(null);
    setLive({ deaths: 0, coins: 0, timeSeconds: 0, timeLeft: null, effect: null });
    setRunKey((k) => k + 1);
  };

  const share = async () => {
    if (!id) return;
    const url = `${window.location.origin}/play/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: `INKPLAY · ${level.title}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const time = live.timeLeft !== null ? `${Math.ceil(live.timeLeft)}s left` : `${live.timeSeconds.toFixed(1)}s`;

  return (
    <div className="relative mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-2 pb-4 sm:px-6">
      {/* HUD top */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-2 pb-3">
        <div className="min-w-0">
          <p className="label text-graphite">Difficulty {level.difficulty}/10</p>
          <h1 className="font-display truncate text-3xl font-extrabold tracking-tight sm:text-4xl">{level.title}</h1>
        </div>
        <div className="label flex items-center gap-4 tabular-nums">
          <span title="Deaths">✕ {live.deaths}</span>
          <span title="Coins">$ {live.coins}</span>
          <span title="Time">{time}</span>
          <button type="button" onClick={toggleMuted} className="rounded-full border border-current px-3 py-1.5 hover:bg-ink hover:text-paper" aria-pressed={!muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" onClick={() => bus.emit('restart')} className="rounded-full border border-current px-3 py-1.5 hover:bg-ink hover:text-paper">
            Restart
          </button>
          {id && (
            <button type="button" onClick={share} className="rounded-full bg-accent px-3 py-1.5 text-accent-ink">
              {copied ? 'Link copied' : 'Share'}
            </button>
          )}
        </div>
      </div>

      {/* rule chips */}
      {level.rules.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-2 pb-3" aria-label="Rules read from your paper">
          {level.rules.map((r, i) => (
            <li
              key={i}
              className="label rotate-[-1deg] bg-accent px-2.5 py-1 text-accent-ink shadow-[2px_2px_0_var(--ink)] odd:rotate-[1deg]"
              title="Read from your paper"
            >
              {ruleChip(r)} ✓
            </li>
          ))}
        </ul>
      )}

      {/* game */}
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-[#F3EEE3] shadow-[var(--shadow)] ring-1 ring-ink/10">
        <PhaserGame data={data} bus={bus} runKey={runKey} className="absolute inset-0" />
        {end && <EndCard stats={end} review={review} onAgain={again} hasId={Boolean(id)} />}
      </div>

      <div className="flex items-center justify-between px-2 pt-3">
        <p className="font-hand text-lg text-graphite">{level.story}</p>
        <button type="button" onClick={() => bus.emit('giveUp')} className="label text-graphite hover:text-ink">
          Give up
        </button>
      </div>
      <p className="label px-2 pt-1 text-graphite">←/→ or A/D to move · Space / W / ↑ to jump · R to restart</p>
      <TouchControls bus={bus} />
    </div>
  );
}

function EndCard({ stats, review, onAgain, hasId }: { stats: RunStats; review: ReviewResponse | null; onAgain: () => void; hasId: boolean }) {
  const heading = stats.result === 'win' ? 'You beat the paper.' : stats.result === 'timeout' ? 'Out of time.' : 'The ink won.';
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-paper/80 p-4 backdrop-blur-[2px]" role="dialog" aria-label="Run summary">
      <div className="w-full max-w-md rotate-[-0.6deg] bg-card p-6 shadow-[var(--shadow)] ring-1 ring-ink/10 sm:p-8">
        <p className="label text-graphite">Playtester&apos;s verdict</p>
        <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight">{heading}</h2>
        <p className="label mt-3 tabular-nums text-graphite">
          {stats.timeSeconds.toFixed(1)}s · {stats.deaths} deaths · {stats.coins} coins
        </p>
        <div className="mt-5 min-h-[4.5rem]">
          {review ? (
            <>
              <p className="text-2xl tracking-widest" aria-label={`${review.stars} of 5 stars`}>
                {'★'.repeat(review.stars)}
                <span className="text-graphite/40">{'★'.repeat(5 - review.stars)}</span>
              </p>
              <p className="font-hand mt-2 text-xl leading-snug">{review.verdict}</p>
            </>
          ) : (
            <p className="font-hand animate-pulse text-xl text-graphite">Gemma is writing a review…</p>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onAgain} className="label rounded-full bg-ink px-5 py-3 text-paper">
            Play again
          </button>
          <Link href="/create" className="label rounded-full border border-current px-5 py-3">
            Remix this level
          </Link>
          {hasId && (
            <Link href="/gallery" className="label rounded-full px-2 py-3 text-graphite hover:text-ink">
              Back to gallery
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
