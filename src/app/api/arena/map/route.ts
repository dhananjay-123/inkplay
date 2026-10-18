import { z } from 'zod';
import { AIError, generateJSON } from '@/lib/ai';
import { ARENA_DRAWING_SYSTEM, ARENA_SYSTEM, arenaDrawingPrompt, arenaThemePrompt } from '@/lib/ai/arena-prompts';
import { arenaFromDrawing, mockMarkLabels, proceduralArena, proceduralDraft } from '@/lib/arena/procedural';
import { ArenaFromModel, ArenaLabelsFromModel, DEFAULT_OPTIONS, MapOptionsSchema, applyOptions, finalizeArena, type ArenaMap, type ArenaMapResponse } from '@/lib/arena/schema';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { MAX_MARKS, MarkSchema } from '@/lib/schema';

export const maxDuration = 60;

const imageString = z.string().min(100).max(2_300_000);
const RequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('theme'), theme: z.string().max(80).optional(), seed: z.number().int().optional(), options: MapOptionsSchema.optional() }),
  z.object({
    mode: z.literal('drawing'),
    marks: z.array(MarkSchema).min(1).max(MAX_MARKS),
    cleanImage: imageString,
    somImage: imageString,
    sampleId: z.string().regex(/^[0-9a-z-]{1,40}$/).optional(),
    seed: z.number().int().optional(),
    options: MapOptionsSchema.optional(),
  }),
]);

const err = (status: number, code: string, message: string, retryAfterS?: number) =>
  Response.json({ error: { code, message, retryAfterS } }, { status });

/**
 * Gemma designs an arena from a theme (or nothing), or turns a drawing's
 * marks into one. Never fails a valid request: if the model can't answer,
 * a seeded procedural map comes back instead, so a room always gets a map.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`arena:${clientKey(req)}`, 8, 60_000);
  if (!limited.ok) return err(429, 'rate_limited', 'Easy there, general. Try again in a moment.', limited.retryAfterS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, 'bad_request', 'That request got lost in the post.');
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return err(400, 'bad_request', 'That request got lost in the post.');
  const input = parsed.data;
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const opts = input.options ?? DEFAULT_OPTIONS;
  const t0 = performance.now();

  try {
    let map: ArenaMap;
    if (input.mode === 'theme') {
      const res = await generateJSON({
        system: ARENA_SYSTEM,
        prompt: arenaThemePrompt(input.theme, seed, opts),
        schema: ArenaFromModel,
        temperature: 0.7,
        timeoutMs: 54_000,
        mock: () => proceduralDraft(seed),
      });
      map = finalizeArena(applyOptions(res.data, opts, seed), seed);
    } else {
      const { marks } = input;
      const res = await generateJSON({
        system: ARENA_DRAWING_SYSTEM,
        prompt: arenaDrawingPrompt(marks, opts),
        images: [input.cleanImage, input.somImage],
        schema: ArenaLabelsFromModel,
        temperature: 0.3,
        timeoutMs: 54_000,
        mock: () => ({ title: 'Doodle Warzone', story: 'Your drawing, now with bullets.', labels: mockMarkLabels(marks), rules: [], extras: {} }),
      });
      map = arenaFromDrawing(marks, res.data.labels, res.data, res.data.extras, opts, seed, input.sampleId);
    }
    const ms = Math.round(performance.now() - t0);
    console.info(`[arena] ${input.mode} map by model in ${ms}ms: ${map.platforms.length} platforms, ${map.hazards.length} hazards, ${map.enemies.length} enemies, ${map.pickups.length} pickups`);
    return Response.json({ map, source: 'model', ms } satisfies ArenaMapResponse);
  } catch (e) {
    const reason = e instanceof AIError ? `${e.code}: ${e.message}` : String(e);
    console.warn(`[arena] model failed (${reason}); procedural fallback`);
    const map =
      input.mode === 'drawing'
        ? arenaFromDrawing(input.marks, mockMarkLabels(input.marks), { title: 'Doodle Warzone', story: 'Gemma was busy, so we guessed what you drew.', rules: [] }, null, opts, seed, input.sampleId)
        : proceduralArena(seed, opts);
    return Response.json({
      map,
      source: 'procedural',
      ms: Math.round(performance.now() - t0),
      note: e instanceof AIError && e.code === 'rate_limited' ? 'Gemma is catching its breath, so the ruler drew this one.' : 'Gemma was out of the room, so the ruler drew this one.',
    } satisfies ArenaMapResponse);
  }
}
