# Progress

Update this file at the end of every phase, in the same commit.

Legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Repo + docs (`CLAUDE.md`, `docs/*`) | ✅ | |
| 1 | Model smoke test (`scripts/test-model.ts`) | 🟡 | Gemini done (5/5 samples, see numbers below); Ollama not installed on this laptop yet |
| 2 | Skeleton + deploy | 🟡 | Skeleton done; deploy waits on GitHub repo + Vercel project |
| 3 | Core loop | 🟡 | Verified end to end with real Gemma 4 (cloud); Ollama run pending |
| 4 | Supabase gallery | 🟡 | Code done (schema.sql, `/gallery`, home peek); verify against a real Supabase project |
| 5 | Design layer | 🟡 | Landing page done; intro film, cursor, transitions pending |
| 6 | Polish + resilience | ⬜ | |
| 7 | Ship (README, deploy, `v1.0`) | ⬜ | |

## Phase checklists

### Phase 1 — Model smoke test
- [x] `scripts/test-model.ts` loads a sample, calls `generateJSON`, prints JSON + latency
- [x] `pnpm test:vision` — headless OpenCV run on all 5 samples, writes `.out/*.som.jpg`
- [x] Run against `gemini` (`gemma-4-26b-a4b-it`)
- [ ] Run against `ollama`
- [x] Record: accuracy, seconds/call, system-instruction + JSON-mode support → `docs/DECISIONS.md` (D2, D10, D11)

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
- [x] `supabase/schema.sql`, storage bucket
- [x] Best-effort save, `/gallery`, `/play/[id]`, `record_run` (code; untested against live Supabase)

### Phase 5 — Design layer
- [x] Landing story (hero mini demo, health pill, compare, rules, steps, offline, gallery peek)
- [ ] Intro film, cursor, Lenis, transitions
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
| gemini | gemma-4-26b-a4b-it | 10–31 s (median ≈ 13 s, script); 24 s in-browser for 14 marks | — | thinking MINIMAL, native system, 2 images. Accuracy: every player/goal/hazard/enemy/rule correct on 5 samples; the hatched trampoline reads as spikes |
| ollama | gemma4:e4b | — | — | |
