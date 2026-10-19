import { z } from 'zod';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { getLevel } from '@/lib/supabase/server';

export async function GET(req: Request, ctx: RouteContext<'/api/levels/[id]'>) {
  if (!rateLimit(`level:${clientKey(req)}`, 60, 60_000).ok) {
    return Response.json({ error: { code: 'rate_limited', message: 'Slow down a little.' } }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: { code: 'not_found', message: 'No such doodle.' } }, { status: 404 });
  }
  const level = await getLevel(id);
  if (!level) return Response.json({ error: { code: 'not_found', message: 'No such doodle.' } }, { status: 404 });
  return Response.json(level, { headers: { 'cache-control': 'no-store' } });
}
