import { connection } from 'next/server';
import { listLevels } from '@/lib/supabase/server';

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const page = Math.max(0, Math.min(500, Number(url.searchParams.get('page')) || 0));
  const pageSize = Math.max(1, Math.min(48, Number(url.searchParams.get('pageSize')) || 24));
  const levels = await listLevels(page, pageSize);
  return Response.json({ levels, page, pageSize }, { headers: { 'cache-control': 'no-store' } });
}
