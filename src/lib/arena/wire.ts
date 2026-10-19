import { z } from 'zod';
import type { NetMsg, PlayerMeta } from './net';

/**
 * Everything that arrives from a room is untrusted: any client with the
 * public anon key can join a channel and send anything. Messages are checked
 * here, before they touch game state, so a bad peer can't crash, freeze or
 * flood the other players. Shapes match what ArenaScene / arena-client send.
 */

/** Finite and in a sane range (world px are ~2400 x 1350). */
const n = z.number().min(-1e6).max(1e6);
const id = z.string().min(1).max(40);
const name = z.string().max(16);
/** Map rounds are Date.now() of when the map was made. */
const round = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
/** Shots per message: receivers only ever play the first 24, so trim instead of rejecting. */
const upTo = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v), z.array(item));

const State = z.object({
  t: z.literal('st'),
  id,
  /** Sender's performance.now(): grows for as long as the tab is open. */
  ts: z.number().min(0).max(1e13),
  r: round,
  mf: z.string().max(40),
  nm: name,
  c: color,
  x: n,
  y: n,
  vx: n,
  vy: n,
  aim: n,
  hp: n,
  alive: z.boolean(),
  jet: z.boolean(),
  w: z.number().int().min(0).max(32),
  sh: z.boolean(),
  away: z.boolean().optional(),
  shots: upTo(z.tuple([n, n, n, n, n]), 24),
  n: z.array(z.tuple([n, n, n, n, n, n])).max(16).optional(),
  ns: upTo(z.tuple([n, n, n, n]), 24).optional(),
  b: z.array(z.tuple([n, n, n, n, n, n, n, n, n])).max(16).optional(),
  bs: upTo(z.tuple([n, n, n, n]), 24).optional(),
  bn: z.number().int().min(0).max(16).optional(),
  j: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
});

const NetMsgSchema = z.discriminatedUnion('t', [
  State,
  z.object({ t: z.literal('npcdie'), id: z.number().int().min(0).max(64), killer: id.nullable() }),
  z.object({ t: z.literal('bots'), n: z.number().int().min(0).max(16), r: round }),
  z.object({ t: z.literal('die'), victim: id, killer: id.nullable() }),
  // The map itself is re-validated and clamped by parseWireMap.
  z.object({ t: z.literal('map'), map: z.unknown(), from: z.string().max(40), round, note: z.string().transform((s) => s.slice(0, 120)).optional() }),
  z.object({ t: z.literal('needmap'), from: id }),
  z.object({ t: z.literal('pick'), i: z.number().int().min(0).max(64), by: id }),
  // Length only here; arena-client runs cleanChat (masking, invisible chars) before showing it.
  z.object({ t: z.literal('chat'), id, nm: name, c: color, text: z.string().min(1).max(400) }),
]);

export function parseNetMsg(raw: unknown): NetMsg | null {
  const r = NetMsgSchema.safeParse(raw);
  return r.success ? (r.data as NetMsg) : null;
}

const MetaSchema = z.object({
  id,
  name: z.string().transform((s) => s.slice(0, 16)),
  color,
  kills: z.number().int().min(0).max(1e6).catch(0),
  deaths: z.number().int().min(0).max(1e6).catch(0),
  joinedAt: z.number().min(0).max(Number.MAX_SAFE_INTEGER).catch(0),
});

export function parsePeerMeta(raw: unknown): PlayerMeta | null {
  const r = MetaSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Receive-side flood guard: drops messages from a sender (and overall) above
 * a rate no honest client reaches. Honest clients send ~10 state messages a
 * second plus the odd event.
 */
export function floodGuard(perSender = 40, total = 400) {
  let windowStart = 0;
  let all = 0;
  const bySender = new Map<string, number>();
  return (msg: NetMsg): boolean => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      all = 0;
      bySender.clear();
    }
    if (++all > total) return false;
    const key = senderOf(msg);
    const count = (bySender.get(key) ?? 0) + 1;
    bySender.set(key, count);
    return count <= perSender;
  };
}

function senderOf(m: NetMsg): string {
  switch (m.t) {
    case 'st': return m.id;
    case 'map':
    case 'needmap': return m.from;
    case 'pick': return m.by;
    case 'chat': return m.id;
    case 'die': return m.victim;
    default: return `?${m.t}`;
  }
}
