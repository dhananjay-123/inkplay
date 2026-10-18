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
      <p className="label text-graphite">gallery</p>
      <h1 className="font-display mt-3 text-5xl font-extrabold tracking-tight sm:text-7xl">Hall of Doodles</h1>
      <p className="font-hand mt-4 max-w-xl text-xl text-graphite">
        Every level here started as ink on paper. Pick one and play someone else&apos;s imagination.
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
      <div className="mt-12 columns-1 gap-6 sm:columns-2 lg:columns-3">
        {levels.map((l, i) => (
          <DoodleCard key={l.id} level={l} index={i} />
        ))}
      </div>
      <nav className="mt-8 flex justify-between">
        {page > 0 ? (
          <Link href={`/gallery?page=${page - 1}`} className="label text-graphite hover:text-ink">
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {levels.length === PAGE_SIZE && (
          <Link href={`/gallery?page=${page + 1}`} className="label text-graphite hover:text-ink">
            Older →
          </Link>
        )}
      </nav>
    </>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <div className="mt-12 rounded-sm border-2 border-dashed border-graphite/40 px-6 py-16 text-center">
      <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</p>
      <p className="font-hand mt-3 text-xl text-graphite">Draw a level and play it right now. No account, no database.</p>
      <Link href="/create" className="label mt-8 btn-game px-6 py-4">
        Start drawing →
      </Link>
    </div>
  );
}
