import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBlank, addImportedLayer, docFromImport, newDoc, newLayer, loadDoc, resetToImport } from "../js/doc.js";
import { evaluate } from "../js/curve.js";
import { interpPoints } from "../js/layers.js";
import { buildCrv } from "../js/build.js";
import { suggestName } from "../js/naming.js";

const sample = (f) => readFileSync(`reference/samples/${f}`, "utf8");
const LA = sample("user_LA_7dB_at_315k.crv");
const TILT = sample("Tilt_3dBoct_1000Hz.crv");
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

test("isBlank: true only for an untouched new document", () => {
  assert.equal(isBlank(newDoc()), true);
  assert.equal(isBlank(newDoc()), true, "layer ids differ between documents but don't matter");
  const edits = [
    (d) => { d.props.name = "Mine"; },
    (d) => { d.props.color = "ff00ff00"; },
    (d) => { d.props.line = 4; },
    (d) => { d.props.tolerance = 2; },
    (d) => { d.layers.find((l) => l.kind === "lfTilt").on = true; },
    (d) => { d.layers.find((l) => l.kind === "points").points.push([1000, 1]); },
    (d) => { d.layers.find((l) => l.kind === "points").points[0][1] = 0.5; },
    (d) => { d.layers.push(newLayer("gain")); },
    (d) => { d.layers.pop(); },
    (d) => { d.grid.fraction = 6; },
    (d) => { d.grid.trimLow = 100; },
    (d) => { d.normalise.on = true; },
    (d) => { d.layers[0].invert = true; },
  ];
  for (const edit of edits) {
    const d = newDoc();
    edit(d);
    assert.equal(isBlank(d), false, edit.toString());
  }
  assert.equal(isBlank(docFromImport(LA, "a.crv").doc), false, "an imported curve is not blank");
  assert.equal(isBlank(loadDoc(JSON.parse(JSON.stringify(newDoc())))), true, "a saved blank document is still blank");
});

test("adding sums the file's points with the current curve, at every output frequency", () => {
  const base = newDoc();
  base.layers.find((l) => l.kind === "lfTilt").on = true;
  base.layers.find((l) => l.kind === "hpf").on = true;
  base.props.name = "Mine";
  const before = JSON.stringify(base);
  const { doc, layerId } = addImportedLayer(base, LA, "user_LA_7dB_at_315k.crv");
  assert.equal(JSON.stringify(base), before, "the current document is not changed");
  const filePts = docFromImport(LA, "x.crv").doc.original;
  const plain = Object.fromEntries(evaluate(base));
  for (const [f, g] of evaluate(doc)) close(g, plain[f] + interpPoints(f, filePts), 1.5e-6, `${f} Hz`);
  const layer = doc.layers.at(-1);
  assert.equal(layer.id, layerId);
  assert.equal(layer.kind, "points");
  assert.equal(layer.on, true);
  assert.equal(layer.label, "user_LA_7dB_at_315k.crv");
  assert.deepEqual(layer.points, filePts);
});

test("adding keeps the document's own name, properties, grid and other layers", () => {
  const base = newDoc();
  Object.assign(base.props, { name: "Mine", color: "ff00ff00", line: 5, tolerance: 1.5, useTolerance: 1 });
  base.grid = { mode: "resample", fraction: 6, fmin: 20, fmax: 20000, trimLow: 50, trimHigh: 8000 };
  base.normalise = { on: true, at: 500 };
  const { doc } = addImportedLayer(base, TILT, "t.crv");
  assert.deepEqual(doc.props, base.props);
  assert.deepEqual(doc.grid, base.grid);
  assert.deepEqual(doc.normalise, base.normalise);
  assert.deepEqual(doc.layers.slice(0, -1), base.layers);
  assert.equal(doc.layers.length, base.layers.length + 1);
  assert.equal(doc.original, base.original);
});

test("a second add makes a second layer; layers sum, labels tell them apart; the export stays valid", () => {
  let d = newDoc();
  d.layers.find((l) => l.kind === "hpf").on = true;
  d = addImportedLayer(d, LA, "a.crv").doc;
  d = addImportedLayer(d, TILT, "b.crv").doc;
  assert.deepEqual(d.layers.slice(-2).map((l) => l.label), ["a.crv", "b.crv"]);
  const r = buildCrv(d);
  assert.ok(r.text, JSON.stringify(r.issues));
  const ids = new Set(d.layers.map((l) => l.id));
  assert.equal(ids.size, d.layers.length, "unique layer ids");
});

test("a spectrum file is shifted to 0 dB at 1 kHz before it is added", () => {
  const spec = "Line:\t2\r\nColor:\tff00ff00\r\nShow:\t1\r\nBand:\t3\r\n\r\n63.000000\t80.000000\r\n1000.000000\t75.000000\r\n10000.000000\t70.000000\r\n";
  const r = addImportedLayer(newDoc(), spec, "spec.crv");
  assert.equal(r.shifted, true);
  assert.deepEqual(r.doc.layers.at(-1).points, [[63, 5], [1000, 0], [10000, -5]]);
  const tf = addImportedLayer(newDoc(), LA, "x.crv");
  assert.equal(tf.shifted, false);
  // 1 kHz outside the file's range: the end value is held, as for any points layer
  const high = "Line:\t2\r\nColor:\tff00ff00\r\nShow:\t1\r\nBand:\t3\r\n\r\n2000.000000\t90.000000\r\n8000.000000\t80.000000\r\n";
  assert.deepEqual(addImportedLayer(newDoc(), high, "h.crv").doc.layers.at(-1).points, [[2000, 0], [8000, -10]]);
});

test("bad files are refused with a clear message and leave the document alone", () => {
  const d = newDoc();
  const before = JSON.stringify(d);
  assert.throws(() => addImportedLayer(d, "hello world", "x.crv"), /doesn't look like a Smaart/);
  assert.throws(() => addImportedLayer(d, "Line:\t3\r\nType:\tTF\r\n\r\n100\t0\r\n", "x.crv"), /fewer than 2/);
  assert.throws(() => addImportedLayer(d, "", "x.crv"));
  const many = "Line:\t3\r\nType:\tTF\r\n\r\n" + Array.from({ length: 5001 }, (_, i) => `${10 + i}\t0`).join("\r\n") + "\r\n";
  assert.throws(() => addImportedLayer(d, many, "x.crv"), /more than/);
  assert.equal(JSON.stringify(d), before);
});

test("rows that can't be read give warnings and the good rows are kept", () => {
  const messy = "Line:\t3\r\nType:\tTF\r\n\r\n100\t0\r\nbad row\r\n200\t3\r\n300\t6\r\n";
  const r = addImportedLayer(newDoc(), messy, "m.crv");
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.doc.layers.at(-1).points, [[100, 0], [200, 3], [300, 6]]);
});

test("the layer label is stored, cleaned and limited, and survives a save and load", () => {
  const nasty = "a\r\nb\tc" + "x".repeat(200);
  const { doc } = addImportedLayer(newDoc(), LA, nasty);
  const label = doc.layers.at(-1).label;
  assert.ok(label.length <= 100 && !/[\r\n\t]/.test(label), label);
  const back = loadDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(back.layers.at(-1).label, label);
  assert.equal("label" in addImportedLayer(newDoc(), LA, "").doc.layers.at(-1), false, "no name, no label");
  // a hostile label in a loaded document is cleaned too
  const hostile = loadDoc({ version: 1, layers: [{ kind: "points", on: true, points: [[1, 0], [2, 0]], label: "x\r\ny\tz" }] });
  assert.ok(!/[\r\n\t]/.test(hostile.layers[0].label));
  assert.equal("label" in loadDoc({ version: 1, layers: [{ kind: "points", on: true, points: [[1, 0], [2, 0]], label: 5 }] }).layers[0], false);
});

test("adding to an imported curve, then Reset to imported, brings back exactly the file", () => {
  const { doc } = docFromImport(LA, "user_LA_7dB_at_315k.crv");
  const added = addImportedLayer(doc, TILT, "tilt.crv").doc;
  assert.notEqual(buildCrv(added).text, LA);
  assert.equal(buildCrv(resetToImport(added)).text, LA);
});

test("the added layer works with invert and with the name suggestion", () => {
  const { doc } = addImportedLayer(newDoc(), LA, "a.crv");
  const plain = Object.fromEntries(evaluate(doc));
  doc.layers.at(-1).invert = true;
  for (const [f, g] of evaluate(doc)) close(g, -plain[f], 1e-6, `inverted at ${f}`);
  assert.match(suggestName(doc), /^[A-Za-z0-9._+-]+$/);
});
