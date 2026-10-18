/** Smoke test: Gemma designs an arena from a theme (pnpm test:arena [theme]). */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { generateJSON } = await import('../src/lib/ai');
  const { ARENA_SYSTEM, arenaThemePrompt } = await import('../src/lib/ai/arena-prompts');
  const { ArenaFromModel, DEFAULT_OPTIONS, applyOptions, finalizeArena } = await import('../src/lib/arena/schema');
  const theme = process.argv[2];
  const seed = 1234;
  const res = await generateJSON({ system: ARENA_SYSTEM, prompt: arenaThemePrompt(theme, seed, DEFAULT_OPTIONS), schema: ArenaFromModel, temperature: 0.9, timeoutMs: 55_000 });
  const map = finalizeArena(applyOptions(res.data, DEFAULT_OPTIONS, seed), seed);
  console.log(`ok in ${res.ms}ms, attempts ${res.attempts}`);
  console.log(`raw platforms ${res.data.platforms.length}, spawns ${res.data.spawns.length}, pickups ${res.data.pickups.length}`);
  console.log(`raw hazards ${res.data.hazards.length}, enemies ${res.data.enemies.length}; final platforms ${map.platforms.length}, hazards ${JSON.stringify(map.hazards.map((h) => h.kind))}, enemies ${map.enemies.length}, spawns ${map.spawns.length}, pickups ${JSON.stringify(map.pickups.map((p) => p.kind))}, rules ${JSON.stringify(map.rules)}`);
  console.log(map.title, '-', map.story);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
