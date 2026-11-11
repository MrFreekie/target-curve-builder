// Security and robustness tests for the public release: no unsafe code patterns, no slow regexes on hostile files,
// no prototype pollution, no crashes on garbage, and a strict Content-Security-Policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readCrv, sanitiseFileName, crvFileName } from "../js/formats/smaart.js";
import { docFromImport, loadDoc, addImportedLayer, newDoc } from "../js/doc.js";
import * as presets from "../js/presets.js";
import { detectFormat } from "../js/formats/index.js";
import { buildCrv } from "../js/build.js";
import { suggestName } from "../js/naming.js";

const jsFiles = [...readdirSync("js").filter((f) => f.endsWith(".js")).map((f) => `js/${f}`), ...readdirSync("js/formats").map((f) => `js/formats/${f}`)];
const src = Object.fromEntries(jsFiles.map((f) => [f, readFileSync(f, "utf8")]));
const html = readFileSync("index.html", "utf8");

/** Run `fn` and return how long it took in milliseconds. */
function ms(fn) {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

// ------------------------------------------------------------------ unsafe code patterns
test("no eval, Function constructor, document.write, string timers, outerHTML or insertAdjacentHTML", () => {
  const banned = [/\beval\s*\(/, /new\s+Function\b/, /\bFunction\s*\(/, /document\.write/, /insertAdjacentHTML/, /outerHTML/, /\bsetTimeout\s*\(\s*["'`]/, /\bsetInterval\s*\(\s*["'`]/, /importScripts/];
  for (const [file, text] of Object.entries(src)) for (const re of banned) assert.ok(!re.test(text), `${file} matches ${re}`);
});

test("the app makes no network requests and opens no windows", () => {
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /window\.open/, /\bimport\s*\(/, /postMessage/, /location\s*\.\s*(href|assign|replace)\s*=/];
  for (const [file, text] of Object.entries(src)) for (const re of banned) assert.ok(!re.test(text), `${file} matches ${re}`);
});

test("innerHTML is only ever given a fixed string literal, never built from data", () => {
  let uses = 0;
  for (const [file, text] of Object.entries(src)) {
    for (const m of text.matchAll(/\.innerHTML\s*([+]?=)\s*([^;\n]*)/g)) {
      uses++;
      assert.equal(m[1], "=", `${file}: innerHTML must be assigned, not appended`);
      assert.match(m[2].trim(), /^"[^"$`\\]*"$/, `${file}: innerHTML must be a plain string literal, got ${m[2]}`);
    }
    assert.ok(!/\.innerHTML\s*;|=\s*[^;=]*\.innerHTML/.test(text.replace(/\.innerHTML\s*=/g, "")), `${file}: innerHTML is never read back into another sink`);
  }
  assert.ok(uses <= 1, `${uses} innerHTML uses`);
});

test("no inline style attributes are created from script (the page's CSP forbids them)", () => {
  for (const [file, text] of Object.entries(src)) {
    assert.ok(!/setAttribute\(\s*["']style["']/.test(text), `${file}: setAttribute("style")`);
    assert.ok(!/\bstyle\s*:\s*[`"']/.test(text), `${file}: a style attribute passed to the SVG helper`);
    assert.ok(!/setAttribute\(\s*["']on[a-z]+["']/.test(text), `${file}: an inline event handler`);
  }
});

// ------------------------------------------------------------------ the page itself
test("index.html: one strict Content-Security-Policy, a referrer policy, and nothing loaded from other sites", () => {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  assert.ok(csp, "CSP meta tag");
  const policy = Object.fromEntries(csp[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));
  assert.deepEqual(policy["default-src"], ["'none'"]);
  assert.deepEqual(policy["script-src"], ["'self'"]);
  assert.deepEqual(policy["style-src"], ["'self'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'none'"]);
  assert.deepEqual(policy["form-action"], ["'none'"]);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(csp[1].replace(/'self'/g, "")), "no unsafe keywords or hosts");
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  // every script is a same-origin module, and there are no inline scripts or handlers
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /type="module"/);
    assert.match(m[1], /src="(?!https?:|\/\/)[^"]+"/);
    assert.equal(m[2].trim(), "", "no inline script");
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers");
  assert.ok(!/\sstyle\s*=/i.test(html), "no inline styles");
  assert.ok(!/<(iframe|object|embed|link rel="(preload|prefetch|preconnect))\b/i.test(html));
});

test("index.html: the only external link is the tip jar, and it opens safely", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/mrfreekie\.github\.io\/target-curve-builder\/">/, "the canonical link names the site");
  const urls = [...html.replace(/<link rel="canonical"[^>]*>/, "").matchAll(/(?:href|src|action)\s*=\s*"([^"]+)"/g)].map((m) => m[1]).filter((u) => /^(https?:)?\/\//.test(u));
  assert.deepEqual(urls, ["https://www.buymeacoffee.com/fohengineer", "https://github.com/MrFreekie/target-curve-builder"]);
  const a = html.match(/<a [^>]*buymeacoffee[^>]*>/)[0];
  assert.match(a, /rel="noopener noreferrer"/);
  assert.match(a, /target="_blank"/);
});

test("the stylesheet loads nothing from other sites", () => {
  const css = readFileSync("css/app.css", "utf8");
  assert.ok(!/@import|url\(\s*["']?(https?:)?\/\//i.test(css));
});

// ------------------------------------------------------------------ hostile files must not freeze the page
const crv = (head, rows = "100\t0\r\n200\t1\r\n") => `${head}\r\n\r\n${rows}`;

test("crafted header lines are read in linear time (a regex once took minutes on a 2 MB line of spaces)", () => {
  for (const line of [`a${" ".repeat(2_000_000)}x`, `a${" ".repeat(500_000)}\t${" ".repeat(500_000)}x`, "a ".repeat(500_000), `a${" \t".repeat(500_000)}`, ":".repeat(1_000_000), "a:".repeat(500_000)]) {
    const t = ms(() => readCrv(crv(`${line}\r\nType:\tTF`)));
    assert.ok(t < 1500, `${t.toFixed(0)} ms for a ${line.length}-character header line`);
  }
});

test("long data rows, many rows and many header lines are read quickly and capped", () => {
  assert.ok(ms(() => readCrv(crv("Type:\tTF", "1,".repeat(1_000_000) + "\r\n"))) < 1500);
  assert.ok(ms(() => readCrv(crv("Type:\tTF", Array.from({ length: 300_000 }, (_, i) => `${20 + i * 0.01}\t0`).join("\r\n")))) < 3000);
  assert.ok(ms(() => readCrv(Array.from({ length: 200_000 }, (_, i) => `K${i}:\t${i}`).join("\r\n") + "\r\nType:\tTF\r\n\r\n100\t0\r\n200\t1\r\n")) < 3000);
  assert.throws(() => docFromImport(crv("Type:\tTF", Array.from({ length: 5001 }, (_, i) => `${20 + i}\t0`).join("\r\n")), "x.crv"), /more than 5000/);
  assert.throws(() => addImportedLayer(newDoc(), crv("Type:\tTF", Array.from({ length: 5001 }, (_, i) => `${20 + i}\t0`).join("\r\n")), "x.crv"), /more than 5000/);
});

test("file names are sanitised in bounded time, however long or strange", () => {
  for (const name of [" ".repeat(2_000_000) + "x", ".".repeat(2_000_000), "a.crv".repeat(200_000), "\u0000".repeat(1_000_000), " . ".repeat(500_000)]) {
    const t = ms(() => crvFileName(name));
    assert.ok(t < 500, `${t.toFixed(0)} ms for a ${name.length}-character name`);
  }
  assert.ok(sanitiseFileName("x".repeat(10_000)).length <= 255);
});

test("garbage input of every kind is refused or read, never a crash or a hang", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const alphabet = ["\t", " ", ",", ":", "\r", "\n", "-", ".", "0", "1", "9", "e", "E", "x", "Line", "Type", "TF", "Band", "Color", "\u0000", "﻿", "é", " ", "NaN", "Infinity", "-0", "1e999", "0x10"];
  for (let i = 0; i < 1500; i++) {
    let s = "";
    for (let k = 0, n = Math.floor(rnd() * 120); k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    for (const fn of [() => readCrv(s), () => detectFormat(s), () => docFromImport(s, "x.crv"), () => addImportedLayer(newDoc(), s, s.slice(0, 20))]) {
      try {
        fn();
      } catch (e) {
        assert.ok(e instanceof Error && !(e instanceof TypeError) && !(e instanceof RangeError && /call stack/.test(e.message)), `${JSON.stringify(s)}: ${e}`);
      }
    }
  }
});

test("any .crv that imports exports without throwing, and never writes NaN, Infinity or -0", () => {
  const files = [crv("Type:\tTF", "100\t1e308\r\n200\t-1e308\r\n"), crv("Type:\tTF", "100\t0\r\n100\t5\r\n"), crv("Type:\tTF", "0\t0\r\n-5\t0\r\n10\t0\r\n"), crv("Type:\tTF", "1e-300\t0\r\n1e300\t0\r\n")];
  for (const text of files) {
    try {
      const { doc } = docFromImport(text, "x.crv");
      const r = buildCrv(doc);
      if (r.text) assert.ok(!/NaN|Infinity|-0\.000000/.test(r.text), r.text);
    } catch (e) {
      assert.ok(e instanceof Error && !(e instanceof TypeError), String(e));
    }
  }
});

// ------------------------------------------------------------------ hostile saved documents (presets, autosave)
test("a preset or autosave can't pollute Object.prototype or any shared object", () => {
  const evil = [
    '{"version":1,"__proto__":{"polluted":"yes"},"layers":[]}',
    '{"version":1,"props":{"__proto__":{"polluted":"yes"}},"grid":{"__proto__":{"polluted":"yes"}},"layers":[{"kind":"gain","db":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}]}',
    '{"version":1,"constructor":{"prototype":{"polluted":"yes"}},"groups":[{"__proto__":{"polluted":"yes"}}],"normalise":{"__proto__":{"polluted":"yes"}},"layers":[]}',
    '{"version":1,"original":[[1,0],[2,0]],"originalProps":{"__proto__":{"polluted":"yes"},"rawHeader":[{"key":"__proto__","raw":"__proto__: x"}]},"layers":[]}',
  ];
  for (const json of evil) {
    try { presets.presetFromJson(json); } catch { /* refusing is fine */ }
    assert.equal({}.polluted, undefined, json);
    assert.equal([].polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.keys(Object.prototype).length, 0, "Object.prototype has no enumerable keys");
  }
  const d = loadDoc(JSON.parse(evil[1]));
  assert.equal(d.props.polluted, undefined);
  assert.equal(d.grid.polluted, undefined);
  assert.equal(d.layers[0].polluted, undefined);
});

test("preset names such as __proto__ and constructor are stored and read back as plain keys", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  try {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      assert.equal(presets.savePreset(name, newDoc()), true, name);
      assert.ok(presets.listPresets().includes(name), name);
      assert.ok(presets.loadPreset(name), name);
    }
    assert.equal({}.polluted, undefined);
    assert.equal(typeof Object.prototype.toString, "function", "built-ins are intact");
    for (const name of presets.listPresets()) presets.deletePreset(name);
    assert.deepEqual(presets.listPresets(), []);
    // corrupt or hostile stored values are ignored
    for (const v of ["{", "null", "[]", '"x"', "123", '{"version":2}', '{"version":1,"layers":"x"}', "\u0000".repeat(1000), "9".repeat(100000)]) {
      store.set("tcb-autosave", v);
      store.set("tcb-presets", v);
      assert.equal(presets.loadAutosave(), null, v.slice(0, 20));
      assert.ok(Array.isArray(presets.listPresets()));
    }
  } finally {
    delete globalThis.localStorage;
  }
});

test("fuzzing saved documents: loading never throws a TypeError, and what loads always exports or is blocked cleanly", () => {
  let seed = 424242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const junk = [null, undefined, true, false, 0, -1, 1e308, -1e308, NaN, "", "x", "1", "__proto__", [], [1], {}, { a: 1 }, [[1, 2]], 1.5, 99999999];
  // every path to a value inside the document, so that a few of them can be replaced with junk
  const paths = (v, prefix = []) => (v && typeof v === "object" ? Object.keys(v).flatMap((k) => [[...prefix, k], ...paths(v[k], [...prefix, k])]) : []);
  const setAt = (root, path, value) => {
    let o = root;
    for (const k of path.slice(0, -1)) o = o[k];
    if (value === undefined) delete o[path.at(-1)]; else o[path.at(-1)] = value;
  };
  const template = JSON.parse(JSON.stringify(newDoc()));
  template.layers.push({ kind: "bell", on: true, fc: 1000, q: 1, db: 3 }, { kind: "shape", on: true, shape: "pyramid", fc: 1000, width: 2, db: 6, flat: 0.5, count: 3 },
    { kind: "mesa", on: true, fLow: 80, fHigh: 400, wLow: 1, wHigh: 2, db: 6 }, { kind: "weighting", on: true, curve: "A" },
    { kind: "hiShelf", on: true, fc: 8000, type: "BW", slope: 12, db: -3 }, { kind: "hpf", on: true, fc: 50, type: "CH1", slope: 24 });
  let loaded = 0;
  for (let i = 0; i < 4000; i++) {
    const hostile = JSON.parse(JSON.stringify(template));
    for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const all = paths(hostile); // recomputed each time: an earlier mutation may have replaced an object
      setAt(hostile, all[Math.floor(rnd() * all.length)], junk[Math.floor(rnd() * junk.length)]);
    }
    let doc;
    try {
      doc = loadDoc(hostile);
    } catch (e) {
      assert.ok(e instanceof Error && !(e instanceof TypeError), `${e}`);
      continue;
    }
    loaded++;
    const r = buildCrv(doc);
    if (r.text) assert.ok(!/NaN|Infinity|-0\.000000/.test(r.text));
    assert.equal(typeof suggestName(doc), "string");
  }
  assert.ok(loaded > 500, `only ${loaded} of 4000 hostile documents loaded, the fuzz isn't reaching the exporter`);
});

// ------------------------------------------------------------------ resource limits
test("the grid is limited to what a plot and a table can reasonably hold", () => {
  const g = (grid) => loadDoc({ version: 1, layers: [], grid }).grid;
  assert.equal(g({ fmax: 1e308 }).fmax, 20000, "an absurd upper limit is ignored");
  assert.equal(g({ fmax: 100000 }).fmax, 100000);
  assert.equal(g({ fraction: 48, fmin: 1, fmax: 100000 }).fraction, 48);
  const d = newDoc();
  d.grid = { mode: "resample", fraction: 48, fmin: 1, fmax: 100000 };
  assert.ok(buildCrv(d).points.length < 1000);
  assert.throws(() => loadDoc({ version: 1, layers: Array.from({ length: 51 }, () => ({ kind: "gain", db: 1 })) }), /Invalid layer list/);
  assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "points", points: Array.from({ length: 5001 }, (_, i) => [i + 1, 0]) }] }), /Invalid points/);
});

test("names and labels from files are cleaned of control characters and limited in length", () => {
  const nasty = "a\r\nb\u0000c d" + "x".repeat(5000);
  const { doc } = addImportedLayer(newDoc(), crv("Type:\tTF"), nasty);
  assert.ok(doc.layers.at(-1).label.length <= 100);
  assert.ok(!/[\r\n\u0000]/.test(doc.layers.at(-1).label));
  const loaded = loadDoc({ version: 1, props: { name: nasty }, groups: [{ name: nasty }], layers: [] });
  assert.ok(loaded.props.name.length <= 200 && !/[\r\n\u0000]/.test(loaded.props.name));
  assert.ok(loaded.groups[0].name.length <= 24 && !/[\r\n\u0000]/.test(loaded.groups[0].name));
});
