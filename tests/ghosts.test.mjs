import { test } from "node:test";
import assert from "node:assert/strict";
import { layerGhosts, totalDb, denseGrid } from "../js/curve.js";
import { layerDb } from "../js/layers.js";
import { newDoc, newLayer } from "../js/doc.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

function sample() {
  const d = newDoc();
  d.layers.find((l) => l.kind === "lfTilt").on = true;
  d.layers.find((l) => l.kind === "hpf").on = true;
  for (const kind of ["bell", "shape", "weighting", "subBoost"]) d.layers.push(newLayer(kind));
  d.layers.find((l) => l.kind === "weighting").invert = true;
  return d;
}

test("only enabled layers get a ghost, in layer order, with their list position", () => {
  const d = sample();
  const g = layerGhosts(d);
  const enabled = d.layers.map((l, i) => [l, i]).filter(([l]) => l.on);
  assert.deepEqual(g.map((x) => x.id), enabled.map(([l]) => l.id));
  assert.deepEqual(g.map((x) => x.index), enabled.map(([, i]) => i));
  assert.ok(!g.some((x) => d.layers.find((l) => l.id === x.id && !l.on)));
  d.layers.find((l) => l.kind === "bell").on = false;
  assert.equal(layerGhosts(d).length, g.length - 1);
});

test("every ghost point is that layer's own value, with inversion, on the dense 20 Hz to 20 kHz grid", () => {
  const d = sample();
  const freqs = denseGrid({ grid: { fmin: 20, fmax: 20000 }, layers: d.layers });
  for (const gh of layerGhosts(d)) {
    const layer = d.layers[gh.index];
    assert.deepEqual(gh.points.map((p) => p[0]), freqs);
    gh.points.forEach(([f, g]) => assert.equal(g, layerDb(f, layer) + 0, `${gh.kind} at ${f}`));
  }
  const w = layerGhosts(d).find((x) => x.kind === "weighting");
  const plain = { ...d.layers[w.index], invert: false };
  w.points.forEach(([f, g]) => close(g, -layerDb(f, plain), 0, "inverted ghost"));
});

test("the ghosts add up to the total (no normalise), at every point", () => {
  const d = sample();
  const ghosts = layerGhosts(d);
  ghosts[0].points.forEach(([f], i) => {
    const sum = ghosts.reduce((acc, gh) => acc + gh.points[i][1], 0);
    close(sum, totalDb(f, d.layers), 1e-9, `at ${f} Hz`);
  });
});

test("ghosts are finite, never -0, and layers that can't evaluate are skipped", () => {
  const d = sample();
  for (const gh of layerGhosts(d)) assert.ok(gh.points.every(([, g]) => Number.isFinite(g) && !Object.is(g, -0)), gh.kind);
  d.layers.push({ id: "bad", kind: "hpf", on: true, fc: 50, type: "XX", slope: 24 });
  assert.ok(!layerGhosts(d).some((x) => x.id === "bad"));
  d.layers.push({ id: "worse", kind: "nope", on: true });
  assert.ok(!layerGhosts(d).some((x) => x.id === "worse"));
});

test("a document with nothing switched on has no ghosts, and the dense grid includes layer corners", () => {
  const d = newDoc();
  assert.equal(layerGhosts(d).filter((g) => d.layers[g.index].kind !== "points").length, 0);
  const s = newDoc();
  s.layers.push({ id: "s", kind: "shape", on: true, shape: "box", fc: 1000, width: 2, db: 6, flat: 0.5, count: 3 });
  const box = layerGhosts(s).find((g) => g.id === "s");
  const at = (f) => box.points.find(([x]) => Math.abs(x / f - 1) < 1e-9)?.[1];
  assert.equal(at(500), 6);
  assert.equal(at(2000), 6);
});

test("a layer too broken to list its corners gives no ghosts instead of throwing", () => {
  const d = newDoc();
  d.layers.push({ id: "p", kind: "points", on: true, points: null });
  assert.deepEqual(layerGhosts(d), []);
});
