// Document model: defaults, layer factories, validation of loaded documents, and import.
// Pure module: no DOM access, importable from Node.
import { FILTERS, LAYER_LIMITS, interpPoints } from "./layers.js";
import { WEIGHTINGS, SHAPES } from "./eq.js";
import { detectFormat } from "./formats/index.js";
import { sanitiseFileName, KNOWN, parseValue } from "./formats/smaart.js";
import { MAX_TRACE_POINTS, TRACE_SMOOTHINGS, TRACE_OFFSET_LIMIT } from "./trace.js";

export const LAYER_KINDS = {
  points: "Points",
  lfTilt: "LF tilt",
  hfTilt: "HF tilt",
  fullTilt: "Full-spectrum tilt",
  subBoost: "Low shelf (sub boost)",
  hiShelf: "High shelf",
  bell: "Bell (peak or notch)",
  hill: "Hill (haystack bump)",
  rHpf: "Resonant HPF (2nd order)",
  rLpf: "Resonant LPF (2nd order)",
  weighting: "Weighting (A, C, RIAA, FM)",
  shape: "Shape (pyramid, box, half circle...)",
  mesa: "Mesa-style asymmetric filter",
  hpf: "HPF",
  lpf: "LPF",
  gain: "Gain",
};

const MAX_LAYERS = 50;
const MAX_POINTS = 5000;
/** Most points across every Points layer and the imported original together, so a hostile file can't make every edit slow. */
export const MAX_TOTAL_POINTS = 20000;

/** Points held by all Points layers and the imported original: the number MAX_TOTAL_POINTS limits. */
export function totalPoints(doc) {
  return (doc.layers ?? []).reduce((n, l) => n + (l.kind === "points" && Array.isArray(l.points) ? l.points.length : 0), 0) + (Array.isArray(doc.original) ? doc.original.length : 0);
}
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
      { id: newId(), kind: "points", on: true, group: 1, points: [[20, 0], [20000, 0]] },
      { id: newId(), kind: "lfTilt", on: false, group: 1, dbPerOct: 3, pivot: 1000, floor: null },
      { id: newId(), kind: "fullTilt", on: false, group: 1, dbPerOct: 1, pivot: 1000 },
      { id: newId(), kind: "hfTilt", on: false, group: 1, dbPerOct: 1.5, corner: 4000 },
      { id: newId(), kind: "hpf", on: false, group: 1, fc: 32, type: "LR", slope: 48 },
      { id: newId(), kind: "lpf", on: false, group: 1, fc: 16000, type: "LR", slope: 24 },
    ],
    normalise: { on: false, at: 1000 },
    original: null,
    originalProps: null,
    groups: defaultGroups(),
  };
}

/** Number of layer groups (SPEC §4.8). */
export const GROUP_COUNT = 3;

/** Three groups, named A, B and C, all shown. */
export function defaultGroups() {
  return ["A", "B", "C"].map((name) => ({ name, on: true }));
}

/** A fresh layer of the given kind, switched on. */
export function newLayer(kind) {
  const base = { id: newId(), kind, on: true, group: 1 }; // every layer belongs to a group; new ones start in A
  switch (kind) {
    case "points": return { ...base, points: [[20, 0], [20000, 0]] };
    case "lfTilt": return { ...base, dbPerOct: 3, pivot: 1000, floor: null };
    case "fullTilt": return { ...base, dbPerOct: 1, pivot: 1000 };
    case "hfTilt": return { ...base, dbPerOct: 1.5, corner: 4000 };
    case "subBoost": return { ...base, fc: 60, type: "LR", slope: 24, db: 6 };
    case "hiShelf": return { ...base, fc: 8000, type: "BW", slope: 12, db: -3 };
    case "bell": return { ...base, fc: 1000, q: 1, db: 3 };
    case "hill": return { ...base, fc: 60, width: 2, db: 6 };
    case "rHpf": return { ...base, fc: 40, q: 1 };
    case "rLpf": return { ...base, fc: 16000, q: 1 };
    case "weighting": return { ...base, curve: "A" };
    case "mesa": return { ...base, fLow: 80, fHigh: 400, wLow: 1, wHigh: 2, db: 6 };
    case "shape": return { ...base, shape: "pyramid", fc: 1000, width: 2, db: 6, flat: 0.5, count: 3 };
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

/** A reference trace (SPEC §10) from untrusted data, or null when it is missing or unusable. */
function loadTemplate(t) {
  if (!isObj(t) || !Array.isArray(t.points) || t.points.length > MAX_TRACE_POINTS) return null;
  let points;
  try { points = loadPoints(t.points); } catch { return null; }
  points.sort((a, b) => a[0] - b[0]);
  points = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0]);
  if (points.length < 2) return null;
  const offset = Number.isFinite(t.offset) ? Math.max(-TRACE_OFFSET_LIMIT, Math.min(TRACE_OFFSET_LIMIT, t.offset)) : 0;
  const name = typeof t.name === "string" ? clean(t.name).replace(/	/g, " ").trim().slice(0, 100) : "";
  return { name, points, offset, smooth: TRACE_SMOOTHINGS.includes(t.smooth) ? t.smooth : 0, normalise: t.normalise === true, show: t.show !== false };
}

function loadPoints(list) {
  if (!Array.isArray(list) || list.length > MAX_POINTS) throw new Error("Invalid points list.");
  return list.map((p) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error("Invalid point.");
    return [num(p[0], "point frequency", { positive: true }), num(p[1], "point level")];
  });
}

function ranged(v, [lo, hi], what) {
  if (v < lo || v > hi) throw new Error(`Invalid ${what}: it must be between ${lo} and ${hi}.`);
  return v;
}

function loadLayer(l) {
  if (!isObj(l) || typeof l.kind !== "string" || !Object.hasOwn(LAYER_KINDS, l.kind)) throw new Error("Unknown layer type.");
  const out = { id: newId(), kind: l.kind, on: l.on !== false && l.on !== 0 };
  if (l.invert === true) out.invert = true; // any layer can be flipped upside down
  out.group = Number.isInteger(l.group) && l.group >= 1 && l.group <= GROUP_COUNT ? l.group : 1; // see §4.8: no or unusable group means group A
  switch (l.kind) {
    case "points":
      out.points = loadPoints(l.points);
      // an optional name for the layer, such as the file it was added from
      if (typeof l.label === "string" && l.label.trim()) out.label = clean(l.label).replace(/	/g, " ").trim().slice(0, 100);
      break;
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
    case "bell":
      out.fc = num(l.fc, "centre frequency", { positive: true });
      out.q = ranged(num(l.q, "Q"), LAYER_LIMITS.q, "Q");
      out.db = ranged(num(l.db, "gain"), LAYER_LIMITS.db, "gain");
      break;
    case "hill":
      out.fc = num(l.fc, "centre frequency", { positive: true });
      out.width = ranged(num(l.width, "width"), LAYER_LIMITS.width, "width");
      out.db = ranged(num(l.db, "gain"), LAYER_LIMITS.db, "gain");
      break;
    case "mesa":
      out.fLow = num(l.fLow, "lower frequency", { positive: true });
      out.fHigh = num(l.fHigh, "upper frequency", { positive: true });
      if (!(out.fLow < out.fHigh)) throw new Error("The lower frequency must be below the upper frequency.");
      out.wLow = ranged(num(l.wLow, "lower width"), LAYER_LIMITS.width, "lower width");
      out.wHigh = ranged(num(l.wHigh, "upper width"), LAYER_LIMITS.width, "upper width");
      out.db = ranged(num(l.db, "gain"), LAYER_LIMITS.db, "gain");
      break;
    case "shape":
      if (typeof l.shape !== "string" || !Object.hasOwn(SHAPES, l.shape)) throw new Error(`Unknown shape ${l.shape}.`);
      out.shape = l.shape;
      out.fc = num(l.fc, "centre frequency", { positive: true });
      out.width = ranged(num(l.width, "width"), LAYER_LIMITS.width, "width");
      out.db = ranged(num(l.db, "height"), LAYER_LIMITS.db, "height");
      out.flat = l.flat === undefined ? 0.5 : ranged(num(l.flat, "flat top"), LAYER_LIMITS.flat, "flat top");
      out.count = l.count === undefined ? 3 : ranged(num(l.count, "cycles or steps"), LAYER_LIMITS.count, "cycles or steps");
      break;
    case "weighting":
      if (typeof l.curve !== "string" || !Object.hasOwn(WEIGHTINGS, l.curve)) throw new Error(`Unknown weighting curve ${l.curve}.`);
      out.curve = l.curve;
      break;
    case "rHpf":
    case "rLpf":
      out.fc = num(l.fc, "corner frequency", { positive: true });
      out.q = ranged(num(l.q, "Q"), LAYER_LIMITS.resonantQ, "Q");
      break;
    default: {
      const shelf = l.kind === "subBoost" || l.kind === "hiShelf";
      if (shelf) out.db = num(l.db, "shelf gain");
      out.fc = num(l.fc, "corner frequency", { positive: true });
      const filter = typeof l.type === "string" && Object.hasOwn(FILTERS, l.type) ? FILTERS[l.type] : undefined;
      if (!filter) throw new Error(`Unknown filter type ${l.type}.`);
      if (shelf && filter.shelfSafe === false) throw new Error(`${filter.label} can't be used for a shelf: its passband ripples.`);
      out.type = l.type;
      out.slope = num(l.slope, "filter slope");
      if (!filter.allowedSlopes.includes(out.slope)) throw new Error(`${filter.label} doesn't allow ${out.slope} dB/oct.`);
    }
  }
  return out;
}

/** Validate untrusted file properties (name, colour, header lines...) on top of the defaults. */
function loadProps(raw) {
  const base = newDoc();
  const p = isObj(raw) ? raw : {};
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
      // A header line must really be "key:" then a value, or it could shadow a canonical line.
      const colon = raw.indexOf(":");
      if (!/^[a-z][a-z0-9_ ]*$/.test(key) || colon < 0 || raw.slice(0, colon).trimEnd().toLowerCase() !== key) throw new Error("Invalid header.");
      // Work out what the line says from the line itself: the writer puts the line back as it is only when this
      // matches the current setting, so a doctored "parsed" can't smuggle a bad value into an export.
      return { key, raw, parsed: KNOWN.includes(key) ? parseValue(key, raw.slice(colon + 1)) : null };
    });
  }
  if (Number.isFinite(p.band)) props.band = p.band;
  return props;
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
  const props = loadProps(obj.props);

  const g = isObj(obj.grid) ? obj.grid : {};
  const grid = { ...base.grid };
  if (FRACTIONS.includes(Number(g.fraction))) grid.fraction = Number(g.fraction);
  if (Number.isFinite(g.fmin) && g.fmin >= 1) grid.fmin = g.fmin;
  if (Number.isFinite(g.fmax) && g.fmax >= grid.fmin && g.fmax <= 100000) grid.fmax = g.fmax; // same limit as the trim
  if (grid.fmax < grid.fmin) { grid.fmin = base.grid.fmin; grid.fmax = base.grid.fmax; } // fmin above the default fmax
  // Trim (SPEC §3.5): optional low and high limits for the output and the plot; both kept only if they make sense.
  const okTrim = (v) => Number.isFinite(v) && v >= 1 && v <= 100000;
  const lowT = okTrim(g.trimLow) ? g.trimLow : undefined;
  const highT = okTrim(g.trimHigh) ? g.trimHigh : undefined;
  if (!(lowT !== undefined && highT !== undefined && lowT >= highT)) {
    if (lowT !== undefined) grid.trimLow = lowT;
    if (highT !== undefined) grid.trimHigh = highT;
  }
  const originalProps = isObj(obj.originalProps) ? loadProps(obj.originalProps) : null;
  const original = obj.original === null || obj.original === undefined ? null : loadPoints(obj.original);
  // The older mode "simplified" (1/48-octave candidates) becomes breakpoints-only on the 1/48 grid.
  grid.mode = g.mode === "original" && original ? "original" : "resample";
  if (g.mode === "simplified") { grid.fraction = 48; grid.simplify = true; }
  else if (g.simplify === true) grid.simplify = true;
  if (Number.isFinite(g.epsilon) && g.epsilon >= 0.001 && g.epsilon <= 12) grid.epsilon = g.epsilon;

  if (!Array.isArray(obj.layers) || obj.layers.length > MAX_LAYERS) throw new Error("Invalid layer list.");
  const n = isObj(obj.normalise) ? obj.normalise : {};
  const groups = defaultGroups().map((def, i) => {
    const g = Array.isArray(obj.groups) && isObj(obj.groups[i]) ? obj.groups[i] : {};
    const name = typeof g.name === "string" ? clean(g.name).replace(/	/g, " ").trim().slice(0, 24) : "";
    return { name: name || def.name, on: g.on !== false };
  });
  const template = loadTemplate(obj.template);
  const layers = obj.layers.map(loadLayer);
  if (totalPoints({ layers, original }) > MAX_TOTAL_POINTS) throw new Error(`Too many points in total (more than ${MAX_TOTAL_POINTS}).`);
  return {
    version: 1,
    props,
    grid,
    layers,
    normalise: { on: n.on === true, at: Number.isFinite(n.at) && n.at > 0 ? n.at : 1000 },
    original,
    originalProps: original ? originalProps : null,
    groups,
    ...(template ? { template } : {}),
  };
}

/**
 * Read a detected file and tidy its points: at least 2 and at most MAX_POINTS, sorted by frequency, and a repeated
 * frequency dropped (the first row wins), because export needs strictly ascending frequencies. A file that was
 * already in order is returned unchanged.
 * @returns {{props: object, points: number[][], warnings: string[]}}
 */
function readPoints(found, text) {
  const r = found.adapter.read(text);
  if (r.points.length < 2) throw new Error("The file has fewer than 2 readable data rows.");
  if (r.points.length > MAX_POINTS) throw new Error(`The file has more than ${MAX_POINTS} points.`);
  const warnings = [...r.warnings];
  let points = r.points;
  if (points.some((p, i) => i > 0 && p[0] <= points[i - 1][0])) {
    const sorted = points.map((p, i) => [p, i]).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([p]) => p);
    const before = sorted.length;
    points = sorted.filter((p, i) => i === 0 || p[0] !== sorted[i - 1][0]);
    warnings.push(`The rows weren't in ascending frequency order, so they were sorted${points.length < before ? ` and ${before - points.length} repeated frequenc${before - points.length === 1 ? "y was" : "ies were"} dropped` : ""}.`);
    if (points.length < 2) throw new Error("The file has fewer than 2 different frequencies.");
  }
  return { ...r, points, warnings };
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
  const r = readPoints(found, text);
  const doc = newDoc();
  const name = sanitiseFileName(fileName.replace(/\.[^.]*$/, "")) || "Imported curve";
  doc.props = { ...doc.props, ...r.props, name, format: found.adapter.id };
  doc.layers = doc.layers.map((l) => (l.kind === "points" ? { ...l, on: true, points: r.points.map((p) => [...p]) } : { ...l, on: false }));
  doc.grid.mode = "original";
  doc.original = r.points.map((p) => [...p]);
  doc.originalProps = JSON.parse(JSON.stringify(doc.props)); // for "Reset to imported"
  return { doc, warnings: r.warnings };
}

/**
 * Is this document still a blank "new" document: nothing imported, edited or switched on?
 * Used to decide whether importing a file can simply replace it without asking.
 * @param {object} doc
 * @returns {boolean}
 */
export function isBlank(doc) {
  const strip = (d) => JSON.stringify({ ...d, layers: (d.layers ?? []).map(({ id, ...rest }) => rest) });
  return strip(doc) === strip(newDoc());
}

/**
 * Add the points of a .crv file to a document as a new Points layer, keeping everything else (name, colour,
 * grid, other layers). A spectrum file holds absolute levels, so it is shifted to 0 dB at 1 kHz first.
 * @param {object} doc The current document (not changed).
 * @param {string} text The file text.
 * @param {string} [fileName] Shown as the layer's label.
 * @returns {{doc: object, layerId: string, warnings: string[], shifted: boolean}}
 */
export function addImportedLayer(doc, text, fileName = "") {
  const found = detectFormat(text);
  if (!found) throw new Error("This doesn't look like a Smaart .crv file.");
  const r = readPoints(found, text);
  let points = r.points.map((p) => [...p]);
  const shifted = found.adapter.id === "smaart-spectrum";
  if (shifted) {
    const ref = interpPoints(1000, points);
    points = points.map(([f, g]) => [f, g - ref]);
  }
  if (totalPoints(doc) + points.length > MAX_TOTAL_POINTS) throw new Error(`Adding this file would take the curve past ${MAX_TOTAL_POINTS} points in total. Delete a Points layer first.`);
  const next = JSON.parse(JSON.stringify(doc));
  const layer = { id: newId(), kind: "points", on: true, group: 1, points };
  const label = clean(fileName).replace(/\t/g, " ").trim().slice(0, 100);
  if (label) layer.label = label;
  next.layers.push(layer);
  return { doc: next, layerId: layer.id, warnings: r.warnings, shifted };
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

/**
 * The document as it was when the file was imported: the file's points in the points layer, every other
 * layer off, the "original" grid, no normalise, and the file's own properties and header lines.
 * Returns null for a document that wasn't imported. (A converted spectrum curve resets to its TF form.)
 * @param {object} doc
 * @returns {object|null} a new document
 */
export function resetToImport(doc) {
  if (!doc.original || !doc.original.length) return null;
  const fresh = newDoc();
  fresh.props = JSON.parse(JSON.stringify(doc.originalProps ?? doc.props));
  if (doc.originalProps && doc.props.format === "smaart-tf" && fresh.props.format === "smaart-spectrum") fresh.props.format = "smaart-tf";
  fresh.layers = fresh.layers.map((l) => (l.kind === "points" ? { ...l, on: true, points: doc.original.map((p) => [...p]) } : { ...l, on: false }));
  fresh.grid.mode = "original";
  fresh.original = doc.original.map((p) => [...p]);
  fresh.originalProps = doc.originalProps ? JSON.parse(JSON.stringify(doc.originalProps)) : null;
  return fresh;
}
