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

const TemplatesSchema = z.array(z.object({ id: z.string(), name: z.string(), savedAt: num, scene: SceneSchema }));

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

let cache: { raw: string | null; list: Template[] } = { raw: null, list: [] };
function savedTemplates(): Template[] {
  const raw = read(TEMPLATES_KEY);
  if (raw === cache.raw) return cache.list;
  let list: Template[] = [];
  try {
    const parsed = TemplatesSchema.safeParse(JSON.parse(raw ?? '[]'));
    if (parsed.success) list = parsed.data;
  } catch {
    /* corrupt entry: treat as empty */
  }
  cache = { raw, list };
  return list;
}

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
  const list = [{ ...t, savedAt: Date.now() }, ...savedTemplates().filter((x) => x.id !== t.id)];
  const ok = write(TEMPLATES_KEY, JSON.stringify(list));
  if (ok) window.dispatchEvent(new Event(CHANGED));
  return ok;
}

export function deleteTemplate(id: string): void {
  if (write(TEMPLATES_KEY, JSON.stringify(savedTemplates().filter((x) => x.id !== id)))) window.dispatchEvent(new Event(CHANGED));
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
