import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, simplify, pos, makeGrid } from "../js/curve.js";
import { interpPoints } from "../js/layers.js";
import { newDoc, loadDoc } from "../js/doc.js";
import { buildCrv } from "../js/build.js";

const layer = (d, k) => d.layers.find((l) => l.kind === k);
const on = (d, k, extra = {}) => Object.assign(layer(d, k), { on: true }, extra);
const simp = (d, eps) => { d.grid = { mode: "simplified", fraction: 12, fmin: 20, fmax: 20000, epsilon: eps }; return d; };

/** Largest error of straight lines (against octave position) through `pts` versus the true curve. */
function maxError(d, pts) {
  const truth = evaluate({ ...d, grid: { mode: "resample", fraction: 48, fmin: 20, fmax: 20000 } });
  const lin = [...pts].map(([f, g]) => [f, g]);
  let worst = 0;
  for (const [f, g] of truth) worst = Math.max(worst, Math.abs(interpPoints(f, lin) - g));
  return worst;
}

test("a straight line between two points needs only its end points", () => {
  const line = [[100, 0], [200, 3], [400, 6], [800, 9]];
  assert.deepEqual(simplify(line, 0.01), [[100, 0], [800, 9]]);
});

test("simplify keeps the ends, stays ascending, never mutates its input", () => {
  const pts = makeGrid({ fraction: 12 }).map((f) => [f, Math.sin(pos(f)) * 6]);
  const copy = JSON.stringify(pts);
  const out = simplify(pts, 0.2);
  assert.equal(JSON.stringify(pts), copy);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out.at(-1), pts.at(-1));
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0]);
  assert.ok(out.length < pts.length);
});

test("exported breakpoints stay within the chosen error of the true curve", () => {
  for (const eps of [0.5, 0.1, 0.02]) {
    const d = simp(newDoc(), eps);
    on(d, "lfTilt");
    on(d, "hpf", { fc: 32, type: "LR", slope: 48 });
    on(d, "lpf", { fc: 16000, type: "BW", slope: 12 });
    const out = evaluate(d);
    assert.ok(maxError(d, out) <= eps + 1e-6, `eps ${eps}: ${maxError(d, out)}`);
    assert.ok(out.length < 120, `${out.length} points`);
  }
});

test("a smaller error keeps more points", () => {
  const counts = [0.5, 0.1, 0.02].map((e) => {
    const d = simp(newDoc(), e);
    on(d, "hpf", { fc: 50, type: "LR", slope: 48 });
    return evaluate(d).length;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], counts.join(","));
});

test("a points layer comes out as its own corners, at the frequencies typed", () => {
  const d = simp(newDoc(), 0.1);
  layer(d, "points").points = [[63, 7], [315, 0], [20000, 0]];
  assert.deepEqual(evaluate(d), [[20, 7], [63, 7], [315, 0], [20000, 0]]);
});

test("tilt corners are kept exactly", () => {
  // 0.1 dB: nominal frequencies snap in pos() (SPEC §3.1), which makes tiny wiggles near 40 Hz
  // that a tighter limit would keep as extra points.
  const d = simp(newDoc(), 0.1);
  on(d, "lfTilt", { dbPerOct: 3, pivot: 1000, floor: 40 });
  const out = evaluate(d);
  assert.deepEqual(out.map((p) => p[0]), [20, 40, 1000, 20000]);
  assert.deepEqual(out.map((p) => p[1]), [14, 14, 0, 0]);
});

test("normalise and rounding still apply; no -0", () => {
  const d = simp(newDoc(), 0.05);
  on(d, "fullTilt", { dbPerOct: 2, pivot: 500 });
  d.normalise = { on: true, at: 1000 };
  const out = evaluate(d);
  assert.ok(Math.abs(interpPoints(1000, out)) < 1e-5, "0 dB at the normalise frequency");
  for (const [, g] of out) assert.ok(!Object.is(g, -0) && g === Math.round(g * 1e6) / 1e6);
});

test("evaluate with explicit frequencies is never simplified", () => {
  const d = simp(newDoc(), 5);
  on(d, "lfTilt");
  assert.equal(evaluate(d, [20, 25, 31.5, 40, 50]).length, 5);
});

test("fmin and fmax are always the first and last points; frequencies unique and ascending", () => {
  const d = simp(newDoc(), 0.3);
  d.grid.fmin = 25; d.grid.fmax = 12000;
  on(d, "hpf", { fc: 40, type: "BW", slope: 24 });
  const out = evaluate(d);
  assert.equal(out[0][0], 25);
  assert.equal(out.at(-1)[0], 12000);
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0]);
});

test("export works through buildCrv, validates epsilon, and survives loadDoc", () => {
  const d = simp(newDoc(), 0.1);
  on(d, "lfTilt");
  const r = buildCrv(d);
  assert.ok(r.text && r.points.length < 40);
  assert.ok(buildCrv(d, "smaart-ascii").text);
  d.grid.epsilon = 0;
  assert.equal(buildCrv(d).text, null);
  d.grid.epsilon = 0.25;
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual([back.grid.mode, back.grid.simplify, back.grid.fraction], ["resample", true, 48], "the older simplified mode loads as breakpoints only on the 1/48 grid");
  assert.equal(back.grid.epsilon, 0.25);
  assert.equal(loadDoc({ ...JSON.parse(JSON.stringify(d)), grid: { mode: "simplified", epsilon: 1e9 } }).grid.epsilon, undefined);
});

test("missing or bad epsilon falls back to 0.1 dB", () => {
  const a = simp(newDoc(), undefined);
  const b = simp(newDoc(), 0.1);
  for (const d of [a, b]) on(d, "hpf");
  assert.deepEqual(evaluate(a), evaluate(b));
  const c = simp(newDoc(), "x");
  on(c, "hpf");
  assert.deepEqual(evaluate(c), evaluate(b));
});

// ---- regressions from the independent check (docs/SPEC.md §3.4)
test("a corner at a nominal label drops its 1/48 twin: no spurious spike at 100 Hz", () => {
  const d = simp(newDoc(), 0.01);
  layer(d, "points").points = [[100, 0], [100, 6], [1000, 6]];
  const out = evaluate(d);
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0]);
  // never goes 0 -> 6 -> 0 -> 6
  const values = out.map((p) => p[1]);
  const dips = values.filter((v, i) => i > 0 && i < values.length - 1 && v < values[i - 1] && v < values[i + 1]);
  assert.equal(dips.length, 0, JSON.stringify(out));
  assert.ok(!out.some(([f]) => f === 99.212566), "twin of the 100 Hz label");
});

test("every nominal label's twin is dropped when it is a corner", () => {
  for (const f of [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000]) {
    const d = simp(newDoc(), 0.001);
    layer(d, "points").points = [[f, 3], [20000, 0]];
    const out = evaluate(d).map((p) => p[0]);
    assert.ok(out.includes(f), `${f} kept`);
    const near = out.filter((x) => x !== f && Math.abs(Math.log2(x / f)) < 1 / 96 + 1e-3 && Math.abs(pos(x) - pos(f)) < 1e-6);
    assert.deepEqual(near, [], `${f}: twin ${near}`);
  }
});

test("typed fmax and corners within 1e-6 relative of a grid frequency are kept as typed", () => {
  const d = simp(newDoc(), 0.1);
  d.grid.fmax = 17959.4;
  assert.equal(evaluate(d).at(-1)[0], 17959.4);
  const p = simp(newDoc(), 0.1);
  layer(p, "points").points = [[1414.214, 3], [20000, 0]];
  assert.ok(evaluate(p).some(([f, g]) => f === 1414.214 && g === 3));
});

test("the error limit holds on the rounded exported values", () => {
  const d = simp(newDoc(), 0.5);
  d.grid.fmin = 101; d.grid.fmax = 404;
  layer(d, "points").points = [[101, 2 ** -21], [202, 0.5 + 2 ** -21], [404, 2 ** -21]];
  const out = evaluate(d);
  const dense = evaluate({ ...d, grid: { mode: "resample", fraction: 48, fmin: 101, fmax: 404 } });
  for (const [f, g] of dense) assert.ok(Math.abs(interpPoints(f, out) - g) <= 0.5 + 1e-9, `${f}`);
});

test("epsilon outside 0.001 to 12 or fmin below 1 Hz is not trusted", () => {
  const a = simp(newDoc(), 1e9), b = simp(newDoc(), 1e-12), c = simp(newDoc(), 0.1);
  for (const d of [a, b, c]) on(d, "hpf");
  assert.deepEqual(evaluate(a), evaluate(c));
  assert.deepEqual(evaluate(b), evaluate(c));
  assert.equal(loadDoc({ version: 1, layers: [], grid: { fmin: 1e-7 } }).grid.fmin, 20);
  assert.equal(loadDoc({ version: 1, layers: [], grid: { fmin: 5 } }).grid.fmin, 5);
});

test("grid points within 1e-6 relative of a corner are dropped, decided from the exact grid frequency", () => {
  // exact 1/48 grid frequency 38.8080566273 is 9.95e-7 relative from this corner; its rounded form would be 1.005e-6
  const d = simp(newDoc(), 0.001);
  layer(d, "points").points = [[38.808018, 3], [20000, 0]];
  const out = evaluate(d).map((p) => p[0]);
  assert.ok(out.includes(38.808018));
  assert.ok(!out.includes(38.808057), "twin within 1e-6 relative of the corner");
});
