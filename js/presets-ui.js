// The Presets dialog (built-in, saved in this browser, and JSON files) and the About pop-out.
import * as presets from "./presets.js";

/**
 * @param {object} app the context from app.js
 */
export function createPresetsUi(app) {
  const { $, setDoc, download } = app;
  // ---- presets dialog
  const dlg = $("dlg-presets");
  function renderPresets(status = "", draftName = app.doc.props.name) {
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
    const load = (d) => { app.messages = []; setDoc(d); dlg.close(); };
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
      status_(presets.savePreset(name, app.doc) ? `Saved "${name}".` : `Couldn't save: ${presets.storageProblemText()}.`, name);
    });
    wrap.append(lab, input);
    body.append(wrap, save);
    h("Files");
    const files = document.createElement("div");
    files.className = "actions";
    const toFile = document.createElement("button");
    toFile.type = "button";
    toFile.textContent = "Save preset as JSON";
    toFile.addEventListener("click", () => download(`${crvFileName(app.doc.props.name).replace(/\.crv$/, "") || "preset"}.json`, presets.presetToJson(app.doc), "application/json"));
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
  // About: the explanation lives in a pop-out so the editor keeps the whole page
  const aboutDlg = $("dlg-about");
  $("btn-about").addEventListener("click", () => aboutDlg.showModal());
  $("btn-about-close").addEventListener("click", () => aboutDlg.close());
  aboutDlg.addEventListener("click", (ev) => { if (ev.target === aboutDlg) aboutDlg.close(); }); // a click on the backdrop
  $("file-preset").addEventListener("change", async () => {
    const f = $("file-preset").files[0];
    $("file-preset").value = "";
    if (!f) return;
    if (f.size > 2_000_000) { $("presets-status").textContent = "That file is too large to be a preset."; $("presets-status").focus(); return; }
    try {
      app.messages = [];
      setDoc(presets.presetFromJson(await f.text()));
      dlg.close();
    } catch (e) {
      $("presets-status").textContent = `Couldn't load ${f.name}: ${e.message}`;
      $("presets-status").focus();
    }
  });

  return { isOpen: () => dlg.open };
}
