import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DoodleCard } from '@/components/gallery/doodle-card';
import { hasSupabase } from '@/lib/env';
import { listLevels } from '@/lib/supabase/server';

export const metadata = { title: 'Hall of Doodles' };

const PAGE_SIZE = 24;

export default function GalleryPage(props: PageProps<'/gallery'>) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
      <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">
        Hall of <span className="highlight">Doodles</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg text-graphite">
        Every level here started as ink on someone&apos;s paper. Pick one and play it.
      </p>
      <Suspense fallback={<p className="font-hand mt-12 text-2xl text-graphite">Flipping through the notebook…</p>}>
        <Wall searchParams={props.searchParams} />
      </Suspense>
    </section>
  );
}

async function Wall({ searchParams }: { searchParams: PageProps<'/gallery'>['searchParams'] }) {
  await connection();
  if (!hasSupabase) return <Empty title="The gallery is offline. The game isn't." />;

  const raw = (await searchParams).page;
  const page = Math.max(0, Math.min(500, Number(Array.isArray(raw) ? raw[0] : raw) || 0));
  const levels = await listLevels(page, PAGE_SIZE);
  if (!levels.length) {
    return page > 0 ? <Empty title="That's the last page of the notebook." /> : <Empty title="No doodles yet. Be the first." />;
  }

  return (
    <>
      <div className="mt-14 columns-1 gap-8 sm:columns-2 lg:columns-3">
        {levels.map((l, i) => (
          <DoodleCard key={l.id} level={l} index={i} />
        ))}
      </div>
      <nav className="mt-8 flex justify-between">
        {page > 0 ? (
          <Link href={`/gallery?page=${page - 1}`} className="btn-ghost btn-sm px-4 py-1.5">
            Newer
          </Link>
        ) : (
          <span />
        )}
        {levels.length === PAGE_SIZE && (
          <Link href={`/gallery?page=${page + 1}`} className="btn-ghost btn-sm px-4 py-1.5">
            Older
          </Link>
        )}
      </nav>
    </>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <div className="mt-12 rounded-[var(--wobble)] border-2 border-dashed border-graphite/50 bg-card/60 px-6 py-16 text-center">
      <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</p>
      <p className="font-hand mt-3 text-xl text-graphite">Draw a level and play it right now. No account, no database.</p>
      <Link href="/create" className="btn-game mt-8 px-6 py-3.5 text-lg">
        Start drawing
      </Link>
    </div>
  );
}
