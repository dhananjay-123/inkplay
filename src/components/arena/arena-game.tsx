'use client';

import { useEffect, useRef } from 'react';
import type { ArenaBus } from '@/game/arena-events';
import type { PlayerMeta, Transport } from '@/lib/arena/net';
import type { ArenaMap } from '@/lib/arena/schema';

type Props = {
  map: ArenaMap;
  me: PlayerMeta;
  net: Transport;
  bus: ArenaBus;
  autofire: boolean;
  /** This client simulates the hostile enemies (later changes go through the bus). */
  isHost: boolean;
  className?: string;
};

/** Mounts the arena (client-only; Phaser is imported lazily). Remount with a new `key` per map. */
export function ArenaGame({ map, me, net, bus, autofire, isHost, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // The scene reads these once at start; later changes go through the bus.
  const start = useRef({ me, autofire, isHost });

  useEffect(() => {
    let destroyed = false;
    let game: import('phaser').Game | null = null;
    (async () => {
      const [{ default: Phaser }, { ArenaScene, ARENA_VIEW }] = await Promise.all([import('phaser'), import('@/game/ArenaScene')]);
      if (destroyed || !host.current) return;
      const handFont = getComputedStyle(document.documentElement).getPropertyValue('--font-kalam').trim() || 'cursive';
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: ARENA_VIEW.width,
        height: ARENA_VIEW.height,
        backgroundColor: '#FFFAF0',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        physics: { default: 'arcade', arcade: { debug: false } },
        audio: { noAudio: true },
        banner: false,
        fps: { target: 60 },
      });
      game.scene.add('arena', ArenaScene, true, { map, me: start.current.me, net, bus, handFont, autofire: start.current.autofire, host: start.current.isHost });
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __arena?: unknown }).__arena = game;
    })().catch((e) => console.error('[arena] failed to start', e));
    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [map, net, bus]);

  return <div ref={host} className={className} data-game-cursor onContextMenu={(e) => e.preventDefault()} />;
}
