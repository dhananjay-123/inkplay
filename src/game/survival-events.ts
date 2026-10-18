/** HUD numbers from a survival run, a few times per second. */
export type SurvivalHud = {
  hp: number;
  maxHp: number;
  /** Metres run. */
  distance: number;
  score: number;
  coins: number;
  /** Speed as a multiple of the starting speed. */
  pace: number;
  /** Timed pickups still running, seconds left. */
  effects: { name: string; s: number }[];
  shield: boolean;
};

export type SurvivalStats = {
  distance: number;
  score: number;
  coins: number;
  stomps: number;
  timeSeconds: number;
  seed: number;
  cause: string;
};

export type SurvivalEvents = {
  /** Waiting for the first jump. */
  ready: void;
  started: void;
  hud: SurvivalHud;
  end: SurvivalStats;
  // React → game
  restart: void;
  pause: boolean;
};

type Handler<T> = (payload: T) => void;

/** Tiny typed event bus between React and the survival scene. */
export class SurvivalBus {
  private handlers = new Map<keyof SurvivalEvents, Set<Handler<never>>>();

  on<K extends keyof SurvivalEvents>(type: K, fn: Handler<SurvivalEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof SurvivalEvents>(type: K, ...payload: SurvivalEvents[K] extends void ? [] : [SurvivalEvents[K]]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<SurvivalEvents[K]>)(payload[0] as SurvivalEvents[K]));
  }
}
