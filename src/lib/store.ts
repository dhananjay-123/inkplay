'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Mark, PlayableLevel } from '@/lib/schema';

export type CurrentLevel = {
  id: string | null;
  level: PlayableLevel;
  marks: Mark[];
  /** Data URL (local play) or Supabase public URL (gallery). */
  image: string;
};

type State = {
  current: CurrentLevel | null;
  setCurrent: (c: CurrentLevel) => void;
  clear: () => void;
  muted: boolean;
  toggleMuted: () => void;
};

/**
 * The current level lives client-side so the core loop never needs a DB.
 * sessionStorage keeps it across a reload of /play; access is guarded because
 * storage can throw in private windows.
 */
const safeSession = createJSONStorage(() => {
  try {
    const s = window.sessionStorage;
    s.setItem('__t', '1');
    s.removeItem('__t');
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }
});

export const useInkplay = create<State>()(
  persist(
    (set) => ({
      current: null,
      setCurrent: (current) => set({ current }),
      clear: () => set({ current: null }),
      muted: true,
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
    }),
    { name: 'inkplay', storage: safeSession },
  ),
);
