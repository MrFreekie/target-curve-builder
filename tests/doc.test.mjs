// Document model + import tests. Expectations from docs/SPEC.md §5, §7, §8, §9 and BUILD_PLAN Phase 4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildCrv, newDoc as appNewDoc } from "../js/app.js";
import { newDoc, newLayer, loadDoc, docFromImport, convertToTf, LAYER_KINDS } from "../js/doc.js";

const samplesDir = new URL("../reference/samples/", import.meta.url);
const sampleNames = readdirSync(samplesDir).filter((n) => n.endsWith(".crv")).sort();
const golden = JSON.parse(readFileSync(new URL("../reference/golden.json", import.meta.url), "utf8"));
const TOL = golden.tolerance_db;

function assertBytesEqual(expected, actual, label) {
  if (Buffer.compare(expected, actual) === 0) return;
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  assert.fail(`${label}: first differing byte at offset ${i} (expected ${expected[i]}, got ${actual[i]}); lengths ${expected.length} vs ${actual.length}`);
}

const SPECTRUM = [
  "Line:\t2", "Color:\tffff0000", "Show:\t1", "Band:\t3", "",
  "500.000000\t80.000000", "630.000000\t81.000000", "800.000000\t82.000000",
  "1000.000000\t85.000000", "1250.000000\t83.000000", "1600.000000\t79.000000", "",
].join("\r\n");

const errorsOf = (r) => r.issues.filter((i) => i.level === "error");

// (1) round trip through the document model
test("sample set is present", () => {
  assert.ok(sampleNames.length >= 10);
});

for (const name of sampleNames) {
  test(`import then buildCrv is byte-identical: ${name}`, () => {
    const buf = readFileSync(new URL(name, samplesDir));
    const { doc } = docFromImport(buf.toString("utf8"), name);
    const out = buildCrv(doc);
    assert.deepEqual(errorsOf(out), []);
    assertBytesEqual(buf, Buffer.from(out.text, "utf8"), name);
  });
}

// (2) done-when
test("import LA file + HPF LR48 at 32 + 1/3 oct grid matches golden points_LA_hpf_LR48_32; header is the 6 canonical lines", () => {
  const text = readFileSync(new URL("user_LA_7dB_at_315k.crv", samplesDir), "utf8");
  const { doc } = docFromImport(text, "user_LA_7dB_at_315k.crv");
  const hp = doc.layers.find((l) => l.kind === "hpf");
  Object.assign(hp, { on: true, fc: 32, type: "LR", slope: 48 });
  doc.grid = { mode: "resample", fraction: 3, fmin: 20, fmax: 20000 };
  const r = buildCrv(doc);
  assert.deepEqual(errorsOf(r), []);
  const lines = r.text.split(/\r\n|\n/);
  assert.deepEqual(lines.slice(0, 7), ["Line:\t3", "Color:\tffff0000", "Show:\t1", "Type:\tTF", "Tolerance:\t3.0000", "UseTolerance:\t0", ""]);
  const c = golden.cases.find((k) => k.id === "points_LA_hpf_LR48_32");
  const rows = lines.slice(7).filter((l) => l !== "").map((l) => l.split("\t").map(Number));
  assert.equal(rows.length, c.expected.length);
  c.expected.forEach(([f, db], i) => {
    assert.ok(Math.abs(rows[i][0] - f) < TOL, `${c.id} row ${i}: Hz expected ${f} got ${rows[i][0]}`);
    assert.ok(Math.abs(rows[i][1] - db) < TOL, `${c.id} @ ${f} Hz: expected ${db} got ${rows[i][1]}`);
  });
});

// (3) import behaviour
test("import sets grid.mode original, overlay equals file points, name from file name, other layers off", () => {
  const text = readFileSync(new URL("user_LA_7dB_at_315k.crv", samplesDir), "utf8");
  const { doc, warnings } = docFromImport(text, "My Curve.crv");
  assert.equal(doc.grid.mode, "original");
  assert.deepEqual(doc.original, [[63, 7], [315, 0], [20000, 0]]);
  assert.equal(doc.props.name, "My Curve");
  assert.deepEqual(warnings, []);
  const pts = doc.layers.filter((l) => l.kind === "points");
  assert.equal(pts.length, 1);
  assert.equal(pts[0].on, true);
  assert.deepEqual(pts[0].points, [[63, 7], [315, 0], [20000, 0]]);
  for (const l of doc.layers.filter((l) => l.kind !== "points")) assert.equal(l.on, false, `${l.kind} should be off`);
});

test("import: overlay is a copy, not the same array as the points layer", () => {
  const text = readFileSync(new URL("user_LA_7dB_at_315k.crv", samplesDir), "utf8");
  const { doc } = docFromImport(text, "a.crv");
  doc.layers.find((l) => l.kind === "points").points[0][1] = 99;
  assert.equal(doc.original[0][1], 7);
});

test("import: bad data rows give warnings but good rows are kept", () => {
  const t = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\n\r\n100\t1\r\nrubbish here\r\n200\t2\r\n300\tabc\r\n400\t4\r\n";
  const { doc, warnings } = docFromImport(t, "x.crv");
  assert.ok(warnings.length > 0);
  assert.deepEqual(doc.original.map((p) => p[0]), [100, 200, 400]);
});

test("import: non-crv text throws an Error", () => {
  assert.throws(() => docFromImport("hello world\nthis is not a curve", "a.txt"), Error);
  assert.throws(() => docFromImport("", "a.crv"), Error);
});

test("import: fewer than 2 data rows throws an Error", () => {
  const t = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\n\r\n100\t1\r\n";
  assert.throws(() => docFromImport(t, "x.crv"), Error);
});

// (4) spectrum
test("spectrum import: format smaart-spectrum and export is blocked", () => {
  const { doc } = docFromImport(SPECTRUM, "rta.crv");
  assert.equal(doc.props.format, "smaart-spectrum");
  const r = buildCrv(doc);
  assert.equal(r.text, null);
  assert.ok(errorsOf(r).length > 0);
});

test("convertToTf: smaart-tf, normalise on at 1000, overlay is 0 dB at 1 kHz, input not mutated", () => {
  const { doc } = docFromImport(SPECTRUM, "rta.crv");
  const before = JSON.stringify(doc);
  const tf = convertToTf(doc);
  assert.equal(JSON.stringify(doc), before, "input doc must not be mutated");
  assert.equal(tf.props.format, "smaart-tf");
  assert.deepEqual(tf.normalise, { on: true, at: 1000 });
  const at1k = tf.original.find((p) => p[0] === 1000);
  assert.ok(Math.abs(at1k[1]) < 1e-9, `overlay at 1 kHz is ${at1k[1]}`);
  assert.ok(Math.abs(tf.original.find((p) => p[0] === 500)[1] - (80 - 85)) < 1e-9);
});

test("converted spectrum exports as TF with 0 dB at 1 kHz and no Band line", () => {
  const { doc } = docFromImport(SPECTRUM, "rta.crv");
  const r = buildCrv(convertToTf(doc));
  assert.deepEqual(errorsOf(r), []);
  assert.ok(r.text);
  assert.ok(!/^Band/im.test(r.text), "no Band line");
  assert.match(r.text, /^Type:\tTF\r?$/m);
  const row = r.text.split(/\r\n|\n/).find((l) => l.startsWith("1000.000000\t"));
  assert.equal(row, "1000.000000\t0.000000");
  const r500 = r.text.split(/\r\n|\n/).find((l) => l.startsWith("500.000000\t"));
  assert.equal(r500, "500.000000\t-5.000000");
});

// model
test("newDoc follows SPEC §4.5 defaults", () => {
  const d = newDoc();
  assert.equal(d.version, 1);
  assert.deepEqual(d.layers.map((l) => l.kind), ["points", "lfTilt", "fullTilt", "hfTilt", "hpf", "lpf"]);
  assert.deepEqual(d.layers.map((l) => l.on), [true, false, false, false, false, false]);
  assert.deepEqual(d.layers[0].points, [[20, 0], [20000, 0]]);
  assert.deepEqual(d.grid, { mode: "resample", fraction: 12, fmin: 20, fmax: 20000 });
  assert.equal(d.original, null);
  assert.equal(d.normalise.at, 1000);
  assert.equal(new Set(d.layers.map((l) => l.id)).size, 6);
  assert.equal(appNewDoc, newDoc);
});

test("newDoc builds an exportable flat 119-point (1/12-octave) curve", () => {
  const r = buildCrv(newDoc());
  assert.ok(r.text);
  assert.equal(r.points.length, 119);
  assert.ok(r.points.every((p) => p[1] === 0));
});

test("two newDoc() calls never share layer ids", () => {
  const a = newDoc().layers.map((l) => l.id);
  const b = newDoc().layers.map((l) => l.id);
  assert.equal(new Set([...a, ...b]).size, 12);
});

test("newLayer makes a unique, switched-on, exportable layer of every kind", () => {
  const ids = new Set();
  for (const kind of Object.keys(LAYER_KINDS)) {
    const l = newLayer(kind);
    assert.equal(l.kind, kind);
    assert.equal(l.on, true);
    ids.add(l.id);
    const d = newDoc();
    d.layers.push(l);
    assert.ok(buildCrv(d).text, `doc with a new ${kind} layer should export`);
  }
  assert.equal(ids.size, Object.keys(LAYER_KINDS).length);
});

test("newLayer hpf defaults to LR 48 at 32 Hz (SPEC §4.4)", () => {
  const l = newLayer("hpf");
  assert.deepEqual([l.fc, l.type, l.slope], [32, "LR", 48]);
});

test("LAYER_KINDS includes every kind in the SPEC", () => {
  for (const k of ["points", "lfTilt", "fullTilt", "hfTilt", "hpf", "lpf", "gain"]) assert.ok(k in LAYER_KINDS, k);
});

// (5) loadDoc hostile input
const asDoc = (mut) => { const d = JSON.parse(JSON.stringify(newDoc())); mut(d); return d; };
const idsOk = (d) => {
  const ids = d.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "layer ids unique");
  assert.ok(ids.every((i) => typeof i === "string" && i.length > 0));
};

/** Run fn; either it throws a readable Error (returns null) or returns a clean doc. */
function throwsOrClean(fn, label) {
  let d;
  try { d = fn(); } catch (e) {
    assert.ok(e instanceof Error && e.message.length > 3, `${label}: error must be a readable Error, got ${e}`);
    return null;
  }
  idsOk(d);
  return d;
}

test("loadDoc: round trip of newDoc keeps content with fresh unique ids", () => {
  const d = newDoc();
  const l = loadDoc(JSON.parse(JSON.stringify(d)));
  idsOk(l);
  assert.deepEqual(l.layers.map(({ id, ...r }) => r), d.layers.map(({ id, ...r }) => r));
  assert.deepEqual(l.grid, d.grid);
  assert.deepEqual(l.normalise, d.normalise);
  assert.notDeepEqual(l.layers.map((x) => x.id), d.layers.map((x) => x.id));
});

const notDocs = [["null", null], ["a string", "hi"], ["a number", 5], ["an array", []], ["undefined", undefined],
  ["wrong version", { ...newDoc(), version: 2 }], ["missing version", { layers: [] }], ["version as string", { ...newDoc(), version: "1" }]];
for (const [label, v] of notDocs) {
  test(`loadDoc rejects ${label} with a readable Error`, () => {
    assert.throws(() => loadDoc(v), (e) => e instanceof Error && e.message.length > 3);
  });
}

test("loadDoc: unknown layer kind is rejected or dropped", () => {
  const bad = asDoc((d) => d.layers.push({ id: "x", kind: "nonsense", on: true }));
  const d = throwsOrClean(() => loadDoc(bad), "unknown kind");
  if (d) assert.ok(d.layers.every((l) => l.kind in LAYER_KINDS));
});

test("loadDoc: inherited-property layer kinds (toString, constructor) are not accepted", () => {
  const legal = ["points", "lfTilt", "hfTilt", "fullTilt", "hpf", "lpf", "gain"];
  for (const kind of ["toString", "constructor", "hasOwnProperty"]) {
    const bad = asDoc((d) => d.layers.push({ id: "x", kind, on: true }));
    const d = throwsOrClean(() => loadDoc(bad), kind);
    if (d) assert.ok(d.layers.every((l) => legal.includes(l.kind)), `kind ${kind} survived`);
  }
});

test("loadDoc: illegal filter slope (LR 18, BW 50, LR 6) is rejected or corrected to a legal one", () => {
  for (const [type, slope, legal] of [["LR", 18, [12, 24, 36, 48]], ["BW", 50, [6, 12, 18, 24, 30, 36, 42, 48]], ["LR", 6, [12, 24, 36, 48]]]) {
    const bad = asDoc((d) => Object.assign(d.layers.find((l) => l.kind === "hpf"), { type, slope }));
    const d = throwsOrClean(() => loadDoc(bad), `${type}${slope}`);
    if (d) {
      const h = d.layers.find((l) => l.kind === "hpf");
      assert.ok(legal.includes(h.slope), `${type} ${slope} survived as illegal ${h.slope}`);
    }
  }
});

test("loadDoc: unknown filter type is rejected or corrected", () => {
  const bad = asDoc((d) => { d.layers.find((l) => l.kind === "hpf").type = "XX"; });
  const d = throwsOrClean(() => loadDoc(bad), "type XX");
  if (d) assert.ok(["BW", "LR"].includes(d.layers.find((l) => l.kind === "hpf").type));
});

for (const [label, hz] of [["NaN", NaN], ["negative", -50], ["zero", 0], ["Infinity", Infinity], ["null", null], ["object", {}]]) {
  test(`loadDoc: ${label} point frequency is rejected or cleaned`, () => {
    const bad = asDoc((d) => { d.layers[0].points = [[hz, 0], [1000, 0], [20000, 0]]; });
    const viaJson = JSON.parse(JSON.stringify(bad)); // NaN/Infinity become null, as in a real file
    const d = throwsOrClean(() => loadDoc(viaJson), label);
    if (d) for (const [f, db] of d.layers[0].points) assert.ok(Number.isFinite(f) && f > 0 && Number.isFinite(db), `${label}: ${f},${db}`);
  });
}

test("loadDoc: negative frequency kept in a filter fc or tilt pivot is rejected or cleaned", () => {
  for (const [kind, key] of [["hpf", "fc"], ["lpf", "fc"], ["lfTilt", "pivot"], ["hfTilt", "corner"], ["fullTilt", "pivot"]]) {
    const bad = asDoc((d) => { d.layers.find((l) => l.kind === kind)[key] = -100; });
    const d = throwsOrClean(() => loadDoc(bad), `${kind}.${key}`);
    if (d) assert.ok(d.layers.find((l) => l.kind === kind)[key] > 0, `${kind}.${key}`);
  }
});

test("loadDoc: non-numeric dB value is rejected or cleaned", () => {
  const bad = asDoc((d) => { d.layers[0].points = [[100, "abc"], [1000, 0]]; });
  const d = throwsOrClean(() => loadDoc(bad), "abc dB");
  if (d) for (const [f, db] of d.layers[0].points) assert.ok(Number.isFinite(f) && Number.isFinite(db));
});

test("loadDoc: string numbers are coerced to numbers or rejected, never kept as strings", () => {
  const bad = asDoc((d) => {
    d.layers[0].points = [["100", "3"], ["1000", "0"]];
    d.layers.find((l) => l.kind === "hpf").fc = "40";
    d.layers.find((l) => l.kind === "hpf").slope = "48";
    d.layers.find((l) => l.kind === "lfTilt").dbPerOct = "3";
    d.normalise.at = "1000";
    d.props.tolerance = "3";
    d.props.line = "3";
  });
  const d = throwsOrClean(() => loadDoc(bad), "strings");
  if (d) {
    for (const [f, db] of d.layers[0].points) assert.equal(typeof f + typeof db, "numbernumber");
    const h = d.layers.find((l) => l.kind === "hpf");
    assert.equal(typeof h.fc, "number");
    assert.equal(typeof h.slope, "number");
    assert.equal(typeof d.layers.find((l) => l.kind === "lfTilt").dbPerOct, "number");
    assert.equal(typeof d.normalise.at, "number");
    assert.equal(typeof d.props.tolerance, "number");
    assert.equal(typeof d.props.line, "number");
    assert.ok(buildCrv(d).text, "cleaned doc should still export");
  }
});

test("loadDoc: huge layer count is rejected or capped", () => {
  const bad = asDoc((d) => { d.layers = Array.from({ length: 100000 }, () => ({ kind: "gain", on: true, db: 1 })); });
  const d = throwsOrClean(() => loadDoc(bad), "many layers");
  if (d) assert.ok(d.layers.length <= 1000, `kept ${d.layers.length} layers`);
});

test("loadDoc: huge point count is rejected or capped", () => {
  const bad = asDoc((d) => { d.layers[0].points = Array.from({ length: 1000000 }, (_, i) => [20 + i, 0]); });
  const d = throwsOrClean(() => loadDoc(bad), "many points");
  if (d) assert.ok(d.layers[0].points.length <= 100000);
});

test("loadDoc: huge original overlay is rejected or capped", () => {
  const bad = asDoc((d) => { d.original = Array.from({ length: 1000000 }, (_, i) => [20 + i, 0]); });
  const d = throwsOrClean(() => loadDoc(bad), "many original");
  if (d && d.original) assert.ok(d.original.length <= 100000);
});

test("loadDoc: extra unknown props and layer fields are ignored or harmless", () => {
  const bad = asDoc((d) => {
    d.evil = { nested: true };
    d.props.script = "<img onerror=alert(1)>";
    d.layers[0].extra = [1, 2, 3];
    d.layers.push({ id: "pts", kind: "gain", on: true, db: 2, junk: "x" });
  });
  const d = throwsOrClean(() => loadDoc(bad), "extra");
  assert.ok(d);
  assert.ok(buildCrv(d).text);
});

test("loadDoc: JSON with a __proto__ key does not pollute Object.prototype", () => {
  const txt = JSON.stringify(newDoc()).replace('"version":1', '"version":1,"__proto__":{"polluted":1}');
  throwsOrClean(() => loadDoc(JSON.parse(txt)), "proto");
  assert.equal({}.polluted, undefined);
});

test("loadDoc: duplicate layer ids in the input come out unique", () => {
  const bad = asDoc((d) => { d.layers.forEach((l) => { l.id = "same"; }); });
  assert.ok(throwsOrClean(() => loadDoc(bad), "dup ids"));
});

test("loadDoc: does not mutate its input", () => {
  const src = JSON.parse(JSON.stringify(newDoc()));
  const copy = JSON.stringify(src);
  loadDoc(src);
  assert.equal(JSON.stringify(src), copy);
});

test("loadDoc: bad props (line 9, show 7, colour 'red', useTolerance 5) fall back to valid values or throw", () => {
  const bad = asDoc((d) => { Object.assign(d.props, { line: 9, show: 7, color: "red", useTolerance: 5 }); });
  const d = throwsOrClean(() => loadDoc(bad), "props");
  if (d) {
    assert.ok(d.props.line >= 1 && d.props.line <= 5);
    assert.ok(d.props.show === 0 || d.props.show === 1);
    assert.match(d.props.color, /^[0-9a-f]{8}$/);
    assert.ok(d.props.useTolerance === 0 || d.props.useTolerance === 1);
    assert.ok(buildCrv(d).text);
  }
});

test("loadDoc: grid mode original without an overlay still gives an exportable doc", () => {
  const bad = asDoc((d) => { d.grid.mode = "original"; d.original = null; });
  const d = throwsOrClean(() => loadDoc(bad), "orig grid no overlay");
  if (d) assert.ok(buildCrv(d).text, "must still export");
});

test("loadDoc: an imported doc survives a JSON round trip and still exports byte-identically", () => {
  const buf = readFileSync(new URL("user_LA_7dB_at_315k.crv", samplesDir));
  const { doc } = docFromImport(buf.toString("utf8"), "user_LA_7dB_at_315k.crv");
  const again = loadDoc(JSON.parse(JSON.stringify(doc)));
  assertBytesEqual(buf, Buffer.from(buildCrv(again).text, "utf8"), "reloaded import");
});

test("loadDoc: every sample survives a JSON round trip and exports byte-identically", () => {
  for (const name of sampleNames) {
    const buf = readFileSync(new URL(name, samplesDir));
    const { doc } = docFromImport(buf.toString("utf8"), name);
    const again = loadDoc(JSON.parse(JSON.stringify(doc)));
    assertBytesEqual(buf, Buffer.from(buildCrv(again).text, "utf8"), `reloaded ${name}`);
  }
});
