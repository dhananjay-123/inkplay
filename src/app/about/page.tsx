import Link from 'next/link';

export const metadata = { title: 'How INKPLAY works' };

const PIPELINE = [
  { where: 'your browser', what: 'OpenCV.js finds the paper, flattens it, cleans the ink and numbers every mark.', tag: 'web worker' },
  { where: 'Gemma 4', what: 'Reads the clean drawing + the numbered copy. Labels each mark, turns margin words into rules, names the level.', tag: 'cloud or laptop' },
  { where: 'the server', what: 'Validates the JSON, clamps every number, then a fixer makes sure the level has a player, a goal and a path.', tag: 'zod + BFS' },
  { where: 'Phaser', what: 'Your drawing becomes the world. Bodies sit on your ink; your enemies and coins are cut out of the page and come alive.', tag: 'arcade physics' },
  { where: 'Gemma 4, again', what: 'Watches your stats and writes a two-line review. Canned lines step in if the model is busy.', tag: 'the critic' },
] as const;

const HONEST = [
  { q: 'Is it always right?', a: 'No. A hatched trampoline sometimes reads as spikes. The set-of-marks reveal shows exactly what Gemma thought, so you can redraw.' },
  { q: 'Can the model run code?', a: 'Never. It picks from a fixed list of rule types; anything else is dropped and every number is clamped.' },
  { q: 'How fast?', a: 'About 10–30 s in the cloud (median ≈ 13 s). Offline speed depends on the laptop.' },
  { q: 'Does it need an account or database?', a: 'No. The gallery uses Supabase when it is configured; draw, play and review never touch it.' },
] as const;

export default function AboutPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-8">
      <p className="label text-graphite">about</p>
      <h1 className="font-display mt-3 text-5xl font-extrabold tracking-tight sm:text-7xl">How INKPLAY works</h1>
      <p className="font-hand mt-4 max-w-2xl text-xl text-graphite">
        OpenCV does the geometry. Gemma does the understanding. Your pen does everything else.
      </p>

      <ol className="mt-14 space-y-0">
        {PIPELINE.map((s, i) => (
          <li key={s.where} className="relative grid gap-2 border-l-2 border-dashed border-ink/25 pb-10 pl-8 sm:grid-cols-[180px_1fr]">
            <span className="absolute top-0 -left-[13px] grid h-6 w-6 place-items-center rounded-full bg-ink font-mono text-[0.65rem] text-paper">{i + 1}</span>
            <div>
              <p className="font-display text-xl font-bold">{s.where}</p>
              <p className="label mt-1 text-[0.6rem] text-graphite">{s.tag}</p>
            </div>
            <p className="text-lg">{s.what}</p>
          </li>
        ))}
      </ol>

      <h2 className="font-display mt-10 text-3xl font-extrabold tracking-tight sm:text-5xl">Why an open model</h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        The same Gemma 4 family serves the public site through the Gemini API and runs on a laptop through Ollama with no internet at all. A
        classroom, a hackathon stage or a train with no signal gets the same game. The weights are open, so is this code (MIT).
      </p>

      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-5xl">Honest answers</h2>
      <dl className="mt-6 divide-y divide-ink/10 border-y border-ink/10">
        {HONEST.map((h) => (
          <div key={h.q} className="grid gap-2 py-5 sm:grid-cols-[260px_1fr]">
            <dt className="font-hand text-2xl">{h.q}</dt>
            <dd className="text-lg text-graphite">{h.a}</dd>
          </div>
        ))}
      </dl>

      <h2 className="font-display mt-16 text-3xl font-extrabold tracking-tight sm:text-5xl">Credits</h2>
      <p className="mt-4 max-w-3xl text-lg text-graphite">
        Gemma 4 by Google DeepMind · OpenCV.js · Phaser 3 · Next.js · Rough.js · Ollama · Supabase. Type: Bricolage Grotesque, Kalam, JetBrains
        Mono. Built for Hacktoberfest Hack Day Gwalior × ABV-IIITM IEEE.
      </p>

      <Link href="/create" className="label mt-12 inline-block rounded-full bg-ink px-6 py-4 text-paper">
        Start drawing →
      </Link>
    </section>
  );
}
