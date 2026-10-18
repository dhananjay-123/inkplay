import { connection } from 'next/server';
import { checkModel } from '@/lib/ai';
import { hasSupabase, modelName, provider } from '@/lib/env';

export type Health = {
  provider: typeof provider;
  model: string;
  modelReachable: boolean;
  detail?: string;
  hasSupabase: boolean;
};

export async function GET() {
  await connection(); // runtime data: never prerender
  const model = await checkModel();
  const body: Health = {
    provider,
    model: modelName(),
    modelReachable: model.reachable,
    detail: model.detail,
    hasSupabase,
  };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
