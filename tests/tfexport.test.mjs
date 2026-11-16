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
