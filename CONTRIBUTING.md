# Contributing to INKPLAY

Thanks for helping. Bug reports, new doodle ideas, fixes and docs are all
welcome.

## Getting set up

You need Node 20.9+ and **pnpm** (the repo pins the version in
`package.json`; `corepack enable` picks it up). Please don't use npm or yarn,
they'd create a second lockfile.

```bash
git clone https://github.com/dhananjay-123/inkplay.git
cd inkplay
pnpm install
cp .env.example .env.local
```

No API key? Set `MODEL_PROVIDER=mock` in `.env.local`. The draw → play loop
then runs with a geometry-only labeller, no model and no database. Leave the
Supabase variables empty and the gallery and online arena rooms switch off
on their own (the arena still works across tabs with `/arena?local=1`).

```bash
pnpm dev        # http://localhost:3000
```

## Before you open a pull request

```bash
pnpm lint
pnpm typecheck
pnpm build
```

All three must pass; CI runs the same commands.

- **TypeScript strict.** No `any` unless there's no other way, with a
  comment saying why.
- **Rules are data, never code.** The model only picks from the whitelisted
  unions in `src/lib/schema.ts` and `src/lib/arena/schema.ts`, and the
  server clamps every number. Keep it that way.
- **Offline first.** No CDNs at runtime: fonts, OpenCV.js and samples are
  self-hosted, sounds are synthesized.
- **The core loop works without Supabase.** Anything that talks to Supabase
  is best-effort with a timeout.
- **Anything from another player is untrusted.** Arena messages go through
  `src/lib/arena/wire.ts`; add new message fields there.
- Multiplayer changes: test with real clients. `scripts/arena-bot.ts` joins
  headless players to a room and reports the message rate and gaps.

Design notes live in [`docs/SPEC.md`](docs/SPEC.md) and the reasoning
behind non-obvious choices in [`docs/DECISIONS.md`](docs/DECISIONS.md).
`CLAUDE.md` is the short working guide (written for AI coding agents, but
it's a good summary for humans too).

## Branches and commits

- Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
- Small commits with a clear message, e.g. `fix(arena): keep bots on the map`.
- One topic per pull request, with a short description of what changed and
  how you checked it.

## Security issues

Please report them privately, see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind.
