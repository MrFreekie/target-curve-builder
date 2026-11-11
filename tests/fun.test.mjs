import test from "node:test";
import assert from "node:assert/strict";
import { shapeDb, FIN_TIP_T } from "../js/eq.js";
import { keyFrequencies } from "../js/curve.js";
import { BUILT_IN_PRESETS } from "../js/presets.js";
import { loadDoc } from "../js/doc.js";
import { NOMINAL_3 } from "../js/curve.js";

const fin = (o, db = 10) => shapeDb("fin", 1000 * 2 ** o, 1000, 4, db);

test("shark fin: 0 at both edges, peak at the tip, steeper drop than rise", () => {
  assert.equal(fin(-2), 0);
  assert.ok(Math.abs(fin(2)) < 1e-9);
  const tipO = 2 * (2 * FIN_TIP_T - 1); // octaves from the centre
  assert.ok(Math.abs(fin(tipO) - 10) < 1e-9);
  assert.equal(fin(2.01), 0);
  assert.ok(fin(tipO + 0.3) < fin(tipO - 0.3), "falls faster than it rises");
  assert.ok(fin(-2 * 0.5) > 0 && fin(tipO - 0.01) < 10);
});

test("shark fin: the tip is a layer corner", () => {
  const f = keyFrequencies([{ kind: "shape", shape: "fin", on: true, fc: 1000, width: 4, db: 10 }]);
  const tip = 1000 * 2 ** (2 * (2 * FIN_TIP_T - 1));
  assert.ok(f.some((x) => Math.abs(x / tip - 1) < 1e-12));
});

test("fun presets load, are valid and have the shapes they promise", () => {
  const names = ["Skyline", "Heartbeat", "Mountain range", "Castle"];
  for (const n of names) {
    const p = BUILT_IN_PRESETS.find((b) => b.name.startsWith(n));
    assert.ok(p, n);
    const d = loadDoc(JSON.parse(JSON.stringify(p.build())));
    const pts = d.layers.find((l) => l.kind === "points").points;
    assert.ok(pts.every((q, i) => i === 0 || q[0] > pts[i - 1][0]), `${n}: ascending frequencies`);
    assert.ok(pts.every(([f]) => !NOMINAL_3.some((n) => Math.abs(n - f) < 1e-9) || f === 20 || f === 20000), `${n}: no point on a nominal label`);
    assert.ok(pts[0][0] >= 20 && pts.at(-1)[0] <= 20000);
    const peak = Math.max(...pts.map((q) => q[1]));
    assert.ok(peak >= 10 && peak <= 15, `${n} peak ${peak}`);
  }
  const heart = BUILT_IN_PRESETS.find((b) => b.name.startsWith("Heartbeat")).build();
  const ys = heart.layers.find((l) => l.kind === "points").points.map((q) => q[1]);
  assert.ok(Math.min(...ys) < 0, "heartbeat has a dip");
});
