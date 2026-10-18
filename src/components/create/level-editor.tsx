'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  H,
  INK,
  STROKE,
  W,
  bboxOf,
  exportPng,
  importImage,
  moveItem,
  newId,
  strokePath,
  type Item,
  type Scene,
} from '@/lib/editor/scene';
import { saveDraft, saveTemplate } from '@/lib/editor/storage';
import { STICKERS, STICKER_BY_ID, stickerSize, type StickerGroup } from '@/lib/editor/stickers';
import { SceneItem, StickerGlyph } from './scene-svg';

type Tool = 'move' | 'pen' | 'line' | 'eraser';
type Tab = StickerGroup | 'rules' | 'import';

type Drag =
  | { kind: 'draw'; points: number[] }
  | { kind: 'move'; id: string; before: Scene; lastX: number; lastY: number }
  | { kind: 'resize'; id: string; before: Scene; ax: number; ay: number; startDist: number; startScale: number }
  | { kind: 'erase' };

const RULE_PRESETS = ['low gravity', 'heavy gravity', 'super speed', 'upside down', "it's night", 'mirror world', '45 second limit', 'enemies get faster', 'double jump'];

const TOOLS: { id: Tool; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'move', label: 'Move', hint: 'drag things around, pull the corner to resize', icon: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /> },
  { id: 'pen', label: 'Pen', hint: 'draw freehand', icon: <path d="M4 20l1.2-4.6L16.4 4.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8zM4 20l4.6-1.2" /> },
  { id: 'line', label: 'Line', hint: 'straight lines, good for ground', icon: <path d="M4 18 L20 6" /> },
  { id: 'eraser', label: 'Eraser', hint: 'tap or drag over things to remove them', icon: <path d="M8 20h12M4.6 14.6l8-8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 18.8H8.4z" /> },
];

const TABS: { id: Tab; label: string }[] = [
  { id: 'symbols', label: 'Symbols' },
  { id: 'things', label: 'Things' },
  { id: 'rules', label: 'Rules' },
  { id: 'import', label: 'Import' },
];

type Props = {
  initial: Scene;
  templateId: string | null;
  templateName: string;
  /** `title` is the template name, if the player gave one. */
  onPlay: (png: Blob, title?: string) => void;
  onExit: () => void;
  onSaved: (id: string, name: string) => void;
};

/**
 * Draw a level without paper: freehand ink, straight lines, drag-in doodles,
 * handwritten rules and imported pictures. Undo/redo, resize, autosave, and
 * templates kept in this browser.
 */
const UNTITLED = 'Untitled level';

export function LevelEditor({ initial, templateId, templateName, onPlay, onExit, onSaved }: Props) {
  const [items, setItems] = useState<Scene>(initial);
  const [tool, setTool] = useState<Tool>('pen');
  const [tab, setTab] = useState<Tab>('symbols');
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<number[] | null>(null);
  const [ruleText, setRuleText] = useState('');
  const [saving, setSaving] = useState<string | null>(null); // template name being typed
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState({ undo: 0, redo: 0 }); // stack sizes, for the buttons

  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  const drag = useRef<Drag | null>(null);
  const undo = useRef<Scene[]>([]);
  const redo = useRef<Scene[]>([]);

  useEffect(() => {
    itemsRef.current = items;
    const t = setTimeout(() => saveDraft(items), 400);
    return () => clearTimeout(t);
  }, [items]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

  /** Apply a change as one undo step. */
  const commit = useCallback((next: Scene, before: Scene = itemsRef.current) => {
    undo.current = [...undo.current.slice(-59), before];
    redo.current = [];
    itemsRef.current = next;
    setItems(next);
    setHist({ undo: undo.current.length, redo: redo.current.length });
  }, []);

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(itemsRef.current);
    itemsRef.current = prev;
    setItems(prev);
    setSelected(null);
    setHist({ undo: undo.current.length, redo: redo.current.length });
  }, []);

  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    setHist({ undo: undo.current.length, redo: redo.current.length });
  }, []);

  const remove = useCallback(
    (id: string) => {
      commit(itemsRef.current.filter((i) => i.id !== id));
      setSelected((s) => (s === id ? null : s));
    },
    [commit],
  );

  // Keyboard: undo/redo, delete, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        remove(selected);
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doRedo, doUndo, remove, selected]);

  /** Screen point to level space. */
  const toLevel = (clientX: number, clientY: number) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
  };

  const idAt = (el: Element | null) => el?.closest('[data-id]')?.getAttribute('data-id') ?? null;

  const add = (it: Item) => {
    commit([...itemsRef.current, it]);
    setSelected(it.id);
    setTool('move');
  };

  const addSticker = (ref: string, cx?: number, cy?: number) => {
    const def = STICKER_BY_ID.get(ref);
    if (!def) return;
    const [w, h] = stickerSize(def);
    // Without a drop point, stagger new things around the middle so they don't stack.
    const n = itemsRef.current.length % 6;
    const x = (cx ?? W / 2 + (n - 3) * 40) - w / 2;
    const y = (cy ?? H / 2 + (n - 3) * 24) - h / 2;
    add({ kind: 'sticker', id: newId(), ref, x: Math.round(x), y: Math.round(y), scale: 1 });
  };

  const addText = (text: string) => {
    const t = text.trim().slice(0, 60);
    if (!t) return;
    const n = itemsRef.current.filter((i) => i.kind === 'text').length;
    add({ kind: 'text', id: newId(), text: t, x: 90, y: 120 + (n % 5) * 64, scale: 1 });
    setRuleText('');
  };

  const addImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return setNote('That file isn’t a picture.');
    try {
      const img = await importImage(file);
      const fit = Math.min(1, 360 / Math.max(img.w, img.h));
      add({ kind: 'image', id: newId(), src: img.src, x: Math.round(W / 2 - (img.w * fit) / 2), y: Math.round(H / 2 - (img.h * fit) / 2), w: img.w, h: img.h, scale: fit });
    } catch {
      setNote('Couldn’t open that picture.');
    }
  };

  // -------------------------------------------------------------- pointer
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toLevel(e.clientX, e.clientY);
    const target = e.target as Element;
    const id = idAt(target);

    if (target.closest('[data-delete]') && selected) {
      remove(selected);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'pen' || tool === 'line') {
      setSelected(null);
      drag.current = { kind: 'draw', points: [p.x, p.y] };
      setLive([p.x, p.y]);
    } else if (tool === 'eraser') {
      if (id) remove(id);
      drag.current = { kind: 'erase' };
    } else if (target.closest('[data-handle]') && selected) {
      const it = itemsRef.current.find((i) => i.id === selected);
      if (!it || it.kind === 'stroke') return;
      const dist = Math.hypot(p.x - it.x, p.y - it.y) || 1;
      drag.current = { kind: 'resize', id: it.id, before: itemsRef.current, ax: it.x, ay: it.y, startDist: dist, startScale: it.scale };
    } else if (id) {
      setSelected(id);
      drag.current = { kind: 'move', id, before: itemsRef.current, lastX: p.x, lastY: p.y };
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toLevel(e.clientX, e.clientY);
    if (d.kind === 'draw') {
      if (tool === 'line') d.points = [d.points[0], d.points[1], p.x, p.y];
      else {
        const lx = d.points[d.points.length - 2];
        const ly = d.points[d.points.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) < 3) return;
        d.points = [...d.points, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      }
      setLive(d.points);
    } else if (d.kind === 'move') {
      const dx = p.x - d.lastX;
      const dy = p.y - d.lastY;
      d.lastX = p.x;
      d.lastY = p.y;
      const next = itemsRef.current.map((i) => (i.id === d.id ? moveItem(i, dx, dy) : i));
      itemsRef.current = next;
      setItems(next);
    } else if (d.kind === 'resize') {
      const scale = Math.max(0.2, Math.min(8, (d.startScale * Math.hypot(p.x - d.ax, p.y - d.ay)) / d.startDist));
      const next = itemsRef.current.map((i) => (i.id === d.id && i.kind !== 'stroke' ? { ...i, scale } : i));
      itemsRef.current = next;
      setItems(next);
    } else if (d.kind === 'erase') {
      const id = idAt(document.elementFromPoint(e.clientX, e.clientY));
      if (id) remove(id);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') {
      setLive(null);
      // A single tap with the line tool is nothing; with the pen it's a dot.
      if (d.points.length >= 4 || tool === 'pen') commit([...itemsRef.current, { kind: 'stroke', id: newId(), points: d.points }]);
    } else if ((d.kind === 'move' || d.kind === 'resize') && d.before !== itemsRef.current) {
      commit(itemsRef.current, d.before);
    }
  };

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const p = toLevel(e.clientX, e.clientY);
    const ref = e.dataTransfer.getData('application/x-inkplay-sticker');
    if (ref) return addSticker(ref, p.x, p.y);
    const file = e.dataTransfer.files[0];
    if (file) void addImage(file);
  };

  // --------------------------------------------------------------- actions
  const play = async () => {
    if (!itemsRef.current.length) return setNote('Draw something first, even just a line and a P.');
    setBusy(true);
    try {
      saveDraft(itemsRef.current);
      // A name typed but not saved yet still counts; the default name doesn't.
      const name = (saving ?? '').trim().slice(0, 40) || templateName;
      onPlay(await exportPng(itemsRef.current), name && name !== UNTITLED ? name : undefined);
    } catch {
      setNote('Couldn’t turn the canvas into a picture. Try again?');
      setBusy(false);
    }
  };

  const save = (asNew: boolean) => {
    const name = (saving ?? '').trim().slice(0, 40) || UNTITLED;
    const id = !asNew && templateId ? templateId : newId();
    if (saveTemplate({ id, name, scene: itemsRef.current })) {
      onSaved(id, name);
      setNote(`Saved “${name}” in this browser.`);
      setSaving(null);
    } else setNote('The browser wouldn’t save it. Storage may be full: try removing an imported picture.');
  };

  const sel = items.find((i) => i.id === selected) ?? null;
  const box = sel ? bboxOf(sel) : null;
  const activeTool = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tool === t.id}
              title={`${t.label}: ${t.hint}`}
              onClick={() => setTool(t.id)}
              className={`btn-sm flex items-center gap-1.5 px-3 py-1.5 ${tool === t.id ? 'btn-game' : 'btn-ghost'}`}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {t.icon}
              </svg>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="mx-1 hidden h-6 border-l-2 border-dashed border-ink/20 sm:block" aria-hidden />
        <button type="button" onClick={doUndo} disabled={!hist.undo} className="btn-ghost btn-sm px-3 py-1.5 disabled:opacity-40" title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={doRedo} disabled={!hist.redo} className="btn-ghost btn-sm px-3 py-1.5 disabled:opacity-40" title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button
          type="button"
          onClick={() => {
            if (!items.length) return;
            commit([]);
            setSelected(null);
          }}
          disabled={!items.length}
          className="btn-ghost btn-sm px-3 py-1.5 disabled:opacity-40"
        >
          Clear
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExit} className="font-hand link-scrawl px-2 text-lg text-graphite">
            back
          </button>
          <button type="button" onClick={() => setSaving(templateName || '')} className="btn-ghost btn-sm px-3 py-1.5">
            Save template
          </button>
          <button type="button" onClick={play} disabled={busy} className="btn-game px-5 py-2 text-lg disabled:opacity-60">
            {busy ? 'Reading…' : 'Play it'}
          </button>
        </div>
      </div>

      {saving !== null && (
        <form
          className="sketch-soft flex flex-wrap items-center gap-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <label className="font-hand text-lg" htmlFor="tpl-name">
            Name it:
          </label>
          <input
            id="tpl-name"
            autoFocus
            value={saving}
            maxLength={40}
            onChange={(e) => setSaving(e.target.value)}
            placeholder="Cactus canyon"
            className="min-w-0 flex-1 rounded-[var(--wobble)] border-2 border-ink/30 bg-paper px-3 py-1.5 outline-none focus:border-ink"
          />
          <button type="submit" className="btn-game btn-sm px-4 py-1.5">
            {templateId ? 'Save' : 'Save template'}
          </button>
          {templateId && (
            <button type="button" onClick={() => save(true)} className="btn-ghost btn-sm px-4 py-1.5">
              Save as new
            </button>
          )}
          <button type="button" onClick={() => setSaving(null)} className="font-hand px-1 text-lg text-graphite hover:text-ink">
            cancel
          </button>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
        {/* -------------------------------------------------------- canvas */}
        <div className="min-w-0">
          <div className="sketch overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className={`block aspect-video w-full touch-none select-none bg-[var(--card)] ${tool === 'move' ? 'cursor-grab' : 'cursor-crosshair'}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              role="img"
              aria-label="Level canvas"
            >
              {!items.length && !live && (
                <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="40" fill="var(--graphite)" style={{ fontFamily: 'var(--font-kalam), cursive' }}>
                  draw here, or add things from the panel
                </text>
              )}
              {items.map((it) => (
                <g key={it.id} data-id={it.id}>
                  <SceneItem it={it} hit />
                </g>
              ))}
              {live && <path d={strokePath(live)} stroke={INK} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              {box && sel && tool === 'move' && (
                <g>
                  <rect x={box.x - 8} y={box.y - 8} width={box.w + 16} height={box.h + 16} fill="none" stroke="var(--pop)" strokeWidth="3" strokeDasharray="10 8" rx="6" />
                  <g data-delete transform={`translate(${box.x - 8} ${box.y - 8})`} className="cursor-pointer">
                    <circle r="17" fill="var(--hazard)" stroke={INK} strokeWidth="3" />
                    <path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
                  </g>
                  {sel.kind !== 'stroke' && (
                    <g data-handle transform={`translate(${box.x + box.w + 8} ${box.y + box.h + 8})`} className="cursor-nwse-resize">
                      <circle r="17" fill="var(--accent)" stroke={INK} strokeWidth="3" />
                      <path d="M-6 0 H6 M0 -6 V6" stroke={INK} strokeWidth="3" strokeLinecap="round" transform="rotate(45)" />
                    </g>
                  )}
                </g>
              )}
            </svg>
          </div>
          <p className="font-hand mt-2 min-h-[1.75rem] text-base text-graphite" aria-live="polite">
            {note ?? `${activeTool.label}: ${activeTool.hint}. Ctrl+Z undoes, Delete removes the selected thing.`}
          </p>
        </div>

        {/* ------------------------------------------------------- library */}
        <aside className="sketch-soft flex flex-col p-3">
          <div className="flex gap-1" role="tablist" aria-label="Things to add">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`font-hand flex-1 px-1.5 py-1 text-lg transition-colors ${tab === t.id ? 'highlight text-ink' : 'text-graphite hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {(tab === 'symbols' || tab === 'things') && (
            <>
              <p className="mt-2 text-sm text-graphite">Drag onto the canvas, or tap to add.</p>
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {STICKERS.filter((s) => s.group === tab).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-inkplay-sticker', s.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => addSticker(s.id)}
                      title={`${s.name}: becomes ${s.becomes}`}
                      className="group flex w-full cursor-grab flex-col items-center gap-0.5 rounded-[var(--wobble)] border-2 border-transparent px-1 py-1.5 transition-[border-color,background-color] hover:border-ink/25 hover:bg-paper active:cursor-grabbing"
                    >
                      <StickerGlyph id={s.id} className="h-11 w-14 text-ink transition-transform group-hover:-rotate-6" />
                      <span className="font-hand text-sm leading-tight">{s.name}</span>
                      <span className="text-[0.7rem] leading-tight font-semibold text-pop">{s.becomes}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === 'rules' && (
            <div className="mt-2">
              <p className="text-sm text-graphite">Rules are words on the page. Gemma reads them like it reads your handwriting.</p>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addText(ruleText);
                }}
              >
                <input
                  value={ruleText}
                  onChange={(e) => setRuleText(e.target.value)}
                  maxLength={60}
                  placeholder="write a rule…"
                  aria-label="Rule text"
                  className="font-hand min-w-0 flex-1 rounded-[var(--wobble)] border-2 border-ink/30 bg-paper px-3 py-1 text-lg outline-none focus:border-ink"
                />
                <button type="submit" className="btn-game btn-sm px-3 py-1">
                  Add
                </button>
              </form>
              <ul className="mt-3 flex flex-wrap gap-2">
                {RULE_PRESETS.map((r) => (
                  <li key={r}>
                    <button type="button" onClick={() => addText(r)} className="font-hand rounded-[var(--wobble-btn)] border-2 border-dashed border-ink/30 bg-card px-2.5 py-0.5 text-base hover:border-ink">
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'import' && (
            <div className="mt-2">
              <p className="text-sm text-graphite">
                Add your own doodle from a picture. Dark lines on a light background work best. You can also drop a picture straight onto the canvas.
              </p>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost mt-4 w-full px-4 py-2.5">
                Choose a picture
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addImage(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
