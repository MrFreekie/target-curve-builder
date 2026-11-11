import { test } from "node:test";
import assert from "node:assert/strict";
import { SHAPES, DOG_OUTLINE, shapeDb } from "../js/eq.js";
import { layerDb } from "../js/layers.js";
import { evaluate, keyFrequencies } from "../js/curve.js";
import { newDoc, newLayer, loadDoc } from "../js/doc.js";
import { BUILT_IN_PRESETS } from "../js/presets.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/app.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const dog = (o = {}) => ({ kind: "shape", on: true, shape: "dog", fc: 1000, width: 8, db: 12, flat: 0.5, count: 3, ...o });
const at = (u, o = {}) => layerDb(1000 * 2 ** (u * 4), dog(o), 0); // width 8 octaves: u * 4 octaves from the centre

test("the dog is a shape with a label, in the Shape layer", () => {
  assert.ok(Object.hasOwn(SHAPES, "dog"));
  assert.match(SHAPES.dog.label, /Dog/);
  assert.ok(!SHAPES.dog.countLabel);
  assert.doesNotThrow(() => loadDoc({ version: 1, layers: [dog()] }));
});

test("the outline is a valid skyline: u strictly ascending from -1 to +1, heights between 0 and 1", () => {
  assert.equal(DOG_OUTLINE[0][0], -1);
  assert.equal(DOG_OUTLINE.at(-1)[0], 1);
  for (let i = 1; i < DOG_OUTLINE.length; i++) assert.ok(DOG_OUTLINE[i][0] > DOG_OUTLINE[i - 1][0], `vertex ${i}`);
  for (const [, g] of DOG_OUTLINE) assert.ok(g > 0 && g <= 1);
  assert.ok(DOG_OUTLINE.length >= 15 && DOG_OUTLINE.length <= 25);
});

test("every vertex of the outline is hit exactly, scaled by the height", () => {
  for (const [u, g] of DOG_OUTLINE) close(at(u), 12 * g, 1e-9, `u = ${u}`);
  for (const [u, g] of DOG_OUTLINE) close(at(u, { db: -7.5 }), -7.5 * g, 1e-9, `u = ${u}, negative`);
});

test("between vertices it is a straight line, and it is zero outside the base width", () => {
  for (let i = 1; i < DOG_OUTLINE.length; i++) {
    const [u0, g0] = DOG_OUTLINE[i - 1], [u1, g1] = DOG_OUTLINE[i];
    close(at((u0 + u1) / 2), 12 * (g0 + g1) / 2, 1e-9, `midpoint ${i}`);
  }
  for (const u of [-1.0001, -2, 1.0001, 3]) assert.equal(at(u), 0, `u = ${u}`);
  for (const f of [1, 20, 60, 17000, 1e9, 1e300]) assert.equal(layerDb(f, dog(), 0) + 0, 0, `${f} Hz is outside 62.5 Hz to 16 kHz`);
});

test("it reads as a dog: ear is the tallest point, the head is higher than the back, the tail sticks up", () => {
  const g = (u) => shapeDb("dog", 1000 * 2 ** (u * 4), 1000, 8, 1);
  const samples = [...Array(401)].map((_, i) => -1 + i / 200);
  const tallest = samples.reduce((b, u) => (g(u) > g(b) ? u : b), -1);
  close(tallest, 0.14, 1e-9, "tallest point is the ear tip");
  assert.ok(g(0.14) > g(-0.5) + 0.5, "ear above the back");
  assert.ok(g(0.3) > g(-0.55), "forehead above the back");
  assert.ok(g(-0.94) > g(-0.8) + 0.2, "tail tip above the rump");
  assert.ok(g(0.96) < g(0.3), "the snout slopes down to the nose");
});

test("the dog is a corner-for-corner polyline: breakpoints export is its vertices, with few points", () => {
  const k = keyFrequencies([dog()]);
  const near = (f) => k.some((x) => Math.abs(x / f - 1) < 1e-12);
  for (const [u] of DOG_OUTLINE) assert.ok(near(1000 * 2 ** (u * 4)), `vertex u = ${u}`);
  const d = newDoc();
  d.layers.push(dog());
  // a tight tolerance keeps even the vertices where the outline is nearly straight (at 0.05 dB the simplifier
  // may drop those, which is what the tolerance allows)
  d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.001 };
  const r = buildCrv(d);
  assert.ok(r.text, JSON.stringify(r.issues));
  assert.ok(r.points.length <= 40, `${r.points.length} points`);
  const have = (f) => r.points.find(([x]) => Math.abs(x / f - 1) < 1e-6);
  for (const [u, g] of DOG_OUTLINE) assert.ok(have(1000 * 2 ** (u * 4)) && Math.abs(have(1000 * 2 ** (u * 4))[1] - 12 * g) < 2e-6, `vertex ${u} exported`);
});

test("invert gives an upside-down dog; groups and ghosts treat it like any layer", () => {
  for (const [u] of DOG_OUTLINE) close(at(u, { invert: true }), -at(u), 0, `inverted at ${u}`);
  const d = newDoc();
  d.layers.push({ ...dog(), group: 1 });
  const shown = evaluate(d);
  d.groups[0].on = false;
  assert.notDeepEqual(evaluate(d), shown);
});

test("name suggestion and the built-in Dog preset", () => {
  const n = newDoc();
  n.layers.push({ id: "d", ...dog({ db: 12, width: 8 }) });
  assert.equal(suggestName(n), "Dog+12dB_1000Hz_8oct");
  const p = BUILT_IN_PRESETS.find((x) => /^Dog/.test(x.name));
  assert.ok(p, "preset exists");
  const doc = p.build();
  assert.equal(doc.props.name, "Dog");
  assert.match(doc.props.color, /^[0-9a-f]{8}$/);
  const r = buildCrv(doc);
  assert.ok(r.text, JSON.stringify(r.issues));
  assert.ok(r.points.length <= 40, `${r.points.length} points`);
  // the preset's tallest point is the ear tip: 12 dB * 0.95
  close(Math.max(...r.points.map(([, g]) => g)), 12 * 0.95, 2e-6, "ear tip");
  assert.equal(loadDoc(JSON.parse(JSON.stringify(doc))).layers.at(-1).shape, "dog");
});
