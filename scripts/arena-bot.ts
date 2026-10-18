/**
 * Headless players for testing the arena over real Supabase Realtime:
 *   pnpm exec tsx scripts/arena-bot.ts ROOM [seconds] [bots]
 * Each bot joins presence, asks for the map, strafes near a spawn point,
 * shoots at the nearest player, and takes hits like a real client
 * (victim-authoritative). At the end each bot reports, per other player:
 * messages received, rate, and the longest gap (a gap > 1 s = visible
 * stutter; > 5 s = that player would vanish).
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const room = process.argv[2] ?? 'QA01';
const seconds = Number(process.argv[3] ?? 40);
const count = Number(process.argv[4] ?? 1);

type Map = { spawns: { x: number; y: number }[]; platforms: unknown[]; title: string };

function bot(index: number): Promise<string> {
  return new Promise((done) => {
    const id = `bot${index}-${Math.random().toString(36).slice(2, 6)}`;
    const name = `Bot ${index + 1}`;
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 30 }, logger: (kind: string, msg: string, data?: unknown) => { if (/close|error|timeout|heartbeat/i.test(kind + msg) && !/ok/.test(JSON.stringify(data ?? ''))) console.error(`[bot${index + 1} ${kind}] ${msg} ${JSON.stringify(data ?? '').slice(0, 160)}`); } },
    });
    const ch = sb.channel(`arena:${room}`, { config: { broadcast: { self: false }, presence: { key: id } } });
    const joinedAt = Date.now() + 1e9; // never the host
    let map: Map | null = null;
    let round = 0;
    let mapFrom = '';
    const seen = new Map<string, { n: number; first: number; last: number; maxGap: number; x: number; y: number; alive: boolean; away: boolean }>();
    let hp = 100;
    let alive = true;
    let respawnAt = 0;
    let kills = 0;
    let deaths = 0;
    let x = 0;
    let y = 0;
    let dir = 1;
    let npcMsgs = 0;
    let otherMap = 0;
    let botCount = -1;
    const meta = () => ({ id, name, color: '#FF4A3D', kills, deaths, joinedAt });

    ch.on('broadcast', { event: 'm' }, ({ payload: m }) => {
      const now = Date.now();
      if (m.t === 'map' && (!map || m.round > round || (m.round === round && m.from < mapFrom))) {
        map = m.map;
        round = m.round;
        mapFrom = m.from;
        const s = map!.spawns[index % map!.spawns.length];
        x = s.x * 2400;
        y = s.y * 1350 - 24;
      } else if (m.t === 'st') {
        if (m.r !== round || m.mf !== mapFrom) {
          otherMap++;
          return;
        }
        const s = seen.get(m.id) ?? { n: 0, first: now, last: now, maxGap: 0, x: 0, y: 0, alive: true, away: false };
        s.maxGap = Math.max(s.maxGap, now - s.last);
        s.n++;
        s.last = now;
        s.x = m.x;
        s.y = m.y;
        s.alive = m.alive;
        s.away = !!m.away;
        seen.set(m.id, s);
        if (m.n) npcMsgs++;
        if (typeof m.bn === 'number') botCount = m.bn;
        for (const [sx, sy, a] of m.shots as [number, number, number][]) {
          if (!alive) continue;
          const dx = x - sx;
          const dy = y - sy;
          const along = dx * Math.cos(a) + dy * Math.sin(a);
          const off = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
          if (along > 0 && along < 800 && off < 22) {
            hp -= 10;
            if (hp <= 0) {
              alive = false;
              deaths++;
              respawnAt = now + 3000;
              ch.send({ type: 'broadcast', event: 'm', payload: { t: 'die', victim: id, killer: m.id } });
              ch.track(meta());
            }
          }
        }
      } else if (m.t === 'die' && m.killer === id) {
        kills++;
        ch.track(meta());
      }
    });

    const events: string[] = [];
    const t00 = Date.now();
    ch.on('system', {}, (p) => events.push(`${((Date.now() - t00) / 1000).toFixed(1)}s system ${JSON.stringify(p).slice(0, 120)}`));
    let started = false;
    ch.subscribe(async (s, err) => {
      events.push(`${((Date.now() - t00) / 1000).toFixed(1)}s ${s}${err ? ` ${err.message}` : ''}`);
      if (s !== 'SUBSCRIBED' || started) return;
      started = true;
      await ch.track(meta());
      ch.send({ type: 'broadcast', event: 'm', payload: { t: 'needmap', from: id } });
      const t0 = Date.now();
      let nextShot = 0;
      const tick = setInterval(() => {
        const now = Date.now();
        if (!map) {
          if (now - t0 > 1500 && now - t0 < 1700) ch.send({ type: 'broadcast', event: 'm', payload: { t: 'needmap', from: id } });
          return;
        }
        if (!alive && now > respawnAt) {
          alive = true;
          hp = 100;
        }
        x += dir * 25;
        const s0 = map.spawns[index % map.spawns.length].x * 2400;
        if (Math.abs(x - s0) > 160) dir = -dir;
        const shots: [number, number, number, number, number][] = [];
        const target = [...seen.values()].find((h) => h.alive && !h.away && now - h.last < 2000);
        let aim = dir > 0 ? 0 : Math.PI;
        if (target) aim = Math.atan2(target.y - y, target.x - x);
        if (alive && target && now > nextShot && Math.hypot(target.x - x, target.y - y) < 900) {
          shots.push([Math.round(x + Math.cos(aim) * 26), Math.round(y + Math.sin(aim) * 26), +aim.toFixed(3), 0, 10]);
          nextShot = now + 300;
        }
        ch.send({
          type: 'broadcast',
          event: 'm',
          payload: { t: 'st', id, ts: Math.round(performance.now()), r: round, mf: mapFrom, nm: name, c: '#FF4A3D', j: joinedAt, x: Math.round(x), y: Math.round(y), vx: dir * 250, vy: 0, aim: +aim.toFixed(2), hp, alive, jet: false, w: 0, sh: false, shots },
        });
        if (now - t0 > seconds * 1000) {
          clearInterval(tick);
          const end = Date.now();
          const rows = [...seen.entries()].map(([sid, v]) => `${sid}: ${v.n} msgs, ${(v.n / ((end - v.first) / 1000)).toFixed(1)}/s, max gap ${v.maxGap}ms, gap since last ${end - v.last}ms${v.away ? ' (away)' : ''}`);
          const report = `[${name}] map "${map.title}" r${round}; monster updates ${npcMsgs}; msgs from other maps ${otherMap}; AI bots seen ${botCount}; kills ${kills}, deaths ${deaths}\n  ${rows.join('\n  ')}\n  channel: ${events.join(' | ')}`;
          ch.untrack().then(() => ch.unsubscribe()).then(() => done(report));
        }
      }, 100);
    });
  });
}

Promise.all(Array.from({ length: count }, (_, i) => bot(i))).then((reports) => {
  console.log(reports.join('\n'));
  process.exit(0);
});
