import { z } from 'zod';
import { STICKER_BY_ID, stickerSize } from './stickers';

/**
 * A level drawn in the browser. Everything lives in level space (1600 × 900,
 * the same size as the sample sheets) and exports to a plain ink-on-paper
 * PNG, which then takes the normal photo route: OpenCV, set-of-marks, Gemma.
 */

export const W = 1600;
export const H = 900;
export const INK = '#1d1b18';
export const PAPER = '#fbf8f1';
export const STROKE = 5;
export const TEXT_SIZE = 44;

export const num = z.number().finite();
const ItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stroke'), id: z.string(), points: z.array(num).min(2).max(20000) }),
  z.object({ kind: z.literal('sticker'), id: z.string(), ref: z.string(), x: num, y: num, scale: num }),
  z.object({ kind: z.literal('text'), id: z.string(), text: z.string().max(80), x: num, y: num, scale: num }),
  z.object({ kind: z.literal('image'), id: z.string(), src: z.string().startsWith('data:image/'), x: num, y: num, w: num, h: num, scale: num }),
]);
export const SceneSchema = z.array(ItemSchema).max(500);

export type Item = z.infer<typeof ItemSchema>;
export type Scene = Item[];

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/** Pen points (flat x,y list) to a smooth path through the midpoints. */
export function strokePath(p: number[]): string {
  if (p.length < 4) return `M${p[0]} ${p[1]} l0.1 0`;
  if (p.length === 4) return `M${p[0]} ${p[1]} L${p[2]} ${p[3]}`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += ` Q${p[i]} ${p[i + 1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return `${d} L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** The family next/font registered for Kalam, so canvas text matches the page. */
export function handFont(): string {
  if (typeof document === 'undefined') return 'cursive';
  const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-kalam').trim();
  return fam ? `${fam}, cursive` : 'cursive';
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, size: number): number {
  if (typeof document === 'undefined') return text.length * size * 0.45;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * size * 0.45;
  measureCtx.font = `${size}px ${handFont()}`;
  return measureCtx.measureText(text).width;
}

export type Box = { x: number; y: number; w: number; h: number };

export function bboxOf(it: Item): Box {
  switch (it.kind) {
    case 'stroke': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < it.points.length; i += 2) {
        x0 = Math.min(x0, it.points[i]);
        x1 = Math.max(x1, it.points[i]);
        y0 = Math.min(y0, it.points[i + 1]);
        y1 = Math.max(y1, it.points[i + 1]);
      }
      return { x: x0 - 6, y: y0 - 6, w: x1 - x0 + 12, h: y1 - y0 + 12 };
    }
    case 'sticker': {
      const def = STICKER_BY_ID.get(it.ref);
      const [w, h] = def ? stickerSize(def) : [60, 60];
      return { x: it.x, y: it.y, w: w * it.scale, h: h * it.scale };
    }
    case 'text': {
      const size = TEXT_SIZE * it.scale;
      return { x: it.x, y: it.y - size * 0.85, w: textWidth(it.text, size), h: size * 1.15 };
    }
    case 'image':
      return { x: it.x, y: it.y, w: it.w * it.scale, h: it.h * it.scale };
  }
}

export function moveItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === 'stroke') return { ...it, points: it.points.map((v, i) => v + (i % 2 ? dy : dx)) };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Paint the scene as ink on paper. `w` × `h` is the output size. */
export async function renderScene(scene: Scene, w = W, h = H): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  ctx.scale(w / W, h / H);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const font = handFont();
  if (scene.some((i) => i.kind === 'text')) await document.fonts.load(`${TEXT_SIZE}px ${font}`).catch(() => {});

  for (const it of scene) {
    ctx.save();
    if (it.kind === 'stroke') {
      ctx.lineWidth = STROKE;
      ctx.stroke(new Path2D(strokePath(it.points)));
    } else if (it.kind === 'sticker') {
      const def = STICKER_BY_ID.get(it.ref);
      if (def) {
        const s = def.k * it.scale;
        ctx.translate(it.x, it.y);
        ctx.scale(s, s);
        ctx.lineWidth = STROKE / s;
        for (const d of def.paths) ctx.stroke(new Path2D(d));
        for (const d of def.fills ?? []) ctx.fill(new Path2D(d));
      }
    } else if (it.kind === 'text') {
      ctx.font = `${TEXT_SIZE * it.scale}px ${font}`;
      ctx.fillText(it.text, it.x, it.y);
    } else {
      const img = await loadImage(it.src).catch(() => null);
      if (img) ctx.drawImage(img, it.x, it.y, it.w * it.scale, it.h * it.scale);
    }
    ctx.restore();
  }
  return canvas;
}

export async function exportPng(scene: Scene): Promise<Blob> {
  const canvas = await renderScene(scene);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), 'image/png'));
}

/** Imported pictures are shrunk before they go into the scene (and storage). */
export async function importImage(file: Blob, max = 420): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
