import { test } from "node:test";
import assert from "node:assert/strict";
import { weightingDb, WEIGHTINGS } from "../js/eq.js";
import { layerDb } from "../js/layers.js";
import { evaluate } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, LAYER_KINDS } from "../js/doc.js";
import { BUILT_IN_PRESETS } from "../js/presets.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/build.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

// IEC 61672-1 Table 3 (A and C weighting at the nominal 1/3-octave frequencies, to 0.1 dB). The table is
// computed at the exact base-10 frequencies 10^(n/10) Hz, so those are used here.
const A_TABLE = { 20: -50.5, 25: -44.7, 31.5: -39.4, 40: -34.6, 50: -30.2, 63: -26.2, 80: -22.5, 100: -19.1, 125: -16.1, 160: -13.4, 200: -10.9, 250: -8.6, 315: -6.6, 400: -4.8, 500: -3.2, 630: -1.9, 800: -0.8, 1000: 0, 1250: 0.6, 1600: 1.0, 2000: 1.2, 2500: 1.3, 3150: 1.2, 4000: 1.0, 5000: 0.5, 6300: -0.1, 8000: -1.1, 10000: -2.5, 12500: -4.3, 16000: -6.6, 20000: -9.3 };
const C_TABLE = { 20: -6.2, 25: -4.4, 31.5: -3.0, 40: -2.0, 50: -1.3, 63: -0.8, 80: -0.5, 100: -0.3, 125: -0.2, 160: -0.1, 200: 0, 250: 0, 315: 0, 400: 0, 500: 0, 630: 0, 800: 0, 1000: 0, 1250: 0, 1600: -0.1, 2000: -0.2, 2500: -0.3, 3150: -0.5, 4000: -0.8, 5000: -1.3, 6300: -2.0, 8000: -3.0, 10000: -4.4, 12500: -6.2, 16000: -8.5, 20000: -11.2 };
const exact = (label) => 10 ** (Math.round(10 * Math.log10(label)) / 10);

test("A and C weighting match the IEC 61672-1 table to its 0.1 dB rounding", () => {
  for (const [f, v] of Object.entries(A_TABLE)) close(weightingDb("A", exact(+f)), v, 0.06, `A at ${f}`);
  for (const [f, v] of Object.entries(C_TABLE)) close(weightingDb("C", exact(+f)), v, 0.06, `C at ${f}`);
});

test("A, C and RIAA are exactly 0 dB at 1 kHz", () => {
  for (const c of ["A", "C", "RIAA"]) assert.equal(weightingDb(c, 1000), 0, c);
});

test("RIAA replay matches the published table, and FM pre-emphasis the first-order formula", () => {
  const riaa = { 20: 19.27, 50: 16.95, 100: 13.09, 500: 2.65, 1000: 0, 2000: -2.59, 5000: -8.21, 10000: -13.73, 20000: -19.62 };
  for (const [f, v] of Object.entries(riaa)) close(weightingDb("RIAA", +f), v, 0.02, `RIAA at ${f}`);
  for (const [c, tau] of [["FM75", 75e-6], ["FM50", 50e-6]]) {
    for (const f of [10, 100, 2122, 5000, 15000, 20000]) {
      close(weightingDb(c, f), 10 * Math.log10(1 + (2 * Math.PI * f * tau) ** 2), 1e-9, `${c} at ${f}`);
    }
  }
  close(weightingDb("FM75", 2122.07), 3.0103, 1e-3, "FM 75 us corner is -3 dB point");
  close(weightingDb("FM75", 15000), 17.07, 0.02, "about +17 dB at 15 kHz");
});

test("shape facts: A rolls off both ends, C is flatter, both stay finite at extreme frequencies", () => {
  assert.ok(weightingDb("A", 20) < -50 && weightingDb("A", 20000) < -9);
  assert.ok(Math.max(...Object.keys(A_TABLE).map((f) => weightingDb("A", +f))) < 1.4);
  assert.ok(weightingDb("C", 100) > weightingDb("A", 100));
  for (const c of Object.keys(WEIGHTINGS)) {
    for (const f of [1e-9, 1e-3, 1, 20, 20000, 1e9, 1e100, 1e300]) assert.ok(Number.isFinite(weightingDb(c, f)), `${c} at ${f}`);
  }
  assert.throws(() => weightingDb("Z", 1000), RangeError);
  assert.throws(() => weightingDb("constructor", 1000), RangeError);
});

test("invert flips the sign of any layer, and twice is the same as not at all", () => {
  const layers = [
    { kind: "weighting", curve: "A" }, { kind: "hpf", fc: 50, type: "LR", slope: 24 }, { kind: "bell", fc: 500, q: 2, db: 6 },
    { kind: "lfTilt", dbPerOct: 3, pivot: 1000, floor: null }, { kind: "gain", db: 4 }, { kind: "points", points: [[63, 7], [315, 0], [20000, 0]] },
  ];
  for (const l of layers) {
    for (const f of [20, 63, 100, 700, 5000]) {
      const plain = layerDb(f, l);
      close(layerDb(f, { ...l, invert: true }), -plain, 0, `${l.kind} at ${f}`);
      close(layerDb(f, { ...l, invert: false }), plain, 0, `${l.kind} not inverted at ${f}`);
    }
  }
  const d = newDoc();
  d.layers.push({ id: "w", ...newLayer("weighting"), curve: "A" });
  const a = evaluate(d);
  d.layers.at(-1).invert = true;
  const b = evaluate(d);
  a.forEach(([, g], i) => close(b[i][1], -g, 1e-6, "inverted curve"));
  assert.ok(b.every(([, g]) => !Object.is(g, -0)));
});

test("weighting layer: newLayer, loadDoc round trip, validation, export", () => {
  assert.ok(Object.hasOwn(LAYER_KINDS, "weighting"));
  const l = newLayer("weighting");
  assert.deepEqual({ kind: l.kind, on: l.on, curve: l.curve }, { kind: "weighting", on: true, curve: "A" });
  const d = newDoc();
  d.layers.push({ ...l, invert: true });
  const r = buildCrv(d);
  assert.ok(r.text, JSON.stringify(r.issues));
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(back.layers.at(-1).invert, true);
  assert.equal(back.layers.at(-1).curve, "A");
  assert.equal(loadDoc(JSON.parse(JSON.stringify(newDoc()))).layers.every((x) => !("invert" in x)), true, "no invert key unless set");
  for (const curve of ["Z", "constructor", "", null, ["A"], 5]) {
    assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "weighting", on: true, curve }] }), /weighting curve/i, String(curve));
    const bad = newDoc();
    bad.layers.push({ id: "x", kind: "weighting", on: true, curve });
    const v = buildCrv(bad);
    assert.equal(v.text, null);
  }
  // invert must be literally true to count
  assert.equal("invert" in loadDoc({ version: 1, layers: [{ kind: "gain", on: true, db: 3, invert: "yes" }] }).layers[0], false);
});

test("name suggestions: weighting curves and inverted layers", () => {
  const d = newDoc();
  d.layers.push({ id: "a", ...newLayer("weighting"), curve: "C" });
  assert.equal(suggestName(d), "CWt");
  d.layers.at(-1).invert = true;
  assert.equal(suggestName(d), "InvCWt");
  d.layers.at(-1).curve = "RIAA";
  d.layers.find((x) => x.kind === "hpf").on = true;
  assert.equal(suggestName(d), "InvRIAA_HPF32_LR48");
  assert.match(suggestName(d), /^[A-Za-z0-9._+-]+$/);
});

test("the weighting presets build, export and match the curves", () => {
  const byName = Object.fromEntries(BUILT_IN_PRESETS.map((p) => [p.name, p]));
  const a = byName["A-weighting (dBA)"].build();
  const out = Object.fromEntries(buildCrv(a).points);
  close(out[1000], 0, 1e-6, "A at 1 kHz");
  const near = (m, f) => Object.entries(m).reduce((b, e) => (Math.abs(Math.log(e[0] / f)) < Math.abs(Math.log(b[0] / f)) ? e : b))[1];
  assert.ok(near(out, 100) < -18 && near(out, 100) > -20, `A near 100 Hz ${near(out, 100)}`);
  const inv = Object.fromEntries(buildCrv(byName["Inverse A-weighting (large bass boost)"].build()).points);
  for (const f of Object.keys(out)) close(inv[f], -out[f], 1e-6, `inverse at ${f}`);
  const riaa = Object.fromEntries(buildCrv(byName["RIAA playback"].build()).points);
  const rec = Object.fromEntries(buildCrv(byName["RIAA recording (inverse of playback)"].build()).points);
  for (const f of Object.keys(riaa)) close(rec[f], -riaa[f], 1e-6, `riaa inverse at ${f}`);
  for (const p of BUILT_IN_PRESETS) assert.ok(buildCrv(p.build()).text, p.name);
});

// ---- regressions from the independent check
test("RIAA and FM stay finite and correct at the very top of the double range", () => {
  for (const c of ["RIAA", "FM75", "FM50"]) {
    for (const f of [1e300, 2.9e307, 1e308, Number.MAX_VALUE]) assert.ok(Number.isFinite(weightingDb(c, f)), `${c} at ${f}`);
  }
  // FM: 20 log10(2 pi tau f), RIAA far above all corners: -6.02 dB/oct (flat 20 log10(318/(3180*75)*... ) shape)
  close(weightingDb("FM75", 1e308), 20 * Math.log10(2 * Math.PI * 75e-6) + 20 * 308, 1e-6, "FM75 asymptote");
  close(weightingDb("RIAA", 1e300) - weightingDb("RIAA", 2e300), 6.0206, 1e-3, "RIAA -6 dB/oct far above");
});

test("only an invert flag that is exactly true counts in names", () => {
  const d = newDoc();
  d.layers.push({ id: "w", kind: "weighting", on: true, curve: "A", invert: 1 });
  assert.equal(suggestName(d), "AWt");
  d.layers.at(-1).invert = true;
  assert.equal(suggestName(d), "InvAWt");
  d.layers.at(-1).curve = "constructor";
  assert.equal(suggestName(d), "InvWt");
});
