# INKPLAY — Paper to Playable

> *Draw it. Write the rules. Play it.*

Hackathon project for **Hacktoberfest Hack Day Gwalior × ABV-IIITM IEEE**.
Deadline: **Sunday 18 Oct 2026, 4:00 PM IST**.
Tracks: *Best Open-Source AI Project* and *Best Use of Gemma 4*.

This file is the working guide for anyone (human or agent) touching the repo.
The full product spec lives in [`docs/SPEC.md`](docs/SPEC.md). Phase status
lives in [`docs/PROGRESS.md`](docs/PROGRESS.md). Non-obvious choices are logged
in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Working rules

1. **Build in phases** (see `docs/PROGRESS.md`). Finish a phase, run it, fix
   errors, commit with a clear message, then move on. Never end a phase with
   the app in a non-running state.
2. **Working and demoable beats ambitious and broken.**
3. **pnpm only.** `pnpm add`, `pnpm dev`, `pnpm build`. Never npm or yarn.
4. **TypeScript strict.** No `any` unless unavoidable, and comment why.
5. **Secrets:** never hard-code them, never import server keys into client
   code. Server-only modules start with `import 'server-only'`.
6. **Model IDs are never invented.** They come from env
   (`GEMMA_CLOUD_MODEL`, `OLLAMA_MODEL`).
7. **Offline first.** Fonts, sounds, OpenCV.js, textures and samples are
   self-hosted in `/public` or bundled. The app must run in airplane mode
   with `MODEL_PROVIDER=ollama`.
8. **Verify uncertain behaviour with a small script first** (API shapes,
   provider quirks), then build on what you saw.
9. **Golden rule:** draw → parse → play → review must work with **no
   Supabase at all**. Supabase is the gallery only, always best-effort.
10. **Rules are data, never code.** The model may only pick from the
    whitelisted `Rule` union in `src/lib/schema.ts`. All numbers are clamped
    server-side.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build (must pass with zero type errors) |
| `pnpm start` | Serve the production build |
| `pnpm demo` | `MODEL_PROVIDER=ollama next start` — offline stage demo |
| `pnpm test:model` | Phase 1 smoke test against the configured provider |
| `pnpm typecheck` | `tsc --noEmit` |

## Layout

```
src/
  app/                 routes (App Router) + api/ route handlers
  components/          React UI (design layer)
  game/                Phaser 3 scenes, client-only
  lib/
    env.ts             Zod-validated env, provider + hasSupabase flags
    schema.ts          Level / MarkLabel / Rule schemas + clamping
    fixer.ts           post-parse auto-fixer (player, goal, reachability)
    ai/                provider abstraction (gemini | ollama) + prompts
    vision/            OpenCV.js preprocessing, set-of-marks rendering
    supabase/          server.ts (service role) / client.ts (anon)
    store.ts           Zustand store for the current level
public/
  opencv/opencv.js     self-hosted
  samples/             5 sample drawings
  sounds/              tiny self-hosted sfx
scripts/test-model.ts  Phase 1 smoke test
supabase/schema.sql    paste into the Supabase SQL editor
```

## Design system (summary — full detail in `docs/SPEC.md` §5)

- Concept: **Living Notebook**. Paper, ink, scribbles + sharp editorial type.
- Tokens: paper `#F3EEE3`, ink `#141414`, graphite `#6B6760`,
  accent highlighter `#C6FF3D` (sparingly), hazard `#FF4A1C`.
  Dark = "blueprint at night", bg `#0E0F12`, ink off-white, accent unchanged.
- Fonts via `next/font`: Bricolage Grotesque (display), Kalam (handwriting /
  Gemma's voice), JetBrains Mono (labels/HUD, uppercase, tracked).
- Respect `prefers-reduced-motion` everywhere.
- Define colours as CSS variables; don't hard-code hex in components.

## Running modes

| Mode | Where | `MODEL_PROVIDER` | Supabase |
|---|---|---|---|
| Public site | Vercel | `gemini` | on |
| Stage demo | Laptop, `pnpm build` online → `pnpm demo` offline | `ollama` | off |
| Dev | Laptop, `pnpm dev` | either | either |

## Cut order if time runs short

about page → gallery hover effects → intro video support → enemy chase →
gallery itself.

**Never cut:** core loop, set-of-marks reveal, handwritten rules, offline
mode, README + LICENSE.
