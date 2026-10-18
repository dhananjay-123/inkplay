import type { CV } from './pipeline';

type MaybeModule = {
  Mat?: unknown;
  then?: (cb: (m: unknown) => void) => unknown;
  onRuntimeInitialized?: () => void;
  calledRun?: boolean;
};

/**
 * Wait for an OpenCV.js Emscripten module to finish initialising.
 *
 * The module object is a *thenable that resolves to itself*, so it must never
 * be passed to `resolve()` directly (the promise would adopt it forever). We
 * strip `then` once ready and hand it back inside a wrapper.
 */
export function cvReady(mod: unknown): Promise<{ cv: CV }> {
  return new Promise((resolve, reject) => {
    const m = mod as MaybeModule;
    const done = () => {
      try {
        delete m.then;
      } catch {
        /* non-configurable on some builds; harmless */
      }
      resolve({ cv: mod as CV });
    };
    if (!m) return reject(new Error('OpenCV module missing'));
    if (m.Mat && m.calledRun !== false) {
      // Probe: construction throws until the runtime is initialised.
      try {
        const probe = new (m.Mat as new () => { delete(): void })();
        probe.delete();
        return done();
      } catch {
        /* not ready yet */
      }
    }
    const prev = m.onRuntimeInitialized;
    m.onRuntimeInitialized = () => {
      prev?.();
      done();
    };
  });
}
