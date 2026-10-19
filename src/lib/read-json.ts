import 'server-only';

/**
 * `req.json()` with a size cap. Vercel already refuses bodies over 4.5 MB,
 * but a self-hosted `next start` buffers whatever it is sent, so stop
 * reading as soon as the body is bigger than the route could ever accept.
 * Resolves to `undefined` for an oversized or malformed body.
 */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}
