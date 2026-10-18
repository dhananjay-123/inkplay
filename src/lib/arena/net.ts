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

/** [x, y, angle] of each shot fired since the last state message. */
export type Shot = [number, number, number];

export type NetMsg =
  | { t: 'st'; id: string; x: number; y: number; vx: number; vy: number; aim: number; hp: number; alive: boolean; jet: boolean; shots: Shot[] }
  | { t: 'die'; victim: string; killer: string | null }
  | { t: 'map'; map: ArenaMap; from: string; round: number }
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
  track(meta: PlayerMeta) {
    void this.ch.track(meta);
  }
  onPeers(cb: (peers: PlayerMeta[]) => void) {
    return this.peers.on(cb);
  }
  close() {
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
      ch.subscribe((status) => {
        if (status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
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
