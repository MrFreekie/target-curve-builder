import test from "node:test";
import assert from "node:assert/strict";
import { newDoc, newLayer } from "../js/doc.js";
import { evaluate } from "../js/curve.js";
import { buildCrv } from "../js/build.js";
import { GLOBCON_GRID, GLOBCON_POINTS, javaDouble, writeGlobconCsv, validateGlobconCsv, globconCsv } from "../js/formats/globcon-csv.js";
import { getAdapter, writableAdapters } from "../js/formats/index.js";

const bell = () => { const d = newDoc(); d.props.name = "House B"; d.layers.push({ ...newLayer("bell"), fc: 1000, db: 6, q: 2 }); return d; };

test("the grid is 1024 log-spaced 32-bit float frequencies from 10 Hz to 32 kHz, as in the model file", () => {
  assert.equal(GLOBCON_GRID.length, GLOBCON_POINTS);
  assert.equal(GLOBCON_GRID[0], 10);
  assert.equal(GLOBCON_GRID[1023], 32000);
  // values taken from the model file's own rows (10 Hz, steps 1, 2 and 22, and the last two)
  assert.deepEqual([1, 2, 21, 1022].map((k) => javaDouble(GLOBCON_GRID[k])), ["10.079206466674805", "10.159040451049805", "11.801935195922852", "31748.53125"]);
  assert.ok(GLOBCON_GRID.every((f, k) => Math.fround(f) === f && (k === 0 || f > GLOBCON_GRID[k - 1])));
  assert.ok(Object.isFrozen(GLOBCON_GRID));
});

test("numbers are written the way Java prints a float widened to a double", () => {
  const cases = [[0, "0.0"], [-0, "0.0"], [10, "10.0"], [32000, "32000.0"], [-12.385234832763672, "-12.385234832763672"],
    [Math.fround(-5.665079224854708e-4), "-5.665079224854708E-4"], [Math.fround(1e-5), "9.999999747378752E-6"], [Math.fround(2e7), "2.0E7"], [0.001, "0.001"], [Math.fround(-9.5), "-9.5"]];
  for (const [x, want] of cases) assert.equal(javaDouble(x), want, String(x));
  // every value in the model file's first rows survives a float32 round trip
  for (const s of ["10.239506721496582", "11.801935195922852", "-12.261162757873535", "-15.311653137207031", "-49.37968826293945"]) assert.equal(javaDouble(Math.fround(Number(s))), s);
});

test("a curve is evaluated on the fixed grid and written as FREQUENCY,MAGNITUDE with LF endings and a final newline", () => {
  const doc = bell();
  doc.grid = { ...doc.grid, fraction: 1, fmin: 100, fmax: 5000, trimLow: 200, trimHigh: 4000 }; // none of this applies to this format
  const r = buildCrv(doc, "globcon-csv");
  assert.ok(r.ok, JSON.stringify(r.issues));
  assert.equal(r.points.length, 1024);
  const lines = r.text.split("\n");
  assert.equal(lines[0], "FREQUENCY,MAGNITUDE");
  assert.equal(lines.length, 1026);
  assert.equal(lines.at(-1), "");
  assert.ok(!r.text.includes("\r"));
  const want = evaluate(doc, [...GLOBCON_GRID]);
  lines.slice(1, 1025).forEach((l, k) => {
    const [f, g] = l.split(",");
    assert.equal(Number(f), GLOBCON_GRID[k]);
    assert.ok(Math.abs(Number(g) - want[k][1]) < 5e-6 + Math.abs(want[k][1]) * 1.2e-7, `row ${k}: ${g} vs ${want[k][1]}`);
    assert.ok(!/^-0\.0$/.test(g) && !/[a-df-z]/i.test(g.replace("E", "")), g);
  });
  assert.ok(lines[1].startsWith("10.0,"));
  assert.ok(lines[1024].startsWith("32000.0,"));
});

test("a flat 0 dB curve writes 0.0 on every row, and the other formats still use the Output grid", () => {
  const flat = newDoc();
  flat.props.name = "Flat";
  const text = buildCrv(flat, "globcon-csv").text;
  assert.ok(text.split("\n").slice(1, 1025).every((l) => l.endsWith(",0.0")));
  assert.notEqual(buildCrv(bell(), "smaart-tf").points.length, 1024);
});

test("validation: the shared checks apply, the grid can't be wrong, and a missing name blocks export", () => {
  const doc = bell();
  doc.props.name = "";
  assert.ok(buildCrv(doc, "globcon-csv").issues.some((i) => /file name/.test(i.message)));
  assert.ok(validateGlobconCsv(bell(), [[10, 0], [20, 0]]).some((i) => /1024-point grid/.test(i.message)));
  assert.ok(validateGlobconCsv(bell(), GLOBCON_GRID.map((f, k) => [k === 5 ? f * 1.0000001 : f, 0])).some((i) => /1024-point grid/.test(i.message)));
  assert.equal(validateGlobconCsv(bell(), GLOBCON_GRID.map((f) => [f, 0])).length, 0);
  assert.ok(validateGlobconCsv(bell(), GLOBCON_GRID.map((f) => [f, 1e300])).some((i) => /too large/.test(i.message)));
  assert.throws(() => globconCsv.read("x"), /written, not read/);
  assert.equal(globconCsv.detect("FREQUENCY,MAGNITUDE\n10.0,0.0\n"), 0);
});

test("it is offered as an export format", () => {
  assert.ok(writableAdapters().some((a) => a.id === "globcon-csv"));
  assert.equal(getAdapter("globcon-csv").ext, ".csv");
  assert.equal(writeGlobconCsv({}, [[10, 1.5], [32000, -2]]), "FREQUENCY,MAGNITUDE\n10.0,1.5\n32000.0,-2.0\n");
});

test("a value that can't be written throws instead of writing rubbish", () => {
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => javaDouble(bad), RangeError);
});
