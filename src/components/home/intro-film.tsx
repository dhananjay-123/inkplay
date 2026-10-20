'use client';

import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The intro film: a level draws itself, our hero runs it (spikes, coins, a
 * stomped walker, a double jump over a bat, the star), then the wordmark
 * stamps in and the page wipes away.
 *
 * Plays on every full load of "/" (a first visit, a reload, Ctrl+Shift+R),
 * never on client-side navigation back home. Skippable by any key, click,
 * wheel or touch. Skipped entirely under reduced motion and without JS.
 */

// Module scope survives client-side navigation but not a page load.
let playedThisLoad = false;

const W = 1600;
const H = 900;
const WORLD_W = 3400;
const GROUND = 700;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const zigzag = (x0: number, x1: number, h = 34, step = 26) => {
  let d = `M${x0} ${GROUND}`;
  for (let x = x0, up = true; x < x1; x += step / 2, up = !up) d += ` L${Math.min(x + step / 2, x1)} ${up ? GROUND - h : GROUND}`;
  return d;
};

const COINS = [
  { x: 1000, y: 640 },
  { x: 1600, y: 448 },
  { x: 1720, y: 448 },
];

export function IntroFilm() {
  const [show, setShow] = useState(() => !playedThisLoad);
  const rootRef = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (!show) return;
    playedThisLoad = true;
    const root = rootRef.current!;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShow(false);
      return;
    }
    const q = gsap.utils.selector(root);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    let coins = 0;
    const counter = q('[data-coins]')[0] as HTMLElement;
    const pips = q('[data-pip]') as HTMLElement[];
    const world = q('[data-world]')[0];
    const hero = q('[data-hero]')[0];
    const heroBody = q('[data-hero-body]')[0];
    const puffs = q('[data-puff]') as unknown as SVGCircleElement[];
    const bits = q('[data-bit]') as unknown as SVGRectElement[];
    let puffI = 0;

    const camera = { x: 0, scale: 1 };
    const pos = { x: 150, y: GROUND - 260 };
    const render = () => {
      gsap.set(hero, { x: pos.x, y: pos.y });
      camera.x = gsap.utils.clamp(-(WORLD_W - W), 0, -(pos.x - 520));
      gsap.set(world, { x: camera.x });
    };

    const puff = (x: number, y: number, n = 3) => {
      for (let i = 0; i < n; i++) {
        const p = puffs[puffI++ % puffs.length];
        gsap.fromTo(
          p,
          { attr: { cx: x + (i - 1) * 12, cy: y - 4, r: 4 }, opacity: 0.55 },
          { attr: { cx: x + (i - 1) * 30, cy: y - 14 - Math.random() * 10, r: 12 + Math.random() * 6 }, opacity: 0, duration: 0.45, ease: 'power2.out' },
        );
      }
    };
    const burst = (x: number, y: number, n: number, colours: string[], spread = 160) => {
      for (let i = 0; i < n; i++) {
        const b = bits[i % bits.length];
        const a = Math.random() * Math.PI * 2;
        const d = spread * (0.5 + Math.random() * 0.6);
        gsap.fromTo(
          b,
          { x, y, rotation: 0, opacity: 1, fill: colours[i % colours.length], scale: 0.6 + Math.random() * 0.8 },
          {
            keyframes: [
              { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7 - 60, rotation: 360 * (Math.random() - 0.5) * 2, duration: 0.45, ease: 'power2.out' },
              { y: `+=${120 + Math.random() * 80}`, opacity: 0, duration: 0.6, ease: 'power1.in' },
            ],
          },
        );
      }
    };
    const grabCoin = (i: number) => {
      const c = q(`[data-coin="${i}"]`)[0];
      gsap.to(c, { y: -60, scale: 1.4, opacity: 0, duration: 0.35, ease: 'power2.out', transformOrigin: '50% 50%' });
      burst(COINS[i].x, COINS[i].y, 6, ['var(--sun)', 'var(--accent)'], 70);
      coins++;
      counter.textContent = `${coins}/3`;
      gsap.fromTo(pips[i], { scale: 0.3 }, { scale: 1, duration: 0.3, ease: 'back.out(3)', onStart: () => pips[i].classList.add('on') });
      gsap.fromTo(counter.parentElement, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
    };

    const tl = gsap.timeline({ defaults: { ease: 'none' }, onUpdate: render });
    // run bob (squash/stretch) that loops under everything
    const bob = gsap.to(heroBody, { scaleY: 0.9, scaleX: 1.08, duration: 0.11, yoyo: true, repeat: -1, transformOrigin: '50% 100%', paused: true });

    const jump = (toX: number, peak: number, landY: number, dur: number, flip = false) => {
      const t = gsap.timeline({ defaults: { ease: 'none' } });
      t.add(() => {
        bob.pause();
        gsap.to(heroBody, { scaleY: 1.12, scaleX: 0.9, duration: 0.1 });
        puff(pos.x, pos.y);
      });
      t.to(pos, { x: toX, duration: dur }, 0);
      t.to(pos, { y: peak, duration: dur * 0.45, ease: 'power2.out' }, 0);
      t.to(pos, { y: landY, duration: dur * 0.55, ease: 'power2.in' }, dur * 0.45);
      if (flip) t.to(heroBody, { rotation: 360, duration: dur * 0.7, ease: 'power1.inOut', transformOrigin: '50% 60%' }, dur * 0.15);
      t.add(() => {
        gsap.set(heroBody, { rotation: 0 });
        gsap.fromTo(heroBody, { scaleY: 0.72, scaleX: 1.25 }, { scaleY: 1, scaleX: 1, duration: 0.22, ease: 'back.out(3)', transformOrigin: '50% 100%' });
        puff(pos.x, landY);
        bob.play();
      });
      return t;
    };
    const run = (toX: number, dur: number) => gsap.timeline().add(() => void bob.play()).to(pos, { x: toX, duration: dur, ease: 'none' });

    // ---------- 1. the page draws itself
    gsap.set(q('[data-draw]'), { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set(q('[data-pop]'), { scale: 0, opacity: 0, transformOrigin: '50% 50%' });
    gsap.set(hero, { opacity: 0 });
    tl.to(q('[data-draw]'), { strokeDashoffset: 0, duration: 0.55, stagger: 0.07, ease: 'power2.inOut' }, 0.15);
    tl.to(q('[data-pop]'), { scale: 1, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'back.out(2.5)' }, 0.55);
    tl.fromTo(q('[data-hud]'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, 0.9);

    // ---------- 2. hero drops in
    tl.set(hero, { opacity: 1 }, 1.25);
    tl.to(pos, { y: GROUND, duration: 0.35, ease: 'bounce.out' }, 1.25);
    tl.add(() => puff(pos.x, GROUND, 4), 1.4);

    // ---------- 3. the run
    tl.add(run(640, 0.5), 1.65);
    tl.add(jump(930, GROUND - 170, GROUND, 0.55)); // spikes
    tl.add(run(1000, 0.1));
    tl.add(() => grabCoin(0));
    // the walker strolls toward us meanwhile
    tl.to(q('[data-walker]'), { x: -150, duration: 0.6 }, '<-0.4');
    tl.add(run(1150, 0.22));
    tl.add(jump(1255, GROUND - 130, GROUND - 60, 0.32)); // onto its head
    tl.add(() => {
      gsap.to(q('[data-walker-body]'), { scaleY: 0.15, scaleX: 1.4, duration: 0.12, transformOrigin: '50% 100%' });
      gsap.to(q('[data-walker]'), { opacity: 0, duration: 0.3, delay: 0.25 });
      burst(1255, GROUND - 20, 14, ['var(--hazard)', 'var(--ink)'], 120);
      gsap.fromTo(world, { y: 6 }, { y: 0, duration: 0.25, ease: 'elastic.out(1, 0.3)' });
    });
    tl.add(jump(1520, GROUND - 330, 500, 0.5)); // bounce up onto the ledge
    tl.add(run(1600, 0.16));
    tl.add(() => grabCoin(1));
    tl.add(run(1720, 0.24));
    tl.add(() => grabCoin(2));
    tl.add(run(1790, 0.12));
    tl.add(jump(1960, 420, GROUND, 0.42)); // hop down
    tl.add(jump(2240, GROUND - 260, GROUND, 0.62, true)); // flip over the bat
    tl.add(run(2280, 0.08));
    tl.add(jump(2520, GROUND - 170, GROUND, 0.5)); // spikes again
    tl.add(run(2840, 0.45));
    tl.add(jump(2930, GROUND - 150, GROUND - 46, 0.32)); // onto the star's plinth
    tl.add(() => {
      bob.pause();
      gsap.to(q('[data-star]'), { rotation: 360, scale: 1.5, duration: 0.6, ease: 'back.out(2)', transformOrigin: '50% 50%' });
      burst(2930, GROUND - 190, 28, ['var(--accent)', 'var(--bubble)', 'var(--sun)', 'var(--sky)', 'var(--hazard)'], 260);
      gsap.to(heroBody, { y: -30, duration: 0.18, yoyo: true, repeat: 3, ease: 'power1.out' });
    });

    // ---------- 4. wordmark stamp + wipe
    tl.to(q('[data-scene]'), { opacity: 0.12, scale: 0.92, duration: 0.5, ease: 'power2.inOut', transformOrigin: '50% 60%' }, '+=0.55');
    tl.fromTo(q('[data-mark]'), { scale: 2.4, opacity: 0, rotation: -6 }, { scale: 1, opacity: 1, rotation: -2, duration: 0.42, ease: 'back.out(1.6)' }, '<0.1');
    tl.fromTo(q('[data-tag]'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, '<0.25');
    tl.to(root, { clipPath: 'inset(0 0 100% 0)', duration: 0.6, ease: 'power3.inOut' }, '+=0.7');
    tl.add(() => setShow(false));

    // Bat bobs and the walker's legs wiggle the whole time.
    const loops = [
      gsap.to(q('[data-bat]'), { y: -26, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' }),
      gsap.to(q('[data-wing]'), { scaleY: 0.3, duration: 0.12, yoyo: true, repeat: -1, transformOrigin: '50% 50%' }),
      gsap.to(q('[data-leg]'), { rotation: 25, duration: 0.14, yoyo: true, repeat: -1, transformOrigin: '50% 0%', stagger: 0.07 }),
    ];

    const skip = () => {
      if (!tl.isActive() && tl.progress() >= 1) return;
      tl.pause();
      gsap.to(root, { opacity: 0, duration: 0.3, onComplete: () => setShow(false) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      skip();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', skip, { passive: true });
    root.addEventListener('pointerdown', skip);

    return () => {
      tl.kill();
      bob.kill();
      loops.forEach((l) => l.kill());
      gsap.killTweensOf(q('*'));
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', skip);
      root.removeEventListener('pointerdown', skip);
      document.documentElement.style.overflow = prevOverflow;
    };
  }, [show]);

  if (!show) return null;

  return (
    <div ref={rootRef} className="intro-film fixed inset-0 z-[9000] overflow-hidden" role="dialog" aria-label="INKPLAY intro" aria-live="off">
      <noscript>
        <style>{'.intro-film{display:none!important}'}</style>
      </noscript>

      <svg data-scene viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g data-world>
          {/* ground + ledge */}
          <path data-draw pathLength={1} stroke="var(--ink)" strokeWidth="6" d={`M0 ${GROUND} C 600 ${GROUND - 6}, 1400 ${GROUND + 6}, 2000 ${GROUND - 3} S 3000 ${GROUND + 4}, ${WORLD_W} ${GROUND}`} />
          <path data-draw pathLength={1} stroke="var(--ink)" strokeWidth="6" d="M1480 500 C 1580 496, 1700 504, 1820 499" />
          <path data-draw pathLength={1} stroke="var(--ink)" strokeWidth="5" d={`M2880 ${GROUND} L2890 ${GROUND - 46} L2980 ${GROUND - 46} L2990 ${GROUND}`} />
          {/* spikes */}
          <path data-draw pathLength={1} stroke="var(--hazard)" strokeWidth="5" d={zigzag(700, 860)} />
          <path data-draw pathLength={1} stroke="var(--hazard)" strokeWidth="5" d={zigzag(2310, 2470)} />
          {/* margin rule */}
          <g data-pop>
            <path stroke="var(--accent)" strokeWidth="26" strokeOpacity="0.9" d="M120 140 L470 128" />
            <text x="130" y="150" className="font-hand" fill="var(--ink)" fontSize="44" transform="rotate(-2 130 150)">
              double jump!
            </text>
          </g>

          {/* coins */}
          {COINS.map((c, i) => (
            <g key={i} data-coin={i} transform={`translate(${c.x} ${c.y})`}>
              <g data-pop>
                <circle r="20" fill="var(--sun)" stroke="var(--ink)" strokeWidth="4" />
                <text y="9" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--ink)" className="font-display">
                  $
                </text>
              </g>
            </g>
          ))}

          {/* walker enemy */}
          <g transform={`translate(1410 ${GROUND})`}>
            <g data-walker>
              <g data-pop>
                <path data-leg stroke="var(--ink)" strokeWidth="5" d="M-12 -14 L-14 0" />
                <path data-leg stroke="var(--ink)" strokeWidth="5" d="M12 -14 L14 0" />
                <g data-walker-body>
                  <path fill="var(--hazard)" stroke="var(--ink)" strokeWidth="4" d="M-30 -14 C -34 -50, -10 -66, 2 -64 C 22 -62, 34 -46, 30 -14 Z" />
                  <path stroke="var(--ink)" strokeWidth="4" d="M-16 -46 L-4 -40 M16 -46 L4 -40" />
                  <circle cx="-9" cy="-33" r="4" fill="var(--ink)" />
                  <circle cx="9" cy="-33" r="4" fill="var(--ink)" />
                  <path stroke="var(--ink)" strokeWidth="3" d="M-8 -22 Q 0 -27 8 -22" />
                </g>
              </g>
            </g>
          </g>

          {/* bat */}
          <g transform="translate(2100 560)">
            <g data-bat>
              <g data-pop>
                <path data-wing fill="var(--sky)" stroke="var(--ink)" strokeWidth="4" d="M-14 -4 C -40 -30, -66 -14, -70 4 C -54 -4, -40 4, -14 8 Z" />
                <path data-wing fill="var(--sky)" stroke="var(--ink)" strokeWidth="4" d="M14 -4 C 40 -30, 66 -14, 70 4 C 54 -4, 40 4, 14 8 Z" />
                <ellipse rx="22" ry="20" fill="var(--bubble)" stroke="var(--ink)" strokeWidth="4" />
                <circle cx="-7" cy="-3" r="4" fill="#fff" />
                <circle cx="7" cy="-3" r="4" fill="#fff" />
                <circle cx="-6" cy="-2" r="2" fill="var(--ink)" />
                <circle cx="8" cy="-2" r="2" fill="var(--ink)" />
              </g>
            </g>
          </g>

          {/* goal star */}
          <g transform={`translate(2935 ${GROUND - 160})`}>
            <g data-star>
              <g data-pop>
                <path fill="var(--accent)" stroke="var(--ink)" strokeWidth="5" d="M0 -46 L13 -14 L46 -12 L20 9 L29 42 L0 23 L-29 42 L-20 9 L-46 -12 L-13 -14 Z" />
              </g>
            </g>
          </g>

          {/* hero (origin = feet) */}
          <g data-hero>
            <g data-hero-body>
              <path stroke="var(--ink)" strokeWidth="5" d="M-9 -8 L-11 0 M9 -8 L11 0" />
              <ellipse cy="-34" rx="22" ry="27" fill="var(--ink)" />
              <path stroke="var(--accent)" strokeWidth="8" d="M-20 -26 L20 -28 L30 -14" />
              <ellipse cx="-8" cy="-42" rx="6" ry="7.5" fill="#fff" />
              <ellipse cx="8" cy="-42" rx="6" ry="7.5" fill="#fff" />
              <circle cx="-6" cy="-41" r="3" fill="var(--ink)" />
              <circle cx="10" cy="-41" r="3" fill="var(--ink)" />
            </g>
          </g>

          {/* particle pools */}
          {Array.from({ length: 12 }, (_, i) => (
            // cx/cy start as numbers: GSAP reads the current value, and a missing attribute logs an SVG error.
            <circle key={`p${i}`} data-puff cx="0" cy="0" r="0" fill="var(--graphite)" opacity="0" />
          ))}
          {Array.from({ length: 30 }, (_, i) => (
            <rect key={`b${i}`} data-bit x="-5" y="-5" width="10" height="10" rx="2" opacity="0" />
          ))}
        </g>
      </svg>

      {/* film HUD */}
      <div data-hud className="label absolute top-5 left-5 flex items-center gap-2 rounded-[var(--wobble-btn)] border-2 border-[var(--ink)] bg-[var(--card)] px-3 py-1.5 text-[var(--ink)] shadow-[var(--shadow-hard)] sm:top-8 sm:left-8">
        <span>$</span>
        {COINS.map((_, i) => (
          <span key={i} data-pip className="intro-pip h-2.5 w-2.5 rounded-full border-[1.5px] border-current" />
        ))}
        <span data-coins className="tabular-nums">
          0/3
        </span>
      </div>

      {/* wordmark */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p data-mark className="font-display text-[clamp(4rem,17vw,14rem)] leading-[0.85] font-extrabold tracking-[-0.04em] text-[var(--ink)] opacity-0">
            INKPLAY
          </p>
          <p data-tag className="font-display mt-4 text-2xl text-[var(--ink)] opacity-0 sm:text-3xl">
            Draw it. <span className="highlight">Write the rules.</span> Play it.
          </p>
        </div>
      </div>

      <button type="button" className="btn-game label absolute right-5 bottom-5 px-4 py-2 sm:right-8 sm:bottom-8">
        Skip
      </button>
    </div>
  );
}
