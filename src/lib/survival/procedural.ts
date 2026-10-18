import { mulberry32 } from '@/lib/arena/schema';
import { RUN, SAFE_END, SAFE_START, finalizeChunk, jumpReach, type Chunk, type DraftChunk, type PickupKind } from './schema';

/** How hard the track is at `seconds` into a run: 0 at the start, 1 at full speed. */
export function difficultyAt(seconds: number): number {
  return Math.min(1, seconds / RUN.rampSeconds);
}

/** Runner speed (px/s) at `seconds`: eases from base to max. */
export function speedAt(seconds: number): number {
  const d = difficultyAt(seconds);
  return RUN.baseSpeed + (RUN.maxSpeed - RUN.baseSpeed) * (1 - (1 - d) * (1 - d));
}

type Pattern = 'coins' | 'gap' | 'spikes' | 'lava' | 'bar' | 'crumble' | 'walker' | 'flyer' | 'shooter' | 'ledge' | 'gap_spikes';

/**
 * One chunk of track, from the run seed and the chunk index alone (same seed,
 * same run), so it works offline with no model. `d` is difficulty 0..1 and
 * `speed` the runner's speed when the chunk spawns.
 */
export function proceduralChunk(seed: number, index: number, d: number, speed: number): Chunk {
  const r = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const reach = jumpReach(speed).width;
  const length = Math.round(2000 + r() * 1000 + d * 600);

  const draft: Required<DraftChunk> = { length, ground: [], ledges: [], hazards: [], bars: [], mobs: [], pickups: [] };
  let groundFrom = 0;
  const hole = (x: number, w: number) => {
    draft.ground.push({ x: groundFrom, w: x - groundFrom });
    groundFrom = x + w;
  };
  const coinRow = (x: number, n: number, h = 40) => {
    for (let i = 0; i < n; i++) draft.pickups.push({ x: x + i * 46, h, kind: 'coin' });
  };
  /** Coins in a jump arc over [x, x+w]. */
  const coinArc = (x: number, w: number) => {
    const n = Math.max(3, Math.round(w / 50));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      draft.pickups.push({ x: x + t * w, h: 40 + Math.sin(t * Math.PI) * 120, kind: 'coin' });
    }
  };

  // Early on: mostly coins and single obstacles. Later: mobs, combos, tighter spacing.
  const weights: [Pattern, number][] = [
    ['coins', 1.4 - d],
    ['gap', 1.2],
    ['spikes', 1.1],
    ['lava', 0.4 + d * 0.8],
    ['bar', 0.5 + d * 0.6],
    ['crumble', 0.2 + d * 0.8],
    ['walker', 0.5 + d * 0.6],
    ['flyer', 0.2 + d * 0.9],
    ['shooter', d * 0.9],
    ['ledge', 0.6],
    ['gap_spikes', d * 0.7],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  const choose = (): Pattern => {
    let x = r() * total;
    for (const [p, w] of weights) if ((x -= w) <= 0) return p;
    return 'coins';
  };

  let x = SAFE_START + 80;
  const gapRoom = (1.15 - 0.55 * d) * speed; // px of calm between patterns
  while (x < length - SAFE_END - 300) {
    const p = choose();
    let used = 200;
    switch (p) {
      case 'coins':
        coinRow(x, 5 + Math.floor(r() * 4));
        used = 380;
        break;
      case 'gap': {
        const w = Math.round(reach * (0.3 + r() * 0.28 + d * 0.04));
        hole(x, w);
        coinArc(x - 40, w + 80);
        used = w;
        break;
      }
      case 'spikes': {
        const w = Math.round(44 + r() * reach * 0.3 * (0.5 + d));
        draft.hazards.push({ x, w, kind: 'spikes' });
        used = w;
        break;
      }
      case 'lava': {
        const w = Math.round(90 + r() * reach * 0.35);
        draft.hazards.push({ x, w, kind: 'lava' });
        coinArc(x - 30, w + 60);
        used = w;
        break;
      }
      case 'bar': {
        const w = Math.round(80 + r() * 160);
        draft.bars.push({ x, w });
        coinRow(x + 10, Math.max(2, Math.floor(w / 46)), 16);
        used = w;
        break;
      }
      case 'crumble': {
        const w = Math.round(220 + r() * 180);
        draft.ground.push({ x: groundFrom, w: x - groundFrom });
        draft.ground.push({ x, w, crumble: true });
        groundFrom = x + w;
        coinRow(x + 30, Math.floor(w / 60));
        used = w;
        break;
      }
      case 'walker':
      case 'shooter':
        draft.mobs.push({ x, kind: p });
        used = 120;
        break;
      case 'flyer':
        draft.mobs.push({ x, kind: 'flyer', h: r() < 0.6 ? 40 : 150 });
        used = 80;
        break;
      case 'ledge': {
        const w = Math.round(200 + r() * 240);
        const h = Math.round(110 + r() * 45);
        draft.ledges.push({ x, w, h });
        coinRow(x + 30, Math.floor((w - 40) / 46), h + 36);
        if (r() < 0.4 + d * 0.4) draft.hazards.push({ x: x + w / 2 - 50, w: 100, kind: r() < 0.5 ? 'spikes' : 'lava' });
        used = w;
        break;
      }
      case 'gap_spikes': {
        const w = Math.round(reach * 0.35);
        hole(x, w);
        x += w + Math.round(speed * 0.55);
        draft.hazards.push({ x, w: 60, kind: 'spikes' });
        used = 60;
        break;
      }
    }
    // the odd treat: hearts get likelier as the run gets meaner
    if (r() < 0.07 + d * 0.05) {
      const kind: PickupKind = r() < 0.5 ? 'heart' : pick(['shield', 'magnet', 'boost'] as const);
      draft.pickups.push({ x: x + used + gapRoom * 0.5, h: 60 + r() * 60, kind });
    }
    x += used + gapRoom * (0.8 + r() * 0.5);
  }
  draft.ground.push({ x: groundFrom, w: length - groundFrom });
  return finalizeChunk(draft, speed);
}
