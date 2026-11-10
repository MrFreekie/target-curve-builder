import { test } from "node:test";
import assert from "node:assert/strict";
import { round6, makeGrid, evaluate } from "../js/curve.js";

// Expected values are Python round(x, 6) results (half-to-even on exact ties).
test("round6 matches Python on ties and near-ties", () => {
  assert.equal(round6(0.0078125), 0.007812);
  assert.equal(round6(1.0078125), 1.007812);
  assert.equal(round6(-1.0234375), -1.023438);
  assert.equal(round6(-0.0000025), -0.000003);
  assert.equal(round6(3.0102995), 3.010299);
  assert.ok(Object.is(round6(-1e-9), 0));
});

test("makeGrid rejects bad input and accepts numeric strings", () => {
  assert.throws(() => makeGrid({ fraction: -3 }), RangeError);
  assert.throws(() => makeGrid({ fraction: 5 }), RangeError);
  assert.throws(() => makeGrid({ fmin: 0 }), RangeError);
  assert.throws(() => makeGrid({ fmin: 500, fmax: 100 }), RangeError);
  assert.deepEqual(makeGrid({ fraction: "3" }), makeGrid({ fraction: 3 }));
});

test("string slopes are accepted, on:0 disables, normalise.at defaults to 1000", () => {
  const hp = { kind: "hpf", on: true, fc: 50, type: "LR", slope: "48" };
  assert.doesNotThrow(() => evaluate({ grid: {}, layers: [hp] }));
  const off = evaluate({ grid: {}, layers: [{ kind: "gain", on: 0, db: 5 }] });
  assert.ok(off.every(([, g]) => g === 0));
  const n = evaluate({ grid: {}, layers: [{ kind: "fullTilt", on: true, dbPerOct: 2, pivot: 500 }], normalise: { on: true } });
  assert.equal(n.find(([f]) => f === 1000)[1], 0);
});
