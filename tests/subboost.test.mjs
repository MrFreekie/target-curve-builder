import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, totalDb } from "../js/curve.js";
import { layerDb } from "../js/layers.js";
import { newDoc, newLayer, loadDoc, LAYER_KINDS } from "../js/doc.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/app.js";

const sub = (o = {}) => ({ kind: "subBoost", on: true, fc: 60, type: "LR", slope: 24, db: 6, ...o });
const doc = (layers) => ({ grid: { mode: "resample", fraction: 3, fmin: 20, fmax: 20000 }, layers });

// Closed forms from SPEC §4.4a: db * linear low-pass magnitude. LR: 1/(1 + r^n); BW: 1/sqrt(1 + r^(2n)); r = f/fc.
const lrLin = (f, fc, slope) => 1 / (1 + (f / fc) ** (slope / 6));
const bwLin = (f, fc, slope) => 1 / Math.sqrt(1 + (f / fc) ** (slope / 3));

test("full boost far below the corner, none far above, half at an LR corner", () => {
  assert.ok(Math.abs(layerDb(1, sub(), 0) - 6) < 1e-5);
  assert.ok(Math.abs(layerDb(20, sub(), 0) - 6 * lrLin(20, 60, 24)) < 1e-12);
  assert.ok(Math.abs(layerDb(60, sub(), 0) - 3) < 1e-12);
  assert.ok(Math.abs(layerDb(120, sub(), 0) - 6 / 17) < 1e-12);
  assert.ok(Math.abs(layerDb(20000, sub(), 0)) < 1e-9);
});

test("matches the closed form for every LR and BW slope, boosts and cuts", () => {
  for (const [type, slope, lin] of [["LR", 12, lrLin], ["LR", 24, lrLin], ["LR", 48, lrLin], ["BW", 6, bwLin], ["BW", 18, bwLin], ["BW", 48, bwLin]]) {
    for (const db of [6, -4.5, 0.5]) {
      for (const f of [20, 31.5, 45, 60, 63, 80, 100, 250, 1000]) {
        const got = layerDb(f, sub({ type, slope, db }), 0);
        assert.ok(Math.abs(got - db * lin(f, 60, slope)) < 1e-10, `${type}${slope} ${db} dB at ${f}`);
      }
    }
  }
});

test("negative values are a mirror image; zero does nothing; disabled layer ignored", () => {
  for (const f of [20, 60, 100, 500]) assert.ok(Math.abs(layerDb(f, sub({ db: -6 }), 0) + layerDb(f, sub({ db: 6 }), 0)) < 1e-12);
  assert.equal(layerDb(60, sub({ db: 0 }), 0) + 0, 0);
  assert.equal(totalDb(60, [sub({ on: false })]), 0);
});

test("sums with an HPF into a haystack hump", () => {
  const d = doc([sub({ fc: 60, slope: 24, db: 6 }), { kind: "hpf", on: true, fc: 32, type: "LR", slope: 48 }]);
  const out = Object.fromEntries(evaluate(d));
  assert.ok(out[20] < -10, "rolled off below the HPF");
  assert.ok(out[50] > 3 && out[50] < 6.1, "boosted in the sub range");
  assert.ok(Math.abs(out[1000]) < 1e-3, "flat above");
});

test("illegal slope or type throws; validation blocks export with a clear message", () => {
  assert.throws(() => layerDb(60, sub({ slope: 30 }), 0));
  assert.throws(() => layerDb(60, sub({ type: "XX" }), 0));
  const d = newDoc();
  d.layers.push({ id: "s", ...sub({ slope: 30 }) });
  const r = buildCrv(d);
  assert.equal(r.text, null);
  assert.ok(r.issues.some((i) => /Sub boost: .*dB\/oct/.test(i.message)), JSON.stringify(r.issues));
  const z = newDoc();
  z.layers.push({ id: "s", ...sub({ fc: 0 }) });
  assert.equal(buildCrv(z).text, null);
});

test("new layer, layer list, loadDoc, export and simplify", () => {
  assert.ok("subBoost" in LAYER_KINDS);
  const l = newLayer("subBoost");
  assert.deepEqual({ kind: l.kind, on: l.on, fc: l.fc, type: l.type, slope: l.slope, db: l.db }, { kind: "subBoost", on: true, fc: 60, type: "LR", slope: 24, db: 6 });
  const d = newDoc();
  d.layers.push(l);
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.layers.at(-1), { ...l, id: back.layers.at(-1).id });
  assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "subBoost", on: true, fc: 60, type: "LR", slope: 24 }] }));
  assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "subBoost", on: true, fc: 60, type: "LR", slope: 25, db: 3 }] }));
  const r = buildCrv(d);
  assert.ok(r.text);
  d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.1 };
  const s = buildCrv(d);
  assert.ok(s.text && s.points.length < r.points.length);
});

test("name suggestion", () => {
  const d = newDoc();
  d.layers.push({ id: "s", ...sub() });
  assert.equal(suggestName(d), "Sub+6dB_60Hz_LR24");
  d.layers.find((x) => x.kind === "hpf").on = true;
  assert.equal(suggestName(d), "Sub+6dB_60Hz_LR24_HPF32_LR48");
  d.layers.at(-1).db = -3;
  assert.match(suggestName(d), /^Sub-3dB_60Hz_LR24_/);
});

test("names inherited from Object.prototype are not layer kinds or filter types", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.throws(() => loadDoc({ version: 1, layers: [{ kind: name, on: true }] }), /Unknown layer type/);
    assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "hpf", on: true, fc: 50, type: name, slope: 24 }] }), /Unknown filter type/);
    assert.throws(() => layerDb(60, sub({ type: name }), 0), /Unknown filter type/);
    const d = newDoc();
    d.layers.push({ id: "s", ...sub({ type: name }) });
    assert.doesNotThrow(() => buildCrv(d));
    assert.equal(buildCrv(d).text, null);
  }
});
