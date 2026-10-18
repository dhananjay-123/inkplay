import type { PlayerMeta } from '@/lib/arena/net';

/** HUD numbers from the arena, a few times per second. */
export type ArenaHud = {
  hp: number;
  fuel: number;
  ammo: number;
  mag: number;
  reloading: boolean;
  respawnIn: number | null;
  autofire: boolean;
};

export type ArenaEvents = {
  hud: ArenaHud;
  /** I died (the transport doesn't echo my own broadcasts back to me). */
  died: { killer: string | null };
  // React → game
  peers: PlayerMeta[];
  touch: { left?: boolean; right?: boolean; jet?: boolean };
  autofire: boolean;
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
