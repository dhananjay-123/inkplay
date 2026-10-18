# Decisions

Short log of non-obvious choices. Newest at the bottom. One entry = context,
decision, why.

---

### D1 — Spec split into `CLAUDE.md` + `docs/`
- **Context:** the build brief was one long pasted prompt.
- **Decision:** `CLAUDE.md` holds working rules, commands, layout and design
  tokens; `docs/SPEC.md` holds the full product/technical spec;
  `docs/PROGRESS.md` tracks phases and measured numbers; this file logs
  decisions.
- **Why:** agents load `CLAUDE.md` every session, so it stays short and
  rule-focused; the spec is reference material read on demand.

### D2 — Gemma on the Gemini API: no system instruction / JSON mode assumed
- **Context:** Gemma models served via the Gemini API may not support
  `systemInstruction` or `responseSchema`.
- **Decision:** system prompt is prepended to the user turn; output is parsed
  defensively (fence strip → JSON.parse → Zod → one retry).
- **Why:** works whether or not the features exist. To be confirmed by the
  Phase 1 smoke test — update this entry with the result.

### D3 — Next 16 Cache Components stays on; no `runtime` export
- **Context:** `create-next-app` enabled `cacheComponents`, which forbids the
  `runtime` route segment export.
- **Decision:** omit `export const runtime = 'nodejs'` (Node is the default);
  GET handlers that read runtime data call `await connection()`;
  `/play/[id]` reads params inside `<Suspense>`.
- **Why:** keeps the framework defaults; Node runtime is guaranteed anyway.

### D4 — Vision pipeline is isomorphic and runs in a Web Worker
- **Decision:** `src/lib/vision/pipeline.ts` takes RGBA buffers, never the DOM.
  The browser runs it in a module worker (OpenCV.js eval'd from
  `/public/opencv/opencv.js`); scripts run the same code in Node.
- **Why:** the 10 MB OpenCV build doesn't jank the reveal animation, and the
  pipeline is testable headless (`pnpm test:vision`).
- **Gotcha:** the Emscripten module is a thenable that resolves to itself;
  never pass it to `resolve()` (see `cv-ready.ts`).

### D5 — Lines are split from doodles before grouping
- **Context:** people draw things standing on lines; plain connected
  components merged a cactus with the ground.
- **Decision:** extract long horizontal strokes with a morphological opening,
  then give a line back to a doodle when the doodle covers ≥75% of it, or when
  it is short with doodle ink at both ends (box edges: dog's back, cloud base).

### D6 — Live marks are cut out of the drawing
- **Decision:** enemies, pickups and the goal are cropped from the user's
  clean drawing into ink-only sprites and erased from the background; the
  drawn P is erased and replaced by the hero.
- **Why:** the user's own dog walks and their own $ disappears — the magic
  moment.

### D7 — `MODEL_PROVIDER=mock` for development
- **Decision:** a geometry-only labeller (`src/lib/ai/mock.ts`) so the loop can
  be built and tested without credentials. Health reports `mock`; the level
  says so in its story.
- **Why:** no Gemini key / Ollama on the build machine yet. Never use for demos.

### D8 — Synthesized sound effects
- **Decision:** Web Audio oscillators/noise (`src/game/sfx.ts`) instead of
  audio files.
- **Why:** zero bytes, nothing to self-host, works offline; muted by default.

### D9 — One-way platforms
- **Decision:** platform bodies collide only from above (pass through from
  below/sides); sloped strokes become 6 px steps.
- **Why:** sketchy lines overlap and wobble; one-way surfaces never trap the
  hero.
