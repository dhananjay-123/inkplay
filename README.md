# INKPLAY

> *Draw it. Write the rules. Play it.*

Draw a game level on any paper with one pen, scribble the rules in the margin
in plain words, and snap a photo. INKPLAY works out what you *meant* and
turns it into a platformer you can play, built from your own ink.

**Play it now:** https://inkplay-lemon.vercel.app. It's free, there are no
ads and you don't need an account.

Three ways to play:

- **Create** (`/create`): photograph a drawing, draw on the in-browser canvas,
  or start from a sample. Then play your level.
- **Ink Arena** (`/arena`): a jetpack shooter for you and your friends. You
  get a map built from a theme or from your drawing, and friends join with a
  room code. Bots fill the room when you're playing alone.
- **Survival** (`/survival`): an endless runner on the same sketchbook page.
  It works on a keyboard or with taps and swipes on a phone.

INKPLAY is open source under the [MIT license](LICENSE). You can run your
own copy, including fully offline on a laptop with a local model.

---

## Why INKPLAY

Other draw-your-own-game apps only understand **fixed colours or fixed
glyphs**: red marker means lava, blue marker means water. That means
learning their legend and buying their markers. INKPLAY reads what you drew
instead:

| You draw / write | INKPLAY makes it |
|---|---|
| a cactus | **hazard** |
| a trampoline | **bouncy** |
| a cloud | **platform** |
| a dog with an arrow | **enemy that chases you** |
| a chai cup | **power-up** |
| "low gravity" | gravity × 0.5 |
| "boss: angry mess uncle throws rotis" | a boss fight |

You only need one pen, and there's no legend to learn. Your actual strokes
become the level: the hero runs on your lines and the dog you drew walks
around. Photos of paper and digital drawings (screenshots, PNGs from drawing
apps) both work.

## Drawing tips

| Mark | Meaning |
|---|---|
| straight line | ground / platform |
| zigzag | spikes |
| **P** | player |
| **G** or ★ | goal |
| **$** | coin |
| **E** (+ arrow) | enemy (+ direction) |
| anything else | the AI works it out |
| words | rules |

Use a dark pen on plain or lightly ruled paper, and keep the whole page in
the photo. The full illustrated guide is at `/guide`.

## What's in the game

- **Numbered reveal:** after you upload, every mark is boxed and numbered,
  and its label types in next to it (`#3 cactus → hazard`). If something
  was misread, you can see exactly what and redraw it.
- **Rules playground:** on the home page you can toggle handwritten rules
  (low gravity, heavy gravity, super speed, upside down, night, mirror) on a
  live mini-level.
- **Play:** a HUD with a coin tracker, a one-screen layout, touch controls
  on phones, and a short review of your run on the end card.
- **Gallery:** shared levels from other players (when the server has one
  configured).

### Ink Arena

- **Join:** pick a name and a scarf colour, then start a room or type a room
  code. Share the invite link. No account needed.
- **Maps:** built from a theme ("hostel rooftops"), from a sample or uploaded
  drawing (zigzags become spikes, and the rest of the page is filled in the
  same style), or "surprise me". If the map maker is slow, a seeded
  procedural map takes over, so a room never waits.
- **Options:** how many monsters and bots, how many pickups, and which
  weapons, buffs and hazards are in play.
- **Controls:** jump and jetpack (W/Space), autofire that aims for you (F to
  aim with the mouse), grenades (G or right-click). Crates hold a rifle,
  flamethrower, chainsaw, rockets, shield, speed, double jump, endless jet
  and double damage.
- **The map:** lava, water currents, spikes and crumbling floors. Walker,
  flyer and turret monsters respawn at random spots, and there's a live
  minimap.
- **Bots:** add 0 to 8. They fly, dodge lava and shoot players, monsters and
  each other.
- **Anywhere:** full screen on a PC. On a phone it goes full screen in
  landscape with touch controls.

### Survival

- **Controls:** Space, ↑ or W to jump (hold for a higher jump). ↓ or S to
  slide (in the air it slams you down). P or Esc to pause, R to restart.
  On a phone: tap or swipe up to jump, swipe down to slide.
- **The track:** gaps, spikes, lava, crumbling floors, hanging beams you
  slide under, and floating ledges. Mobs walk at you, fly at head height or
  spit ink blots. Land on a mob to stomp it.
- **HP:** 100 points. A hit costs 15 to 30 HP and makes you briefly
  invulnerable. Falling into a gap costs 25 HP and puts you back on the next
  ground.
- **Pickups:** coins, hearts (+30 HP), a shield that blocks one hit, a coin
  magnet, and a zoom boost that flies you over everything for 4 s.
- **Score:** metres + 5 per coin + 25 per stomp. Your best run is saved in
  your browser and marked on the track.

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
 POST /api/parse ──► vision model (Gemini API  |  Ollama, offline)
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
 POST /api/review ──► short review (canned fallback if the model is busy)
```

**What the model does.** It labels every numbered mark with open vocabulary
(`what: "cactus"`, `role: "hazard"`). It maps margin handwriting onto a
**whitelisted** set of mechanics. It names the level, writes a two-line
story and reviews your run. In the arena it lays out maps. Everything it
returns is data that the server validates and clamps.

**Set-of-marks prompting.** Vision models are bad at giving coordinates but
good at reading numbers. So OpenCV handles the geometry, and the model only
has to say "mark #3 is a cactus". It gets two images: the clean drawing
(to recognise things) and the numbered copy (to match ids).

**Measurements over guesses.** Where the model wavers (a hatched trampoline
vs spikes), the vision step measures the shape and settles it (D12 in
[`docs/DECISIONS.md`](docs/DECISIONS.md)).

**Multiplayer.** Each room is one **Supabase Realtime** channel. Broadcast
carries game traffic and presence carries the roster. Each client simulates
its own player and sends its state 10 times a second. Other clients draw it
150 ms behind, interpolated. The player who gets hit decides the hit, and
the earliest joiner still playing runs the monsters and bots. Without
Supabase (or with `?local=1`), rooms fall back to `BroadcastChannel`
between tabs of one browser. Details: D18 to D21 in
[`docs/DECISIONS.md`](docs/DECISIONS.md).

**Survival** chunks come from a seeded generator and are clamped like
levels (`src/lib/survival/`), so a run needs no model and no network.

**No database required.** Draw → parse → play → review works without
Supabase. Supabase only powers the gallery and online arena rooms, and
every call to it is best-effort with a timeout.

## Run your own copy

Requires Node 20+ and **pnpm**.

```bash
git clone https://github.com/dhananjay-123/inkplay.git
cd inkplay
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # http://localhost:3000
```

### Hosted model (Gemini API)

```env
MODEL_PROVIDER=gemini
GEMINI_API_KEY=...            # https://aistudio.google.com/apikey
CLOUD_MODEL=gemma-4-26b-a4b-it
```

### Local model, fully offline (Ollama)

```bash
ollama pull gemma4:e4b        # or set OLLAMA_MODEL to another vision model
pnpm build                    # while online: fonts are fetched and self-hosted at build time
pnpm start:offline            # = MODEL_PROVIDER=ollama next start
```

Fonts, OpenCV.js and the sample drawings ship with the app, and sounds are
synthesized with Web Audio. Nothing is fetched from a CDN at runtime. Check
`/api/health` for `"modelReachable":true`.

### Tested models

| Provider | Model | Parse time |
|---|---|---|
| Gemini API | `gemma-4-26b-a4b-it` | ≈ 11 s typical (10–31 s), thinking `minimal` |
| Ollama (RTX 4060 laptop) | `gemma4:e4b` | 15–16 s |

Other vision models should work but haven't been tested. If you try one,
please open an issue or PR with the results.

### Gallery and online arena rooms (optional, Supabase)

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql)
   in the SQL editor. It creates the tables, RLS policies, the `record_run`
   RPC and the public `drawings` bucket.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is only used in
   `server-only` modules.

Arena rooms need no tables. They use Realtime broadcast and presence with
the anon key. If you enable anonymous sign-in in Supabase, it's used;
otherwise players join as guests.

### No model at all

`MODEL_PROVIDER=mock` uses a geometry-only labeller. It's useful for
working on the UI without an API key.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` / `pnpm start` | production build / serve |
| `pnpm start:offline` | production server with `MODEL_PROVIDER=ollama` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:model` | smoke-test the configured provider on a sample |
| `pnpm test:vision [files…]` | headless OpenCV run on the samples (or given JPEGs) → `.out/` |
| `pnpm test:arena [theme]` | generate one arena map |
| `pnpm test:realtime` | two Realtime clients + anonymous sign-in check |
| `pnpm exec tsx scripts/arena-bot.ts ROOM [secs] [bots]` | headless players join a room and report sync stats |
| `pnpm exec tsx scripts/check-survival.ts` | checks generated survival chunks for fair gaps and seams |

## Safety

- The model can only choose from the `Rule` union in
  [`src/lib/schema.ts`](src/lib/schema.ts). Unknown rules are dropped, and
  every number is clamped on the server.
- Arena maps and survival chunks are data too. They come from a whitelist,
  get clamped and cleaned up, and are validated again when a map arrives
  from another player.
- Server keys never reach the client. `/api/parse`, `/api/review` and
  `/api/arena/map` are rate-limited per IP.

## Contributing

Issues and pull requests are welcome. Please use **pnpm**, keep TypeScript
strict, and run `pnpm build` before opening a PR. Design notes are in
[`docs/SPEC.md`](docs/SPEC.md), and the reasoning behind non-obvious choices
is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · Phaser 3 ·
OpenCV.js (Web Worker) · Zod · Zustand · `@google/genai` · Ollama ·
Supabase (optional) · Rough.js.

## License

[MIT](LICENSE)
