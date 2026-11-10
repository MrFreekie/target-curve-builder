// UI state and wiring. Maths lives in curve.js / layers.js; file formats in formats/.
import { evaluate } from "./curve.js";
import { FILTERS } from "./layers.js";
import { getAdapter } from "./formats/index.js";
import { fmt6, pickerToSmaart, smaartToPicker, crvFileName } from "./formats/smaart.js";
import { createPlot } from "./plot.js";

const LAYER_KINDS = {
  points: "Points",
  lfTilt: "LF tilt",
  hfTilt: "HF tilt",
  fullTilt: "Full-spectrum tilt",
  hpf: "HPF",
  lpf: "LPF",
  gain: "Gain",
};

let nextId = 1;
const newId = () => `L${nextId++}`;

/** A new document with the defaults from SPEC §4.5. */
export function newDoc() {
  return {
    version: 1,
    props: {
      name: "Target curve", format: "smaart-tf", line: 2, color: "ffff0000", show: 1,
      tolerance: 3, useTolerance: 0, offset: null, extraHeader: [], lineEnding: "\r\n", trailingNewline: true,
    },
    grid: { mode: "resample", fraction: 3, fmin: 20, fmax: 20000 },
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

/** Layer-level problems the format validator can't see. */
function layerIssues(doc) {
  const out = [];
  const bad = (m) => out.push({ level: "error", message: m });
  for (const l of doc.layers) {
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
  if (doc.normalise.on && !(doc.normalise.at > 0)) bad("Normalise: frequency must be greater than 0 Hz.");
  if (Number(doc.props.tolerance) < 0) bad("Tolerance can't be negative.");
  return out;
}

/**
 * Evaluate a document and build the .crv text.
 * @returns {{points: number[][], text: string|null, issues: {level: string, message: string}[]}}
 */
export function buildCrv(doc) {
  const adapter = getAdapter(doc.props.format ?? "smaart-tf");
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
  return { points, text: hasError ? null : adapter.write(doc, points), issues: merged };
}

// ------------------------------------------------------------------ DOM wiring
/** Parse "12", "-3.5" or "3,5". Rejects "1,000", "1e3", "0x10" and empty text (returns NaN). */
function parseNum(s) {
  const t = String(s).trim();
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return NaN;
  if (/^[-+]?\d{1,3},\d{3}$/.test(t)) return NaN; // "1,000" is ambiguous: thousands or decimal?
  return Number(t.replace(",", "."));
}

function startApp() {
  const $ = (id) => document.getElementById(id);
  let doc = newDoc();
  const expanded = new Set();
  const plot = createPlot($("plot"));
  let uid = 0;

  /** Text input bound to a number. `optional` lets an empty box mean null. */
  function numField(label, value, onSet, { optional = false, placeholder = "" } = {}) {
    const id = `f${uid++}`;
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.htmlFor = id;
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = placeholder;
    input.value = value === null || value === undefined ? "" : String(value);
    let lastGood = input.value;
    input.addEventListener("input", () => {
      const raw = input.value.trim();
      const n = parseNum(raw);
      if (raw === "" && optional) { input.removeAttribute("aria-invalid"); onSet(null); }
      else if (Number.isFinite(n)) { input.removeAttribute("aria-invalid"); onSet(n); }
      else { input.setAttribute("aria-invalid", "true"); return; }
      lastGood = input.value;
      update();
    });
    input.addEventListener("blur", () => {
      if (input.getAttribute("aria-invalid")) { input.value = lastGood; input.removeAttribute("aria-invalid"); }
    });
    wrap.append(lab, input);
    return wrap;
  }

  function selectField(label, options, value, onSet) {
    const id = `f${uid++}`;
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.htmlFor = id;
    lab.textContent = label;
    const sel = document.createElement("select");
    sel.id = id;
    for (const [v, text] of options) {
      const o = document.createElement("option");
      o.value = String(v);
      o.textContent = text;
      sel.append(o);
    }
    sel.value = String(value);
    sel.addEventListener("change", () => onSet(sel.value));
    wrap.append(lab, sel);
    return wrap;
  }

  function layerTitle(l) {
    switch (l.kind) {
      case "points": return `Points (${l.points.length})`;
      case "lfTilt": return `LF tilt ${l.dbPerOct} dB/oct`;
      case "hfTilt": return `HF tilt ${l.dbPerOct} dB/oct`;
      case "fullTilt": return `Full tilt ${l.dbPerOct} dB/oct`;
      case "hpf": return `HPF ${l.fc} Hz ${l.type}${l.slope}`;
      case "lpf": return `LPF ${l.fc} Hz ${l.type}${l.slope}`;
      default: return `Gain ${l.db} dB`;
    }
  }

  function pointsEditor(l) {
    const box = document.createElement("div");
    const table = document.createElement("table");
    table.className = "pts-table";
    const thead = table.createTHead();
    thead.className = "sr-only";
    thead.innerHTML = "<tr><th>Hz</th><th>dB</th><th>Delete</th></tr>";
    const tbody = table.createTBody();
    const rebuild = () => {
      tbody.replaceChildren();
      l.points.forEach((p, i) => {
        const tr = document.createElement("tr");
        const mk = (idx, label) => {
          const td = document.createElement("td");
          const input = document.createElement("input");
          input.type = "text";
          input.inputMode = "decimal";
          input.value = String(p[idx]);
          input.setAttribute("aria-label", `Point ${i + 1} ${label}`);
          input.addEventListener("input", () => {
            const n = parseNum(input.value);
            if (!Number.isFinite(n) || (idx === 0 && n <= 0)) { input.setAttribute("aria-invalid", "true"); return; }
            input.removeAttribute("aria-invalid");
            p[idx] = n;
            update();
          });
          input.addEventListener("blur", () => {
            if (input.getAttribute("aria-invalid")) { input.value = String(p[idx]); input.removeAttribute("aria-invalid"); }
          });
          td.append(input);
          return td;
        };
        const del = document.createElement("td");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon";
        b.textContent = "✕";
        b.setAttribute("aria-label", `Delete point ${i + 1}`);
        b.addEventListener("click", () => { l.points.splice(i, 1); rebuild(); update(); });
        del.append(b);
        tr.append(mk(0, "Hz"), mk(1, "dB"), del);
        tbody.append(tr);
      });
    };
    rebuild();
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add point";
    add.addEventListener("click", () => {
      const last = l.points[l.points.length - 1];
      const prev = l.points.length > 1 ? l.points[l.points.length - 2] : null;
      // New point: halfway (in log frequency) between the last two points, or an octave above the last.
      const hz = last ? (prev ? Math.sqrt(prev[0] * last[0]) : Math.min(last[0] * 2, 20000)) : 1000;
      l.points.push([Math.round(hz * 100) / 100, last ? last[1] : 0]);
      l.points.sort((x, y) => x[0] - y[0]);
      rebuild();
      update();
    });
    box.append(table, add);
    return box;
  }

  function layerBody(l) {
    const body = document.createElement("div");
    body.className = "layer-body";
    const set = (key) => (v) => { l[key] = v; };
    switch (l.kind) {
      case "points": body.append(pointsEditor(l)); break;
      case "lfTilt":
        body.append(numField("dB per octave", l.dbPerOct, set("dbPerOct")), numField("Pivot (Hz)", l.pivot, set("pivot")),
          numField("Floor (Hz, optional)", l.floor, set("floor"), { optional: true, placeholder: "none" }));
        break;
      case "fullTilt":
        body.append(numField("dB per octave", l.dbPerOct, set("dbPerOct")), numField("Pivot (Hz)", l.pivot, set("pivot")));
        break;
      case "hfTilt":
        body.append(numField("dB per octave", l.dbPerOct, set("dbPerOct")), numField("Corner (Hz)", l.corner, set("corner")));
        break;
      case "gain": body.append(numField("Level (dB)", l.db, set("db"))); break;
      default: {
        body.append(numField("Corner frequency (Hz)", l.fc, set("fc")));
        const slopeHost = document.createElement("div");
        const fillSlope = () => {
          slopeHost.replaceChildren(selectField("Slope (dB/oct)",
            FILTERS[l.type].allowedSlopes.map((s) => [s, String(s)]), l.slope, (v) => { l.slope = Number(v); update(); }));
        };
        body.append(selectField("Type", Object.values(FILTERS).map((f) => [f.id, f.label]), l.type, (v) => {
          l.type = v;
          if (!FILTERS[v].allowedSlopes.includes(l.slope)) l.slope = FILTERS[v].allowedSlopes.at(-1);
          fillSlope();
          update();
        }), slopeHost);
        fillSlope();
      }
    }
    return body;
  }

  /** Rebuild the layer list, then put keyboard focus back on `focus` = [layerId, action]. */
  function renderLayers(focus) {
    const ul = $("layers");
    ul.replaceChildren();
    doc.layers.forEach((l, i) => {
      const li = document.createElement("li");
      li.className = `layer${l.on ? "" : " off"}`;
      li.dataset.id = l.id;
      const head = document.createElement("div");
      head.className = "layer-head";
      const on = document.createElement("input");
      on.type = "checkbox";
      on.checked = l.on;
      const label = `${layerTitle(l)}, layer ${i + 1} of ${doc.layers.length}`;
      on.dataset.action = "on";
      on.setAttribute("aria-label", `${label}: on`);
      on.addEventListener("change", () => { l.on = on.checked; li.classList.toggle("off", !l.on); update(); });
      const title = document.createElement("button");
      title.type = "button";
      title.className = "title";
      title.dataset.action = "toggle";
      title.setAttribute("aria-expanded", String(expanded.has(l.id)));
      title.addEventListener("click", () => { expanded.has(l.id) ? expanded.delete(l.id) : expanded.add(l.id); renderLayers([l.id, "toggle"]); });
      const icon = (text, action, label, fn, disabled) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon";
        b.dataset.action = action;
        b.textContent = text;
        b.setAttribute("aria-label", `${label}: ${layerTitle(l)}`);
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        return b;
      };
      const move = (d, action) => () => { const [x] = doc.layers.splice(i, 1); doc.layers.splice(i + d, 0, x); renderLayers([l.id, action]); update(); };
      const remove = () => {
        const next = doc.layers[i + 1] ?? doc.layers[i - 1];
        doc.layers.splice(i, 1);
        expanded.delete(l.id);
        renderLayers(next ? [next.id, "toggle"] : ["", "add"]);
        update();
      };
      head.append(on, title,
        icon("↑", "up", "Move up", move(-1, "up"), i === 0),
        icon("↓", "down", "Move down", move(1, "down"), i === doc.layers.length - 1),
        icon("✕", "del", "Delete", remove));
      li.append(head);
      if (expanded.has(l.id)) li.append(layerBody(l));
      ul.append(li);
    });
    refreshTitles();
    if (focus) {
      const target = focus[1] === "add" ? $("add-kind")
        : document.querySelector(`#layers li[data-id="${focus[0]}"] [data-action="${focus[1]}"]:not(:disabled)`)
          ?? document.querySelector(`#layers li[data-id="${focus[0]}"] .title`);
      target?.focus();
    }
  }

  function refreshTitles() {
    for (const l of doc.layers) {
      const b = document.querySelector(`#layers li[data-id="${l.id}"] .title`);
      if (b) b.textContent = `${expanded.has(l.id) ? "▾" : "▸"} ${layerTitle(l)}`;
    }
  }

  function renderProps() {
    const p = doc.props;
    $("p-name").value = p.name;
    $("p-color").value = smaartToPicker(p.color);
    $("p-line").value = String(p.line);
    $("p-show").checked = !!p.show;
    $("p-tol").value = String(p.tolerance);
    $("p-usetol").checked = !!p.useTolerance;
    $("p-offset").value = p.offset === null ? "" : String(p.offset);
    $("n-on").checked = doc.normalise.on;
    $("n-at").value = String(doc.normalise.at);
    renderGridModes();
  }

  const GRID_CHOICES = [["3", "1/3 octave"], ["1", "1/1 octave"], ["6", "1/6 octave"], ["12", "1/12 octave"], ["24", "1/24 octave"], ["original", "Keep original"]];
  function renderGridModes() {
    const host = $("grid-modes");
    host.querySelectorAll("label").forEach((n) => n.remove());
    for (const [value, text] of GRID_CHOICES) {
      const label = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "grid";
      r.value = value;
      r.disabled = value === "original" && !doc.original;
      r.checked = value === "original" ? doc.grid.mode === "original" : doc.grid.mode !== "original" && String(doc.grid.fraction) === value;
      r.addEventListener("change", () => {
        if (value === "original") doc.grid.mode = "original";
        else { doc.grid.mode = "resample"; doc.grid.fraction = Number(value); }
        update();
      });
      label.append(r, document.createTextNode(text));
      host.append(label);
    }
  }

  function update() {
    refreshTitles();
    const { points, text, issues } = buildCrv(doc);
    plot.render({
      points, original: doc.original, color: doc.props.color, line: Number(doc.props.line) || 2,
      tolerance: Number(doc.props.tolerance) || 0, useTolerance: !!doc.props.useTolerance, show: !!doc.props.show,
      description: points.length
        ? `Target curve ${doc.props.name}, ${points.length} points from ${fmt6(points[0][0])} Hz to ${fmt6(points.at(-1)[0])} Hz. The same values are in the table below.`
        : "No curve to show.",
    });
    const tbody = $("points-table").tBodies[0];
    const rows = document.createDocumentFragment();
    for (const [f, g] of points) {
      const tr = document.createElement("tr");
      for (const v of [fmt6(f), fmt6(g)]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      rows.append(tr);
    }
    tbody.replaceChildren(rows);
    const list = $("validation");
    list.replaceChildren();
    for (const i of issues) {
      const li = document.createElement("li");
      li.className = i.level;
      li.textContent = i.message;
      list.append(li);
    }
    if (text) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "Ready to export.";
      list.append(li);
    }
    $("btn-export").disabled = !text;
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- properties
  const bindNum = (id, set, { optional = false } = {}) => {
    let lastGood = $(id).value;
    $(id).addEventListener("blur", () => {
      if ($(id).getAttribute("aria-invalid")) { $(id).value = lastGood; $(id).removeAttribute("aria-invalid"); }
    });
    $(id).addEventListener("input", () => {
      const raw = $(id).value.trim();
      const n = parseNum(raw);
      if (raw === "" && optional) { $(id).removeAttribute("aria-invalid"); set(null); }
      else if (Number.isFinite(n)) { $(id).removeAttribute("aria-invalid"); set(n); }
      else { $(id).setAttribute("aria-invalid", "true"); return; }
      lastGood = $(id).value;
      update();
    });
  };
  $("p-name").addEventListener("input", () => { doc.props.name = $("p-name").value; update(); });
  $("p-color").addEventListener("input", () => { doc.props.color = pickerToSmaart($("p-color").value); update(); });
  $("p-line").addEventListener("change", () => { doc.props.line = Number($("p-line").value); update(); });
  $("p-show").addEventListener("change", () => { doc.props.show = $("p-show").checked ? 1 : 0; update(); });
  $("p-usetol").addEventListener("change", () => { doc.props.useTolerance = $("p-usetol").checked ? 1 : 0; update(); });
  bindNum("p-tol", (n) => { doc.props.tolerance = n; });
  bindNum("p-offset", (n) => { doc.props.offset = n; }, { optional: true });
  bindNum("n-at", (n) => { doc.normalise.at = n; });
  $("n-on").addEventListener("change", () => { doc.normalise.on = $("n-on").checked; update(); });

  // ---- add layer
  for (const [k, label] of Object.entries(LAYER_KINDS)) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = label;
    $("add-kind").append(o);
  }
  $("btn-add").addEventListener("click", () => {
    const l = newLayer($("add-kind").value);
    doc.layers.push(l);
    expanded.add(l.id);
    renderLayers([l.id, "toggle"]);
    update();
  });

  // ---- top bar
  $("btn-new").addEventListener("click", () => {
    if (!window.confirm("Start a new curve? Your current curve will be discarded.")) return;
    doc = newDoc();
    expanded.clear();
    renderProps();
    renderLayers();
    update();
  });
  $("btn-export").addEventListener("click", () => {
    const { text } = buildCrv(doc);
    if (text) download(crvFileName(doc.props.name), text);
  });
  const THEMES = ["auto", "dark", "light"];
  let theme = "auto";
  try { theme = THEMES.includes(localStorage.getItem("tcb-theme")) ? localStorage.getItem("tcb-theme") : "auto"; } catch { /* storage unavailable */ }
  const applyTheme = () => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    $("btn-theme").textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  };
  $("btn-theme").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem("tcb-theme", theme); } catch { /* storage unavailable */ }
    applyTheme();
  });
  applyTheme();

  $("btn-copy").addEventListener("click", async () => {
    const { points } = buildCrv(doc);
    const out = points.map(([f, g]) => `${fmt6(f)}\t${fmt6(g)}`).join("\n");
    const btn = $("btn-copy");
    let ok = false;
    try {
      await navigator.clipboard.writeText(out);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = out;
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { btn.textContent = "Copy as text"; }, 1500);
  });

  renderProps();
  renderLayers();
  update();
}

if (typeof document !== "undefined") startApp();
