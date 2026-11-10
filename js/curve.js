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
 * Evaluate a document to [hz, db] pairs, rounded to 6 decimals.
 * With no `freqs`: grid.mode "original" uses the imported frequencies in order,
 * otherwise the resample grid is used.
 * @param {{grid?: object, layers: object[], normalise?: {on: boolean, at: number}, original?: number[][]|null}} doc
 * @param {number[]} [freqs]
 * @returns {number[][]}
 */
export function evaluate(doc, freqs) {
  const grid = doc.grid ?? {};
  if (!freqs) {
    freqs = grid.mode === "original" && doc.original
      ? doc.original.map((p) => p[0])
      : makeGrid(grid);
  }
  const layers = doc.layers;
  let out = freqs.map((f) => [f, totalDb(f, layers)]);
  const nm = doc.normalise;
  if (nm && nm.on) {
    const ref = totalDb(nm.at ?? 1000, layers);
    out = out.map(([f, g]) => [f, g - ref]);
  }
  return out.map(([f, g]) => [f, round6(g)]);
}
