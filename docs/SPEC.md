# INKPLAY — Product & Technical Spec

Source of truth for *what* we build. `CLAUDE.md` covers *how* we work;
`docs/PROGRESS.md` tracks *where* we are.

---

## 1. Product

**One-liner.** Draw a game level on any paper with any single pen, write the
rules in plain words in the margin, snap a photo. Gemma 4 (open-weight)
understands what you *meant* and turns it into a playable platformer in
seconds. The public site runs Gemma 4 in the cloud; the same app runs fully
offline on a laptop with Gemma 4 E4B via Ollama.

### What's new vs prior apps

Pixel Press Floors, Draw Your Game and Pixicade already turn drawings into
games, but they only understand **fixed colours or fixed glyphs**. INKPLAY
understands **meaning**:

1. **Open-vocabulary objects.** Cactus → hazard, trampoline → bouncy,
   cloud → platform, dog → chasing enemy, chai cup → power-up. No legend.
2. **Handwritten rules.** "low gravity", "enemies get faster",
   "coins = speed boost", "boss: angry mess uncle throws rotis" become
   mechanics.
3. **AI game designer.** Gemma names the level, writes a 2-line story, gives
   enemies personalities, rates difficulty and roasts your run.
4. **Open + offline.** Same open model family in the cloud or on a laptop.

### Drawing conventions (single pen; optional cheat sheet)

| Mark | Meaning |
|---|---|
| straight line | ground / platform |
| zigzag | spikes |
| **P** | player |
| **G** or ★ | goal |
| **$** | coin |
| **E** (+ arrow) | enemy (+ direction) |
| anything else | interpreted by Gemma |
| words | rules |

---

## 2. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (latest, App Router) + TypeScript, `src/` dir |
| Package manager | pnpm |
| Styling | Tailwind CSS v4 + CSS-variable tokens |
| Animation | GSAP (+ ScrollTrigger, text splitter), Lenis, Motion |
| Game | Phaser 3, client-only via `next/dynamic({ ssr: false })` |
| Vision | OpenCV.js in the browser, self-hosted, lazy-loaded on `/create` |
| Client state | Zustand |
| Validation | Zod |
| AI (cloud) | `@google/genai`, model from `GEMMA_CLOUD_MODEL` |
| AI (local) | Ollama `/api/chat`, model from `OLLAMA_MODEL` (default `gemma4:e4b`) |
| Sketch rendering | Rough.js |
| DB + storage | Supabase (gallery only, optional) |
| Deploy | Vercel (Git integration, `main`) |
| License | MIT |

### Environment (`.env.example`)

```
# AI
MODEL_PROVIDER=gemini            # gemini (Vercel) | ollama (laptop / offline)
GEMINI_API_KEY=                  # server-only
GEMMA_CLOUD_MODEL=               # exact Gemma 4 model id from Google AI Studio
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e4b

# Supabase (all optional — app must work without them)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-only, NEVER imported in client code

NEXT_PUBLIC_APP_NAME=INKPLAY
NEXT_PUBLIC_INTRO_VIDEO=0
```

`src/lib/env.ts` validates with Zod and exposes `provider` and `hasSupabase`.

---

## 3. AI pipeline

### 3.1 Client preprocessing (`src/lib/vision/`, OpenCV.js)

1. Input: a photo uploaded from the device, a sample, or a level drawn in
   the browser canvas (`src/lib/editor/`), which exports a 1600×900
   ink-on-paper PNG and takes the same route. Camera/webcam capture was
   removed (D17).
2. Detect paper (largest 4-point contour) → perspective-warp to 16:9.
   Fallback: center-crop the full image to 16:9.
3. Clean: grayscale → adaptive threshold → morphological close. Produce
   (a) **clean ink image** (black ink on warm paper; game background) and
   (b) **binary mask**.
4. Marks: connected components on a dilated mask so letters of a word and
   parts of a doodle merge. Drop noise. Cap ~40.
5. Per mark: normalized bbox (0–1), area, aspect, simplified polyline of the
   main stroke.
6. **Set-of-marks image:** clean image + thin box + bold numeric ID per mark.
7. Size budget (Vercel body ~4.5 MB): max 1024 px wide, JPEG ~0.8, assert
   payload < 3 MB, downscale further if needed.
8. `POST /api/parse` with `{ somImage, cleanImage, marks[] }`.

### 3.2 `POST /api/parse`

- `runtime = 'nodejs'`, `maxDuration` set to the Vercel Hobby limit
  (documented in README).
- `src/lib/ai/index.ts` → `generateJSON<T>({ system, prompt, images, schema })`
  switching on `MODEL_PROVIDER`:
  - **gemini:** `models.generateContent`, inline base64 JPEG parts. Do **not**
    assume system instructions or JSON mode for Gemma — system prompt goes at
    the top of the user turn; parse defensively. Verified in Phase 1.
  - **ollama:** `/api/chat`, `stream:false`, system + user with `images`,
    `format` = JSON Schema from Zod, `temperature: 0.2`.
  - Both: strip fences → `JSON.parse` → Zod. Retry once with the validation
    error appended. Still failing → structured, playful error.
  - Gemini 429 / quota → "Gemma is catching its breath, try again in a
    moment" + retry button.
- Run the fixer (3.5), return `{ id, level, marks }`.
- Best-effort, non-blocking: if `hasSupabase`, upload `cleanImage` and insert
  the row; `id` or `null`. Supabase failure never fails the request.
- Log per-call timing.

### 3.3 Schema (`src/lib/schema.ts`)

```ts
Role = 'platform' | 'hazard' | 'bouncy' | 'enemy' | 'collectible' | 'powerup'
     | 'goal' | 'player' | 'rule_text' | 'decoration'

MarkLabel = {
  id: number,                 // must match an input mark id
  what: string,               // open vocabulary
  role: Role,
  behaviour?: 'static' | 'patrol' | 'chase' | 'fly' | 'jump',
  direction?: 'left' | 'right' | 'up' | 'down',
  personality?: string        // enemies only, ≤ 8 words
}

Rule =
  | { kind: 'gravity', value: number }              // 0.2 – 3
  | { kind: 'invert_gravity' }
  | { kind: 'player_speed', value: number }         // 0.5 – 2.5
  | { kind: 'jump_power', value: number }           // 0.5 – 2.5
  | { kind: 'enemy_speed', value: number }
  | { kind: 'enemies_accelerate', everySeconds: number }
  | { kind: 'time_limit', seconds: number }
  | { kind: 'collectible_effect', effect: 'speed_boost' | 'double_jump' | 'shield' | 'tiny' | 'giant' }
  | { kind: 'boss', name: string, attack: string }
  | { kind: 'night_mode' }
  | { kind: 'mirror_world' }

Level = {
  title: string,              // ≤ 5 words
  story: string,              // ≤ 2 sentences
  difficulty: number,         // 1–10
  labels: MarkLabel[],
  rules: Rule[],
  rawRuleText: string[],
  designerNote: string
}
```

Clamp every number server-side. Drop labels whose `id` doesn't exist.

### 3.4 Prompts (`src/lib/ai/prompts.ts`)

- **Parse:** playful game designer persona; label every numbered mark with
  open-vocabulary `what` + `role` using common sense; words → `rule_text` and
  translated into allowed rules only (closest match, original kept in
  `rawRuleText`); funny title/story/personality/designerNote; JSON only.
  Include the JSON shape and 2 short few-shot examples.
- **Review (`POST /api/review`):** input title + `{ result, deaths,
  timeSeconds, coins, causeOfDeath }` → `{ verdict (≤ 2 sentences, roast-y
  but kind), stars 1–5 }`, temperature 0.8. On failure, canned local
  verdicts so the end card always appears.

### 3.5 Auto-fixer (`src/lib/fixer.ts`)

- No player → spawn above the lowest-left platform; several → keep left-most.
- No goal → top-right-most platform.
- No platforms → ground line along the bottom.
- Player overlapping hazard → nudge up/left.
- Reachability: coarse grid BFS using jump height/width from active rules;
  if unreachable, insert minimal rescue platforms (accent colour, label
  "added by Gemma ✦") and append to `designerNote`.
- Unknown / low-confidence → `decoration`.

---

## 4. Game (`src/game/`, Phaser 3)

- World 1600×900, `Scale.FIT`.
- **Background = the user's cleaned drawing.** Bodies sit exactly on ink
  marks — the character runs on their pen strokes. Top priority.
- Arcade physics. Platforms = static bodies on the bbox top edge; slanted
  strokes = chain of small bodies along the polyline.
- Player: hand-drawn style (Rough.js texture). Coyote time + jump buffer.
- Hazards kill, bouncy launches, enemies patrol / chase / fly, collectibles
  and powerups apply `collectible_effect`, goal wins.
- Rules applied at scene start; HUD sticky-note chips
  ("LOW GRAVITY ✓ read from your paper").
- Juice: squash & stretch, ink-splat particles, shake, coin sparkle,
  scribble wipe. SFX self-hosted, muted by default with toggle.
- Controls: arrows/WASD + space; on-screen touch controls on mobile.
- Run stats → React via a typed event bus → `/api/review` → end card.

---

## 5. Design — "Living Notebook"

Tokens and fonts: see `CLAUDE.md`.

**Signature details**
- Pen-nib cursor with a ~600 ms ink trail; grows and turns green on CTAs;
  off on touch.
- Self-drawing SVG underlines / circles / arrows on viewport entry.
- Split-text mask reveals; magnetic buttons; card tilt; paper-curl gallery
  hover.
- Ink-blot page transition (~700 ms).
- Kalam margin annotations, as if Gemma comments on the site.
- Reduced motion: no trail, reveals → fades, skip intro.
- 60 fps target; lazy OpenCV/Phaser; Lighthouse perf ≥ 85 on `/`.

### 5.1 Intro film (code-driven, ~7.5 s, skippable)

**As built** (`src/components/home/intro-film.tsx`): plays on every full load
of `/` (first visit, reload, Ctrl+Shift+R), never on client-side navigation
back home. The level draws itself; the hero jumps spikes, grabs 3 coins
(live counter), stomps a walker, flips over a bat, hits the star; wordmark
stamps in; page wipes away. Any key / click / wheel skips. Off under reduced
motion and without JS. The original plan below is kept for reference.


1. Blank paper; nib draws a wobbly line, zigzag, **P**, star.
2. Kalam margin note writes "low gravity".
3. Highlighter swipe; strokes lift to 2.5D; P becomes the character and
   floaty-jumps onto the line.
4. Pull back; character lands on the INKPLAY wordmark, which snaps from ink
   into the grotesk.
5. "Skip →" always visible; any key/click skips. `seen` in localStorage
   (try/catch). If `NEXT_PUBLIC_INTRO_VIDEO=1` and `/intro.mp4` exists, play
   it instead.

### 5.2 Pages

1. **`/`** — hero (wordmark, tagline, self-playing mini demo, "Start drawing
   →", `/api/health` status pill); "They read colours. We read meaning."
   pinned horizontal compare; "Write the rules" scrub; Draw / Snap / Play;
   "Runs offline"; Hall of Doodles preview (hidden without Supabase); footer.
2. **`/create`** — two ways in: draw on the canvas (pen, line, eraser,
   drag-in doodles, rules, imported pictures, undo, templates saved in the
   browser) or upload a photo; templates shelf; Try a sample (5);
   cheat sheet; set-of-marks reveal with labels typing in
   ("#3 cactus → hazard"); witty loading lines; "Gemma read these rules";
   "Play it →".
3. **`/play`, `/play/[id]`** — full-bleed game + HUD; end card with verdict,
   stars, remix, back to gallery; share button only with `id`.
4. **`/gallery`** — masonry of drawings; offline empty state
   "The gallery is offline. The game isn't."
5. **`/about`** — architecture diagram, why open models, honest comparison,
   credits.
6. **`/guide`** — every symbol with a drawn glyph, open-vocabulary examples,
   every writable rule, photo tips, controls. A compact legend also sits on
   `/create`.

As built, `/` also has a **rules playground** (toggle handwritten rules,
watch a tiny level's physics change, see the JSON) and **living doodles**
(cactus/trampoline/cloud/dog/chai animate on hover). The model status pill
was removed.

---

## 6. API

| Route | Purpose |
|---|---|
| `POST /api/parse` | §3.2 → `{ id \| null, level, marks }` |
| `POST /api/review` | verdict; best-effort `record_run` |
| `GET /api/levels` | paginated list (`[]` without Supabase) |
| `GET /api/levels/[id]` | one level + public image URL |
| `GET /api/health` | provider, model, reachability, `hasSupabase` |
| `POST /api/arena/map` | §10: `{mode:'theme', theme?, options?}` or `{mode:'drawing', marks, cleanImage, somImage, options?}` → `{ map, source: 'model' \| 'procedural', note? }`; never fails a valid request |

Rate limiting: best-effort per-instance limiter + client cooldown (one parse
at a time, 5 s). Gemini free-tier limits are the real ceiling.

---

## 7. Supabase (gallery only)

`supabase/schema.sql`:
- `levels(id uuid pk default gen_random_uuid(), created_at timestamptz
  default now(), title text, difficulty int, level_json jsonb, image_path
  text, plays int default 0, wins int default 0, best_time real)`
- `runs(id uuid pk, level_id uuid references levels on delete cascade,
  result text, deaths int, time_s real, created_at timestamptz default now())`
- RPC `record_run(level_id, result, deaths, time_s)` — atomic insert + stats.
- RLS on both; anon may `select` `levels` only; writes server-side with the
  service role.
- Bucket `drawings`, public read, path `levels/{id}.jpg`.
- `src/lib/supabase/server.ts` / `client.ts` return `null` without env.

---

## 8. Deploy (Vercel)

Public GitHub repo (MIT) → import in Vercel → set `MODEL_PROVIDER=gemini`,
`GEMINI_API_KEY`, `GEMMA_CLOUD_MODEL`, Supabase vars. Deploy hello-world in
Phase 2. Check `/api/parse` latency against `maxDuration`.

---

## 9. Definition of done

- `pnpm build` passes, zero type errors.
- All 5 samples and a canvas-drawn level work on Vercel **and** offline with Ollama.
- Works with all Supabase env removed.
- A handwritten rule visibly changes gameplay.
- An open-vocabulary doodle (e.g. cactus) becomes the right role.
- No server secret in the client bundle.
- Public repo, MIT LICENSE, complete README.

---

## 10. Ink Arena (multiplayer, `/arena`)

A Mini Militia-style jetpack shooter on the same paper. Additive: the
platformer loop is untouched. Decisions and test numbers: `DECISIONS.md`
D18 to D21.

### 10.1 Rooms and netcode
- **Login:** nickname + scarf colour (localStorage); one id per tab
  (sessionStorage) so two tabs are two players; Supabase anonymous sign-in
  when enabled on the project.
- **Transport** (`src/lib/arena/net.ts`): Supabase Realtime channel
  `arena:<ROOM>` (broadcast `m` for game traffic, presence for the roster
  and kills/deaths). Watchdog: rebuild channel and socket when not joined
  for 4 s, when nothing arrives for 6 s while others are present, or when
  the tab becomes visible; re-track presence after every join; 10 Hz state
  is dropped while disconnected (no REST fallback). Fallback transport:
  `BroadcastChannel` (no Supabase, offline, or `?local=1`).
- **Messages:** `st` (10 Hz: position, aim, hp, weapon, shield, shots, sender
  clock, map round, name/colour, join time, `away`; from the host also
  monsters `n/ns` and bots `b/bs/bn`), `die`, `npcdie`, `pick`, `map`,
  `needmap`, `bots`.
- **Model:** each client owns its movement; remotes are interpolated 150 ms
  behind using the sender's clock; every client simulates every
  projectile; hits on a player are decided by that player; hits on monsters
  and bots by the host. Host = earliest joiner among live, visible players,
  elected every frame. Hidden tabs send ~1/s marked `away` (faded, not
  targetable). State from another map round is ignored and triggers a map
  fetch; map rounds are timestamps.

### 10.2 Map (`src/lib/arena/schema.ts`)
- World 2400×1350, normalized coords. `ArenaMap`: platforms (optional
  `crumble`), hazards (`lava | water + flow | spikes`), enemies (`walker |
  flyer | turret`), spawns, pickups (health, ammo, rifle, flamethrower,
  chainsaw, rockets, grenades, shield, speed, double_jump, jetfuel, damage),
  rules (gravity, jetpack_power, fire_rate, bullet_damage, night_mode),
  bots count, optional backdrop (cleaned drawing, small JPEG).
- `finalizeArena`: clamp everything; floor first; `separate()` platforms
  (move with fly-through room or drop; cover snaps onto its base); hazards
  rest on surfaces, never stack, water trimmed at ledges; spawns and crates
  off hazards and apart.
- **Map options** (`MapOptions`): monsters 0-8, bots 0-8, pickups
  few/normal/lots, weapons, buffs, lava, water, spikes, crumble. Sent to
  Gemma as constraints, enforced by `applyOptions`.
- **Drawing → arena:** marks labelled `platform | crumble | spikes | lava |
  water | enemy | spawn | health | ammo | weapon | buff | decoration`;
  measured zigzags are always spikes; Gemma adds `extras`; `growDrawing`
  mirrors and fills empty cells so the map covers the page.

### 10.3 Game (`src/game/ArenaScene.ts`)
- Jump on ground + jetpack (fuel), auto-aim autofire (nearest visible enemy
  in range; F for manual mouse aim), grenades, weapon crates (`weapons.ts`),
  timed buffs, hazards, crumbling floors (fall 0.65 s after anyone stands on
  them, regrow after 5 s).
- Monsters: 4 s grace, 20 s respawn at a random spot away from players,
  flyers collide with platforms. Bots: physics bodies on the host; chase,
  strafe, jetpack over walls and away from lava, wobbly SMG.
- HUD: HP (+shield), jet %, weapon + ammo, grenades, active buffs, bots
  control, scoreboard (players + bots), kill feed, live minimap. Full screen
  on PC; phones go immersive landscape with touch controls (move, jet,
  grenade) and a rotate prompt in portrait.
