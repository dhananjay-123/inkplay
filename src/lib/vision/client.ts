'use client';

import type { Mark } from '@/lib/schema';
import type { WorkerIn, WorkerOut } from './vision.worker';

export type Processed = {
  /** Full-res clean drawing for the game background (data URL). */
  cleanFull: string;
  /** Set-of-marks preview for the reveal animation (data URL, full res). */
  somFull: string;
  /** Downscaled payloads for /api/parse (data URLs). */
  somSend: string;
  cleanSend: string;
  marks: Mark[];
  paperDetected: boolean;
  ms: number;
};

const MAX_INPUT = 1600;
const MAX_PAYLOAD = 3_000_000;

let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function call(msg: WorkerIn, transfer: Transferable[] = []): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMessage = (e: MessageEvent<WorkerOut>) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      resolve(e.data);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'vision worker crashed'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(msg, transfer);
  });
}

/** Start downloading + compiling OpenCV early (e.g. when /create mounts). */
export function warmupVision(): void {
  call({ type: 'warmup' }).catch(() => {
    /* surfaced on the real call */
  });
}

async function toBitmap(source: Blob | HTMLVideoElement | HTMLImageElement): Promise<ImageBitmap> {
  if (source instanceof Blob) {
    return createImageBitmap(source, { imageOrientation: 'from-image' });
  }
  return createImageBitmap(source);
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgbaToCanvas(buf: ArrayBuffer, w: number, h: number): HTMLCanvasElement {
  const c = canvasOf(w, h);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
  return c;
}

function encode(src: HTMLCanvasElement, maxW: number, quality: number): string {
  const s = Math.min(1, maxW / src.width);
  if (s === 1) return src.toDataURL('image/jpeg', quality);
  const c = canvasOf(Math.round(src.width * s), Math.round(src.height * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export async function processImage(source: Blob | HTMLVideoElement | HTMLImageElement): Promise<Processed> {
  const bmp = await toBitmap(source);
  const s = Math.min(1, MAX_INPUT / Math.max(bmp.width, bmp.height));
  const input = canvasOf(Math.round(bmp.width * s), Math.round(bmp.height * s));
  const ictx = input.getContext('2d', { willReadFrequently: true })!;
  ictx.drawImage(bmp, 0, 0, input.width, input.height);
  bmp.close();
  const img = ictx.getImageData(0, 0, input.width, input.height);

  const out = await call(
    { type: 'process', buffer: img.data.buffer, width: img.width, height: img.height },
    [img.data.buffer],
  );
  if (out.type === 'error') throw new Error(out.message);
  if (out.type !== 'result') throw new Error('unexpected vision worker reply');

  const clean = rgbaToCanvas(out.clean, out.width, out.height);
  const som = rgbaToCanvas(out.som, out.width, out.height);

  // Size budget for Vercel's request body limit.
  let width = 1024;
  let quality = 0.8;
  let somSend = encode(som, width, quality);
  let cleanSend = encode(clean, width, quality);
  while (somSend.length + cleanSend.length + JSON.stringify(out.marks).length > MAX_PAYLOAD && width > 480) {
    width = Math.round(width * 0.75);
    quality = Math.max(0.6, quality - 0.05);
    somSend = encode(som, width, quality);
    cleanSend = encode(clean, width, quality);
  }

  return {
    cleanFull: encode(clean, 1600, 0.85),
    somFull: encode(som, 1600, 0.85),
    somSend,
    cleanSend,
    marks: out.marks,
    paperDetected: out.paperDetected,
    ms: out.ms,
  };
}
