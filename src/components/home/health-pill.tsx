'use client';

import { useEffect, useState } from 'react';
import type { Health } from '@/app/api/health/route';

type State = { kind: 'loading' } | { kind: 'ok'; h: Health } | { kind: 'down' };

/** Live status of the model behind this deployment. */
export function HealthPill() {
  const [s, setS] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(String(r.status)))))
      .then((h) => setS({ kind: 'ok', h }))
      .catch(() => !ctrl.signal.aborted && setS({ kind: 'down' }));
    return () => ctrl.abort();
  }, []);

  let dot = 'bg-graphite animate-pulse';
  let text = 'checking on Gemma…';
  if (s.kind === 'down') {
    dot = 'bg-hazard';
    text = 'server unreachable';
  } else if (s.kind === 'ok') {
    const where = s.h.provider === 'ollama' ? 'offline · laptop' : s.h.provider === 'mock' ? 'mock mode' : 'cloud';
    dot = s.h.modelReachable ? 'bg-accent' : 'bg-hazard';
    text = `${s.h.model} · ${where} · ${s.h.modelReachable ? 'ready' : 'not reachable'}`;
  }

  return (
    <span
      role="status"
      className="label inline-flex max-w-full items-center gap-2 truncate rounded-full border border-ink/15 bg-card px-3 py-1.5 text-[0.62rem] text-graphite"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ring-1 ring-ink/30 ${dot}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}
