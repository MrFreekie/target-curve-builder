// UI state and wiring. Maths lives in curve.js / layers.js; file formats in formats/.
import { evaluate, effectiveRange, layerGhosts, visibleLayers } from "./curve.js";
import { FILTERS } from "./layers.js";
import { getAdapter, writableAdapters } from "./formats/index.js";
import { fmt6, pickerToSmaart, smaartToPicker, crvFileName, exportFileName } from "./formats/smaart.js";
import { createPlot } from "./plot.js";
import { LAYER_KINDS, newDoc, newLayer, docFromImport, convertToTf, resetToImport, isBlank, addImportedLayer } from "./doc.js";
import { WEIGHTINGS, SHAPES } from "./eq.js";
import * as presets from "./presets.js";
import { suggestName } from "./naming.js";
import { randomContrastingColour } from "./colour.js";
import { qToBw, bwToQ } from "./bandwidth.js";
import { noteLabel, wavelengthLabel } from "./pitch.js";

export { newDoc, newLayer };

/** Layer-level problems the format validator can't see. */
function layerIssues(doc) {
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
  if (doc.grid.mode === "simplified" && doc.grid.epsilon !== undefined && !(doc.grid.epsilon >= 0.001 && doc.grid.epsilon <= 12)) {
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
 * @returns {{points: number[][], text: string|null, issues: {level: string, message: string}[]}}
 */
export function buildCrv(doc, formatId = "smaart-tf") {
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
  let doc = presets.loadAutosave() ?? newDoc();
  let importMessages = [];
  const expanded = new Set();
  const plot = createPlot($("plot"), { onDragStart: dragStart, onDrag: dragMove, onDragEnd: dragEnd, onNudge: nudge });

  // ---- undo / redo / autosave
  const undoStack = [];
  const redoStack = [];
  let lastJson = JSON.stringify(doc);
  let dragging = false;
  let saveTimer = null;
  let lastPushAt = 0;
  let lastPushEl = null;
  /** A stable name for "the control being edited", or null if edits shouldn't be merged. */
  function coalesceKey(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.handle !== undefined) return `handle${el.dataset.handle}`;
    if (el.tagName === "INPUT" && ["text", "color", "range"].includes(el.type)) return el.id || el;
    return null;
  }
  const MAX_UNDO = 100;

  /** Record the document in the undo history if it changed since the last call. */
  function track() {
    if (dragging) return;
    const json = JSON.stringify(doc);
    if (json === lastJson) return;
    // Rapid edits of one control (typing, a colour or slider drag, arrow-key nudges) share one undo step.
    const key = coalesceKey(document.activeElement);
    if (!(key && key === lastPushEl && Date.now() - lastPushAt < 800)) {
      undoStack.push(lastJson);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    lastPushAt = Date.now();
    lastPushEl = key;
    redoStack.length = 0;
    lastJson = json;
    scheduleSave();
  }

  let autosaveWarned = false;
  function saveNow() {
    if (presets.autosave(lastJson) || autosaveWarned) return;
    autosaveWarned = true;
    importMessages.push("Autosave isn't available in this browser, so your work won't be restored after a reload. Use Presets > Save preset as JSON to keep it.");
    noticeSig = "";
    renderNotice();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  function setDoc(next) {
    doc = next;
    expanded.clear();
    refreshAll();
  }

  function restore(json) {
    // Remember which layer control has focus so it can be refocused after the list is rebuilt.
    const a = document.activeElement;
    const li = a && a.closest ? a.closest("#layers li") : null;
    const focus = li && a.dataset.action ? [li.dataset.id, a.dataset.action] : undefined;
    doc = JSON.parse(json);
    lastJson = json;
    lastPushEl = null;
    refreshAll(focus);
    scheduleSave();
  }

  function undo() {
    if (dragging || !undoStack.length) return;
    redoStack.push(lastJson);
    restore(undoStack.pop());
  }

  function redo() {
    if (dragging || !redoStack.length) return;
    undoStack.push(lastJson);
    restore(redoStack.pop());
  }

  function refreshAll(focus) {
    renderProps();
    renderGroups();
    renderLayers(focus);
    update();
  }

  // ---- drag handles on the plot (edit the first points layer that is on)
  let dragBase = null;
  const pointsLayer = () => visibleLayers(doc).find((l) => l.kind === "points" && l.on);
  function dragStart(i) {
    const l = pointsLayer();
    if (!l || !l.points[i]) return;
    dragging = true;
    dragBase = { db: l.points[i][1] };
  }
  function dragMove(i, dDb, hz) {
    const l = pointsLayer();
    if (!dragging || !l || !l.points[i]) return;
    // On an inverted layer the plotted curve moves the opposite way to the stored value.
    l.points[i][1] = Math.round((dragBase.db + (l.invert === true ? -dDb : dDb)) * 100) / 100;
    if (hz !== null) l.points[i][0] = hz;
    if (expanded.has(l.id)) renderLayers();
    update();
  }
  function dragEnd() {
    dragging = false;
    const l = pointsLayer();
    if (l) l.points.sort((a, b) => a[0] - b[0]);
    renderLayers();
    update();
  }
  function nudge(i, d) {
    const l = pointsLayer();
    if (!l || !l.points[i]) return;
    l.points[i][1] = Math.round((l.points[i][1] + (l.invert === true ? -d : d)) * 100) / 100;
    if (expanded.has(l.id)) renderLayers();
    update();
  }
  let uid = 0;
  // How the bell's width is typed: "q" or "bw" (octaves). A view setting kept in this browser only.
  let qMode = "q";
  try { if (localStorage.getItem("tcb-qmode") === "bw") qMode = "bw"; } catch { /* storage unavailable */ }

  /** Text input bound to a number. `optional` lets an empty box mean null. */
  function numField(label, value, onSet, { optional = false, placeholder = "", check = null } = {}) {
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
      else if (Number.isFinite(n) && (!check || check(n))) { input.removeAttribute("aria-invalid"); onSet(n); }
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
    return baseTitle(l) + (l.invert === true ? " (inverted)" : "") + (hiddenByGroup(l) ? ` [${groupName(l.group)}, hidden]` : "");
  }

  function baseTitle(l) {
    switch (l.kind) {
      case "weighting": return WEIGHTINGS[l.curve]?.label ?? "Weighting";
      case "mesa": return `Mesa ${l.db > 0 ? "+" : ""}${l.db} dB, ${l.fLow} to ${l.fHigh} Hz, flanks ${l.wLow} / ${l.wHigh} oct`;
      case "shape": return `${SHAPES[l.shape]?.label ?? "Shape"} ${l.db > 0 ? "+" : ""}${l.db} dB at ${l.fc} Hz, ${l.width} oct wide`;
      case "points": return `Points (${l.points.length})${l.label ? ` – ${l.label}` : ""}`;
      case "lfTilt": return `LF tilt ${l.dbPerOct} dB/oct`;
      case "hfTilt": return `HF tilt ${l.dbPerOct} dB/oct`;
      case "fullTilt": return `Full tilt ${l.dbPerOct} dB/oct`;
      case "hpf": return `HPF ${l.fc} Hz ${l.type}${l.slope}`;
      case "lpf": return `LPF ${l.fc} Hz ${l.type}${l.slope}`;
      case "subBoost": return `Low shelf ${l.db > 0 ? "+" : ""}${l.db} dB below ${l.fc} Hz ${l.type}${l.slope}`;
      case "hiShelf": return `High shelf ${l.db > 0 ? "+" : ""}${l.db} dB above ${l.fc} Hz ${l.type}${l.slope}`;
      case "bell": return `Bell ${l.db > 0 ? "+" : ""}${l.db} dB at ${l.fc} Hz, Q ${Number(l.q.toPrecision(4))} (${Number(qToBw(l.q).toPrecision(3))} oct)`;
      case "hill": return `Hill ${l.db > 0 ? "+" : ""}${l.db} dB at ${l.fc} Hz, ${l.width} oct wide`;
      case "rHpf": return `Resonant HPF ${l.fc} Hz, Q ${l.q}`;
      case "rLpf": return `Resonant LPF ${l.fc} Hz, Q ${l.q}`;
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
    let addBtn = null;
    const rebuild = (focus) => {
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
        b.addEventListener("click", () => {
          l.points.splice(i, 1);
          rebuild(l.points.length ? { row: Math.min(i, l.points.length - 1), col: 2 } : { add: true });
          update();
        });
        del.append(b);
        tr.append(mk(0, "Hz"), mk(1, "dB"), del);
        tbody.append(tr);
      });
      if (focus?.add) addBtn?.focus();
      else if (focus) tbody.rows[focus.row]?.cells[focus.col].querySelector("input, button")?.focus();
    };
    rebuild();
    const add = document.createElement("button");
    addBtn = add;
    add.type = "button";
    add.textContent = "Add point";
    add.addEventListener("click", () => {
      const last = l.points[l.points.length - 1];
      const prev = l.points.length > 1 ? l.points[l.points.length - 2] : null;
      // New point: halfway (in log frequency) between the last two points, or an octave above the last.
      const hz = last ? (prev ? Math.sqrt(prev[0] * last[0]) : Math.min(last[0] * 2, 20000)) : 1000;
      let newHz = Math.round(hz * 100) / 100;
      while (l.points.some((q) => q[0] === newHz)) newHz = Math.round(newHz * 0.97 * 100) / 100; // keep frequencies unique
      l.points.push([newHz, last ? last[1] : 0]);
      l.points.sort((x, y) => x[0] - y[0]);
      rebuild({ row: l.points.findIndex((q) => q[0] === newHz), col: 0 });
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
      case "bell": {
        // Width can be entered as Q or as bandwidth in octaves between the half-gain points; the layer stores Q.
        const asBw = qMode === "bw";
        const width = asBw
          ? numField("Bandwidth (octaves, 0.03 notch to 6.7 wide)", Number(qToBw(l.q).toPrecision(4)), (n) => { l.q = Number(bwToQ(n).toPrecision(6)); }, { check: (n) => n > 0 })
          : numField("Q (0.1 wide to 50 notch)", l.q, set("q"));
        body.append(numField("Gain (± dB, up to 60)", l.db, set("db")), numField("Centre frequency (Hz)", l.fc, set("fc")),
          selectField("Enter width as", [["q", "Q"], ["bw", "Bandwidth (octaves)"]], qMode, (v) => {
            qMode = v;
            try { localStorage.setItem("tcb-qmode", v); } catch { /* storage unavailable */ }
            renderLayers([l.id, "toggle"]);
          }), width);
        break;
      }
      case "hill":
        body.append(numField("Height (± dB, up to 60)", l.db, set("db")), numField("Centre frequency (Hz)", l.fc, set("fc")),
          numField("Width at half height (octaves)", l.width, set("width")));
        break;
      case "rHpf":
      case "rLpf":
        body.append(numField("Corner frequency (Hz)", l.fc, set("fc")), numField("Q (0.707 flat, higher peaks)", l.q, set("q")));
        break;
      case "mesa":
        body.append(
          numField("Gain (± dB, up to 60)", l.db, set("db")),
          numField("Lower edge, half-gain point (Hz)", l.fLow, set("fLow")),
          numField("Upper edge, half-gain point (Hz)", l.fHigh, set("fHigh")),
          numField("Lower flank width (octaves)", l.wLow, set("wLow"), { check: (n) => n > 0 }),
          numField("Upper flank width (octaves)", l.wHigh, set("wHigh"), { check: (n) => n > 0 }),
        );
        {
          const note = document.createElement("p");
          note.className = "note";
          note.textContent = "A narrower flank is a steeper slope. Mesa-style: two raised-cosine shelf steps, each with its own slope.";
          body.append(note);
        }
        break;
      case "shape":
        body.append(
          selectField("Shape", Object.entries(SHAPES).map(([id, sh]) => [id, sh.label]), l.shape, (v) => { l.shape = v; update(); renderLayers([l.id, "toggle"]); }),
          numField("Height (± dB, up to 60)", l.db, set("db")),
          numField("Centre frequency (Hz)", l.fc, set("fc")),
          numField("Width at the base (octaves)", l.width, set("width")),
        );
        if (l.shape === "trapezoid") body.append(numField("Flat top (0 = pyramid, up to 0.99)", l.flat ?? 0.5, set("flat")));
        if (SHAPES[l.shape]?.countLabel) body.append(numField(`${SHAPES[l.shape].countLabel} (${l.shape === "stairs" ? "2 to 16" : "0.5 to 16"})`, l.count ?? 3, set("count")));
        break;
      case "weighting":
        body.append(selectField("Curve", Object.entries(WEIGHTINGS).map(([id, w]) => [id, w.label]), l.curve, (v) => { l.curve = v; update(); renderLayers([l.id, "toggle"]); }));
        break;
      default: {
        if (l.kind === "subBoost" || l.kind === "hiShelf") body.append(numField("Boost (± dB)", l.db, set("db")));
        body.append(numField(l.kind === "subBoost" ? "Low-pass corner (Hz)" : l.kind === "hiShelf" ? "High-pass corner (Hz)" : "Corner frequency (Hz)", l.fc, set("fc")));
        const slopeHost = document.createElement("div");
        const fillSlope = () => {
          slopeHost.replaceChildren(selectField("Slope (dB/oct)",
            FILTERS[l.type].allowedSlopes.map((s) => [s, String(s)]), l.slope, (v) => { l.slope = Number(v); update(); }));
        };
        const shelf = l.kind === "subBoost" || l.kind === "hiShelf";
        body.append(selectField("Type", Object.values(FILTERS).filter((f) => !(shelf && f.shelfSafe === false)).map((f) => [f.id, f.label]), l.type, (v) => {
          l.type = v;
          if (!FILTERS[v].allowedSlopes.includes(l.slope)) l.slope = FILTERS[v].allowedSlopes.at(-1);
          fillSlope();
          update();
        }), slopeHost);
        fillSlope();
      }
    }
    // Any layer can be flipped upside down (its dB values change sign).
    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "wide";
    flip.setAttribute("aria-pressed", String(l.invert === true));
    flip.textContent = l.invert === true ? "Inverted: press to restore" : "Invert (flip up/down)";
    flip.addEventListener("click", () => {
      if (l.invert === true) delete l.invert; else l.invert = true;
      flip.setAttribute("aria-pressed", String(l.invert === true));
      flip.textContent = l.invert === true ? "Inverted: press to restore" : "Invert (flip up/down)";
      update();
    });
    body.append(flip);
    return body;
  }

  /** Rebuild the layer list, then put keyboard focus back on `focus` = [layerId, action]. */
  /** Is this layer hidden because its group is hidden? */
  const hiddenByGroup = (l) => !visibleLayers(doc).includes(l);
  const groupName = (n) => doc.groups?.[n - 1]?.name ?? "";

  /** Which group's tab is open, 1 to 3 (a view setting, not saved). */
  let activeTab = 1;
  const tabOf = (l) => (Number.isInteger(l.group) && l.group >= 1 && l.group <= 3 ? l.group : 1);
  const tabName = (n) => doc.groups?.[n - 1]?.name ?? `Group ${n}`;

  function renderLayers(focus) {
    const ul = $("layers");
    ul.replaceChildren();
    const mine = doc.layers.filter((l) => tabOf(l) === activeTab);
    if (!mine.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No layers in ${tabName(activeTab)} yet. Use Add layer below.`;
      ul.append(li);
    }
    mine.forEach((l, pos) => {
      const i = doc.layers.indexOf(l); // position in the whole list: used for the ghost colour
      const li = document.createElement("li");
      li.className = `layer${l.on ? "" : " off"}${hiddenByGroup(l) ? " grouphidden" : ""}`;
      li.dataset.id = l.id;
      stripe(li, l, i);
      const head = document.createElement("div");
      head.className = "layer-head";
      const on = document.createElement("input");
      on.type = "checkbox";
      on.checked = l.on;
      const label = `${layerTitle(l)}, layer ${pos + 1} of ${mine.length}`;
      on.dataset.action = "on";
      on.setAttribute("aria-label", label);
      on.addEventListener("change", () => { l.on = on.checked; li.classList.toggle("off", !l.on); stripe(li, l, i); update(); });
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
      // moving swaps places with the neighbour in the same tab, so the order inside a tab is what you see
      const move = (d, action) => () => {
        const j = doc.layers.indexOf(mine[pos + d]);
        [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
        renderLayers([l.id, action]);
        update();
      };
      const remove = () => {
        const next = mine[pos + 1] ?? mine[pos - 1];
        doc.layers.splice(i, 1);
        expanded.delete(l.id);
        renderLayers(next ? [next.id, "toggle"] : ["", "add"]);
        update();
      };
      head.append(on, title,
        icon("↑", "up", "Move up", move(-1, "up"), pos === 0),
        icon("↓", "down", "Move down", move(1, "down"), pos === mine.length - 1),
        icon("✕", "del", "Delete", remove));
      li.append(head);
      if (expanded.has(l.id)) li.append(layerBody(l));
      ul.append(li);
    });
    refreshTitles();
    renderTabs();
    if (focus) {
      const target = focus[1] === "add" ? $("add-kind")
        : document.querySelector(`#layers li[data-id="${focus[0]}"] [data-action="${focus[1]}"]:not(:disabled)`)
          ?? document.querySelector(`#layers li[data-id="${focus[0]}"] .title`);
      target?.focus();
    }
  }

  // ---- layer tabs: three named groups with independent show/hide (SPEC 4.8)
  function selectTab(n, { focusTab = false } = {}) {
    activeTab = n;
    renderGroups();
    renderLayers();
    if (focusTab) $(`tab-${n}`)?.focus();
  }

  /** An eye (open when the group is shown, crossed out when hidden) as an SVG, built without innerHTML. */
  function eyeIcon(open) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    const add = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.append(e);
    };
    const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
    add("path", { ...stroke, d: "M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" });
    add("circle", { ...stroke, cx: "12", cy: "12", r: "3" });
    if (!open) add("path", { ...stroke, d: "M3 3l18 18" });
    return svg;
  }

  /** The tab strip. Built once, then updated in place so a focused tab keeps focus. */
  function renderTabs() {
    const host = $("layer-tabs");
    if (host.children.length !== 3) {
      host.replaceChildren();
      for (let n = 1; n <= 3; n++) {
        const b = document.createElement("button");
        b.type = "button";
        b.id = `tab-${n}`;
        b.className = "tab";
        b.append(Object.assign(document.createElement("span"), { className: "tab-name" }), Object.assign(document.createElement("span"), { className: "tab-count" }));
        b.addEventListener("click", () => selectTab(n));
        b.addEventListener("keydown", (ev) => {
          const keys = { ArrowRight: (activeTab % 3) + 1, ArrowLeft: ((activeTab + 1) % 3) + 1, Home: 1, End: 3 };
          if (!(ev.key in keys)) return;
          ev.preventDefault();
          selectTab(keys[ev.key], { focusTab: true });
        });
        // the eye shows or hides every layer in this group, right beside its tab (not inside it: a button can't hold a button)
        const eye = document.createElement("button");
        eye.type = "button";
        eye.id = `eye-${n}`;
        eye.className = "eye";
        eye.addEventListener("click", () => {
          const g = doc.groups[n - 1];
          g.on = g.on === false;
          renderGroupHead();
          renderLayers();
          update();
        });
        const item = document.createElement("div");
        item.className = "tabitem";
        item.append(b, eye);
        host.append(item);
      }
    }
    for (let n = 1; n <= 3; n++) {
      const b = $(`tab-${n}`);
      const count = doc.layers.filter((l) => tabOf(l) === n).length;
      const hidden = doc.groups?.[n - 1]?.on === false;
      b.querySelector(".tab-name").textContent = tabName(n);
      b.querySelector(".tab-count").textContent = String(count);
      b.classList.toggle("hiddengroup", hidden);
      const eye = $(`eye-${n}`);
      eye.replaceChildren(eyeIcon(!hidden));
      eye.setAttribute("aria-pressed", String(!hidden));
      eye.setAttribute("aria-label", `Show layers in ${tabName(n)}`);
      eye.title = hidden ? "Show this group" : "Hide this group";
      if (n === activeTab) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      b.tabIndex = n === activeTab ? 0 : -1;
      b.setAttribute("aria-label", `${tabName(n)}, ${count} layer${count === 1 ? "" : "s"}${hidden ? ", hidden" : ""}`);
    }
    $("tab-panel").setAttribute("aria-labelledby", `tab-${activeTab}`);
    $("btn-add").setAttribute("aria-label", `Add layer to ${tabName(activeTab)}`);
  }

  /** The group's name box and Show layers toggle, at the top of its tab. */
  function renderGroupHead() {
    const host = $("group-head");
    host.replaceChildren();
    const n = activeTab - 1;
    const g = doc.groups[n];
    const name = document.createElement("input");
    name.type = "text";
    name.value = g.name;
    name.maxLength = 24;
    name.setAttribute("aria-label", `Name of group ${n + 1}`);
    name.addEventListener("input", () => {
      g.name = name.value.trim() ? name.value : "ABC"[n];
      renderTabs();
      refreshTitles();
      update();
    });
    name.addEventListener("change", () => renderLayers());
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(g.on !== false));
    btn.textContent = "Show layers";
    btn.className = "toggle";
    btn.addEventListener("click", () => {
      g.on = g.on === false;
      renderGroupHead();
      renderLayers();
      update();
    });
    host.append(name, btn);
  }

  /** The tab strip and the open tab's group controls. */
  function renderGroups() {
    renderTabs();
    renderGroupHead();
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
    $("g-eps").value = String(doc.grid.epsilon ?? 0.1);
    $("trim-low").value = doc.grid.trimLow === undefined ? "" : String(doc.grid.trimLow);
    $("trim-high").value = doc.grid.trimHigh === undefined ? "" : String(doc.grid.trimHigh);
    $("n-on").checked = doc.normalise.on;
    $("n-at").value = String(doc.normalise.at);
    renderGridModes();
  }

  const GRID_CHOICES = [["3", "1/3 octave"], ["1", "1/1 octave"], ["6", "1/6 octave"], ["12", "1/12 octave"], ["24", "1/24 octave"], ["original", "Keep original"], ["simplified", "Breakpoints only"]];
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
      r.checked = value === "original" || value === "simplified"
        ? doc.grid.mode === value
        : doc.grid.mode !== "original" && doc.grid.mode !== "simplified" && String(doc.grid.fraction) === value;
      r.addEventListener("change", () => {
        if (value === "original" || value === "simplified") doc.grid.mode = value;
        else { doc.grid.mode = "resample"; doc.grid.fraction = Number(value); }
        update();
      });
      label.append(r, document.createTextNode(text));
      host.append(label);
    }
  }

  // ---- plot zoom (a view setting, kept in this browser only)
  let zoom = null; // null = auto range, otherwise +/- dB from 15 to 40
  try {
    const saved = Number(localStorage.getItem("tcb-zoom"));
    if (saved >= 15 && saved <= 40) zoom = saved;
  } catch { /* storage unavailable */ }
  const applyZoomUi = () => {
    $("zoom-auto").checked = zoom === null;
    $("zoom").disabled = zoom === null;
    if (zoom !== null) $("zoom").value = String(zoom);
    $("zoom-val").textContent = zoom === null ? "Auto" : `±${zoom} dB`;
  };
  const setZoom = (z) => {
    zoom = z;
    try { localStorage.setItem("tcb-zoom", z === null ? "" : String(z)); } catch { /* storage unavailable */ }
    applyZoomUi();
    update();
  };
  $("zoom-auto").addEventListener("change", () => setZoom($("zoom-auto").checked ? null : Number($("zoom").value)));
  $("zoom").addEventListener("input", () => setZoom(Number($("zoom").value)));
  applyZoomUi();

  // ---- plot Y offset: slides the visible dB window by -20 to +20 dB (also a view setting)
  let yOffset = 0;
  try {
    const saved = Number(localStorage.getItem("tcb-yoff"));
    if (Number.isFinite(saved) && Math.abs(saved) <= 20) yOffset = Math.round(saved);
  } catch { /* storage unavailable */ }
  const applyYoffUi = () => {
    $("yoff").value = String(yOffset);
    $("yoff-val").textContent = `${yOffset > 0 ? "+" : yOffset < 0 ? "−" : ""}${Math.abs(yOffset)} dB`;
    $("yoff-reset").disabled = yOffset === 0;
  };
  const setYoff = (v) => {
    yOffset = Math.max(-20, Math.min(20, Math.round(v)));
    try { localStorage.setItem("tcb-yoff", String(yOffset)); } catch { /* storage unavailable */ }
    applyYoffUi();
    update();
  };
  $("yoff").addEventListener("input", () => setYoff(Number($("yoff").value)));
  $("yoff-reset").addEventListener("click", () => setYoff(0));
  applyYoffUi();

  // ---- layer ghosts: each enabled layer's own contribution drawn faintly behind the curve (a view setting)
  let ghostsOn = false;
  try { ghostsOn = localStorage.getItem("tcb-ghosts") === "1"; } catch { /* storage unavailable */ }
  const ghostHue = (index) => (index * 47 + 15) % 360;
  /** Colour stripe on a layer row that matches its ghost line. */
  function stripe(li, l, i) {
    li.classList.toggle("ghosted", ghostsOn && !!l.on && !hiddenByGroup(l));
    li.style.setProperty("--gh", String(ghostHue(i)));
  }
  const applyGhostsUi = () => {
    $("btn-ghosts").setAttribute("aria-pressed", String(ghostsOn));
  };
  $("btn-ghosts").addEventListener("click", () => {
    ghostsOn = !ghostsOn;
    try { localStorage.setItem("tcb-ghosts", ghostsOn ? "1" : "0"); } catch { /* storage unavailable */ }
    applyGhostsUi();
    document.querySelectorAll("#layers li[data-id]").forEach((li) => {
      const l = doc.layers.find((x) => x.id === li.dataset.id);
      if (l) stripe(li, l, doc.layers.indexOf(l));
    });
    update();
  });
  applyGhostsUi();

  // ---- note names and wavelength (343 m/s): shown in the hover readout and as table columns, never exported
  let notesOn = false;
  let waveOn = false;
  try {
    notesOn = localStorage.getItem("tcb-notes") === "1";
    waveOn = localStorage.getItem("tcb-wave") === "1";
  } catch { /* storage unavailable */ }
  const applyPitchUi = () => {
    $("btn-notes").setAttribute("aria-pressed", String(notesOn));
    $("btn-wave").setAttribute("aria-pressed", String(waveOn));
  };
  for (const [id, key, flip] of [["btn-notes", "tcb-notes", () => { notesOn = !notesOn; return notesOn; }], ["btn-wave", "tcb-wave", () => { waveOn = !waveOn; return waveOn; }]]) {
    $(id).addEventListener("click", () => {
      const on = flip();
      try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage unavailable */ }
      applyPitchUi();
      update();
    });
  }
  applyPitchUi();

  // ---- lines only: hide the point markers and drag handles on the plot (a view setting)
  let linesOnly = false;
  try { linesOnly = localStorage.getItem("tcb-lines") === "1"; } catch { /* storage unavailable */ }
  const applyLinesUi = () => {
    $("btn-lines").setAttribute("aria-pressed", String(!linesOnly)); // pressed means the points are shown
  };
  $("btn-lines").addEventListener("click", () => {
    linesOnly = !linesOnly;
    try { localStorage.setItem("tcb-lines", linesOnly ? "1" : "0"); } catch { /* storage unavailable */ }
    applyLinesUi();
    update();
  });
  applyLinesUi();

  let noticeSig = "";
  function renderNotice() {
    const msgs = [...importMessages];
    const isSpectrum = doc.props.format === "smaart-spectrum";
    if (isSpectrum) msgs.push("Spectrum curve: export as Spectrum arrives in a later version. You can view it here, or convert it to a TF curve (normalised to 0 dB at 1 kHz).");
    const sig = JSON.stringify([msgs, isSpectrum]);
    if (sig === noticeSig) return;
    noticeSig = sig;
    const host = $("notice");
    host.replaceChildren();
    host.hidden = msgs.length === 0;
    for (const m of msgs) {
      const p = document.createElement("p");
      p.textContent = m;
      host.append(p);
    }
    if (isSpectrum) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Convert to TF";
      b.addEventListener("click", () => { importMessages = []; doc = convertToTf(doc); refreshAll(); $("p-name").focus(); });
      host.append(b);
    }
  }

  function renderSuggestion() {
    const name = suggestName(doc);
    const b = $("btn-suggest");
    const same = doc.props.name === name;
    b.textContent = same ? "Name matches" : "Use suggestion";
    b.title = same ? `The name already matches the layers: ${name}` : `Suggested name: ${name}`;
    b.setAttribute("aria-label", same ? `The name already matches the layers: ${name}` : `Use the suggested name ${name}`);
    b.disabled = same;
    b.dataset.name = name;
  }

  function update() {
    track();
    renderSuggestion();
    $("eps-field").hidden = doc.grid.mode !== "simplified";
    $("btn-reset-import").hidden = !doc.original;
    refreshTitles();
    renderNotice();
    undoUi();
    const { points, text, issues } = buildCrv(doc, exportFormat);
    let handles = [];
    const hl = pointsLayer();
    const hint = $("handle-hint");
    if (linesOnly) hint.textContent = "Points are hidden (lines only). Press Show points to drag them.";
    else if (!hl) hint.textContent = "Switch on a Points layer to drag points on the plot.";
    else if (hl.points.length > 200) hint.textContent = "This Points layer has more than 200 points, so drag handles are hidden. Edit values in the layer's table.";
    else hint.textContent = "Drag a point to change its level. Hold Shift to move its frequency too. With a point focused: Up/Down nudge, Left/Right switch point.";
    if (hl && hl.points.length && hl.points.length <= 200) {
      try {
        handles = evaluate(doc, hl.points.map((pt) => pt[0])).map(([f, g], i) => ({ f, g, i }));
      } catch { handles = []; }
    }
    const [rangeLo, rangeHi] = effectiveRange(doc.grid);
    handles = handles.filter((h) => h.f >= rangeLo && h.f <= rangeHi); // handles outside the trimmed range stay hidden
    plot.render({
      // The axis always shows the full 20 Hz to 20 kHz; only the curve is cropped by the trim.
      handles, wide: doc.props.format === "smaart-spectrum", yRange: doc.props.format === "smaart-spectrum" ? null : zoom, yOffset, hidePoints: linesOnly,
      extra: notesOn || waveOn ? (f) => [notesOn ? noteLabel(f) : "", waveOn ? wavelengthLabel(f) : ""].filter(Boolean).join("  ") : null,
      ghosts: ghostsOn ? layerGhosts(doc).map((g) => ({ points: g.points, hue: ghostHue(g.index), title: layerTitle(doc.layers[g.index]) })) : [],
      points, original: doc.original, color: doc.props.color, line: Number(doc.props.line) || 2,
      tolerance: Number(doc.props.tolerance) || 0, useTolerance: !!doc.props.useTolerance, show: !!doc.props.show,
      description: points.length
        ? `Target curve ${doc.props.name}, ${points.length} points from ${fmt6(points[0][0])} Hz to ${fmt6(points.at(-1)[0])} Hz. The same values are in the table below.`
        : "No curve to show.",
    });
    $("h-table").textContent = `Exported points (${points.length})`;
    const tbody = $("points-table").tBodies[0];
    const rows = document.createDocumentFragment();
    // Optional extra columns (display only): the nearest note and the wavelength.
    const head = $("points-table").tHead.rows[0];
    head.replaceChildren();
    for (const t of ["Hz", "dB", ...(notesOn ? ["Note"] : []), ...(waveOn ? ["Wavelength"] : [])]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = t;
      head.append(th);
    }
    for (const [f, g] of points) {
      const tr = document.createElement("tr");
      for (const v of [fmt6(f), fmt6(g), ...(notesOn ? [noteLabel(f)] : []), ...(waveOn ? [wavelengthLabel(f)] : [])]) {
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

  function undoUi() {
    $("btn-undo").disabled = !undoStack.length;
    $("btn-redo").disabled = !redoStack.length;
  }

  // ---- export format (a view setting kept in this browser only)
  let exportFormat = "smaart-tf";
  try {
    const saved = localStorage.getItem("tcb-export");
    if (writableAdapters().some((a) => a.id === saved)) exportFormat = saved;
  } catch { /* storage unavailable */ }
  const sel = $("export-format");
  for (const a of writableAdapters()) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.label;
    sel.append(o);
  }
  sel.value = exportFormat;
  const applyExportUi = () => {
    $("export-note-ascii").hidden = exportFormat !== "smaart-ascii";
    $("export-note-crv").hidden = exportFormat !== "smaart-tf";
  };
  applyExportUi();
  sel.addEventListener("change", () => {
    exportFormat = sel.value;
    try { localStorage.setItem("tcb-export", exportFormat); } catch { /* storage unavailable */ }
    applyExportUi();
    update();
  });

  function download(name, text, type = "application/octet-stream") {
    const blob = new Blob([text], { type });
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
  $("btn-suggest").addEventListener("click", () => {
    doc.props.name = $("btn-suggest").dataset.name;
    $("p-name").value = doc.props.name;
    update();
    $("p-name").focus();
  });
  $("btn-random").addEventListener("click", () => {
    // Pick against the colour the plot is actually drawn on, so it follows Dark, Light and Auto.
    const hex = randomContrastingColour(getComputedStyle($("plot")).backgroundColor);
    $("p-color").value = hex;
    doc.props.color = pickerToSmaart(hex);
    update();
    $("btn-random").focus();
  });
  $("p-color").addEventListener("input", () => { doc.props.color = pickerToSmaart($("p-color").value); update(); });
  $("p-line").addEventListener("change", () => { doc.props.line = Number($("p-line").value); update(); });
  $("p-show").addEventListener("change", () => { doc.props.show = $("p-show").checked ? 1 : 0; update(); });
  $("p-usetol").addEventListener("change", () => { doc.props.useTolerance = $("p-usetol").checked ? 1 : 0; update(); });
  bindNum("p-tol", (n) => { doc.props.tolerance = n; });
  bindNum("p-offset", (n) => { doc.props.offset = n; }, { optional: true });
  bindNum("n-at", (n) => { doc.normalise.at = n; });
  bindNum("g-eps", (n) => { doc.grid.epsilon = n; });
  bindNum("trim-low", (n) => { if (n === null) delete doc.grid.trimLow; else doc.grid.trimLow = n; }, { optional: true });
  bindNum("trim-high", (n) => { if (n === null) delete doc.grid.trimHigh; else doc.grid.trimHigh = n; }, { optional: true });
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
    l.group = activeTab; // a layer added in a group's tab belongs to that group
    doc.layers.push(l);
    expanded.add(l.id);
    renderLayers([l.id, "toggle"]);
    update();
  });

  // ---- top bar
  $("btn-new").addEventListener("click", () => {
    importMessages = [];
    setDoc(newDoc());
  });
  $("btn-reset-import").addEventListener("click", () => {
    const fresh = resetToImport(doc);
    if (!fresh) return;
    importMessages = ["Reset to the imported curve. Press Undo to get your edits back."];
    noticeSig = "";
    setDoc(fresh);
  });
  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || dlg.open) return;
    const el = document.activeElement;
    if (el && el.tagName === "INPUT" && el.type === "text") return; // let the text box undo its own typing
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
    else if ((key === "z" && ev.shiftKey) || key === "y") { ev.preventDefault(); redo(); }
  });

  // ---- import
  async function importFile(file, extra = []) {
    if (!file) return;
    if (file.size > 2_000_000) { importMessages = ["That file is too large to be a target curve."]; noticeSig = ""; renderNotice(); return; }
    try {
      if (/\.json$/i.test(file.name)) {
        importMessages = extra;
        setDoc(presets.presetFromJson(await file.text()));
        return;
      }
      const text = await file.text();
      const { doc: imported, warnings } = docFromImport(text, file.name); // also checks the file is usable
      if (isBlank(doc)) {
        importMessages = [...extra, ...warnings];
        setDoc(imported);
      } else {
        // a curve is already open: ask whether the file replaces it or is added as a layer
        pendingImport = { text, name: file.name, extra, imported, warnings };
        $("imp-name").textContent = file.name;
        impDlg.showModal();
      }
    } catch (e) {
      importMessages = [`Couldn't import ${file.name}: ${e.message}`];
      noticeSig = "";
      renderNotice();
    }
  }
  let pendingImport = null;
  const impDlg = $("dlg-import");
  $("imp-replace").addEventListener("click", () => {
    const p = pendingImport;
    impDlg.close();
    if (!p) return;
    importMessages = [...p.extra, ...p.warnings];
    setDoc(p.imported);
  });
  $("imp-add").addEventListener("click", () => {
    const p = pendingImport;
    impDlg.close();
    if (!p) return;
    try {
      const r = addImportedLayer(doc, p.text, p.name);
      doc = r.doc;
      activeTab = 1;
      expanded.add(r.layerId);
      importMessages = [
        ...p.extra,
        `Added ${p.name} as a new Points layer (${doc.layers.at(-1).points.length} points).${r.shifted ? " It is a spectrum curve, so it was shifted to 0 dB at 1 kHz." : ""}`,
        ...r.warnings,
      ];
      noticeSig = "";
      refreshAll();
    } catch (e) {
      importMessages = [`Couldn't add ${p.name}: ${e.message}`];
      noticeSig = "";
      renderNotice();
    }
  });
  $("imp-cancel").addEventListener("click", () => impDlg.close());
  impDlg.addEventListener("close", () => { pendingImport = null; });
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", () => { importFile($("file-import").files[0]); $("file-import").value = ""; });
  const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  document.addEventListener("dragover", (ev) => { if (hasFiles(ev) && !dlg.open && !impDlg.open) { ev.preventDefault(); document.body.classList.add("dropping"); } });
  document.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget) document.body.classList.remove("dropping"); });
  document.addEventListener("dragend", () => document.body.classList.remove("dropping"));
  document.addEventListener("drop", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    document.body.classList.remove("dropping");
    if (dlg.open || impDlg.open) return;
    const files = ev.dataTransfer.files;
    importFile(files[0], files.length > 1 ? ["Several files were dropped: only the first was opened."] : []);
  });

  // ---- presets dialog
  const dlg = $("dlg-presets");
  function renderPresets(status = "", draftName = doc.props.name) {
    const body = $("presets-body");
    body.replaceChildren();
    const h = (text) => { const e = document.createElement("h3"); e.textContent = text; body.append(e); };
    const row = (label, buttons) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = label;
      li.append(span);
      for (const [text, fn, aria] of buttons) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-label", `${aria ?? text}: ${label}`);
        b.addEventListener("click", fn);
        li.append(b);
      }
      return li;
    };
    const load = (d) => { importMessages = []; setDoc(d); dlg.close(); };
    const status_ = (msg, name) => { renderPresets(msg, name); $("presets-status").focus(); };
    h("Built-in");
    const ul1 = document.createElement("ul");
    for (const bp of presets.BUILT_IN_PRESETS) ul1.append(row(bp.name, [["Load", () => load(bp.build())]]));
    body.append(ul1);
    h("Saved in this browser");
    const ul2 = document.createElement("ul");
    const names = presets.listPresets();
    if (!names.length) { const li = document.createElement("li"); li.textContent = "Nothing saved yet."; ul2.append(li); }
    for (const n of names) {
      ul2.append(row(n, [
        ["Load", () => { const d = presets.loadPreset(n); if (d) load(d); else status_("That preset couldn't be read."); }],
        ["Delete", () => { if (window.confirm(`Delete the saved preset "${n}"?`)) { presets.deletePreset(n); status_(`Deleted "${n}".`); } }],
      ]));
    }
    body.append(ul2);
    h("Save current curve");
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.htmlFor = "preset-name";
    lab.textContent = "Preset name";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "preset-name";
    input.value = draftName;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save in browser";
    save.addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) { status_("Give the preset a name.", input.value); return; }
      if (presets.hasPreset(name) && !window.confirm(`Replace the saved preset "${name}"?`)) return;
      status_(presets.savePreset(name, doc) ? `Saved "${name}".` : "Couldn't save: this browser is blocking storage.", name);
    });
    wrap.append(lab, input);
    body.append(wrap, save);
    h("Files");
    const files = document.createElement("div");
    files.className = "actions";
    const toFile = document.createElement("button");
    toFile.type = "button";
    toFile.textContent = "Save preset as JSON";
    toFile.addEventListener("click", () => download(`${crvFileName(doc.props.name).replace(/\.crv$/, "") || "preset"}.json`, presets.presetToJson(doc), "application/json"));
    const fromFile = document.createElement("button");
    fromFile.type = "button";
    fromFile.textContent = "Load preset JSON";
    fromFile.addEventListener("click", () => $("file-preset").click());
    files.append(toFile, fromFile);
    body.append(files);
    $("presets-status").textContent = status;
  }
  $("btn-presets").addEventListener("click", () => { renderPresets(); dlg.showModal(); });
  $("btn-presets-close").addEventListener("click", () => dlg.close());
  $("file-preset").addEventListener("change", async () => {
    const f = $("file-preset").files[0];
    $("file-preset").value = "";
    if (!f) return;
    if (f.size > 2_000_000) { $("presets-status").textContent = "That file is too large to be a preset."; $("presets-status").focus(); return; }
    try {
      importMessages = [];
      setDoc(presets.presetFromJson(await f.text()));
      dlg.close();
    } catch (e) {
      $("presets-status").textContent = `Couldn't load ${f.name}: ${e.message}`;
      $("presets-status").focus();
    }
  });
  window.addEventListener("pagehide", () => presets.autosave(lastJson));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") presets.autosave(lastJson); });
  $("btn-export").addEventListener("click", () => {
    const { text } = buildCrv(doc, exportFormat);
    const adapter = getAdapter(exportFormat);
    if (text) download(exportFileName(doc.props.name, adapter.ext), text, adapter.mime);
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
  renderGroups();
  renderLayers();
  update();
}

if (typeof document !== "undefined") startApp();
