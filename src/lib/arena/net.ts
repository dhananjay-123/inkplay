'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ArenaMap } from './schema';

/**
 * Room transport. Online: a Supabase Realtime channel (broadcast for game
 * traffic, presence for the roster + scoreboard), so nothing goes through
 * Vercel functions. Offline / no Supabase: BroadcastChannel between tabs of
 * the same browser, so the stage demo still works in airplane mode.
 */

export type PlayerMeta = { id: string; name: string; color: string; kills: number; deaths: number; joinedAt: number };

/** [x, y, angle, weapon index (WEAPON_IDS), damage x10] of each shot since the last state message. */
export type Shot = [number, number, number, number, number];
/** One hostile enemy, as the room host broadcasts it: [id, x, y, hp, alive (0/1), aim]. */
export type NpcState = [number, number, number, number, number, number];
/** An enemy's shot: [x, y, angle, enemy id]. */
export type NpcShot = [number, number, number, number];

export type NetMsg =
  | { t: 'st'; id: string; x: number; y: number; vx: number; vy: number; aim: number; hp: number; alive: boolean; jet: boolean; w: number; sh: boolean; shots: Shot[] }
  /** Room host only: hostile enemies (host-simulated) and their shots. */
  | { t: 'npc'; s: NpcState[]; shots: NpcShot[] }
  | { t: 'npcdie'; id: number; killer: string | null }
  | { t: 'die'; victim: string; killer: string | null }
  | { t: 'map'; map: ArenaMap; from: string; round: number; note?: string }
  | { t: 'needmap'; from: string }
  | { t: 'pick'; i: number; by: string };

export interface Transport {
  readonly kind: 'online' | 'local';
  send(msg: NetMsg): void;
  onMessage(cb: (msg: NetMsg) => void): () => void;
  track(meta: PlayerMeta): void;
  onPeers(cb: (peers: PlayerMeta[]) => void): () => void;
  close(): void;
}

class Emitter<T> {
  private subs = new Set<(v: T) => void>();
  on(cb: (v: T) => void) {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }
  emit(v: T) {
    for (const s of this.subs) s(v);
  }
}

const isMeta = (v: unknown): v is PlayerMeta =>
  !!v && typeof v === 'object' && typeof (v as PlayerMeta).id === 'string' && typeof (v as PlayerMeta).name === 'string';

class SupabaseTransport implements Transport {
  readonly kind = 'online' as const;
  closed = false;
  private msgs = new Emitter<NetMsg>();
  private peers = new Emitter<PlayerMeta[]>();
  constructor(private ch: RealtimeChannel) {
    ch.on('broadcast', { event: 'm' }, ({ payload }) => this.msgs.emit(payload as NetMsg));
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      const list = Object.values(state)
        .map((metas) => metas[0] as unknown)
        .filter(isMeta);
      this.peers.emit(list);
    });
  }
  send(msg: NetMsg) {
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }
  onMessage(cb: (msg: NetMsg) => void) {
    return this.msgs.on(cb);
  }
  private meta: PlayerMeta | null = null;
  track(meta: PlayerMeta) {
    this.meta = meta;
    void this.ch.track(meta);
  }
  /** After a reconnect the channel rejoins, but presence must be tracked again. */
  resubscribed() {
    if (this.meta) void this.ch.track(this.meta);
  }
  onPeers(cb: (peers: PlayerMeta[]) => void) {
    return this.peers.on(cb);
  }
  close() {
    this.closed = true;
    void this.ch.untrack();
    void this.ch.unsubscribe();
  }
}

type LocalWire = NetMsg | { t: '_hb'; meta: PlayerMeta } | { t: '_bye'; id: string };

class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private bc: BroadcastChannel;
  private msgs = new Emitter<NetMsg>();
  private peers = new Emitter<PlayerMeta[]>();
  private seen = new Map<string, { meta: PlayerMeta; at: number }>();
  private me: PlayerMeta | null = null;
  private timer: ReturnType<typeof setInterval>;
  constructor(room: string) {
    this.bc = new BroadcastChannel(`inkplay-arena-${room}`);
    this.bc.onmessage = (e: MessageEvent<LocalWire>) => {
      const m = e.data;
      if (m.t === '_hb') {
        const fresh = !this.seen.has(m.meta.id);
        this.seen.set(m.meta.id, { meta: m.meta, at: Date.now() });
        if (fresh && this.me) this.bc.postMessage({ t: '_hb', meta: this.me } satisfies LocalWire);
        this.publish();
      } else if (m.t === '_bye') {
        this.seen.delete(m.id);
        this.publish();
      } else this.msgs.emit(m);
    };
    this.timer = setInterval(() => {
      if (this.me) this.bc.postMessage({ t: '_hb', meta: this.me } satisfies LocalWire);
      const now = Date.now();
      let changed = false;
      for (const [id, s] of this.seen) {
        if (now - s.at > 3500) {
          this.seen.delete(id);
          changed = true;
        }
      }
      if (changed) this.publish();
    }, 1000);
  }
  private publish() {
    this.peers.emit([...(this.me ? [this.me] : []), ...[...this.seen.values()].map((s) => s.meta)]);
  }
  send(msg: NetMsg) {
    this.bc.postMessage(msg);
  }
  onMessage(cb: (msg: NetMsg) => void) {
    return this.msgs.on(cb);
  }
  track(meta: PlayerMeta) {
    this.me = meta;
    this.bc.postMessage({ t: '_hb', meta } satisfies LocalWire);
    this.publish();
  }
  onPeers(cb: (peers: PlayerMeta[]) => void) {
    return this.peers.on(cb);
  }
  close() {
    if (this.me) this.bc.postMessage({ t: '_bye', id: this.me.id } satisfies LocalWire);
    clearInterval(this.timer);
    this.bc.close();
  }
}

/** Join a room: Supabase Realtime if it answers within a few seconds, else this-browser-only. */
export async function connectRoom(room: string, myId: string, opts: { forceLocal?: boolean } = {}): Promise<Transport> {
  const sb = opts.forceLocal || !navigator.onLine ? null : supabaseBrowser();
  if (sb) {
    const ch = sb.channel(`arena:${room}`, { config: { broadcast: { self: false, ack: false }, presence: { key: myId } } });
    // Listeners must be attached before subscribe().
    const transport = new SupabaseTransport(ch);
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      let first = true;
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED' && !first && !transport.closed) transport.resubscribed();
        if (status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
        if (!first) return;
        first = false;
        clearTimeout(t);
        resolve(status === 'SUBSCRIBED');
      });
    });
    if (ok) return transport;
    void sb.removeChannel(ch);
    console.warn('[arena] realtime unavailable, falling back to this browser only');
  }
  return new LocalTransport(room);
}
