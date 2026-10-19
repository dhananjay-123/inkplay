import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, hasSupabase } from '@/lib/env';
import type { SavedLevel, SavedLevelDetail } from '@/lib/api-types';
import type { Mark, PlayableLevel, RunStats } from '@/lib/schema';

export const BUCKET = 'drawings';

let client: SupabaseClient | null = null;

/** Service-role client, or null when Supabase isn't configured. */
export function supabaseAdmin(): SupabaseClient | null {
  if (!hasSupabase) return null;
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

type LevelRow = {
  id: string;
  created_at: string;
  title: string;
  difficulty: number;
  level_json: { level: PlayableLevel; marks: Mark[] } | null;
  image_path: string;
  plays: number;
  wins: number;
  best_time: number | null;
};

const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('supabase timeout')), ms))]);

function publicUrl(sb: SupabaseClient, path: string): string {
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function toSaved(sb: SupabaseClient, r: LevelRow): SavedLevel {
  return {
    id: r.id,
    createdAt: r.created_at,
    title: r.title,
    difficulty: r.difficulty,
    imageUrl: publicUrl(sb, r.image_path),
    plays: r.plays,
    wins: r.wins,
    bestTime: r.best_time,
  };
}

/** JPEG start-of-image marker (the vision step always encodes a JPEG). */
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Best effort: returns the new id, or null on any failure. Never throws. */
export async function saveLevel(level: PlayableLevel, marks: Mark[], cleanImageB64: string): Promise<string | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  try {
    const id = crypto.randomUUID();
    const path = `levels/${id}.jpg`;
    const bytes = Buffer.from(cleanImageB64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    // The bucket is public: only ever host what we claim it is, a JPEG.
    if (!isJpeg(bytes)) throw new Error('clean image is not a JPEG');
    const up = await withTimeout(sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false }), 8000);
    if (up.error) throw up.error;
    const ins = await withTimeout(
      sb.from('levels').insert({ id, title: level.title.slice(0, 80), difficulty: level.difficulty, level_json: { level, marks }, image_path: path }),
      8000,
    );
    if (ins.error) throw ins.error;
    return id;
  } catch (e) {
    console.warn('[supabase] saveLevel failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

const LIST_COLUMNS = 'id, created_at, title, difficulty, image_path, plays, wins, best_time';

export async function listLevels(page: number, pageSize: number): Promise<SavedLevel[]> {
  const sb = supabaseAdmin();
  if (!sb) return [];
  try {
    const from = page * pageSize;
    const res = await withTimeout(
      sb.from('levels')
        .select(LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1),
      6000,
    );
    if (res.error) throw res.error;
    return (res.data as LevelRow[]).map((r) => toSaved(sb, r));
  } catch (e) {
    console.warn('[supabase] listLevels failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

export async function getLevel(id: string): Promise<SavedLevelDetail | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  try {
    const res = await withTimeout(sb.from('levels').select(`${LIST_COLUMNS}, level_json`).eq('id', id).maybeSingle(), 6000);
    if (res.error) throw res.error;
    const row = res.data as LevelRow | null;
    if (!row?.level_json) return null;
    return { ...toSaved(sb, row), level: row.level_json.level, marks: row.level_json.marks };
  } catch (e) {
    console.warn('[supabase] getLevel failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function recordRun(levelId: string, stats: RunStats): Promise<void> {
  const sb = supabaseAdmin();
  if (!sb) return;
  try {
    const res = await withTimeout(
      sb.rpc('record_run', { p_level_id: levelId, p_result: stats.result, p_deaths: stats.deaths, p_time_s: stats.timeSeconds }),
      6000,
    );
    if (res.error) throw res.error;
  } catch (e) {
    console.warn('[supabase] recordRun failed:', e instanceof Error ? e.message : e);
  }
}
