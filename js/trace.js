// Reference traces (SPEC §10): a measured or exported curve shown behind the target, never exported.
// Pure: no DOM. Reads Smaart .crv files and any text with a frequency and a level on each line, and applies
// smoothing, an offset and a 0 dB at 1 kHz option for display.
import { detectFormat } from "./formats/index.js";
import { round6 } from "./curve.js";

/** Most points a trace keeps. A longer one (an FFT export) is averaged into 1/48-octave bins on import. */
export const MAX_TRACE_POINTS = 1200;
/** Largest text read as a trace. */
export const MAX_TRACE_TEXT = 5_000_000;
/** Smoothing choices: 0 is off, otherwise the width is 1/N octave. */
export const TRACE_SMOOTHINGS = [0, 1, 3, 6, 12, 24, 48];
/** The allowed offset, dB. */
export const TRACE_OFFSET_LIMIT = 60;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Average points into 1/48-octave bins (geometric mean frequency, mean level). */
function binTo48(points) {
  const bins = new Map();
  for (const [f, g] of points) {
    const k = Math.round(48 * Math.log2(f));
    const b = bins.get(k) ?? { lf: 0, g: 0, n: 0 };
    b.lf += Math.log2(f);
    b.g += g;
    b.n += 1;
    bins.set(k, b);
  }
  const out = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => [round6(2 ** (b.lf / b.n)), round6(b.g / b.n)]);
  // rounding to 6 decimals can turn a tiny frequency into 0 or into its neighbour's: keep positive, distinct ones only
  return out.filter((p, i) => p[0] > 0 && (i === 0 || p[0] !== out[i - 1][0]));
}

/**
 * Read a trace from file text. A Smaart .crv (target or spectrum) is read as that; anything else is read line by
 * line: the first two numbers on a line are the frequency and the level (separated by tabs, spaces, commas or
 * semicolons), and lines that don't start with two numbers (headers, comments) are skipped.
 * @param {string} text
 * @returns {{points: number[][], warnings: string[], source: string}} points ascending by frequency, no duplicates
 */
export function parseTrace(text) {
  if (typeof text !== "string" || text.length > MAX_TRACE_TEXT) throw new Error("That file is too large to be a trace.");
  const warnings = [];
  let raw;
  let source = "text";
  let tf = null;
  const found = detectFormat(text);
  if (found) {
    raw = found.adapter.read(text).points;
    source = found.adapter.id;
  } else {
    raw = [];
    const lines = text.split(/\r\n|\r|\n/);
    const rows = []; // [freq, level, the row's cells as written]
    for (const line of lines) {
      const t = line.trim();
      if (!t || /^(\*|#|;|\/\/)/.test(t)) continue;
      const parts = t.split(/[\t ;,]+/);
      if (parts.length < 2 || !NUMBER.test(parts[0]) || !NUMBER.test(parts[1])) continue;
      rows.push([Number(parts[0]), Number(parts[1]), t.split("\t")]);
    }
    raw = rows;
    tf = readTfLayout(lines, rows, text);
  }
  const good = raw.filter(([f, g]) => Number.isFinite(f) && f > 0 && Number.isFinite(g));
  if (good.length < raw.length) warnings.push(`${raw.length - good.length} rows were skipped (no positive frequency or level).`);
  good.sort((a, b) => a[0] - b[0]);
  let kept = good.filter((p, i) => i === 0 || p[0] !== good[i - 1][0]);
  if (kept.length < good.length) warnings.push(`${good.length - kept.length} rows with a repeated frequency were dropped.`);
  if (kept.length < 2) throw new Error("No frequency and level pairs were found. A trace needs at least 2 rows of Hz and dB.");
  let points = kept.map((p) => [p[0], p[1]]);
  if (tf) tf = { ...tf, cells: kept.map((p) => p[2]) };
  if (points.length > MAX_TRACE_POINTS) {
    const before = points.length;
    points = binTo48(points);
    tf = null; // averaged points no longer line up with the file's own rows
    warnings.push(`The trace had ${before} points, so it was averaged to ${points.length} (1/48 octave), so it can't be downloaded back with the target.`);
  }
  return { points, warnings, source, ...(tf ? { tf } : {}) };
}

/** The most header lines kept to write a download back out. */
const MAX_HEAD_LINES = 4;

/**
 * Recognise a Smaart transfer function text export: a header row that starts "Frequency (Hz)", "Magnitude (dB)",
 * then every data row has the same tab-separated columns (phase, coherence...). Returns what is needed to write the
 * file back out in the same layout, or null for any other text.
 */
function readTfLayout(lines, rows, text) {
  if (rows.length < 2) return null;
  const cols = rows[0][2].length;
  if (cols < 3 || !rows.every((r) => r[2].length === cols && r[2].every((c) => NUMBER.test(c.trim())))) return null;
  const first = lines.findIndex((l) => l.trim() === rows[0][2].join("\t"));
  if (first < 1) return null;
  const head = lines.slice(Math.max(0, first - MAX_HEAD_LINES), first);
  const header = head.at(-1) ?? "";
  if (!/^\s*frequency\b[^\t]*\t\s*magnitude\b/i.test(header)) return null;
  if (header.split("\t").length !== cols) return null;
  const dp = Math.min(6, Math.max(...rows.map((r) => (r[2][1].trim().split(".")[1] ?? "").length)));
  return { head, dp, eol: text.includes("\r\n") ? "\r\n" : "\n", cells: [] };
}

/**
 * Check the saved file layout of a trace (from an autosave or a preset: untrusted) and keep the rows in `keep`
 * (the indexes the loader kept after sorting and dropping repeats). Returns null when anything is off.
 * @param {unknown} tf
 * @param {number} count how many points the saved trace had
 * @param {number[]} keep
 */
export function cleanTf(tf, count, keep) {
  if (tf === null || typeof tf !== "object" || !Array.isArray(tf.head) || !Array.isArray(tf.cells)) return null;
  if (tf.head.length < 1 || tf.head.length > MAX_HEAD_LINES || tf.cells.length !== count) return null;
  if (!tf.head.every((h) => typeof h === "string" && h.length <= 200 && !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(h))) return null;
  if (!Number.isInteger(tf.dp) || tf.dp < 0 || tf.dp > 6 || (tf.eol !== "\r\n" && tf.eol !== "\n")) return null;
  const width = tf.cells[0]?.length;
  if (!(width >= 3 && width <= 8)) return null;
  const ok = tf.cells.every((c) => Array.isArray(c) && c.length === width && c.every((s) => typeof s === "string" && s.length <= 24 && NUMBER.test(s.trim())));
  if (!ok) return null;
  return { head: tf.head.slice(), dp: tf.dp, eol: tf.eol, cells: keep.map((i) => tf.cells[i].map((s) => s.trim())) };
}

/**
 * Write a transfer function text trace back out with the target curve combined into its magnitude column, in the
 * same layout as the file it came from (same header lines, same columns, phase and coherence untouched).
 * The trace is as drawn: smoothed, normalised and offset. `target[i]` is the target's level in dB at points[i].
 * @param {{points: number[][], tf: {head: string[], dp: number, eol: string, cells: string[][]}, offset?: number, smooth?: number, normalise?: boolean}} t
 * @param {number[]} target dB, one per trace point
 * @param {boolean} subtract true gives trace - target (for a processor that inverts the trace); false gives trace + target
 * @returns {string}
 */
export function traceWithTarget(t, target, subtract = true) {
  const tf = t.tf;
  if (!tf || tf.cells.length !== t.points.length || target.length !== t.points.length) throw new Error("This trace has no layout to write back out.");
  const drawn = traceCurve(t);
  const sign = subtract ? -1 : 1;
  const out = tf.head.slice();
  tf.cells.forEach((cells, i) => {
    const db = drawn[i][1] + sign * target[i];
    if (!Number.isFinite(db)) throw new Error("The target gave a value that can't be written.");
    const text = db.toFixed(tf.dp);
    out.push([cells[0], /^-0(\.0*)?$/.test(text) ? text.slice(1) : text, ...cells.slice(2)].join("\t"));
  });
  return out.join(tf.eol) + tf.eol;
}

/** Level at log2-frequency `x` on the trace (a straight line between its points against log frequency; flat beyond its ends). */
function levelAtX(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

/** The exact average of the trace's level over log2-frequency [c - half, c + half] (trapezoids between its points). */
function windowAverage(xs, ys, c, half) {
  const a = c - half;
  const b = c + half;
  let i = 0;
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] <= a) lo = mid + 1; else hi = mid; }
  i = lo; // first point beyond the start of the window
  let sum = 0;
  let prevX = a;
  let prevY = levelAtX(xs, ys, a);
  for (; i < xs.length && xs[i] < b; i++) {
    sum += ((xs[i] - prevX) * (prevY + ys[i])) / 2;
    prevX = xs[i];
    prevY = ys[i];
  }
  sum += ((b - prevX) * (prevY + levelAtX(xs, ys, b))) / 2;
  return sum / (b - a);
}

/** Peak bias choices (the stored number is the index): how strongly peaks count against dips inside the smoothing window. */
export const PEAK_BIAS = [0, 0.1, 0.3, 1, Infinity];
export const PEAK_LABELS = ["Off (plain average)", "Light", "Medium", "Strong", "Peak hold"];
/** Frequency-dependent smoothing runs from the "at LF" width at 20 Hz to the main width at 20 kHz. */
const SMOOTH_F_LOW = 20;
const SMOOTH_F_HIGH = 20000;

/** Half the smoothing window, in octaves, at log2 frequency x: the width eases (against log frequency) from wLf at 20 Hz to wHf at 20 kHz. */
function halfWidth(x, wLf, wHf) {
  const a = Math.log2(SMOOTH_F_LOW);
  const u = Math.min(1, Math.max(0, (x - a) / (Math.log2(SMOOTH_F_HIGH) - a)));
  return (wLf + (wHf - wLf) * u) / 2;
}

/**
 * The level of the trace over log2-frequency [c - half, c + half], biased towards peaks by `beta` (per dB):
 * beta 0 is the plain average of the dB values (exact, as windowAverage); beta > 0 is the exponential ("soft maximum")
 * mean, (1/beta) ln(mean(exp(beta * dB))), which dips barely lower and peaks pull up; Infinity is the highest level in the window.
 * The trace is taken as straight lines between its points against log frequency and flat beyond its ends.
 */
function windowStat(xs, ys, c, half, beta) {
  if (!(half > 0)) return levelAtX(xs, ys, c);
  if (beta === 0) return windowAverage(xs, ys, c, half);
  const a = c - half;
  const b = c + half;
  const kx = [a];
  const ky = [levelAtX(xs, ys, a)];
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] <= a) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < xs.length && xs[i] < b; i++) { kx.push(xs[i]); ky.push(ys[i]); }
  kx.push(b);
  ky.push(levelAtX(xs, ys, b));
  const top = Math.max(...ky);
  if (beta === Infinity) return top;
  let sum = 0;
  for (let j = 0; j + 1 < kx.length; j++) {
    const d0 = beta * (ky[j] - top);
    const d1 = beta * (ky[j + 1] - top);
    const delta = d1 - d0;
    // integral of exp over a straight segment, kept small by measuring from the window's highest level
    sum += (kx[j + 1] - kx[j]) * Math.exp(d0) * (Math.abs(delta) < 1e-12 ? 1 : Math.expm1(delta) / delta);
  }
  return top + Math.log(sum / (b - a)) / beta;
}

/** Which column of a transfer function layout holds the coherence, or -1. */
function coherenceColumn(tf) {
  return tf ? (tf.head.at(-1) ?? "").split("\t").findIndex((h) => /^\s*coherence\b/i.test(h)) : -1;
}

/**
 * The coherence mask of a trace: with `cohOn` and a coherence column, the rows at or above `cohMin` are the ones used.
 * @returns {{available: boolean, active: boolean, total: number, kept: number, keep: boolean[]|null, idx: number[]|null}}
 *   `active` is false when the mask is off or would leave fewer than 2 rows (then every row is used).
 */
export function traceMask(t) {
  const total = t.points.length;
  const col = t.tf && t.tf.cells.length === total ? coherenceColumn(t.tf) : -1;
  const none = { available: col >= 0, active: false, total, kept: total, keep: null, idx: null };
  if (col < 0 || t.cohOn !== true) return none;
  const min = Math.min(1, Math.max(0, Number.isFinite(t.cohMin) ? t.cohMin : 0.5));
  const keep = t.tf.cells.map((c) => Number(c[col]) >= min);
  const idx = keep.flatMap((k, i) => (k ? [i] : []));
  if (idx.length < 2) return { ...none, kept: idx.length };
  return { available: true, active: true, total, kept: idx.length, keep, idx };
}

/**
 * The trace as it is drawn: smoothed, then (if asked) shifted so it reads 0 dB at 1 kHz, then moved by the offset.
 * Smoothing replaces the level at each of the trace's own frequencies with the exact average of the dB values over a
 * window 1/N octave wide centred there (`smooth` is N; `smoothLf`, when set, is the width at 20 Hz, easing to `smooth` at 20 kHz).
 * `peak` (an index into PEAK_BIAS) makes the window favour peaks over dips. Rows the coherence mask leaves out take no part
 * in the smoothing, and where there is no smoothing they are replaced by a straight line between their neighbours.
 * @param {{points: number[][], offset?: number, smooth?: number, smoothLf?: number|null, peak?: number, normalise?: boolean, cohOn?: boolean, cohMin?: number, tf?: object}} t
 * @returns {number[][]} [[hz, db], ...]
 */
export function traceCurve(t) {
  const pts = t.points;
  const xsAll = pts.map((p) => Math.log2(p[0]));
  const ysAll = pts.map((p) => p[1]);
  const mask = traceMask(t);
  const xs = mask.idx ? mask.idx.map((i) => xsAll[i]) : xsAll;
  const ys = mask.idx ? mask.idx.map((i) => ysAll[i]) : ysAll;
  const nHf = Number(t.smooth) || 0;
  const nLf = t.smoothLf === undefined || t.smoothLf === null ? nHf : Number(t.smoothLf) || 0;
  const wHf = nHf > 0 ? 1 / nHf : 0;
  const wLf = nLf > 0 ? 1 / nLf : 0;
  const beta = PEAK_BIAS[t.peak] ?? 0;
  let sm;
  if (wHf > 0 || wLf > 0) sm = xsAll.map((x) => windowStat(xs, ys, x, halfWidth(x, wLf, wHf), beta));
  else if (mask.active) sm = xsAll.map((x, i) => (mask.keep[i] ? ysAll[i] : levelAtX(xs, ys, x)));
  else sm = ysAll;
  let shift = Number(t.offset) || 0;
  if (t.normalise === true) {
    // the reference is the level at 1 kHz, or (normAvg) the average over 1 kHz to 4 kHz: the exact mean of the straight-line
    // trace against log frequency, so a region with many closely spaced points counts no more than one with few
    const lo = Math.log2(1000);
    const hi = t.normAvg === true ? Math.log2(4000) : lo;
    if (xsAll[0] <= lo && xsAll[xsAll.length - 1] >= hi) shift -= hi > lo ? windowAverage(xsAll, sm, (lo + hi) / 2, (hi - lo) / 2) : levelAtX(xsAll, sm, lo);
  }
  return pts.map((p, i) => [p[0], round6(sm[i] + shift)]);
}
