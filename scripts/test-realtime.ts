/** Smoke test: two anon clients on one Realtime channel (broadcast + presence) and anonymous sign-in. */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const mk = () => createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const a = mk();
  const b = mk();
  const anon = await a.auth.signInAnonymously();
  console.log('anon sign-in:', anon.error ? `FAILED (${anon.error.message})` : `ok ${anon.data.user?.id}`);
  const room = `arena:test-${Date.now()}`;
  const got = new Promise<unknown>((res) => {
    b.channel(room, { config: { broadcast: { self: false }, presence: { key: 'b' } } })
      .on('broadcast', { event: 'ping' }, (m) => res(m.payload))
      .on('presence', { event: 'sync' }, function (this: unknown) { /* noop */ })
      .subscribe((s) => console.log('b status', s));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const ch = a.channel(room, { config: { broadcast: { self: false } } });
  await new Promise<void>((res) => ch.subscribe((s) => { console.log('a status', s); if (s === 'SUBSCRIBED') res(); }));
  const t0 = Date.now();
  await ch.send({ type: 'broadcast', event: 'ping', payload: { hi: 1, t: t0 } });
  const p = await Promise.race([got, new Promise((r) => setTimeout(() => r('TIMEOUT'), 5000))]);
  console.log('b received:', p, `${Date.now() - t0}ms`);
  process.exit(0);
}
main();
