// Autosave, named presets (localStorage) and JSON preset files.
// Every storage call is wrapped in try/catch: the app must work with storage blocked.
import { newDoc, newLayer, loadDoc } from "./doc.js";

const AUTOSAVE_KEY = "tcb-autosave";
const PRESETS_KEY = "tcb-presets";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Save the current document JSON text. Returns false if storage isn't available. */
export function autosave(json) {
  return write(AUTOSAVE_KEY, json);
}

/** The autosaved document, or null if there is none or it can't be used. */
export function loadAutosave() {
  const text = read(AUTOSAVE_KEY);
  if (!text) return null;
  try {
    return loadDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Names of saved presets, sorted. */
export function listPresets() {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

function readAll() {
  const text = read(PRESETS_KEY);
  if (!text) return Object.create(null);
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? Object.assign(Object.create(null), obj) : Object.create(null);
  } catch {
    return Object.create(null);
  }
}

/** Is a preset with this name already saved? */
export function hasPreset(name) {
  return name in readAll();
}

/** Save a named preset. Returns false if storage failed. */
export function savePreset(name, doc) {
  const all = readAll();
  all[name] = JSON.parse(JSON.stringify(doc));
  return write(PRESETS_KEY, JSON.stringify(all));
}

/** Load a named preset, or null if missing or unusable. */
export function loadPreset(name) {
  try {
    return loadDoc(readAll()[name]);
  } catch {
    return null;
  }
}

/** Delete a named preset. */
export function deletePreset(name) {
  const all = readAll();
  delete all[name];
  return write(PRESETS_KEY, JSON.stringify(all));
}

/** JSON text for a preset file. */
export function presetToJson(doc) {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse the text of a preset file.
 * @param {string} text
 * @returns {object} a validated document; throws Error with a readable message
 */
export function presetFromJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return loadDoc(obj);
}

/** The built-ins match the 1/3-octave reference files, so they keep a 1/3-octave grid. */
const thirdOctave = (doc) => { doc.grid.fraction = 3; return doc; };

const withHpf = (doc) => {
  const hp = doc.layers.find((l) => l.kind === "hpf");
  Object.assign(hp, { on: true, fc: 32, type: "LR", slope: 48 });
};

/**
 * SMPTE ST 202:2010 Table 1: B-chain electroacoustic response ("X-curve") for a medium theatre (200 to 500
 * seats), level in dB at the 1/3-octave centre frequencies. Flat from 50 Hz to 2 kHz, so only the corners are listed.
 * Tolerances in the standard are +3 dB and -3 to -7 dB (wider at the extremes); the preset uses +/-3 dB.
 */
export const SMPTE_ST202_TABLE_1 = [
  [31.5, -2], [40, -1], [50, 0], [2000, 0], [2500, -1], [3150, -2], [4000, -3], [5000, -4],
  [6300, -5], [8000, -6], [10000, -7], [12500, -9], [16000, -11],
];

/**
 * Table A.1 "approximate correction factors for auditorium size" at 4 kHz and 8 kHz (0 dB at 2 kHz), added to
 * Table 1. The standard gives nothing above 8 kHz; the 8 kHz value is held there.
 */
const SIZE_CORRECTION = { 150: [0.5, 1.0], 1000: [-0.5, -1.0] };

function cinemaPresets() {
  const make = (name, title, seats) => ({
    name,
    build() {
      const d = newDoc();
      d.props.name = title;
      d.props.line = 3;
      d.props.tolerance = 3;
      d.props.useTolerance = 1;
      d.grid = { mode: "resample", fraction: 3, fmin: 20, fmax: 20000, trimLow: 31.5, trimHigh: 16000 }; // trimmed to the range Table 1 defines
      d.layers.find((l) => l.kind === "points").points = SMPTE_ST202_TABLE_1.map((p) => [...p]);
      if (seats) {
        const [c4, c8] = SIZE_CORRECTION[seats];
        const fix = newLayer("points");
        fix.points = [[2000, 0], [4000, c4], [8000, c8]];
        d.layers.push(fix);
      }
      return d;
    },
  });
  return [
    make("Cinema X-curve, SMPTE ST 202:2010 (medium theatre, 200-500 seats)", "X-curve SMPTE ST202 medium", null),
    make("Cinema X-curve, SMPTE ST 202:2010 (small theatre, 150 seats)", "X-curve SMPTE ST202 small 150 seats", 150),
    make("Cinema X-curve, SMPTE ST 202:2010 (large theatre, 1000 seats)", "X-curve SMPTE ST202 large 1000 seats", 1000),
  ];
}

/** Frequency in Hz at `o` octaves above 20 Hz, to 2 decimals. Presets keep their points off the nominal 1/3-octave labels, which the plot snaps differently (SPEC 3.1). */
const hz = (o) => Math.round(20 * 2 ** o * 100) / 100;

/**
 * Points for a run of flat-topped blocks with near-vertical sides (a skyline, a castle wall).
 * @param {number[][]} blocks [[width in octaves, height in dB], ...] side by side
 * @param {number} start Where the first block begins, in octaves above 20 Hz.
 * @param {number} scale Multiplies every width.
 * @returns {number[][]} [[hz, db], ...]
 */
function blockPoints(blocks, start, scale) {
  const edge = 0.03; // each side climbs over this many octaves, so it is steep but still a function of frequency
  const pts = [[20, 0]];
  let x = start;
  let prev = 0;
  for (const [w, h] of blocks) {
    pts.push([hz(x), prev], [hz(x + edge), h]);
    prev = h;
    x += w * scale;
  }
  pts.push([hz(x), prev], [hz(x + edge), 0], [20000, 0]);
  return pts;
}

/** [octaves above 20 Hz, dB] points moved along by `shift` octaves, as [hz, db]. */
const placed = (rel, shift) => rel.map(([o, db]) => [hz(o + shift), db]);

/** One heartbeat: small P wave, dip, tall R spike, deeper dip, then the T wave. */
const BEAT = [[0, 0], [0.3, 1.5], [0.6, 0], [1, 0], [1.2, -3], [1.45, 14], [1.7, -6], [1.9, 0], [2.3, 0], [2.7, 2.5], [3.1, 0]];

/** Fun curves drawn as points: [menu name, curve name, colour, points]. */
const FUN_POINTS = [
  ["Skyline (fun: city buildings)", "Skyline", "ff4b5d78",
    blockPoints([[0.6, 6], [0.4, 10], [0.5, 4], [0.2, 0], [0.3, 12], [0.7, 8], [0.4, 14], [0.5, 5], [0.6, 9], [0.4, 3], [0.5, 11], [0.6, 7]], 0.8, 1.5)],
  ["Heartbeat (fun: ECG trace)", "Heartbeat", "ffd62839",
    [[20, 0], ...placed(BEAT, 0.81), ...placed(BEAT, 5), [20000, 0]]],
  ["Mountain range (fun: jagged ridge)", "Mountain range", "ff3f7d58",
    [[20, 0], ...[[0.8, 4], [1.2, 2], [1.9, 9], [2.3, 6], [2.8, 13], [3.2, 8], [3.6, 11], [4.2, 3], [4.7, 7], [5.3, 15], [5.7, 9], [6.2, 12], [6.8, 4], [7.5, 8], [8.1, 2], [8.8, 5], [9.4, 1]].map(([o, db]) => [hz(o), db]), [20000, 0]]],
  ["Castle (fun: crenellations)", "Castle", "ff8d6e4b",
    blockPoints([[0.35, 10], [0.2, 4], [0.25, 10], [0.3, 4], [0.4, 10], [0.2, 4], [0.3, 10], [0.25, 4], [0.35, 10], [0.2, 4], [0.25, 10], [0.3, 4], [0.4, 10]], 1.01, 2)],
];

/** Presets that ship with the app. Each `build()` returns a fresh document. */
export const BUILT_IN_PRESETS = [
  {
    name: "3 dB/oct from 1 kHz + 32 Hz LR48",
    build() {
      const d = newDoc();
      d.props.name = "Tilt 3dBoct 1000Hz HPF32 LR48";
      d.props.line = 3;
      d.layers.find((l) => l.kind === "lfTilt").on = true;
      withHpf(d);
      return thirdOctave(d);
    },
  },
  {
    name: "LA 7 dB at 63 → 0 at 315 + 32 Hz LR48",
    build() {
      const d = newDoc();
      d.props.name = "LA 7dB 315 HPF32 LR48";
      d.props.line = 3;
      d.layers.find((l) => l.kind === "points").points = [[63, 7], [315, 0], [20000, 0]];
      withHpf(d);
      return thirdOctave(d);
    },
  },
  {
    name: "Flat + 32 Hz LR48",
    build() {
      const d = newDoc();
      d.props.name = "Flat HPF32 LR48";
      d.props.line = 3;
      withHpf(d);
      return thirdOctave(d);
    },
  },
  ...[
    ["A-weighting (dBA)", "A-weighting", { curve: "A" }],
    ["C-weighting (dBC)", "C-weighting", { curve: "C" }],
    ["Inverse A-weighting (large bass boost)", "A-weighting inverted", { curve: "A", invert: true }],
    ["RIAA playback", "RIAA playback", { curve: "RIAA" }],
    ["RIAA recording (inverse of playback)", "RIAA recording", { curve: "RIAA", invert: true }],
    ["FM pre-emphasis 75 µs", "FM pre-emphasis 75us", { curve: "FM75" }],
  ].map(([name, title, opts]) => ({
    name,
    build() {
      const d = newDoc();
      d.props.name = title;
      d.props.line = 3;
      const l = newLayer("weighting");
      Object.assign(l, opts);
      d.layers.push(l);
      return d;
    },
  })),
  ...cinemaPresets(),
  ...FUN_POINTS.map(([name, title, colour, points]) => ({
    name,
    build() {
      const d = newDoc();
      d.props.name = title;
      d.props.line = 3;
      d.props.color = colour;
      d.layers.find((l) => l.kind === "points").points = points.map((p) => [...p]);
      d.grid = { mode: "simplified", fraction: 12, fmin: 20, fmax: 20000, epsilon: 0.05 }; // the corners only
      return d;
    },
  })),
];
