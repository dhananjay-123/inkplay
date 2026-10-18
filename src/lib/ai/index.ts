import 'server-only';
import { ApiError, GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';
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
   * Gemini only. Phase 1 verified Gemma 4 accepts systemInstruction (and it
   * is faster), so it defaults on. JSON mode wraps output in an array and
   * stays off. scripts/test-model.ts --probe re-checks both.
   */
  nativeSystemInstruction?: boolean;
  jsonMode?: boolean;
  timeoutMs?: number;
  /** MODEL_PROVIDER=mock: produce the "model output" without a model. */
  mock?: () => unknown;
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
    if (start < 0 || end <= start) throw new Error('no JSON object found in model output');
    const slice = body.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      // Gemma sometimes writes a flag rule as {"kind": "night_mode": null}.
      const repaired = slice.replace(/("kind"\s*:\s*"[a-z_]+")\s*:\s*(?:null|true|false|"[^"]*"|-?[\d.]+)/g, '$1');
      if (repaired === slice) throw e;
      return JSON.parse(repaired);
    }
  }
}

/** Some modes wrap the object in a one-item array: `[{...}]`. */
function unwrap(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object' ? v[0] : v;
}

/* ---------------- providers ---------------- */

let gemini: GoogleGenAI | null = null;
/** Set once a model rejects thinkingConfig, so we stop sending it. */
let thinkingUnsupported = false;

async function callGemini(opts: GenerateOptions<unknown>, extra: string): Promise<string> {
  try {
    return await callGeminiOnce(opts, extra, env.GEMMA_THINKING === 'minimal' && !thinkingUnsupported);
  } catch (e) {
    // Transient 5xx from the API: one quick retry if time allows.
    if (e instanceof AIError && e.code === 'unavailable' && (opts.timeoutMs ?? 55_000) > 15_000) {
      await new Promise((r) => setTimeout(r, 700));
      return callGeminiOnce({ ...opts, timeoutMs: (opts.timeoutMs ?? 55_000) - 2_000 }, extra, env.GEMMA_THINKING === 'minimal' && !thinkingUnsupported);
    }
    // Gemma 4 thinks for ~1k hidden tokens by default (20s+ per call); MINIMAL
    // removes that. Models without the knob answer 400 — retry without it.
    if (e instanceof AIError && e.code === 'misconfigured' && /thinking/i.test(e.detail ?? '')) {
      thinkingUnsupported = true;
      return callGeminiOnce(opts, extra, false);
    }
    throw e;
  }
}

async function callGeminiOnce(opts: GenerateOptions<unknown>, extra: string, minimalThinking: boolean): Promise<string> {
  if (!env.GEMINI_API_KEY || !env.GEMMA_CLOUD_MODEL) {
    throw new AIError('misconfigured', 'GEMINI_API_KEY and GEMMA_CLOUD_MODEL must be set for MODEL_PROVIDER=gemini');
  }
  gemini ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const native = opts.nativeSystemInstruction ?? true;
  const text = native ? opts.prompt + extra : `${opts.system}\n\n---\n\n${opts.prompt}${extra}`;
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
        ...(native ? { systemInstruction: opts.system } : {}),
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        ...(minimalThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
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
  const call =
    which === 'ollama'
      ? callOllama
      : which === 'mock'
        ? async (o: GenerateOptions<unknown>) => {
            if (!o.mock) throw new AIError('misconfigured', 'mock provider has no fixture for this call');
            return JSON.stringify(o.mock());
          }
        : callGemini;
  const started = performance.now();
  const budget = opts.timeoutMs ?? (which === 'ollama' ? 120_000 : 55_000);
  let extra = '';
  let lastError = '';
  let raw = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = Math.floor(budget - (performance.now() - started));
    if (left < 8_000) break; // no time for a meaningful retry
    raw = await call({ ...(opts as GenerateOptions<unknown>), timeoutMs: left }, extra);
    try {
      const parsed = opts.schema.safeParse(unwrap(extractJSON(raw)));
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
  if (which === 'mock') return { reachable: true, detail: 'mock provider (dev only)' };
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
