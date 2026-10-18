import { z } from 'zod';
import { AIError, generateJSON } from '@/lib/ai';
import { mockLevel } from '@/lib/ai/mock';
import { PARSE_SYSTEM, parsePrompt } from '@/lib/ai/prompts';
import { ParseRequestSchema, type ApiErrorBody, type ParseResponse } from '@/lib/api-types';
import { fixLevel } from '@/lib/fixer';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { LevelFromModel, LevelSchema, reconcileLabels } from '@/lib/schema';
import { saveLevel } from '@/lib/supabase/server';

// Node.js is the default runtime (Cache Components forbids the `runtime` export).
// 60s fits Vercel Hobby; see README for measured latency.
export const maxDuration = 60;

const LEVEL_JSON_SCHEMA = z.toJSONSchema(LevelSchema) as Record<string, unknown>;

const err = (status: number, code: string, message: string, retryAfterS?: number) =>
  Response.json({ error: { code, message, retryAfterS } } satisfies ApiErrorBody, {
    status,
    headers: retryAfterS ? { 'retry-after': String(retryAfterS) } : undefined,
  });

export async function POST(req: Request) {
  const limited = rateLimit(`parse:${clientKey(req)}`, 8, 60_000);
  if (!limited.ok) return err(429, 'rate_limited', 'Easy there, Picasso. Try again in a moment.', limited.retryAfterS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err(400, 'bad_request', 'That drawing got lost in the post.');
  }
  const parsed = ParseRequestSchema.safeParse(body);
  if (!parsed.success) return err(400, 'bad_request', 'That drawing got lost in the post.');
  const { somImage, cleanImage, marks } = parsed.data;

  const t0 = performance.now();
  try {
    const res = await generateJSON({
      system: PARSE_SYSTEM,
      prompt: parsePrompt(marks),
      images: [somImage],
      schema: LevelFromModel,
      jsonSchema: LEVEL_JSON_SCHEMA,
      temperature: 0.2,
      mock: () => mockLevel(marks),
    });
    const level = fixLevel(reconcileLabels(res.data, marks), marks);
    // Saving is best-effort and never fails the request.
    const id = await saveLevel(level, marks, cleanImage);
    const ms = Math.round(performance.now() - t0);
    console.info(`[parse] ${marks.length} marks, model ${res.ms}ms, total ${ms}ms, saved=${Boolean(id)}`);
    return Response.json({ id, level, marks, ms } satisfies ParseResponse);
  } catch (e) {
    if (e instanceof AIError) {
      console.warn(`[parse] ${e.code}: ${e.message}${e.detail ? ` — ${e.detail.slice(0, 300)}` : ''}`);
      if (e.code === 'rate_limited') return err(429, e.code, 'Gemma is catching its breath. Try again in a moment.', 20);
      if (e.code === 'timeout') return err(504, e.code, 'Gemma stared at your drawing for too long. Try again?');
      if (e.code === 'bad_output') return err(502, e.code, 'Gemma doodled outside the lines. Try again?');
      if (e.code === 'misconfigured') return err(503, e.code, 'Gemma isn’t plugged in on this server yet.');
      return err(503, e.code, 'Gemma is out of the room right now. Try again soon.');
    }
    console.error('[parse] unexpected', e);
    return err(500, 'internal', 'Something smudged. Try again?');
  }
}
