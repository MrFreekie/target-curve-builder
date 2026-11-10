// Document model: defaults, layer factories, validation of loaded documents, and import.
// Pure module: no DOM access, importable from Node.
import { FILTERS, interpPoints } from "./layers.js";
import { detectFormat } from "./formats/index.js";
import { sanitiseFileName } from "./formats/smaart.js";

export const LAYER_KINDS = {
  points: "Points",
  lfTilt: "LF tilt",
  hfTilt: "HF tilt",
  fullTilt: "Full-spectrum tilt",
  hpf: "HPF",
  lpf: "LPF",
  gain: "Gain",
};

const MAX_LAYERS = 50;
const MAX_POINTS = 5000;
const FRACTIONS = [1, 3, 6, 12, 24, 48];

let nextId = 1;
/** A fresh unique layer id. */
export const newId = () => `L${nextId++}`;

/** A new document with the defaults from SPEC §4.5. */
export function newDoc() {
  return {
    version: 1,
    props: {
      name: "Target curve", format: "smaart-tf", line: 2, color: "ffff0000", show: 1,
      tolerance: 3, useTolerance: 0, offset: null, extraHeader: [], lineEnding: "\r\n", trailingNewline: true,
    },
    grid: { mode: "resample", fraction: 12, fmin: 20, fmax: 20000 },
    layers: [
      { id: newId(), kind: "points", on: true, points: [[20, 0], [20000, 0]] },
      { id: newId(), kind: "lfTilt", on: false, dbPerOct: 3, pivot: 1000, floor: null },
      { id: newId(), kind: "fullTilt", on: false, dbPerOct: 1, pivot: 1000 },
      { id: newId(), kind: "hfTilt", on: false, dbPerOct: 1.5, corner: 4000 },
      { id: newId(), kind: "hpf", on: false, fc: 32, type: "LR", slope: 48 },
      { id: newId(), kind: "lpf", on: false, fc: 16000, type: "LR", slope: 24 },
    ],
    normalise: { on: false, at: 1000 },
    original: null,
  };
}

/** A fresh layer of the given kind, switched on. */
export function newLayer(kind) {
  const base = { id: newId(), kind, on: true };
  switch (kind) {
    case "points": return { ...base, points: [[20, 0], [20000, 0]] };
    case "lfTilt": return { ...base, dbPerOct: 3, pivot: 1000, floor: null };
    case "fullTilt": return { ...base, dbPerOct: 1, pivot: 1000 };
    case "hfTilt": return { ...base, dbPerOct: 1.5, corner: 4000 };
    case "hpf": return { ...base, fc: 32, type: "LR", slope: 48 };
    case "lpf": return { ...base, fc: 16000, type: "LR", slope: 24 };
    default: return { ...base, kind: "gain", db: 0 };
  }
}

/** Remove line breaks and other control characters (tabs are kept) so text can't inject header or data lines. */
const clean = (v) => String(v).replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, " ");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function num(v, what, { positive = false, nullable = false } = {}) {
  if ((v === null || v === undefined) && nullable) return null;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || (positive && n <= 0)) throw new Error(`Invalid ${what}.`);
  return n;
}

function loadPoints(list) {
  if (!Array.isArray(list) || list.length > MAX_POINTS) throw new Error("Invalid points list.");
  return list.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error("Invalid point.");
    return [num(p[0], "point frequency", { positive: true }), num(p[1], "point level")];
  });
}

function loadLayer(l) {
  if (!isObj(l) || !(l.kind in LAYER_KINDS)) throw new Error("Unknown layer type.");
  const out = { id: newId(), kind: l.kind, on: l.on !== false && l.on !== 0 };
  switch (l.kind) {
    case "points": out.points = loadPoints(l.points); break;
    case "lfTilt":
      out.dbPerOct = num(l.dbPerOct, "tilt slope");
      out.pivot = num(l.pivot, "pivot", { positive: true });
      out.floor = num(l.floor, "floor", { positive: true, nullable: true });
      break;
    case "fullTilt":
      out.dbPerOct = num(l.dbPerOct, "tilt slope");
      out.pivot = num(l.pivot, "pivot", { positive: true });
      break;
    case "hfTilt":
      out.dbPerOct = num(l.dbPerOct, "tilt slope");
      out.corner = num(l.corner, "corner", { positive: true });
      break;
    case "gain": out.db = num(l.db, "gain"); break;
    default: {
      out.fc = num(l.fc, "corner frequency", { positive: true });
      const filter = FILTERS[l.type];
      if (!filter) throw new Error(`Unknown filter type ${l.type}.`);
      out.type = l.type;
      out.slope = num(l.slope, "filter slope");
      if (!filter.allowedSlopes.includes(out.slope)) throw new Error(`${filter.label} doesn't allow ${out.slope} dB/oct.`);
    }
  }
  return out;
}

/**
 * Validate and normalise an untrusted document (preset file, autosave).
 * Always returns a fresh object with fresh layer ids; throws Error with a readable message.
 * @param {unknown} obj
 * @returns {object}
 */
export function loadDoc(obj) {
  if (!isObj(obj) || obj.version !== 1) throw new Error("This isn't a Target Curve Builder document.");
  const base = newDoc();
  const p = isObj(obj.props) ? obj.props : {};
  const props = { ...base.props };
  if (typeof p.name === "string") props.name = clean(p.name).replace(/\t/g, " ").slice(0, 200);
  if (p.format === "smaart-tf" || p.format === "smaart-spectrum") props.format = p.format;
  if (Number.isInteger(p.line) && p.line >= 1 && p.line <= 5) props.line = p.line;
  if (typeof p.color === "string" && /^[0-9a-fA-F]{8}$/.test(p.color)) props.color = p.color.toLowerCase();
  if (p.show === 0 || p.show === 1) props.show = p.show;
  if (Number.isFinite(p.tolerance) && Math.abs(p.tolerance) <= 1000) props.tolerance = p.tolerance;
  if (p.useTolerance === 0 || p.useTolerance === 1) props.useTolerance = p.useTolerance;
  if (p.offset === null || (Number.isFinite(p.offset) && Math.abs(p.offset) <= 1000)) props.offset = p.offset ?? null;
  if (p.lineEnding === "\n" || p.lineEnding === "\r\n") props.lineEnding = p.lineEnding;
  if (typeof p.trailingNewline === "boolean") props.trailingNewline = p.trailingNewline;
  if (typeof p.bom === "boolean") props.bom = p.bom;
  if (Array.isArray(p.extraHeader)) props.extraHeader = p.extraHeader.filter((x) => typeof x === "string").slice(0, 100).map(clean);
  if (Array.isArray(p.rawHeader)) {
    props.rawHeader = p.rawHeader.slice(0, 100).map((h) => {
      if (!isObj(h) || typeof h.key !== "string" || typeof h.raw !== "string") throw new Error("Invalid header.");
      const key = clean(h.key).trim().toLowerCase();
      const raw = clean(h.raw);
      // A header line must really start with its own key, or it could shadow a canonical line.
      if (!raw.toLowerCase().startsWith(key) || !/^[a-z][a-z0-9_ ]*$/.test(key)) throw new Error("Invalid header.");
      return { key, raw, parsed: typeof h.parsed === "string" ? clean(h.parsed) : typeof h.parsed === "number" ? h.parsed : null };
    });
  }
  if (Number.isFinite(p.band)) props.band = p.band;

  const g = isObj(obj.grid) ? obj.grid : {};
  const grid = { ...base.grid };
  if (FRACTIONS.includes(Number(g.fraction))) grid.fraction = Number(g.fraction);
  if (Number.isFinite(g.fmin) && g.fmin > 0) grid.fmin = g.fmin;
  if (Number.isFinite(g.fmax) && g.fmax >= grid.fmin) grid.fmax = g.fmax;
  const original = obj.original === null || obj.original === undefined ? null : loadPoints(obj.original);
  grid.mode = g.mode === "original" && original ? "original" : "resample";

  if (!Array.isArray(obj.layers) || obj.layers.length > MAX_LAYERS) throw new Error("Invalid layer list.");
  const n = isObj(obj.normalise) ? obj.normalise : {};
  return {
    version: 1,
    props,
    grid,
    layers: obj.layers.map(loadLayer),
    normalise: { on: n.on === true, at: Number.isFinite(n.at) && n.at > 0 ? n.at : 1000 },
    original,
  };
}

/**
 * Turn the text of a .crv file into a document.
 * TF files give a ready-to-edit document on the "original" grid. Spectrum files give a
 * document with format "smaart-spectrum" (view only) until convertToTf() is used.
 * @param {string} text
 * @param {string} [fileName] Used for the curve name.
 * @returns {{doc: object, warnings: string[]}}
 */
export function docFromImport(text, fileName = "") {
  const found = detectFormat(text);
  if (!found) throw new Error("This doesn't look like a Smaart .crv file.");
  const r = found.adapter.read(text);
  if (r.points.length < 2) throw new Error("The file has fewer than 2 readable data rows.");
  if (r.points.length > MAX_POINTS) throw new Error(`The file has more than ${MAX_POINTS} points.`);
  const doc = newDoc();
  const name = sanitiseFileName(fileName.replace(/\.[^.]*$/, "")) || "Imported curve";
  doc.props = { ...doc.props, ...r.props, name, format: found.adapter.id };
  doc.layers = doc.layers.map((l) => (l.kind === "points" ? { ...l, on: true, points: r.points.map((p) => [...p]) } : { ...l, on: false }));
  doc.grid.mode = "original";
  doc.original = r.points.map((p) => [...p]);
  return { doc, warnings: r.warnings };
}

/**
 * Convert a spectrum document to a TF document: the same points, normalised to 0 dB at 1 kHz.
 * @param {object} doc
 * @returns {object} a new document
 */
export function convertToTf(doc) {
  const out = JSON.parse(JSON.stringify(doc));
  out.props.format = "smaart-tf";
  out.normalise = { on: true, at: 1000 };
  if (out.original) {
    const ref = interpPoints(1000, out.original);
    out.original = out.original.map(([f, g]) => [f, g - ref]);
  }
  return out;
}
