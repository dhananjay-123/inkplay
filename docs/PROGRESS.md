# Progress

Update this file at the end of every phase, in the same commit.

Legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repo + docs (`CLAUDE.md`, `docs/*`) | 🟡 | |
| 1 | Model smoke test (`scripts/test-model.ts`) | ⬜ | Needs `GEMINI_API_KEY` + `GEMMA_CLOUD_MODEL`, and Ollama installed with `gemma4:e4b` |
| 2 | Skeleton + deploy | ⬜ | Vercel deploy needs a GitHub repo + Vercel account |
| 3 | Core loop | ⬜ | |
| 4 | Supabase gallery | ⬜ | Needs a Supabase project |
| 5 | Design layer | ⬜ | |
| 6 | Polish + resilience | ⬜ | |
| 7 | Ship (README, deploy, `v1.0`) | ⬜ | |

## Phase checklists

### Phase 1 — Model smoke test
- [ ] `scripts/test-model.ts` loads a sample, calls `generateJSON`, prints JSON + latency
- [ ] Run against `gemini`
- [ ] Run against `ollama`
- [ ] Record: accuracy, seconds/call, system-instruction + JSON-mode support → `docs/DECISIONS.md`

### Phase 2 — Skeleton + deploy
- [ ] Next.js + Tailwind v4 + fonts + tokens
- [ ] `src/lib/env.ts`, `/api/health`
- [ ] Placeholder pages, LICENSE, `.env.example`
- [ ] Pushed + deployed to Vercel

### Phase 3 — Core loop
- [ ] OpenCV preprocessing + set-of-marks
- [ ] `/api/parse` → Zod → fixer → Zustand
- [ ] Phaser level on the user's drawing; win/death
- [ ] `/api/review` + end card
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
