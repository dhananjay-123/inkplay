/// <reference lib="webworker" />
import { cvReady } from './cv-ready';
import { processDrawing, type CV } from './pipeline';

export type WorkerIn =
  | { type: 'warmup' }
  | { type: 'process'; buffer: ArrayBuffer; width: number; height: number };

export type WorkerOut =
  | { type: 'ready' }
  | {
      type: 'result';
      clean: ArrayBuffer;
      som: ArrayBuffer;
      width: number;
      height: number;
      marks: import('@/lib/schema').Mark[];
      paperDetected: boolean;
      ms: number;
    }
  | { type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope & { cv?: unknown };

let cvPromise: Promise<CV> | null = null;

function loadCV(): Promise<CV> {
  cvPromise ??= (async () => {
    // Module workers can't importScripts(); evaluate the self-hosted UMD build
    // in global scope instead (it assigns `self.cv`).
    const res = await fetch('/opencv/opencv.js');
    if (!res.ok) throw new Error(`opencv.js ${res.status}`);
    const code = await res.text();
    (0, eval)(code);
    const { cv } = await cvReady(self.cv);
    return cv;
  })();
  return cvPromise;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    const cv = await loadCV();
    if (msg.type === 'warmup') {
      self.postMessage({ type: 'ready' } satisfies WorkerOut);
      return;
    }
    const r = processDrawing(cv, { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height });
    const clean = r.clean.data.buffer as ArrayBuffer;
    const som = r.som.data.buffer as ArrayBuffer;
    self.postMessage(
      { type: 'result', clean, som, width: r.clean.width, height: r.clean.height, marks: r.marks, paperDetected: r.paperDetected, ms: r.ms } satisfies WorkerOut,
      [clean, som],
    );
  } catch (err) {
    cvPromise = null; // allow a retry after a failed load
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut);
  }
};
