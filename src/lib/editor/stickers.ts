/**
 * Ready-made doodles for the level editor (and the guide's picture cards).
 * Each one is plain SVG path data in its own little box, drawn in a single
 * ink, exactly like you would on paper, so the exported page goes through
 * the same OpenCV + Gemma pipeline as a photo.
 */

export type StickerGroup = 'symbols' | 'things';

export type StickerDef = {
  id: string;
  name: string;
  becomes: string;
  group: StickerGroup;
  /** Path box (width, height). */
  vb: [number, number];
  /** Level pixels per path unit at scale 1 (the level is 1600 × 900). */
  k: number;
  paths: string[];
  /** Small solid shapes (eyes, door knobs). */
  fills?: string[];
};

const zigzag = (teeth: number, w: number, h: number) => {
  const step = w / (teeth * 2);
  let d = `M0 ${h}`;
  for (let i = 1; i <= teeth * 2; i++) d += ` L${i * step} ${i % 2 ? 2 : h}`;
  return d;
};

export const STICKERS: StickerDef[] = [
  // ------------------------------------------------------------ symbols
  { id: 'player', name: 'P', becomes: 'you, the player', group: 'symbols', vb: [60, 80], k: 1, paths: ['M16 76 L16 6 C 56 0, 58 40, 18 40'] },
  {
    id: 'stick',
    name: 'stick figure',
    becomes: 'you, the player',
    group: 'symbols',
    vb: [50, 100],
    k: 0.9,
    paths: ['M14 16 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0', 'M25 27 V62 M25 38 L8 52 M25 38 L42 52 M25 62 L10 96 M25 62 L40 96'],
  },
  { id: 'star', name: 'star', becomes: 'goal', group: 'symbols', vb: [80, 76], k: 1, paths: ['M40 2 L50 28 L78 29 L56 46 L64 74 L40 58 L16 74 L24 46 L2 29 L30 28 Z'] },
  { id: 'flag', name: 'flag', becomes: 'goal', group: 'symbols', vb: [80, 180], k: 0.9, paths: ['M12 178 V4 L74 22 L12 42'] },
  {
    id: 'coin',
    name: '$',
    becomes: 'coin',
    group: 'symbols',
    vb: [48, 76],
    k: 0.9,
    paths: ['M40 16 C 32 4, 8 6, 10 22 C 12 36, 40 32, 40 50 C 40 66, 12 68, 6 56', 'M24 2 V74'],
  },
  { id: 'enemy', name: 'E + arrow', becomes: 'enemy', group: 'symbols', vb: [150, 60], k: 1, paths: ['M32 6 H8 V54 H32 M8 30 H26', 'M46 30 H144 M130 20 L144 30 L130 40'] },
  { id: 'spikes', name: 'zigzag', becomes: 'spikes', group: 'symbols', vb: [180, 44], k: 1, paths: [zigzag(6, 180, 42)] },
  { id: 'ground', name: 'line', becomes: 'ground', group: 'symbols', vb: [400, 14], k: 1, paths: ['M2 9 C 100 3, 250 13, 398 6'] },
  {
    id: 'ledge',
    name: 'ledge',
    becomes: 'platform',
    group: 'symbols',
    vb: [220, 64],
    k: 1,
    paths: ['M12 60 L4 44 C 0 26, 24 18, 34 32 C 40 14, 72 14, 78 32 C 84 14, 116 14, 122 32 C 128 14, 160 14, 166 32 C 176 18, 214 22, 210 44 L202 60 Z'],
  },

  // ------------------------------------------------------------- things
  {
    id: 'cactus',
    name: 'cactus',
    becomes: 'hazard',
    group: 'things',
    vb: [120, 160],
    k: 0.85,
    paths: ['M44 158 V14 L58 6 L74 14 V158', 'M44 84 H22 V44', 'M74 104 H98 V64', 'M52 40 l6 -4 M60 70 l6 -4 M52 100 l6 -4 M60 130 l6 -4'],
  },
  {
    id: 'trampoline',
    name: 'trampoline',
    becomes: 'bouncy',
    group: 'things',
    vb: [160, 64],
    k: 0.95,
    paths: ['M8 6 C 50 14, 110 14, 152 6', 'M16 10 L22 60 M144 10 L138 60', 'M44 18 l8 28 M74 20 l8 28 M104 18 l8 28'],
  },
  {
    id: 'cloud',
    name: 'cloud',
    becomes: 'platform',
    group: 'things',
    vb: [160, 84],
    k: 1,
    paths: ['M32 80 C 2 80, 0 44, 30 42 C 30 8, 80 2, 92 30 C 106 12, 152 18, 142 48 C 164 54, 160 80, 136 80 Z'],
  },
  {
    id: 'dog',
    name: 'dog',
    becomes: 'enemy',
    group: 'things',
    vb: [80, 56],
    k: 1.8,
    paths: ['M22 30 h30 c4 0 6 3 6 6 v2 h-36 z', 'M58 32 c2 -10 10 -12 14 -6 c2 4 0 8 -6 8', 'M64 24 l-2 -6 l5 3', 'M22 32 c-6 -2 -8 -8 -6 -12', 'M26 38 v12 M50 38 v12', 'M32 38 v12 M56 38 v12'],
    fills: ['M64.6 29 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0'],
  },
  {
    id: 'bat',
    name: 'bat',
    becomes: 'flying enemy',
    group: 'things',
    vb: [120, 60],
    k: 1,
    paths: [
      'M60 22 c-6 0 -10 6 -10 12 c0 8 4 14 10 14 c6 0 10 -6 10 -14 c0 -6 -4 -12 -10 -12 z',
      'M50 32 C 40 12, 18 8, 4 18 C 14 22, 14 30, 12 38 C 22 32, 34 32, 50 40',
      'M70 32 C 80 12, 102 8, 116 18 C 106 22, 106 30, 108 38 C 98 32, 86 32, 70 40',
      'M54 22 l-2 -8 l6 6 M66 22 l2 -8 l-6 6',
    ],
  },
  {
    id: 'chai',
    name: 'chai cup',
    becomes: 'power-up',
    group: 'things',
    vb: [80, 56],
    k: 1.4,
    paths: ['M24 26 h28 l-3 24 h-22 z', 'M52 30 c8 0 8 12 -2 12', 'M31 20 c-3 -4 3 -6 0 -10', 'M38 20 c-3 -4 3 -6 0 -10', 'M45 20 c-3 -4 3 -6 0 -10'],
  },
  {
    id: 'heart',
    name: 'heart',
    becomes: 'power-up',
    group: 'things',
    vb: [48, 48],
    k: 1.4,
    paths: ['M24 40 C 8 30, 4 18, 12 12 C 18 8, 23 12, 24 17 C 25 12, 30 8, 36 12 C 44 18, 40 30, 24 40 Z'],
  },
  { id: 'gem', name: 'gem', becomes: 'collectible', group: 'things', vb: [80, 64], k: 0.8, paths: ['M10 22 L26 6 H54 L70 22 L40 60 Z', 'M10 22 H70', 'M28 22 L40 60 L52 22'] },
  { id: 'door', name: 'door', becomes: 'goal', group: 'things', vb: [80, 130], k: 0.9, paths: ['M8 128 V8 H72 V128', 'M2 128 H78'], fills: ['M56 70 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0'] },
  {
    id: 'tree',
    name: 'tree',
    becomes: 'decoration',
    group: 'things',
    vb: [100, 160],
    k: 0.9,
    paths: ['M50 158 V96', 'M50 96 C 8 100, 4 52, 34 48 C 24 14, 76 14, 66 48 C 96 52, 92 100, 50 96 Z'],
  },
];

export const STICKER_BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/** Size in level pixels at scale 1. */
export const stickerSize = (s: StickerDef): [number, number] => [s.vb[0] * s.k, s.vb[1] * s.k];
