# INKPLAY — Paper to Playable

> *Draw it. Write the rules. Play it.*

Draw a game level on any paper with any single pen, scribble the rules in the
margin in plain words, and snap a photo. **Gemma 4** works out what you
*meant* and turns it into a playable platformer, using your own ink as the
level. It runs in the cloud, or fully offline on a laptop with Gemma 4 E4B
through Ollama.

There's also **Ink Arena** (`/arena`): a Mini Militia-style multiplayer
shooter where Gemma designs the map from a theme, from your drawing, or on
its own, and friends join with a room code.

**Live:** https://inkplay-lemon.vercel.app · **Code:** https://github.com/dhananjay-123/inkplay

Built for **Hacktoberfest Hack Day Gwalior × ABV-IIITM IEEE**, for the tracks
*Best Open-Source AI Project* and *Best Use of Gemma 4*. MIT licensed.

---

## The problem

Kids (and adults) draw game levels in the back of notebooks all the time.
Apps that turn drawings into games already exist (Pixel Press Floors, Draw
Your Game, Pixicade), but they only understand **fixed colours or fixed
glyphs**. Red marker means lava and blue marker means water, so you have to
learn the legend and buy the markers. Drawing for the app isn't the same as
drawing your idea.

## What's new: we read meaning

| You draw / write | Other apps | INKPLAY |
|---|---|---|
| a cactus | ignored, or "a wall" | **hazard** |
| a trampoline | a wall | **bouncy** |
| a cloud | a wall | **platform** |
| a dog with an arrow | — | **enemy that chases you** |
| a chai cup | — | **power-up** |
| "low gravity" | — | gravity × 0.5 |
| "boss: angry mess uncle throws rotis" | — | a boss fight |

One pen, no legend. Your actual strokes become the level: the hero runs on
your lines, and the dog you drew walks around.

Photos of paper and **digital drawings** (screenshots, PNGs from drawing
apps) both work.

## On the site

- **Intro film:** the level draws itself and our hero runs it (spikes, coins,
  a stomped enemy, a double jump over a bat, the star). Skippable.
- **Rules playground:** toggle handwritten rules (low gravity, heavy gravity,
  super speed, upside down, night, mirror) on a live mini-level and see the
  exact JSON rules Gemma would send the game.
- **Set-of-marks reveal:** every mark boxed and numbered, then Gemma's label
  types in next to it (`#3 cactus → hazard`).
- **`/guide`:** what each symbol means, what you can just draw, every rule
  you can write.
- **Play:** HUD with coin tracker, one-screen layout, touch controls on
  phones, Gemma's review on the end card.

## Ink Arena (multiplayer)

`/arena` turns the same sketchbook into a jetpack shooter for several players
at once.

- **Join:** pick a name and a scarf colour, then start a room or type a
  room code. Share the invite link. No account needed.
- **Maps by Gemma:** from a theme ("hostel rooftops"), from a sample or
  uploaded drawing (zigzags become spikes, the rest of the page is filled
  in the same style), or "surprise me". A seeded procedural map is always
  the fallback, so a room never waits on the model.
- **Map maker options:** number of monsters and AI bots, how many pickups,
  and which weapons, buffs and hazards to include. Gemma gets them as
  constraints and the server enforces them.
- **Play:** jump and jetpack (W/Space), autofire that aims for you (F to aim
  with the mouse), grenades (G or right-click), and crates with a rifle,
  flamethrower, chainsaw, rockets, shield, speed, double jump, endless jet
  and double damage.
- **The map:** lava, water currents, spikes and crumbling floors; walker,
  flyer and turret monsters that respawn at random spots; a live minimap.
- **AI bots:** add 0 to 8 with **- bots N +**. They fly, dodge lava and
  shoot players, monsters and each other. Good for solo play and demos.
- **Anywhere:** full screen on PC; on phones it goes full screen in
  landscape with touch controls.

**How the multiplayer works.** Vercel functions can't hold websockets, so
rooms run on a **Supabase Realtime** channel per room: broadcast for game
traffic and presence for the roster. Each client simulates its own player
and sends its state 10 times a second; others draw it 150 ms behind,
interpolated using the sender's clock. The player who gets hit decides the
hit. The earliest joiner still playing runs the monsters and bots. A
watchdog rebuilds the connection when it dies, including the silent kind.
Without Supabase (or with `?local=1`) rooms fall back to `BroadcastChannel`
between tabs of one browser, so the offline demo still has multiplayer.
Details: [`docs/DECISIONS.md`](docs/DECISIONS.md) D18 to D21.

## Gemma's jobs

1. **Eye.** It labels every numbered mark on the page with open vocabulary
   (`what: "cactus"`, `role: "hazard"`).
2. **Rules lawyer.** It reads handwriting in the margin and maps it onto a
   **whitelisted** set of mechanics (gravity, speed, jump power, time limit,
   boss, night mode, mirror controls…). Rules are data, never code, and every
   number is clamped on the server.
3. **Game designer.** It names the level, writes a two-line story, gives each
   enemy a personality, rates difficulty and leaves a designer's note.
4. **Critic.** When you win or die, it reviews your run with a kind roast and
   1–5 stars.
5. **Arena designer.** It lays out multiplayer maps (platforms, hazards,
   spawns, crates, monsters) from a theme or a drawing, as whitelisted data
   that the server clamps.

## How it works

```
 photo / canvas / sample
          │
          ▼
 ┌──────────────────────── browser (Web Worker) ───────────────────────┐
 │ OpenCV.js: find paper → warp 16:9 → adaptive threshold → clean ink  │
 │ split long lines from doodles → connected components → ≤40 marks   │
 │ render "set-of-marks" copy: every mark boxed + numbered             │
 └─────────────────────────────────────────────────────────────────────┘
          │  clean image + numbered image + mark geometry
          ▼
 POST /api/parse ──► Gemma 4 (Gemini API  |  Ollama, offline)
          │            JSON → Zod validation → clamp → one retry
          ▼
 auto-fixer: ensure player + goal, nudge out of hazards,
 grid BFS reachability → adds "rescue" platforms if needed
          │
          ├──► (best effort) Supabase: save drawing + level for the gallery
          ▼
 Phaser 3: your cleaned drawing is the background, bodies sit on your ink,
 enemies / coins / goal are cut out of the drawing and come alive
          │  run stats
          ▼
 POST /api/review ──► Gemma's verdict (canned fallback if the model is busy)
```

**Set-of-marks prompting.** Vision models are bad at giving coordinates but
good at reading numbers, so OpenCV does the geometry and Gemma only has to say
"mark #3 is a cactus". We send two images: the clean drawing (to recognise
things) and the numbered copy (to match ids). In testing this fixed cacti
being read as "pillar platforms".

**Golden rule.** Draw → parse → play → review works with **no database at
all**. Supabase only powers the gallery, and every call to it is
best-effort with a timeout.

## Measured latency (real numbers)

| Provider | Model | Parse | Notes |
|---|---|---|---|
| Gemini API | `gemma-4-26b-a4b-it` | ≈ 11 s typical (10–31 s range); 20–26 s in the browser | thinking `MINIMAL`, native system instruction, 2 images. Correct player/goal/hazard/enemy/rules on all 5 samples |
| Ollama (laptop, RTX 4060) | `gemma4:e4b` | 15–16 s, up to ≈ 44 s when a malformed reply is retried | fully offline; player, goal and rules right on all 5 samples |

Setting thinking to `MINIMAL` made calls 2–3× faster with no accuracy loss.
Details are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**Measurements over guesses.** Where Gemma wavered (a hatched trampoline vs
spikes), the vision step measures the shape: a mark whose top edge swings
fully up and down again and again is tagged `zigzag` in the prompt, and a
"spikes" label on a flat bar that isn't a zigzag becomes a trampoline. That
took the trampoline to 3/3 without breaking real spikes (D12).

## Run it

Requires Node 20+ and **pnpm**.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # http://localhost:3000
```

### Cloud (Gemini API)

```env
MODEL_PROVIDER=gemini
GEMINI_API_KEY=...            # https://aistudio.google.com/apikey
GEMMA_CLOUD_MODEL=gemma-4-26b-a4b-it
```

### Offline (Ollama)

```bash
ollama pull gemma4:e4b
pnpm build      # while online (fonts are fetched and self-hosted at build time)
pnpm demo       # = MODEL_PROVIDER=ollama next start
```

### Offline checklist

- [ ] `ollama list` shows `gemma4:e4b`, and `ollama serve` is running
- [ ] `pnpm build` was run **while online**
- [ ] Wi-Fi off → `pnpm demo` → `/api/health` shows `"provider":"ollama"` and `"modelReachable":true`
- [ ] Try a sample on `/create` → play → the end card shows a verdict
- [ ] The gallery says "The gallery is offline. The game isn't." (expected)

Fonts, OpenCV.js and sample drawings ship in `/public` or the bundle, and
sounds are synthesized with Web Audio. Nothing is fetched from a CDN at runtime.

### Gallery (optional, Supabase)

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql)
   in the SQL editor. It creates the tables, RLS policies, the `record_run`
   RPC and the public `drawings` bucket.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is only used in
   `server-only` modules.

Without these variables the app works fully; only the gallery is hidden.
The arena then plays between tabs of one browser instead of over Realtime.
Rooms need no tables: they use Realtime broadcast and presence with the
anon key. Anonymous sign-in is used if you enable it in Supabase
(Authentication), otherwise players are guests.

### No model at all

`MODEL_PROVIDER=mock` uses a geometry-only labeller. It's for development
only, never for demos.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` / `pnpm start` | production build / serve |
| `pnpm demo` | production server with `MODEL_PROVIDER=ollama` |
| `pnpm test:model` | smoke-test the configured provider on a sample |
| `pnpm test:vision [files…]` | headless OpenCV run on the samples (or given JPEGs) → `.out/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:arena [theme]` | Gemma designs one arena map |
| `pnpm test:realtime` | two Realtime clients + anonymous sign-in check |
| `pnpm exec tsx scripts/arena-bot.ts ROOM [secs] [bots]` | headless players join a room and report message rate and longest gap per player |

## Drawing tips

| Mark | Meaning |
|---|---|
| straight line | ground / platform |
| zigzag | spikes |
| **P** | player |
| **G** or ★ | goal |
| **$** | coin |
| **E** (+ arrow) | enemy (+ direction) |
| anything else | Gemma works it out |
| words | rules |

Use a dark pen on plain or lightly ruled paper, and keep the whole page in
the photo. The full illustrated guide is at `/guide`.

## Safety

- The model can only choose from the `Rule` union in
  [`src/lib/schema.ts`](src/lib/schema.ts). Unknown rules are dropped and every
  number is clamped on the server.
- Arena maps are data too: platforms, hazards, spawns, crates and monsters
  from a whitelist, clamped and cleaned up on the server (no overlaps,
  reachable hazards, spawns off hazards), and re-validated when a map
  arrives from another player.
- Server keys never reach the client. Per-IP rate limiting is on
  `/api/parse`, `/api/review` and `/api/arena/map`, and 429s show a
  friendly retry message.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · Phaser 3 ·
OpenCV.js (Web Worker) · Zod · Zustand · `@google/genai` · Ollama ·
Supabase (optional: gallery + Realtime rooms) · Rough.js.

## License

[MIT](LICENSE)
