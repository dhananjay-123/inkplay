/**
 * Paper → clean ink + marks + set-of-marks, using OpenCV.js.
 *
 * Isomorphic: no DOM access. The browser passes canvas ImageData; the Node
 * smoke test passes jpeg-js output. Callers handle encoding.
 */
import type * as CVTypes from '@techstark/opencv-js';
import { MAX_MARKS, type Mark } from '@/lib/schema';

export type CV = typeof CVTypes;
export type RGBAImage = { data: Uint8ClampedArray; width: number; height: number };

export const OUT_W = 1600;
export const OUT_H = 900;

const PAPER: [number, number, number] = [0xf3, 0xee, 0xe3];
const INK: [number, number, number] = [0x14, 0x14, 0x14];

export type VisionResult = {
  /** Clean ink on warm paper, OUT_W×OUT_H. */
  clean: RGBAImage;
  /** Clean image with numbered boxes, OUT_W×OUT_H. */
  som: RGBAImage;
  marks: Mark[];
  paperDetected: boolean;
  ms: number;
};

export function processDrawing(cv: CV, input: RGBAImage): VisionResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T) => (trash.push(m), m);
  try {
    const src = keep(cv.matFromImageData(input as unknown as ImageData));
    // Work at ≤1600px on the long side.
    const scale = Math.min(1, 1600 / Math.max(src.cols, src.rows));
    const rgba = keep(new cv.Mat());
    cv.resize(src, rgba, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA);

    const { warped, detected, content } = warpPaper(cv, rgba, keep);

    // ---- normalize lighting: divide by a heavily blurred background estimate
    const gray = keep(new cv.Mat());
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const bg = keep(new cv.Mat());
    const bgKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(31, 31));
    trash.push(bgKernel);
    cv.morphologyEx(gray, bg, cv.MORPH_CLOSE, bgKernel); // remove ink
    cv.GaussianBlur(bg, bg, new cv.Size(0, 0), 15);
    const norm = keep(new cv.Mat());
    cv.divide(gray, bg, norm, 255);

    // ---- ink mask
    const mask = keep(new cv.Mat());
    cv.adaptiveThreshold(norm, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 18);
    const dark = keep(new cv.Mat());
    cv.threshold(norm, dark, 200, 255, cv.THRESH_BINARY_INV); // must also be genuinely dark
    cv.bitwise_and(mask, dark, mask);
    const k3 = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k3);
    removeSpecks(cv, mask, 40, keep);
    removeFrameArtifacts(cv, mask, content, keep);

    const clean = renderClean(norm, mask);
    const marks = findMarks(cv, mask, keep);
    const som = renderSom(cv, clean, marks, keep);

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { clean, som, marks, paperDetected: detected, ms: Math.round(t1 - t0) };
  } finally {
    for (const m of trash) {
      try { m.delete(); } catch { /* already freed */ }
    }
  }
}

/* ---------------- paper detection ---------------- */

type Keep = <T extends { delete(): void }>(m: T) => T;

type Rect = { x: number; y: number; w: number; h: number };

function warpPaper(cv: CV, rgba: CVTypes.Mat, keep: Keep): { warped: CVTypes.Mat; detected: boolean; content: Rect } {
  const quad = findPaperQuad(cv, rgba, keep);
  const warped = keep(new cv.Mat());
  const dsize = new cv.Size(OUT_W, OUT_H);
  if (quad) {
    const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()));
    const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, OUT_W, 0, OUT_W, OUT_H, 0, OUT_H]));
    const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
    cv.warpPerspective(rgba, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return { warped, detected: true, content: { x: 0, y: 0, w: OUT_W, h: OUT_H } };
  }
  // Fallback: fit the whole frame into 16:9 and pad with paper colour, so a
  // wide or tall page never loses its edges (a crop cut off the P or the goal).
  const s = Math.min(OUT_W / rgba.cols, OUT_H / rgba.rows);
  const w = Math.min(OUT_W, Math.round(rgba.cols * s));
  const h = Math.min(OUT_H, Math.round(rgba.rows * s));
  const fitted = keep(new cv.Mat());
  cv.resize(rgba, fitted, new cv.Size(w, h), 0, 0, s < 1 ? cv.INTER_AREA : cv.INTER_LINEAR);
  const top = Math.floor((OUT_H - h) / 2);
  const left = Math.floor((OUT_W - w) / 2);
  cv.copyMakeBorder(fitted, warped, top, OUT_H - h - top, left, OUT_W - w - left, cv.BORDER_CONSTANT, paperColour(cv, rgba, keep));
  return { warped, detected: false, content: { x: left, y: top, w, h } };
}

/** Mean colour of the brightest frame border: the best guess at the paper. */
function paperColour(cv: CV, rgba: CVTypes.Mat, keep: Keep): CVTypes.Scalar {
  let best = [255, 255, 255, 255];
  let bestL = -1;
  for (const r of borderRects(cv, rgba.cols, rgba.rows)) {
    const roi = keep(rgba.roi(r));
    const m = cv.mean(roi);
    const l = m[0] + m[1] + m[2];
    if (l > bestL) {
      bestL = l;
      best = [m[0], m[1], m[2], 255];
    }
  }
  return new cv.Scalar(best[0], best[1], best[2], best[3]);
}

/** Thin strips along the four frame edges (top, right, bottom, left). */
function borderRects(cv: CV, w: number, h: number): CVTypes.Rect[] {
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  return [new cv.Rect(0, 0, w, t), new cv.Rect(w - t, 0, t, h), new cv.Rect(0, h - t, w, t), new cv.Rect(0, 0, t, h)];
}

/**
 * Largest 4-point contour covering ≥20% of the frame that actually looks like
 * a sheet, ordered TL,TR,BR,BL. Null when the page fills the frame (scans,
 * screenshots, digital drawings) or nothing sheet-like is found.
 */
function findPaperQuad(cv: CV, rgba: CVTypes.Mat, keep: Keep): [number, number][] | null {
  const gray = keep(new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(7, 7), 0);
  const frameArea = rgba.cols * rgba.rows;

  // Bright on ≥3 borders → the paper runs off the frame; there is no edge to find.
  const brightBorders = borderRects(cv, gray.cols, gray.rows).filter((r) => cv.mean(keep(gray.roi(r)))[0] > 190).length;
  if (brightBorders >= 3) return null;

  // Real sheet edges coincide with image edges; the hull of a big ink blob
  // mostly runs across blank paper.
  const edgeMap = keep(new cv.Mat());
  cv.Canny(gray, edgeMap, 40, 120);
  const k9 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
  cv.dilate(edgeMap, edgeMap, k9);
  const sideCoverage = (a: [number, number], b: [number, number]) => {
    const N = 48;
    let hit = 0;
    for (let i = 0; i <= N; i++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * i) / N);
      const y = Math.round(a[1] + ((b[1] - a[1]) * i) / N);
      if (x >= 0 && y >= 0 && x < edgeMap.cols && y < edgeMap.rows && edgeMap.ucharAt(y, x) > 0) hit++;
    }
    return hit / (N + 1);
  };
  const looksLikeSheet = (q: [number, number][]) => {
    const d = (p: [number, number], r: [number, number]) => Math.hypot(p[0] - r[0], p[1] - r[1]);
    const [tl, tr, br, bl] = q;
    const ratio = (d(tl, tr) + d(bl, br)) / Math.max(1, d(tl, bl) + d(tr, br));
    if (ratio < 0.45 || ratio > 2.4) return false;
    return [sideCoverage(tl, tr), sideCoverage(tr, br), sideCoverage(br, bl), sideCoverage(bl, tl)].every((c) => c >= 0.6);
  };

  const tryMask = (bin: CVTypes.Mat): [number, number][] | null => {
    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best: [number, number][] | null = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = keep(contours.get(i));
      const area = cv.contourArea(c);
      if (area < frameArea * 0.2 || area <= bestArea) continue;
      // A quad that is just the whole frame means "no paper edge visible".
      if (area > frameArea * 0.97) continue;
      const approx = keep(new cv.Mat());
      const hull = keep(new cv.Mat());
      cv.convexHull(c, hull);
      cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
      if (approx.rows !== 4) continue;
      const pts: [number, number][] = [];
      for (let j = 0; j < 4; j++) pts.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
      const q = orderCorners(pts);
      if (!looksLikeSheet(q)) continue;
      best = q;
      bestArea = area;
    }
    return best;
  };

  const otsu = keep(new cv.Mat());
  cv.threshold(gray, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  const k = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15)));
  cv.morphologyEx(otsu, otsu, cv.MORPH_CLOSE, k); // swallow ink so the sheet is one blob
  const q1 = tryMask(otsu);
  if (q1) return q1;

  const edges = keep(new cv.Mat());
  cv.Canny(gray, edges, 40, 120);
  cv.dilate(edges, edges, k);
  return tryMask(edges);
}

function orderCorners(pts: [number, number][]): [number, number][] {
  const sum = pts.map(([x, y]) => x + y);
  const diff = pts.map(([x, y]) => x - y);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.max(...diff))];
  const bl = pts[diff.indexOf(Math.min(...diff))];
  return [tl, tr, br, bl];
}

/* ---------------- cleaning ---------------- */

function removeSpecks(cv: CV, mask: CVTypes.Mat, minArea: number, keep: Keep): void {
  const labels = keep(new cv.Mat());
  const stats = keep(new cv.Mat());
  const cents = keep(new cv.Mat());
  const n = cv.connectedComponentsWithStats(mask, labels, stats, cents, 8, cv.CV_32S);
  const small = new Uint8Array(n);
  for (let i = 1; i < n; i++) small[i] = stats.intAt(i, cv.CC_STAT_AREA) < minArea ? 1 : 0;
  const L = labels.data32S;
  const M = mask.data;
  for (let p = 0; p < L.length; p++) if (small[L[p]]) M[p] = 0;
}

/**
 * Drop long thin ink strips hugging the picture's edge: a drawing app's canvas
 * border, window chrome, the table edge of a photo. They otherwise glue every
 * doodle that touches them into one giant mark.
 */
function removeFrameArtifacts(cv: CV, mask: CVTypes.Mat, r: Rect, keep: Keep): void {
  const labels = keep(new cv.Mat());
  const stats = keep(new cv.Mat());
  const n = cv.connectedComponentsWithStats(mask, labels, stats, keep(new cv.Mat()), 8, cv.CV_32S);
  const m = Math.max(4, Math.round(Math.min(r.w, r.h) * 0.015));
  const drop = new Uint8Array(n);
  let any = false;
  for (let i = 1; i < n; i++) {
    const x = stats.intAt(i, cv.CC_STAT_LEFT);
    const y = stats.intAt(i, cv.CC_STAT_TOP);
    const w = stats.intAt(i, cv.CC_STAT_WIDTH);
    const h = stats.intAt(i, cv.CC_STAT_HEIGHT);
    const nearLR = x <= r.x + m || x + w >= r.x + r.w - m;
    const nearTB = y <= r.y + m || y + h >= r.y + r.h - m;
    // The strip itself: along a vertical edge, narrow and tall …
    const vStrip = nearLR && (x <= r.x + m ? x + w <= r.x + 3 * m : x >= r.x + r.w - 3 * m) && h > r.h * 0.3;
    // … or along a horizontal edge, flat and wide.
    const hStrip = nearTB && (y <= r.y + m ? y + h <= r.y + 3 * m : y >= r.y + r.h - 3 * m) && w > r.w * 0.3;
    if (vStrip || hStrip) {
      drop[i] = 1;
      any = true;
    }
  }
  if (!any) {
    // A border often touches a doodle, making one component; peel the edge
    // band off instead so the doodle survives.
    peelEdgeBand(mask, r, m);
    return;
  }
  const L = labels.data32S;
  const M = mask.data;
  for (let p = 0; p < L.length; p++) if (drop[L[p]]) M[p] = 0;
  peelEdgeBand(mask, r, m);
}

/** Clear ink inside a thin band along the picture edge when it runs most of that edge. */
function peelEdgeBand(mask: CVTypes.Mat, r: Rect, m: number): void {
  const M = mask.data;
  const W = mask.cols;
  const colInk = (x: number) => {
    let c = 0;
    for (let y = r.y; y < r.y + r.h; y++) if (M[y * W + x]) c++;
    return c / r.h;
  };
  const rowInk = (y: number) => {
    let c = 0;
    for (let x = r.x; x < r.x + r.w; x++) if (M[y * W + x]) c++;
    return c / r.w;
  };
  const band = Math.min(m, 12);
  for (let d = 0; d < band; d++) {
    for (const x of [r.x + d, r.x + r.w - 1 - d]) if (colInk(x) > 0.5) for (let y = r.y; y < r.y + r.h; y++) M[y * W + x] = 0;
    for (const y of [r.y + d, r.y + r.h - 1 - d]) if (rowInk(y) > 0.5) for (let x = r.x; x < r.x + r.w; x++) M[y * W + x] = 0;
  }
}

/** Ink-on-paper rendering with soft, anti-aliased strokes. */
function renderClean(norm: CVTypes.Mat, mask: CVTypes.Mat): RGBAImage {
  const out = new Uint8ClampedArray(OUT_W * OUT_H * 4);
  const N = norm.data;
  const M = mask.data;
  for (let p = 0; p < N.length; p++) {
    // Darkness ramp; only pixels near a confirmed ink pixel may darken.
    let a = (215 - N[p]) / 110;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    if (!M[p]) a *= 0.35;
    const o = p * 4;
    out[o] = PAPER[0] + (INK[0] - PAPER[0]) * a;
    out[o + 1] = PAPER[1] + (INK[1] - PAPER[1]) * a;
    out[o + 2] = PAPER[2] + (INK[2] - PAPER[2]) * a;
    out[o + 3] = 255;
  }
  return { data: out, width: OUT_W, height: OUT_H };
}

/* ---------------- marks ---------------- */

type RawMark = { x0: number; y0: number; x1: number; y1: number; area: number; label: number; isLine: boolean };

function findMarks(cv: CV, mask: CVTypes.Mat, keep: Keep): Mark[] {
  // 1. Long horizontal-ish strokes → their own marks (so a cactus standing on
  //    the ground is not merged with the ground).
  const thick = keep(new cv.Mat());
  cv.dilate(mask, thick, keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, 5))));
  // Open with line kernels at 0°, ±15° and ±30° so hills and ramps count as
  // ground too (a P standing on a slope used to merge with it).
  const lines = keep(cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8U));
  const opened = keep(new cv.Mat());
  for (const deg of [0, 15, -15, 30, -30]) {
    cv.morphologyEx(thick, opened, cv.MORPH_OPEN, lineKernel(cv, 45, deg, keep));
    cv.bitwise_or(lines, opened, lines);
  }
  cv.morphologyEx(lines, lines, cv.MORPH_CLOSE, keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 1))));
  cv.bitwise_and(lines, thick, lines);

  const lineLabels = keep(new cv.Mat());
  const lineStats = keep(new cv.Mat());
  const lineCents = keep(new cv.Mat());
  const nLines = cv.connectedComponentsWithStats(lines, lineLabels, lineStats, lineCents, 8, cv.CV_32S);
  const LL = lineLabels.data32S;
  const lineMask = keep(cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8U));
  const isLongLine = new Uint8Array(nLines);
  for (let i = 1; i < nLines; i++) {
    const w = lineStats.intAt(i, cv.CC_STAT_WIDTH);
    const h = lineStats.intAt(i, cv.CC_STAT_HEIGHT);
    isLongLine[i] = w >= OUT_W * 0.06 && w > h * 4 ? 1 : 0;
  }
  // Sloped kernels also catch the sides of zigzags; spikes keep their own mark.
  rejectJagged(cv, lineLabels.data32S, lineStats, nLines, isLongLine);
  const LM = lineMask.data;
  const MK = mask.data;
  for (let p = 0; p < LL.length; p++) if (isLongLine[LL[p]] && MK[p]) LM[p] = 255;

  // 2. Everything else: group nearby ink (letters of a word, parts of a doodle).
  const groupKernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(37, 15)));
  const objects = keep(new cv.Mat());
  const lineHalo = keep(new cv.Mat());
  cv.dilate(lineMask, lineHalo, keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 5))));
  cv.bitwise_not(lineHalo, lineHalo);
  cv.bitwise_and(mask, lineHalo, objects);
  const grouped = keep(new cv.Mat());
  cv.dilate(objects, grouped, groupKernel);
  let objLabels = keep(new cv.Mat());
  let objStats = keep(new cv.Mat());
  let nObj = cv.connectedComponentsWithStats(grouped, objLabels, objStats, keep(new cv.Mat()), 8, cv.CV_32S);

  // 2b. A "line" that is really an edge of a doodle (dog's back, cloud base,
  //     trampoline top) is mostly covered by that doodle → give it back.
  const absorbed = absorbEdges(cv, lineLabels.data32S, lineStats, nLines, isLongLine, objLabels.data32S, objStats, nObj);
  if (absorbed.size > 0) {
    const OB = objects.data;
    for (let p = 0; p < LL.length; p++) {
      if (absorbed.has(LL[p]) && MK[p]) {
        LM[p] = 0;
        OB[p] = 255;
      }
    }
    for (const l of absorbed) isLongLine[l] = 0;
    cv.dilate(objects, grouped, groupKernel);
    objLabels = keep(new cv.Mat());
    objStats = keep(new cv.Mat());
    nObj = cv.connectedComponentsWithStats(grouped, objLabels, objStats, keep(new cv.Mat()), 8, cv.CV_32S);
  }

  // 3. Tight bboxes from real ink pixels.
  const lineBoxes = tightBoxes(lineLabels.data32S, LM, nLines, true);
  const objBoxes = tightBoxes(objLabels.data32S, objects.data, nObj, false);
  let raw = [...lineBoxes, ...objBoxes].filter((r) => r.area >= 60);

  // 4. Cap: keep lines first (they are the level), then biggest objects.
  if (raw.length > MAX_MARKS) {
    raw = raw.sort((a, b) => Number(b.isLine) - Number(a.isLine) || b.area - a.area).slice(0, MAX_MARKS);
  }

  // 5. Reading order → stable ids.
  raw.sort((a, b) => Math.round(a.y0 / 90) - Math.round(b.y0 / 90) || a.x0 - b.x0);

  return raw.map((r, i) => {
    const wPx = r.x1 - r.x0 + 1;
    const hPx = r.y1 - r.y0 + 1;
    const labels = r.isLine ? lineLabels.data32S : objLabels.data32S;
    const ink = r.isLine ? LM : objects.data;
    return {
      id: i + 1,
      bbox: { x: r.x0 / OUT_W, y: r.y0 / OUT_H, w: wPx / OUT_W, h: hPx / OUT_H },
      area: r.area / (OUT_W * OUT_H),
      aspect: wPx / hPx,
      polyline: topProfile(labels, ink, r),
      zigzag: isZigzagInk(labels, ink, r),
    };
  });
}

/** A straight line of length `len` at `deg` degrees, as a morphology kernel. */
function lineKernel(cv: CV, len: number, deg: number, keep: Keep): CVTypes.Mat {
  if (deg === 0) return keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(len, 1)));
  const a = (deg * Math.PI) / 180;
  const w = Math.max(1, Math.round(Math.abs(Math.cos(a)) * len));
  const h = Math.max(1, Math.round(Math.abs(Math.sin(a)) * len));
  const k = keep(cv.Mat.zeros(h, w, cv.CV_8U));
  const up = deg > 0;
  cv.line(k, new cv.Point(0, up ? h - 1 : 0), new cv.Point(w - 1, up ? 0 : h - 1), new cv.Scalar(1), 1);
  return k;
}

/**
 * Un-mark "lines" whose top edge keeps flipping between rising and falling:
 * those are zigzags (spikes), not ground. Hills and ramps flip a few times.
 */
function rejectJagged(cv: CV, labels: Int32Array, stats: CVTypes.Mat, n: number, isLongLine: Uint8Array): void {
  const STEP = 12;
  for (let l = 1; l < n; l++) {
    if (!isLongLine[l]) continue;
    const x0 = stats.intAt(l, cv.CC_STAT_LEFT);
    const y0 = stats.intAt(l, cv.CC_STAT_TOP);
    const w = stats.intAt(l, cv.CC_STAT_WIDTH);
    const h = stats.intAt(l, cv.CC_STAT_HEIGHT);
    const tops: number[] = [];
    for (let x = x0; x < x0 + w; x += STEP) {
      for (let y = y0; y < y0 + h; y++) {
        if (labels[y * OUT_W + x] === l) {
          tops.push(y);
          break;
        }
      }
    }
    let flips = 0;
    let dir = 0;
    for (let i = 1; i < tops.length; i++) {
      const d = tops[i] - tops[i - 1];
      if (Math.abs(d) < 4) continue;
      const s = Math.sign(d);
      if (dir !== 0 && s !== dir) flips++;
      dir = s;
    }
    if (flips > Math.max(3, w / 160)) isLongLine[l] = 0;
  }
}

/** Line labels whose horizontal span is ≥75% covered by doodles touching them. */
function absorbEdges(
  cv: CV,
  lineLabels: Int32Array, lineStats: CVTypes.Mat, nLines: number, isLongLine: Uint8Array,
  objLabels: Int32Array, objStats: CVTypes.Mat, nObj: number,
): Set<number> {
  const out = new Set<number>();
  // Dilation adds ~half the kernel width on each side of a group's bbox.
  const GROW = 18;
  for (let l = 1; l < nLines; l++) {
    if (!isLongLine[l]) continue;
    const lx = lineStats.intAt(l, cv.CC_STAT_LEFT);
    const ly = lineStats.intAt(l, cv.CC_STAT_TOP);
    const lw = lineStats.intAt(l, cv.CC_STAT_WIDTH);
    const lh = lineStats.intAt(l, cv.CC_STAT_HEIGHT);
    const touching = new Set<number>();
    const yA = Math.max(0, ly - 6);
    const yB = Math.min(OUT_H - 1, ly + lh + 6);
    for (let y = yA; y <= yB; y += 2) {
      for (let x = lx; x < lx + lw; x += 2) {
        const o = objLabels[y * OUT_W + x];
        if (o > 0) touching.add(o);
      }
    }
    if (touching.size === 0) continue;
    // Union of touching objects' x-ranges, clipped to the line.
    const spans = [...touching]
      .map((o) => {
        const ox = objStats.intAt(o, cv.CC_STAT_LEFT) + GROW;
        const ow = objStats.intAt(o, cv.CC_STAT_WIDTH) - 2 * GROW;
        return [Math.max(lx, ox), Math.min(lx + lw, ox + ow)] as [number, number];
      })
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -1;
    for (const [a, b] of spans) {
      if (b <= end) continue;
      covered += b - Math.max(a, end);
      end = b;
    }
    // Short line with doodle ink at both ends = an edge of a box-like doodle.
    const touchesLeft = spans.some(([a]) => a <= lx + lw * 0.2);
    const touchesRight = spans.some(([, b]) => b >= lx + lw * 0.8);
    const shortEdge = lw < OUT_W * 0.15 && touchesLeft && touchesRight;
    // A line spanning a big chunk of the page is ground, even when a long
    // zigzag or hill runs along it (it would swallow the P standing on it).
    const edgeSized = lw < OUT_W * 0.3;
    if ((edgeSized && covered >= lw * 0.75) || shortEdge) out.add(l);
  }
  void nObj;
  return out;
}

function tightBoxes(labels: Int32Array, ink: Uint8Array, n: number, isLine: boolean): RawMark[] {
  const boxes: RawMark[] = [];
  const x0 = new Int32Array(n).fill(OUT_W);
  const y0 = new Int32Array(n).fill(OUT_H);
  const x1 = new Int32Array(n).fill(-1);
  const y1 = new Int32Array(n).fill(-1);
  const area = new Int32Array(n);
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (l === 0 || !ink[p]) continue;
    const x = p % OUT_W;
    const y = (p / OUT_W) | 0;
    if (x < x0[l]) x0[l] = x;
    if (x > x1[l]) x1[l] = x;
    if (y < y0[l]) y0[l] = y;
    if (y > y1[l]) y1[l] = y;
    area[l]++;
  }
  for (let l = 1; l < n; l++) {
    if (area[l] === 0) continue;
    boxes.push({ x0: x0[l], y0: y0[l], x1: x1[l], y1: y1[l], area: area[l], label: l, isLine });
  }
  return boxes;
}

/** Top-most ink y per column band → walkable surface polyline (normalized). */
function topProfile(labels: Int32Array, ink: Uint8Array, r: RawMark): [number, number][] {
  const wPx = r.x1 - r.x0 + 1;
  const n = Math.max(2, Math.min(24, Math.round(wPx / 24)));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const cx0 = r.x0 + Math.floor((i * wPx) / n);
    const cx1 = r.x0 + Math.floor(((i + 1) * wPx) / n) - 1;
    let top = -1;
    for (let y = r.y0; y <= r.y1 && top < 0; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const p = y * OUT_W + x;
        if (labels[p] === r.label && ink[p]) { top = y; break; }
      }
    }
    if (top >= 0) {
      const x = i === 0 ? r.x0 : i === n - 1 ? r.x1 : (cx0 + cx1) / 2;
      pts.push([round4(x / OUT_W), round4(top / OUT_H)]);
    }
  }
  return pts.length >= 2 ? pts : [[round4(r.x0 / OUT_W), round4(r.y0 / OUT_H)], [round4(r.x1 / OUT_W), round4(r.y0 / OUT_H)]];
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Full-resolution check (the polyline is too coarse: teeth alias away).
 * Walk the top edge every 3 px; count swings that cover ≥60% of the mark's
 * height. Spikes swing many times; words, cacti and trampolines don't.
 */
function isZigzagInk(labels: Int32Array, ink: Uint8Array, r: RawMark): boolean {
  const wPx = r.x1 - r.x0 + 1;
  const hPx = r.y1 - r.y0 + 1;
  if (wPx < hPx * 1.2 || hPx < 12) return false;
  const min = hPx * 0.6;
  let swings = 0;
  let dir = 0;
  let extreme = -1;
  for (let x = r.x0; x <= r.x1; x += 3) {
    let top = -1;
    for (let y = r.y0; y <= r.y1; y++) {
      const p = y * OUT_W + x;
      if (labels[p] === r.label && ink[p]) {
        top = y;
        break;
      }
    }
    if (top < 0) continue;
    if (extreme < 0) {
      extreme = top;
      continue;
    }
    const d = top - extreme;
    if (dir === 0 || Math.sign(d) === dir) {
      // still moving the same way (or undecided): extend the extreme
      if (dir === 0 ? Math.abs(d) >= min : (dir > 0 ? top > extreme : top < extreme)) {
        if (dir === 0) {
          dir = Math.sign(d);
          swings++;
        }
        extreme = top;
      }
    } else if (Math.abs(d) >= min) {
      dir = -dir;
      swings++;
      extreme = top;
    }
  }
  return swings >= 4;
}

/* ---------------- set-of-marks ---------------- */

function renderSom(cv: CV, clean: RGBAImage, marks: Mark[], keep: Keep): RGBAImage {
  const img = keep(cv.matFromImageData(clean as unknown as ImageData));
  const box = new cv.Scalar(255, 74, 28, 255);
  const white = new cv.Scalar(255, 255, 255, 255);
  const font = cv.FONT_HERSHEY_SIMPLEX;
  const rects = marks.map((m) => ({
    x: Math.round(m.bbox.x * OUT_W) - 4,
    y: Math.round(m.bbox.y * OUT_H) - 4,
    w: Math.round(m.bbox.w * OUT_W) + 8,
    h: Math.round(m.bbox.h * OUT_H) + 8,
  }));
  for (const r of rects) cv.rectangle(img, new cv.Point(r.x, r.y), new cv.Point(r.x + r.w, r.y + r.h), box, 2, cv.LINE_AA);
  // Tags drawn after all boxes; pick the first spot that doesn't hit another tag.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const hits = (a: { x: number; y: number; w: number; h: number }) =>
    placed.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  marks.forEach((m, i) => {
    const r = rects[i];
    const label = String(m.id);
    const tw = 17 * label.length + 10;
    const th = 30;
    const candidates = [
      { x: r.x, y: r.y - th },
      { x: r.x + r.w - tw, y: r.y - th },
      { x: r.x - tw, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h },
      { x: r.x, y: r.y },
    ].map((c) => ({ x: Math.max(0, Math.min(OUT_W - tw, c.x)), y: Math.max(0, Math.min(OUT_H - th, c.y)), w: tw, h: th }));
    const t = candidates.find((c) => !hits(c)) ?? candidates[0];
    placed.push(t);
    cv.rectangle(img, new cv.Point(t.x, t.y), new cv.Point(t.x + tw, t.y + th), box, -1);
    cv.putText(img, label, new cv.Point(t.x + 5, t.y + th - 7), font, 0.85, white, 2, cv.LINE_AA);
  });
  return { data: new Uint8ClampedArray(img.data), width: OUT_W, height: OUT_H };
}
