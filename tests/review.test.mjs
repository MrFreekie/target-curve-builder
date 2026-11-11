import test from "node:test";
import assert from "node:assert/strict";
import { interpPoints } from "../js/layers.js";
import { pos, NOMINAL_3 } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, docFromImport, addImportedLayer } from "../js/doc.js";
import { buildCrv } from "../js/build.js";

/** The earlier interpPoints, kept here as the reference the faster one must match exactly. */
function oldInterp(f, points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  const x = pos(f);
  if (x <= pos(pts[0][0])) return pts[0][1];
  if (x >= pos(pts[pts.length - 1][0])) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pos(pts[i][0]);
    const x1 = pos(pts[i + 1][0]);
    if (x >= x0 && x <= x1) return x1 === x0 ? pts[i][1] : pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("interpPoints: the faster search gives exactly the earlier answers, including clusters on nominal labels", () => {
  const r = rng(7);
  for (let round = 0; round < 60; round++) {
    const n = [2, 5, 40, 70, 200, 600][round % 6];
    const pts = [];
    for (let i = 0; i < n; i++) {
      const nominal = r() < 0.3;
      const f = nominal ? NOMINAL_3[Math.floor(r() * NOMINAL_3.length)] * (r() < 0.5 ? 1 : 1 + (r() - 0.5) * 0.02) : 20 * 1000 ** r();
      pts.push([f, (r() - 0.5) * 40]);
    }
    const input = round % 3 === 0 ? pts : [...pts].sort((a, b) => a[0] - b[0]); // some unsorted
    for (let k = 0; k < 400; k++) {
      const f = r() < 0.4 ? NOMINAL_3[Math.floor(r() * NOMINAL_3.length)] * (1 + (r() - 0.5) * 0.02) : 10 * 3000 ** r();
      assert.ok(Object.is(interpPoints(f, input), oldInterp(f, input)), `round ${round}, f ${f}`);
    }
  }
});

test("loadDoc: a header line must be its own key and colon, and its value is read from the line, not trusted", () => {
  const withHeader = (h) => ({ ...JSON.parse(JSON.stringify(newDoc())), props: { ...newDoc().props, rawHeader: [h] } });
  // a doctored "parsed" that matches the current setting but not the line: the writer must not copy the line
  const d = loadDoc(withHeader({ key: "line", raw: "Line:\t9999", parsed: 2 }));
  assert.equal(d.props.rawHeader[0].parsed, 9999);
  const out = buildCrv(d).text;
  assert.match(out, /^Line:\t2\r\n/, "the canonical line is written");
  assert.ok(!out.includes("9999"));
  for (const bad of [{ key: "line", raw: "Linefoo 3", parsed: 3 }, { key: "line", raw: "Color:\tff0000ff", parsed: "ff0000ff" }, { key: "line", raw: "Line 2", parsed: 2 }]) {
    assert.throws(() => loadDoc(withHeader(bad)), /Invalid header/);
  }
  // a genuine imported header still round trips
  const ok = loadDoc(withHeader({ key: "color", raw: "Color:\tFF00FF00", parsed: "ff00ff00" }));
  assert.equal(ok.props.rawHeader[0].parsed, "ff00ff00");
  assert.equal(loadDoc(withHeader({ key: "comment", raw: "Comment:\thello", parsed: null })).props.rawHeader[0].parsed, null);
});

test("loadDoc caps the total number of points across layers and the original", () => {
  const pts = (n) => Array.from({ length: n }, (_, i) => [20 + i, 0]);
  const doc = (layers, original = null) => ({ ...JSON.parse(JSON.stringify(newDoc())), layers, original });
  const layer = (n) => ({ ...newLayer("points"), points: pts(n) });
  assert.ok(loadDoc(doc([layer(5000), layer(5000), layer(5000)], pts(4999))));
  assert.throws(() => loadDoc(doc([layer(5000), layer(5000), layer(5000), layer(5000)], pts(1))), /Too many points in total/);
  assert.throws(() => loadDoc(doc([layer(5000), layer(5000), layer(5000), layer(4000)], pts(1100))), /Too many points in total/);
});

const HDR = "Line:\t2\r\nColor:\tffff0000\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3\r\nUseTolerance:\t0\r\n\r\n";

test("import sorts the rows and drops repeated frequencies, with a warning; an ordered file is untouched", () => {
  const messy = HDR + "200\t3\r\n20\t1\r\n100\t2\r\n100\t9\r\n";
  const { doc, warnings } = docFromImport(messy, "messy.crv");
  assert.deepEqual(doc.original, [[20, 1], [100, 2], [200, 3]]);
  assert.deepEqual(doc.layers.find((l) => l.kind === "points").points, doc.original);
  assert.ok(warnings.some((w) => /ascending/.test(w) && /1 repeated frequency was dropped/.test(w)), warnings.join("|"));
  assert.equal(buildCrv(doc).issues.filter((i) => i.level === "error").length, 0, "it can now be exported");
  const added = addImportedLayer(newDoc(), messy, "messy.crv");
  assert.deepEqual(added.doc.layers.at(-1).points, [[20, 1], [100, 2], [200, 3]]);
  assert.ok(added.warnings.some((w) => /ascending/.test(w)));
  const tidy = docFromImport(HDR + "20\t1\r\n100\t2\r\n", "tidy.crv");
  assert.deepEqual(tidy.warnings, []);
  assert.throws(() => docFromImport(HDR + "50\t1\r\n50\t2\r\n", "same.crv"), /fewer than 2 different frequencies/);
});

import { shapeDb } from "../js/eq.js";
import { evaluate } from "../js/curve.js";
import { parseTrace } from "../js/trace.js";

test("semicircle: a frequency within 1e-12 of an edge counts as on the edge, from inside as well as outside", () => {
  const fc = 1000;
  for (const w of [0.1, 2, 10]) {
    for (const nudge of [-1e-13, 1e-13, 0]) {
      for (const sign of [-1, 1]) {
        const f = fc * 2 ** (sign * (w / 2) * (1 + nudge));
        assert.equal(shapeDb("semicircle", f, fc, w, 60), 0, `width ${w}, nudge ${nudge}, side ${sign}`);
      }
    }
  }
});

test("a trace with more than 1200 points far below 1 Hz keeps only positive, distinct frequencies", () => {
  const rows = Array.from({ length: 1300 }, (_, i) => `${1e-7 * (i + 1)} 1`).join("\n");
  const t = parseTrace(rows + "\n20 1\n40 2\n");
  assert.ok(t.points.every((p, i) => p[0] > 0 && (i === 0 || p[0] > t.points[i - 1][0])));
});

test("Breakpoints only on Keep original also keeps the layer corners inside the imported range and the trim ends", () => {
  const d = newDoc();
  d.original = [[25, 0], [100, 3], [1000, 0], [16000, -2]];
  d.layers.find((l) => l.kind === "points").points = d.original.map((p) => [...p]);
  const hpf = d.layers.find((l) => l.kind === "hpf");
  Object.assign(hpf, { on: true, fc: 40, type: "LR", slope: 48 });
  d.grid = { ...d.grid, mode: "original", simplify: true, epsilon: 0.02 };
  const f = evaluate(d).map((p) => p[0]);
  assert.ok(f.includes(40), "the HPF corner is kept");
  assert.ok(!f.includes(20) && !f.includes(20000), "the grid ends are not added: only the imported range counts");
  assert.equal(f[0], 25);
  assert.equal(f.at(-1), 16000);
  d.grid.trimLow = 30;
  d.grid.trimHigh = 12000;
  const g = evaluate(d).map((p) => p[0]);
  assert.equal(g[0], 30);
  assert.equal(g.at(-1), 12000);
  assert.ok(g.every((x, i) => i === 0 || x > g[i - 1]));
  // straight lines between the kept points stay within epsilon of the curve at the imported points and corners
  const out = evaluate(d);
  const full = evaluate(d, out.map((p) => p[0]));
  assert.deepEqual(out, full);
});

import { totalPoints, MAX_TOTAL_POINTS } from "../js/doc.js";

test("adding an imported file can't take a document past the total point limit, so a saved document always loads again", () => {
  const rows = (n, f0) => Array.from({ length: n }, (_, i) => `${f0 + i}\t0`).join("\r\n");
  const crv = (n, f0) => HDR + rows(n, f0) + "\r\n";
  let { doc } = docFromImport(crv(5000, 20), "a.crv");
  let adds = 0;
  assert.throws(() => {
    for (let i = 0; i < 10; i++) { doc = addImportedLayer(doc, crv(5000, 20), `b${i}.crv`).doc; adds++; }
  }, /past 20000 points in total/);
  assert.ok(adds >= 2 && totalPoints(doc) <= MAX_TOTAL_POINTS);
  assert.doesNotThrow(() => loadDoc(JSON.parse(JSON.stringify(doc))), "what the app can build always loads again");
});

test("a header line may not start with spaces before its key", () => {
  const bad = { ...JSON.parse(JSON.stringify(newDoc())), props: { ...newDoc().props, rawHeader: [{ key: "line", raw: " Line: 2", parsed: 2 }] } };
  assert.throws(() => loadDoc(bad), /Invalid header/);
});

test("Breakpoints only on Keep original: no repeated 6-decimal frequencies, and a trim past the imported data doesn't widen it", () => {
  const d = newDoc();
  d.original = [[20, 0], [707.1067818, 0], [1000, 0], [20000, 0]];
  d.layers.find((l) => l.kind === "points").points = [[20, 0], [20000, 0]];
  d.layers.push({ ...newLayer("shape"), shape: "box", fc: 1000.0000009, width: 1, db: 10 });
  d.grid = { ...d.grid, mode: "original", simplify: true, epsilon: 0.02 };
  const six = evaluate(d).map((p) => p[0].toFixed(6));
  assert.equal(new Set(six).size, six.length, "every 6-decimal frequency appears once");
  const e = newDoc();
  e.original = [[20, 0], [200, 0], [20000, 0]];
  e.layers.find((l) => l.kind === "points").points = [[10, 0], [15, 10], [20, 0], [20000, 0]];
  e.grid = { ...e.grid, mode: "original", simplify: true, epsilon: 0.02, trimLow: 10, trimHigh: 100000 };
  const out = evaluate(e).map((p) => p[0]);
  assert.equal(out[0], 20);
  assert.equal(out.at(-1), 20000);
});
