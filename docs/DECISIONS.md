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
