import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../js/curve.js";
import { newDoc, newLayer, loadDoc } from "../js/doc.js";
import { parseTrace, traceWithTarget, traceCurve, cleanTf } from "../js/trace.js";

// A made-up transfer function text export in the Smaart layout (tab separated, CRLF, a title line, then the header).
const rows = [[20, -10.5, 12.3, 0.9], [100, -3.25, -45, 0.8], [1000, 0, 90.5, 0.95], [4000, 2.75, -170, 0.5], [20000, -6, 33, 0.2]];
const make = (eol = "\r\n") => ["\tMy Mic\t\t", "Frequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence",
  ...rows.map(([f, g, p, c]) => `${f.toFixed(6)}\t${g.toFixed(2)}\t${p.toFixed(2)}\t${c.toFixed(2)}`)].join(eol) + eol;

const withTf = (text, extra = {}) => { const r = parseTrace(text); return { points: r.points, tf: r.tf, offset: 0, smooth: 0, normalise: false, ...extra }; };

test("a Smaart TF text export is recognised and written back byte for byte when the target is 0 dB", () => {
  for (const eol of ["\r\n", "\n"]) {
    const text = make(eol);
    const t = withTf(text);
    assert.ok(t.tf, "layout kept");
    assert.equal(traceWithTarget(t, rows.map(() => 0), true), text);
    assert.equal(traceWithTarget(t, rows.map(() => 0), false), text);
  }
});

test("the target is subtracted (or added) in the magnitude column only; phase, coherence and Hz text are untouched", () => {
  const t = withTf(make());
  const target = [-20, -6, 0, 3.5, -12];
  const sub = traceWithTarget(t, target, true).split("\r\n");
  const add = traceWithTarget(t, target, false).split("\r\n");
  assert.equal(sub[0], "\tMy Mic\t\t");
  assert.equal(sub[1], "Frequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence");
  rows.forEach(([f, g, p, c], i) => {
    const a = sub[2 + i].split("\t");
    const b = add[2 + i].split("\t");
    assert.equal(a[0], f.toFixed(6));
    assert.equal(Number(a[1]), Math.round((g - target[i]) * 100) / 100);
    assert.equal(Number(b[1]), Math.round((g + target[i]) * 100) / 100);
    assert.deepEqual(a.slice(2), [p.toFixed(2), c.toFixed(2)]);
  });
  assert.equal(sub.at(-1), "");
});

test("offset, 0 dB at 1 kHz and smoothing are applied to the trace before the target", () => {
  const target = [1, 2, 3, 4, 5];
  const t = withTf(make(), { offset: 2.5, normalise: true });
  const drawn = traceCurve(t);
  const out = traceWithTarget(t, target, true).split("\r\n").slice(2, 7).map((l) => Number(l.split("\t")[1]));
  out.forEach((v, i) => assert.ok(Math.abs(v - (drawn[i][1] - target[i])) < 0.0051, `row ${i}: ${v}`));
  assert.ok(Math.abs(drawn[2][1] - 2.5) < 1e-9, "1 kHz reads the offset after normalising");
  const s = withTf(make(), { smooth: 3 });
  const outS = traceWithTarget(s, [0, 0, 0, 0, 0], true).split("\r\n").slice(2, 7).map((l) => Number(l.split("\t")[1]));
  traceCurve(s).forEach((p, i) => assert.ok(Math.abs(outS[i] - p[1]) < 0.0051));
});

test("negative zero is never written", () => {
  const t = withTf(make());
  const out = traceWithTarget(t, [0, 0, 0.001, 0, 0], true);
  assert.ok(!/-0\.00(\t|\r)/.test(out));
});

test("the target of a real curve is evaluated at the trace's own frequencies", () => {
  const d = newDoc();
  d.layers.push({ ...newLayer("bell"), fc: 1000, db: 6, q: 2 });
  const t = withTf(make());
  const target = evaluate(d, t.points.map((p) => p[0])).map((p) => p[1]);
  assert.equal(target.length, 5);
  assert.ok(Math.abs(target[2] - 6) < 1e-6, "+6 dB at the bell centre");
  const lines = traceWithTarget(t, target, true).split("\r\n");
  assert.equal(Number(lines[4].split("\t")[1]), -6, "0 dB trace minus the 6 dB bell");
});

test("anything that isn't a TF layout gets no export, and a non-finite target is refused", () => {
  assert.equal(parseTrace("100\t-3\r\n200\t-2\r\n300\t0\r\n").tf, undefined);
  assert.equal(parseTrace("Frequency (Hz)\tLevel (dB)\tX\r\n100\t-3\t1\r\n200\t-2\t1\r\n").tf, undefined);
  assert.equal(parseTrace(make().replace("90.50", "n/a")).tf, undefined, "a bad cell means no layout");
  const t = withTf(make());
  assert.throws(() => traceWithTarget(t, [0, 0, NaN, 0, 0], true), /can't be written/);
  assert.throws(() => traceWithTarget({ points: t.points }, [0, 0, 0, 0, 0], true), /no layout/);
});

test("the layout survives saving and loading (autosave), stays aligned when rows are sorted, and bad layouts are dropped", () => {
  const t = withTf(make());
  const doc = { ...newDoc(), template: { name: "x", ...t, show: true } };
  const back = loadDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(back.template.tf, t.tf);
  // a saved trace with its rows out of order: the layout is re-ordered with the points
  const shuffled = JSON.parse(JSON.stringify(doc));
  const order = [3, 0, 4, 1, 2];
  shuffled.template.points = order.map((i) => t.points[i]);
  shuffled.template.tf.cells = order.map((i) => t.tf.cells[i]);
  assert.deepEqual(loadDoc(shuffled).template.tf, t.tf);
  assert.equal(traceWithTarget(loadDoc(shuffled).template, [0, 0, 0, 0, 0], true), make());
  // hostile or damaged layouts: the trace stays, the layout goes
  const bad = (edit) => { const d = JSON.parse(JSON.stringify(doc)); edit(d.template.tf); return loadDoc(d).template; };
  for (const edit of [
    (tf) => { tf.cells.pop(); },
    (tf) => { tf.cells[1][1] = "<script>"; },
    (tf) => { tf.head = ["a\nb"]; },
    (tf) => { tf.head = new Array(9).fill("x"); },
    (tf) => { tf.eol = "\r"; },
    (tf) => { tf.dp = 99; },
    (tf) => { tf.cells[0] = ["1", "2"]; },
    (tf) => { tf.cells[2][0] = "1".repeat(30); },
  ]) {
    const tpl = bad(edit);
    assert.ok(tpl && tpl.points.length === 5, "the trace itself still loads");
    assert.equal(tpl.tf, undefined);
  }
  assert.equal(cleanTf(null, 5, [0]), null);
});

test("a trace too long to keep as it was can't be downloaded back", () => {
  const lines = ["\tbig\t\t", "Frequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence"];
  for (let i = 1; i <= 1500; i++) lines.push(`${(i * 10).toFixed(6)}\t-3.00\t10.00\t0.90`);
  const r = parseTrace(lines.join("\r\n") + "\r\n");
  assert.equal(r.tf, undefined);
  assert.ok(r.warnings.some((w) => /can't be downloaded back/.test(w)));
});

// ---- frequency-dependent smoothing, peak bias and the coherence mask (SPEC §10)
import { PEAK_BIAS, traceMask } from "../js/trace.js";

/** Brute force: sample the straight-line trace densely and take the window statistic numerically. */
function oracle(points, hz, half, beta) {
  const xs = points.map((p) => Math.log2(p[0]));
  const at = (x) => {
    if (x <= xs[0]) return points[0][1];
    if (x >= xs.at(-1)) return points.at(-1)[1];
    let j = 1;
    while (xs[j] < x) j++;
    return points[j - 1][1] + ((points[j][1] - points[j - 1][1]) * (x - xs[j - 1])) / (xs[j] - xs[j - 1]);
  };
  const c = Math.log2(hz);
  const N = 40000;
  const v = [];
  for (let k = 0; k <= N; k++) v.push(at(c - half + (2 * half * k) / N));
  if (beta === Infinity) return Math.max(...v);
  if (beta === 0) return v.reduce((a, b) => a + b, 0) / v.length;
  const top = Math.max(...v);
  return top + Math.log(v.reduce((a, b) => a + Math.exp(beta * (b - top)), 0) / v.length) / beta;
}

// a bumpy trace: 1/12-octave spacing from 20 Hz to 20 kHz, peaks, a deep null and a narrow spike
const bumpy = [];
for (let i = 0; i <= 120; i++) {
  const f = 20 * 2 ** (i / 12);
  let g = -6 + 3 * Math.sin(i * 1.7) + 2 * Math.cos(i * 0.4);
  if (i === 60) g = -46; // a null
  if (i === 90) g += 9; // a peak
  bumpy.push([Number(f.toFixed(6)), Number(g.toFixed(2))]);
}

test("smoothing that changes with frequency: the window eases from the LF width at 20 Hz to the main width at 20 kHz", () => {
  const t = { points: bumpy, smooth: 12, smoothLf: 3 };
  const out = traceCurve(t);
  const widthAt = (hz) => { const u = (Math.log2(hz) - Math.log2(20)) / (Math.log2(20000) - Math.log2(20)); return (1 / 3 + (1 / 12 - 1 / 3) * u); };
  for (const i of [10, 30, 60, 80, 100]) {
    const hz = bumpy[i][0];
    assert.ok(Math.abs(out[i][1] - oracle(bumpy, hz, widthAt(hz) / 2, 0)) < 2e-3, `row ${i}`);
  }
  // same at both ends is the old fixed-width smoothing, and "off" at one end leaves that end raw
  assert.deepEqual(traceCurve({ points: bumpy, smooth: 6, smoothLf: 6 }), traceCurve({ points: bumpy, smooth: 6 }));
  const lfOnly = traceCurve({ points: bumpy, smooth: 0, smoothLf: 3 });
  assert.notEqual(lfOnly[0][1], bumpy[0][1]);
  assert.equal(lfOnly.at(-1)[1], bumpy.at(-1)[1]);
});

test("peak bias: matches a brute-force soft maximum, rises with the setting, and a null barely moves it", () => {
  const half = 1 / 6; // 1/3 octave
  const levels = PEAK_BIAS.map((_, k) => traceCurve({ points: bumpy, smooth: 3, peak: k })[60][1]);
  PEAK_BIAS.forEach((beta, k) => {
    for (const i of [30, 60, 90]) {
      const got = traceCurve({ points: bumpy, smooth: 3, peak: k })[i][1];
      assert.ok(Math.abs(got - oracle(bumpy, bumpy[i][0], half, beta)) < 2e-3, `peak ${k}, row ${i}: ${got}`);
    }
  });
  for (let k = 1; k < levels.length; k++) assert.ok(levels[k] >= levels[k - 1] - 1e-9, "never goes down as the bias goes up");
  // the null at row 60 drags the plain average down far more than the strongest bias
  const neighbours = bumpy.map((p, i) => (i === 60 ? [p[0], (bumpy[59][1] + bumpy[61][1]) / 2] : p));
  const drop = (k) => traceCurve({ points: neighbours, smooth: 3, peak: k })[60][1] - traceCurve({ points: bumpy, smooth: 3, peak: k })[60][1];
  assert.ok(drop(0) > 4, `plain average: the null costs ${drop(0)} dB`);
  assert.ok(drop(3) < drop(0) / 3 && drop(4) < 1e-9, `strong ${drop(3)} dB, hold ${drop(4)} dB, plain ${drop(0)} dB`);
  // with no smoothing there is no window, so peak bias does nothing
  assert.deepEqual(traceCurve({ points: bumpy, peak: 3 }), traceCurve({ points: bumpy }));
});

test("coherence mask: low-coherence rows take no part in smoothing and are bridged when smoothing is off", () => {
  const text = make();
  const t = withTf(text, { cohOn: true, cohMin: 0.6 });
  const mask = traceMask(t);
  assert.deepEqual([mask.active, mask.kept, mask.total, mask.keep], [true, 3, 5, [true, true, true, false, false]]);
  const out = traceCurve(t);
  assert.equal(out[0][1], -10.5);
  assert.equal(out[2][1], 0);
  // the 4 kHz and 20 kHz rows (coherence 0.5 and 0.2) are held at the last good level, 1 kHz
  assert.equal(out[3][1], 0);
  assert.equal(out[4][1], 0);
  // a bridged row between two good ones is a straight line against log frequency
  const mid = withTf(make().replace("0.80\r\n", "0.10\r\n"), { cohOn: true, cohMin: 0.5 });
  const bridged = traceCurve(mid)[1][1];
  const f = (hz) => Math.log2(hz);
  const expect = -10.5 + ((0 - -10.5) * (f(100) - f(20))) / (f(1000) - f(20));
  assert.ok(Math.abs(bridged - expect) < 1e-5, `${bridged} vs ${expect}`);
  // too few good rows: the mask switches itself off
  const none = traceMask(withTf(text, { cohOn: true, cohMin: 0.99 }));
  assert.deepEqual([none.active, none.kept], [false, 0]);
  // no coherence column (a plain two-column trace): nothing to mask
  assert.equal(traceMask({ points: bumpy, cohOn: true, cohMin: 0.9 }).available, false);
  // smoothing ignores the masked rows: an extreme value in a masked row changes nothing
  const spiky = withTf(make().replace("-6.00\t33.00\t0.20", "50.00\t33.00\t0.20"), { cohOn: true, cohMin: 0.6, smooth: 1 });
  const calm = withTf(make(), { cohOn: true, cohMin: 0.6, smooth: 1 });
  assert.deepEqual(traceCurve(spiky).slice(0, 3), traceCurve(calm).slice(0, 3));
});

test("the download follows the smoothing, peak bias and coherence mask", () => {
  const t = withTf(make(), { cohOn: true, cohMin: 0.6, smooth: 1, smoothLf: 3, peak: 2 });
  const shown = traceCurve(t);
  const out = traceWithTarget(t, [0, 0, 0, 0, 0], true).split("\r\n").slice(2, 7).map((l) => Number(l.split("\t")[1]));
  out.forEach((v, i) => assert.ok(Math.abs(v - shown[i][1]) < 0.0051));
});

test("the new trace settings load safely and bad ones are dropped", () => {
  const t = withTf(make());
  const base = { ...newDoc(), template: { name: "x", ...t, show: true, smoothLf: 3, peak: 2, cohOn: true, cohMin: 0.7 } };
  const ok = loadDoc(JSON.parse(JSON.stringify(base))).template;
  assert.deepEqual([ok.smoothLf, ok.peak, ok.cohOn, ok.cohMin], [3, 2, true, 0.7]);
  const bad = loadDoc(JSON.parse(JSON.stringify({ ...base, template: { ...base.template, smoothLf: 5, peak: 9, cohOn: "yes", cohMin: 7 } }))).template;
  assert.equal(bad.smoothLf, undefined);
  assert.equal(bad.peak, undefined);
  assert.equal(bad.cohOn, undefined);
  assert.equal(bad.cohMin, 1);
  const none = loadDoc(JSON.parse(JSON.stringify({ ...base, template: { ...base.template, tf: undefined } }))).template;
  assert.equal(none.cohOn, undefined, "no layout, no coherence mask");
});

test("0 dB at the 1 to 4 kHz average: the mean over log frequency of the straight-line trace, not of the points", () => {
  // dense points between 1 and 2 kHz, sparse between 2 and 4 kHz: a mean of the points would lean to the dense part
  const pts = [[500, -3]];
  for (let i = 0; i <= 40; i++) pts.push([1000 * 2 ** (i / 40), -10]);
  pts.push([4000, -2], [8000, -2]);
  const raw = pts.map((p) => p[1]);
  const t = { points: pts, normalise: true, normAvg: true, offset: 1.5 };
  const out = traceCurve(t);
  // 1 to 2 kHz is flat -10 (one octave); 2 to 4 kHz runs straight from -10 to -2 (mean -6): the band mean is -8
  const shift = 1.5 + 8;
  out.forEach((p, i) => assert.ok(Math.abs(p[1] - (raw[i] + shift)) < 1e-5, `row ${i}: ${p[1]}`));
  // the same band, measured on the output, reads the offset
  const band = oracle(out, 2000, 1, 0);
  assert.ok(Math.abs(band - 1.5) < 2e-3, `band mean ${band}`);
  // 1 kHz reference still available and different; a trace that stops short of 4 kHz is left alone
  assert.notDeepEqual(traceCurve({ ...t, normAvg: false }), out);
  const short = traceCurve({ points: pts.slice(0, 20), normalise: true, normAvg: true });
  assert.deepEqual(short.map((p) => p[1]), pts.slice(0, 20).map((p) => p[1]));
  assert.equal(loadDoc(JSON.parse(JSON.stringify({ ...newDoc(), template: { points: pts, normAvg: true } }))).template.normAvg, true);
  assert.equal(loadDoc(JSON.parse(JSON.stringify({ ...newDoc(), template: { points: pts, normAvg: "yes" } }))).template.normAvg, undefined);
});
