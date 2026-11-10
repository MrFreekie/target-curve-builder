// Smaart .crv adapter tests. Expectations come from docs/SPEC.md §5, §6, §9 and reference/samples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { evaluate } from "../js/curve.js";
import {
  smaartTf, smaartSpectrum, writeTf, validateTf, fmt6,
  pickerToSmaart, smaartToPicker, sanitiseFileName, crvFileName,
} from "../js/formats/smaart.js";
import { ADAPTERS, getAdapter, writableAdapters, detectFormat } from "../js/formats/index.js";

const samplesDir = new URL("../reference/samples/", import.meta.url);
const sampleNames = readdirSync(samplesDir).filter((n) => n.endsWith(".crv")).sort();
const load = (n) => readFileSync(new URL(n, samplesDir));

/** Assert two buffers are identical; on failure report the first differing offset. */
function assertBytesEqual(expected, actual, label) {
  if (Buffer.compare(expected, actual) === 0) return;
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  assert.fail(`${label}: first differing byte at offset ${i} (expected ${expected[i]}, got ${actual[i]}); ` +
    `lengths ${expected.length} vs ${actual.length}`);
}

const lines = (s) => s.split(/\r\n|\n/);
const nameProps = (extra = {}) => ({ name: "Test", line: 2, color: "ffff0000", show: 1, tolerance: 3,
  useTolerance: 0, offset: null, lineEnding: "\r\n", trailingNewline: true, ...extra });
const PTS = [[63, 7], [315, 0], [20000, 0]];

// (1) Round trip ------------------------------------------------------------
test("sample set is present", () => {
  assert.ok(sampleNames.length >= 10, `found ${sampleNames.length} samples`);
});

for (const name of sampleNames) {
  test(`round trip is byte-identical: ${name}`, () => {
    const buf = load(name);
    const r = smaartTf.read(buf.toString("utf8"));
    const out = Buffer.from(smaartTf.write({ props: r.props }, r.points), "utf8");
    assertBytesEqual(buf, out, name);
  });
}

test("user_LA_7dB_at_315k.crv is read as having no trailing newline", () => {
  const r = smaartTf.read(load("user_LA_7dB_at_315k.crv").toString("utf8"));
  assert.equal(r.trailingNewline, false);
  assert.equal(r.lineEnding, "\r\n");
  assert.deepEqual(r.points, [[63, 7], [315, 0], [20000, 0]]);
});

test("other samples are read with CRLF and a trailing newline", () => {
  const r = smaartTf.read(load("Tilt_3dBoct_1000Hz.crv").toString("utf8"));
  assert.equal(r.trailingNewline, true);
  assert.equal(r.lineEnding, "\r\n");
});

test("sample header reads as line 3, ffff0000, show 1, tolerance 3, useTolerance 0", () => {
  const { props } = smaartTf.read(load("Tilt_3dBoct_1000Hz.crv").toString("utf8"));
  assert.equal(props.line, 3);
  assert.equal(props.color, "ffff0000");
  assert.equal(props.show, 1);
  assert.equal(props.tolerance, 3);
  assert.equal(props.useTolerance, 0);
  assert.ok(props.offset === null || props.offset === undefined);
});

// (2) Rebuild ---------------------------------------------------------------
const rebuildProps = () => ({ name: "Tilt", line: 3, color: "ffff0000", show: 1, tolerance: 3,
  useTolerance: 0, offset: null, lineEnding: "\r\n", trailingNewline: true });

function rebuild(hpfFc) {
  const layers = [{ id: "lft", kind: "lfTilt", on: true, dbPerOct: 3, pivot: 1000, floor: null }];
  if (hpfFc) layers.push({ id: "hp", kind: "hpf", on: true, fc: hpfFc, type: "LR", slope: 48 });
  const doc = { grid: { mode: "resample", fraction: 3, fmin: 20, fmax: 20000 }, normalise: { on: false }, layers };
  return smaartTf.write({ props: rebuildProps() }, evaluate(doc));
}

for (const name of sampleNames.filter((n) => n.startsWith("Tilt_3dBoct_1000Hz"))) {
  const m = name.match(/_HPF(\d+)_LR48/);
  test(`rebuild from layers reproduces ${name}`, () => {
    assertBytesEqual(load(name), Buffer.from(rebuild(m ? Number(m[1]) : 0), "utf8"), name);
  });
}

// (3) Lenient reader --------------------------------------------------------
const HDR_LF = "Line:\t2\nColor:\tffff0000\nShow:\t1\nType:\tTF\nTolerance:\t3.0000\nUseTolerance:\t0\n\n";

test("reader accepts LF endings and writes LF back", () => {
  const text = HDR_LF + "63\t7\n315\t0\n";
  const r = smaartTf.read(text);
  assert.equal(r.lineEnding, "\n");
  assert.equal(r.trailingNewline, true);
  assert.equal(smaartTf.write({ props: r.props }, r.points), HDR_LF + "63.000000\t7.000000\n315.000000\t0.000000\n");
});

test("reader accepts a UTF-8 BOM and the points are unaffected", () => {
  const r = smaartTf.read("﻿" + HDR_LF + "63\t7\n315\t0\n");
  assert.deepEqual(r.points, [[63, 7], [315, 0]]);
  assert.equal(r.props.line, 2);
});

test("reader accepts spaces as data separators", () => {
  assert.deepEqual(smaartTf.read(HDR_LF + "63 7\n315   0\n").points, [[63, 7], [315, 0]]);
});

test("reader accepts commas as data separators", () => {
  assert.deepEqual(smaartTf.read(HDR_LF + "63,7\n315, 0\n").points, [[63, 7], [315, 0]]);
});

test("reader accepts mixed-case header keys and space separators after the colon", () => {
  const r = smaartTf.read("LINE: 4\ncolor:   ff00ff00\nSHOW:\t0\nTYPE:\ttf\ntolerance: 5\nUSETOLERANCE:\t1\n\n63\t7\n315\t0\n");
  assert.equal(r.props.line, 4);
  assert.equal(r.props.color, "ff00ff00");
  assert.equal(r.props.show, 0);
  assert.equal(r.props.tolerance, 5);
  assert.equal(r.props.useTolerance, 1);
});

test("unknown header lines are kept and written back in place", () => {
  const text = "Line:\t2\r\nFoo:\tbar\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\nZed:\t9\r\n\r\n63.000000\t7.000000\r\n315.000000\t0.000000\r\n";
  const r = smaartTf.read(text);
  assert.ok(r.extraHeader.some((l) => l.includes("Foo")));
  assert.ok(r.extraHeader.some((l) => l.includes("Zed")));
  const out = smaartTf.write({ props: r.props }, r.points);
  assert.equal(out, text);
  const h = lines(out);
  assert.equal(h[1], "Foo:\tbar");
  assert.equal(h[7], "Zed:\t9");
});

test("unknown header lines survive when a known property is changed", () => {
  const text = "Line:\t2\r\nFoo:\tbar\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\n\r\n63.000000\t7.000000\r\n315.000000\t0.000000\r\n";
  const r = smaartTf.read(text);
  r.props.line = 4;
  const h = lines(smaartTf.write({ props: r.props }, r.points));
  assert.equal(h[0], "Line:\t4");
  assert.equal(h[1], "Foo:\tbar");
});

test("bad data rows are skipped with a warning that gives the count", () => {
  const r = smaartTf.read(HDR_LF + "63\t7\nabc\tdef\n100\n315\t0\nxx yy\n");
  assert.deepEqual(r.points, [[63, 7], [315, 0]]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /3/);
});

test("a clean file gives no warnings", () => {
  assert.deepEqual(smaartTf.read(HDR_LF + "63\t7\n315\t0\n").warnings, []);
});

test("raw header 'Tolerance: 3' is kept when tolerance is unchanged", () => {
  const text = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance: 3\r\nUseTolerance:\t0\r\n\r\n63.000000\t7.000000\r\n315.000000\t0.000000\r\n";
  const r = smaartTf.read(text);
  assert.equal(r.props.tolerance, 3);
  assert.equal(smaartTf.write({ props: r.props }, r.points), text);
});

test("changed tolerance is rewritten canonically as 'Tolerance:<TAB>4.0000'", () => {
  const text = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance: 3\r\nUseTolerance:\t0\r\n\r\n63.000000\t7.000000\r\n315.000000\t0.000000\r\n";
  const r = smaartTf.read(text);
  r.props.tolerance = 4;
  const out = smaartTf.write({ props: r.props }, r.points);
  assert.ok(lines(out).includes("Tolerance:\t4.0000"), out);
  assert.ok(!out.includes("Tolerance: 3"));
});

test("'Type: TF' is appended at the end of the header when missing", () => {
  const r = smaartTf.read("Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\n\r\n63\t7\r\n315\t0\r\n");
  const h = lines(smaartTf.write({ props: r.props }, r.points));
  const blank = h.indexOf("");
  assert.equal(h[blank - 1], "Type:\tTF");
  assert.equal(h.filter((l) => /^Type:/i.test(l)).length, 1);
});

test("Offset line is written only when set, after UseTolerance", () => {
  const without = lines(writeTf({ props: nameProps() }, PTS));
  assert.ok(!without.some((l) => /^Offset/.test(l)));
  const withOff = lines(writeTf({ props: nameProps({ offset: 2.5 }) }, PTS));
  const i = withOff.findIndex((l) => l.startsWith("UseTolerance"));
  assert.equal(withOff[i + 1], "Offset:\t2.5000");
});

test("Offset line is removed when the user clears it", () => {
  const text = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3.0000\r\nUseTolerance:\t0\r\nOffset:\t1.5000\r\n\r\n63.000000\t7.000000\r\n315.000000\t0.000000\r\n";
  const r = smaartTf.read(text);
  assert.equal(r.props.offset, 1.5);
  assert.equal(smaartTf.write({ props: r.props }, r.points), text, "unchanged offset round trips");
  r.props.offset = null;
  const out = smaartTf.write({ props: r.props }, r.points);
  assert.ok(!/Offset/i.test(out));
});

// (4) Validation ------------------------------------------------------------
const okDoc = () => ({ props: nameProps(), layers: [] });
const errs = (doc, pts) => validateTf(doc, pts).filter((v) => v.level === "error");

test("valid document has no errors", () => {
  assert.deepEqual(smaartTf.validate(okDoc(), PTS), []);
});

test("error: fewer than 2 points", () => {
  assert.ok(errs(okDoc(), [[100, 0]]).length >= 1);
  assert.ok(errs(okDoc(), []).length >= 1);
});

test("error: non-ascending frequencies", () => {
  assert.ok(errs(okDoc(), [[100, 0], [50, 0], [200, 0]]).length >= 1);
});

test("error: duplicate frequencies", () => {
  assert.ok(errs(okDoc(), [[100, 0], [100, 1], [200, 0]]).length >= 1);
});

test("error: NaN in frequency or level", () => {
  assert.ok(errs(okDoc(), [[100, NaN], [200, 0]]).length >= 1);
  assert.ok(errs(okDoc(), [[NaN, 0], [200, 0]]).length >= 1);
});

test("error: frequency zero or negative", () => {
  assert.ok(errs(okDoc(), [[0, 0], [200, 0]]).length >= 1);
  assert.ok(errs(okDoc(), [[-5, 0], [200, 0]]).length >= 1);
});

test("error: Line outside 1-5", () => {
  for (const line of [0, 6, -1, 2.5]) {
    assert.ok(errs({ props: nameProps({ line }), layers: [] }, PTS).length >= 1, `line ${line}`);
  }
  for (const line of [1, 2, 3, 4, 5]) {
    assert.equal(errs({ props: nameProps({ line }), layers: [] }, PTS).length, 0, `line ${line}`);
  }
});

test("error: Show not 0 or 1", () => {
  assert.ok(errs({ props: nameProps({ show: 2 }), layers: [] }, PTS).length >= 1);
  assert.ok(errs({ props: nameProps({ show: -1 }), layers: [] }, PTS).length >= 1);
  assert.equal(errs({ props: nameProps({ show: 0 }), layers: [] }, PTS).length, 0);
});

test("error: illegal slope for Butterworth (e.g. 7 or 54)", () => {
  for (const slope of [7, 54, 0]) {
    const doc = { props: nameProps(), layers: [{ kind: "hpf", on: true, fc: 40, type: "BW", slope }] };
    assert.ok(errs(doc, PTS).length >= 1, `BW ${slope}`);
  }
});

test("error: illegal slope for Linkwitz-Riley (6, 18, 30, 42)", () => {
  for (const slope of [6, 18, 30, 42]) {
    const doc = { props: nameProps(), layers: [{ kind: "lpf", on: true, fc: 4000, type: "LR", slope }] };
    assert.ok(errs(doc, PTS).length >= 1, `LR ${slope}`);
  }
});

test("legal filter slopes pass: BW 6..48 and LR 12/24/36/48", () => {
  for (const slope of [6, 12, 18, 24, 30, 36, 42, 48]) {
    const doc = { props: nameProps(), layers: [{ kind: "hpf", on: true, fc: 40, type: "BW", slope }] };
    assert.equal(errs(doc, PTS).length, 0, `BW ${slope}`);
  }
  for (const slope of [12, 24, 36, 48]) {
    const doc = { props: nameProps(), layers: [{ kind: "hpf", on: true, fc: 40, type: "LR", slope }] };
    assert.equal(errs(doc, PTS).length, 0, `LR ${slope}`);
  }
});

test("error: empty file name after sanitising", () => {
  assert.ok(errs({ props: nameProps({ name: "" }), layers: [] }, PTS).length >= 1);
  assert.ok(errs({ props: nameProps({ name: '/\\:*?"<>|' }), layers: [] }, PTS).length >= 1);
});

test("every validation error has a non-empty message", () => {
  for (const v of validateTf({ props: nameProps({ line: 9, name: "" }), layers: [] }, [[1, NaN]])) {
    assert.ok(typeof v.message === "string" && v.message.length > 0);
    assert.ok(v.level === "error" || v.level === "warn");
  }
});

// (5) Writer rules ----------------------------------------------------------
test("new-file output is CRLF only with a trailing newline", () => {
  const out = writeTf({ props: nameProps() }, PTS);
  assert.ok(out.endsWith("\r\n"));
  assert.ok(!out.replace(/\r\n/g, "").includes("\n"), "bare LF found");
  assert.ok(!out.replace(/\r\n/g, "").includes("\r"), "bare CR found");
  assert.ok(!out.endsWith("\r\n\r\n"), "more than one trailing line ending");
});

test("new-file default (no lineEnding/trailingNewline in props) is CRLF + trailing newline", () => {
  const out = smaartTf.write({ props: { name: "x", line: 2, color: "ffff0000", show: 1, tolerance: 3, useTolerance: 0, offset: null } }, PTS);
  assert.ok(out.endsWith("\r\n"));
  assert.ok(out.includes("\r\n") && !out.replace(/\r\n/g, "").includes("\n"));
});

test("new-file header is in the SPEC §5.1 order", () => {
  const out = writeTf({ props: nameProps({ color: "ff00ff00", line: 4, tolerance: 2.5, useTolerance: 1 }) }, PTS);
  assert.deepEqual(lines(out).slice(0, 8), [
    "Line:\t4", "Color:\tff00ff00", "Show:\t1", "Type:\tTF", "Tolerance:\t2.5000", "UseTolerance:\t1", "", "63.000000\t7.000000",
  ]);
});

test("output uses tabs only: no spaces, no commas", () => {
  const out = writeTf({ props: nameProps() }, PTS);
  assert.ok(!/[ ,]/.test(out), "space or comma in output");
  for (const row of lines(out).slice(7).filter(Boolean)) assert.match(row, /^\d+\.\d{6}\t-?\d+\.\d{6}$/);
});

test("data values have exactly 6 decimals", () => {
  const out = writeTf({ props: nameProps() }, [[31.5, 1.23456789], [1000, 2]]);
  assert.ok(out.includes("31.500000\t1.234568\r\n"));
  assert.ok(out.includes("1000.000000\t2.000000"));
});

test("no '-0.000000' for negative zero or tiny negative values", () => {
  const out = writeTf({ props: nameProps() }, [[100, -0], [200, -1e-9], [300, -4e-7], [400, 0]]);
  assert.ok(!out.includes("-0.000000"), out);
  assert.equal(fmt6(-0), "0.000000");
  assert.equal(fmt6(-1e-9), "0.000000");
});

test("fmt6 keeps real negative values", () => {
  assert.equal(fmt6(-6.0206), "-6.020600");
  assert.equal(fmt6(7), "7.000000");
});

test("exactly one blank line between header and data", () => {
  const h = lines(writeTf({ props: nameProps() }, PTS));
  const blanks = h.map((l, i) => (l === "" ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(blanks, [6, h.length - 1].filter((_, k, a) => k === 0 || h[a[k]] === ""));
  assert.equal(h[6], "");
  assert.notEqual(h[5], "");
  assert.notEqual(h[7], "");
});

test("trailingNewline false gives no final line ending; true gives exactly one", () => {
  assert.ok(!writeTf({ props: nameProps({ trailingNewline: false }) }, PTS).endsWith("\n"));
  const t = writeTf({ props: nameProps({ trailingNewline: true }) }, PTS);
  assert.ok(t.endsWith("0.000000\r\n"));
});

test("lineEnding LF is honoured for writing", () => {
  const out = writeTf({ props: nameProps({ lineEnding: "\n" }) }, PTS);
  assert.ok(!out.includes("\r"));
});

// (6) Spectrum and detection -------------------------------------------------
const SPEC_TEXT = "Line:\t2\r\nColor:\tff0000ff\r\nShow:\t1\r\nBand:\t3\r\n\r\n20.000000\t60.000000\r\n1000.000000\t70.000000\r\n20000.000000\t55.000000\r\n";

test("spectrum curve with Band and no Type is detected as smaart-spectrum", () => {
  const d = detectFormat(SPEC_TEXT);
  assert.ok(d, "nothing detected");
  assert.equal(d.adapter.id, "smaart-spectrum");
});

test("spectrum curve is not claimed by the TF adapter", () => {
  assert.equal(smaartTf.detect(SPEC_TEXT), 0);
  assert.ok(smaartSpectrum.detect(SPEC_TEXT) > 0);
});

test("spectrum read returns points, line, colour and no TF-only claims", () => {
  const r = smaartSpectrum.read(SPEC_TEXT);
  assert.deepEqual(r.points, [[20, 60], [1000, 70], [20000, 55]]);
  assert.equal(r.props.line, 2);
  assert.equal(r.props.color, "ff0000ff");
  assert.equal(r.props.band, 3);
});

test("spectrum Band values 1, 3, 6, 12, 24, 48 all detect as spectrum", () => {
  for (const b of [1, 3, 6, 12, 24, 48]) {
    assert.equal(detectFormat(SPEC_TEXT.replace("Band:\t3", `Band:\t${b}`)).adapter.id, "smaart-spectrum", `band ${b}`);
  }
});

test("smaartSpectrum.write throws", () => {
  assert.throws(() => smaartSpectrum.write({ props: {} }, [[20, 0], [1000, 0]]));
});

test("smaartSpectrum.validate reports an error so export is blocked", () => {
  assert.ok(smaartSpectrum.validate({ props: {} }, [[20, 0], [1000, 0]]).some((v) => v.level === "error"));
});

test("detectFormat picks smaart-tf for every TF sample", () => {
  for (const n of sampleNames) {
    const d = detectFormat(load(n).toString("utf8"));
    assert.ok(d, n);
    assert.equal(d.adapter.id, "smaart-tf", n);
  }
});

test("detectFormat returns null for text that is not a curve", () => {
  assert.equal(detectFormat("hello world\nthis is not a curve\n"), null);
  assert.equal(detectFormat(""), null);
});

test("registry: adapter ids, getAdapter and writableAdapters", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id).sort(), ["smaart-spectrum", "smaart-tf"]);
  assert.equal(getAdapter("smaart-tf"), smaartTf);
  assert.equal(getAdapter("nope"), undefined);
  assert.deepEqual(writableAdapters().map((a) => a.id), ["smaart-tf"]);
});

test("adapters expose the SPEC §6 interface", () => {
  for (const a of ADAPTERS) {
    assert.equal(typeof a.id, "string");
    assert.equal(typeof a.label, "string");
    assert.equal(a.ext, ".crv");
    for (const m of ["detect", "read", "write", "validate"]) assert.equal(typeof a[m], "function", `${a.id}.${m}`);
  }
  const r = smaartTf.read(HDR_LF + "63\t7\n315\t0\n");
  for (const k of ["props", "points", "extraHeader", "lineEnding", "trailingNewline", "warnings"]) assert.ok(k in r, k);
});

// (7) Colour and file names --------------------------------------------------
test("pickerToSmaart('#00ff00') is 'ff00ff00'", () => {
  assert.equal(pickerToSmaart("#00ff00"), "ff00ff00");
});

test("pickerToSmaart prefixes alpha ff and lowercases", () => {
  assert.equal(pickerToSmaart("#FF0000"), "ffff0000");
  assert.equal(pickerToSmaart("#0000FF"), "ff0000ff");
});

test("smaartToPicker drops alpha: 'ffff0000' -> '#ff0000'", () => {
  assert.equal(smaartToPicker("ffff0000"), "#ff0000");
  assert.equal(smaartToPicker("ff00ff00"), "#00ff00");
});

test("smaartToPicker(pickerToSmaart(x)) round trips", () => {
  for (const c of ["#123abc", "#000000", "#ffffff"]) assert.equal(smaartToPicker(pickerToSmaart(c)), c);
});

test("crvFileName appends .crv", () => {
  assert.equal(crvFileName("LA 7dB 315"), "LA 7dB 315.crv");
});

test("crvFileName strips / \\ : * ? \" < > |", () => {
  assert.equal(crvFileName('a/b\\c:d*e?f"g<h>i|j'), "abcdefghij.crv");
  assert.equal(sanitiseFileName('a/b\\c:d*e?f"g<h>i|j'), "abcdefghij");
});

test("crvFileName never produces .crv.txt and handles empty names", () => {
  assert.ok(!crvFileName("x").endsWith(".txt"));
  assert.equal(crvFileName(""), "");
  assert.equal(crvFileName('***'), "");
});
