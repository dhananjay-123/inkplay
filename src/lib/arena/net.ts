'use client';

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ArenaMap } from './schema';

/**
 * Room transport. Online: a Supabase Realtime channel (broadcast for game
 * traffic, presence for the roster + scoreboard), so nothing goes through
 * Vercel functions. Offline / no Supabase: BroadcastChannel between tabs of
 * the same browser, so offline mode still works in airplane mode.
 */

export type PlayerMeta = { id: string; name: string; color: string; kills: number; deaths: number; joinedAt: number };

/** [x, y, angle, weapon index (WEAPON_IDS), damage x10] of each shot since the last state message. */
export type Shot = [number, number, number, number, number];
/** One hostile enemy, as the room host broadcasts it: [id, x, y, hp, alive (0/1), aim]. */
export type NpcState = [number, number, number, number, number, number];
/** An enemy's shot: [x, y, angle, enemy id]. */
export type NpcShot = [number, number, number, number];
/** One AI player, as the host broadcasts it: [index, x, y, hp, alive, aim, jet, kills, deaths]. */
export type BotState = [number, number, number, number, number, number, number, number, number];

export type NetMsg =
  | {
      t: 'st';
      id: string;
      /** Sender's clock (performance.now) so receivers can undo network jitter. */
      ts: number;
      /** Map round + who made it: players on a different map aren't drawn, and a newer map is fetched. */
      r: number;
      mf: string;
      /** Name + colour ride along so a player shows correctly even before presence catches up. */
      nm: string;
      c: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      aim: number;
      hp: number;
      alive: boolean;
      jet: boolean;
      w: number;
      sh: boolean;
      /** Tab in the background: frozen, can't be hurt, don't target. */
      away?: boolean;
      shots: Shot[];
      /** Room host only: hostile enemies, their shots, and the host's join time (tie-break between two hosts). */
      n?: NpcState[];
      ns?: NpcShot[];
      /** Room host only: AI players, their shots ([x, y, angle, bot index]) and how many there are. */
      b?: BotState[];
      bs?: NpcShot[];
      bn?: number;
      /** When the sender joined: the room host is whoever joined first among the players still here. */
      j: number;
    }
  | { t: 'npcdie'; id: number; killer: string | null }
  /** Anyone can change the number of AI players for the current map round. */
  | { t: 'bots'; n: number; r: number }
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

/**
 * Supabase Realtime room with a watchdog. supabase-js can keep a channel it
 * thinks is joined on a socket that has silently died (seen in testing: a
 * client stops receiving while presence still lists everyone). So we:
 * - rebuild the channel if it isn't joined for a few seconds,
 * - rebuild it if others are in the room but nothing has arrived for a while,
 * - re-track presence after every (re)join,
 * - drop high-rate state messages while not joined instead of letting
 *   supabase-js fall back to one REST call per message.
 */
class SupabaseTransport implements Transport {
  readonly kind = 'online' as const;
  private closed = false;
  private msgs = new Emitter<NetMsg>();
  private peers = new Emitter<PlayerMeta[]>();
  private ch!: RealtimeChannel;
  private meta: PlayerMeta | null = null;
  private lastRecv = performance.now();
  private notJoinedSince = 0;
  private peerCount = 0;
  private rebuilding = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private sb: SupabaseClient,
    private topic: string,
    private myId: string,
  ) {
    this.timer = setInterval(() => this.watch(), 1000);
    // Coming back to the tab: check right away (a phone that slept often has a dead socket).
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.hidden || this.closed || this.rebuilding || !this.ch) return;
    if (this.ch.state !== 'joined' || (this.peerCount > 1 && performance.now() - this.lastRecv > 2500)) void this.rebuild('tab became visible');
  };

  /** Create + subscribe a fresh channel; resolves true once joined. */
  join(timeoutMs = 5000): Promise<boolean> {
    const ch = this.sb.channel(this.topic, { config: { broadcast: { self: false, ack: false }, presence: { key: this.myId } } });
    this.ch = ch;
    ch.on('broadcast', { event: 'm' }, ({ payload }) => {
      if (ch !== this.ch) return;
      this.lastRecv = performance.now();
      this.msgs.emit(payload as NetMsg);
    });
    ch.on('presence', { event: 'sync' }, () => {
      if (ch !== this.ch) return;
      this.lastRecv = performance.now();
      const list = Object.values(ch.presenceState())
        .map((metas) => metas[0] as unknown)
        .filter(isMeta);
      this.peerCount = list.length;
      this.peers.emit(list);
    });
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.lastRecv = performance.now();
          if (this.meta && !this.closed) void ch.track(this.meta);
        }
        if (settled || (status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED')) return;
        settled = true;
        clearTimeout(t);
        resolve(status === 'SUBSCRIBED');
      });
    });
  }

  private async rebuild(why: string) {
    if (this.rebuilding || this.closed) return;
    this.rebuilding = true;
    console.warn(`[arena] reconnecting to the room (${why})`);
    const old = this.ch;
    try {
      await this.sb.removeChannel(old).catch(() => {});
      // The socket itself may be the dead part: replace it, not just the channel.
      this.sb.realtime.disconnect();
      await new Promise((r) => setTimeout(r, 300));
      this.sb.realtime.connect();
      const ok = await this.join(6000);
      if (!ok) this.notJoinedSince = performance.now() - 2000; // retry soon
      return;
    } finally {
      this.rebuilding = false;
    }
  }

  private watch() {
    if (this.closed || this.rebuilding || !this.ch) return;
    const now = performance.now();
    if (this.ch.state !== 'joined') {
      this.notJoinedSince ||= now;
      if (now - this.notJoinedSince > 4000) void this.rebuild(`channel ${this.ch.state}`);
      return;
    }
    this.notJoinedSince = 0;
    // Others are here and send ~10 msgs/s (~1/s even from a background tab): 6 s of silence means a dead socket.
    if (this.peerCount > 1 && now - this.lastRecv > 6000) void this.rebuild('no messages for 6 s');
  }

  send(msg: NetMsg) {
    if (this.ch.state !== 'joined') {
      // State is resent 10x a second anyway; rare events go over REST so they aren't lost.
      if (msg.t === 'st') return;
      void this.ch.httpSend?.('m', msg).catch(() => {});
      return;
    }
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }
  onMessage(cb: (msg: NetMsg) => void) {
    return this.msgs.on(cb);
  }
  track(meta: PlayerMeta) {
    this.meta = meta;
    if (this.ch?.state === 'joined') void this.ch.track(meta);
  }
  onPeers(cb: (peers: PlayerMeta[]) => void) {
    return this.peers.on(cb);
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.ch.untrack();
    void this.sb.removeChannel(this.ch);
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
    const transport = new SupabaseTransport(sb, `arena:${room}`, myId);
    if (await transport.join()) return transport;
    transport.close();
    console.warn('[arena] realtime unavailable, falling back to this browser only');
  }
  return new LocalTransport(room);
}
