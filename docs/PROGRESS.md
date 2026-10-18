# Progress

Update this file at the end of every phase, in the same commit.

Legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repo + docs (`CLAUDE.md`, `docs/*`) | ✅ | |
| 1 | Model smoke test (`scripts/test-model.ts`) | ⛔ | Script + vision verified; live runs need `GEMINI_API_KEY` + `GEMMA_CLOUD_MODEL`, and Ollama with `gemma4:e4b` (not installed on this laptop yet) |
| 2 | Skeleton + deploy | 🟡 | Skeleton done; deploy waits on GitHub repo + Vercel project |
| 3 | Core loop | 🟡 | Full loop verified in browser with `MODEL_PROVIDER=mock`; real-model runs pending |
| 4 | Supabase gallery | ⬜ | Needs a Supabase project |
| 5 | Design layer | ⬜ | |
| 6 | Polish + resilience | ⬜ | |
| 7 | Ship (README, deploy, `v1.0`) | ⬜ | |

## Phase checklists

### Phase 1 — Model smoke test
- [x] `scripts/test-model.ts` loads a sample, calls `generateJSON`, prints JSON + latency
- [x] `pnpm test:vision` — headless OpenCV run on all 5 samples, writes `.out/*.som.jpg`
- [ ] Run against `gemini`
- [ ] Run against `ollama`
- [ ] Record: accuracy, seconds/call, system-instruction + JSON-mode support → `docs/DECISIONS.md`

### Phase 2 — Skeleton + deploy
- [x] Next.js + Tailwind v4 + fonts + tokens
- [x] `src/lib/env.ts`, `/api/health`
- [x] Placeholder pages, LICENSE, `.env.example`
- [ ] Pushed + deployed to Vercel

### Phase 3 — Core loop
- [x] OpenCV preprocessing + set-of-marks (in a Web Worker)
- [x] `/api/parse` → Zod → fixer → Zustand
- [x] Phaser level on the user's drawing; win/death (enemies, pickups, boss, rules)
- [x] `/api/review` + end card (canned fallback)
- [ ] All 5 samples, both providers

### Phase 4 — Supabase gallery
- [ ] `supabase/schema.sql`, storage bucket
- [ ] Best-effort save, `/gallery`, `/play/[id]`, `record_run`

### Phase 5 — Design layer
- [ ] Intro film, cursor, Lenis, landing story, transitions
- [ ] Set-of-marks reveal animation, HUD, end card
- [ ] Mobile layout + touch controls

### Phase 6 — Polish
- [ ] Sounds + juice
- [ ] Error/loading states, reduced motion
- [ ] Rate limit, 429 handling
- [ ] Offline check (all assets local, no Supabase)
- [ ] Lighthouse ≥ 85

### Phase 7 — Ship
- [ ] README (problem, novelty, Gemma's 4 jobs, diagram, real latency, setup, offline checklist)
- [ ] Final deploy, tag `v1.0`

## Measured numbers

| Provider | Model | Parse latency | Review latency | Notes |
|---|---|---|---|---|
| gemini | — | — | — | |
| ollama | gemma4:e4b | — | — | |
