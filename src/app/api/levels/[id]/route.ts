import { z } from 'zod';
import { getLevel } from '@/lib/supabase/server';

export async function GET(_req: Request, ctx: RouteContext<'/api/levels/[id]'>) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: { code: 'not_found', message: 'No such doodle.' } }, { status: 404 });
  }
  const level = await getLevel(id);
  if (!level) return Response.json({ error: { code: 'not_found', message: 'No such doodle.' } }, { status: 404 });
  return Response.json(level, { headers: { 'cache-control': 'no-store' } });
}
