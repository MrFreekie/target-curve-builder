// Bringing a curve in: the Import button and drag-and-drop (replace or add as a layer), the reference trace, and shared
// links (copy one, open one). Everything it changes goes through the document (app.doc) and update().
import { docFromImport, isBlank, addImportedLayer, totalPoints, MAX_TOTAL_POINTS, newLayer } from "./doc.js";
import * as presets from "./presets.js";
import { parseTrace, traceCurve, TRACE_SMOOTHINGS, TRACE_OFFSET_LIMIT, MAX_TRACE_TEXT } from "./trace.js";
import { encodeShare, decodeShare, LONG_LINK } from "./share.js";
import { createBindNum } from "./parse.js";

/**
 * @param {object} app the context from app.js
 * @param {{getActiveTab: () => number, setActiveTab: (n: number) => void}} layersUi
 */
export function createImportUi(app, layersUi) {
  const { $, update, showNotice, refreshAll, setDoc, expanded } = app;
  const bindNum = createBindNum(app);
  // ---- import
  async function importFile(file, extra = []) {
    if (!file) return;
    if (file.size > 2_000_000) { app.messages = ["That file is too large to be a target curve."]; app.noticeSig = ""; app.renderNotice(); return; }
    try {
      if (/\.json$/i.test(file.name)) {
        app.messages = extra;
        setDoc(presets.presetFromJson(await file.text()));
        return;
      }
      const text = await file.text();
      const { doc: imported, warnings } = docFromImport(text, file.name); // also checks the file is usable
      if (isBlank(app.doc)) {
        app.messages = [...extra, ...warnings];
        setDoc(imported);
      } else {
        // a curve is already open: ask whether the file replaces it or is added as a layer
        pendingImport = { text, name: file.name, extra, imported, warnings };
        $("imp-name").textContent = file.name;
        impDlg.showModal();
      }
    } catch (e) {
      showNotice([`Couldn't import ${file.name}: ${e.message}`]);
    }
  }
  let pendingImport = null;
  const impDlg = $("dlg-import");
  $("imp-replace").addEventListener("click", () => {
    const p = pendingImport;
    impDlg.close();
    if (!p) return;
    app.messages = [...p.extra, ...p.warnings];
    setDoc(p.imported);
  });
  $("imp-add").addEventListener("click", () => {
    const p = pendingImport;
    impDlg.close();
    if (!p) return;
    try {
      const r = addImportedLayer(app.doc, p.text, p.name);
      app.doc = r.doc;
      layersUi.setActiveTab(1);
      expanded.add(r.layerId);
      app.messages = [
        ...p.extra,
        `Added ${p.name} as a new Points layer (${app.doc.layers.at(-1).points.length} points).${r.shifted ? " It is a spectrum curve, so it was shifted to 0 dB at 1 kHz." : ""}`,
        ...r.warnings,
      ];
      app.noticeSig = "";
      refreshAll();
    } catch (e) {
      showNotice([`Couldn't add ${p.name}: ${e.message}`]);
    }
  });
  $("imp-cancel").addEventListener("click", () => impDlg.close());
  impDlg.addEventListener("close", () => { pendingImport = null; });
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", () => { importFile($("file-import").files[0]); $("file-import").value = ""; });
  const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  document.addEventListener("dragover", (ev) => { if (hasFiles(ev) && !app.presetsOpen() && !impDlg.open) { ev.preventDefault(); document.body.classList.add("dropping"); } });
  document.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget) document.body.classList.remove("dropping"); });
  document.addEventListener("dragend", () => document.body.classList.remove("dropping"));
  document.addEventListener("drop", (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    document.body.classList.remove("dropping");
    if (app.presetsOpen() || impDlg.open) return;
    const files = ev.dataTransfer.files;
    importFile(files[0], files.length > 1 ? ["Several files were dropped: only the first was opened."] : []);
  });

  // ---- reference trace (SPEC §10): a curve drawn behind the target, never exported
  for (const n of TRACE_SMOOTHINGS) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = n === 0 ? "Off" : `1/${n} octave`;
    $("tr-smooth").append(o);
  }
  /** Copy the trace settings into the controls, unless a control is being typed in. */
  function syncTraceUi() {
    const t = app.doc.template;
    $("trace-ctl").hidden = !t;
    $("btn-trace").textContent = t ? "Replace trace…" : "Import trace…";
    if (!t) return;
    $("trace-info").textContent = `${t.name || "Trace"}: ${t.points.length} points, ${t.points[0][0]} Hz to ${t.points.at(-1)[0]} Hz.`;
    $("tr-show").checked = t.show;
    $("tr-norm").checked = t.normalise;
    $("tr-smooth").value = String(t.smooth);
    if (document.activeElement !== $("tr-offset")) $("tr-offset").value = String(t.offset);
  }
  $("btn-trace").addEventListener("click", () => $("file-trace").click());
  $("file-trace").addEventListener("change", async () => {
    const file = $("file-trace").files[0];
    $("file-trace").value = "";
    if (!file) return;
    try {
      if (file.size > MAX_TRACE_TEXT) throw new Error("That file is too large to be a trace.");
      const r = parseTrace(await file.text());
      app.doc.template = { name: file.name.replace(/\.[^.]*$/, "").slice(0, 100), points: r.points, offset: 0, smooth: 0, normalise: false, show: true };
      app.messages = [`Trace ${file.name}: ${r.points.length} points read.`, ...r.warnings];
    } catch (e) {
      app.messages = [`Couldn't read ${file.name} as a trace: ${e.message}`];
    }
    app.noticeSig = "";
    update();
  });
  $("tr-show").addEventListener("change", () => { if (app.doc.template) { app.doc.template.show = $("tr-show").checked; update(); } });
  $("tr-norm").addEventListener("change", () => { if (app.doc.template) { app.doc.template.normalise = $("tr-norm").checked; update(); } });
  $("tr-smooth").addEventListener("change", () => { if (app.doc.template) { app.doc.template.smooth = Number($("tr-smooth").value); update(); } });
  bindNum("tr-offset", (n) => { if (app.doc.template) app.doc.template.offset = n; }, () => app.doc.template?.offset ?? 0, { check: (v) => Math.abs(v) <= TRACE_OFFSET_LIMIT });
  $("tr-remove").addEventListener("click", () => { delete app.doc.template; update(); $("btn-trace").focus(); });
  $("tr-layer").addEventListener("click", () => {
    if (!app.doc.template) return;
    if (totalPoints(app.doc) + app.doc.template.points.length > MAX_TOTAL_POINTS) { showNotice([`Adding the trace would take the curve past ${MAX_TOTAL_POINTS} points in total. Delete a Points layer first.`]); return; }
    const l = newLayer("points");
    l.points = traceCurve(app.doc.template);
    l.label = app.doc.template.name || "Trace";
    l.group = layersUi.getActiveTab();
    app.doc.layers.push(l);
    expanded.add(l.id);
    app.messages = [`Added the trace as a Points layer (${l.points.length} points), with its offset and smoothing applied.`];
    app.noticeSig = "";
    refreshAll();
  });

  // ---- shareable link (SPEC §11)
  $("btn-share").addEventListener("click", async () => {
    const note = $("share-note");
    try {
      const url = `${location.origin}${location.pathname}#d=${await encodeShare(app.doc)}`;
      try {
        await navigator.clipboard.writeText(url);
        note.textContent = `Link copied (${url.length} characters).`;
      } catch {
        // no clipboard permission: put the link in the address bar so it can be copied from there
        history.replaceState(null, "", `#d=${url.split("#d=")[1]}`);
        note.textContent = "Couldn't use the clipboard, so the link is now in the address bar: copy it from there.";
      }
      if (url.length > LONG_LINK) note.textContent += " It is long, and some chat and mail apps may cut it off.";
    } catch (e) {
      note.textContent = `Couldn't make a link: ${e.message}`;
    }
  });
  // A link opened from elsewhere (or pasted into this tab) loads its curve, then clears the address so a reload keeps
  // your own edits. If you already have a curve open it asks first.
  const linkDlg = $("dlg-link");
  let pendingLink = null;
  async function openLink() {
    const m = /^#d=(.+)$/.exec(location.hash);
    if (!m) return;
    const hash = location.hash;
    let shared;
    try {
      shared = await decodeShare(m[1]);
    } catch (e) {
      if (location.hash === hash) history.replaceState(null, "", location.pathname + location.search);
      showNotice([`Couldn't open that link: ${e.message}`]);
      return;
    }
    if (location.hash === hash) history.replaceState(null, "", location.pathname + location.search);
    if (app.dragging) return; // a point is being dragged: never swap the document under it
    if (isBlank(app.doc) && !app.doc.template) {
      app.messages = ["Opened a shared curve from a link."];
      app.noticeSig = "";
      setDoc(shared);
    } else {
      pendingLink = shared;
      if (!linkDlg.open) linkDlg.showModal();
    }
  }
  $("link-open").addEventListener("click", () => {
    const shared = pendingLink;
    linkDlg.close();
    if (!shared) return;
    app.messages = ["Opened a shared curve from a link. Press Undo to get your curve back."];
    app.noticeSig = "";
    setDoc(shared);
  });
  $("link-keep").addEventListener("click", () => linkDlg.close());
  linkDlg.addEventListener("close", () => { pendingLink = null; });
  window.addEventListener("hashchange", openLink);
  openLink();

  return { syncTraceUi };
}
