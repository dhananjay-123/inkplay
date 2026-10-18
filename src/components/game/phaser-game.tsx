'use client';

import { useEffect, useRef } from 'react';
import type { CurrentLevel } from '@/lib/store';
import type { GameBus } from '@/game/events';
import { WORLD } from '@/lib/physics';

type Props = {
  data: CurrentLevel;
  bus: GameBus;
  autoplay?: boolean;
  className?: string;
  /** Changing this remounts the game (e.g. "Play again" after the end card). */
  runKey?: number;
};

/** Mounts a Phaser game (client-only; Phaser is imported lazily). */
export function PhaserGame({ data, bus, autoplay, className, runKey }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let game: import('phaser').Game | null = null;
    (async () => {
      const [{ default: Phaser }, { LevelScene }] = await Promise.all([import('phaser'), import('@/game/LevelScene')]);
      if (destroyed || !host.current) return;
      const handFont = getComputedStyle(document.documentElement).getPropertyValue('--font-kalam').trim() || 'cursive';
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: WORLD.width,
        height: WORLD.height,
        transparent: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        physics: { default: 'arcade', arcade: { debug: false } },
        input: { keyboard: !autoplay, touch: !autoplay, mouse: !autoplay },
        audio: { noAudio: true },
        banner: false,
        fps: { target: 60 },
      });
      game.scene.add('level', LevelScene, true, { data, bus, autoplay, handFont });
      if (process.env.NODE_ENV !== 'production' && !autoplay) (window as unknown as { __inkplay?: unknown }).__inkplay = game;
    })().catch((e) => console.error('[game] failed to start', e));
    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [data, bus, autoplay, runKey]);

  return <div ref={host} className={className} />;
}
