# Decisions

Short log of non-obvious choices. Newest at the bottom. One entry = context,
decision, why.

---

### D1 — Spec split into `CLAUDE.md` + `docs/`
- **Context:** the build brief was one long pasted prompt.
- **Decision:** `CLAUDE.md` holds working rules, commands, layout and design
  tokens; `docs/SPEC.md` holds the full product/technical spec;
  `docs/PROGRESS.md` tracks phases and measured numbers; this file logs
  decisions.
- **Why:** agents load `CLAUDE.md` every session, so it stays short and
  rule-focused; the spec is reference material read on demand.

### D2 — Gemma on the Gemini API: no system instruction / JSON mode assumed
- **Context:** Gemma models served via the Gemini API may not support
  `systemInstruction` or `responseSchema`.
- **Decision:** system prompt is prepended to the user turn; output is parsed
  defensively (fence strip → JSON.parse → Zod → one retry).
- **Why:** works whether or not the features exist.
- **Phase 1 result (2026-10-18, `gemma-4-26b-a4b-it`):** `systemInstruction`
  **is supported** and is faster (≈11–15 s vs 21–30 s inline), so it is now the
  default. JSON mode (`responseMimeType`) returns the object wrapped in an
  array → costs a retry; left off (we also unwrap one-item arrays). The 31B
  model returned 500s/timeouts; 26B-A4B is the default.

### D10 — Gemma 4 thinking set to MINIMAL
- **Context:** by default Gemma 4 spends ~1k hidden thought tokens per call
  (a one-line prompt took 21 s). `thinkingBudget` and `thinkingLevel: LOW`
  are rejected (400); `thinkingLevel: MINIMAL` works (1.1 s, 0 thought tokens).
- **Decision:** `MODEL_THINKING=minimal` by default (old name
  `GEMMA_THINKING` still read); on a 400 mentioning
  thinking we retry without the knob and remember that.
- **Why:** 2–3× faster with no accuracy loss on the 5 samples.

### D11 — Send the clean drawing *and* the set-of-marks image
- **Context:** with only the numbered image, cacti were twice labelled
  "pillar platform" (boxes clutter the shapes).
- **Decision:** image 1 = clean drawing (recognise), image 2 = numbered boxes
  (match ids). Native system + two images: cactus → hazard 3/3, cloud →
  platform 3/3, ≈10.5 s.

### D3 — Next 16 Cache Components stays on; no `runtime` export
- **Context:** `create-next-app` enabled `cacheComponents`, which forbids the
  `runtime` route segment export.
- **Decision:** omit `export const runtime = 'nodejs'` (Node is the default);
  GET handlers that read runtime data call `await connection()`;
  `/play/[id]` reads params inside `<Suspense>`.
- **Why:** keeps the framework defaults; Node runtime is guaranteed anyway.

### D4 — Vision pipeline is isomorphic and runs in a Web Worker
- **Decision:** `src/lib/vision/pipeline.ts` takes RGBA buffers, never the DOM.
  The browser runs it in a module worker (OpenCV.js eval'd from
  `/public/opencv/opencv.js`); scripts run the same code in Node.
- **Why:** the 10 MB OpenCV build doesn't jank the reveal animation, and the
  pipeline is testable headless (`pnpm test:vision`).
- **Gotcha:** the Emscripten module is a thenable that resolves to itself;
  never pass it to `resolve()` (see `cv-ready.ts`).

### D5 — Lines are split from doodles before grouping
- **Context:** people draw things standing on lines; plain connected
  components merged a cactus with the ground.
- **Decision:** extract long horizontal strokes with a morphological opening,
  then give a line back to a doodle when the doodle covers ≥75% of it, or when
  it is short with doodle ink at both ends (box edges: dog's back, cloud base).

### D6 — Live marks are cut out of the drawing
- **Decision:** enemies, pickups and the goal are cropped from the user's
  clean drawing into ink-only sprites and erased from the background; the
  drawn P is erased and replaced by the hero.
- **Why:** the user's own dog walks and their own $ disappears — the magic
  moment.

### D7 — `MODEL_PROVIDER=mock` for development
- **Decision:** a geometry-only labeller (`src/lib/ai/mock.ts`) so the loop can
  be built and tested without credentials. Health reports `mock`; the level
  says so in its story.
- **Why:** no Gemini key / Ollama on the build machine yet. Never use in production.

### D8 — Synthesized sound effects
- **Decision:** Web Audio oscillators/noise (`src/game/sfx.ts`) instead of
  audio files.
- **Why:** zero bytes, nothing to self-host, works offline; muted by default.

### D9 — One-way platforms
- **Decision:** platform bodies collide only from above (pass through from
  below/sides); sloped strokes become 6 px steps.
- **Why:** sketchy lines overlap and wobble; one-way surfaces never trap the
  hero.

### D12 — Measured shape facts beat prompt wording (zigzag vs trampoline)
- **Context:** the hatched trampoline (sample 02) read as "spikes", and a
  prompt tweak to fix it flipped sample 01's real spikes to "spring".
- **Decision:** the vision step measures each mark's top edge at full
  resolution; ≥4 swings of ≥60% of its height = `zigzag: true`, which the
  prompt lists next to the mark ("zigzag: sharp points up and down"). On the
  server, a mark labelled spikes that was measured *not* zigzag and has a
  flat-bar top becomes a trampoline (bouncy).
- **Why:** deterministic, explainable, and it fixed both directions:
  spikes 3/3 on samples 01/04/05, trampoline 3/3 on sample 02.

### D13 — Digital drawings: guard the paper detector, letterbox, drop frames
- **Context:** screenshots from drawing apps (no paper edge) were warped
  using the hull of a long ink band as "the sheet" (10× vertical stretch);
  canvas borders and sloped hills glued the P to everything else.
- **Decision:** white-fill uploads (transparent PNGs read as black); skip
  paper detection when ≥3 frame borders are bright; accept a quad only if
  it's sheet-shaped (aspect 0.45–2.4) and its sides lie on real edges; no
  paper → letterbox to 16:9 in paper colour (never crop). Drop long thin
  strips hugging the frame. Ground detection also opens at ±15°/±30°, and
  lines wider than 30% of the page are never absorbed into a doodle;
  strokes whose top edge keeps flipping (zigzags) are not ground.
- **Why:** the user's own drawings broke; samples kept identical marks.

### D14 — Intro film in code, not a video file
- **Decision:** GSAP timeline over inline SVG instead of `/intro.mp4`.
- **Why:** sharp at any size, a few KB, offline, themable, and the hero is
  the same character as in the game. Ctrl+Shift+R is the browser's hard
  reload and can't be intercepted, so "replay" = every full page load.

### D15 — Latency on Vercel is network, so hide it
- **Context:** fine on localhost, sluggish clicks in production. Pages come
  from Vercel's cache in 0.2–0.3 s; the real stall was Phaser (~315 KB gz)
  fetched only after "Play it", plus a cursor canvas repainting every frame.
- **Decision:** preload Phaser while idle on `/create`, prefetch the play
  route once Gemma answers, `useLinkStatus` wiggle on nav icons while a page
  loads; cursor renders only while moving (1× canvas), magnetic buttons
  use cached rects; the playground pauses off-screen; OpenCV and samples
  are cached for a day.

### D16 — Sketchbook look, light only
- **Context:** the violet "arcade notebook" theme read as generic and
  template-made: violet offset shadows, mono uppercase eyebrows over every
  heading, numbered steps on a dark band.
- **Decision:** warm marker-black ink (same family as the game canvas),
  dotted cream paper, hand-drawn corners, tape, sticker buttons with ink
  shadows, blue-ballpoint margin notes, torn-paper section edges. Dark mode
  removed. Favicon is the ink hero on a lime tile (`src/app/icon.svg`, plus
  generated `favicon.ico` and `apple-icon.png`).
- **Why:** it should feel like the paper you drew on, and a single theme
  means the drawings, the game and the site always match.

### D17 — Draw in the browser; no camera capture
- **Decision:** `/create` offers two inputs: a drawing canvas and photo
  upload. The canvas exports a 1600×900 single-ink PNG (same size and look
  as the samples) and goes through the unchanged OpenCV → Gemma pipeline.
  Templates and the working draft are kept in localStorage. Camera and
  webcam capture are gone.
- **Why:** people without paper or a good camera can still play, the
  server and model never need to know where the picture came from, and
  templates need no account or database (golden rule).


### D18 — Ink Arena: multiplayer on Supabase Realtime, additive
- **Decision:** a new `/arena` mode (Mini Militia-style: jetpack, autofire,
  respawn) next to the platformer, which is untouched. Transport is a
  Supabase Realtime channel `arena:<ROOM>` (broadcast for game traffic,
  presence for roster + kills/deaths); with no Supabase or `?local=1` it
  falls back to `BroadcastChannel` between tabs of one browser, so the
  offline demo still has multiplayer.
- **Netcode:** each client simulates itself and sends state at 10 Hz with
  the shots fired since the last tick; others are drawn 120 ms behind,
  interpolated. Bullets are simulated everywhere; the *victim* decides hits
  and broadcasts `die(killer)`. Map sync: whoever has the map answers
  `needmap` after a random delay; higher `round` wins.
- **Autofire:** Mini Militia rule: fires when an enemy is within ~24° of
  your aim, in range and in line of sight (ray vs platform rects). Mouse
  click still fires manually; touch aims at the nearest enemy.
- **Maps are data:** Gemma returns platforms/spawns/pickups (theme mode) or
  labels per mark (drawing mode); `src/lib/arena/schema.ts` clamps every
  number, adds a floor, lands spawns on platforms, and re-validates maps
  received from other players. Model failure → seeded procedural map, so
  `/api/arena/map` never blocks a room.
- **Login:** nickname + scarf colour; per-tab id so two tabs are two
  players. Supabase anonymous sign-in is attempted but is **disabled on the
  project** (422), so it's a guest id today; enable it in Supabase →
  Authentication → Sign In / Providers to get real anon users.
- **Why:** Vercel functions can't hold websockets; Realtime broadcast with
  the anon key measured ~50 ms between two clients (`pnpm test:realtime`).
  Gemma theme maps take ~23 s, drawing maps 8–11 s (`pnpm test:arena`).

### D19 — Arena v2: weapons, buffs, hazards, monsters, map options
- **Weapons** (`src/lib/arena/weapons.ts`, plain data): SMG (default,
  reloads), ink rifle, flamethrower, chainsaw (timed), rockets (splash),
  grenades (G / right-click / touch button, bounce, fuse). A shot carries
  only the weapon index and a damage multiplier; every client simulates it
  the same way and the victim looks the damage up.
- **Buffs:** shield (absorbs 60), speed, double jump, endless jet, double
  damage, all timed. W/Space now jumps on the ground and jetpacks when held.
- **Map:** hazards `lava | water (flow) | spikes`, `crumble` platforms that
  fall ~0.65 s after anyone stands on them and regrow, hostile enemies
  `walker | flyer | turret`. All clamped in `schema.ts` like before.
- **Monsters are host-simulated:** the earliest joiner moves them, shoots
  for them and decides hits on them (`npc` / `npcdie` messages); everyone
  else interpolates. Hits on players stay victim-authoritative.
- **Drawings:** a mark the vision step measured as a zigzag is *always*
  spikes (Gemma called one a platform). Gemma also returns `extras` in the
  drawing's style, and `growDrawing` mirrors the drawing and fills empty
  cells, so an upload becomes a full arena. The cleaned drawing travels
  with the map as a small JPEG backdrop so it lines up with the marks
  (the raw sample photo didn't, after paper flattening).
- **Map options** (monsters 0-8, pickups few/normal/lots, weapons, buffs,
  lava, water, spikes, crumble) go to Gemma as constraints and are then
  enforced by `applyOptions`, whatever the model did.
- **Realtime resilience:** heartbeats run in a worker (`realtime.worker`)
  and presence is re-tracked after a rejoin; a throttled background tab
  used to drop out of the room silently.

### D20 — Making multiplayer reliable
- **Symptom:** players vanished, and different viewers saw different players.
- **Found by testing** (3 headless bots + browser, `scripts/arena-bot.ts ROOM secs bots`):
  Realtime sockets do drop (1006 closes, and a "silent" death where the
  socket stays open but delivers nothing) and supabase-js did not always
  recover; sends then fell back to one REST call per message.
- **Fixes:**
  - transport watchdog (`net.ts`): rebuild channel *and socket* when the
    channel isn't joined for 4 s, when others are present but nothing has
    arrived for 6 s, or on returning to the tab; presence re-tracked after
    every join; 10 Hz state is dropped (not REST-posted) while disconnected.
    Measured: a silent break heals in ~7 s with a new socket.
  - players are added/removed by their own state messages, not presence
    (presence flaps); name, colour and map round ride in every message.
  - state from a different map round is ignored and triggers a map fetch.
  - sender timestamps + per-sender clock offset remove network jitter;
    remotes are drawn 150 ms behind.
  - hidden tabs keep sending ~1/s marked `away` (drawn faded, not
    targetable) instead of vanishing after 6 s.
  - monster state rides in the host's state message (half the traffic);
    the host is elected each frame from live players (earliest joiner not
    in a background tab), so a sleeping host hands over automatically.
- **Monsters:** first spawn after a 4 s grace (staggered), respawn after
  20 s at a random spot away from every player (Gemma picks kinds and
  count, not fixed spots); flyers collide with platforms.
- **Minimap** (live dots for you, players, monsters) and a see-through map
  maker so the arena stays visible behind it.
- Measured with 4 clients: 9.4 msgs/s per sender, max gap < 0.45 s.

### D21 — AI bots, and maps without overlaps
- **AI bots** (0-8, set in the map maker and live with `− bots N +` by any
  player): host-simulated with real Arcade bodies; they walk, jetpack over
  walls and away from lava/spikes, chase the nearest enemy (players, other
  bots, monsters), strafe at range and shoot an SMG with a wobble so they
  are beatable. Hits on bots are decided by the host; bot kills/deaths ride
  in the host's state message and show on everyone's scoreboard and feed.
  A room with one human and bots works offline too.
- **No overlapping elements** (`finalizeArena`): a floor is added first,
  then `separate()` keeps bigger platforms and moves a touching/overlapping
  one just above or below with fly-through room (~60 px / ~80 px), or drops
  it; cover standing on a platform snaps onto its top. Hazards don't stack,
  water stops at ledges and never swallows a platform, lava/spikes still
  inside a platform are dropped, crates keep apart. Checked on 300
  procedural maps: 0 overlapping pairs of any kind.
- Map rounds are timestamps, so a map made after a page reload always wins.

### D22 — Survival mode: a seeded endless runner
- `/survival` is a Subway Surfers-style runner in a new `SurvivalScene`. The
  hero moves forward at the run speed and the camera follows; chunks are
  built ~2 screens ahead and destroyed behind, so the object count stays
  flat on long runs.
- Chunks are data (`src/lib/survival/schema.ts`), generated from the run
  seed and chunk index alone (`procedural.ts`). `finalizeChunk` clamps for
  the speed the runner will have on arrival: gaps ≤ 62% and hazards ≤ 55%
  of a full jump, ~0.5 s of landing room between dangers, hazards/beams/
  ground mobs only on solid ground, solid seams. A scripted bot that only
  reacts to what is just ahead survives to top speed, so tracks are fair.
- No model in the loop on purpose: the runner must work offline and with
  no Supabase. A Gemma-themed chunk set can plug into `finalizeChunk` later.
- Hearts heal, so HP replaces lives; a pit costs 25 HP and lifts you onto the
  next solid ground rather than ending the run.
- Key presses use `JustDown` (latched) so a tap shorter than a frame still
  jumps; touch is tap/swipe-up to jump and swipe-down to slide.

### D23 — Pre-launch hardening
- **Peers are untrusted.** Anyone with the public anon key can join a
  Realtime channel, so every arena message (broadcast, presence and the
  `BroadcastChannel` fallback) is parsed by `src/lib/arena/wire.ts` before
  it touches game state: bounded finite numbers, short names, hex colours,
  capped arrays (shot lists are trimmed, not rejected). A receive-side
  flood guard drops more than 40 messages/s from one sender or 400/s in
  total, and the scene caps remote players (16) and projectiles (800).
  Cheating (claiming kills, a forged join time to become host) is still
  possible by design; crashes and freezes are not.
- **Security headers without nonces.** Pages are static / partially
  prerendered, so a nonce CSP would force every page dynamic. The CSP
  allows `'unsafe-inline'` scripts (Next's bootstrap) and `'unsafe-eval'` +
  `'wasm-unsafe-eval'` (the vision worker evaluates OpenCV.js and its
  WebAssembly), and pins everything else: `connect-src` is self + the
  Supabase project, `frame-ancestors 'none'`, `object-src 'none'`. Plus
  nosniff, Referrer-Policy, Permissions-Policy and HSTS.
- **Client-reported run stats** are limited per IP (30 runs/min, 6 per
  level/min) and "wins" under a second aren't counted. They stay cosmetic:
  the gallery's plays/wins/best time are for fun, not a leaderboard.
- **Rate limiter** stays in memory per instance (Vercel's firewall is the
  durable layer), but it no longer clears all keys at 5000: it evicts
  unthrottled keys first, so a flood of new IPs can't reset everyone.
- **Model text** stored in the gallery is capped in characters (not only
  words) and links are stripped; it is only ever rendered as React text.
- **Bodies** are read with a size cap (`src/lib/read-json.ts`) because a
  self-hosted `next start` has no platform body limit.

### D24 — Room chat in Ink Arena

- **Same pipe as the game.** Chat is one more `NetMsg` (`t: 'chat'`) on the
  room transport, so it works online (Realtime broadcast) and offline
  (`BroadcastChannel`) with no server, no table and no history: a line
  lives only in the browsers that were in the room.
- **Untrusted twice.** `wire.ts` checks the shape and length;
  `src/lib/arena/chat.ts` `cleanChat` then strips control, zero-width and
  bidi characters, caps at 120 chars, turns links into `[link]` and masks
  common swears (a short list, matched across dots and repeats; the odd
  false positive like "shitake" is accepted). Text is only ever rendered
  as React text or a Phaser text object.
- **Only the roster talks.** A line is shown only if its sender id is on
  the room's presence roster, and the name and colour come from the roster
  (whose names get the same cleaning), never from the message. Speech
  bubbles are only drawn over players actually in the arena.
- **Rate limits.** Senders hold themselves to 5 lines per 8 s, 0.5 s apart;
  receivers drop a sender past 6 per 8 s and the whole room past 20 per
  8 s, on top of the transport's flood guard. Any player can be muted
  locally from the open chat log. No server-side moderation, by design.
- **Impersonation is possible.** Like state messages, a chat line's sender
  id is self-declared, so a crafted client can post as someone on the
  roster. Fixing that needs a server that knows who sent what (a relay, or
  Realtime private channels with per-user auth); out of scope for a
  serverless room. Muting works per id, so it also mutes the person being
  impersonated (until you leave the room or unmute).
- **Keyboard hand-off.** Phaser captures W/A/D/Space page-wide, which
  would eat them in any text box. While a text input in the room has
  focus the scene disables its keyboard and global capture (`typing` bus
  event), and resets held keys so the player doesn't keep running. A new
  map builds a new game, which checks for a focused text box at start.
- **Emotes and quick comments.** Ten emotes (keys 1 to 9 and 0, or the
  chat panel) and ten one-tap comments. An emote is just a chat line made
  only of emoji, so it needs no new message type, rides the same cleaning
  and rate limits, and works offline (system emoji font, no assets). Lines
  that are only emoji pop up big over the player instead of a speech
  bubble. The cleaner keeps the zero-width joiner only between two emoji,
  so sequences like a heart on fire survive while hidden joiners in text
  are still stripped.
