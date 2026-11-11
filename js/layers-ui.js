// The Layers panel: the group tabs and eyes, each layer's row and editor, the points table, the ghost stripes and the
// Add layer control. Owns which tab is open. Everything it changes goes through the document (app.doc) and update().
import { getPref, setPref } from "./prefs.js";
import { parseNum } from "./parse.js";
import { FILTERS } from "./layers.js";
import { visibleLayers } from "./curve.js";
import { LAYER_KINDS, newLayer, totalPoints, MAX_TOTAL_POINTS } from "./doc.js";
import { WEIGHTINGS, SHAPES } from "./eq.js";
import { qToBw, bwToQ } from "./bandwidth.js";

/**
 * @param {object} app the context from app.js: $, update, showNotice, expanded and the live `doc`.
 */
export function createLayersUi(app) {
  const { $, update, showNotice, expanded } = app;
  let uid = 0;
  // How the bell's width is typed: "q" or "bw" (octaves). A view setting kept in this browser only.
  let qMode = "q";
  if (getPref("tcb-qmode") === "bw") qMode = "bw";

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
      if (totalPoints(app.doc) >= MAX_TOTAL_POINTS) { showNotice([`No more points can be added: a curve holds at most ${MAX_TOTAL_POINTS} points in total.`]); return; }
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
            setPref("tcb-qmode", v);
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
  const hiddenByGroup = (l) => !visibleLayers(app.doc).includes(l);
  const groupName = (n) => app.doc.groups?.[n - 1]?.name ?? "";

  /** Which group's tab is open, 1 to 3 (a view setting, not saved). */
  let activeTab = 1;
  const tabOf = (l) => (Number.isInteger(l.group) && l.group >= 1 && l.group <= 3 ? l.group : 1);
  const tabName = (n) => app.doc.groups?.[n - 1]?.name ?? `Group ${n}`;

  function renderLayers(focus) {
    const ul = $("layers");
    ul.replaceChildren();
    const mine = app.doc.layers.filter((l) => tabOf(l) === activeTab);
    if (!mine.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No layers in ${tabName(activeTab)} yet. Use Add layer below.`;
      ul.append(li);
    }
    mine.forEach((l, pos) => {
      const i = app.doc.layers.indexOf(l); // position in the whole list: used for the ghost colour
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
        const j = app.doc.layers.indexOf(mine[pos + d]);
        [app.doc.layers[i], app.doc.layers[j]] = [app.doc.layers[j], app.doc.layers[i]];
        renderLayers([l.id, action]);
        update();
      };
      const remove = () => {
        const next = mine[pos + 1] ?? mine[pos - 1];
        app.doc.layers.splice(i, 1);
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
          const g = app.doc.groups[n - 1];
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
      const count = app.doc.layers.filter((l) => tabOf(l) === n).length;
      const hidden = app.doc.groups?.[n - 1]?.on === false;
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
    const g = app.doc.groups[n];
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
    for (const l of app.doc.layers) {
      const b = document.querySelector(`#layers li[data-id="${l.id}"] .title`);
      if (b) b.textContent = `${expanded.has(l.id) ? "▾" : "▸"} ${layerTitle(l)}`;
    }
  }

  // ---- layer ghosts: each enabled layer's own contribution drawn faintly behind the curve (a view setting)
  let ghostsOn = false;
  ghostsOn = getPref("tcb-ghosts") === "1";
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
    setPref("tcb-ghosts", ghostsOn ? "1" : "0");
    applyGhostsUi();
    document.querySelectorAll("#layers li[data-id]").forEach((li) => {
      const l = app.doc.layers.find((x) => x.id === li.dataset.id);
      if (l) stripe(li, l, app.doc.layers.indexOf(l));
    });
    update();
  });
  applyGhostsUi();

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
    app.doc.layers.push(l);
    expanded.add(l.id);
    renderLayers([l.id, "toggle"]);
    update();
  });

  return {
    renderLayers, renderGroups, refreshTitles, layerTitle, ghostHue,
    isGhostsOn: () => ghostsOn,
    getActiveTab: () => activeTab,
    setActiveTab: (n) => { activeTab = n; },
  };
}
