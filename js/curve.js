// Pure curve maths: frequency grids, octave positions, evaluation, rounding.
// No DOM access, no global state. See docs/SPEC.md §3, §4.6, §4.7.
import { layerDb } from "./layers.js";

/** Nominal ISO 1/3-octave labels, 20 Hz to 20 kHz. */
export const NOMINAL_3 = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

/** Nominal octave labels. */
export const NOMINAL_1 = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const INDEX_1K = NOMINAL_3.indexOf(1000);

/**
 * Octave position relative to 1 kHz. Nominal 1/3-octave labels snap to exact thirds
 * (63 Hz is exactly -4); any other frequency uses log2(f / 1000).
 * @param {number} f Frequency in Hz.
 * @returns {number} Position in octaves.
 */
export function pos(f) {
  for (let i = 0; i < NOMINAL_3.length; i++) {
    if (Math.abs(f - NOMINAL_3[i]) < 1e-9) return (i - INDEX_1K) / 3;
  }
  return Math.log2(f / 1000);
}

/**
 * Output frequencies for a resample grid.
 * @param {{fraction?: number, fmin?: number, fmax?: number}} grid
 * @returns {number[]}
 */
export function makeGrid(grid = {}) {
  const n = Number(grid.fraction ?? 3);
  const fmin = Number(grid.fmin ?? 20);
  const fmax = Number(grid.fmax ?? 20000);
  if (![1, 3, 6, 12, 24, 48].includes(n)) throw new RangeError(`Unsupported grid fraction ${grid.fraction}`);
  if (!(fmin > 0 && fmax >= fmin)) throw new RangeError(`Grid needs 0 < fmin <= fmax (got ${fmin}, ${fmax})`);
  if (n === 3 || n === 1) {
    const list = n === 3 ? NOMINAL_3 : NOMINAL_1;
    return list.filter((f) => f >= fmin - 1e-9 && f <= fmax + 1e-9);
  }
  const out = [];
  for (let k = Math.floor(n * Math.log2(fmin / 1000)) - 1; ; k++) {
    const f = 1000 * 2 ** (k / n);
    if (f > fmax * (1 + 1e-9)) break;
    if (f >= fmin * (1 - 1e-9)) out.push(round6(f));
  }
  return out;
}

/**
 * Round to 6 decimal places and never return -0.
 * @param {number} x
 * @returns {number}
 */
export function round6(x) {
  if (!Number.isFinite(x)) return x;
  // Exact 6-decimal ties are exactly the odd multiples of 1/128; round them half-to-even,
  // like Python's round(), so output matches reference/curve_ref.py byte for byte.
  const t = x * 128;
  let y;
  if (Number.isInteger(t) && t % 2 !== 0) {
    const lo = Math.floor(Math.abs(x) * 1e6);
    y = (Math.sign(x) * (lo % 2 === 0 ? lo : lo + 1)) / 1e6;
  } else {
    y = Number(x.toFixed(6));
  }
  return y + 0;
}

/**
 * Sum of all enabled layers at one frequency (no normalise, no rounding).
 * @param {number} f Frequency in Hz.
 * @param {object[]} layers
 * @returns {number} dB
 */
export function totalDb(f, layers) {
  let sum = 0;
  for (const layer of layers) if (layer.on === undefined || layer.on) sum += layerDb(f, layer);
  return sum;
}

/**
 * The frequency range the output and the plot cover: the trim when set (grid.trimLow / grid.trimHigh),
 * otherwise grid.fmin / grid.fmax (default 20 Hz to 20 kHz).
 * @param {{fmin?: number, fmax?: number, trimLow?: number, trimHigh?: number}} [grid]
 * @returns {[number, number]} [low, high] in Hz
 */
export function effectiveRange(grid = {}) {
  const lo = Number.isFinite(grid.trimLow) ? grid.trimLow : Number(grid.fmin ?? 20);
  const hi = Number.isFinite(grid.trimHigh) ? grid.trimHigh : Number(grid.fmax ?? 20000);
  return [lo, hi];
}

/** Default maximum error (dB) for the "simplified" grid; the allowed range is 0.001 to 12. */
export const DEFAULT_EPSILON = 0.1;

/**
 * Frequencies where an enabled layer has a corner: point frequencies, tilt pivots, corners and floors,
 * and filter corners.
 * @param {object[]} layers
 * @returns {number[]}
 */
export function keyFrequencies(layers) {
  const out = [];
  for (const l of layers) {
    if (l.on !== undefined && !l.on) continue;
    if (l.kind === "points") for (const p of l.points) out.push(p[0]);
    else {
      for (const k of ["pivot", "corner", "floor", "fc"]) if (l[k] != null) out.push(l[k]);
      if (l.kind === "shape" && Number(l.fc) > 0 && Number(l.width) > 0) {
        // the corners of a shape: its edges, and for a trapezoid the ends of the flat top
        const half = Number(l.width) / 2;
        const spans = l.shape === "trapezoid" ? [half, half * Math.min(0.99, Math.max(0, Number(l.flat ?? 0.5)))] : [half];
        for (const s of spans) out.push(l.fc * 2 ** -s, l.fc * 2 ** s);
        // the jumps of the square wave and the staircase are corners too
        const n = Number(l.count ?? 3);
        const jumps = l.shape === "square" ? Math.ceil(2 * n) : l.shape === "stairs" ? Math.max(2, Math.round(n)) : 0;
        for (let k = 1; k < jumps; k++) {
          const t = l.shape === "square" ? k / (2 * n) : k / jumps;
          out.push(l.fc * 2 ** (half * (2 * t - 1)));
        }
      }
    }
  }
  return out.map(Number).filter((f) => Number.isFinite(f) && f > 0);
}

/**
 * Keep only the points needed so that straight lines between them (against octave position) stay within
 * `epsilon` dB of the full curve. The first and last points are always kept (Ramer-Douglas-Peucker).
 * @param {number[][]} points [[hz, db], ...] in ascending frequency
 * @param {number} epsilon Maximum vertical error in dB.
 * @returns {number[][]}
 */
export function simplify(points, epsilon) {
  const n = points.length;
  if (n <= 2) return points.map((p) => [...p]);
  const x = points.map(([f]) => pos(f));
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const t = x[b] === x[a] ? 0 : (x[i] - x[a]) / (x[b] - x[a]);
      const err = Math.abs(points[i][1] - (points[a][1] + t * (points[b][1] - points[a][1])));
      if (err > worst) { worst = err; at = i; }
    }
    if (at >= 0 && worst > epsilon) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => [...p]);
}

/**
 * Dense frequency list used before simplifying: a 1/48-octave grid plus fmin, fmax and every layer corner.
 * @param {{grid?: object, layers: object[]}} doc
 * @returns {number[]}
 */
export function denseGrid(doc) {
  const g = doc.grid ?? {};
  const fmin = Number(g.fmin ?? 20);
  const fmax = Number(g.fmax ?? 20000);
  // Corners, deduplicated only when they are exactly the same after rounding to 6 decimals.
  const keys = [...new Set([fmin, fmax, ...keyFrequencies(doc.layers).filter((f) => f >= fmin && f <= fmax)].map(round6))];
  const keyPos = keys.map(pos);
  // 1/48-octave grid from the exact (unrounded) frequencies. A grid point is dropped when a corner sits at
  // the same octave position (62.5 Hz and 63 Hz are both -4 octaves) or within 1e-6 relative of it, so the
  // corner keeps the frequency the user typed. The comparison is in grid-index space so that 6-decimal
  // rounding of the grid frequency can't make a twin look different.
  const grid = [];
  for (let k = Math.floor(48 * Math.log2(fmin / 1000)) - 1; ; k++) {
    const f = 1000 * 2 ** (k / 48);
    if (f > fmax * (1 + 1e-9)) break;
    if (f < fmin * (1 - 1e-9)) continue;
    const rounded = round6(f);
    if (keys.some((key, i) => Math.abs(48 * keyPos[i] - k) < 1e-6 || Math.abs(key - f) <= 1e-6 * f)) continue;
    grid.push(rounded);
  }
  return [...grid, ...keys].sort((p, q) => p - q).filter((f, i, all) => i === 0 || f !== all[i - 1]);
}

/**
 * Evaluate a document to [hz, db] pairs, rounded to 6 decimals.
 * With no `freqs`: grid.mode "original" uses the imported frequencies in order, "simplified" keeps only
 * the points needed to stay within grid.epsilon dB (default 0.1) of the curve, otherwise the resample grid is used.
 * @param {{grid?: object, layers: object[], normalise?: {on: boolean, at: number}, original?: number[][]|null}} doc
 * @param {number[]} [freqs]
 * @returns {number[][]}
 */
export function evaluate(doc, freqs) {
  const grid = doc.grid ?? {};
  const simplified = !freqs && grid.mode === "simplified";
  if (!freqs) {
    // Trim (SPEC §3.5): the output covers only [lo, hi]. For the resample and simplified grids that is just the
    // grid range; for "original" the imported points outside it are dropped (and only when a trim is set).
    const [lo, hi] = effectiveRange(grid);
    const ranged = { ...grid, fmin: lo, fmax: hi };
    if (!(lo <= hi)) freqs = []; // an empty range (a trim past the other end of the grid) holds no points
    else if (simplified) freqs = denseGrid({ ...doc, grid: ranged });
    else if (grid.mode === "original" && doc.original) {
      freqs = doc.original.map((p) => p[0]).filter((f) => (!Number.isFinite(grid.trimLow) || f >= grid.trimLow) && (!Number.isFinite(grid.trimHigh) || f <= grid.trimHigh));
    } else freqs = makeGrid(ranged);
  }
  const layers = doc.layers;
  let out = freqs.map((f) => [f, totalDb(f, layers)]);
  const nm = doc.normalise;
  if (nm && nm.on) {
    const ref = totalDb(nm.at ?? 1000, layers);
    out = out.map(([f, g]) => [f, g - ref]);
  }
  if (simplified) {
    const eps = Number(grid.epsilon);
    const limit = eps >= 0.001 && eps <= 12 ? eps : DEFAULT_EPSILON;
    // Search with 1 µdB to spare so that rounding the output to 6 decimals can't push it past the limit.
    out = simplify(out, limit - 1e-6);
  }
  return out.map(([f, g]) => [f, round6(g)]);
}

/**
 * Each enabled layer's own contribution (the "ghost" of that layer) over the plot range, 20 Hz to 20 kHz on the
 * dense grid of SPEC §3.4 (so every layer corner is included). Inversion applies, normalise does not.
 * Layers that are switched off, or that fail to evaluate, are skipped.
 * @param {{layers: object[]}} doc
 * @returns {{id: string, index: number, kind: string, points: number[][]}[]} `index` is the layer's position in the list
 */
export function layerGhosts(doc) {
  let freqs;
  try {
    freqs = denseGrid({ grid: { fmin: 20, fmax: 20000 }, layers: doc.layers });
  } catch {
    return []; // a layer too broken to list its corners: the export check reports it
  }
  const out = [];
  doc.layers.forEach((layer, index) => {
    if (layer.on !== undefined && !layer.on) return;
    try {
      const points = freqs.map((f) => [f, layerDb(f, layer) + 0]);
      if (points.every((p) => Number.isFinite(p[1]))) out.push({ id: layer.id, index, kind: layer.kind, points });
    } catch {
      /* an invalid layer has no ghost; the export check reports it */
    }
  });
  return out;
}
