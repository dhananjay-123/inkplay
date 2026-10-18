import Link from 'next/link';

export const metadata = { title: 'How INKPLAY works' };

const PIPELINE = [
  { where: 'your browser', what: 'OpenCV.js finds the paper, flattens it, cleans the ink and numbers every mark.', tag: 'web worker' },
  { where: 'Gemma 4', what: 'Reads the clean drawing + the numbered copy. Labels each mark, turns margin words into rules, names the level.', tag: 'cloud or laptop' },
  { where: 'the server', what: 'Validates the JSON, clamps every number, then a fixer makes sure the level has a player, a goal and a path.', tag: 'zod + BFS' },
  { where: 'Phaser', what: 'Your drawing becomes the world. Bodies sit on your ink; your enemies and coins are cut out of the page and come alive.', tag: 'arcade physics' },
  { where: 'Gemma 4, again', what: 'Watches your stats and writes a two-line review. Canned lines step in if the model is busy.', tag: 'the critic' },
] as const;

const ARENA = [
  { where: 'Gemma 4, the map maker', what: 'Lays out platforms, hazards, spawns, crates and monsters from a theme, from your drawing, or on its own. Your options (bots, pickups, weapons, hazards) go in as constraints.', tag: 'arena designer' },
  { where: 'the server', what: 'Clamps every number, pulls overlapping pieces apart, keeps hazards reachable and spawns off them. If the model is slow, a seeded procedural map steps in, so a room never waits.', tag: 'zod + cleanup' },
  { where: 'Supabase Realtime', what: 'One channel per room. Each player simulates themself and sends their state ten times a second; everyone else draws them 150 ms behind, smoothed. The player who gets hit decides the hit.', tag: 'broadcast + presence' },
  { where: 'the host', what: 'The earliest joiner still playing runs the monsters and the AI bots. If they leave, the next player takes over. A watchdog rebuilds a dead connection.', tag: 'no game server' },
] as const;

const SURVIVAL = [
  { where: 'a seeded generator', what: 'Lays out each chunk of track from the run seed: gaps, spikes, lava, crumbling floors, beams to slide under, ledges, mobs and pickups. It gets denser as the run speeds up.', tag: 'no model needed' },
  { where: 'the clamps', what: 'Chunks are data, checked like levels and maps: gaps and hazards stay within a jump at the current speed, there is room to land between dangers, and every seam is solid ground.', tag: 'zod + cleanup' },
  { where: 'Phaser', what: 'Streams chunks in ahead of you and drops them behind, so the page never ends. HP, invulnerability flashes, stomps and power-ups run in the browser.', tag: 'arcade physics' },
] as const;

const HONEST = [
  { q: 'Is it always right?', a: 'No. A hatched trampoline sometimes reads as spikes. The set-of-marks reveal shows exactly what Gemma thought, so you can redraw.' },
  { q: 'Can the model run code?', a: 'Never. It picks from a fixed list of rule types; anything else is dropped and every number is clamped.' },
  { q: 'How fast?', a: 'About 10–30 s in the cloud (median ≈ 13 s). Offline speed depends on the laptop.' },
  { q: 'Does it need an account or database?', a: 'No. The gallery and online arena rooms use Supabase when it is configured; draw, play and review never touch it. Without it, the arena plays between tabs of one browser.' },
  { q: 'Can I play the arena alone?', a: 'Yes. Add up to 8 AI bots. They fly, dodge lava and shoot everyone, including each other.' },
] as const;

export default function AboutPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-8">
      <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">
        How INKPLAY <span className="highlight">works</span>
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-graphite">
        OpenCV does the geometry. Gemma does the understanding. Your pen does everything else.
      </p>

      <Timeline steps={PIPELINE} className="mt-14" />

      <h2 className="font-display mt-10 text-3xl font-extrabold tracking-tight sm:text-5xl">
        And the <span className="highlight">arena</span>
      </h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        Ink Arena is the same sketchbook as a jetpack shooter for a whole room. Start a room, share the code, and everyone plays one map live.
      </p>
      <Timeline steps={ARENA} className="mt-10" />

      <h2 className="font-display mt-10 text-3xl font-extrabold tracking-tight sm:text-5xl">
        And <span className="highlight">survival</span>
      </h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        An endless runner on the same sketchbook page, playable with a keyboard or with taps and swipes on a phone. It needs no model and no
        network, so it is the same game on the stage laptop in airplane mode.
      </p>
      <Timeline steps={SURVIVAL} className="mt-10" />

      <h2 className="font-display mt-10 text-3xl font-extrabold tracking-tight sm:text-5xl">Why an open model</h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        The same Gemma 4 family serves the public site through the Gemini API and runs on a laptop through Ollama with no internet at all. A
        classroom, a hackathon stage or a train with no signal gets the same game, arena included. The weights are open, so is this code (MIT).
      </p>

      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-5xl">Honest answers</h2>
      <dl className="mt-6 divide-y-2 divide-dashed divide-ink/10 border-y-2 border-dashed border-ink/10">
        {HONEST.map((h) => (
          <div key={h.q} className="grid gap-2 py-5 sm:grid-cols-[260px_1fr]">
            <dt className="font-hand text-2xl">{h.q}</dt>
            <dd className="text-lg text-graphite">{h.a}</dd>
          </div>
        ))}
      </dl>

      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-5xl">Credits</h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        Gemma 4 by Google DeepMind · OpenCV.js · Phaser 3 · Next.js · Rough.js · Ollama · Supabase (Postgres, Storage, Realtime). Type: Bricolage Grotesque, Kalam, JetBrains
        Mono. Built for Hacktoberfest Hack Day Gwalior × ABV-IIITM IEEE.
      </p>

      <Link href="/create" className="btn-game mt-12 px-6 py-3.5 text-lg">
        Start drawing
      </Link>
    </section>
  );
}

function Timeline({ steps, className }: { steps: ReadonlyArray<{ where: string; what: string; tag: string }>; className: string }) {
  return (
    <ol className={className}>
      {steps.map((s, i) => (
        <li key={s.where} className="relative grid gap-2 border-l-[3px] border-dashed border-ink/25 pb-10 pl-10 last:border-transparent sm:grid-cols-[190px_1fr]">
          <span className="circled font-hand absolute -top-1 -left-[20px] h-9 w-9 bg-paper text-lg text-pop">{i + 1}</span>
          <div>
            <p className="font-display text-xl font-bold">{s.where}</p>
            <p className="font-hand mt-0.5 text-base text-graphite">{s.tag}</p>
          </div>
          <p className="text-lg">{s.what}</p>
        </li>
      ))}
    </ol>
  );
}
