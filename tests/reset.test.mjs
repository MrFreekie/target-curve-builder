import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { docFromImport, resetToImport, loadDoc, newDoc } from "../js/doc.js";
import { buildCrv } from "../js/app.js";

const dir = "reference/samples/";
const samples = readdirSync(dir).filter((f) => f.endsWith(".crv"));

/** Change everything a user might change after an import. */
function mess(doc) {
  doc.props.name = "Edited";
  doc.props.line = 5;
  doc.props.color = "ff00ff00";
  doc.props.tolerance = 1.5;
  doc.props.useTolerance = 1;
  doc.props.offset = 2;
  doc.grid = { mode: "simplified", fraction: 6, fmin: 30, fmax: 10000, epsilon: 0.5 };
  doc.normalise = { on: true, at: 500 };
  const pts = doc.layers.find((l) => l.kind === "points");
  pts.points[0][1] += 9;
  pts.points.push([12345, 1]);
  for (const l of doc.layers) if (l.kind !== "points") l.on = true;
  doc.layers.push({ id: "x", kind: "gain", on: true, db: 3 });
}

test("reset after heavy editing exports byte-identically to the imported file (every sample)", () => {
  for (const f of samples) {
    const text = readFileSync(dir + f, "utf8");
    const { doc } = docFromImport(text, f);
    mess(doc);
    assert.notEqual(buildCrv(doc).text, text);
    const back = resetToImport(doc);
    assert.equal(buildCrv(back).text, text, f);
    assert.equal(back.grid.mode, "original");
    assert.equal(back.props.name, f.replace(/\.crv$/, ""));
    assert.ok(back.layers.every((l) => l.kind === "points" || !l.on));
    assert.equal(back.normalise.on, false);
    assert.deepEqual(back.original, doc.original);
  }
});

test("reset survives a save and load (preset JSON, autosave)", () => {
  const text = readFileSync(dir + "user_LA_7dB_at_315k.crv", "utf8");
  const { doc } = docFromImport(text, "user_LA_7dB_at_315k.crv");
  mess(doc);
  const loaded = loadDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(buildCrv(resetToImport(loaded)).text, text);
});

test("a document that wasn't imported can't be reset", () => {
  assert.equal(resetToImport(newDoc()), null);
});

test("reset gives a fresh document and leaves the old one alone", () => {
  const text = readFileSync(dir + samples[0], "utf8");
  const { doc } = docFromImport(text, samples[0]);
  mess(doc);
  const before = JSON.stringify(doc);
  const back = resetToImport(doc);
  assert.equal(JSON.stringify(doc), before);
  back.layers[0].points[0][1] = 99;
  back.original[0][1] = 99;
  assert.equal(JSON.stringify(doc), before);
});

test("a document saved before this feature (no originalProps) resets points, layers and grid", () => {
  const text = readFileSync(dir + "user_LA_7dB_at_315k.crv", "utf8");
  const { doc } = docFromImport(text, "x.crv");
  delete doc.originalProps;
  mess(doc);
  const back = resetToImport(loadDoc(JSON.parse(JSON.stringify(doc))));
  assert.equal(back.props.name, "Edited");
  assert.equal(back.grid.mode, "original");
  assert.deepEqual(back.layers.find((l) => l.kind === "points").points, doc.original);
});

test("a converted spectrum curve resets to its TF form", () => {
  const spec = "Line:\t2\r\nColor:\tff00ff00\r\nShow:\t1\r\nBand:\t3\r\n\r\n63.000000\t80.000000\r\n1000.000000\t75.000000\r\n10000.000000\t70.000000\r\n";
  const { doc } = docFromImport(spec, "spec.crv");
  assert.equal(doc.props.format, "smaart-spectrum");
  doc.props.format = "smaart-tf";
  const back = resetToImport(doc);
  assert.equal(back.props.format, "smaart-tf");
});

// ---- loadDoc hardening from the independent check
test("loadDoc: fmin above fmax is repaired, kind and type must be strings", () => {
  const g = (grid) => loadDoc({ version: 1, layers: [], grid }).grid;
  assert.deepEqual([g({ fmin: 25000 }).fmin, g({ fmin: 25000 }).fmax], [20, 20000]);
  assert.deepEqual([g({ fmin: 100, fmax: 50 }).fmin, g({ fmin: 100, fmax: 50 }).fmax], [100, 20000]);
  assert.throws(() => loadDoc({ version: 1, layers: [{ kind: ["points"], on: true, points: [[1, 0], [2, 0]] }] }), /Unknown layer type/);
  assert.throws(() => loadDoc({ version: 1, layers: [{ kind: "hpf", on: true, fc: 50, type: ["LR"], slope: 24 }] }), /Unknown filter type/);
});
