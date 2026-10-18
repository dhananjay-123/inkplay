import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PlayScreen } from '@/components/game/play-screen';
import { getLevel } from '@/lib/supabase/server';

export const metadata = { title: 'Play' };

export default function PlaySavedPage(props: PageProps<'/play/[id]'>) {
  return (
    <Suspense fallback={<p className="font-hand p-10 text-center text-2xl text-graphite">Fetching the doodle…</p>}>
      <SavedLevel params={props.params} />
    </Suspense>
  );
}

async function SavedLevel({ params }: { params: PageProps<'/play/[id]'>['params'] }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const saved = await getLevel(id);
  if (!saved) notFound();
  return <PlayScreen data={{ id: saved.id, level: saved.level, marks: saved.marks, image: saved.imageUrl }} />;
}
