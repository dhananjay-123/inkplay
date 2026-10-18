'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Browser client (anon key only), or null when Supabase isn't configured at build time. */
export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
    // Heartbeats in a worker: background tabs throttle timers, and a missed
    // heartbeat silently drops the socket (and the player) from the room.
    realtime: { params: { eventsPerSecond: 30 }, worker: true },
  });
  return client;
}

const ANON_FAILED = 'inkplay:anon-auth-failed';

/**
 * Best-effort Supabase anonymous sign-in. Returns the auth user id, or null
 * when anonymous sign-ins are disabled on the project (remembered for the
 * session so we don't retry on every join). Realtime broadcast works either way.
 */
export async function anonymousUserId(): Promise<string | null> {
  const sb = supabaseBrowser();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    if (sessionStorage.getItem(ANON_FAILED)) return null;
    const res = await sb.auth.signInAnonymously();
    if (res.error || !res.data.user) {
      sessionStorage.setItem(ANON_FAILED, '1');
      return null;
    }
    return res.data.user.id;
  } catch {
    return null;
  }
}
