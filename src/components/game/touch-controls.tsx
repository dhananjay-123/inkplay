'use client';

import type { GameBus } from '@/game/events';

/** On-screen controls, shown only on coarse pointers (phones/tablets). */
export function TouchControls({ bus }: { bus: GameBus }) {
  const hold = (key: 'left' | 'right' | 'jump') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      bus.emit('touch', { [key]: true });
    },
    onPointerUp: () => bus.emit('touch', { [key]: false }),
    onPointerCancel: () => bus.emit('touch', { [key]: false }),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const btn = 'label grid h-16 w-16 touch-none select-none place-items-center rounded-full bg-ink text-2xl text-paper active:scale-95 active:bg-accent active:text-accent-ink';
  return (
    <div className="pointer-coarse:flex fixed inset-x-0 bottom-0 z-30 hidden items-end justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-3">
        <button type="button" aria-label="Move left" className={btn} {...hold('left')}>←</button>
        <button type="button" aria-label="Move right" className={btn} {...hold('right')}>→</button>
      </div>
      <button type="button" aria-label="Jump" className={`${btn} h-20 w-20`} {...hold('jump')}>↑</button>
    </div>
  );
}
