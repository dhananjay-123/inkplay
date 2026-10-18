import rough from 'roughjs';
import { PALETTE } from './art';

/** Canvas mirrors of the --sun / --sky / --bubble / --pop / --paper tokens in globals.css. */
export const SKETCH = { sun: '#FFCF3F', sky: '#5CC8FF', bubble: '#FF9EC7', pop: '#2D5BFF', paper: '#FFFAF0', lime: '#B6FF2E' } as const;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
}

/** Dotted notebook page, tiles seamlessly (dots on a 32px grid, one faint ruled line). */
export function drawPaperTile(): HTMLCanvasElement {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = SKETCH.paper;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(29, 27, 24, 0.16)';
  for (let y = 16; y < 256; y += 32) for (let x = 16; x < 256; x += 32) ctx.fillRect(x, y, 2.4, 2.4);
  ctx.fillStyle = 'rgba(92, 200, 255, 0.22)';
  ctx.fillRect(0, 128, 256, 2);
  return c;
}

/** Ground band tile: ink top edge and hatching; `crumble` is dashed and dotted, with cracks. */
export function drawGroundTile(crumble: boolean): HTMLCanvasElement {
  const w = 240;
  const h = 140;
  const c = canvas(w, h);
  const rc = rough.canvas(c);
  if (crumble) {
    rc.rectangle(-6, 6, w + 12, 60, { fill: PALETTE.graphite, fillStyle: 'dots', hachureGap: 8, stroke: PALETTE.ink, strokeWidth: 3, strokeLineDash: [10, 7], roughness: 1.6, seed: 9 });
    for (let x = 30; x < w; x += 70) rc.line(x, 8, x + 10, 64, { stroke: PALETTE.ink, strokeWidth: 1.6, roughness: 2.2, seed: x });
    return c;
  }
  rc.rectangle(-6, 6, w + 12, h, { fill: PALETTE.ink, fillStyle: 'hachure', hachureGap: 7, hachureAngle: -41, stroke: 'none', roughness: 1.2, seed: 3 });
  rc.line(-6, 6, w + 6, 6, { stroke: PALETTE.ink, strokeWidth: 4, roughness: 1.1, seed: 4 });
  return c;
}

/** A thin floating ledge tile (one-way platform). */
export function drawLedgeTile(): HTMLCanvasElement {
  const c = canvas(200, 26);
  const rc = rough.canvas(c);
  rc.rectangle(-4, 4, 208, 16, { fill: SKETCH.sky, fillStyle: 'hachure', hachureGap: 5, stroke: 'none', roughness: 1.3, seed: 12 });
  rc.line(-4, 4, 204, 4, { stroke: PALETTE.ink, strokeWidth: 3.5, roughness: 1, seed: 13 });
  rc.line(-4, 20, 204, 20, { stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1, seed: 14 });
  return c;
}

/** One end cap for a ground piece: a heavy marker stroke down the cliff. */
export function drawCap(h = 140): HTMLCanvasElement {
  const c = canvas(10, h);
  rough.canvas(c).line(5, 4, 5, h, { stroke: PALETTE.ink, strokeWidth: 4, roughness: 1.4, seed: 21 });
  return c;
}

/** A row tile of red hatched teeth, 44px per tooth. */
export function drawSpikeTile(): HTMLCanvasElement {
  const c = canvas(44, 34);
  rough.canvas(c).polygon([[1, 33], [22, 3], [43, 33]], { fill: PALETTE.hazard, fillStyle: 'hachure', hachureGap: 4, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.1, seed: 31 });
  return c;
}

/** Lava tile: a wobbly top edge over cross-hatched tomato red. */
export function drawLavaTile(): HTMLCanvasElement {
  const c = canvas(120, 40);
  const rc = rough.canvas(c);
  const pts: [number, number][] = [];
  for (let x = 0; x <= 120; x += 10) pts.push([x, 10 + Math.sin((x / 120) * Math.PI * 4) * 4]);
  rc.polygon([...pts, [120, 40], [0, 40]], { fill: PALETTE.hazard, fillStyle: 'cross-hatch', hachureGap: 5, stroke: 'none', roughness: 1.2, seed: 41 });
  rc.linearPath(pts, { stroke: PALETTE.ink, strokeWidth: 3, roughness: 0.9, seed: 42 });
  ctxBubbles(c);
  return c;
}
function ctxBubbles(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  for (const [x, y, r] of [[24, 24, 4], [78, 28, 3], [100, 20, 2.5]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A low beam hanging on two strings: slide under it. */
export function drawBar(w: number, h: number): HTMLCanvasElement {
  const c = canvas(w + 8, h);
  const rc = rough.canvas(c);
  const beam = 46;
  rc.line(14, 0, 14, h - beam, { stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.6, seed: 51 });
  rc.line(w - 6, 0, w - 6, h - beam, { stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.6, seed: 52 });
  rc.rectangle(4, h - beam, w, beam - 4, { fill: SKETCH.sun, fillStyle: 'zigzag', hachureGap: 7, stroke: PALETTE.ink, strokeWidth: 3, roughness: 1.5, seed: 53 + Math.round(w) });
  rc.line(10, h - 10, w, h - beam + 6, { stroke: PALETTE.hazard, strokeWidth: 3, roughness: 1.2, seed: 54 });
  return c;
}

/** The hero squashed flat for a slide. */
export function drawSlide(hero: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas(72, 64);
  c.getContext('2d')!.drawImage(hero, 0, 0, 56, 64, 0, 36, 72, 28);
  return c;
}

export function drawCoin(): HTMLCanvasElement {
  const c = canvas(30, 30);
  const rc = rough.canvas(c);
  rc.circle(15, 15, 24, { fill: SKETCH.sun, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.1, seed: 61 });
  rc.line(15, 9, 15, 21, { stroke: PALETTE.ink, strokeWidth: 2, roughness: 0.7, seed: 62 });
  return c;
}

export function drawHeart(): HTMLCanvasElement {
  const c = canvas(40, 38);
  const rc = rough.canvas(c);
  rc.path('M20 34 C 6 24, 2 16, 6 9 C 10 3, 18 4, 20 11 C 22 4, 30 3, 34 9 C 38 16, 34 24, 20 34 Z', {
    fill: SKETCH.bubble, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1, seed: 71,
  });
  rc.line(13, 12, 16, 17, { stroke: '#FFFFFF', strokeWidth: 3, roughness: 0.6, seed: 72 });
  return c;
}

/** Round badge with a short mono label, like the arena buff crates. */
function badge(text: string, fill: string, seed: number): HTMLCanvasElement {
  const c = canvas(48, 42);
  rough.canvas(c).ellipse(24, 21, 42, 36, { fill, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.2, seed });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, 22);
  return c;
}

export function drawShieldBadge(): HTMLCanvasElement {
  return badge('SHLD', SKETCH.sky, 81);
}
export function drawMagnet(): HTMLCanvasElement {
  const c = canvas(44, 44);
  const rc = rough.canvas(c);
  rc.arc(22, 20, 30, 30, 0, Math.PI, false, { stroke: PALETTE.hazard, strokeWidth: 9, roughness: 0.9, seed: 91 });
  rc.line(7, 20, 7, 36, { stroke: PALETTE.hazard, strokeWidth: 9, roughness: 0.6, seed: 92 });
  rc.line(37, 20, 37, 36, { stroke: PALETTE.hazard, strokeWidth: 9, roughness: 0.6, seed: 93 });
  rc.line(2, 36, 12, 36, { stroke: PALETTE.graphite, strokeWidth: 6, roughness: 0.5, seed: 94 });
  rc.line(32, 36, 42, 36, { stroke: PALETTE.graphite, strokeWidth: 6, roughness: 0.5, seed: 95 });
  return c;
}
export function drawBoostBadge(): HTMLCanvasElement {
  return badge('ZOOM', SKETCH.lime, 101);
}

/** Ink blot a shooter spits. */
export function drawBlot(): HTMLCanvasElement {
  const c = canvas(28, 22);
  const rc = rough.canvas(c);
  rc.ellipse(16, 11, 22, 16, { fill: PALETTE.ink, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 1.5, roughness: 1.8, seed: 111 });
  rc.line(2, 8, 8, 9, { stroke: PALETTE.ink, strokeWidth: 2, seed: 112 });
  rc.line(1, 14, 7, 13, { stroke: PALETTE.ink, strokeWidth: 2, seed: 113 });
  return c;
}
