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
  {
    name: "Dog (fun: side profile, 12 dB tall, 8 octaves wide)",
    build() {
      const d = newDoc();
      d.props.name = "Dog";
      d.props.line = 4;
      d.props.color = "ffa0522d"; // sienna brown
      const dog = newLayer("shape");
      Object.assign(dog, { shape: "dog", fc: 1000, width: 8, db: 12 });
      d.layers.push(dog);
      d.grid = { mode: "simplified", fraction: 12, fmin: 20, fmax: 20000, epsilon: 0.05 }; // the outline's corners only
      return d;
    },
  },
];
