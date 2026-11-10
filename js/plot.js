// Hand-written SVG plot: log frequency axis, tolerance band, overlay, hover readout.
// DOM code only; all numbers come from the pure maths modules.
import { NOMINAL_3 } from "./curve.js";
import { interpPoints } from "./layers.js";
import { smaartToPicker } from "./formats/smaart.js";

const NS = "http://www.w3.org/2000/svg";
const W = 900;
const H = 440;
const M = { l: 54, r: 18, t: 16, b: 36 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;
const FMIN = 20;
const FMAX = 20000;
const OCTAVES = Math.log2(FMAX / FMIN);
const MAJOR = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const MAJOR_LABEL = { 1000: "1k", 2000: "2k", 4000: "4k", 8000: "8k", 16000: "16k" };

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const xOf = (f) => M.l + (Math.log2(Math.max(f, 1e-6) / FMIN) / OCTAVES) * PW;
const fOf = (x) => FMIN * 2 ** (((x - M.l) / PW) * OCTAVES);

/** Format a frequency for the readout, e.g. 63 Hz, 1.25 kHz. */
export function formatHz(f) {
  return f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`;
}

/** Format dB with a sign, e.g. +6.96 dB. */
export function formatDb(g) {
  const v = Math.round(g * 100) / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} dB`;
}

/**
 * Create a plot inside an <svg> element.
 * @param {SVGSVGElement} svg
 * @returns {{render(model: object): void}}
 */
export function createPlot(svg) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const clipId = "plot-clip";
  let model = null;
  let yMin = -24;
  let yMax = 24;
  const yOf = (g) => M.t + ((yMax - g) / (yMax - yMin)) * PH;

  const layers = {
    grid: el("g", { class: "grid" }),
    clipped: el("g", { "clip-path": `url(#${clipId})` }),
    hover: el("g", { class: "hover" }),
  };
  const defs = el("defs");
  const clip = el("clipPath", { id: clipId });
  clip.append(el("rect", { x: M.l, y: M.t, width: PW, height: PH }));
  defs.append(clip);
  svg.append(defs, layers.grid, layers.clipped, layers.hover);

  const hoverLine = el("line", { class: "hover-line", y1: M.t, y2: M.t + PH, visibility: "hidden" });
  const hoverDot = el("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
  const readout = el("text", { class: "readout", x: M.l + 8, y: M.t + 18 }, "");
  layers.hover.append(hoverLine, hoverDot, readout);

  function range(curves) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of curves) for (const [, g] of c) if (Number.isFinite(g)) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
    let a = -24;
    let b = 24;
    if (Number.isFinite(lo)) {
      a = Math.min(a, Math.floor((lo - 3) / 6) * 6);
      b = Math.max(b, Math.ceil((hi + 3) / 6) * 6);
    }
    return [Math.max(a, -60), Math.min(b, 60)];
  }

  function drawGrid() {
    layers.grid.replaceChildren();
    const step = yMax - yMin > 60 ? 12 : 6;
    for (let g = Math.ceil(yMin / step) * step; g <= yMax; g += step) {
      layers.grid.append(el("line", { x1: M.l, x2: M.l + PW, y1: yOf(g), y2: yOf(g), class: g === 0 ? "zero" : "major" }));
      layers.grid.append(el("text", { x: M.l - 8, y: yOf(g) + 4, class: "tick", "text-anchor": "end" }, `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g)}`));
    }
    for (const f of NOMINAL_3) {
      if (!MAJOR.includes(f)) layers.grid.append(el("line", { x1: xOf(f), x2: xOf(f), y1: M.t, y2: M.t + PH, class: "minor" }));
    }
    for (const f of MAJOR) {
      layers.grid.append(el("line", { x1: xOf(f), x2: xOf(f), y1: M.t, y2: M.t + PH, class: "major" }));
      layers.grid.append(el("text", { x: xOf(f), y: H - 14, class: "tick", "text-anchor": "middle" }, MAJOR_LABEL[f] ?? String(f)));
    }
    layers.grid.append(el("text", { x: M.l + PW, y: H - 2, class: "axis", "text-anchor": "end" }, "Hz"));
    layers.grid.append(el("text", { x: 4, y: M.t + 8, class: "axis" }, "dB"));
    layers.grid.append(el("rect", { x: M.l, y: M.t, width: PW, height: PH, class: "frame" }));
  }

  const path = (pts) => pts.map(([f, g], i) => `${i ? "L" : "M"}${xOf(f).toFixed(2)},${yOf(g).toFixed(2)}`).join(" ");

  /**
   * @param {{points: number[][], original?: number[][]|null, color: string, line: number,
   *          tolerance: number, useTolerance: boolean, show: boolean, description: string}} m
   */
  function render(m) {
    model = m;
    const curves = [m.points];
    if (m.original) curves.push(m.original);
    [yMin, yMax] = range(curves);
    drawGrid();
    const g = layers.clipped;
    g.replaceChildren();
    if (m.original && m.original.length > 1) {
      g.append(el("path", { d: path(m.original), class: "original" }));
    }
    const color = smaartToPicker(m.color);
    if (m.points.length > 1) {
      if (m.useTolerance) {
        const up = m.points.map(([f, v]) => [f, v + m.tolerance]);
        const dn = m.points.map(([f, v]) => [f, v - m.tolerance]).reverse();
        g.append(el("path", { d: `${path(up)} L${path(dn).slice(1)} Z`, class: "band", fill: color }));
      }
      g.append(el("path", { d: path(m.points), class: "curve", stroke: color, "stroke-width": 1 + m.line, "stroke-dasharray": m.show ? "none" : "6 4" }));
      for (const [f, v] of m.points) g.append(el("circle", { cx: xOf(f), cy: yOf(v), r: 3, class: "pt", stroke: color }));
    }
    svg.setAttribute("aria-label", m.description);
    hoverLine.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    readout.textContent = "";
  }

  function onMove(ev) {
    if (!model || model.points.length < 2) return;
    const box = svg.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * W;
    if (x < M.l || x > M.l + PW) { hideHover(); return; }
    const f = fOf(x);
    const g = interpPoints(f, model.points);
    hoverLine.setAttribute("x1", x);
    hoverLine.setAttribute("x2", x);
    hoverDot.setAttribute("cx", x);
    hoverDot.setAttribute("cy", yOf(g));
    hoverLine.setAttribute("visibility", "visible");
    hoverDot.setAttribute("visibility", "visible");
    readout.textContent = `${formatHz(f)}  ${formatDb(g)}`;
  }
  svg.addEventListener("pointermove", onMove);
  function hideHover() {
    hoverLine.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    readout.textContent = "";
  }
  // On touch, keep the last reading after the finger lifts.
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hideHover(); });

  return { render };
}
