import 'server-only';
import { ApiError, GoogleGenAI, type Part } from '@google/genai';
import { z } from 'zod';
import { env, provider as defaultProvider, type Provider } from '@/lib/env';

export type GenerateOptions<T> = {
  system: string;
  prompt: string;
  /** Base64 JPEG (no data: prefix, or with — both accepted). */
  images?: string[];
  /** Validates (and may transform) the parsed JSON. */
  schema: z.ZodType<T>;
  /** JSON Schema used to constrain Ollama's output. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  provider?: Provider;
  /**
   * Gemini only. Gemma on the Gemini API is not assumed to support these, so
   * both default off; scripts/test-model.ts probes them.
   */
  nativeSystemInstruction?: boolean;
  jsonMode?: boolean;
  timeoutMs?: number;
};

export type AIErrorCode = 'rate_limited' | 'unavailable' | 'bad_output' | 'misconfigured' | 'timeout';

export class AIError extends Error {
  constructor(
    public code: AIErrorCode,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

const stripDataUrl = (b64: string) => b64.replace(/^data:[^;]+;base64,/, '');

/** Strip code fences / prose and pull out the first JSON object. */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error('no JSON object found in model output');
  }
}

/* ---------------- providers ---------------- */

let gemini: GoogleGenAI | null = null;

async function callGemini(opts: GenerateOptions<unknown>, extra: string): Promise<string> {
  if (!env.GEMINI_API_KEY || !env.GEMMA_CLOUD_MODEL) {
    throw new AIError('misconfigured', 'GEMINI_API_KEY and GEMMA_CLOUD_MODEL must be set for MODEL_PROVIDER=gemini');
  }
  gemini ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const text = opts.nativeSystemInstruction ? opts.prompt + extra : `${opts.system}\n\n---\n\n${opts.prompt}${extra}`;
  const parts: Part[] = [
    ...(opts.images ?? []).map((data) => ({ inlineData: { mimeType: 'image/jpeg', data: stripDataUrl(data) } })),
    { text },
  ];
  try {
    const res = await gemini.models.generateContent({
      model: env.GEMMA_CLOUD_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.nativeSystemInstruction ? { systemInstruction: opts.system } : {}),
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 55_000),
      },
    });
    const out = res.text;
    if (!out) throw new AIError('bad_output', 'Gemma returned an empty response');
    return out;
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e instanceof ApiError) {
      if (e.status === 429) throw new AIError('rate_limited', 'Gemma is catching its breath', e.message);
      if (e.status >= 500) throw new AIError('unavailable', 'Gemma is unavailable right now', e.message);
      throw new AIError('misconfigured', `Gemini API error ${e.status}`, e.message);
    }
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
      throw new AIError('timeout', 'Gemma took too long to answer');
    }
    throw new AIError('unavailable', 'Could not reach the Gemini API', String(e));
  }
}

async function callOllama(opts: GenerateOptions<unknown>, extra: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: opts.jsonSchema ?? 'json',
        options: { temperature: opts.temperature ?? 0.2 },
        messages: [
          { role: 'system', content: opts.system },
          {
            role: 'user',
            content: opts.prompt + extra,
            ...(opts.images?.length ? { images: opts.images.map(stripDataUrl) } : {}),
          },
        ],
      }),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
      throw new AIError('timeout', 'Local Gemma took too long to answer');
    }
    throw new AIError('unavailable', `Ollama is not reachable at ${env.OLLAMA_URL}`, String(e));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AIError(res.status === 404 ? 'misconfigured' : 'unavailable', `Ollama error ${res.status}`, body.slice(0, 500));
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const out = data.message?.content;
  if (!out) throw new AIError('bad_output', 'Ollama returned an empty response');
  return out;
}

/* ---------------- public API ---------------- */

export type GenerateResult<T> = { data: T; ms: number; attempts: number; raw: string };

/**
 * Call the configured model, parse JSON defensively and validate it.
 * Retries once with the validation error appended.
 */
export async function generateJSON<T>(opts: GenerateOptions<T>): Promise<GenerateResult<T>> {
  const which = opts.provider ?? defaultProvider;
  const call = which === 'ollama' ? callOllama : callGemini;
  const started = performance.now();
  let extra = '';
  let lastError = '';
  let raw = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    raw = await call(opts as GenerateOptions<unknown>, extra);
    try {
      const parsed = opts.schema.safeParse(extractJSON(raw));
      if (parsed.success) {
        const ms = Math.round(performance.now() - started);
        console.info(`[ai] ${which} ok in ${ms}ms (attempt ${attempt})`);
        return { data: parsed.data, ms, attempts: attempt, raw };
      }
      lastError = z.prettifyError(parsed.error);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    console.warn(`[ai] ${which} attempt ${attempt} invalid: ${lastError.slice(0, 300)}`);
    extra =
      `\n\nYour previous answer was invalid:\n${lastError.slice(0, 800)}\n` +
      'Reply again with ONLY the corrected JSON object. No prose, no code fences.';
  }
  throw new AIError('bad_output', 'Gemma doodled outside the lines', lastError);
}

export async function checkModel(which: Provider = defaultProvider): Promise<{ reachable: boolean; detail?: string }> {
  if (which === 'ollama') {
    try {
      const res = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
      if (!res.ok) return { reachable: false, detail: `ollama ${res.status}` };
      const tags = (await res.json()) as { models?: { name: string }[] };
      const has = tags.models?.some((m) => m.name === env.OLLAMA_MODEL || m.name === `${env.OLLAMA_MODEL}:latest`);
      return has ? { reachable: true } : { reachable: false, detail: `model ${env.OLLAMA_MODEL} not pulled` };
    } catch {
      return { reachable: false, detail: 'ollama not running' };
    }
  }
  // Don't spend Gemini quota on health checks: config presence only.
  if (!env.GEMINI_API_KEY || !env.GEMMA_CLOUD_MODEL) return { reachable: false, detail: 'gemini not configured' };
  return { reachable: true };
}
