import Link from 'next/link';

export default function Home() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-8">
      <p className="label text-graphite">Gemma 4 · paper to playable</p>
      <h1 className="font-display mt-4 text-[clamp(4rem,16vw,13rem)] leading-[0.85] font-extrabold tracking-[-0.04em]">INKPLAY</h1>
      <p className="font-display mt-6 max-w-xl text-2xl sm:text-3xl">
        Draw it. <span className="highlight">Write the rules.</span> Play it.
      </p>
      <div className="mt-10">
        <Link href="/create" className="label inline-flex items-center gap-2 rounded-full bg-ink px-6 py-4 text-paper">
          Start drawing →
        </Link>
      </div>
    </section>
  );
}
