/**
 * A headless second player for testing the arena over real Supabase Realtime:
 *   pnpm exec tsx scripts/arena-bot.ts ROOM [seconds]
 * It joins presence, asks for the map, strafes along the floor near the first
 * spawn, shoots at the nearest human, and is hit by their bullets (it decides,
 * like real clients do). Logs what it hears.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const room = process.argv[2] ?? 'QA01';
const seconds = Number(process.argv[3] ?? 40);
const id = `bot-${Math.random().toString(36).slice(2, 6)}`;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const ch = sb.channel(`arena:${room}`, { config: { broadcast: { self: false }, presence: { key: id } } });

type Map = { spawns: { x: number; y: number }[]; platforms: unknown[]; title: string };
let map: Map | null = null;
const humans = new Map<string, { x: number; y: number; alive: boolean; at: number }>();
let hp = 100;
let alive = true;
let respawnAt = 0;
let kills = 0;
let deaths = 0;
let x = 0;
let y = 0;
let dir = 1;
const meta = () => ({ id, name: 'Test Bot', color: '#FF4A3D', kills, deaths, joinedAt: Date.now() + 1e9 });
const stats = { stIn: 0, shotsIn: 0, hitsTaken: 0, dieIn: 0, shotsOut: 0 };

ch.on('broadcast', { event: 'm' }, ({ payload: m }) => {
  if (m.t === 'map' && !map) {
    map = m.map;
    const s = map!.spawns[0];
    x = s.x * 2400;
    y = s.y * 1350 - 24;
    console.log(`[bot] got map "${map!.title}" (${map!.platforms.length} platforms), spawning at ${x | 0},${y | 0}`);
  } else if (m.t === 'st') {
    stats.stIn++;
    humans.set(m.id, { x: m.x, y: m.y, alive: m.alive, at: Date.now() });
    for (const [sx, sy, a] of m.shots) {
      stats.shotsIn++;
      if (!alive) continue;
      // does this ray pass within 22px of me, within range?
      const dx = x - sx, dy = y - sy;
      const along = dx * Math.cos(a) + dy * Math.sin(a);
      const off = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      if (along > 0 && along < 800 && off < 22) {
        stats.hitsTaken++;
        hp -= 10;
        if (hp <= 0) {
          alive = false;
          deaths++;
          respawnAt = Date.now() + 3000;
          ch.send({ type: 'broadcast', event: 'm', payload: { t: 'die', victim: id, killer: m.id } });
          ch.track(meta());
          console.log(`[bot] killed by ${m.id}`);
        }
      }
    }
  } else if (m.t === 'die') {
    stats.dieIn++;
    console.log(`[bot] die: ${m.victim} by ${m.killer}`);
    if (m.killer === id) { kills++; ch.track(meta()); }
  }
});
ch.on('presence', { event: 'sync' }, () => console.log('[bot] presence:', Object.keys(ch.presenceState()).join(', ')));

ch.subscribe(async (s) => {
  if (s !== 'SUBSCRIBED') return;
  await ch.track(meta());
  ch.send({ type: 'broadcast', event: 'm', payload: { t: 'needmap', from: id } });
  const t0 = Date.now();
  let nextShot = 0;
  const tick = setInterval(() => {
    if (!map) return;
    if (!alive && Date.now() > respawnAt) { alive = true; hp = 100; }
    x += dir * 25; // ~250 px/s strafing
    const s0 = map.spawns[0].x * 2400;
    if (Math.abs(x - s0) > 180) dir = -dir;
    const shots: [number, number, number][] = [];
    const target = [...humans.values()].find((h) => h.alive && Date.now() - h.at < 2000);
    let aim = dir > 0 ? 0 : Math.PI;
    if (target) aim = Math.atan2(target.y - y, target.x - x);
    if (alive && target && Date.now() > nextShot && Math.hypot(target.x - x, target.y - y) < 900) {
      shots.push([Math.round(x + Math.cos(aim) * 26), Math.round(y + Math.sin(aim) * 26), +aim.toFixed(3)]);
      stats.shotsOut++;
      nextShot = Date.now() + 250;
    }
    ch.send({ type: 'broadcast', event: 'm', payload: { t: 'st', id, x: Math.round(x), y: Math.round(y), vx: dir * 250, vy: 0, aim: +aim.toFixed(2), hp, alive, jet: false, shots } });
    if (Date.now() - t0 > seconds * 1000) {
      clearInterval(tick);
      console.log('[bot] stats', JSON.stringify({ ...stats, kills, deaths, hp }));
      ch.untrack().then(() => process.exit(0));
    }
  }, 100);
});
