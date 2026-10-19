/**
 * The self-playing mini demo: a ground line, a zigzag, a P and a star draw
 * themselves, "low gravity" is scribbled in the margin, then the P floats
 * over the spikes to the star. Pure SVG + CSS, so it costs nothing to load
 * and freezes on its final frame under reduced motion.
 */
export function HeroDoodle() {
  return (
    <figure className="hero-doodle relative w-full" aria-label="A hand-drawn level: a line, spikes, a P for the player and a star for the goal. The P floats over the spikes.">
      <svg viewBox="0 0 520 300" className="w-full overflow-visible text-ink" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* ground, slightly wobbly */}
        <path className="hd-draw hd-1" pathLength={1} strokeWidth="4" d="M20 232 C 90 228, 150 236, 210 231 S 330 229, 500 233" />
        {/* zigzag spikes */}
        <path className="hd-draw hd-2" pathLength={1} strokeWidth="4" stroke="var(--hazard)" d="M222 231 L236 206 L250 231 L264 206 L278 231 L292 206 L306 231" />
        {/* floating platform */}
        <path className="hd-draw hd-3" pathLength={1} strokeWidth="4" d="M360 168 C 390 165, 420 170, 452 166" />
        {/* star goal */}
        <path className="hd-draw hd-4" pathLength={1} strokeWidth="3.5" d="M406 112 L414 132 L436 133 L419 146 L425 167 L406 155 L387 167 L393 146 L376 133 L398 132 Z" />
        {/* the P, which becomes the hero */}
        <g className="hd-hero">
          <path className="hd-draw hd-5" pathLength={1} strokeWidth="4.5" d="M70 228 L70 176 C 98 170, 106 196, 72 202" />
        </g>
        {/* margin rule, highlighter underneath */}
        <path className="hd-draw hd-6" pathLength={1} strokeWidth="14" stroke="var(--accent)" strokeOpacity="0.9" d="M296 50 L462 38" />
        <text x="300" y="58" className="hd-note font-hand" fill="var(--accent-ink)" stroke="none" fontSize="30" transform="rotate(-4 300 58)">
          low gravity
        </text>
        {/* dotted jump arc */}
        <path className="hd-arc" strokeWidth="2.5" strokeDasharray="2 9" stroke="var(--graphite)" d="M84 170 C 180 40, 300 40, 396 150" />
      </svg>
      <figcaption className="font-hand absolute right-0 -bottom-3 text-base text-graphite">fig. 1, before it gets read</figcaption>
    </figure>
  );
}
