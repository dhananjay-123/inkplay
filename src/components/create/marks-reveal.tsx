'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ROLE_COLOR, ROLE_LABEL } from '@/lib/rules-display';
import type { Mark, MarkLabel } from '@/lib/schema';

type Props = {
  image: string;
  marks: Mark[];
  labels: MarkLabel[] | null;
  rescue?: { bbox: Mark['bbox'] }[];
};

/**
 * The AI's understanding, made visible: numbered boxes pop in one by one while
 * the AI reads, then each label types itself next to its mark.
 */
export function MarksReveal({ image, marks, labels, rescue = [] }: Props) {
  const reduced = usePrefersReducedMotion();
  const shown = useCountUp(marks, marks.length, 90, reduced);
  const typed = useCountUp(labels, labels?.length ?? 0, 140, reduced);

  const labelById = new Map(labels?.map((l) => [l.id, l]) ?? []);
  const order = labels?.map((l) => l.id) ?? [];

  return (
    <div className="sketch relative aspect-video w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the vision worker */}
      <img src={image} alt="Your cleaned-up drawing" className="absolute inset-0 h-full w-full object-cover" />
      {marks.slice(0, shown).map((m) => {
        const l = labelById.get(m.id);
        const visible = l && order.indexOf(m.id) < typed;
        const color = l ? ROLE_COLOR[l.role] : 'var(--hazard)';
        const isText = l?.role === 'rule_text' || l?.role === 'decoration';
        return (
          <div
            key={m.id}
            className="absolute animate-[pop_.35s_cubic-bezier(.2,1.6,.4,1)_both]"
            style={{ left: `${m.bbox.x * 100}%`, top: `${m.bbox.y * 100}%`, width: `${m.bbox.w * 100}%`, height: `${m.bbox.h * 100}%` }}
          >
            <div
              className="absolute -inset-1 rounded-[3px] border-2"
              style={{ borderColor: visible ? color : 'var(--hazard)', opacity: visible && isText ? 0.45 : 1 }}
            />
            <span
              className="label absolute -top-6 left-[-4px] whitespace-nowrap px-1.5 py-0.5 text-[10px] text-white sm:text-[11px]"
              style={{ background: visible ? color : 'var(--hazard)' }}
            >
              #{m.id}
              {visible && l && !isText ? ` ${l.what} → ${ROLE_LABEL[l.role]}` : ''}
            </span>
          </div>
        );
      })}
      {labels && typed >= labels.length &&
        rescue.map((r, i) => (
          <div
            key={`r${i}`}
            className="absolute animate-[pop_.35s_ease-out_both] bg-accent/80 ring-1 ring-ink"
            style={{ left: `${r.bbox.x * 100}%`, top: `${r.bbox.y * 100}%`, width: `${r.bbox.w * 100}%`, height: `${Math.max(r.bbox.h * 100, 1.2)}%` }}
            title="auto-added ✦"
          />
        ))}
    </div>
  );
}

/**
 * Counts 0 → total, one step per `stepMs`, restarting whenever `source`
 * changes (instantly at total with reduced motion). Counter state is tagged
 * with its source so a new source starts at 0 without a reset in the effect.
 */
function useCountUp(source: unknown, total: number, stepMs: number, reduced: boolean): number {
  const [state, setState] = useState({ source, n: 0 });
  useEffect(() => {
    if (reduced || !total) return;
    let n = 0;
    const iv = setInterval(() => {
      n = Math.min(n + 1, total);
      setState({ source, n });
      if (n >= total) clearInterval(iv);
    }, stepMs);
    return () => clearInterval(iv);
  }, [source, total, stepMs, reduced]);
  if (reduced) return total;
  return state.source === source ? state.n : 0;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
}
