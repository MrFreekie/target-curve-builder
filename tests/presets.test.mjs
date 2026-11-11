// Presets + storage tests. Expectations from docs/SPEC.md §2, §7, §8 and BUILD_PLAN Phase 4.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCrv } from "../js/build.js";
import { newDoc } from "../js/doc.js";
import * as P from "../js/presets.js";

const golden = JSON.parse(readFileSync(new URL("../reference/golden.json", import.meta.url), "utf8"));
const TOL = golden.tolerance_db;
const sample = (n) => readFileSync(new URL(`../reference/samples/${n}`, import.meta.url), "utf8");
const strip = (d) => ({ ...d, layers: d.layers.map(({ id, ...r }) => r) });

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}
const hadStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
function setStorage(v) {
  Object.defineProperty(globalThis, "localStorage", { value: v, configurable: true, writable: true });
}
beforeEach(() => setStorage(memoryStorage()));
afterEach(() => {
  delete globalThis.localStorage;
  if (hadStorage) Object.defineProperty(globalThis, "localStorage", hadStorage);
});

const rowsOf = (text) => text.split(/\r\n|\n/).slice(7).filter(Boolean).map((l) => l.split("\t").map(Number));
const preset = (name) => P.BUILT_IN_PRESETS.find((p) => p.name === name);

// built-ins
test("the three built-in presets from the plan are shipped (more were added later)", () => {
  const names = P.BUILT_IN_PRESETS.map((p) => p.name);
  for (const n of ["3 dB/oct from 1 kHz + 32 Hz LR48", "Flat + 32 Hz LR48", "LA 7 dB at 63 → 0 at 315 + 32 Hz LR48"]) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length, "unique names");
});

for (const p of P.BUILT_IN_PRESETS) {
  test(`built-in "${p.name}": build() returns a fresh doc each time and it exports`, () => {
    const a = p.build(), b = p.build();
    assert.notEqual(a, b);
    a.layers[0].on = !a.layers[0].on;
    assert.notEqual(a.layers[0].on, b.layers[0].on, "build() must not share state");
    const r = buildCrv(p.build());
    assert.deepEqual(r.issues.filter((i) => i.level === "error"), []);
    assert.ok(r.text);
    assert.ok(r.points.length >= 2);
  });
  test(`built-in "${p.name}": JSON round trip gives an equivalent doc and the same output`, () => {
    const d = p.build();
    const back = P.presetFromJson(P.presetToJson(d));
    assert.deepEqual(strip(back), strip(d));
    assert.equal(buildCrv(back).text, buildCrv(d).text);
    const ids = back.layers.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);
  });
}

test("JSON round trip of newDoc() is equivalent", () => {
  const d = newDoc();
  assert.deepEqual(strip(P.presetFromJson(P.presetToJson(d))), strip(d));
});

test("presetToJson returns a string of valid JSON with version 1", () => {
  const s = P.presetToJson(newDoc());
  assert.equal(typeof s, "string");
  assert.equal(JSON.parse(s).version, 1);
});

test("3 dB/oct built-in values equal Tilt_3dBoct_1000Hz_HPF32_LR48.crv", () => {
  const out = buildCrv(preset("3 dB/oct from 1 kHz + 32 Hz LR48").build());
  const expected = rowsOf(sample("Tilt_3dBoct_1000Hz_HPF32_LR48.crv"));
  const got = rowsOf(out.text);
  assert.equal(got.length, expected.length);
  expected.forEach(([f, db], i) => {
    assert.equal(got[i][0], f);
    assert.ok(Math.abs(got[i][1] - db) < TOL, `@ ${f} Hz expected ${db} got ${got[i][1]}`);
  });
});

test("3 dB/oct built-in is byte-identical to the sample (line 3, SPEC §9.3)", () => {
  const out = buildCrv(preset("3 dB/oct from 1 kHz + 32 Hz LR48").build());
  assert.equal(out.text, sample("Tilt_3dBoct_1000Hz_HPF32_LR48.crv"));
});

test("LA built-in equals golden points_LA_hpf_LR48_32", () => {
  const c = golden.cases.find((k) => k.id === "points_LA_hpf_LR48_32");
  const got = rowsOf(buildCrv(preset("LA 7 dB at 63 → 0 at 315 + 32 Hz LR48").build()).text);
  assert.equal(got.length, c.expected.length);
  c.expected.forEach(([f, db], i) => {
    assert.equal(got[i][0], f, `${c.id} row ${i} Hz`);
    assert.ok(Math.abs(got[i][1] - db) < TOL, `${c.id} @ ${f} Hz expected ${db} got ${got[i][1]}`);
  });
});

test("Flat + 32 Hz LR48 is a pure LR48 high-pass on a 0 dB curve", () => {
  const out = buildCrv(preset("Flat + 32 Hz LR48").build());
  const byF = new Map(out.points.map(([f, db]) => [f, db]));
  const lr = (f) => -20 * Math.log10(1 + (32 / f) ** 8); // SPEC §4.4
  for (const f of [20, 31.5, 40, 63, 100, 1000, 20000]) {
    assert.ok(Math.abs(byF.get(f) - lr(f)) < 1e-5, `@ ${f} Hz expected ${lr(f)} got ${byF.get(f)}`);
  }
  assert.ok(byF.get(20) < -20);
});

// presetFromJson
test("presetFromJson: invalid JSON throws a readable Error", () => {
  for (const t of ["", "{", "not json", "[1,2"]) assert.throws(() => P.presetFromJson(t), (e) => e instanceof Error && e.message.length > 3, t);
});
test("presetFromJson: valid JSON of the wrong shape throws a readable Error", () => {
  for (const t of ["null", "42", "[]", '"x"', "{}", '{"version":99,"layers":[]}']) {
    assert.throws(() => P.presetFromJson(t), (e) => e instanceof Error && e.message.length > 3, t);
  }
});

// (6) storage
test("storage: autosave then loadAutosave round trips", () => {
  const d = preset("Flat + 32 Hz LR48").build();
  assert.equal(P.autosave(P.presetToJson(d)), true);
  assert.deepEqual(strip(P.loadAutosave()), strip(d));
});

test("storage: loadAutosave is null when nothing is saved", () => {
  assert.equal(P.loadAutosave(), null);
});

test("storage: named presets save, list, load and delete", () => {
  const a = preset("Flat + 32 Hz LR48").build();
  const b = newDoc();
  assert.deepEqual(P.listPresets(), []);
  assert.equal(P.savePreset("zeta", a), true);
  assert.equal(P.savePreset("Alpha", b), true);
  assert.deepEqual(P.listPresets().slice().sort(), ["Alpha", "zeta"]);
  assert.deepEqual(strip(P.loadPreset("zeta")), strip(a));
  assert.deepEqual(strip(P.loadPreset("Alpha")), strip(b));
  P.deletePreset("zeta");
  assert.deepEqual(P.listPresets(), ["Alpha"]);
  assert.equal(P.loadPreset("zeta"), null);
});

test("storage: saving the same preset name twice overwrites", () => {
  P.savePreset("x", newDoc());
  const d = preset("Flat + 32 Hz LR48").build();
  P.savePreset("x", d);
  assert.equal(P.listPresets().length, 1);
  assert.deepEqual(strip(P.loadPreset("x")), strip(d));
});

test("storage: loadPreset of a missing name is null", () => {
  assert.equal(P.loadPreset("nope"), null);
});

test("storage: preset names like __proto__ and constructor do not throw or pollute", () => {
  for (const n of ["__proto__", "constructor", "toString"]) {
    assert.doesNotThrow(() => { P.savePreset(n, newDoc()); P.loadPreset(n); P.listPresets(); P.deletePreset(n); }, n);
  }
  assert.equal({}.polluted, undefined);
});

function allCallsSafe(label) {
  assert.doesNotThrow(() => {
    assert.equal(P.autosave("{}"), false, `${label}: autosave returns false`);
    assert.equal(P.loadAutosave(), null, `${label}: loadAutosave null`);
    assert.equal(P.savePreset("a", newDoc()), false, `${label}: savePreset false`);
    assert.equal(P.loadPreset("a"), null, `${label}: loadPreset null`);
    assert.deepEqual(P.listPresets(), [], `${label}: listPresets empty`);
    P.deletePreset("a");
  }, label);
}

test("storage: localStorage undefined never throws", () => {
  delete globalThis.localStorage;
  allCallsSafe("missing");
});

test("storage: localStorage null never throws", () => {
  setStorage(null);
  allCallsSafe("null");
});

test("storage: reading the localStorage global itself throws (blocked storage) never throws", () => {
  delete globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
  allCallsSafe("getter throws");
});

test("storage: getItem and setItem both throw never throws", () => {
  setStorage({ getItem() { throw new Error("boom"); }, setItem() { throw new Error("boom"); } });
  allCallsSafe("methods throw");
});

test("storage: setItem quota error returns false and reads still work", () => {
  setStorage({
    ...memoryStorage(),
    setItem() { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; },
  });
  assert.equal(P.autosave("{}"), false);
  assert.equal(P.savePreset("a", newDoc()), false);
  assert.equal(P.loadAutosave(), null);
  assert.deepEqual(P.listPresets(), []);
});

test("storage: corrupt autosave JSON gives null", () => {
  localStorage.setItem("tcb-autosave", "{not json");
  assert.equal(P.loadAutosave(), null);
});

test("storage: hostile-but-valid autosave JSON gives null, never throws", () => {
  for (const t of ["null", "42", "[]", '{"version":1,"layers":"x"}', '{"version":2}']) {
    localStorage.setItem("tcb-autosave", t);
    let d;
    assert.doesNotThrow(() => { d = P.loadAutosave(); }, t);
    assert.equal(d, null, t);
  }
});

test("storage: corrupt presets store behaves as empty and recovers on save", () => {
  localStorage.setItem("tcb-presets", "garbage{{");
  assert.deepEqual(P.listPresets(), []);
  assert.equal(P.loadPreset("a"), null);
  assert.doesNotThrow(() => P.deletePreset("a"));
  assert.equal(P.savePreset("a", newDoc()), true);
  assert.deepEqual(P.listPresets(), ["a"]);
});

test("storage: presets store holding a non-object is treated as empty", () => {
  for (const t of ["[1,2]", "5", "null", '"s"']) {
    localStorage.setItem("tcb-presets", t);
    assert.deepEqual(P.listPresets(), [], t);
    assert.equal(P.loadPreset("0"), null, t);
  }
});

test("storage: a corrupt entry inside the presets store gives null for it and leaves others usable", () => {
  P.savePreset("good", newDoc());
  const all = JSON.parse(localStorage.getItem("tcb-presets"));
  all.bad = { version: 1, layers: "nope" };
  localStorage.setItem("tcb-presets", JSON.stringify(all));
  assert.equal(P.loadPreset("bad"), null);
  assert.ok(P.loadPreset("good"));
});
