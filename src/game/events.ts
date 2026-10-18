import type { RunStats } from '@/lib/schema';

/** Live HUD numbers, emitted a few times per second. */
export type LiveStats = { deaths: number; coins: number; timeSeconds: number; timeLeft: number | null; effect: string | null };

export type GameEvents = {
  ready: void;
  live: LiveStats;
  end: RunStats;
  // React → game
  restart: void;
  giveUp: void;
  mute: boolean;
  touch: { left?: boolean; right?: boolean; jump?: boolean };
};

type Handler<T> = (payload: T) => void;

/** Tiny typed event bus between React and Phaser. One per game instance. */
export class GameBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, ...payload: GameEvents[K] extends void ? [] : [GameEvents[K]]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<GameEvents[K]>)(payload[0] as GameEvents[K]));
  }

  clear(): void {
    this.handlers.clear();
  }
}
