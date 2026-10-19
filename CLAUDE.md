# INKPLAY — Paper to Playable

> *Draw it. Write the rules. Play it.*

A free, open-source (MIT) game for real players: draw a level on paper,
play it, plus Ink Arena (multiplayer) and Survival (endless runner).
Live at https://inkplay-lemon.vercel.app. Copy is written for players, not
judges: describe what the game does, not the model or the tech behind it.

This file is the working guide for anyone (human or agent) touching the repo.
The full product spec lives in [`docs/SPEC.md`](docs/SPEC.md). Phase status
lives in [`docs/PROGRESS.md`](docs/PROGRESS.md). Non-obvious choices are logged
in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Working rules

1. **Build in phases** (see `docs/PROGRESS.md`). Finish a phase, run it, fix
   errors, commit with a clear message, then move on. Never end a phase with
   the app in a non-running state.
2. **Working and shippable beats ambitious and broken.** Real people play
   the live site.
3. **pnpm only.** `pnpm add`, `pnpm dev`, `pnpm build`. Never npm or yarn.
4. **TypeScript strict.** No `any` unless unavoidable, and comment why.
5. **Secrets:** never hard-code them, never import server keys into client
   code. Server-only modules start with `import 'server-only'`.
6. **Model IDs are never invented.** They come from env
   (`CLOUD_MODEL`, `OLLAMA_MODEL`). Don't name a specific model in UI
   copy; say "the AI" or describe what happens.
7. **Offline first.** Fonts, OpenCV.js, textures and samples are self-hosted
   in `/public` or bundled; sounds are synthesized (Web Audio). The app
   must run in airplane mode
   with `MODEL_PROVIDER=ollama`.
8. **Verify uncertain behaviour with a small script first** (API shapes,
   provider quirks), then build on what you saw.
9. **Golden rule:** draw → parse → play → review must work with **no
   Supabase at all**. Supabase is the gallery and the arena's Realtime
   rooms, always best-effort: without it the arena falls back to
   `BroadcastChannel` (tabs of one browser).
10. **Commit often, push once.** Every push to `main` is a Vercel production
    deploy. Batch the work, run `pnpm build` locally, then push a single time.
11. **Rules are data, never code.** The model may only pick from the
    whitelisted `Rule` union in `src/lib/schema.ts`. All numbers are clamped
    server-side. Arena maps follow the same rule (`src/lib/arena/schema.ts`:
    `finalizeArena` clamps, separates overlaps, keeps hazards reachable).
12. **Test multiplayer with real clients.** `scripts/arena-bot.ts ROOM secs N`
    joins N headless players and reports per-player message rate and the
    longest gap; run it against a browser room before shipping netcode.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build (must pass with zero type errors) |
| `pnpm start` | Serve the production build |
| `pnpm start:offline` | `MODEL_PROVIDER=ollama next start`, fully offline |
| `pnpm test:model` | Phase 1 smoke test against the configured provider |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:arena [theme]` | The model designs one arena map |
| `pnpm test:realtime` | Two Supabase Realtime clients + anon sign-in check |
| `pnpm exec tsx scripts/arena-bot.ts ROOM [secs] [n]` | N headless arena players; sync report |

## Layout

```
src/
  app/                 routes (App Router) + api/ route handlers
  components/          React UI (design layer): arena/ (lobby, room HUD,
                       map maker, Phaser mount), home/ (intro film, playground,
                       doodles), create/, game/, gallery/, guide/,
                       survival/, nav, cursor
  game/                Phaser 3 scenes, client-only (LevelScene, ArenaScene,
                       SurvivalScene)
  lib/
    env.ts             Zod-validated env, provider + hasSupabase flags
    schema.ts          Level / MarkLabel / Rule schemas + clamping
    fixer.ts           post-parse auto-fixer (player, goal, reachability)
    ai/                provider abstraction (gemini | ollama) + prompts
    arena/             multiplayer arena: map schema + clamping/cleanup,
                       procedural fallback, weapons/buffs data,
                       Realtime (+watchdog) / BroadcastChannel transport
    survival/          endless runner: chunk schema + clamping, seeded
                       chunk generator, speed/difficulty ramp
    vision/            OpenCV.js preprocessing, set-of-marks rendering
    editor/            in-browser level canvas: scene + PNG export,
                       doodle library, templates/draft in localStorage
    supabase/          server.ts (service role) / client.ts (anon)
    store.ts           Zustand store for the current level
public/
  opencv/opencv.js     self-hosted
  samples/             5 sample drawings
scripts/test-model.ts  Phase 1 smoke test
supabase/schema.sql    paste into the Supabase SQL editor
```

## Design system (summary — full detail in `docs/SPEC.md` §5)

- Concept: **Sketchbook**. Marker ink on a dotted cream page, highlighter
  swipes, tape, sticker buttons, blue-ballpoint margin notes, living doodles.
  Light only, on purpose: the site is the same paper as the drawings.
- Tokens (`src/app/globals.css`): paper `#FFFAF0`, ink `#1D1B18` (warm
  marker black, matches the game canvas), graphite `#6E675C`, accent lime
  `#B6FF2E`, hazard `#FF4A3D`, pop = ballpoint blue `#2D5BFF`, sun
  `#FFCF3F`, sky `#5CC8FF`, bubble `#FF9EC7`.
- Hand-drawn shapes come from tokens too: `--wobble` (cards),
  `--wobble-btn` (buttons/chips), `--shadow-hard` (ink offset shadow).
  Helpers: `.sketch`, `.sketch-soft`, `.tape` (+ `.tape-pink/-blue`),
  `.circled`, `.highlight`, `.link-scrawl`.
- `--tag-*` colour set-of-marks tags. Text on lime is always `--accent-ink`.
- Mono `.label` is for HUD/stats/code only, not eyebrows over headings.
  Avoid em dashes and slogan-style copy in the UI.
- Primary buttons: `.btn-game`; secondary: `.btn-ghost` (add `.btn-sm` in tight spots). `--nav-h` is the nav height; the play
  screen is exactly `100dvh - --nav-h`.
- Fonts via `next/font`: Bricolage Grotesque (display), Kalam (handwriting /
  margin notes), JetBrains Mono (labels/HUD, uppercase, tracked).
- Respect `prefers-reduced-motion` everywhere.
- Define colours as CSS variables; don't hard-code hex in components.

## Running modes

| Mode | Where | `MODEL_PROVIDER` | Supabase |
|---|---|---|---|
| Public site | Vercel | `gemini` | on (gallery + arena rooms) |
| Offline self-host | Laptop, `pnpm build` online → `pnpm start:offline` | `ollama` | off (arena: tabs of one browser, bots fill the room) |
| Dev | Laptop, `pnpm dev` | either | either |

## Never break

Core loop, set-of-marks reveal, handwritten rules, offline mode, README +
LICENSE.
