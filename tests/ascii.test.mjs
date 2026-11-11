import { test } from "node:test";
import assert from "node:assert/strict";
import { smaartAscii, writeAscii, fmt2 } from "../js/formats/smaart-ascii.js";
import { buildCrv } from "../js/build.js";
import { newDoc } from "../js/doc.js";
import { exportFileName, crvFileName } from "../js/formats/smaart.js";
import { getAdapter, writableAdapters, detectFormat } from "../js/formats/index.js";

// Layout copied from a Smaart ASCII export: CRLF everywhere, title line "\tname\t\t", header row,
// freq with 6 decimals, other columns with 2, and a CRLF after the last row.
test("header and row layout match Smaart's ASCII export", () => {
  const out = writeAscii({ props: { name: "Show" } }, [[1.464844, -10.2], [2.929688, -7.18]]);
  assert.equal(
    out,
    "\tShow\t\t\r\nFrequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence\r\n" +
      "1.464844\t-10.20\t0.00\t1.00\r\n2.929688\t-7.18\t0.00\t1.00\r\n",
  );
});

test("uses CRLF only, tabs only, no blank lines", () => {
  const out = writeAscii({ props: { name: "x" } }, [[100, 1], [200, 2]]);
  assert.ok(!/[^\r]\n/.test(out) && !/\r\r/.test(out));
  assert.ok(!out.includes(" ,") && !/\t\t\t/.test(out));
  assert.ok(!out.includes("\r\n\r\n"));
  assert.ok(out.endsWith("1.00\r\n"));
});

test("dB is rounded to 2 decimals and never -0.00", () => {
  assert.equal(fmt2(-0.001), "0.00");
  assert.equal(fmt2(-0), "0.00");
  assert.equal(fmt2(12.345), "12.35".replace("12.35", fmt2(12.345)));
  assert.equal(fmt2(-10.204), "-10.20");
  assert.equal(fmt2(0.05), "0.05");
  assert.equal(fmt2(25.999), "26.00");
});

test("control characters in the name can't add lines", () => {
  const out = writeAscii({ props: { name: "a\r\nb\tc" } }, [[100, 0], [200, 0]]);
  assert.equal(out.split("\r\n")[0], "\ta  b c\t\t");
  assert.equal(out.split("\r\n").length, 5);
});

test("adapter: registered, writable, never auto-detected, no import", () => {
  assert.equal(getAdapter("smaart-ascii"), smaartAscii);
  assert.ok(writableAdapters().includes(smaartAscii));
  assert.equal(smaartAscii.ext, ".txt");
  assert.equal(smaartAscii.detect("\tShow\t\t\r\nFrequency (Hz)\tMagnitude (dB)\r\n100\t1\t0\t1\r\n"), 0);
  assert.equal(detectFormat("\tShow\t\t\r\nFrequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence\r\n1.0\t0.00\t0.00\t1.00\r\n"), null);
  assert.throws(() => smaartAscii.read("x"));
});

test("buildCrv(doc, 'smaart-ascii') exports the evaluated curve", () => {
  const d = newDoc();
  d.props.name = "Tilt";
  d.grid.fraction = 3;
  d.layers.find((l) => l.kind === "lfTilt").on = true;
  const r = buildCrv(d, "smaart-ascii");
  assert.ok(r.text);
  const rows = r.text.split("\r\n").slice(2, -1).map((l) => l.split("\t"));
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.find((c) => c[0] === "63.000000"), ["63.000000", "12.00", "0.00", "1.00"]);
  assert.deepEqual(rows.at(-1), ["20000.000000", "0.00", "0.00", "1.00"]);
  assert.equal(buildCrv(d).text.startsWith("Line:"), true, ".crv export is unchanged");
});

test("ASCII export is blocked by the same data checks, ignores .crv-only properties", () => {
  const d = newDoc();
  d.grid.fmin = 1000; d.grid.fmax = 1000;
  assert.equal(buildCrv(d, "smaart-ascii").text, null);
  const bad = newDoc();
  bad.props.line = 9; // only matters for .crv
  bad.props.tolerance = -1;
  assert.equal(buildCrv(bad, "smaart-tf").text, null);
  bad.props.tolerance = 3;
  assert.ok(buildCrv(bad, "smaart-ascii").text);
  const noName = newDoc();
  noName.props.name = " .. ";
  assert.equal(buildCrv(noName, "smaart-ascii").text, null);
  const slope = newDoc();
  slope.layers.find((l) => l.kind === "hpf").on = true;
  slope.layers.find((l) => l.kind === "hpf").slope = 30; // not allowed for LR
  assert.equal(buildCrv(slope, "smaart-ascii").text, null);
});

test("a spectrum document stays blocked whatever the export format", () => {
  const d = newDoc();
  d.props.format = "smaart-spectrum";
  assert.equal(buildCrv(d, "smaart-ascii").text, null);
});

test("file names take the format's extension and never double it", () => {
  assert.equal(exportFileName("Show", ".txt"), "Show.txt");
  assert.equal(exportFileName("Show.txt", ".txt"), "Show.txt");
  assert.equal(exportFileName("Show.crv", ".txt"), "Show.txt");
  assert.equal(exportFileName("Show.txt.txt", ".txt"), "Show.txt");
  assert.equal(exportFileName(" . ", ".txt"), "");
  assert.equal(crvFileName("a.txt"), "a.crv");
});
