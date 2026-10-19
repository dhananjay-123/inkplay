import 'server-only';

/**
 * Best-effort, per-instance sliding-window limiter. Serverless instances do
 * not share memory, so this only blunts bursts against one instance; the
 * provider's own quota (and the host's firewall) is the real ceiling.
 */
const hits = new Map<string, { ts: number[]; limit: number; windowMs: number }>();
const MAX_KEYS = 5000;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const recent = (hits.get(key)?.ts ?? []).filter((t) => now - t < windowMs);
  // Re-insert so the Map stays ordered from least to most recently seen.
  hits.delete(key);
  if (recent.length >= limit) {
    hits.set(key, { ts: recent, limit, windowMs });
    return { ok: false, retryAfterS: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, { ts: recent, limit, windowMs });
  if (hits.size > MAX_KEYS) evict(now);
  return { ok: true, retryAfterS: 0 };
}

/**
 * Bound memory on long-lived instances. Never clears everything: that would
 * let a flood of new keys reset everyone else's limit. Keys that are not
 * currently limited go first (forgetting them changes nothing), then the
 * least recently seen.
 */
function evict(now: number) {
  const target = MAX_KEYS * 0.9;
  for (const [key, h] of hits) {
    if (hits.size <= target) return;
    const live = h.ts.filter((t) => now - t < h.windowMs).length;
    if (live < h.limit) hits.delete(key);
  }
  for (const key of hits.keys()) {
    if (hits.size <= target) return;
    hits.delete(key);
  }
}

/**
 * Client IP. On Vercel the platform sets x-forwarded-for / x-real-ip itself,
 * so the first hop is trustworthy. Self-hosted behind no proxy, these headers
 * are client-controlled: put a proxy in front that overwrites them.
 */
export function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
