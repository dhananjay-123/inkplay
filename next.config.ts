import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Supabase (gallery images, Realtime rooms) is the only other origin the
 * browser talks to. Static pages can't carry a nonce, so scripts allow
 * 'unsafe-inline' (Next's own bootstrap); see docs/DECISIONS.md.
 */
function supabaseOrigins(): string[] {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [u.origin, `wss://${u.host}`];
  } catch {
    return [];
  }
}

const supabase = supabaseOrigins();
const csp = [
  "default-src 'self'",
  // 'unsafe-eval': the vision worker evaluates the self-hosted OpenCV.js build,
  // 'wasm-unsafe-eval': OpenCV's WebAssembly.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase[0] ?? ""}`.trim(),
  "font-src 'self'",
  "media-src 'self' blob:",
  // data: OpenCV streams its inline WebAssembly from a data: URL.
  `connect-src 'self' data: ${supabase.join(" ")}${isDev ? " ws:" : ""}`.trim(),
  // supabase-js runs Realtime heartbeats in a blob: worker.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), fullscreen=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // OpenCV.js is ~10 MB and never changes between deploys; samples neither.
    // Without this, Vercel serves them max-age=0 and every visit revalidates.
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/opencv/:path*", headers: cache },
      { source: "/samples/:path*", headers: cache },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
