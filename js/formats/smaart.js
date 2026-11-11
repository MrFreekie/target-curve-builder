// Smaart .crv adapters: TF (read + write) and spectrum (read only).
// Pure module: no DOM access. Rules are in docs/SPEC.md §5 and §6.
import { round6 } from "../curve.js";
import { FILTERS, LAYER_LIMITS } from "../layers.js";
import { WEIGHTINGS } from "../eq.js";

/** Known header keys (lower case) in canonical order. */
const KNOWN = ["line", "color", "show", "type", "tolerance", "usetolerance", "offset"];
const CANONICAL_KEY = {
  line: "Line", color: "Color", show: "Show", type: "Type",
  tolerance: "Tolerance", usetolerance: "UseTolerance", offset: "Offset",
};
const BANDS = [1, 3, 6, 12, 24, 48];

/** Format a number with 6 decimals and never "-0.000000". */
export function fmt6(x) {
  return round6(x).toFixed(6).replace(/^-0\.000000$/, "0.000000");
}

/** Convert a colour picker value "#rrggbb" to Smaart "ffrrggbb" (AARRGGBB, assumed). */
export function pickerToSmaart(hex) {
  return `ff${String(hex).replace(/^#/, "").toLowerCase()}`;
}

/** Convert Smaart "aarrggbb" to a colour picker value "#rrggbb". */
export function smaartToPicker(color) {
  return `#${String(color).toLowerCase().slice(-6)}`;
}

/** Remove characters Windows and macOS don't allow in file names. */
export function sanitiseFileName(name) {
  let s = String(name ?? "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "");
  const trimEnd = () => {
    let prev;
    do {
      prev = s;
      s = s.replace(/[\s.]+$/, "").replace(/\.(crv|txt)$/i, "");
    } while (s !== prev);
  };
  trimEnd();
  s = s.replace(/^[\s.]+/, "");
  trimEnd();
  return s;
}

/** Download file name for a document, or "" if the name is empty after sanitising. */
export function crvFileName(name) {
  return exportFileName(name, ".crv");
}

/** Download file name for a document with the given extension (e.g. ".txt"), or "" if the name is empty. */
export function exportFileName(name, ext) {
  const clean = sanitiseFileName(name);
  return clean ? `${clean}${ext}` : "";
}

/** Parse the value of a known header key to a comparable form. */
function parseValue(key, value) {
  const v = String(value).trim();
  if (key === "color") return v.toLowerCase();
  if (key === "type") return v;
  return Number(v);
}

/** The canonical header line (without line ending) for a known key. */
function canonicalLine(key, value) {
  const k = CANONICAL_KEY[key];
  switch (key) {
    case "color": return `${k}:\t${String(value).toLowerCase()}`;
    case "type": return `${k}:\tTF`;
    case "tolerance":
    case "offset": return `${k}:\t${Number(value).toFixed(4)}`;
    default: return `${k}:\t${value}`;
  }
}

/** Is this line a header line ("Key: value") rather than a data row? */
function isHeaderLine(line) {
  return /^[A-Za-z][A-Za-z0-9_ ]*\s*:/.test(line);
}

/**
 * Lenient reader shared by both Smaart adapters.
 * Keeps raw header text so an unchanged import can be written back byte for byte.
 * @param {string} text
 * @returns {{props: object, points: number[][], extraHeader: string[], lineEnding: string,
 *            trailingNewline: boolean, warnings: string[], kind: "tf"|"spectrum"}}
 */
export function readCrv(text) {
  const warnings = [];
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) { bom = true; text = text.slice(1); }
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = /\n$/.test(text);
  const lines = text.split(/\r\n|\n/);
  if (trailingNewline) lines.pop();

  const rawHeader = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") { i++; break; }
    if (!isHeaderLine(line)) break;
    const idx = line.indexOf(":");
    rawHeader.push({ key: line.slice(0, idx).trim().toLowerCase(), value: line.slice(idx + 1).trim(), raw: line });
  }

  const points = [];
  let skipped = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/[\t ,]+/);
    const f = Number(parts[0]);
    const g = Number(parts[1]);
    if (parts.length >= 2 && parts[0] !== "" && parts[1] !== "" && Number.isFinite(f) && Number.isFinite(g)) {
      points.push([f, g]);
    } else skipped++;
  }
  if (skipped) warnings.push(`Skipped ${skipped} data row${skipped === 1 ? "" : "s"} that could not be read.`);

  const found = {};
  const extraHeader = [];
  for (const h of rawHeader) {
    if (KNOWN.includes(h.key)) found[h.key] = h.value;
    else extraHeader.push(h.raw);
  }
  const bandLine = rawHeader.find((h) => h.key === "band");
  const type = found.type ?? null;
  const kind = type !== null && type.toUpperCase() === "TF" ? "tf" : "spectrum";
  const numOr = (k, d) => (found[k] !== undefined && Number.isFinite(Number(found[k])) ? Number(found[k]) : d);

  const props = {
    line: numOr("line", 2),
    color: (found.color ?? "ffff0000").toLowerCase(),
    show: numOr("show", 1),
    tolerance: numOr("tolerance", 3),
    useTolerance: numOr("usetolerance", 0),
    offset: found.offset !== undefined && Number.isFinite(Number(found.offset)) ? Number(found.offset) : null,
    band: bandLine && Number.isFinite(Number(bandLine.value)) ? Number(bandLine.value) : null,
    extraHeader,
    lineEnding,
    trailingNewline,
    bom,
    rawHeader: rawHeader.map((h) => ({ key: h.key, raw: h.raw, parsed: KNOWN.includes(h.key) ? parseValue(h.key, h.value) : null })),
  };
  // "band" is unknown to the TF writer but is kept in rawHeader/extraHeader for spectrum files.
  return { props, points, extraHeader, lineEnding, trailingNewline, warnings, kind };
}

/**
 * Current value of a known property from doc.props, in the same form as parseValue().
 * Type is always TF on output.
 */
function currentValue(key, props) {
  switch (key) {
    case "line": return Number(props.line ?? 2);
    case "color": return String(props.color ?? "ffff0000").toLowerCase();
    case "show": return Number(props.show ?? 1);
    case "type": return "TF";
    case "tolerance": return Number(props.tolerance ?? 0);
    case "usetolerance": return Number(props.useTolerance ?? 0);
    case "offset": return props.offset === null || props.offset === undefined ? null : Number(props.offset);
    default: return null;
  }
}

/**
 * Build the header lines. Unchanged imported lines are written back as read; changed or new
 * known properties use the canonical format; unknown lines are kept in place.
 */
function buildHeader(props) {
  const out = [];
  const written = new Set();
  const raw = Array.isArray(props.rawHeader) ? props.rawHeader : [];
  for (const h of raw) {
    if (!KNOWN.includes(h.key)) {
      if (h.key === "band") continue; // spectrum-only key: dropped because the output is TF
      out.push(h.raw);
      continue;
    }
    if (written.has(h.key)) continue;
    written.add(h.key);
    const now = currentValue(h.key, props);
    if (h.key === "offset" && now === null) continue; // offset cleared by the user
    out.push(now === h.parsed ? h.raw : canonicalLine(h.key, now));
  }
  // Known properties not in the original header: canonical lines at the end
  // ("Type: TF" is added here if the original had none).
  for (const key of KNOWN) {
    if (written.has(key)) continue;
    const now = currentValue(key, props);
    if (key === "offset" && now === null) continue;
    out.push(canonicalLine(key, now));
  }
  return out;
}

/**
 * Write a Smaart TF curve.
 * @param {{props: object}} doc
 * @param {number[][]} points [[hz, db], ...]
 * @returns {string}
 */
export function writeTf(doc, points) {
  const props = doc.props ?? {};
  const nl = props.lineEnding ?? "\r\n";
  const header = buildHeader(props);
  const rows = points.map(([f, g]) => `${fmt6(f)}\t${fmt6(g)}`);
  const trailing = props.trailingNewline === false ? "" : nl;
  return (props.bom ? "﻿" : "") + header.join(nl) + nl + nl + rows.join(nl) + (rows.length ? trailing : "");
}

/**
 * Check a document and its output points. Export is blocked while any error is returned.
 * @returns {{level: "error"|"warn", message: string}[]}
 */
export function validateTf(doc, points) {
  const out = [];
  const err = (message) => out.push({ level: "error", message });
  const props = doc.props ?? {};

  if (points.length < 2) err("A curve needs at least 2 points.");
  let bad = false;
  for (const [f, g] of points) {
    if (!Number.isFinite(f) || !Number.isFinite(g)) { err("A point has a value that is not a number."); bad = true; break; }
  }
  if (!bad) {
    if (points.some(([f]) => f <= 0)) err("Frequencies must be greater than 0 Hz.");
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] === points[i - 1][0]) { err(`Duplicate frequency ${points[i][0]} Hz.`); break; }
      if (points[i][0] < points[i - 1][0]) { err("Frequencies must be in ascending order."); break; }
    }
  }
  const line = Number(props.line ?? 2);
  if (!Number.isInteger(line) || line < 1 || line > 5) err("Line width must be a whole number from 1 to 5.");
  const show = Number(props.show ?? 1);
  if (show !== 0 && show !== 1) err("Show must be 0 or 1.");
  if (!/^[0-9a-fA-F]{8}$/.test(String(props.color ?? "ffff0000"))) err("Colour must be 8 hex digits.");
  if (!Number.isFinite(Number(props.tolerance ?? 0))) err("Tolerance must be a number.");
  if (props.offset !== null && props.offset !== undefined && !Number.isFinite(Number(props.offset))) err("Offset must be a number.");
  if (!crvFileName(props.name)) err("Give the curve a file name.");

  for (const layer of doc.layers ?? []) {
    if ((layer.kind === "hpf" || layer.kind === "lpf" || layer.kind === "subBoost" || layer.kind === "hiShelf") && layer.on !== false) {
      const filter = Object.hasOwn(FILTERS, layer.type) ? FILTERS[layer.type] : undefined;
      const label = { subBoost: "Low shelf", hiShelf: "High shelf" }[layer.kind] ?? layer.kind.toUpperCase();
      if (!filter) err(`${label}: unknown filter type "${layer.type}".`);
      else if ((layer.kind === "subBoost" || layer.kind === "hiShelf") && filter.shelfSafe === false) {
        err(`${label}: ${filter.label} can't be used for a shelf (its passband ripples). Use Butterworth, Linkwitz-Riley or Bessel.`);
      } else if (!filter.allowedSlopes.includes(Number(layer.slope))) {
        err(`${label}: ${filter.label} allows ${filter.allowedSlopes.join(", ")} dB/oct (got ${layer.slope}).`);
      }
      if (!(Number(layer.fc) > 0)) err(`${label}: corner frequency must be greater than 0 Hz.`);
    }
    if (layer.kind === "weighting" && layer.on !== false && !(typeof layer.curve === "string" && Object.hasOwn(WEIGHTINGS, layer.curve))) {
      err(`Weighting: unknown curve "${layer.curve}".`);
    }
    const extra = { bell: ["Bell", "q", LAYER_LIMITS.q], hill: ["Hill", "width", LAYER_LIMITS.width], rHpf: ["Resonant HPF", "q", LAYER_LIMITS.resonantQ], rLpf: ["Resonant LPF", "q", LAYER_LIMITS.resonantQ] }[layer.kind];
    if (extra && layer.on !== false) {
      const [name, key, [lo, hi]] = extra;
      if (!(Number(layer.fc) > 0)) err(`${name}: frequency must be greater than 0 Hz.`);
      if (!(Number(layer[key]) >= lo && Number(layer[key]) <= hi)) err(`${name}: ${key === "q" ? "Q" : key} must be between ${lo} and ${hi}.`);
      if (layer.db !== undefined && !(Math.abs(Number(layer.db)) <= LAYER_LIMITS.db[1])) err(`${name}: gain must be between ${LAYER_LIMITS.db[0]} and +${LAYER_LIMITS.db[1]} dB.`);
    }
  }
  return out;
}

/** Smaart transfer-function target curve adapter. */
export const smaartTf = {
  id: "smaart-tf",
  label: "Smaart TF target (.crv)",
  ext: ".crv",
  mime: "application/octet-stream",
  canExport: true,
  detect(text) {
    const r = readCrv(text);
    return r.kind === "tf" && r.points.length ? 1 : 0;
  },
  read(text) {
    const { kind, ...rest } = readCrv(text);
    return rest;
  },
  write: writeTf,
  validate: validateTf,
};

/** Smaart spectrum target curve adapter (read only in v1). */
export const smaartSpectrum = {
  id: "smaart-spectrum",
  label: "Smaart spectrum target (.crv)",
  ext: ".crv",
  canExport: false,
  detect(text) {
    const r = readCrv(text);
    // A .crv always has a header; text with none (for example a Smaart ASCII trace) isn't one.
    if (r.kind !== "spectrum" || !r.points.length || !r.props.rawHeader.length) return 0;
    return r.props.band !== null && BANDS.includes(r.props.band) ? 1 : 0.5;
  },
  read(text) {
    const { kind, ...rest } = readCrv(text);
    if (rest.props.band === null) rest.warnings.push("No Band line found: treating this as a spectrum curve.");
    return rest;
  },
  write() {
    throw new Error("Spectrum export arrives in a later version.");
  },
  validate() {
    return [{ level: "error", message: "Spectrum curve: export as Spectrum arrives in a later version." }];
  },
};
