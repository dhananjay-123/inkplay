'use client';

import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { SceneSchema, num, type Scene } from './scene';

// ---------------------------------------------------------------- storage
// Templates and the working draft live in this browser only: no account, no
// database, works offline. Every access is guarded; storage can be missing.

export type Template = { id: string; name: string; savedAt: number; scene: Scene; builtIn?: boolean };

const TEMPLATES_KEY = 'inkplay.templates.v1';
const DRAFT_KEY = 'inkplay.draft.v1';
const CHANGED = 'inkplay:templates';

const TemplateSchema = z.object({ id: z.string(), name: z.string(), savedAt: num, scene: SceneSchema });

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Each template is checked on its own: one bad entry hides only itself, and
// is written back untouched (`kept`) so saving another template never wipes it.
let cache: { raw: string | null; list: Template[]; kept: unknown[] } = { raw: null, list: [], kept: [] };
function parseAll(): typeof cache {
  const raw = read(TEMPLATES_KEY);
  if (raw === cache.raw) return cache;
  const list: Template[] = [];
  const kept: unknown[] = [];
  try {
    const all: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(all)) {
      for (const entry of all) {
        const t = TemplateSchema.safeParse(entry);
        if (t.success) list.push(t.data);
        else kept.push(entry);
      }
    }
  } catch {
    /* corrupt JSON: nothing readable to keep */
  }
  cache = { raw, list, kept };
  return cache;
}
const savedTemplates = (): Template[] => parseAll().list;

const EMPTY: Template[] = [];
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(CHANGED, cb);
  };
}

/** The user's saved templates, newest first. Empty on the server. */
export function useTemplates(): Template[] {
  return useSyncExternalStore(subscribe, savedTemplates, () => EMPTY);
}

/** Saves (or overwrites, same id) a template. False if the browser refused. */
export function saveTemplate(t: Omit<Template, 'savedAt'>): boolean {
  const { list, kept } = parseAll();
  const ok = write(TEMPLATES_KEY, JSON.stringify([{ ...t, savedAt: Date.now() }, ...list.filter((x) => x.id !== t.id), ...kept]));
  if (ok) window.dispatchEvent(new Event(CHANGED));
  return ok;
}

export function deleteTemplate(id: string): void {
  const { list, kept } = parseAll();
  if (write(TEMPLATES_KEY, JSON.stringify([...list.filter((x) => x.id !== id), ...kept]))) window.dispatchEvent(new Event(CHANGED));
}

export function loadDraft(): Scene | null {
  try {
    const parsed = SceneSchema.safeParse(JSON.parse(read(DRAFT_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft(scene: Scene): void {
  write(DRAFT_KEY, JSON.stringify(scene));
}

/** Ground, spikes, a ledge, a star and a rule: the shortest fun level. */
export const STARTER: Template = {
  id: 'starter',
  name: 'Starter level',
  savedAt: 0,
  builtIn: true,
  scene: [
    { kind: 'stroke', id: 's-ground', points: [40, 800, 400, 794, 800, 804, 1200, 796, 1560, 800] },
    { kind: 'sticker', id: 's-p', ref: 'player', x: 110, y: 712, scale: 1 },
    { kind: 'sticker', id: 's-spikes', ref: 'spikes', x: 620, y: 756, scale: 1 },
    { kind: 'sticker', id: 's-coin', ref: 'coin', x: 690, y: 560, scale: 1 },
    { kind: 'sticker', id: 's-ledge', ref: 'ledge', x: 1040, y: 560, scale: 1 },
    { kind: 'sticker', id: 's-star', ref: 'star', x: 1110, y: 440, scale: 1 },
    { kind: 'text', id: 's-rule', text: 'low gravity', x: 110, y: 160, scale: 1 },
  ],
};
