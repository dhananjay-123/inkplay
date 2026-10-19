## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## How I checked it

<!-- e.g. played a sample level end to end, two tabs on /arena?local=1, MODEL_PROVIDER=mock -->

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm build` pass
- [ ] The draw → play loop still works with no Supabase (`MODEL_PROVIDER=mock`)
- [ ] Rules and maps are still data from a whitelist, with server-side clamping
- [ ] No secrets, keys or personal data in the diff
