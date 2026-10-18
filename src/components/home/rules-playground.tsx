'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Rules are data", made touchable: a tiny level where the hero runs on its
 * own; flip handwritten rules and the physics change live, with the exact
 * JSON rule Gemma would emit shown alongside.
 */

type RuleId = 'low' | 'heavy' | 'speed' | 'upside' | 'night' | 'mirror';

const RULES: { id: RuleId; text: string; json: string; tilt: number }[] = [
  { id: 'low', text: 'low gravity', json: '{ "kind": "gravity", "value": 0.4 }', tilt: -2 },
  { id: 'heavy', text: 'heavy gravity', json: '{ "kind": "gravity", "value": 2.2 }', tilt: 1.5 },
  { id: 'speed', text: 'super speed', json: '{ "kind": "player_speed", "value": 2 }', tilt: -1 },
  { id: 'upside', text: 'upside down', json: '{ "kind": "invert_gravity" }', tilt: 2 },
  { id: 'night', text: "it's night", json: '{ "kind": "night_mode" }', tilt: -1.5 },
  { id: 'mirror', text: 'mirror world', json: '{ "kind": "mirror_world" }', tilt: 1 },
];

const W = 640;
const H = 300;
const GROUND = 236;
const SPIKES: [number, number] = [262, 330];
const JUMP_AT = [230, 470]; // normal gravity clears the spikes; heavy gravity does not

export function RulesPlayground() {
  const [on, setOn] = useState<Set<RuleId>>(() => new Set(['low']));
  const [splats, setSplats] = useState(0);
  const heroRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const lightRef = useRef<SVGCircleElement>(null);
  const splatRef = useRef<SVGGElement>(null);
  const figRef = useRef<HTMLElement>(null);
  const rulesRef = useRef(on);
  useEffect(() => {
    rulesRef.current = on;
  }, [on]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = { x: 40, y: GROUND, vy: 0, grounded: true, jumped: new Set<number>(), dead: 0 };
    let raf = 0;
    let last = performance.now();

    const place = () => {
      heroRef.current?.setAttribute('transform', `translate(${s.x} ${s.y})`);
      // The torch lives outside the flipped group, so flip its position by hand.
      const r = rulesRef.current;
      lightRef.current?.setAttribute('cx', String(r.has('mirror') ? W - s.x : s.x));
      lightRef.current?.setAttribute('cy', String(r.has('upside') ? H - (s.y - 30) : s.y - 30));
    };

    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const r = rulesRef.current;
      const g = 1300 * (r.has('low') ? 0.4 : 1) * (r.has('heavy') ? 2.2 : 1);
      const speed = 150 * (r.has('speed') ? 2 : 1);

      if (s.dead > 0) {
        s.dead -= dt;
        if (s.dead <= 0) {
          Object.assign(s, { x: 40, y: GROUND, vy: 0, grounded: true });
          s.jumped.clear();
          splatRef.current?.setAttribute('opacity', '0');
        }
      } else {
        s.x += speed * dt;
        for (const jx of JUMP_AT) {
          if (s.grounded && s.x >= jx && !s.jumped.has(jx)) {
            s.jumped.add(jx);
            s.vy = -470;
            s.grounded = false;
            bodyRef.current?.animate([{ transform: 'scale(0.85,1.15)' }, { transform: 'scale(1,1)' }], { duration: 220 });
          }
        }
        s.vy += g * dt;
        s.y = Math.min(GROUND, s.y + s.vy * dt);
        if (s.y >= GROUND && !s.grounded) {
          s.grounded = true;
          s.vy = 0;
          bodyRef.current?.animate([{ transform: 'scale(1.25,0.75)' }, { transform: 'scale(1,1)' }], { duration: 240, easing: 'cubic-bezier(.2,1.6,.4,1)' });
        }
        if (s.y < 16) {
          s.y = 16;
          s.vy = Math.max(0, s.vy);
        }
        // Landing on the spikes = splat
        if (s.grounded && s.x > SPIKES[0] && s.x < SPIKES[1]) {
          s.dead = 0.9;
          setSplats((n) => n + 1);
          splatRef.current?.setAttribute('transform', `translate(${s.x} ${GROUND})`);
          splatRef.current?.setAttribute('opacity', '1');
          splatRef.current?.animate([{ transform: `translate(${s.x}px, ${GROUND}px) scale(0.2)` }, { transform: `translate(${s.x}px, ${GROUND}px) scale(1)` }], {
            duration: 260,
            easing: 'cubic-bezier(.2,1.6,.4,1)',
          });
          s.y = 9999; // hide hero
        }
        if (s.x > W + 30) {
          s.x = -30;
          s.jumped.clear();
        }
      }
      place();
      raf = running ? requestAnimationFrame(step) : 0;
    };

    // Only animate while on screen and the tab is visible.
    let running = false;
    let onScreen = false;
    const sync = () => {
      const want = onScreen && !document.hidden && !reduced;
      if (want && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(step);
      } else if (!want && running) {
        running = false;
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = Boolean(e?.isIntersecting);
      sync();
    });
    if (figRef.current) io.observe(figRef.current);
    document.addEventListener('visibilitychange', sync);

    place();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      cancelAnimationFrame(raf);
    };
  }, []);

  const toggle = (id: RuleId) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (id === 'low') next.delete('heavy');
        if (id === 'heavy') next.delete('low');
      }
      return next;
    });

  const flip = `${on.has('mirror') ? `translate(${W} 0) scale(-1 1)` : ''} ${on.has('upside') ? `translate(0 ${H}) scale(1 -1)` : ''}`.trim();
  const active = RULES.filter((r) => on.has(r.id));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.35fr] lg:items-center">
      <div>
        <p className="font-hand text-xl text-graphite">Tap a rule. Watch the paper obey.</p>
        <ul className="mt-5 flex flex-wrap gap-3">
          {RULES.map((r) => {
            const sel = on.has(r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={sel}
                  onClick={() => toggle(r.id)}
                  style={{ rotate: `${r.tilt}deg` }}
                  className={`font-hand rounded-[var(--wobble-btn)] border-2 px-4 py-1 text-2xl transition-[background,transform,box-shadow] duration-150 hover:-translate-y-0.5 active:translate-y-0.5 ${
                    sel ? 'border-ink bg-accent text-accent-ink shadow-[var(--shadow-hard)]' : 'border-dashed border-ink/35 bg-card text-ink hover:border-ink'
                  }`}
                >
                  {sel ? '✓ ' : ''}
                  {r.text}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="sketch-soft mt-6 min-h-[7rem] p-4 font-mono text-xs leading-6">
          <p className="font-hand text-base text-graphite">what Gemma sends the game:</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre text-ink">
            {active.length ? `"rules": [\n${active.map((r) => `  ${r.json}`).join(',\n')}\n]` : '"rules": []'}
          </pre>
        </div>
      </div>

      <figure ref={figRef} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="sketch w-full overflow-hidden" role="img" aria-label="A tiny level: the hero runs, jumps a cloud and spikes. Active rules change how it moves.">
          <defs>
            <radialGradient id="rp-torch">
              <stop offset="0.55" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="1" />
            </radialGradient>
            <mask id="rp-night">
              <rect width={W} height={H} fill="#fff" />
              <circle ref={lightRef} r="95" fill="url(#rp-torch)" />
            </mask>
          </defs>
          <g transform={flip || undefined} style={{ transition: 'transform .4s' }} fill="none" stroke="var(--ink)" strokeLinecap="round" strokeLinejoin="round">
            {/* notebook margin */}
            <path d="M44 0 V300" stroke="var(--hazard)" strokeOpacity="0.35" strokeWidth="2" />
            <path d={`M0 ${GROUND} C 120 ${GROUND - 3}, 200 ${GROUND + 3}, ${SPIKES[0]} ${GROUND} M${SPIKES[1]} ${GROUND} C 420 ${GROUND - 4}, 540 ${GROUND + 3}, ${W} ${GROUND}`} strokeWidth="4" />
            <path d={`M${SPIKES[0]} ${GROUND} l8.5 -20 l8.5 20 l8.5 -20 l8.5 20 l8.5 -20 l8.5 20 l8.5 -20 l8.5 20`} stroke="var(--hazard)" strokeWidth="4" />
            <path d="M486 150 c-14 0 -20 -16 -6 -22 c0 -18 26 -22 32 -8 c10 -10 30 -4 28 10 c14 2 14 20 0 20 z" strokeWidth="3" />
            <path d="M574 236 L574 168" strokeWidth="3.5" />
            <path d="M574 168 L606 180 L574 192" fill="var(--accent)" strokeWidth="3" />
            <text x="60" y="44" className="font-hand" fontSize="22" fill="var(--graphite)" stroke="none">
              {active.length ? active.map((r) => r.text).join(' · ') : 'no rules (boring)'}
            </text>

            <g ref={splatRef} opacity="0">
              <path d="M-26 0 c6 -18 14 -6 18 -20 c4 12 10 -4 14 10 c8 -10 12 2 20 -6 c-2 10 6 12 0 16 z" fill="var(--ink)" stroke="none" />
            </g>
            <g ref={heroRef}>
              <g ref={bodyRef} style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
                <path d="M-6 -6 L-7 0 M6 -6 L7 0" strokeWidth="3.5" />
                <ellipse cy="-24" rx="15" ry="19" fill="var(--ink)" stroke="none" />
                <path d="M-14 -18 L14 -19 L21 -9" stroke="var(--accent)" strokeWidth="5.5" />
                <ellipse cx="-5.5" cy="-29" rx="4" ry="5" fill="#fff" stroke="none" />
                <ellipse cx="5.5" cy="-29" rx="4" ry="5" fill="#fff" stroke="none" />
                <circle cx="-4" cy="-28" r="2" fill="var(--ink)" stroke="none" />
                <circle cx="7" cy="-28" r="2" fill="var(--ink)" stroke="none" />
              </g>
            </g>
          </g>
          {on.has('night') && <rect width={W} height={H} fill="#16130f" fillOpacity="0.92" mask="url(#rp-night)" />}
        </svg>
        <figcaption className="font-hand mt-3 flex justify-between text-base text-graphite">
          <span>live, and roughly the same physics as the game</span>
          <span aria-live="polite">splats: {splats}</span>
        </figcaption>
      </figure>
    </div>
  );
}
