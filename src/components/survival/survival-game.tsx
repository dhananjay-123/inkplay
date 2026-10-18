'use client';

import { useEffect, useRef } from 'react';
import type { SurvivalBus } from '@/game/survival-events';

type Props = {
  bus: SurvivalBus;
  /** Best distance in metres, read at the start of every run (keep it stable). */
  getBest: () => number;
  className?: string;
};

/** Mounts the survival runner (client-only; Phaser is imported lazily). */
export function SurvivalGame({ bus, getBest, className }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let game: import('phaser').Game | null = null;
    (async () => {
      const [{ default: Phaser }, { SurvivalScene, SURVIVAL_VIEW }] = await Promise.all([import('phaser'), import('@/game/SurvivalScene')]);
      if (destroyed || !host.current) return;
      const handFont = getComputedStyle(document.documentElement).getPropertyValue('--font-kalam').trim() || 'cursive';
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: SURVIVAL_VIEW.width,
        height: SURVIVAL_VIEW.height,
        backgroundColor: '#FFFAF0',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        physics: { default: 'arcade', arcade: { debug: false } },
        audio: { noAudio: true },
        banner: false,
        fps: { target: 60 },
      });
      game.scene.add('survival', SurvivalScene, true, { bus, handFont, getBest });
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __survival?: unknown }).__survival = game;
    })().catch((e) => console.error('[survival] failed to start', e));
    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [bus, getBest]);

  return <div ref={host} className={className} data-game-cursor onContextMenu={(e) => e.preventDefault()} />;
}
