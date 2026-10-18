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
  // Same rule as the game: only collectibles count as coins (power-ups don't).
  const totalCoins = useMemo(() => {
    const ids = new Set(data.marks.map((m) => m.id));
    return level.labels.filter((l) => l.role === 'collectible' && ids.has(l.id)).length;
  }, [data.marks, level.labels]);

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
    // Exactly one screen tall: HUD row, the game (as big as fits at 16:9), one footer line.
    <div className="relative mx-auto flex h-[calc(100dvh-var(--nav-h))] w-full max-w-[1800px] flex-col px-2 pb-2 sm:px-6">
      {/* HUD: title + rule chips | stats + actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display truncate text-2xl font-extrabold tracking-tight sm:text-3xl" title={`Difficulty ${level.difficulty}/10`}>
            {level.title}
          </h1>
          <span className="label text-[0.62rem] text-graphite">diff {level.difficulty}/10</span>
          {level.rules.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Rules read from your paper">
              {level.rules.map((r, i) => (
                <li
                  key={i}
                  className="label rotate-[-1deg] rounded-[var(--wobble-btn)] border-2 border-ink bg-accent px-2 py-0.5 text-[0.62rem] text-accent-ink odd:rotate-[1deg]"
                  title="Read from your paper"
                >
                  {ruleChip(r)} ✓
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="label flex items-center gap-3 tabular-nums sm:gap-4">
          <span title="Deaths">✕ {live.deaths}</span>
          <CoinTracker got={live.coins} total={totalCoins} />
          <span title="Time">{time}</span>
          <button type="button" onClick={toggleMuted} className="btn-ghost btn-sm px-3 py-1" aria-pressed={!muted}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" onClick={() => bus.emit('restart')} className="btn-ghost btn-sm px-3 py-1">
            Restart
          </button>
          {id && (
            <button type="button" onClick={share} className="btn-game btn-sm px-3 py-1">
              {copied ? 'Link copied' : 'Share'}
            </button>
          )}
        </div>
      </div>

      {/* game: the largest 16:9 box that fits the remaining space */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
        <div className="sketch relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden">
          <PhaserGame data={data} bus={bus} runKey={runKey} className="absolute inset-0" />
          {end && <EndCard stats={end} totalCoins={totalCoins} review={review} onAgain={again} hasId={Boolean(id)} />}
        </div>
      </div>

      <div className="flex items-center gap-4 px-1 pt-2">
        <p className="font-hand min-w-0 flex-1 truncate text-base text-graphite" title={level.story}>
          {level.story}
        </p>
        <p className="font-hand hidden shrink-0 text-base text-graphite lg:block">arrows or A/D to move, Space to jump, R to restart</p>
        <button type="button" onClick={() => bus.emit('giveUp')} className="font-hand link-scrawl shrink-0 text-base text-graphite">
          Give up
        </button>
      </div>
      <TouchControls bus={bus} />
    </div>
  );
}

/** Coins: one pip per coin on the page (fills as you grab it), or n/total when there are many. */
function CoinTracker({ got, total }: { got: number; total: number }) {
  const all = total > 0 && got >= total;
  const label = total > 0 ? `${got} of ${total} coins` : `${got} coins`;
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors ${all ? 'bg-accent text-accent-ink' : ''}`}
    >
      <span aria-hidden>$</span>
      {total > 0 && total <= 8 ? (
        <span className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i < got ? `on-${i}` : `off-${i}`}
              className={`h-2.5 w-2.5 rounded-full border-[1.5px] border-current ${i < got ? 'animate-[pop_.3s_cubic-bezier(.2,1.6,.4,1)_both] bg-current' : 'opacity-40'}`}
            />
          ))}
        </span>
      ) : (
        <span key={got} className="inline-block animate-[pop_.3s_cubic-bezier(.2,1.6,.4,1)_both]">
          {total > 0 ? `${got}/${total}` : got}
        </span>
      )}
      {all && <span aria-hidden>✓</span>}
    </span>
  );
}

function EndCard({ stats, totalCoins, review, onAgain, hasId }: { stats: RunStats; totalCoins: number; review: ReviewResponse | null; onAgain: () => void; hasId: boolean }) {
  const heading = stats.result === 'win' ? 'You beat the paper.' : stats.result === 'timeout' ? 'Out of time.' : 'The ink won.';
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-paper/80 p-4 backdrop-blur-[2px]" role="dialog" aria-label="Run summary">
      <div className="sketch tape w-full max-w-md rotate-[-1deg] p-6 pt-8 sm:p-8">
        <p className="font-hand text-lg text-pop">the playtester says</p>
        <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight">{heading}</h2>
        <p className="label mt-3 tabular-nums text-graphite">
          {stats.timeSeconds.toFixed(1)}s · {stats.deaths} deaths · {totalCoins > 0 ? `${stats.coins}/${totalCoins}` : stats.coins} coins
        </p>
        <div className="mt-5 min-h-[4.5rem]">
          {review ? (
            <>
              <p className="text-3xl tracking-widest" aria-label={`${review.stars} of 5 stars`}>
                <span className="text-sun [-webkit-text-stroke:1.5px_var(--ink)]">{'★'.repeat(review.stars)}</span>
                <span className="text-graphite/25">{'★'.repeat(5 - review.stars)}</span>
              </p>
              <p className="font-hand mt-2 text-xl leading-snug">{review.verdict}</p>
            </>
          ) : (
            <p className="font-hand animate-pulse text-xl text-graphite">Gemma is writing a review…</p>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onAgain} className="btn-game px-5 py-3">
            Play again
          </button>
          <Link href="/create" className="btn-ghost px-5 py-3">
            Draw a new one
          </Link>
          {hasId && (
            <Link href="/gallery" className="font-hand link-scrawl self-center px-1 text-lg text-graphite">
              back to the gallery
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
