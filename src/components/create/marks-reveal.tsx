'use client';

import { useEffect, useState } from 'react';
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
 * Gemma reads, then each label types itself next to its mark.
 */
export function MarksReveal({ image, marks, labels, rescue = [] }: Props) {
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setShown(marks.length);
      return;
    }
    setShown(0);
    const iv = setInterval(() => setShown((n) => (n >= marks.length ? (clearInterval(iv), n) : n + 1)), 90);
    return () => clearInterval(iv);
  }, [marks, reduced]);

  useEffect(() => {
    if (!labels) return setTyped(0);
    if (reduced) return setTyped(labels.length);
    setTyped(0);
    const iv = setInterval(() => setTyped((n) => (n >= labels.length ? (clearInterval(iv), n) : n + 1)), 140);
    return () => clearInterval(iv);
  }, [labels, reduced]);

  const labelById = new Map(labels?.map((l) => [l.id, l]) ?? []);
  const order = labels?.map((l) => l.id) ?? [];

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[#F3EEE3] shadow-[var(--shadow)] ring-1 ring-ink/10">
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
            title="added by Gemma ✦"
          />
        ))}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}
