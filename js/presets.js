// Autosave, named presets (localStorage) and JSON preset files.
// Every storage call is wrapped in try/catch: the app must work with storage blocked.
import { newDoc, loadDoc } from "./doc.js";

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
];
