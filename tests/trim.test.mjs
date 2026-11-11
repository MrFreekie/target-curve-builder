import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, effectiveRange, makeGrid } from "../js/curve.js";
import { newDoc, loadDoc, docFromImport, resetToImport } from "../js/doc.js";
import { buildCrv } from "../js/app.js";

const withGrid = (grid, extra = {}) => { const d = newDoc(); d.grid = { mode: "resample", fraction: 3, fmin: 20, fmax: 20000, ...grid }; Object.assign(d, extra); return d; };
const tilt = (d) => { d.layers.find((l) => l.kind === "lfTilt").on = true; return d; };

test("effectiveRange: the trim when set, otherwise the grid range", () => {
  assert.deepEqual(effectiveRange({}), [20, 20000]);
  assert.deepEqual(effectiveRange({ fmin: 25, fmax: 12000 }), [25, 12000]);
  assert.deepEqual(effectiveRange({ fmin: 25, fmax: 12000, trimLow: 100 }), [100, 12000]);
  assert.deepEqual(effectiveRange({ trimHigh: 8000 }), [20, 8000]);
  assert.deepEqual(effectiveRange({ trimLow: 63, trimHigh: 500, fmin: 20, fmax: 20000 }), [63, 500]);
});

test("1/3-octave grid is cropped to the trim, edges included", () => {
  const out = evaluate(tilt(withGrid({ trimLow: 100, trimHigh: 1000 })));
  assert.deepEqual(out.map((p) => p[0]), [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000]);
  // the values are unchanged by the trim (same curve, just fewer points)
  const full = Object.fromEntries(evaluate(tilt(withGrid({}))));
  for (const [f, g] of out) assert.equal(g, full[f], `${f} Hz`);
});

test("only a low or only a high trim works, and no trim leaves everything as before", () => {
  const all = evaluate(tilt(withGrid({}))).map((p) => p[0]);
  assert.equal(all.length, 31);
  assert.deepEqual(evaluate(tilt(withGrid({ trimLow: 1000 }))).map((p) => p[0]), all.filter((f) => f >= 1000));
  assert.deepEqual(evaluate(tilt(withGrid({ trimHigh: 100 }))).map((p) => p[0]), all.filter((f) => f <= 100));
  assert.deepEqual(evaluate(tilt(withGrid({}))), evaluate(tilt(withGrid({ trimLow: undefined, trimHigh: undefined }))));
});

test("a trim wider than the grid range extends it (the trim wins)", () => {
  const out = evaluate(tilt(withGrid({ fraction: 12, trimLow: 10, trimHigh: 24000 }))).map((p) => p[0]);
  assert.ok(out[0] >= 10 && out[0] < 11, `first ${out[0]}`);
  assert.ok(out.at(-1) <= 24000 && out.at(-1) > 22000, `last ${out.at(-1)}`);
});

test("breakpoints grid: first and last points are exactly the trim", () => {
  const d = tilt(withGrid({ mode: "simplified", epsilon: 0.1, trimLow: 70, trimHigh: 5000 }));
  const out = evaluate(d);
  assert.equal(out[0][0], 70);
  assert.equal(out.at(-1)[0], 5000);
  assert.ok(out.every(([f]) => f >= 70 && f <= 5000));
});

test("keep-original grid: imported points outside the trim are dropped, only when a trim is set", () => {
  const text = readFileSync("reference/samples/user_LA_7dB_at_315k_HPF32_LR48_irregular.crv", "utf8");
  const { doc } = docFromImport(text, "irregular.crv");
  const before = evaluate(doc);
  assert.equal(before.length, doc.original.length);
  assert.ok(before[0][0] < 20, "the sample starts below 20 Hz");
  assert.equal(buildCrv(doc).text, text, "no trim: byte-identical round trip");
  doc.grid.trimLow = 20;
  doc.grid.trimHigh = 100;
  const after = evaluate(doc);
  assert.ok(after.length > 2 && after.length < before.length);
  assert.ok(after.every(([f]) => f >= 20 && f <= 100));
  assert.deepEqual(after, before.filter(([f]) => f >= 20 && f <= 100), "same values, fewer points");
  // inclusive at the edges
  doc.grid.trimLow = doc.original[5][0];
  doc.grid.trimHigh = doc.original[9][0];
  assert.deepEqual(evaluate(doc).map((p) => p[0]), doc.original.slice(5, 10).map((p) => p[0]));
});

test("explicit frequencies are never trimmed (drag handles use them)", () => {
  const d = tilt(withGrid({ trimLow: 1000, trimHigh: 2000 }));
  assert.equal(evaluate(d, [20, 100, 500, 5000]).length, 4);
});

test("loadDoc keeps a sensible trim and drops a nonsensical one", () => {
  const g = (grid) => loadDoc({ version: 1, layers: [], grid }).grid;
  assert.equal(g({ trimLow: 100, trimHigh: 8000 }).trimLow, 100);
  assert.equal(g({ trimLow: 100, trimHigh: 8000 }).trimHigh, 8000);
  assert.equal(g({ trimLow: 100 }).trimHigh, undefined);
  for (const bad of [{ trimLow: 0 }, { trimLow: -5 }, { trimLow: 200000 }, { trimLow: NaN }, { trimLow: "100" }, { trimHigh: 0.5 }, { trimLow: 500, trimHigh: 500 }, { trimLow: 900, trimHigh: 100 }]) {
    const out = g(bad);
    assert.ok(!("trimLow" in out) && !("trimHigh" in out), JSON.stringify(bad));
  }
  assert.deepEqual(Object.keys(g({})).sort(), ["fmax", "fmin", "fraction", "mode"]);
});

test("a trim round-trips through save and load", () => {
  const d = tilt(withGrid({ trimLow: 63, trimHigh: 10000 }));
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(evaluate(back), evaluate(d));
});

test("export checks: a trim that doesn't make sense blocks export with a message", () => {
  for (const [grid, re] of [[{ trimLow: 0.5 }, /Low trim must be between/], [{ trimHigh: 200000 }, /High trim must be between/], [{ trimLow: 1000, trimHigh: 100 }, /below high trim/], [{ trimLow: 100, trimHigh: 100 }, /below high trim/]]) {
    const r = buildCrv(tilt(withGrid(grid)));
    assert.equal(r.text, null, JSON.stringify(grid));
    assert.ok(r.issues.some((i) => re.test(i.message)), JSON.stringify(r.issues));
  }
  assert.ok(buildCrv(tilt(withGrid({ trimLow: 100, trimHigh: 1000 }))).text);
  // too narrow to hold two points
  assert.equal(buildCrv(tilt(withGrid({ trimLow: 101, trimHigh: 103 }))).text, null);
});

test("Reset to imported clears the trim, and the trim never touches an untrimmed import", () => {
  const text = readFileSync("reference/samples/user_LA_7dB_at_315k.crv", "utf8");
  const { doc } = docFromImport(text, "x.crv");
  doc.grid.trimLow = 200;
  doc.grid.trimHigh = 1000;
  assert.notEqual(buildCrv(doc).text, text);
  assert.equal(buildCrv(resetToImport(doc)).text, text);
  assert.equal(resetToImport(doc).grid.trimLow, undefined);
});

test("makeGrid itself is unchanged by trim fields (they are applied in evaluate)", () => {
  assert.deepEqual(makeGrid({ fraction: 3, fmin: 20, fmax: 20000, trimLow: 100 }), makeGrid({ fraction: 3, fmin: 20, fmax: 20000 }));
});

// ---- from the independent check: a single trim past the opposite end of the grid
test("a lone trim past the other end of the grid leaves an empty range and blocks export, in every grid mode", () => {
  for (const mode of ["resample", "simplified"]) {
    for (const trim of [{ trimLow: 25000 }, { trimHigh: 10 }]) {
      const d = tilt(withGrid({ mode, epsilon: 0.1, ...trim }));
      assert.deepEqual(evaluate(d), [], `${mode} ${JSON.stringify(trim)}`);
      const r = buildCrv(d);
      assert.equal(r.text, null);
      assert.ok(r.issues.some((i) => /trim leaves no frequency range/.test(i.message)), JSON.stringify(r.issues));
      assert.ok(!r.issues.some((i) => /Grid needs/.test(i.message)), "no confusing grid message");
    }
  }
  // the edge of the grid is still fine
  assert.ok(buildCrv(tilt(withGrid({ mode: "simplified", epsilon: 0.1, trimLow: 19999 }))).text);
  // keep-original: a trim past all the imported points just leaves no points
  const { doc } = docFromImport(readFileSync("reference/samples/user_LA_7dB_at_315k.crv", "utf8"), "x.crv");
  doc.grid.trimLow = 50000;
  assert.deepEqual(evaluate(doc), []);
  assert.equal(buildCrv(doc).text, null);
});
