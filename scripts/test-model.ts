/**
 * Phase 1 smoke test: sample → vision → model → Zod → fixer, with timings.
 *
 *   pnpm test:model                       # all samples, MODEL_PROVIDER from env
 *   pnpm test:model -- --provider ollama  # force a provider
 *   pnpm test:model -- --sample 03        # one sample (prefix match)
 *   pnpm test:model -- --probe            # gemini: also try systemInstruction + JSON mode
 *
 * Reads .env.local / .env. Run via the package script (it sets the
 * react-server condition so `server-only` imports resolve).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { encodeJpeg, visionFromFile } from './node-vision';

type Provider = 'gemini' | 'ollama';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // Imported after dotenv so env.ts sees the variables.
  const { generateJSON, AIError } = await import('../src/lib/ai/index');
  const { PARSE_SYSTEM, parsePrompt } = await import('../src/lib/ai/prompts');
  const { LevelFromModel, LevelSchema, reconcileLabels } = await import('../src/lib/schema');
  const { fixLevel } = await import('../src/lib/fixer');

  const provider = (arg('provider') ?? process.env.MODEL_PROVIDER ?? 'gemini') as Provider;
  const only = arg('sample');
  const probe = process.argv.includes('--probe');
  const twoImages = process.argv.includes('--two-images');
  const repeat = Number(arg('repeat') ?? 1);
  const dir = path.resolve('public/samples');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jpg') && !f.includes('.thumb.'))
    .filter((f) => !only || f.startsWith(only));

  const jsonSchema = z.toJSONSchema(LevelSchema) as Record<string, unknown>;
  console.log(`provider=${provider} model=${provider === 'ollama' ? process.env.OLLAMA_MODEL ?? 'gemma4:e4b' : process.env.CLOUD_MODEL ?? process.env.GEMMA_CLOUD_MODEL ?? '(unset)'}\n`);

  const variants: { name: string; nativeSystemInstruction: boolean; jsonMode: boolean }[] = [
    { name: process.argv.includes('--native') ? 'native-system' : 'inline-system', nativeSystemInstruction: process.argv.includes('--native'), jsonMode: false },
  ];
  if (probe && provider === 'gemini') {
    variants.push(
      { name: 'native-system', nativeSystemInstruction: true, jsonMode: false },
      { name: 'json-mode', nativeSystemInstruction: false, jsonMode: true },
    );
  }

  const timings: number[] = [];
  for (const f of files) {
    const vision = await visionFromFile(path.join(dir, f));
    const som = encodeJpeg(vision.som, 1024, 80);
    const clean = encodeJpeg(vision.clean, 1024, 80);
    console.log(`── ${f}  (vision ${vision.ms}ms, ${vision.marks.length} marks, som ${(som.length / 1024).toFixed(0)}KB b64)`);
    for (let rep = 0; rep < repeat; rep++) for (const v of variants) {
      try {
        const res = await generateJSON({
          provider,
          system: PARSE_SYSTEM,
          prompt: parsePrompt(vision.marks),
          images: twoImages ? [clean, som] : [som],
          ...(twoImages ? { prompt: parsePrompt(vision.marks, true) } : {}),
          schema: LevelFromModel,
          jsonSchema,
          nativeSystemInstruction: v.nativeSystemInstruction,
          jsonMode: v.jsonMode,
        });
        timings.push(res.ms);
        const level = fixLevel(reconcileLabels(res.data, vision.marks), vision.marks);
        console.log(`  [${v.name}] ${res.ms}ms, attempts=${res.attempts}`);
        console.log(`  "${level.title}" (difficulty ${level.difficulty}) — ${level.story}`);
        for (const l of level.labels) {
          const extra = [l.behaviour, l.direction, l.personality && `"${l.personality}"`].filter(Boolean).join(' ');
          console.log(`    #${l.id} ${l.what} → ${l.role}${extra ? ` (${extra})` : ''}`);
        }
        console.log(`  rules: ${JSON.stringify(level.rules)}`);
        console.log(`  read: ${JSON.stringify(level.rawRuleText)}`);
        console.log(`  note: ${level.designerNote}  rescue=${level.rescue.length}`);
      } catch (e) {
        if (e instanceof AIError) console.log(`  [${v.name}] AIError ${e.code}: ${e.message}${e.detail ? `\n    ${e.detail.slice(0, 400)}` : ''}`);
        else console.log(`  [${v.name}] error:`, e);
      }
    }
    console.log();
  }
  if (timings.length) {
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`avg ${(avg / 1000).toFixed(1)}s over ${timings.length} calls (min ${(Math.min(...timings) / 1000).toFixed(1)}s, max ${(Math.max(...timings) / 1000).toFixed(1)}s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
