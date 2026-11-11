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
  const found = detectFormat(text);
  if (found) {
    raw = found.adapter.read(text).points;
    source = found.adapter.id;
  } else {
    raw = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const t = line.trim();
      if (!t || /^(\*|#|;|\/\/)/.test(t)) continue;
      const parts = t.split(/[\t ;,]+/);
      if (parts.length < 2 || !NUMBER.test(parts[0]) || !NUMBER.test(parts[1])) continue;
      raw.push([Number(parts[0]), Number(parts[1])]);
    }
  }
  const good = raw.filter(([f, g]) => Number.isFinite(f) && f > 0 && Number.isFinite(g));
  if (good.length < raw.length) warnings.push(`${raw.length - good.length} rows were skipped (no positive frequency or level).`);
  good.sort((a, b) => a[0] - b[0]);
  let points = good.filter((p, i) => i === 0 || p[0] !== good[i - 1][0]);
  if (points.length < good.length) warnings.push(`${good.length - points.length} rows with a repeated frequency were dropped.`);
  if (points.length < 2) throw new Error("No frequency and level pairs were found. A trace needs at least 2 rows of Hz and dB.");
  if (points.length > MAX_TRACE_POINTS) {
    const before = points.length;
    points = binTo48(points);
    warnings.push(`The trace had ${before} points, so it was averaged to ${points.length} (1/48 octave).`);
  }
  return { points, warnings, source };
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

/**
 * The trace as it is drawn: smoothed, then (if asked) shifted so it reads 0 dB at 1 kHz, then moved by the offset.
 * Smoothing replaces the level at each of the trace's own frequencies with the exact average of the dB values over a
 * window 1/N octave wide centred there.
 * @param {{points: number[][], offset?: number, smooth?: number, normalise?: boolean}} t
 * @returns {number[][]} [[hz, db], ...]
 */
export function traceCurve(t) {
  const pts = t.points;
  const xs = pts.map((p) => Math.log2(p[0]));
  const ys = pts.map((p) => p[1]);
  const n = Number(t.smooth) || 0;
  const sm = n > 0 ? xs.map((x) => windowAverage(xs, ys, x, 1 / (2 * n))) : ys;
  let shift = Number(t.offset) || 0;
  if (t.normalise === true && xs[0] <= Math.log2(1000) && xs[xs.length - 1] >= Math.log2(1000)) shift -= levelAtX(xs, sm, Math.log2(1000));
  return pts.map((p, i) => [p[0], round6(sm[i] + shift)]);
}
