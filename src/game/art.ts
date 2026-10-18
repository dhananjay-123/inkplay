import rough from 'roughjs';
import type { BBox } from '@/lib/schema';

/** Canvas colours mirror the CSS tokens in globals.css (canvas can't read CSS vars cheaply). */
export const PALETTE = {
  paper: '#F3EEE3',
  ink: '#141414',
  accent: '#C6FF3D',
  hazard: '#FF4A1C',
  graphite: '#6B6760',
} as const;
export const hex = (c: string) => parseInt(c.slice(1), 16);

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The hero: a sketchy ink blob with eyes and a highlighter scarf. */
export function drawPlayer(): HTMLCanvasElement {
  const c = canvas(56, 64);
  const rc = rough.canvas(c);
  const ctx = c.getContext('2d')!;
  rc.ellipse(28, 36, 38, 46, { fill: PALETTE.ink, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.4, seed: 7 });
  // scarf
  rc.line(12, 42, 44, 40, { stroke: PALETTE.accent, strokeWidth: 6, roughness: 1.2, seed: 3 });
  rc.line(40, 41, 50, 52, { stroke: PALETTE.accent, strokeWidth: 5, roughness: 1.2, seed: 4 });
  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(21, 28, 5.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(34, 28, 5.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath(); ctx.arc(23, 29, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(36, 29, 2.6, 0, Math.PI * 2); ctx.fill();
  // feet
  rc.line(20, 58, 18, 63, { stroke: PALETTE.ink, strokeWidth: 3, roughness: 0.8, seed: 5 });
  rc.line(36, 58, 38, 63, { stroke: PALETTE.ink, strokeWidth: 3, roughness: 0.8, seed: 6 });
  return c;
}

export function drawRescuePlatform(w: number, h: number): HTMLCanvasElement {
  const c = canvas(Math.ceil(w) + 8, Math.ceil(h) + 8);
  rough.canvas(c).rectangle(4, 4, w, h, {
    fill: PALETTE.accent, fillStyle: 'hachure', hachureGap: 5, stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.6, seed: Math.round(w),
  });
  return c;
}

export function drawDot(r: number, color: string): HTMLCanvasElement {
  const c = canvas(r * 2 + 2, r * 2 + 2);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(r + 1, r + 1, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Generic boss projectile: a sketchy disc (rotis, chalk, whatever the paper said). */
export function drawProjectile(): HTMLCanvasElement {
  const c = canvas(36, 36);
  const rc = rough.canvas(c);
  rc.circle(18, 18, 28, { fill: '#E9C98B', fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.5, seed: 11 });
  rc.circle(13, 14, 4, { fill: '#9C6B30', fillStyle: 'solid', stroke: 'none', seed: 2 });
  rc.circle(22, 21, 3, { fill: '#9C6B30', fillStyle: 'solid', stroke: 'none', seed: 3 });
  return c;
}

export function drawBoss(): HTMLCanvasElement {
  const c = canvas(150, 130);
  const rc = rough.canvas(c);
  const ctx = c.getContext('2d')!;
  rc.ellipse(75, 72, 120, 100, { fill: PALETTE.hazard, fillStyle: 'cross-hatch', hachureGap: 7, stroke: PALETTE.ink, strokeWidth: 3, roughness: 2, seed: 21 });
  rc.line(42, 46, 66, 56, { stroke: PALETTE.ink, strokeWidth: 5, seed: 1 }); // angry brows
  rc.line(108, 46, 84, 56, { stroke: PALETTE.ink, strokeWidth: 5, seed: 2 });
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath(); ctx.arc(58, 66, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(92, 66, 6, 0, Math.PI * 2); ctx.fill();
  rc.arc(75, 100, 44, 20, Math.PI, Math.PI * 2, false, { stroke: PALETTE.ink, strokeWidth: 4, seed: 3 });
  return c;
}

/**
 * Cut a mark out of the drawing as an ink-only sprite (paper → transparent),
 * and erase it from the background so the drawing itself comes alive.
 * Pixels inside `protect` boxes (platform lines) are left in the background
 * and excluded from the sprite.
 */
export function cutOut(bg: HTMLCanvasElement, box: BBox, protect: BBox[], pad = 4): HTMLCanvasElement {
  const W = bg.width;
  const H = bg.height;
  const x0 = Math.max(0, Math.floor(box.x * W) - pad);
  const y0 = Math.max(0, Math.floor(box.y * H) - pad);
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * W) + pad);
  const y1 = Math.min(H, Math.ceil((box.y + box.h) * H) + pad);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const bctx = bg.getContext('2d', { willReadFrequently: true })!;
  const src = bctx.getImageData(x0, y0, w, h);
  const out = canvas(w, h);
  const octx = out.getContext('2d')!;
  const sprite = octx.createImageData(w, h);
  const keep = protect.map((p) => ({
    x0: p.x * W - x0 - 3, y0: p.y * H - y0 - 3, x1: (p.x + p.w) * W - x0 + 3, y1: (p.y + p.h) * H - y0 + 3,
  }));
  const [pr, pg, pb] = [0xf3, 0xee, 0xe3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (keep.some((k) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1)) continue;
      const lum = (src.data[o] + src.data[o + 1] + src.data[o + 2]) / 3;
      const a = Math.max(0, Math.min(1, (232 - lum) / 180));
      sprite.data[o] = 0x14; sprite.data[o + 1] = 0x14; sprite.data[o + 2] = 0x14;
      sprite.data[o + 3] = Math.round(a * 255);
      // erase from background
      src.data[o] = pr; src.data[o + 1] = pg; src.data[o + 2] = pb;
    }
  }
  octx.putImageData(sprite, 0, 0);
  bctx.putImageData(src, x0, y0);
  return out;
}
