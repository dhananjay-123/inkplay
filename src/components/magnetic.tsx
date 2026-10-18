'use client';

import { useEffect } from 'react';

/**
 * Lime buttons lean a few pixels toward the pointer when it comes near. Uses
 * the CSS `translate` property so it composes with the hover/press
 * `transform`. Mouse only; off under reduced motion.
 *
 * Cheap on purpose: button rects are measured once (and again on scroll /
 * resize), never per mouse move, and styles are written only on change.
 */
export function Magnetic() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const RADIUS = 70;
    const PULL = 0.12;
    const MAX = 6;

    type Item = { el: HTMLElement; cx: number; cy: number; reach: number; on: boolean };
    let items: Item[] = [];
    let stale = true;
    let raf = 0;
    let px = -1e4;
    let py = -1e4;

    const measure = () => {
      // Measure without our own offset so rects don't drift.
      items = Array.from(document.querySelectorAll<HTMLElement>('.btn-game')).map((el) => {
        const r = el.getBoundingClientRect();
        const t = el.style.translate.split(' ').map((v) => parseFloat(v) || 0);
        return { el, cx: r.left + r.width / 2 - (t[0] ?? 0), cy: r.top + r.height / 2 - (t[1] ?? 0), reach: RADIUS + Math.max(r.width, r.height) / 2, on: Boolean(el.style.translate) };
      });
      stale = false;
    };
    const invalidate = () => {
      stale = true;
    };

    const tick = () => {
      raf = 0;
      if (stale) measure();
      for (const it of items) {
        const dx = px - it.cx;
        const dy = py - it.cy;
        if (Math.abs(dx) < it.reach && Math.abs(dy) < it.reach && Math.hypot(dx, dy) < it.reach) {
          const tx = Math.max(-MAX, Math.min(MAX, dx * PULL));
          const ty = Math.max(-MAX, Math.min(MAX, dy * PULL));
          it.el.style.translate = `${tx.toFixed(1)}px ${ty.toFixed(1)}px`;
          it.on = true;
        } else if (it.on) {
          it.el.style.translate = '';
          it.on = false;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    // Buttons appear/disappear with navigation and state; re-measure lazily.
    const mo = new MutationObserver(invalidate);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    return () => {
      mo.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
