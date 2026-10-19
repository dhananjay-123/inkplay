import type { PlayerMeta } from '@/lib/arena/net';

/** HUD numbers from the arena, a few times per second. */
export type ArenaHud = {
  hp: number;
  shield: number;
  fuel: number;
  weapon: string;
  /** "24/30", "∞", or seconds left for the chainsaw. */
  ammo: string;
  reloading: boolean;
  grenades: number;
  buffs: { name: string; s: number }[];
  respawnIn: number | null;
  autofire: boolean;
};

export type ArenaEvents = {
  hud: ArenaHud;
  /** I died (the transport doesn't echo my own broadcasts back to me). */
  died: { killer: string | null };
  /** As room host I saw an enemy die (others hear it over the network). */
  npcdie: { killer: string | null };
  /** Someone in the room is on a newer map than mine: ask for it. */
  newerMap: void;
  /** AI players for the scoreboard (a few times per second). */
  botboard: { id: string; name: string; color: string; kills: number; deaths: number }[];
  /** As host I saw an AI player die (others hear the `die` message). */
  botdie: { victim: string; killer: string | null };
  // React → game
  peers: PlayerMeta[];
  touch: { left?: boolean; right?: boolean; jet?: boolean; grenade?: boolean };
  autofire: boolean;
  /** Set the number of AI players. */
  bots: number;
  /** A chat line (already cleaned): shown as a speech bubble over that player. */
  chat: { id: string; text: string };
  /** A text field has focus: let go of the keyboard so W/A/D/Space type. */
  typing: boolean;
};

type Handler<T> = (payload: T) => void;

/** Typed event bus between the arena page and its Phaser scene. */
export class ArenaBus {
  private handlers = new Map<keyof ArenaEvents, Set<Handler<never>>>();

  on<K extends keyof ArenaEvents>(type: K, fn: Handler<ArenaEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof ArenaEvents>(type: K, payload: ArenaEvents[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<ArenaEvents[K]>)(payload));
  }
}
