// Evaluate a document and build the export text, with every problem that blocks it. Pure: no DOM.
import { evaluate, effectiveRange, visibleLayers } from "./curve.js";
import { getAdapter } from "./formats/index.js";
import { LAYER_KINDS } from "./doc.js";

/** Layer-level problems the format validator can't see. */
export function layerIssues(doc) {
  const out = [];
  const bad = (m) => out.push({ level: "error", message: m });
  for (const l of visibleLayers(doc)) { // layers hidden by their group don't count
    if (l.on === false) continue;
    const name = LAYER_KINDS[l.kind];
    if (l.kind === "points") {
      if (!l.points.length) bad(`${name}: add at least one point or switch the layer off.`);
      const hz = l.points.map((p) => p[0]);
      if (new Set(hz).size !== hz.length) bad(`${name}: two points share the same frequency.`);
    }
    for (const key of ["pivot", "corner", "floor"]) {
      if (l[key] !== undefined && l[key] !== null && !(l[key] > 0)) bad(`${name}: ${key} must be greater than 0 Hz.`);
    }
  }
  if ((doc.grid.simplify === true || doc.grid.mode === "simplified") && doc.grid.epsilon !== undefined && !(doc.grid.epsilon >= 0.001 && doc.grid.epsilon <= 12)) {
    bad("Breakpoints only: max error must be between 0.001 and 12 dB.");
  }
  const g = doc.grid;
  for (const [key, label] of [["trimLow", "Low trim"], ["trimHigh", "High trim"]]) {
    if (g[key] !== undefined && !(g[key] >= 1 && g[key] <= 100000)) bad(`${label} must be between 1 and 100000 Hz.`);
  }
  if (g.trimLow !== undefined && g.trimHigh !== undefined && !(g.trimLow < g.trimHigh)) bad("Low trim must be below high trim.");
  else if (g.mode !== "original") {
    const [lo, hi] = effectiveRange(g);
    if (!(lo <= hi)) bad("The trim leaves no frequency range: the low trim is above the end of the grid, or the high trim below its start.");
  }
  if (doc.normalise.on && !(doc.normalise.at > 0)) bad("Normalise: frequency must be greater than 0 Hz.");
  if (Number(doc.props.tolerance) < 0) bad("Tolerance can't be negative.");
  return out;
}

/**
 * Evaluate a document and build the export text.
 * @param {object} doc
 * @param {string} [formatId] Export format, default "smaart-tf" (.crv). A spectrum document is always blocked.
 * @param {{withText?: boolean}} [options] withText false skips writing the file text (the caller only needs `ok`).
 * @returns {{points: number[][], ok: boolean, text: string|null, issues: {level: string, message: string}[]}} `ok` is true when nothing blocks export
 */
export function buildCrv(doc, formatId = "smaart-tf", { withText = true } = {}) {
  const adapter = getAdapter(doc.props.format === "smaart-spectrum" ? "smaart-spectrum" : formatId);
  const merged = layerIssues(doc);
  let points = [];
  let thrown = null;
  if (!merged.length) {
    try {
      points = evaluate(doc);
    } catch (e) {
      thrown = e.message;
    }
  }
  for (const i of adapter.validate(doc, points)) {
    if (!points.length && merged.length && /at least 2 points/.test(i.message)) continue; // already explained
    if (!merged.some((m) => m.message === i.message)) merged.push(i);
  }
  if (thrown && !merged.some((i) => i.message.includes("dB/oct"))) merged.push({ level: "error", message: thrown });
  const hasError = merged.some((i) => i.level === "error");
  return { points, ok: !hasError, text: hasError || !withText ? null : adapter.write(doc, points), issues: merged };
}
