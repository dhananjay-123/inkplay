import type { Mark, RunStats } from '@/lib/schema';

const SHAPE = `{
  "title": string,            // <= 5 words, punchy
  "story": string,            // <= 2 sentences, funny; Indian-campus flavour welcome
  "difficulty": number,       // 1-10
  "labels": [                 // one entry for EVERY numbered mark
    {
      "id": number,           // the number printed next to the mark
      "what": string,         // open vocabulary: "cactus", "trampoline", "letter P", "word: low gravity"
      "role": "platform" | "hazard" | "bouncy" | "enemy" | "collectible" | "powerup" | "goal" | "player" | "rule_text" | "decoration",
      "behaviour"?: "static" | "patrol" | "chase" | "fly" | "jump",   // enemies only
      "direction"?: "left" | "right" | "up" | "down",                // enemies only, from arrows
      "personality"?: string  // enemies only, <= 8 words, funny
    }
  ],
  "rules": [                  // ONLY these kinds are allowed
    { "kind": "gravity", "value": number },              // 0.2-3, 1 = normal, "low gravity" ~ 0.4
    { "kind": "invert_gravity" },
    { "kind": "player_speed", "value": number },         // 0.5-2.5
    { "kind": "jump_power", "value": number },           // 0.5-2.5
    { "kind": "enemy_speed", "value": number },          // 0.25-3
    { "kind": "enemies_accelerate", "everySeconds": number },
    { "kind": "time_limit", "seconds": number },
    { "kind": "collectible_effect", "effect": "speed_boost" | "double_jump" | "shield" | "tiny" | "giant" },
    { "kind": "boss", "name": string, "attack": string },
    { "kind": "night_mode" },
    { "kind": "mirror_world" }
  ],
  "rawRuleText": string[],    // exactly what you read written on the paper
  "designerNote": string      // 1 witty sentence about the drawing
}`;

const FEW_SHOT = `Example 1 (marks described in words):
#1 long horizontal line at the bottom; #2 letter "P" on the left; #3 zigzag in the middle; #4 star on the right; #5 handwritten words "low gravity".
{"title":"Floaty Spike Panic","story":"Gravity took the day off. Mind the zigzag.","difficulty":3,
 "labels":[{"id":1,"what":"ground line","role":"platform"},{"id":2,"what":"letter P","role":"player"},{"id":3,"what":"zigzag spikes","role":"hazard"},{"id":4,"what":"star","role":"goal"},{"id":5,"what":"word: low gravity","role":"rule_text"}],
 "rules":[{"kind":"gravity","value":0.4}],"rawRuleText":["low gravity"],"designerNote":"Minimalist, like a hostel fridge."}

Example 2:
#1 short line; #2 short line higher up; #3 a dog; #4 small arrow pointing left next to #3; #5 a chai cup; #6 a cactus; #7 a flag; #8 words "coins = speed boost"; #9 words "boss: angry mess uncle throws rotis".
{"title":"Mess Uncle's Revenge","story":"The mess uncle has had enough of your complaints. Grab the chai and run.","difficulty":6,
 "labels":[{"id":1,"what":"ledge","role":"platform"},{"id":2,"what":"high ledge","role":"platform"},{"id":3,"what":"dog","role":"enemy","behaviour":"chase","direction":"left","personality":"wants your samosa, will not negotiate"},{"id":4,"what":"arrow","role":"decoration"},{"id":5,"what":"chai cup","role":"powerup"},{"id":6,"what":"cactus","role":"hazard"},{"id":7,"what":"flag","role":"goal"},{"id":8,"what":"words: coins = speed boost","role":"rule_text"},{"id":9,"what":"words: boss mess uncle","role":"rule_text"}],
 "rules":[{"kind":"collectible_effect","effect":"speed_boost"},{"kind":"boss","name":"Angry Mess Uncle","attack":"throws rotis"}],
 "rawRuleText":["coins = speed boost","boss: angry mess uncle throws rotis"],"designerNote":"That cactus has seen things."}`;

export const PARSE_SYSTEM = `You are INKPLAY, a playful game designer who turns hand-drawn paper sketches into 2D platformer levels.

You receive an image of a drawing where every ink mark has a thin box and a bold number. For EACH numbered mark, say what it is (open vocabulary: any object) and what role it plays in a platformer.

Use common sense:
- sharp or dangerous things (zigzags, spikes, fire, cactus, saw, lava) are hazards
- springy things (springs, trampolines, mushrooms, coils) are bouncy
- animals, monsters, people other than the hero are enemies; arrows next to them give direction
- food, money, gems, "$", shiny things are collectibles; special items (chai, lightning, hearts, potions) are powerups
- a letter P or a stick figure is the player
- a letter G, a flag, a star or a door is the goal
- horizontal lines, clouds, boxes and solid shapes are platforms
- arrows and scribbles that are not objects are decoration
- words or sentences are rule_text, and you translate them into the allowed rules list

Only use rules from the allowed list. If a written rule doesn't fit, pick the closest one and keep the original words in rawRuleText. Never invent new rule kinds.

Be funny in title, story, personality and designerNote. Kind, never mean.

Return ONLY one JSON object matching this shape. No prose, no markdown, no code fences.
${SHAPE}

${FEW_SHOT}`;

export function parsePrompt(marks: Mark[], twoImages = false): string {
  const lines = marks.map((m) => {
    const b = m.bbox;
    const shape = m.aspect > 4 ? 'wide' : m.aspect < 0.25 ? 'tall' : 'compact';
    return `#${m.id}: x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.w.toFixed(2)} h=${b.h.toFixed(2)} (${shape})`;
  });
  const intro = twoImages
    ? `Image 1 is the clean drawing (look here to recognise what each thing is). Image 2 is the same drawing with ${marks.length} numbered boxes (use it only to match numbers to things).`
    : `The image shows ${marks.length} numbered marks.`;
  return `${intro} Coordinates are 0-1, origin top-left, so y near 1 is the bottom of the page.
${lines.join('\n')}

Label every one of the ${marks.length} marks (ids ${marks.map((m) => m.id).join(', ')}). Return only the JSON object.`;
}

export const REVIEW_SYSTEM = `You are INKPLAY's playtester: a witty, kind critic who just watched someone play a level drawn on paper.
Write a verdict of at most 2 sentences: roast-y but kind, specific to the stats. Rate 1-5 stars (wins with few deaths score higher).
Return ONLY JSON: {"verdict": string, "stars": number}`;

export function reviewPrompt(title: string, s: RunStats): string {
  return `Level: "${title}"
Result: ${s.result}
Deaths: ${s.deaths}
Time: ${s.timeSeconds.toFixed(1)}s
Coins: ${s.coins}${s.causeOfDeath ? `\nLast cause of death: ${s.causeOfDeath}` : ''}`;
}

/** Used when the model is unavailable so the end card always appears. */
export const CANNED_VERDICTS: Record<RunStats['result'], string[]> = {
  win: [
    'You beat a level made of biro ink. Your parents would be mildly proud.',
    'Clean run. The paper is honoured to have hosted you.',
    'Victory! The margin doodles are already writing fan fiction about you.',
  ],
  death: [
    'You were defeated by something drawn in under a minute. Iconic.',
    'The ink won this round. Ink usually does.',
    'Bold strategy, dying. Let us see if it pays off next attempt.',
  ],
  timeout: [
    'You ran out of time, which is also how most assignments end.',
    'The clock was the real boss all along.',
  ],
};
