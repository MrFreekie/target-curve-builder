// Hand-written SVG plot: log frequency axis, tolerance band, overlay, hover readout.
// DOM code only; all numbers come from the pure maths modules.
import { interpPoints } from "./layers.js";
import { smaartToPicker } from "./formats/smaart.js";

const NS = "http://www.w3.org/2000/svg";
const W = 900;
const H = 440;
const M = { l: 54, r: 18, t: 16, b: 36 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;
// The visible frequency range is set on every render (the app keeps it at the full 20 Hz to 20 kHz).
let FMIN = 20;
let FMAX = 20000;
let OCTAVES = Math.log2(FMAX / FMIN);
// Octave tick frequencies (labelled) and the 1/3-octave preferred series (minor lines), over several decades.
const MAJOR_ALL = [1, 2, 4, 8, 16, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 31500, 63000];
const THIRDS = [];
for (const decade of [0.1, 1, 10, 100, 1000, 10000, 100000]) {
  for (const s of [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8]) THIRDS.push(+(s * decade).toPrecision(5));
}
const tickLabel = (f) => (f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : String(f));

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
 * @param {{onDragStart?: Function, onDrag?: Function, onDragEnd?: Function, onNudge?: Function}} [callbacks]
 *   Handle callbacks: onDragStart(i), onDrag(i, dDb, hzOrNull), onDragEnd(i), onNudge(i, dDb).
 * @returns {{render(model: object): void}}
 */
export function createPlot(svg, callbacks = {}) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  // a group, not an image: the point handles inside are sliders and must stay reachable by screen readers
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Target curve plot");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const clipId = "plot-clip";
  let model = null;
  let yMin = -24;
  let yMax = 24;
  const yOf = (g) => M.t + ((yMax - g) / (yMax - yMin)) * PH;

  const layers = {
    grid: el("g", { class: "grid" }),
    clipped: el("g", { "clip-path": `url(#${clipId})` }),
    handles: el("g", { class: "handles" }),
    hover: el("g", { class: "hover" }),
  };
  const defs = el("defs");
  const clip = el("clipPath", { id: clipId });
  clip.append(el("rect", { x: M.l, y: M.t, width: PW, height: PH }));
  defs.append(clip);
  svg.append(defs, layers.grid, layers.clipped, layers.handles, layers.hover);
  let drag = null;
  let rovingIndex = 0;

  const hoverLine = el("line", { class: "hover-line", y1: M.t, y2: M.t + PH, visibility: "hidden" });
  const hoverDot = el("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
  const readout = el("text", { class: "readout", x: M.l + 8, y: M.t + 18 }, "");
  layers.hover.append(hoverLine, hoverDot, readout);

  function range(curves, wide) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of curves) for (const [, g] of c) if (Number.isFinite(g)) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
    let a = -24;
    let b = 24;
    if (wide && Number.isFinite(lo)) {
      return [Math.floor((lo - 3) / 6) * 6, Math.ceil((hi + 3) / 6) * 6];
    }
    if (Number.isFinite(lo)) {
      // Centre the data: the window is at least 48 dB tall (the usual -24 to +24) and grows in steps of 6 dB, with the
      // same space above the highest point and below the lowest. The Y offset slider then moves it from there.
      const span = Math.max(48, Math.ceil((hi - lo + 6) / 6) * 6);
      const mid = (lo + hi) / 2;
      a = mid - span / 2;
      b = mid + span / 2;
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
    const inView = (f) => f >= FMIN * (1 - 1e-9) && f <= FMAX * (1 + 1e-9);
    const majors = MAJOR_ALL.filter(inView);
    const minors = THIRDS.filter((f) => inView(f) && !MAJOR_ALL.includes(f));
    for (const f of minors) {
      layers.grid.append(el("line", { x1: xOf(f), x2: xOf(f), y1: M.t, y2: M.t + PH, class: "minor" }));
      // a narrow trimmed range has few octave marks, so label the 1/3-octave ones too
      if (majors.length < 4) layers.grid.append(el("text", { x: xOf(f), y: H - 14, class: "tick", "text-anchor": "middle" }, tickLabel(f)));
    }
    for (const f of majors) {
      layers.grid.append(el("line", { x1: xOf(f), x2: xOf(f), y1: M.t, y2: M.t + PH, class: "major" }));
      layers.grid.append(el("text", { x: xOf(f), y: H - 14, class: "tick", "text-anchor": "middle" }, tickLabel(f)));
    }
    layers.grid.append(el("text", { x: M.l + PW, y: H - 2, class: "axis", "text-anchor": "end" }, "Hz"));
    layers.grid.append(el("text", { x: 4, y: M.t + 8, class: "axis" }, "dB"));
    layers.grid.append(el("rect", { x: M.l, y: M.t, width: PW, height: PH, class: "frame" }));
  }

  const path = (pts) => pts.map(([f, g], i) => `${i ? "L" : "M"}${xOf(f).toFixed(2)},${yOf(g).toFixed(2)}`).join(" ");

  /**
   * @param {{points: number[][], original?: number[][]|null, template?: number[][]|null, templateName?: string, yRange?: number|null, yOffset?: number, hidePoints?: boolean, fmin?: number, fmax?: number, ghosts?: {points: number[][], hue: number, title: string}[], extra?: (f: number) => string, color: string, line: number,
   *          tolerance: number, useTolerance: boolean, show: boolean, description: string}} m
   */
  function render(m) {
    model = m;
    FMIN = Number(m.fmin) > 0 ? Number(m.fmin) : 20;
    FMAX = Number(m.fmax) > FMIN ? Number(m.fmax) : Math.max(FMIN * 2, 20000);
    OCTAVES = Math.log2(FMAX / FMIN);
    const curves = [m.points];
    if (m.original) curves.push(m.original);
    if (m.template) curves.push(m.template);
    if (!drag) {
      [yMin, yMax] = m.yRange ? [-m.yRange, m.yRange] : range(curves, m.wide);
      // View offset: slide the visible window up or down; axis labels stay true dB values.
      yMin += m.yOffset ?? 0;
      yMax += m.yOffset ?? 0;
    }
    const focused = svg.contains(document.activeElement) ? document.activeElement.dataset?.handle : undefined;
    drawGrid();
    const g = layers.clipped;
    g.replaceChildren();
    // Layer ghosts: each layer's own contribution, faint and behind everything else.
    for (const gh of m.ghosts ?? []) {
      const p = el("path", { d: path(gh.points), class: "ghost" });
      p.style.stroke = `hsl(${Number(gh.hue) || 0} 70% var(--ghost-l, 62%))`; // set through the CSSOM so the page needs no inline styles
      p.append(el("title", {}, gh.title));
      g.append(p);
    }
    if (m.original && m.original.length > 1) {
      g.append(el("path", { d: path(m.original), class: "original" }));
    }
    if (m.template && m.template.length > 1) {
      const t = el("path", { d: path(m.template), class: "template" });
      t.append(el("title", {}, m.templateName || "Reference trace"));
      g.append(t);
    }
    const color = smaartToPicker(m.color);
    if (m.points.length > 1) {
      if (m.useTolerance) {
        const up = m.points.map(([f, v]) => [f, v + m.tolerance]);
        const dn = m.points.map(([f, v]) => [f, v - m.tolerance]).reverse();
        g.append(el("path", { d: `${path(up)} L${path(dn).slice(1)} Z`, class: "band", fill: color }));
      }
      g.append(el("path", { d: path(m.points), class: "curve", stroke: color, "stroke-width": 1 + m.line, "stroke-dasharray": m.show ? "none" : "6 4" }));
      if (!m.hidePoints) for (const [f, v] of m.points) g.append(el("circle", { cx: xOf(f), cy: yOf(v), r: 3, class: "pt", stroke: color }));
    }
    layers.handles.replaceChildren();
    const hs = m.hidePoints ? [] : m.handles ?? [];
    if (rovingIndex >= hs.length) rovingIndex = 0;
    for (const h of hs) {
      const cx = Math.min(M.l + PW, Math.max(M.l, xOf(h.f)));
      const cy = Math.min(M.t + PH, Math.max(M.t, yOf(h.g)));
      layers.handles.append(el("circle", { cx, cy, r: 8, class: "handle-dot" }));
      // A large invisible circle is the real target: easy to hit with a finger.
      const c = el("circle", {
        cx, cy, r: 22, class: "handle", tabindex: h.i === rovingIndex ? 0 : -1, role: "slider",
        "data-handle": h.i, "data-f": h.f, "data-g": h.g,
        "aria-label": `Point ${h.i + 1}, ${formatHz(h.f)}`, "aria-orientation": "vertical",
        "aria-valuemin": yMin, "aria-valuemax": yMax, "aria-valuenow": Math.round(h.g * 100) / 100,
        "aria-valuetext": formatDb(h.g),
      });
      layers.handles.append(c);
      if (focused !== undefined && String(h.i) === focused) c.focus({ preventScroll: true });
    }
    svg.setAttribute("aria-label", m.description);
    hoverLine.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    readout.textContent = "";
  }

  const toSvg = (ev) => {
    const box = svg.getBoundingClientRect();
    return [((ev.clientX - box.left) / box.width) * W, ((ev.clientY - box.top) / box.height) * H];
  };
  const snap24 = (f) => Math.min(FMAX, Math.max(FMIN, Math.round(1000 * 2 ** (Math.round(24 * Math.log2(f / 1000)) / 24) * 1e6) / 1e6));

  svg.addEventListener("pointerdown", (ev) => {
    const i = ev.target.dataset?.handle;
    if (i === undefined || !callbacks.onDrag || ev.button !== 0) return;
    ev.preventDefault();
    const [x0, y0] = toSvg(ev);
    drag = { i: Number(i), x0, y0, f0: Number(ev.target.dataset.f), g0: Number(ev.target.dataset.g), pointer: ev.pointerId };
    rovingIndex = drag.i;
    svg.setPointerCapture(ev.pointerId);
    callbacks.onDragStart?.(drag.i);
  });
  svg.addEventListener("pointerup", (ev) => {
    if (!drag || ev.pointerId !== drag.pointer) return;
    const i = drag.i;
    drag = null;
    callbacks.onDragEnd?.(i);
  });
  svg.addEventListener("lostpointercapture", () => {
    if (!drag) return;
    const i = drag.i;
    drag = null;
    callbacks.onDragEnd?.(i);
  });
  svg.addEventListener("focusin", (ev) => {
    const i = ev.target.dataset?.handle;
    if (i === undefined) return;
    rovingIndex = Number(i);
    for (const h of layers.handles.querySelectorAll(".handle")) h.tabIndex = h.dataset.handle === i ? 0 : -1;
  });
  svg.addEventListener("pointercancel", () => {
    if (!drag) return;
    const i = drag.i;
    drag = null;
    callbacks.onDragEnd?.(i);
  });
  svg.addEventListener("keydown", (ev) => {
    const i = ev.target.dataset?.handle;
    if (i === undefined || !callbacks.onNudge) return;
    const step = ev.shiftKey ? 0.1 : 0.5;
    const all = [...layers.handles.querySelectorAll(".handle")];
    const at = all.findIndex((h) => h.dataset.handle === i);
    if (ev.key === "ArrowUp") callbacks.onNudge(Number(i), step);
    else if (ev.key === "ArrowDown") callbacks.onNudge(Number(i), -step);
    else if (ev.key === "ArrowRight" || ev.key === "PageDown") all[Math.min(all.length - 1, at + 1)]?.focus();
    else if (ev.key === "ArrowLeft" || ev.key === "PageUp") all[Math.max(0, at - 1)]?.focus();
    else if (ev.key === "Home") all[0]?.focus();
    else if (ev.key === "End") all[all.length - 1]?.focus();
    else return;
    ev.preventDefault();
  });

  function onMove(ev) {
    if (drag) {
      const [x, y] = toSvg(ev);
      // Keep the point inside the plot's dB range, however far the pointer goes.
      const dDb = Math.min(yMax - drag.g0, Math.max(yMin - drag.g0, ((drag.y0 - y) / PH) * (yMax - yMin)));
      // Shift moves the frequency by the pointer's offset from where it was grabbed; without Shift the caller gets null and keeps the point's own frequency.
      const hz = ev.shiftKey ? snap24(drag.f0 * 2 ** (((x - drag.x0) / PW) * OCTAVES)) : null;
      callbacks.onDrag(drag.i, dDb, hz);
      return;
    }
    if (!model || model.points.length < 2) return;
    const box = svg.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * W;
    if (x < M.l || x > M.l + PW) { hideHover(); return; }
    const f = fOf(x);
    const g = interpPoints(f, model.points);
    hoverLine.setAttribute("x1", x);
    hoverLine.setAttribute("x2", x);
    hoverDot.setAttribute("cx", x);
    hoverDot.setAttribute("cy", Math.min(M.t + PH, Math.max(M.t, yOf(g))));
    hoverLine.setAttribute("visibility", "visible");
    hoverDot.setAttribute("visibility", "visible");
    const extra = model.extra ? model.extra(f) : "";
    readout.textContent = `${formatHz(f)}  ${formatDb(g)}${extra ? `  ${extra}` : ""}`;
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
