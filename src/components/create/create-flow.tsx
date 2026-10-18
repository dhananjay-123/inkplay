'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiErrorBody, ParseResponse } from '@/lib/api-types';
import { ruleChip } from '@/lib/rules-display';
import { SAMPLES, sampleSrc, sampleThumb } from '@/lib/samples';
import { useInkplay } from '@/lib/store';
import { processImage, warmupVision, type Processed } from '@/lib/vision/client';
import { MarksReveal } from './marks-reveal';
import { WebcamCapture } from './webcam-capture';

type Phase =
  | { kind: 'idle' }
  | { kind: 'vision' }
  | { kind: 'reading'; vision: Processed }
  | { kind: 'ready'; vision: Processed; result: ParseResponse }
  | { kind: 'error'; message: string; vision?: Processed; retryable: boolean };

const COOLDOWN_MS = 5000;

const LOADING_LINES = [
  'Gemma is reading your masterpiece…',
  'Squinting at your handwriting…',
  'Deciding if that’s a cactus or a very angry cucumber…',
  'Asking the zigzag what it wants to be…',
  'Translating doctor-grade handwriting…',
  'Assigning personalities to your enemies…',
];

export function CreateFlow() {
  const router = useRouter();
  const setCurrent = useInkplay((s) => s.setCurrent);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [webcam, setWebcam] = useState(false);
  const [line, setLine] = useState(0);
  const [dragging, setDragging] = useState(false);
  const lastParse = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const busy = phase.kind === 'vision' || phase.kind === 'reading';

  useEffect(() => warmupVision(), []);

  useEffect(() => {
    if (!busy) return;
    const iv = setInterval(() => setLine((n) => (n + 1) % LOADING_LINES.length), 2200);
    return () => clearInterval(iv);
  }, [busy]);

  const parse = useCallback(async (vision: Processed) => {
    const wait = lastParse.current + COOLDOWN_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastParse.current = Date.now();
    setPhase({ kind: 'reading', vision });
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ somImage: vision.somSend, cleanImage: vision.cleanSend, marks: vision.marks }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setPhase({ kind: 'error', vision, retryable: res.status !== 400, message: body?.error.message ?? 'Something smudged. Try again?' });
        return;
      }
      setPhase({ kind: 'ready', vision, result: (await res.json()) as ParseResponse });
    } catch {
      setPhase({ kind: 'error', vision, retryable: true, message: 'Couldn’t reach the server. Is the internet (or the laptop) awake?' });
    }
  }, []);

  const handle = useCallback(
    async (source: Blob | HTMLVideoElement | HTMLImageElement) => {
      if (busy) return;
      setPhase({ kind: 'vision' });
      try {
        const vision = await processImage(source);
        if (vision.marks.length === 0) {
          setPhase({ kind: 'error', retryable: false, message: 'Gemma sees a blank page. Try darker ink or better light.' });
          return;
        }
        await parse(vision);
      } catch (e) {
        console.error(e);
        setPhase({ kind: 'error', retryable: false, message: 'Couldn’t read that image. Try another photo?' });
      }
    },
    [busy, parse],
  );

  const loadSample = async (id: string) => {
    const blob = await fetch(sampleSrc(id)).then((r) => r.blob());
    void handle(blob);
  };

  const playIt = () => {
    if (phase.kind !== 'ready') return;
    const { result, vision } = phase;
    setCurrent({ id: result.id, level: result.level, marks: result.marks, image: vision.cleanFull });
    router.push(result.id ? `/play/${result.id}` : '/play');
  };

  const vision = phase.kind === 'reading' || phase.kind === 'ready' || (phase.kind === 'error' && phase.vision) ? (phase as { vision: Processed }).vision : null;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8">
      <header className="pt-6 pb-8">
        <p className="label text-graphite">Step 1 · Snap your drawing</p>
        <h1 className="font-display mt-2 text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-extrabold tracking-tight">Show Gemma your page.</h1>
      </header>

      {!vision && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f?.type.startsWith('image/')) void handle(f);
          }}
          className={`relative grid min-h-[320px] place-items-center bg-card p-8 text-center shadow-[var(--shadow)] ring-1 ring-ink/10 transition-transform [clip-path:polygon(0_2%,4%_0,9%_2%,15%_0,22%_1.5%,30%_0,38%_2%,46%_0,55%_1.5%,63%_0,71%_2%,80%_0,88%_1.5%,95%_0,100%_2%,100%_100%,0_100%)] ${dragging ? 'scale-[1.01] ring-2 ring-accent' : ''}`}
        >
          {phase.kind === 'vision' ? (
            <p className="font-hand animate-pulse text-2xl">Flattening your paper and finding the ink…</p>
          ) : (
            <div>
              <p className="font-hand text-2xl text-graphite sm:text-3xl">Drop a photo of your drawing here</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => fileInput.current?.click()} className="label rounded-full bg-ink px-5 py-3 text-paper">
                  Upload
                </button>
                <button type="button" onClick={() => cameraInput.current?.click()} className="label rounded-full border border-current px-5 py-3 sm:hidden">
                  Use camera
                </button>
                <button type="button" onClick={() => setWebcam(true)} className="label hidden rounded-full border border-current px-5 py-3 sm:inline-block">
                  Use webcam
                </button>
              </div>
            </div>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
        </div>
      )}

      {vision && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <MarksReveal
              image={vision.cleanFull}
              marks={vision.marks}
              labels={phase.kind === 'ready' ? phase.result.level.labels : null}
              rescue={phase.kind === 'ready' ? phase.result.level.rescue : []}
            />
            <p className="label mt-3 text-graphite">
              {vision.marks.length} marks found · {vision.paperDetected ? 'paper flattened' : 'no paper edge found, cropped'} · vision {vision.ms}ms
              {phase.kind === 'ready' && ` · Gemma ${(phase.result.ms / 1000).toFixed(1)}s`}
            </p>
          </div>
          <aside className="flex flex-col gap-5">
            {phase.kind === 'reading' && <p className="font-hand text-2xl leading-snug">{LOADING_LINES[line]}</p>}
            {phase.kind === 'error' && (
              <div>
                <p className="font-hand text-2xl leading-snug text-hazard">{phase.message}</p>
                <div className="mt-4 flex gap-3">
                  {phase.retryable && phase.vision && (
                    <button type="button" onClick={() => parse(phase.vision!)} className="label rounded-full bg-ink px-5 py-3 text-paper">
                      Try again
                    </button>
                  )}
                  <button type="button" onClick={() => setPhase({ kind: 'idle' })} className="label rounded-full border border-current px-5 py-3">
                    New drawing
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'ready' && <ReadyPanel result={phase.result} onPlay={playIt} onReset={() => setPhase({ kind: 'idle' })} />}
          </aside>
        </div>
      )}

      {!vision && phase.kind === 'error' && (
        <div className="mt-6 flex items-center gap-4">
          <p className="font-hand text-xl text-hazard">{phase.message}</p>
          <button type="button" onClick={() => setPhase({ kind: 'idle' })} className="label underline">
            OK
          </button>
        </div>
      )}

      {phase.kind === 'idle' && (
        <>
          <h2 id="samples" className="label mt-14 scroll-mt-24 text-graphite">No pen handy? Try a sample</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {SAMPLES.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => loadSample(s.id)} className="group block w-full text-left">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static local thumbnail */}
                  <img src={sampleThumb(s.id)} alt="" className="aspect-video w-full object-cover shadow-[var(--shadow)] transition-transform group-hover:-rotate-1 group-hover:scale-[1.03]" />
                  <span className="font-display mt-2 block font-bold">{s.title}</span>
                  <span className="font-hand block text-graphite">{s.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <CheatSheet />
        </>
      )}

      {webcam && (
        <WebcamCapture
          onClose={() => setWebcam(false)}
          onCapture={(v) => {
            setWebcam(false);
            void handle(v);
          }}
        />
      )}
    </section>
  );
}

function ReadyPanel({ result, onPlay, onReset }: { result: ParseResponse; onPlay: () => void; onReset: () => void }) {
  const { level } = result;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="label text-graphite">Gemma named it</p>
        <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight">{level.title}</h2>
        <p className="font-hand mt-2 text-xl leading-snug">{level.story}</p>
      </div>
      {level.rawRuleText.length > 0 && (
        <div>
          <p className="label text-graphite">Gemma read these rules</p>
          <ul className="mt-2 space-y-1">
            {level.rawRuleText.map((t, i) => (
              <li key={i} className="font-hand text-xl">“{t}”</li>
            ))}
          </ul>
          <ul className="mt-3 flex flex-wrap gap-2">
            {level.rules.map((r, i) => (
              <li key={i} className="label bg-accent px-2 py-1 text-accent-ink shadow-[2px_2px_0_var(--ink)]">
                {ruleChip(r)} ✓
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="font-hand text-lg text-graphite">✎ {level.designerNote}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onPlay} className="label rounded-full bg-accent px-6 py-4 text-accent-ink shadow-[3px_3px_0_var(--ink)]">
          Play it →
        </button>
        <button type="button" onClick={onReset} className="label rounded-full border border-current px-5 py-4">
          New drawing
        </button>
      </div>
    </div>
  );
}

function CheatSheet() {
  return (
    <details className="mt-14 max-w-2xl bg-card p-5 shadow-[var(--shadow)] ring-1 ring-ink/10">
      <summary className="label cursor-pointer">Cheat sheet (optional — Gemma reads anything)</summary>
      <ul className="font-hand mt-4 grid gap-1 text-xl sm:grid-cols-2">
        <li>— straight line = ground / platform</li>
        <li>/\/\/\ zigzag = spikes</li>
        <li>P = you, the player</li>
        <li>G or ★ = goal</li>
        <li>$ = coin</li>
        <li>E + arrow = enemy + direction</li>
        <li>anything else = Gemma figures it out</li>
        <li>words = rules (“low gravity”)</li>
      </ul>
    </details>
  );
}
