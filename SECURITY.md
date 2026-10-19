# Security policy

## Supported versions

INKPLAY is a web app, not a library. Only the latest `main` (what runs at
https://inkplay-lemon.vercel.app) gets security fixes.

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/dhananjay-123/inkplay/security/advisories/new)
(repo → Security → Advisories → Report a vulnerability).

Include what you found, how to reproduce it, and what an attacker could do
with it. A proof of concept against your own local copy (`pnpm dev`) is
ideal. Please don't test against the live site in ways that cost money or
affect other players (flooding the model endpoints, arena rooms or the
gallery).

What to expect:

- an acknowledgement within a week,
- a fix or a plan within 30 days for anything serious,
- credit in the release notes if you'd like it.

## Scope

In scope: the code in this repository, including the API routes, the
arena netcode, the Supabase schema and anything that could leak a server
key or let one player crash or hijack another player's game.

Out of scope: cheating in arena matches (the arena is peer-to-peer by
design, see `docs/DECISIONS.md`), rate limits being per server instance,
and reports from automated scanners without a working example.
