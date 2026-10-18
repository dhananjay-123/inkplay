import { H, INK, PAPER, STROKE, TEXT_SIZE, W, strokePath, type Item, type Scene } from '@/lib/editor/scene';
import { STICKER_BY_ID, type StickerDef } from '@/lib/editor/stickers';

/** One editor item as SVG, in level space. `hit` adds fat invisible targets for dragging. */
export function SceneItem({ it, hit = false }: { it: Item; hit?: boolean }) {
  switch (it.kind) {
    case 'stroke': {
      const d = strokePath(it.points);
      return (
        <>
          {hit && <path d={d} stroke="transparent" strokeWidth={26} fill="none" strokeLinecap="round" />}
          <path d={d} stroke={INK} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    }
    case 'sticker': {
      const def = STICKER_BY_ID.get(it.ref);
      if (!def) return null;
      return (
        <g transform={`translate(${it.x} ${it.y}) scale(${def.k * it.scale})`}>
          {hit && <rect width={def.vb[0]} height={def.vb[1]} fill="transparent" />}
          <StickerPaths def={def} scale={def.k * it.scale} />
        </g>
      );
    }
    case 'text':
      return (
        <text x={it.x} y={it.y} fontSize={TEXT_SIZE * it.scale} fill={INK} style={{ fontFamily: 'var(--font-kalam), cursive' }}>
          {it.text}
        </text>
      );
    case 'image':
      return <image href={it.src} x={it.x} y={it.y} width={it.w * it.scale} height={it.h * it.scale} preserveAspectRatio="none" />;
  }
}

/** Sticker outlines, stroked at the same level-space width as pen lines (like the export). */
function StickerPaths({ def, scale }: { def: StickerDef; scale: number }) {
  return (
    <>
      {def.paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={INK} strokeWidth={STROKE / scale} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {def.fills?.map((d, i) => <path key={`f${i}`} d={d} fill={INK} />)}
    </>
  );
}

/** A sticker on its own, sized by CSS (palette buttons, guide cards). */
export function StickerGlyph({ id, className = 'h-12 w-16', color = 'currentColor' }: { id: string; className?: string; color?: string }) {
  const def = STICKER_BY_ID.get(id);
  if (!def) return null;
  const pad = 6;
  return (
    <svg viewBox={`${-pad} ${-pad} ${def.vb[0] + pad * 2} ${def.vb[1] + pad * 2}`} className={`shrink-0 overflow-visible ${className}`} aria-hidden>
      {def.paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      {def.fills?.map((d, i) => <path key={`f${i}`} d={d} fill={color} />)}
    </svg>
  );
}

/** Read-only thumbnail of a whole scene (template cards). */
export function ScenePreview({ scene, className = '' }: { scene: Scene; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`block ${className}`} style={{ background: PAPER }} aria-hidden>
      {scene.map((it) => (
        <SceneItem key={it.id} it={it} />
      ))}
    </svg>
  );
}
