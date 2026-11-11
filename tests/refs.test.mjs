import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, denseGrid, makeGrid, pos } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, isBlank } from "../js/doc.js";
import { writePlainText } from "../js/formats/plain-text.js";
import { getAdapter } from "../js/formats/index.js";
import { parseTrace, traceCurve, MAX_TRACE_POINTS } from "../js/trace.js";
import { encodeShare, decodeShare, MAX_SHARE_JSON } from "../js/share.js";
import { buildCrv } from "../js/app.js";

const bellDoc = (extra = {}) => {
  const d = newDoc();
  d.layers.push({ ...newLayer("bell"), fc: 1000, db: 6, q: 2 });
  d.grid = { ...d.grid, ...extra };
  return d;
};

test("breakpoints only on a chosen grid: fewer points, every point is on that grid or a corner, within epsilon", () => {
  for (const fraction of [1, 3, 6, 12, 24, 48]) {
    const full = bellDoc({ fraction });
    const simp = bellDoc({ fraction, simplify: true, epsilon: 0.1 });
    const a = evaluate(full);
    const b = evaluate(simp);
    assert.ok(b.length < a.length || a.length <= 11, `1/${fraction}: ${b.length} < ${a.length}`);
    const allowed = new Set([...makeGrid({ fraction, fmin: 20, fmax: 20000 }), 20, 20000, 1000].map((f) => f));
    const corners = new Set(denseGrid(simp, fraction));
    for (const [f] of b) assert.ok(corners.has(f) || allowed.has(f), `${fraction}: ${f} is a candidate`);
    // straight lines between the kept points stay within epsilon of the full curve at the grid's own points
    const dense = evaluate(simp, denseGrid(simp, fraction));
    for (const [f, g] of dense) {
      let lo = b[0];
      let hi = b.at(-1);
      for (let i = 1; i < b.length; i++) if (b[i][0] >= f) { lo = b[i - 1]; hi = b[i]; break; }
      const t = hi[0] === lo[0] ? 0 : (pos(f) - pos(lo[0])) / (pos(hi[0]) - pos(lo[0]));
      assert.ok(Math.abs(lo[1] + t * (hi[1] - lo[1]) - g) <= 0.1 + 1e-6, `1/${fraction} at ${f}`);
    }
  }
});

test("the older simplified mode is the same as breakpoints only on 1/48 octave", () => {
  const old = bellDoc();
  old.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.1 };
  const now = bellDoc({ mode: "resample", fraction: 48, simplify: true, epsilon: 0.1 });
  assert.deepEqual(evaluate(old), evaluate(now));
  const back = loadDoc(JSON.parse(JSON.stringify(old)));
  assert.deepEqual([back.grid.mode, back.grid.fraction, back.grid.simplify], ["resample", 48, true]);
  assert.deepEqual(evaluate(back), evaluate(now));
});

test("simplify with Keep original reduces the imported frequencies", () => {
  const d = newDoc();
  d.original = makeGrid({ fraction: 24, fmin: 20, fmax: 20000 }).map((f) => [f, 0]);
  d.grid = { ...d.grid, mode: "original", simplify: true, epsilon: 0.1 };
  const out = evaluate(d);
  assert.deepEqual(out.map((p) => p[0]), [d.original[0][0], d.original.at(-1)[0]], "a flat curve needs only its two ends");
});

test("plain text export: tab separated, Hz to 3 and dB to 2 decimals, CRLF, no -0, valid through buildCrv", () => {
  assert.equal(writePlainText({}, [[20, -0], [1000.5, 3.25]]), "20.000\t0.00\r\n1000.500\t3.25\r\n");
  const d = bellDoc({ fraction: 3 });
  const r = buildCrv(d, "plain-text");
  assert.ok(r.text && !r.text.includes("Line:"));
  assert.equal(r.text.split("\r\n").length - 1, r.points.length);
  assert.equal(getAdapter("plain-text").ext, ".txt");
});

test("parseTrace reads REW, Smaart ASCII and plain text, skips headers, sorts and drops repeats", () => {
  const rew = parseTrace("* REW export\nFreq(Hz) SPL(dB) Phase(degrees)\n1000 75.5 3\n20 70 0\n100 72 1\n100 99 1\n");
  assert.deepEqual(rew.points, [[20, 70], [100, 72], [1000, 75.5]]);
  assert.equal(rew.warnings.length, 1);
  const ascii = parseTrace("\tMy trace\t\t\r\nFrequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence\r\n20.0\t-3.00\t0.00\t1.00\r\n40.0\t-2.00\t0.00\t1.00\r\n");
  assert.deepEqual(ascii.points, [[20, -3], [40, -2]]);
  assert.deepEqual(parseTrace("20,1\n40;2\n").points, [[20, 1], [40, 2]]);
  const crv = parseTrace("Line:\t2\r\nColor:\tff0000ff\r\nShow:\t1\r\nType:\tTF\r\nTolerance:\t3\r\nUseTolerance:\t0\r\n\r\n20\t1\r\n40\t2\r\n");
  assert.equal(crv.source, "smaart-tf");
  assert.throws(() => parseTrace("hello\nworld\n"), /No frequency and level/);
  assert.throws(() => parseTrace("0 5\n-3 4\n"), /No frequency and level|at least 2/);
  assert.throws(() => parseTrace("x".repeat(5_000_001)), /too large/);
});

test("parseTrace averages a very long trace into 1/48-octave bins", () => {
  const rows = [];
  for (let i = 0; i < 6000; i++) rows.push(`${(20 + i * 3.33).toFixed(2)} ${(i % 7) - 3}`);
  const r = parseTrace(rows.join("\n"));
  assert.ok(r.points.length <= MAX_TRACE_POINTS && r.points.length > 100);
  assert.ok(r.points.every((p, i) => i === 0 || p[0] > r.points[i - 1][0]));
  assert.ok(r.warnings.some((w) => /averaged/.test(w)));
});

test("traceCurve: offset, 0 dB at 1 kHz, smoothing", () => {
  const points = [[20, 10], [100, 10], [1000, 20], [10000, 10], [20000, 10]];
  assert.deepEqual(traceCurve({ points, offset: 5 }).map((p) => p[1]), [15, 15, 25, 15, 15]);
  assert.equal(traceCurve({ points, normalise: true })[2][1], 0);
  assert.equal(traceCurve({ points, normalise: true, offset: 3 })[2][1], 3);
  const noCover = [[2000, 5], [4000, 7]];
  assert.deepEqual(traceCurve({ points: noCover, normalise: true }), noCover, "no 1 kHz in range: nothing to shift");
  const flat = [[20, 3], [200, 3], [2000, 3]];
  assert.deepEqual(traceCurve({ points: flat, smooth: 6 }), flat, "smoothing a flat trace changes nothing");
  const smoothed = traceCurve({ points, smooth: 1 });
  assert.ok(smoothed[2][1] < 20 && smoothed[2][1] > 10, "the peak is flattened");
  assert.ok(smoothed.every(([, g]) => Number.isFinite(g)));
});

test("a reference trace survives loadDoc, is cleaned, and makes the document not blank", () => {
  const d = newDoc();
  assert.equal(isBlank(d), true);
  d.template = { name: "Room\tA", points: [[100, 1], [20, 3], [20, 4], [1000, 2]], offset: 500, smooth: 7, normalise: true, show: false };
  assert.equal(isBlank(d), false);
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.template, { name: "Room A", points: [[20, 3], [100, 1], [1000, 2]], offset: 60, smooth: 0, normalise: true, show: false });
  for (const bad of [null, 5, "x", { points: [[1, 1]] }, { points: "no" }, { points: Array.from({ length: MAX_TRACE_POINTS + 1 }, (_, i) => [i + 1, 0]) }, { points: [[-1, 1], [2, 2]] }]) {
    assert.equal("template" in loadDoc({ ...JSON.parse(JSON.stringify(newDoc())), template: bad }), false, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.equal("template" in loadDoc(JSON.parse(JSON.stringify(newDoc()))), false);
});

test("share links: round trip, leaves the original and trace out, and is small for a normal curve", async () => {
  const d = bellDoc({ fraction: 12 });
  d.props.name = "My curve";
  d.original = [[20, 0], [200, 1]];
  d.template = { name: "t", points: [[20, 1], [200, 2]], offset: 0, smooth: 0, normalise: false, show: true };
  d.grid.mode = "original";
  const text = await encodeShare(d);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.ok(text.length < 1000, `link length ${text.length}`);
  const back = await decodeShare(text);
  assert.equal(back.props.name, "My curve");
  assert.equal(back.original, null);
  assert.equal("template" in back, false);
  assert.equal(back.grid.mode, "resample");
  assert.deepEqual(back.layers.map((l) => [l.kind, l.on]), d.layers.map((l) => [l.kind, l.on]));
  const plain = bellDoc({ fraction: 12 });
  assert.deepEqual(evaluate(await decodeShare(await encodeShare(plain))), evaluate(plain));
});

test("share links: bad, hostile and oversized links are refused with a readable error", async () => {
  for (const bad of ["", "not base64!!", "AAAA", "x".repeat(200_001), "////", "eyJ2IjoxfQ", null, 5]) {
    await assert.rejects(() => decodeShare(bad), (e) => e instanceof Error && /link/.test(e.message), String(bad).slice(0, 20));
  }
  // a tiny link that unpacks past the limit is stopped
  const big = JSON.stringify({ v: 1, doc: { pad: "a".repeat(MAX_SHARE_JSON + 10) } });
  const packed = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const b64 = Buffer.from(packed).toString("base64url");
  assert.ok(b64.length < 20_000);
  await assert.rejects(() => decodeShare(b64), /too large/);
  // valid compressed JSON with the wrong version, or a document that fails validation
  const enc = async (o) => Buffer.from(new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())).toString("base64url");
  { const t = await enc({ v: 2, doc: {} }); await assert.rejects(() => decodeShare(t), /different version/); }
  { const t = await enc({ v: 1, doc: { version: 1, layers: [{ kind: "__proto__" }] } }); await assert.rejects(() => decodeShare(t), /Unknown layer/); }
  { const t = await enc({ v: 1, doc: { version: 1, layers: Array.from({ length: 60 }, () => ({ kind: "gain" })) } }); await assert.rejects(() => decodeShare(t), /Invalid layer list/); }
  const proto = await decodeShare(await enc({ v: 1, doc: { version: 1, layers: [], __proto__: { polluted: 1 }, props: JSON.parse('{"__proto__":{"polluted":1}}') } }));
  assert.equal({}.polluted, undefined);
  assert.equal(proto.layers.length, 0);
});
