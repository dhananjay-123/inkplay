'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiErrorBody, ParseResponse } from '@/lib/api-types';
import { ruleChip } from '@/lib/rules-display';
import { SymbolLegend } from '@/components/guide/symbols';
import type { Scene } from '@/lib/editor/scene';
import { STARTER, deleteTemplate, loadDraft, saveDraft, useTemplates, type Template } from '@/lib/editor/storage';
import { SAMPLES, sampleSrc, sampleThumb } from '@/lib/samples';
import { useInkplay } from '@/lib/store';
import { processImage, warmupVision, type Processed } from '@/lib/vision/client';
import { LevelEditor } from './level-editor';
import { MarksReveal } from './marks-reveal';
import { ScenePreview } from './scene-svg';

type Phase =
  | { kind: 'idle' }
  | { kind: 'vision' }
  | { kind: 'reading'; vision: Processed }
  | { kind: 'ready'; vision: Processed; result: ParseResponse }
  | { kind: 'error'; message: string; vision?: Processed; retryable: boolean };

/** What the editor opens with. `scene` undefined = pick up the autosaved draft. */
type EditorSeed = { key: number; scene?: Scene; templateId: string | null; name: string };

const COOLDOWN_MS = 5000;

const LOADING_LINES = [
  'Reading your masterpiece…',
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
  const [mode, setMode] = useState<'choose' | 'draw'>('choose');
  const [seed, setSeed] = useState<EditorSeed>({ key: 0, templateId: null, name: '' });
  const [line, setLine] = useState(0);
  const [dragging, setDragging] = useState(false);
  const lastParse = useRef(0);
  // State lags a fast double click; the ref doesn't.
  const inFlight = useRef(false);
  const title = useRef<string | undefined>(undefined); // player's own level name, kept for retries
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase.kind === 'vision' || phase.kind === 'reading';

  useEffect(() => warmupVision(), []);

  // The game engine is ~315 KB gzipped and was fetched only after "Play it":
  // on a real network that read as a dead click. Pull it in while idle here.
  useEffect(() => {
    const warm = () => void Promise.all([import('phaser'), import('@/game/LevelScene')]).catch(() => {});
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm);
    else setTimeout(warm, 1500);
  }, []);

  // Once the model has answered, the play route is the only place left to go.
  useEffect(() => {
    if (phase.kind === 'ready') router.prefetch(phase.result.id ? `/play/${phase.result.id}` : '/play');
  }, [phase, router]);

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
        body: JSON.stringify({ somImage: vision.somSend, cleanImage: vision.cleanSend, marks: vision.marks, title: title.current }),
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
    async (source: Blob | HTMLImageElement, name?: string) => {
      if (busy || inFlight.current) return;
      inFlight.current = true;
      title.current = name;
      setPhase({ kind: 'vision' });
      try {
        const vision = await processImage(source);
        if (vision.marks.length === 0) {
          setPhase({ kind: 'error', retryable: false, message: 'This page looks blank. Try darker ink or better light.' });
          return;
        }
        await parse(vision);
      } catch (e) {
        console.error(e);
        setPhase({ kind: 'error', retryable: false, message: 'Couldn’t read that image. Try another photo?' });
      } finally {
        inFlight.current = false;
      }
    },
    [busy, parse],
  );

  const upload = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setPhase({ kind: 'error', retryable: false, message: 'That file isn’t a photo. Try a JPG or PNG of your page.' });
      return;
    }
    setMode('choose');
    void handle(f);
  };

  const loadSample = async (id: string) => {
    let blob: Blob;
    try {
      const res = await fetch(sampleSrc(id));
      if (!res.ok) throw new Error(`sample ${res.status}`);
      blob = await res.blob();
    } catch {
      setPhase({ kind: 'error', retryable: false, message: 'Couldn’t load that sample. Try another one?' });
      return;
    }
    setMode('choose');
    void handle(blob);
  };

  const openEditor = (t?: Template) => {
    // Opening a template replaces the draft, so a reload or "back" keeps it.
    if (t) saveDraft(t.scene);
    setSeed((s) => ({ key: s.key + 1, scene: t?.scene, templateId: t && !t.builtIn ? t.id : null, name: t && !t.builtIn ? t.name : '' }));
    setMode('draw');
    setPhase({ kind: 'idle' });
    window.scrollTo({ top: 0 });
  };

  /** Back from a reading/result to the canvas, picking up the autosaved draft. */
  const backToEditor = () => {
    setSeed((s) => ({ ...s, key: s.key + 1, scene: undefined }));
    setMode('draw');
    setPhase({ kind: 'idle' });
  };

  const reset = () => {
    setMode('choose');
    setPhase({ kind: 'idle' });
  };

  const playIt = () => {
    if (phase.kind !== 'ready') return;
    const { result, vision } = phase;
    setCurrent({ id: result.id, level: result.level, marks: result.marks, image: vision.cleanFull });
    router.push(result.id ? `/play/${result.id}` : '/play');
  };

  const vision = phase.kind === 'reading' || phase.kind === 'ready' || (phase.kind === 'error' && phase.vision) ? (phase as { vision: Processed }).vision : null;
  const drawing = mode === 'draw';

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8">
      <header className="pt-6 pb-8">
        <p className="font-hand -rotate-2 text-xl text-pop">{drawing ? 'no paper needed' : 'step 1: make a level'}</p>
        <h1 className="font-display mt-1 text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.95] font-extrabold tracking-tight">
          {drawing ? (
            <>
              Draw it <span className="highlight">right here.</span>
            </>
          ) : (
            <>
              Show us your <span className="highlight">page.</span>
            </>
          )}
        </h1>
      </header>

      {!vision && phase.kind === 'vision' && (
        <div className="sketch grid min-h-[320px] place-items-center p-8 text-center">
          <p className="font-hand animate-pulse text-2xl">{drawing ? 'Reading your canvas…' : 'Flattening your paper and finding the ink…'}</p>
        </div>
      )}

      {!vision && phase.kind !== 'vision' && drawing && (
        <LevelEditor
          key={seed.key}
          initial={seed.scene ?? loadDraft() ?? []}
          templateId={seed.templateId}
          templateName={seed.name}
          onPlay={(png, name) => {
            setSeed((s) => ({ ...s, scene: undefined }));
            void handle(png, name);
          }}
          onExit={reset}
          onSaved={(id, name) => setSeed((s) => ({ ...s, templateId: id, name }))}
        />
      )}

      {!vision && phase.kind !== 'vision' && !drawing && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* draw in the browser */}
          <div className="sketch tape flex flex-col items-center justify-center gap-4 p-8 pt-10 text-center">
            <svg viewBox="0 0 120 70" className="h-20 w-32 text-ink" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 58 C 30 54, 60 62, 112 56" />
              <path d="M20 54 V30 C 34 26, 36 42, 21 44" />
              <path d="M50 57 l6 -12 l6 12 l6 -12 l6 12" stroke="var(--hazard)" />
              <path d="M98 30 l3 8 l8 0 l-6 5 l2 8 l-7 -5 l-7 5 l2 -8 l-6 -5 l8 0 z" />
              <path d="M70 8 L96 30" stroke="var(--pop)" />
            </svg>
            <div>
              <h2 className="font-display text-3xl font-extrabold tracking-tight">Draw it here</h2>
              <p className="mt-2 text-graphite">Pen, straight lines and ready-made doodles you can drag around. Save it as a template and come back later.</p>
            </div>
            <button type="button" onClick={() => openEditor()} className="btn-game px-6 py-3 text-lg">
              Open the canvas
            </button>
          </div>

          {/* upload a photo */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center justify-center gap-4 rounded-[var(--wobble)] border-[3px] border-dashed p-8 text-center transition-[transform,background-color,border-color] ${
              dragging ? 'scale-[1.01] -rotate-[0.5deg] border-ink bg-accent/30' : 'border-ink/35 bg-card/80'
            }`}
          >
            <svg viewBox="0 0 96 64" className="h-20 w-28 text-ink" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 10 L70 6 L74 52 L18 56 Z" fill="var(--paper)" />
              <path d="M24 42 C 34 36, 44 46, 64 38" />
              <path d="M30 30 l5 -10 l5 10 l5 -10 l5 10" stroke="var(--hazard)" />
              <path d="M78 20 v24 M70 36 l8 8 l8 -8" stroke="var(--pop)" />
            </svg>
            <div>
              <h2 className="font-display text-3xl font-extrabold tracking-tight">Upload a photo</h2>
              <p className="mt-2 text-graphite">Drew it on paper? Drop a photo of the page here, or pick one from your device.</p>
            </div>
            <button type="button" onClick={() => fileInput.current?.click()} className="btn-ghost px-6 py-3 text-lg">
              Choose a photo
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
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
              {vision.marks.length} marks found · {drawing ? 'drawn here' : vision.paperDetected ? 'paper flattened' : 'no paper edge, fitted to 16:9'} · vision {vision.ms}ms
              {phase.kind === 'ready' && ` · read in ${(phase.result.ms / 1000).toFixed(1)}s`}
            </p>
          </div>
          <aside className="flex flex-col gap-5">
            {phase.kind === 'reading' && <p className="font-hand text-2xl leading-snug">{LOADING_LINES[line]}</p>}
            {phase.kind === 'error' && (
              <div>
                <p className="font-hand text-2xl leading-snug text-hazard">{phase.message}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {phase.retryable && phase.vision && (
                    <button type="button" onClick={() => parse(phase.vision!)} className="btn-game px-5 py-3">
                      Try again
                    </button>
                  )}
                  {drawing && (
                    <button type="button" onClick={backToEditor} className="btn-ghost px-5 py-3">
                      Edit the drawing
                    </button>
                  )}
                  <button type="button" onClick={reset} className="btn-ghost px-5 py-3">
                    Start over
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'ready' && <ReadyPanel result={phase.result} onPlay={playIt} onEdit={drawing ? backToEditor : null} onReset={reset} />}
          </aside>
        </div>
      )}

      {!vision && phase.kind === 'error' && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <p className="font-hand text-xl text-hazard">{phase.message}</p>
          <button type="button" onClick={() => setPhase({ kind: 'idle' })} className="btn-ghost btn-sm px-4 py-1">
            OK
          </button>
        </div>
      )}

      {phase.kind === 'idle' && !drawing && (
        <>
          <TemplateShelf onOpen={openEditor} />
          <h2 id="samples" className="font-display mt-16 scroll-mt-24 text-2xl font-extrabold tracking-tight">
            No pen handy? <span className="font-hand font-normal text-pop">try one of ours</span>
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {SAMPLES.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => loadSample(s.id)} className="group block w-full text-left">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static local thumbnail */}
                  <img
                    src={sampleThumb(s.id)}
                    alt=""
                    style={{ rotate: `${[-1.5, 1, -0.5, 1.5, -1][i % 5]}deg` }}
                    className="aspect-video w-full border-[5px] border-card object-cover shadow-[var(--shadow)] transition-transform group-hover:-translate-y-1 group-hover:scale-[1.04]"
                  />
                  <span className="font-display mt-2 block font-bold">{s.title}</span>
                  <span className="font-hand block text-graphite">{s.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <CheatSheet />
        </>
      )}
    </section>
  );
}

/** The starter level plus everything saved in this browser. */
function TemplateShelf({ onOpen }: { onOpen: (t: Template) => void }) {
  const saved = useTemplates();
  const all = [STARTER, ...saved];
  return (
    <>
      <h2 className="font-display mt-16 text-2xl font-extrabold tracking-tight">
        Templates <span className="font-hand font-normal text-pop">{saved.length ? 'yours, saved in this browser' : 'save one from the canvas and it shows up here'}</span>
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {all.map((t, i) => (
          <li key={t.id} className="group relative">
            <button type="button" onClick={() => onOpen(t)} className="block w-full text-left">
              <ScenePreview
                scene={t.scene}
                className="aspect-video w-full border-[5px] border-card shadow-[var(--shadow)] transition-transform group-hover:-translate-y-1 group-hover:scale-[1.04]"
              />
              <span className="font-display mt-2 block truncate font-bold" style={{ rotate: `${[0.5, -0.5][i % 2]}deg` }}>
                {t.name}
              </span>
              <span className="font-hand block text-graphite">{t.builtIn ? 'a little one to start from' : `saved ${new Date(t.savedAt).toLocaleDateString()}`}</span>
            </button>
            {!t.builtIn && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete “${t.name}”? This can't be undone.`)) deleteTemplate(t.id);
                }}
                aria-label={`Delete template ${t.name}`}
                className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-card text-sm font-bold opacity-0 shadow-[2px_2px_0_var(--ink)] transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function ReadyPanel({ result, onPlay, onEdit, onReset }: { result: ParseResponse; onPlay: () => void; onEdit: (() => void) | null; onReset: () => void }) {
  const { level } = result;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="font-hand text-lg text-pop">We named it</p>
        <h2 className="font-display text-4xl font-extrabold leading-none tracking-tight">{level.title}</h2>
        <p className="font-hand mt-2 text-xl leading-snug">{level.story}</p>
      </div>
      {level.rawRuleText.length > 0 && (
        <div>
          <p className="font-hand text-lg text-pop">Rules we read</p>
          <ul className="mt-2 space-y-1">
            {level.rawRuleText.map((t, i) => (
              <li key={i} className="font-hand text-xl">“{t}”</li>
            ))}
          </ul>
          <ul className="mt-3 flex flex-wrap gap-2">
            {level.rules.map((r, i) => (
              <li key={i} className="label rounded-[var(--wobble-btn)] border-2 border-ink bg-accent px-2.5 py-1 text-accent-ink odd:rotate-1 even:-rotate-1">
                {ruleChip(r)} ✓
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="font-hand text-lg text-graphite">✎ {level.designerNote}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onPlay} className="btn-game px-7 py-3.5 text-lg">
          Play it
        </button>
        {onEdit && (
          <button type="button" onClick={onEdit} className="btn-ghost px-5 py-3.5">
            Edit the drawing
          </button>
        )}
        <button type="button" onClick={onReset} className="btn-ghost px-5 py-3.5">
          Start over
        </button>
      </div>
    </div>
  );
}

function CheatSheet() {
  return (
    <div className="sketch tape mt-16 p-5 pt-7 sm:p-7">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold">
          Cheat sheet <span className="font-hand font-normal text-graphite">(optional, write anything)</span>
        </h2>
        <Link href="/guide" className="font-hand link-scrawl text-lg text-ink">
          full guide and every rule
        </Link>
      </div>
      <SymbolLegend />
    </div>
  );
}
