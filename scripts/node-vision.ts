/** Node helpers for running the browser vision pipeline headlessly (scripts only). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { processDrawing, type CV, type RGBAImage, type VisionResult } from '../src/lib/vision/pipeline';
import { cvReady } from '../src/lib/vision/cv-ready';

const require = createRequire(import.meta.url);

let cvPromise: Promise<CV> | null = null;

export function loadCV(): Promise<CV> {
  // Same file the browser loads from /public.
  cvPromise ??= cvReady(require(path.resolve(process.cwd(), 'public/opencv/opencv.js'))).then((r) => r.cv);
  return cvPromise;
}

export function decodeJpeg(file: string): RGBAImage {
  const img = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { data: new Uint8ClampedArray(img.data.buffer), width: img.width, height: img.height };
}

/** Nearest-neighbour-free box downscale to maxW, then JPEG → base64. */
export function encodeJpeg(img: RGBAImage, maxW = 1024, quality = 80): string {
  const s = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / s);
      const sy0 = Math.floor(y / s);
      const sx1 = Math.min(img.width, Math.floor((x + 1) / s));
      const sy1 = Math.min(img.height, Math.floor((y + 1) / s));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = sy0; yy < Math.max(sy1, sy0 + 1); yy++) {
        for (let xx = sx0; xx < Math.max(sx1, sx0 + 1); xx++) {
          const o = (yy * img.width + xx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return jpeg.encode({ data: out, width: w, height: h }, quality).data.toString('base64');
}

export async function visionFromFile(file: string): Promise<VisionResult> {
  const cv = await loadCV();
  return processDrawing(cv, decodeJpeg(file));
}
