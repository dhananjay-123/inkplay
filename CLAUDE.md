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
7. **Offline first.** Fonts, OpenCV.js, textures and samples are self-hosted
   in `/public` or bundled; sounds are synthesized (Web Audio). The app
   must run in airplane mode
   with `MODEL_PROVIDER=ollama`.
8. **Verify uncertain behaviour with a small script first** (API shapes,
   provider quirks), then build on what you saw.
9. **Golden rule:** draw → parse → play → review must work with **no
   Supabase at all**. Supabase is the gallery only, always best-effort.
10. **Commit often, push once.** Every push to `main` is a Vercel production
    deploy. Batch the work, run `pnpm build` locally, then push a single time.
11. **Rules are data, never code.** The model may only pick from the
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
  components/          React UI (design layer): home/ (intro film, playground,
                       doodles), create/, game/, gallery/, guide/, nav, cursor
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
scripts/test-model.ts  Phase 1 smoke test
supabase/schema.sql    paste into the Supabase SQL editor
```

## Design system (summary — full detail in `docs/SPEC.md` §5)

- Concept: **Arcade notebook**. Paper, ink, scribbles, sharp editorial type,
  plus game-feel: chunky lime buttons, coloured role chips, living doodles.
- Tokens (`src/app/globals.css`): paper `#FFF7E6`, ink `#1A1033` (violet),
  graphite `#6B5E8C`, accent lime `#B6FF2E`, hazard `#FF3B5C`, pop violet
  `#7B5CFF`, sun `#FFC93C`, sky `#2EC5FF`. Dark = "arcade at midnight":
  paper `#120A2A`, ink `#FFF7E6`, accent unchanged.
- Anything drawn on top of the (always light) drawing uses fixed tokens that
  don't flip in dark mode: `--tag-*` for set-of-marks tags; the intro film
  scopes its own light palette. Text on lime is always `--accent-ink`.
- Primary buttons: `.btn-game`. `--nav-h` is the nav height; the play
  screen is exactly `100dvh - --nav-h`.
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
