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

    const { warped, detected } = warpPaper(cv, rgba, keep);

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

function warpPaper(cv: CV, rgba: CVTypes.Mat, keep: Keep): { warped: CVTypes.Mat; detected: boolean } {
  const quad = findPaperQuad(cv, rgba, keep);
  const warped = keep(new cv.Mat());
  const dsize = new cv.Size(OUT_W, OUT_H);
  if (quad) {
    const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()));
    const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, OUT_W, 0, OUT_W, OUT_H, 0, OUT_H]));
    const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
    cv.warpPerspective(rgba, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return { warped, detected: true };
  }
  // Fallback: center-crop to 16:9.
  const target = 16 / 9;
  let w = rgba.cols;
  let h = rgba.rows;
  if (w / h > target) w = Math.round(h * target);
  else h = Math.round(w / target);
  const roi = rgba.roi(new cv.Rect(Math.round((rgba.cols - w) / 2), Math.round((rgba.rows - h) / 2), w, h));
  keep(roi);
  cv.resize(roi, warped, dsize, 0, 0, cv.INTER_AREA);
  return { warped, detected: false };
}

/** Largest bright 4-point contour covering ≥20% of the frame, ordered TL,TR,BR,BL. */
function findPaperQuad(cv: CV, rgba: CVTypes.Mat, keep: Keep): [number, number][] | null {
  const gray = keep(new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(7, 7), 0);
  const frameArea = rgba.cols * rgba.rows;

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
      best = orderCorners(pts);
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
  const lines = keep(new cv.Mat());
  cv.morphologyEx(thick, lines, cv.MORPH_OPEN, keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(45, 1))));
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
    };
  });
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
    if (covered >= lw * 0.75 || shortEdge) out.add(l);
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
