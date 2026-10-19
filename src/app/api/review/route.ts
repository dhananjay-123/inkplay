import { AIError, generateJSON } from '@/lib/ai';
import { CANNED_VERDICTS, REVIEW_SYSTEM, reviewPrompt } from '@/lib/ai/prompts';
import { ReviewRequestSchema, type ApiErrorBody, type ReviewResponse } from '@/lib/api-types';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { ReviewFromModel, type RunStats } from '@/lib/schema';
import { recordRun } from '@/lib/supabase/server';

export const maxDuration = 30;

/** No drawn level can be crossed faster than this; quicker "wins" aren't counted. */
const MIN_WIN_SECONDS = 1;

function canned(stats: RunStats): ReviewResponse {
  const list = CANNED_VERDICTS[stats.result];
  const verdict = list[Math.floor(Math.random() * list.length)];
  const stars = stats.result === 'win' ? Math.max(2, 5 - Math.min(3, Math.floor(stats.deaths / 2))) : 1 + Math.min(1, stats.coins);
  return { verdict, stars, source: 'canned' };
}

export async function POST(req: Request) {
  const body = await readJson(req, 4_000);
  const parsed = ReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: 'bad_request', message: 'No run to review.' } } satisfies ApiErrorBody, { status: 400 });
  }
  const { levelId, title, stats } = parsed.data;
  const ip = clientKey(req);

  // Stats are recorded even if the verdict falls back to canned lines, but
  // they are client-reported: limit how often one client can count a run
  // (per level and overall) and ignore impossible instant wins.
  const plausible = stats.result !== 'win' || stats.timeSeconds >= MIN_WIN_SECONDS;
  const countRun =
    levelId && plausible && rateLimit(`run:${ip}`, 30, 60_000).ok && rateLimit(`run:${ip}:${levelId}`, 6, 60_000).ok;
  const recording = countRun ? recordRun(levelId, stats) : Promise.resolve();

  let review: ReviewResponse;
  if (!rateLimit(`review:${ip}`, 20, 60_000).ok) {
    review = canned(stats);
  } else {
    try {
      const res = await generateJSON({
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt(title, stats),
        schema: ReviewFromModel,
        temperature: 0.8,
        timeoutMs: 20_000,
        mock: () => canned(stats),
      });
      review = { ...res.data, source: 'model' };
    } catch (e) {
      console.warn('[review] falling back to canned verdict:', e instanceof AIError ? e.code : e);
      review = canned(stats);
    }
  }
  await recording;
  return Response.json(review);
}
