// UI state and wiring. Maths lives in curve.js / layers.js; file formats in formats/.
import { evaluate, effectiveRange, layerGhosts, visibleLayers } from "./curve.js";
import { buildCrv } from "./build.js";

import { getAdapter, writableAdapters } from "./formats/index.js";
import { fmt6, pickerToSmaart, smaartToPicker, exportFileName } from "./formats/smaart.js";
import { createPlot } from "./plot.js";
import { newDoc, newLayer, convertToTf, resetToImport } from "./doc.js";

import * as presets from "./presets.js";
import { suggestName } from "./naming.js";
import { randomContrastingColour } from "./colour.js";

import { wavelengthLabel } from "./pitch.js";
import { traceCurve } from "./trace.js";

import { createHistory } from "./history.js";
import { getPref, setPref } from "./prefs.js";
import { parseNum, createBindNum } from "./parse.js";
import { createLayersUi } from "./layers-ui.js";
import { createImportUi } from "./import-ui.js";
import { createPresetsUi } from "./presets-ui.js";

export { newDoc, newLayer };

/** The two trims: box id, grid key and the default shown when the trim is off. */
const TRIMS = [["trim-low", "trimLow", 20], ["trim-high", "trimHigh", 20000]];

// ------------------------------------------------------------------ DOM wiring
function startApp() {
  const $ = (id) => document.getElementById(id);
  // "?fresh" in the address starts a new curve and forgets the autosave: the way out if a saved curve can't be opened.
  const startFresh = /[?&]fresh(?:[=&]|$)/.test(location.search);
  if (startFresh) { presets.clearAutosave(); history.replaceState(null, "", location.pathname + location.hash); }
  let doc = (startFresh ? null : presets.loadAutosave()) ?? newDoc();
  const lostAutosave = startFresh ? null : presets.lastAutosaveProblem();
  let importMessages = startFresh ? ["Started a new curve: the autosaved one was ignored."]
    : lostAutosave ? [`The autosaved curve couldn't be restored (${lostAutosave}), so a new curve was started.`] : [];
  let shownMessages = ""; // the messages the notice already showed, so the next edit can clear them
  const expanded = new Set();
  const plot = createPlot($("plot"), { onDragStart: dragStart, onDrag: dragMove, onDragEnd: dragEnd, onNudge: nudge });

  // ---- undo / redo / autosave
  const edits = createHistory({ start: JSON.stringify(doc), max: 100, coalesceMs: 800 });
  let dragging = false;
  let saveTimer = null;
  /** A stable name for "the control being edited", or null if edits shouldn't be merged. */
  function coalesceKey(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.handle !== undefined) return `handle${el.dataset.handle}`;
    if (el.tagName === "INPUT" && ["text", "color", "range"].includes(el.type)) return el.id || el;
    return null;
  }

  /** Record the document in the undo history if it changed since the last call. */
  function track() {
    if (dragging) return;
    const json = JSON.stringify(doc);
    if (json === edits.current()) return;
    if (importMessages.length && JSON.stringify(importMessages) === shownMessages) { importMessages = []; noticeSig = ""; } // seen already: the edit moves on
    // Rapid edits of one control (typing, a colour or slider drag, arrow-key nudges) share one undo step.
    edits.record(json, coalesceKey(document.activeElement), Date.now());
    scheduleSave();
  }

  let autosaveWarned = false;
  function saveNow() {
    if (presets.autosave(edits.current()) || autosaveWarned) return;
    autosaveWarned = true;
    importMessages.push(`Autosave isn't working (${presets.storageProblemText()}), so your work won't be restored after a reload. Use Presets > Save preset as JSON to keep it.`);
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
    importMessages = []; // a message such as "Press Undo to get your edits back" is spent once Undo or Redo is used
    noticeSig = "";
    refreshAll(focus);
    scheduleSave();
  }

  function undo() {
    if (dragging) return;
    const json = edits.undo();
    if (json !== null) restore(json);
  }

  function redo() {
    if (dragging) return;
    const json = edits.redo();
    if (json !== null) restore(json);
  }

  function refreshAll(focus) {
    renderProps();
    layersUi.renderGroups();
    layersUi.renderLayers(focus);
    update();
  }

  // ---- drag handles on the plot (edit the first points layer that is on)
  let dragBase = null;
  const pointsLayer = () => visibleLayers(doc).find((l) => l.kind === "points" && l.on);
  function dragStart(i) {
    const l = pointsLayer();
    if (!l || !l.points[i]) return;
    dragging = true;
    dragBase = { db: l.points[i][1], hz: l.points[i][0] };
  }
  function dragMove(i, dDb, hz) {
    const l = pointsLayer();
    if (!dragging || !l || !l.points[i]) return;
    // On an inverted layer the plotted curve moves the opposite way to the stored value.
    l.points[i][1] = Math.round((dragBase.db + (l.invert === true ? -dDb : dDb)) * 100) / 100;
    l.points[i][0] = hz !== null ? hz : dragBase.hz; // without Shift the frequency stays exactly as it was typed
    if (expanded.has(l.id)) layersUi.renderLayers();
    update();
  }
  function dragEnd() {
    dragging = false;
    const l = pointsLayer();
    if (l) l.points.sort((a, b) => a[0] - b[0]);
    layersUi.renderLayers();
    update();
  }
  function nudge(i, d) {
    const l = pointsLayer();
    if (!l || !l.points[i]) return;
    l.points[i][1] = Math.round((l.points[i][1] + (l.invert === true ? -d : d)) * 100) / 100;
    if (expanded.has(l.id)) layersUi.renderLayers();
    update();
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
    // An unticked trim box still shows the default range ends (20 Hz and 20 kHz), or what was last typed in it.
    for (const [id, key, def] of TRIMS) {
      $(`${id}-on`).checked = doc.grid[key] !== undefined;
      if (doc.grid[key] !== undefined) $(id).value = String(doc.grid[key]);
      else if (!Number.isFinite(parseNum($(id).value))) $(id).value = String(def);
    }
    $("n-on").checked = doc.normalise.on;
    $("n-at").value = String(doc.normalise.at);
    renderGridModes();
  }

  const GRID_CHOICES = [["3", "1/3 octave"], ["1", "1/1 octave"], ["6", "1/6 octave"], ["12", "1/12 octave"], ["24", "1/24 octave"], ["48", "1/48 octave"], ["original", "Keep original"]];
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

  // ---- plot zoom (a view setting, kept in this browser only)
  let zoom = null; // null = auto range, otherwise +/- dB from 15 to 40
  {
    const saved = Number(getPref("tcb-zoom"));
    if (saved >= 15 && saved <= 40) zoom = saved;
  }
  const applyZoomUi = () => {
    $("zoom-auto").checked = zoom === null;
    $("zoom").disabled = zoom === null;
    if (zoom !== null) $("zoom").value = String(zoom);
    $("zoom-val").textContent = zoom === null ? "Auto" : `±${zoom} dB`;
  };
  const setZoom = (z) => {
    zoom = z;
    setPref("tcb-zoom", z === null ? "" : String(z));
    applyZoomUi();
    update();
  };
  $("zoom-auto").addEventListener("change", () => setZoom($("zoom-auto").checked ? null : Number($("zoom").value)));
  $("zoom").addEventListener("input", () => setZoom(Number($("zoom").value)));
  applyZoomUi();

  // ---- plot Y offset: slides the visible dB window by -20 to +20 dB (also a view setting)
  let yOffset = 0;
  {
    const saved = Number(getPref("tcb-yoff"));
    if (Number.isFinite(saved) && Math.abs(saved) <= 20) yOffset = Math.round(saved);
  }
  const applyYoffUi = () => {
    $("yoff").value = String(yOffset);
    $("yoff-val").textContent = `${yOffset > 0 ? "+" : yOffset < 0 ? "−" : ""}${Math.abs(yOffset)} dB`;
    $("yoff-reset").disabled = yOffset === 0;
  };
  const setYoff = (v) => {
    yOffset = Math.max(-20, Math.min(20, Math.round(v)));
    setPref("tcb-yoff", String(yOffset));
    applyYoffUi();
    update();
  };
  $("yoff").addEventListener("input", () => setYoff(Number($("yoff").value)));
  $("yoff-reset").addEventListener("click", () => setYoff(0));
  applyYoffUi();

  // ---- lines only: hide the point markers and drag handles on the plot (a view setting)
  let linesOnly = false;
  linesOnly = getPref("tcb-lines") === "1";
  $("hide-points").checked = linesOnly;
  $("hide-points").addEventListener("change", () => {
    linesOnly = $("hide-points").checked;
    setPref("tcb-lines", linesOnly ? "1" : "0");
    update();
  });
  $("g-simplify").addEventListener("change", () => {
    if ($("g-simplify").checked) {
      doc.grid.simplify = true;
      if (doc.grid.epsilon === undefined) doc.grid.epsilon = 0.02; // a finer start than the 0.1 dB fallback, so a fine grid shows its detail
      $("g-eps").value = String(doc.grid.epsilon);
    } else delete doc.grid.simplify;
    update();
  });

  let noticeSig = "";
  /** Show these messages in the notice area (replacing any that are there). */
  function showNotice(messages) {
    importMessages = messages;
    noticeSig = "";
    renderNotice();
  }

  function renderNotice() {
    const msgs = [...importMessages];
    const isSpectrum = doc.props.format === "smaart-spectrum";
    if (isSpectrum) msgs.push("Spectrum curve: export as Spectrum arrives in a later version. You can view it here, or convert it to a TF curve (normalised to 0 dB at 1 kHz).");
    const sig = JSON.stringify([msgs, isSpectrum]);
    if (sig === noticeSig) return;
    noticeSig = sig;
    shownMessages = JSON.stringify(importMessages);
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
    $("eps-field").hidden = doc.grid.simplify !== true;
    $("g-simplify").checked = doc.grid.simplify === true;
    $("btn-reset-import").hidden = !doc.original;
    importUi.syncTraceUi();
    layersUi.refreshTitles();
    renderNotice();
    undoUi();
    const { points, ok, issues } = buildCrv(doc, exportFormat, { withText: false }); // the text is written only on Export
    let handles = [];
    const hl = pointsLayer();
    const hint = $("handle-hint");
    if (linesOnly) hint.textContent = "Points are hidden (lines only). Untick Hide points to drag them.";
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
      extra: wavelengthLabel, // the hover readout also shows the wavelength at 343 m/s; the points table and the export never do
      ghosts: layersUi.isGhostsOn() ? layerGhosts(doc).map((g) => ({ points: g.points, hue: layersUi.ghostHue(g.index), title: layersUi.layerTitle(doc.layers[g.index]) })) : [],
      points, original: doc.original, template: doc.template && doc.template.show ? traceCurve(doc.template) : null, templateName: doc.template?.name, color: doc.props.color, line: Number(doc.props.line) || 2,
      tolerance: Number(doc.props.tolerance) || 0, useTolerance: !!doc.props.useTolerance, show: !!doc.props.show,
      description: points.length
        ? `Target curve ${doc.props.name}, ${points.length} points from ${fmt6(points[0][0])} Hz to ${fmt6(points.at(-1)[0])} Hz. The same values are in the table below.`
        : "No curve to show.",
    });
    $("h-table").textContent = `Exported points (${points.length})`;
    if (!dragging) { // a drag redraws the table once, when it ends
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
    }
    const list = $("validation");
    list.replaceChildren();
    for (const i of issues) {
      const li = document.createElement("li");
      li.className = i.level;
      li.textContent = i.message;
      list.append(li);
    }
    if (ok) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "Ready to export.";
      list.append(li);
    }
    $("btn-export").disabled = !ok;
  }

  function undoUi() {
    $("btn-undo").disabled = !edits.canUndo();
    $("btn-redo").disabled = !edits.canRedo();
  }

  // ---- export format (a view setting kept in this browser only)
  let exportFormat = "smaart-tf";
  {
    const saved = getPref("tcb-export");
    if (writableAdapters().some((a) => a.id === saved)) exportFormat = saved;
  }
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
    setPref("tcb-export", exportFormat);
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
  const bindNum = createBindNum({ $, update });
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
  bindNum("p-tol", (n) => { doc.props.tolerance = n; }, () => doc.props.tolerance);
  bindNum("p-offset", (n) => { doc.props.offset = n; }, () => doc.props.offset, { optional: true });
  bindNum("n-at", (n) => { doc.normalise.at = n; }, () => doc.normalise.at);
  bindNum("g-eps", (n) => { doc.grid.epsilon = n; }, () => doc.grid.epsilon ?? 0.1);
  // Each trim has a tick box: ticked, the number in the box is the trim; unticked, there is no trim.
  for (const [id, key, def] of TRIMS) {
    bindNum(id, (n) => { doc.grid[key] = n; $(`${id}-on`).checked = true; }, () => doc.grid[key] ?? def); // typing a number switches the trim on
    $(`${id}-on`).addEventListener("change", () => {
      if (!$(`${id}-on`).checked) delete doc.grid[key];
      else {
        const n = parseNum($(id).value);
        doc.grid[key] = Number.isFinite(n) ? n : def;
        if (!Number.isFinite(n)) $(id).value = String(def);
      }
      update();
    });
  }
  $("n-on").addEventListener("change", () => { doc.normalise.on = $("n-on").checked; update(); });

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
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || presetsUi.isOpen()) return;
    const el = document.activeElement;
    if (el && el.tagName === "INPUT" && el.type === "text") return; // let the text box undo its own typing
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
    else if ((key === "z" && ev.shiftKey) || key === "y") { ev.preventDefault(); redo(); }
  });

  $("btn-export").addEventListener("click", () => {
    const { text } = buildCrv(doc, exportFormat);
    const adapter = getAdapter(exportFormat);
    if (text) download(exportFileName(doc.props.name, adapter.ext), text, adapter.mime);
  });
  const THEMES = ["auto", "dark", "light"];
  let theme = "auto";
  theme = THEMES.includes(getPref("tcb-theme")) ? getPref("tcb-theme") : "auto";
  const applyTheme = () => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    $("btn-theme").textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  };
  $("btn-theme").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setPref("tcb-theme", theme);
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

  // ---- the panels that live in their own modules
  const app = {
    $, update, refreshAll, setDoc, showNotice, renderNotice, download, expanded,
    get doc() { return doc; },
    set doc(v) { doc = v; },
    get messages() { return importMessages; },
    set messages(v) { importMessages = v; },
    get noticeSig() { return noticeSig; },
    set noticeSig(v) { noticeSig = v; },
    get dragging() { return dragging; },
    presetsOpen: () => presetsUi.isOpen(),
  };
  const layersUi = createLayersUi(app);
  const presetsUi = createPresetsUi(app);
  const importUi = createImportUi(app, layersUi);

  window.addEventListener("pagehide", () => presets.autosave(edits.current()));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") presets.autosave(edits.current()); });

  try {
    renderProps();
    layersUi.renderGroups();
    layersUi.renderLayers();
    update();
  } catch (e) {
    // an autosaved curve that can't be drawn would fail again on every reload: forget it and start a new curve
    presets.clearAutosave();
    doc = newDoc();
    edits.adopt(JSON.stringify(doc));
    importMessages = [`The autosaved curve couldn't be opened (${e.message}), so a new curve was started. Add ?fresh to the address to skip the autosave if this happens again.`];
    noticeSig = "";
    renderProps();
    layersUi.renderGroups();
    layersUi.renderLayers();
    update();
  }
}

if (typeof document !== "undefined") {
  startApp();
  // Offline use: keep a copy of the app for next time (only where browsers allow it: https or localhost).
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* the app works the same without it */ });
  }
}
