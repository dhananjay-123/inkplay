// Sanity check for survival chunks: gaps within reach, seams solid, counts sane.
import { proceduralChunk, speedAt, difficultyAt } from '../src/lib/survival/procedural';
import { jumpReach } from '../src/lib/survival/schema';

let bad = 0;
for (let seed = 1; seed <= 40; seed++) {
  for (let i = 0; i < 30; i++) {
    const t = i * 12;
    const v = speedAt(t);
    const c = proceduralChunk(seed, i, difficultyAt(t), v);
    const reach = jumpReach(v).width;
    if (c.ground[0].x !== 0 || c.ground.at(-1)!.x + c.ground.at(-1)!.w !== c.length) { bad++; console.log('seam', seed, i, c.ground); }
    for (let k = 1; k < c.ground.length; k++) {
      const gap = c.ground[k].x - (c.ground[k - 1].x + c.ground[k - 1].w);
      if (gap < 0 || gap > reach * 0.63) { bad++; console.log('gap', seed, i, gap, reach); }
    }
    if (seed === 1 && i % 10 === 0) console.log(i, Math.round(v), c.length, 'ground', c.ground.length, 'haz', c.hazards.length, 'bars', c.bars.length, 'mobs', c.mobs.length, 'pick', c.pickups.length, 'ledges', c.ledges.length);
  }
}
console.log(bad ? `FAIL ${bad}` : 'ok');
