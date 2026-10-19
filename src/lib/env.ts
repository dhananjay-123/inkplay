import 'server-only';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  MODEL_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['gemini', 'ollama', 'mock']).default('gemini')),
  GEMINI_API_KEY: optionalString,
  /** Exact model id for the Gemini API provider. */
  CLOUD_MODEL: optionalString,
  /** minimal = fast (default); default = let the model think (slow, ~20s+). */
  MODEL_THINKING: z.preprocess(emptyToUndefined, z.enum(['minimal', 'default']).default('minimal')),
  OLLAMA_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://127.0.0.1:11434')),
  OLLAMA_MODEL: z.preprocess(emptyToUndefined, z.string().default('gemma4:e4b')),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;
export type Provider = Env['MODEL_PROVIDER'];

function load(): Env {
  // GEMMA_CLOUD_MODEL / GEMMA_THINKING are the old names; still honoured so
  // existing deployments keep working.
  const raw = {
    ...process.env,
    CLOUD_MODEL: process.env.CLOUD_MODEL || process.env.GEMMA_CLOUD_MODEL,
    MODEL_THINKING: process.env.MODEL_THINKING || process.env.GEMMA_THINKING,
  };
  const parsed = EnvSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Fail loudly in logs but keep the app booting: a bad optional var should
  // never take the core loop down. Drop only the invalid keys, so a typo in
  // OLLAMA_URL doesn't also throw away GEMINI_API_KEY and Supabase.
  console.error('[env] invalid environment:', z.prettifyError(parsed.error));
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  const kept = Object.fromEntries(Object.entries(raw).filter(([k]) => !bad.has(k)));
  return EnvSchema.parse(kept);
}

export const env = load();

export const provider: Provider = env.MODEL_PROVIDER;

/** Server-side Supabase (service role) is usable. */
export const hasSupabase = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
);

export function modelName(): string {
  if (provider === 'mock') return 'mock (no model)';
  return provider === 'ollama' ? env.OLLAMA_MODEL : env.CLOUD_MODEL ?? '(CLOUD_MODEL not set)';
}
