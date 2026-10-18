import type { MapOptions } from '@/lib/arena/schema';
import type { Mark } from '@/lib/schema';

const RULES = `"rules": [                    // optional, ONLY these kinds
    { "kind": "gravity", "value": number },        // 0.4-1.6, 1 = normal
    { "kind": "jetpack_power", "value": number },  // 0.5-2
    { "kind": "fire_rate", "value": number },      // 0.5-2
    { "kind": "bullet_damage", "value": number },  // 0.5-2
    { "kind": "night_mode" }                       // exactly this, no value
  ]`;

const PIECES = `"platforms": [ { "x": number, "y": number, "w": number, "h": number, "crumble"?: true } ],   // w 0.02-0.7, h 0.012-0.2; crumble = falls away when stood on
  "hazards": [ { "x": number, "y": number, "w": number, "h": number, "kind": "lava" | "water" | "spikes", "flow"?: number } ],  // flow -1..1 for water currents
  "enemies": [ { "x": number, "y": number, "kind": "walker" | "flyer" | "turret" } ],  // walkers/turrets stand on platforms, flyers hover
  "spawns": [ { "x": number, "y": number } ],                 // y = top of the platform under it
  "pickups": [ { "x": number, "y": number, "kind": "health" | "ammo" | "rifle" | "flamethrower" | "chainsaw" | "rockets" | "grenades" | "shield" | "speed" | "double_jump" | "jetfuel" | "damage" } ]`;

/** The map maker's choices, in words Gemma can follow. */
export function optionsText(o: MapOptions): string {
  const on = (b: boolean, what: string) => (b ? what : `NO ${what}`);
  const pickups = { few: '4-6', normal: '8-10', lots: '12-14' }[o.pickups];
  return `The players asked for: ${o.enemies} hostile enemies; ${pickups} pickups; ${on(o.weapons, 'weapon crates')}; ${on(o.buffs, 'buffs')}; ${on(o.lava, 'lava')}; ${on(o.water, 'water')}; ${on(o.spikes, 'spikes')}; ${on(o.crumble, 'crumbling platforms')}.`;
}

export const ARENA_SYSTEM = `You are INKPLAY's arena designer. You design maps for a 2D multiplayer jetpack shooter (like Mini Militia) drawn in marker on notebook paper.

The world is 16:9. Coordinates are normalized 0-1, origin top-left, so y near 1 is the bottom. Players are tiny (about 0.013 wide, 0.033 tall), fly with jetpacks and shoot each other.

A good arena:
- has 16-30 platforms spread over the WHOLE map: ledges at several heights, tall pillars or walls to hide behind, a floor or near-floor pieces, a few crumbling ledges
- leaves gaps between platforms (at least 0.04) so players can fly through
- is roughly mirrored left/right so it is fair
- uses hazards to make places risky: a lava pit, spikes on a ledge, a water stream with a current
- has 4-8 spawn points standing on platforms, far apart, never on hazards
- puts weapon crates and buffs in risky middle spots, health near the edges
- places hostile enemies (walkers patrol ledges, turrets guard spots, flyers hover) away from spawns
- matches the theme with its shape (e.g. "hostel" = floors of rooms, "cricket stadium" = wide bowl)

Respect the players' requests exactly (counts, and anything marked NO).
Be funny in title and story (Indian-campus flavour welcome). Kind, never mean.

Return ONLY one JSON object. No prose, no markdown, no code fences.
{
  "title": string,                      // <= 5 words
  "story": string,                      // 1 funny sentence
  ${PIECES},
  ${RULES}
}`;

export function arenaThemePrompt(theme: string | undefined, seed: number, o: MapOptions): string {
  const t = theme?.trim();
  return `${t ? `Theme: "${t}".` : 'No theme given: surprise us with something original.'}
${optionsText(o)}
Variation seed: ${seed} (use it to make this map different from the last one).
Return only the JSON object.`;
}

export const ARENA_DRAWING_SYSTEM = `You are INKPLAY's arena designer. A player drew a sketch on paper and wants it turned into a map for a 2D multiplayer jetpack shooter (like Mini Militia).

You receive the drawing and a list of numbered marks with their boxes. For EACH numbered mark, decide its role:
- "platform": lines, boxes, shapes, walls, clouds, anything solid to stand on or hide behind
- "crumble": dashed or broken lines, cracked or thin wobbly ledges
- "spikes": zigzags, triangles, saw teeth, thorns, cactus. The mark list says "zigzag" for marks MEASURED to be zigzags: those are ALWAYS spikes, never platforms
- "lava": scribbled-in pits, flames, anything labelled lava or fire
- "water": wavy lines, puddles, rivers, anything labelled water
- "enemy": monsters, animals, angry faces, robots, anything that looks hostile
- "spawn": a letter P, a stick figure, a person, an X or a small flag
- "health": hearts, food, chai, a plus sign, a first-aid box
- "ammo": bullets, "$", boxes labelled ammo
- "weapon": guns, rockets, bombs, a saw, a flame
- "buff": stars, lightning, shields, wings, boots
- "decoration": handwritten words, arrows, tiny scribbles

The drawing usually covers only part of the page. Also add "extras": more platforms, hazards, enemies and pickups IN THE SAME STYLE as the drawing, filling the empty areas so the whole map is playable (do not overlap the drawn marks).

Written words can set rules: translate them into the allowed list (e.g. "low gravity" -> gravity 0.6, "night" -> night_mode).
Respect the players' requests exactly (counts, and anything marked NO).
Be funny in title and story. Kind, never mean.

Return ONLY one JSON object. No prose, no markdown, no code fences.
{
  "title": string,                 // <= 5 words
  "story": string,                 // 1 funny sentence
  "labels": [ { "id": number, "role": "platform" | "crumble" | "spikes" | "lava" | "water" | "enemy" | "spawn" | "health" | "ammo" | "weapon" | "buff" | "decoration" } ],
  "extras": {
  ${PIECES}
  },
  ${RULES}
}`;

export function arenaDrawingPrompt(marks: Mark[], o: MapOptions): string {
  const lines = marks.map((m) => {
    const b = m.bbox;
    const shape = m.aspect > 4 ? 'wide' : m.aspect < 0.25 ? 'tall' : 'compact';
    return `#${m.id}: x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.w.toFixed(2)} h=${b.h.toFixed(2)} (${shape}${m.zigzag ? ', zigzag' : ''})`;
  });
  return `Image 1 is the clean drawing. Image 2 shows the same drawing with ${marks.length} numbered boxes.
${lines.join('\n')}

${optionsText(o)}
Label every one of the ${marks.length} marks (ids ${marks.map((m) => m.id).join(', ')}), then add extras. Return only the JSON object.`;
}
