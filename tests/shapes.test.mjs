import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeDb, SHAPES } from "../js/eq.js";
import { layerDb } from "../js/layers.js";
import { evaluate, keyFrequencies } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, LAYER_KINDS } from "../js/doc.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/app.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
// shapes that are symmetric bumps: full height in the middle, zero at and beyond the edges
const BUMPS = ["pyramid", "box", "semicircle", "trapezoid", "cosine", "parabola"];
const at = (shape, oct, extra = {}) => layerDb(1000 * 2 ** oct, { kind: "shape", shape, fc: 1000, width: 4, db: 6, flat: 0.5, ...extra }, 0);

test("every shape: full height at the centre, zero outside the base width", () => {
  for (const s of BUMPS) {
    close(at(s, 0), 6, 1e-12, `${s} centre`);
    for (const o of [-10, -3, -2.0001, 2.0001, 3, 10]) assert.equal(at(s, o), 0, `${s} at ${o} octaves`);
  }
});

test("pyramid is a straight triangle in dB against log frequency", () => {
  for (const [o, v] of [[0, 6], [0.5, 4.5], [1, 3], [1.5, 1.5], [2, 0], [-1, 3], [-0.5, 4.5]]) close(at("pyramid", o), v, 1e-12, `pyramid at ${o}`);
});

test("box is flat inside including its edges, and drops to zero outside", () => {
  for (const o of [-2, -1.99, -1, 0, 1, 1.99, 2]) close(at("box", o), 6, 0, `box at ${o}`);
  for (const o of [-2.01, 2.01]) assert.equal(at("box", o), 0);
  close(at("box", 0, { db: -9 }), -9, 0, "box dip");
});

test("half circle: sqrt(1 - u^2), with the vertical edge tangents at +/- half the width", () => {
  for (const [o, v] of [[0, 6], [1, 6 * Math.sqrt(0.75)], [1.6, 6 * Math.sqrt(1 - 0.64)], [2, 0], [-1, 6 * Math.sqrt(0.75)]]) close(at("semicircle", o), v, 1e-12, `at ${o}`);
  // points on the circle: (u, y/db) satisfy u^2 + y^2 = 1
  for (const o of [0.2, 0.9, 1.3, 1.8]) {
    const u = o / 2, y = at("semicircle", o) / 6;
    close(u * u + y * y, 1, 1e-12, `circle at ${o}`);
  }
});

test("trapezoid: flat top over the middle `flat` fraction, straight flanks, flat 0 is a pyramid", () => {
  const t = (o, flat) => at("trapezoid", o, { flat });
  for (const o of [-1, -0.5, 0, 0.5, 1]) close(t(o, 0.5), 6, 1e-12, `flat top at ${o}`);
  close(t(1.5, 0.5), 3, 1e-12, "halfway down the flank");
  close(t(2, 0.5), 0, 1e-12, "edge");
  for (const o of [0, 0.5, 1, 1.5, 2]) close(t(o, 0), at("pyramid", o), 1e-12, `flat 0 equals pyramid at ${o}`);
  close(t(1.9, 0.99), 6, 1e-9, "a very wide flat top stays at full height until 0.99 of the half width");
});

test("cosine bump: raised cosine, smooth edges (zero slope at the edge and the centre)", () => {
  close(at("cosine", 1), 3, 1e-12, "half height at half of the half width");
  close(at("cosine", 2), 0, 1e-12, "edge");
  const eps = 1e-5;
  close((at("cosine", 2 - eps) - at("cosine", 2)) / eps, 0, 1e-3, "flat at the edge");
  close((at("cosine", eps) - at("cosine", 0)) / eps, 0, 1e-3, "flat at the centre");
});

test("shapes are symmetric in log frequency and negative heights are exact mirrors", () => {
  for (const s of BUMPS) {
    for (const o of [0.1, 0.7, 1.3, 1.9]) {
      close(at(s, o), at(s, -o), 1e-12, `${s} symmetry at ${o}`);
      close(at(s, o, { db: -6 }), -at(s, o), 1e-12, `${s} mirror at ${o}`);
    }
  }
});

test("shapeDb rejects unknown or prototype shape names, and never returns NaN", () => {
  for (const bad of ["Z", "constructor", "toString", "__proto__", "", null, ["box"], 5]) assert.throws(() => shapeDb(bad, 1000, 1000, 2, 6), RangeError, String(bad));
  for (const s of Object.keys(SHAPES)) for (const f of [1e-300, 1, 20, 1e9, 1e300]) assert.ok(Number.isFinite(shapeDb(s, f, 1000, 2, 6)), `${s} ${f}`);
});

test("corner frequencies for the breakpoints grid include the shape's edges and flat-top ends", () => {
  const near = (list, f) => list.some((x) => Math.abs(x / f - 1) < 1e-12);
  const k = keyFrequencies([{ kind: "shape", shape: "pyramid", on: true, fc: 1000, width: 2, db: 6, flat: 0.5 }]);
  for (const f of [1000, 500, 2000]) assert.ok(near(k, f), `pyramid ${f}`);
  const t = keyFrequencies([{ kind: "shape", shape: "trapezoid", on: true, fc: 1000, width: 4, db: 6, flat: 0.5 }]);
  for (const f of [1000, 250, 4000, 500, 2000]) assert.ok(near(t, f), `trapezoid ${f}`);
});

test("breakpoints export of a pyramid is its three corners and the box is its edges", () => {
  const d = newDoc();
  d.layers.push({ id: "s", kind: "shape", on: true, shape: "pyramid", fc: 1000, width: 2, db: 6, flat: 0.5 });
  d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.01 };
  const pts = buildCrv(d).points;
  const pick = (f) => pts.find(([x]) => Math.abs(x / f - 1) < 1e-6);
  assert.deepEqual([pick(500)?.[1], pick(1000)?.[1], pick(2000)?.[1]], [0, 6, 0]);
  assert.ok(pts.length <= 7, `${pts.length} points`);
});

test("shape layer: newLayer, loadDoc round trip, limits, validation, export, name", () => {
  assert.ok(Object.hasOwn(LAYER_KINDS, "shape"));
  const l = newLayer("shape");
  assert.deepEqual({ shape: l.shape, fc: l.fc, width: l.width, db: l.db, flat: l.flat }, { shape: "pyramid", fc: 1000, width: 2, db: 6, flat: 0.5 });
  const d = newDoc();
  d.layers.push(l);
  assert.ok(buildCrv(d).text);
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.layers.at(-1), { ...l, id: back.layers.at(-1).id });
  const bad = [{ shape: "blob" }, { shape: "constructor" }, { fc: 0 }, { width: 0.05 }, { width: 11 }, { db: 61 }, { flat: 1 }, { flat: -0.1 }];
  for (const o of bad) {
    assert.throws(() => loadDoc({ version: 1, layers: [{ ...l, ...o }] }), Error, JSON.stringify(o));
    const e = newDoc();
    e.layers.push({ ...l, ...o });
    if (!("flat" in o) || o.shape === undefined) {
      const r = buildCrv(e);
      if (!("flat" in o)) assert.equal(r.text, null, JSON.stringify(o));
    }
  }
  const named = newDoc();
  named.layers.push({ id: "n", kind: "shape", on: true, shape: "semicircle", fc: 63, width: 1.5, db: -6, flat: 0.5 });
  assert.equal(suggestName(named), "HalfCircle-6dB_63Hz_1.5oct");
  named.layers.at(-1).invert = true;
  assert.equal(suggestName(named), "InvHalfCircle-6dB_63Hz_1.5oct");
});

// ---- the other fun shapes (SPEC §4.4g): parabola, ramps, sine wave, square wave, staircase
test("parabola: 1 - u^2", () => {
  for (const [o, v] of [[0, 6], [1, 4.5], [1.5, 6 * (1 - 0.5625)], [2, 0], [-1, 4.5]]) close(at("parabola", o), v, 1e-12, `at ${o}`);
});

test("ramps: rise or fall straight across the base, jump to zero at the far edge", () => {
  for (const [o, up, down] of [[-2, 0, 6], [-1, 1.5, 4.5], [0, 3, 3], [1, 4.5, 1.5], [2, 6, 0]]) {
    close(at("rampUp", o), up, 1e-12, `ramp up at ${o}`);
    close(at("rampDown", o), down, 1e-12, `ramp down at ${o}`);
  }
  assert.equal(at("rampUp", 2.01), 0);
  assert.equal(at("rampDown", -2.01), 0);
  for (const o of [0.3, 1.1, 1.8]) close(at("rampUp", o), at("rampDown", -o), 1e-12, "mirror images of each other");
});

test("sine wave: `cycles` full cycles across the base, starting at zero and rising", () => {
  // width 4 octaves: edges at -2 and +2; t = (oct + 2) / 4
  for (const [cycles, oct, v] of [[1, -2, 0], [1, -1, 6], [1, 0, 0], [1, 1, -6], [1, 2, 0], [2, -1.5, 6], [2, -0.5, -6], [2, 0.5, 6], [0.5, 0, 6]]) {
    close(at("sine", oct, { count: cycles }), v, 1e-9, `${cycles} cycles at ${oct}`);
  }
  // three cycles: the middle is a zero crossing, and an eighth of the way in the angle is 2 pi * 3 / 8 = 3 pi / 4
  close(at("sine", 0, { count: 3 }), 0, 1e-9, "three cycles, middle");
  close(at("sine", -1.5, { count: 3 }), 6 * Math.sin(0.75 * Math.PI), 1e-12, "three cycles, an eighth in");
});

test("square wave: alternates +db and -db, starts positive, jumps at the half cycles", () => {
  assert.equal(at("square", -1.9, { count: 1 }), 6);
  assert.equal(at("square", -0.1, { count: 1 }), 6);
  assert.equal(at("square", 0.1, { count: 1 }), -6);
  assert.equal(at("square", 1.9, { count: 1 }), -6);
  assert.deepEqual([-1.5, -0.5, 0.5, 1.5].map((o) => at("square", o, { count: 2 })), [6, -6, 6, -6]);
});

test("staircase: `steps` equal-width levels rising from 0 to the full height", () => {
  // 4 steps over 4 octaves: levels 0, 1/3, 2/3, 1 of the height, each 1 octave wide
  assert.deepEqual([-1.5, -0.5, 0.5, 1.5].map((o) => at("stairs", o, { count: 4 })).map((v) => +v.toFixed(9)), [0, 2, 4, 6]);
  assert.deepEqual([-1.5, 1.5].map((o) => at("stairs", o, { count: 2 })), [0, 6]);
  // counts round to whole steps, and fewer than 2 count as 2
  assert.equal(at("stairs", 1.5, { count: 0.5 }), 6);
  assert.equal(at("stairs", 0.5, { count: 3.4 }), at("stairs", 0.5, { count: 3 }));
});

test("the new shapes are zero outside the base width, mirror for negative heights, and finite", () => {
  for (const s of ["parabola", "rampUp", "rampDown", "sine", "square", "stairs"]) {
    for (const o of [-10, -2.0001, 2.0001, 10]) assert.equal(at(s, o), 0, `${s} at ${o}`);
    for (const o of [-1.7, -0.4, 0.9, 1.6]) close(at(s, o, { db: -6 }), -at(s, o), 1e-12, `${s} mirror at ${o}`);
    for (const f of [1e-300, 1, 1e9, 1e300]) assert.ok(Number.isFinite(shapeDb(s, f, 1000, 4, 6)), `${s} ${f}`);
  }
  assert.ok(Object.is(at("sine", 0, { count: 1 }) + 0, 0) || Math.abs(at("sine", 0, { count: 1 })) < 1e-12);
});

test("corners: the jumps of the square wave and staircase are included for the breakpoints grid", () => {
  const near = (list, f) => list.some((x) => Math.abs(x / f - 1) < 1e-9);
  const sq = keyFrequencies([{ kind: "shape", shape: "square", on: true, fc: 1000, width: 4, db: 6, count: 2 }]);
  for (const o of [-2, -1, 0, 1, 2]) assert.ok(near(sq, 1000 * 2 ** o), `square at ${o}`);
  const st = keyFrequencies([{ kind: "shape", shape: "stairs", on: true, fc: 1000, width: 4, db: 6, count: 4 }]);
  for (const o of [-2, -1, 0, 1, 2]) assert.ok(near(st, 1000 * 2 ** o), `stairs at ${o}`);
});

test("count is stored, limited 0.5 to 16, defaults to 3, and checked at export", () => {
  const l = newLayer("shape");
  assert.equal(l.count, 3);
  assert.equal(loadDoc({ version: 1, layers: [{ ...l, shape: "sine", count: 5 }] }).layers[0].count, 5);
  assert.equal(loadDoc({ version: 1, layers: [{ ...l, count: undefined }] }).layers[0].count, 3);
  for (const count of [0.4, 17, NaN, "x"]) assert.throws(() => loadDoc({ version: 1, layers: [{ ...l, shape: "sine", count }] }), Error, String(count));
  const d = newDoc();
  d.layers.push({ ...l, shape: "sine", count: 40 });
  assert.equal(buildCrv(d).text, null);
  d.layers.at(-1).count = 4;
  assert.ok(buildCrv(d).text);
  const named = newDoc();
  named.layers.push({ id: "n", kind: "shape", on: true, shape: "stairs", fc: 250, width: 3, db: 4, count: 5 });
  assert.equal(suggestName(named), "Stairs+4dB_250Hz_3oct_5steps");
  named.layers.at(-1).shape = "sine";
  assert.equal(suggestName(named), "Sine+4dB_250Hz_3oct_5cyc");
  named.layers.at(-1).shape = "rampUp";
  assert.equal(suggestName(named), "RampUp+4dB_250Hz_3oct");
});

// ---- from the independent check
test("square wave corners cover every jump even when 2 x cycles is not a whole number", () => {
  const near = (list, f) => list.some((x) => Math.abs(x / f - 1) < 1e-9);
  const k = (count) => keyFrequencies([{ kind: "shape", shape: "square", on: true, fc: 1000, width: 2, db: 6, count }]);
  assert.ok(near(k(0.75), 1000 * 2 ** (1 * (2 / 3 * 2 - 1))), "count 0.75: jump at t = 2/3");
  // count 3.3: jumps at t = k / 6.6 for k = 1 to 6 (6 of them), plus the two edges and the centre
  for (let j = 1; j <= 6; j++) assert.ok(near(k(3.3), 1000 * 2 ** (2 * (j / 6.6) - 1)), `count 3.3, jump ${j}`);
});

test("trapezoid without a flat value uses the default 0.5 everywhere, including export checks", () => {
  const d = newDoc();
  d.layers.push({ id: "t", kind: "shape", on: true, shape: "trapezoid", fc: 1000, width: 4, db: 6 });
  assert.ok(buildCrv(d).text);
});

// ---- edges: floating-point noise and 6-decimal rounding must not drop the edge value
test("a frequency exactly on a shape edge keeps its edge value, even with floating-point noise", () => {
  for (const [fc, width] of [[331.48922, 2.6135], [1000, 8], [63, 1.7], [4200.123, 5.5], [20.5, 0.9]]) {
    const lo = fc * 2 ** (-width / 2), hi = fc * 2 ** (width / 2);
    for (const f of [lo, hi]) {
      assert.equal(shapeDb("box", f, fc, width, 6), 6, `box edge ${f}`);
    }
  }
});

test("breakpoints exports keep the edge vertices of box shapes at random centres and widths", () => {
  for (let i = 0; i < 200; i++) {
    const fc = 80 + ((i * 7919) % 5000) + (i % 13) * 0.37, width = 1 + ((i * 31) % 70) / 10 + 0.013 * (i % 7);
    for (const shape of ["box"]) {
      const d = newDoc();
      d.layers.push({ id: "s", kind: "shape", on: true, shape, fc, width, db: 12, flat: 0.5, count: 3 });
      d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.001 };
      const pts = evaluate(d);
      const lowEdge = fc * 2 ** (-width / 2), highEdge = fc * 2 ** (width / 2);
      if (lowEdge < 21 || highEdge > 19900) continue;
      const first = pts.find(([f]) => f >= lowEdge * (1 - 1e-5));
      const last = [...pts].reverse().find(([f]) => f <= highEdge * (1 + 1e-5));
      const want = [12, 12];
      close(first[1], want[0], 2e-5, `${shape} low edge at fc ${fc} width ${width}`);
      close(last[1], want[1], 2e-5, `${shape} high edge at fc ${fc} width ${width}`);
    }
  }
});
