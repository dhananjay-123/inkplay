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

/** The hero: a sketchy ink blob with eyes and a highlighter scarf (arena players get their own scarf colour). */
export function drawPlayer(scarf: string = PALETTE.accent): HTMLCanvasElement {
  const c = canvas(56, 64);
  const rc = rough.canvas(c);
  const ctx = c.getContext('2d')!;
  rc.ellipse(28, 36, 38, 46, { fill: PALETTE.ink, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2, roughness: 1.4, seed: 7 });
  // scarf
  rc.line(12, 42, 44, 40, { stroke: scarf, strokeWidth: 6, roughness: 1.2, seed: 3 });
  rc.line(40, 41, 50, 52, { stroke: scarf, strokeWidth: 5, roughness: 1.2, seed: 4 });
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

/* ---------- arena ---------- */

/** Arena scarf colours (canvas mirrors of the --accent/--pop/--hazard/--sun/--sky/--bubble/--tag-* tokens). */
export const ARENA_COLORS = ['#B6FF2E', '#2D5BFF', '#FF4A3D', '#FFCF3F', '#5CC8FF', '#FF9EC7', '#15803D', '#D97706'] as const;

/** Short crate labels for weapon / buff pickups. */
const CRATE: Record<string, { text: string; fill: string; round?: boolean }> = {
  rifle: { text: 'RIFLE', fill: '#B6FF2E' },
  flamethrower: { text: 'FIRE', fill: '#FF9E3D' },
  chainsaw: { text: 'SAW', fill: '#B6FF2E' },
  rockets: { text: 'RKT', fill: '#FF4A3D' },
  grenades: { text: 'NADE', fill: '#B6FF2E' },
  shield: { text: 'SHLD', fill: '#5CC8FF', round: true },
  speed: { text: 'FAST', fill: '#5CC8FF', round: true },
  double_jump: { text: '2JMP', fill: '#5CC8FF', round: true },
  jetfuel: { text: 'FUEL', fill: '#5CC8FF', round: true },
  damage: { text: '2X', fill: '#FF9EC7', round: true },
};

export function drawPickup(kind: string): HTMLCanvasElement {
  const c = canvas(48, 40);
  const rc = rough.canvas(c);
  const ctx = c.getContext('2d')!;
  if (kind === 'health') {
    rc.rectangle(8, 6, 32, 28, { fill: '#FFFFFF', fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.3, seed: 31 });
    rc.line(24, 12, 24, 28, { stroke: PALETTE.hazard, strokeWidth: 6, roughness: 0.6, seed: 32 });
    rc.line(16, 20, 32, 20, { stroke: PALETTE.hazard, strokeWidth: 6, roughness: 0.6, seed: 33 });
    return c;
  }
  if (kind === 'ammo') {
    rc.rectangle(8, 10, 32, 22, { fill: '#FFCF3F', fillStyle: 'hachure', hachureGap: 4, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.3, seed: 41 });
    for (let i = 0; i < 3; i++) rc.line(16 + i * 8, 4, 16 + i * 8, 14, { stroke: PALETTE.ink, strokeWidth: 3, roughness: 0.6, seed: 42 + i });
    return c;
  }
  const cr = CRATE[kind] ?? { text: '?', fill: '#FFFFFF' };
  const opts = { fill: cr.fill, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.2, seed: kind.length * 7 } as const;
  if (cr.round) rc.ellipse(24, 20, 42, 34, opts);
  else rc.rectangle(3, 6, 42, 28, opts);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cr.text, 24, 21);
  return c;
}

/** Hostile ink monsters: walker (blob on legs), flyer (winged eye), turret (box). */
export function drawEnemy(kind: 'walker' | 'flyer' | 'turret'): HTMLCanvasElement {
  const c = canvas(64, 56);
  const rc = rough.canvas(c);
  const ctx = c.getContext('2d')!;
  const eye = (x: number, y: number) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x, y, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath(); ctx.arc(x + 1.5, y + 1, 2.4, 0, Math.PI * 2); ctx.fill();
  };
  if (kind === 'walker') {
    rc.ellipse(32, 26, 44, 38, { fill: PALETTE.hazard, fillStyle: 'cross-hatch', hachureGap: 5, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.8, seed: 51 });
    rc.line(22, 44, 18, 54, { stroke: PALETTE.ink, strokeWidth: 3, seed: 52 });
    rc.line(42, 44, 46, 54, { stroke: PALETTE.ink, strokeWidth: 3, seed: 53 });
    rc.line(20, 14, 29, 20, { stroke: PALETTE.ink, strokeWidth: 3.5, seed: 54 });
    rc.line(44, 14, 35, 20, { stroke: PALETTE.ink, strokeWidth: 3.5, seed: 55 });
    eye(25, 25); eye(39, 25);
  } else if (kind === 'flyer') {
    rc.polygon([[4, 22], [20, 14], [22, 30]], { fill: PALETTE.graphite, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2, seed: 61 });
    rc.polygon([[60, 22], [44, 14], [42, 30]], { fill: PALETTE.graphite, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2, seed: 62 });
    rc.circle(32, 26, 30, { fill: '#9B5CFF', fillStyle: 'cross-hatch', hachureGap: 4, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.6, seed: 63 });
    eye(32, 25);
  } else {
    rc.rectangle(12, 18, 40, 34, { fill: PALETTE.graphite, fillStyle: 'cross-hatch', hachureGap: 5, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.4, seed: 71 });
    rc.circle(32, 18, 22, { fill: PALETTE.hazard, fillStyle: 'solid', stroke: PALETTE.ink, strokeWidth: 2.5, seed: 72 });
    eye(32, 18);
  }
  return c;
}

/** A crumbling ledge: dashed outline, sparse graphite hatching, cracks. */
export function drawCrumble(w: number, h: number): HTMLCanvasElement {
  const c = canvas(Math.ceil(w) + 8, Math.ceil(h) + 8);
  const rc = rough.canvas(c);
  rc.rectangle(4, 4, w, h, { fill: PALETTE.graphite, fillStyle: 'dots', hachureGap: 7, stroke: PALETTE.ink, strokeWidth: 2.5, strokeLineDash: [9, 6], roughness: 1.8, seed: Math.round(w) + 3 });
  for (let x = 20; x < w - 10; x += 34) rc.line(x, 4, x + 6, 4 + h, { stroke: PALETTE.ink, strokeWidth: 1.5, roughness: 2, seed: x });
  return c;
}

/**
 * The whole arena as one texture: dotted paper, an optional sample drawing
 * faintly underneath, and marker-hatched platforms on top.
 */
export function drawArena(
  size: { width: number; height: number },
  platforms: BBox[],
  under?: HTMLImageElement,
  spikes: BBox[] = [],
): HTMLCanvasElement {
  const c = canvas(size.width, size.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFAF0';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(29, 27, 24, 0.16)';
  for (let y = 24; y < c.height; y += 32) for (let x = 24; x < c.width; x += 32) ctx.fillRect(x, y, 2.4, 2.4);
  if (under) {
    ctx.globalAlpha = 0.28;
    ctx.drawImage(under, 0, 0, c.width, c.height);
    ctx.globalAlpha = 1;
  }
  const rc = rough.canvas(c);
  platforms.forEach((p, i) => {
    rc.rectangle(p.x * c.width, p.y * c.height, p.w * c.width, p.h * c.height, {
      fill: PALETTE.ink, fillStyle: 'hachure', hachureGap: 6, hachureAngle: -41 + (i % 3) * 9,
      stroke: PALETTE.ink, strokeWidth: 3, roughness: 1.4, seed: 100 + i,
    });
  });
  // spikes: a row of hatched red teeth filling each box
  spikes.forEach((sp, i) => {
    const x0 = sp.x * c.width;
    const y1 = (sp.y + sp.h) * c.height;
    const w = sp.w * c.width;
    const h = Math.max(14, sp.h * c.height);
    const n = Math.max(2, Math.round(w / 22));
    const tw = w / n;
    for (let k = 0; k < n; k++) {
      rc.polygon([[x0 + k * tw, y1], [x0 + k * tw + tw / 2, y1 - h], [x0 + (k + 1) * tw, y1]], {
        fill: PALETTE.hazard, fillStyle: 'hachure', hachureGap: 4, stroke: PALETTE.ink, strokeWidth: 2.5, roughness: 1.1, seed: 300 + i * 17 + k,
      });
    }
  });
  return c;
}
