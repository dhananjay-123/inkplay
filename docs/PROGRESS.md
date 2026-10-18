# Progress

Update this file at the end of every phase, in the same commit.

Legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repo + docs (`CLAUDE.md`, `docs/*`) | ✅ | |
| 1 | Model smoke test (`scripts/test-model.ts`) | ✅ | Gemini + Ollama both 5/5 on player/goal (numbers below) |
| 2 | Skeleton + deploy | ✅ | Live on Vercel (Mumbai, `bom1`): https://inkplay-lemon.vercel.app · GitHub `dhananjay-123/hacktober-fest-Inkplay`, every push to `main` deploys |
| 3 | Core loop | ✅ | End to end in the browser with Gemma 4 (cloud); all 5 samples through both providers in the smoke test; digital drawings handled |
| 4 | Supabase gallery | 🟡 | Code done (schema.sql, `/gallery`, home peek); verify against a real Supabase project |
| 5 | Design layer | 🟡 | Arcade palette, intro film, cursor, nav, guide, rules playground, living doodles done; Lenis + page transitions not done (cuttable) |
| 6 | Polish + resilience | 🟡 | Rate limits, reduced motion, sounds, perf pass done; offline browser run + Lighthouse pending |
| 8 | Ink Arena multiplayer (`/arena`, D18) | 🟡 | Realtime rooms, jetpack, autofire, respawn, Gemma maps from theme or drawing; verified with a browser + headless bot (`scripts/arena-bot.ts`) over real Realtime (map sync, kills both ways, respawn, scoreboard), 2 tabs offline, theme / drawing / night maps. Pending: 2-human playtest on Vercel |
| 7 | Ship (README, deploy, `v1.0`) | 🟡 | README + deploy done; tag `v1.0` pending |

## Phase checklists

### Phase 1 — Model smoke test
- [x] `scripts/test-model.ts` loads a sample, calls `generateJSON`, prints JSON + latency
- [x] `pnpm test:vision` — headless OpenCV run on all 5 samples, writes `.out/*.som.jpg`
- [x] Run against `gemini` (`gemma-4-26b-a4b-it`)
- [x] Run against `ollama` (`gemma4:e4b`, RTX 4060 laptop)
- [x] Record: accuracy, seconds/call, system-instruction + JSON-mode support → `docs/DECISIONS.md` (D2, D10, D11)

### Phase 2 — Skeleton + deploy
- [x] Next.js + Tailwind v4 + fonts + tokens
- [x] `src/lib/env.ts`, `/api/health`
- [x] Placeholder pages, LICENSE, `.env.example`
- [x] Pushed + deployed to Vercel (`vercel.json` pins `bom1`; env set for Production + Preview)

### Phase 3 — Core loop
- [x] OpenCV preprocessing + set-of-marks (in a Web Worker)
- [x] `/api/parse` → Zod → fixer → Zustand
- [x] Phaser level on the user's drawing; win/death (enemies, pickups, boss, rules)
- [x] `/api/review` + end card (canned fallback)
- [x] All 5 samples, both providers (smoke test)
- [x] Digital drawings (screenshots, transparent PNGs): no false paper warp, letterbox instead of crop, canvas borders dropped, P separated from sloped ground (D13)
- [x] Trampoline vs spikes decided by measurement (D12)

### Phase 4 — Supabase gallery
- [x] `supabase/schema.sql`, storage bucket
- [x] Best-effort save, `/gallery`, `/play/[id]`, `record_run` (code; untested against live Supabase)

### Phase 5 — Design layer
- [x] Landing story (hero mini demo, compare, rules, steps, offline, gallery peek); status pill removed on request
- [x] Arcade palette (violet ink, deep-purple dark mode, lime `.btn-game` buttons), fixed per-role tag colours
- [x] Intro film (GSAP + SVG, every full load of `/`, skippable) (D14)
- [x] Pen-nib cursor with ink trail; magnetic buttons
- [x] Nav with hero logo, icon tray, active + pending states
- [x] `/guide` (symbols, open vocabulary, every rule, photo tips) + legend on `/create`
- [x] Rules playground (live physics toggles + JSON), living doodles, animated step icons, margin notes
- [x] Set-of-marks reveal, HUD with coin tracker, end card; play screen fits one viewport
- [x] Touch controls on coarse pointers
- [ ] Lenis smooth scroll, ink-blot page transitions (cut)

### Phase 6 — Polish
- [x] Sounds (synthesized Web Audio, muted by default) + juice
- [x] Error/loading states, reduced motion
- [x] Rate limit, 429 handling
- [x] Perf: cursor idles, Phaser preloaded on `/create`, OpenCV + samples cached a day (D15)
- [ ] Offline check in the browser (`pnpm build` online → Wi-Fi off → `pnpm demo`)
- [ ] Lighthouse ≥ 85

### Phase 7 — Ship
- [x] README (problem, novelty, Gemma's 4 jobs, diagram, real latency, setup, offline checklist)
- [x] Deploy
- [ ] Tag `v1.0`

## Measured numbers

| Provider | Model | Parse latency | Review latency | Notes |
|---|---|---|---|---|
| gemini | gemma-4-26b-a4b-it | ≈ 11 s typical (script), 10–31 s range; 20–26 s in-browser | 2.4–3.9 s | thinking MINIMAL, native system, 2 images. Player/goal/hazard/enemy/rules right on 5/5; trampoline 3/3 bouncy since D12 |
| ollama | gemma4:e4b | 15–16 s clean; 32–44 s when the first reply is malformed JSON and retried (2/5 samples) | — | RTX 4060 8 GB laptop. Player, goal and rules right on 5/5; enemies on 03/04 found |
