import 'server-only';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  MODEL_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['gemini', 'ollama', 'mock']).default('gemini')),
  GEMINI_API_KEY: optionalString,
  GEMMA_CLOUD_MODEL: optionalString,
  OLLAMA_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://127.0.0.1:11434')),
  OLLAMA_MODEL: z.preprocess(emptyToUndefined, z.string().default('gemma4:e4b')),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;
export type Provider = Env['MODEL_PROVIDER'];

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loudly in logs but keep the app booting: a bad optional var
    // should never take the core loop down.
    console.error('[env] invalid environment:', z.prettifyError(parsed.error));
    return EnvSchema.parse({});
  }
  return parsed.data;
}

export const env = load();

export const provider: Provider = env.MODEL_PROVIDER;

/** Server-side Supabase (service role) is usable. */
export const hasSupabase = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
);

export function modelName(): string {
  if (provider === 'mock') return 'mock (no model)';
  return provider === 'ollama' ? env.OLLAMA_MODEL : env.GEMMA_CLOUD_MODEL ?? '(GEMMA_CLOUD_MODEL not set)';
}
