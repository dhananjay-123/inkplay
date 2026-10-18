'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Marks its children `data-in` once they scroll into view. CSS does the rest
 * (`.reveal`, `.scribble`), so reduced-motion is handled in one place.
 */
export function Reveal({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // The ref type is the common HTMLElement base of all three tags.
    <Tag ref={ref as React.RefObject<never>} data-in={inView || undefined} className={`reveal ${className}`}>
      {children}
    </Tag>
  );
}

/** A hand-drawn underline that draws itself when its Reveal parent enters. */
export function Scribble({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden className={`scribble pointer-events-none ${className}`}>
      <path d="M3 13 C 60 5, 120 17, 180 9 S 270 6, 297 11" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" pathLength={1} />
    </svg>
  );
}
