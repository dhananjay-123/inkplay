'use client';

import { useEffect, useRef } from 'react';

const TRAIL_MS = 600;
const INTERACTIVE = 'a, button, [role="button"], summary, label, select, input[type="file"]';
const TEXTY = 'input:not([type="file"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]';

/**
 * Pen-nib cursor with a short ink trail. Grows and turns lime over anything
 * clickable. Mouse only (never touch); no trail under reduced motion; the
 * native cursor comes back over text fields.
 */
export function InkCursor() {
  const nibRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    if (!fine.matches) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nib = nibRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const root = document.documentElement;
    root.classList.add('ink-cursor-on');

    const pts: { x: number; y: number; t: number }[] = [];
    let x = -100;
    let y = -100;
    let visible = false;
    let raf = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();

    const inkColour = () => getComputedStyle(root).getPropertyValue('--ink').trim() || '#1a1033';
    let ink = inkColour();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => (ink = inkColour());
    scheme.addEventListener('change', onScheme);

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        visible = true;
        nib.style.opacity = '1';
      }
      if (!reduced) pts.push({ x, y, t: performance.now() });
      const el = e.target instanceof Element ? e.target : null;
      const texty = Boolean(el?.closest(TEXTY));
      nib.dataset.state = texty ? 'hidden' : el?.closest(INTERACTIVE) ? 'cta' : 'idle';
    };
    const onLeave = () => {
      visible = false;
      nib.style.opacity = '0';
    };
    const onDown = () => nib.classList.add('ink-cursor-down');
    const onUp = () => nib.classList.remove('ink-cursor-down');

    const frame = () => {
      nib.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!reduced) {
        const now = performance.now();
        while (pts.length && now - pts[0].t > TRAIL_MS) pts.shift();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.strokeStyle = ink;
        for (let i = 1; i < pts.length; i++) {
          const life = 1 - (now - pts[i].t) / TRAIL_MS;
          ctx.globalAlpha = Math.max(0, life) * 0.55;
          ctx.lineWidth = 0.6 + life * 3;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove('ink-cursor-on');
      scheme.removeEventListener('change', onScheme);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[9998] h-full w-full" />
      <div ref={nibRef} aria-hidden data-state="idle" className="ink-cursor pointer-events-none fixed top-0 left-0 z-[9999] opacity-0">
        {/* nib tip sits exactly on the pointer hotspot (0,0) */}
        <svg width="30" height="30" viewBox="0 0 30 30" className="ink-cursor-nib">
          <path d="M1.5 1.5 L9 21 L13 17 L24 28 L28 24 L17 13 L21 9 Z" fill="var(--cursor-fill)" stroke="var(--cursor-stroke)" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M1.5 1.5 L11 11" stroke="var(--cursor-stroke)" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="11.2" cy="11.2" r="1.6" fill="var(--cursor-stroke)" />
        </svg>
      </div>
    </>
  );
}
