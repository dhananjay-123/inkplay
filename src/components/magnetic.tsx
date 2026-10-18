'use client';

import { useEffect } from 'react';

/**
 * Lime buttons lean toward the pointer when it comes near. Uses the CSS
 * `translate` property so it composes with the hover/press `transform`.
 * Mouse only; off under reduced motion.
 */
export function Magnetic() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const RADIUS = 90;
    const PULL = 0.22;
    let raf = 0;
    let px = 0;
    let py = 0;
    const tick = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>('.btn-game').forEach((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = px - cx;
        const dy = py - cy;
        const reach = RADIUS + Math.max(r.width, r.height) / 2;
        if (Math.hypot(dx, dy) < reach) {
          el.style.translate = `${(dx * PULL).toFixed(1)}px ${(dy * PULL).toFixed(1)}px`;
        } else if (el.style.translate) {
          el.style.translate = '';
        }
      });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
