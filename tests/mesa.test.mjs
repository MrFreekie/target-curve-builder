import { test } from "node:test";
import assert from "node:assert/strict";
import { mesaDb } from "../js/eq.js";
import { layerDb } from "../js/layers.js";
import { evaluate, keyFrequencies } from "../js/curve.js";
import { newDoc, newLayer, loadDoc, LAYER_KINDS } from "../js/doc.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/app.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
// Reference written from the definition: two raised-cosine steps (half a cosine cycle against log2 f), summed.
const step = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : (1 - Math.cos(Math.PI * t)) / 2);
const ref = (f, fl, fh, wl, wh, db) => db * Math.max(0, Math.min(1, step(Math.log2(f / fl) / wl + 0.5) - step(Math.log2(f / fh) / wh + 0.5)));
const m = (o = {}) => ({ kind: "mesa", on: true, fLow: 80, fHigh: 400, wLow: 1, wHigh: 2, db: 6, ...o });

test("matches the two-raised-cosine-steps definition everywhere, for many settings", () => {
  for (const [fl, fh, wl, wh, db] of [[80, 400, 1, 2, 6], [100, 8000, 0.25, 4, -9], [63, 125, 0.5, 0.5, 12], [20, 20000, 3, 3, 3], [1000, 1200, 0.1, 6, -20]]) {
    for (let f = 5; f < 40000; f *= 1.07) close(mesaDb(f, fl, fh, wl, wh, db), ref(f, fl, fh, wl, wh, db), 1e-12, `${fl}-${fh} at ${f}`);
  }
});

test("the edges are the half-gain points, and the flat top is the full gain", () => {
  close(mesaDb(80, 80, 400, 1, 2, 6), 3, 1e-12, "lower edge");
  close(mesaDb(400, 80, 400, 1, 2, 6), 3, 1e-12, "upper edge");
  // the flat top runs from the end of the lower flank (113 Hz) to the start of the upper flank (200 Hz)
  for (const f of [114, 130, 160, 199]) close(mesaDb(f, 80, 400, 1, 2, 6), 6, 1e-12, `flat top at ${f}`);
  close(mesaDb(20, 80, 400, 1, 2, 6), 0, 0, "far below");
  close(mesaDb(20000, 80, 400, 1, 2, 6), 0, 0, "far above");
});

test("each flank ends exactly one half-width either side of its edge, with zero slope there", () => {
  // lower flank: 80 Hz, 1 octave wide: from 80/2^0.5 to 80*2^0.5
  close(mesaDb(80 * 2 ** -0.5, 80, 400, 1, 2, 6), 0, 1e-12, "bottom of the lower flank");
  close(mesaDb(80 * 2 ** 0.5, 80, 400, 1, 2, 6), 6, 1e-12, "top of the lower flank");
  // upper flank: 400 Hz, 2 octaves wide: from 200 to 800
  close(mesaDb(400 * 2 ** -1, 80, 400, 1, 2, 6), 6, 1e-12, "top of the upper flank");
  close(mesaDb(400 * 2 ** 1, 80, 400, 1, 2, 6), 0, 1e-12, "bottom of the upper flank");
  const e = 1e-6;
  const d = (f) => (mesaDb(f * 2 ** e, 80, 400, 1, 2, 6) - mesaDb(f, 80, 400, 1, 2, 6)) / e;
  close(d(80 * 2 ** -0.5), 0, 1e-4, "slope at the foot");
  close(d(80 * 2 ** 0.5 - 1e-3), 0, 5e-3, "slope at the shoulder");
});

test("asymmetric: the two sides have different slopes, set independently", () => {
  // half-way down each flank the slope is the steepest: (pi/2) * gain / width per octave (dB/oct)
  const slopeAt = (f, o) => (mesaDb(f * 2 ** 1e-6, 80, 400, o.wl, o.wh, 6) - mesaDb(f, 80, 400, o.wl, o.wh, 6)) / 1e-6;
  const o = { wl: 1, wh: 2 };
  close(slopeAt(80, o), (Math.PI / 2) * 6 / 1, 1e-4, "lower flank, 1 octave wide: +9.42 dB/oct");
  close(slopeAt(400, o), -(Math.PI / 2) * 6 / 2, 1e-4, "upper flank, 2 octaves wide: -4.71 dB/oct");
  // changing one width leaves the other flank exactly as it was, wherever the two flanks do not overlap
  for (const f of [250, 300, 400, 600, 800, 1600]) close(mesaDb(f, 80, 400, 1, 2, 6), mesaDb(f, 80, 400, 3, 2, 6), 1e-12, `upper side unaffected by the lower width at ${f}`);
  // upper width 5 starts its flank at 400 / 2^2.5 = 70.7 Hz, so compare only below that
  for (const f of [20, 30, 50, 60, 70]) close(mesaDb(f, 80, 400, 1, 2, 6), mesaDb(f, 80, 400, 1, 5, 6), 1e-12, `lower side unaffected by the upper width at ${f}`);
  // and the flanks really are different shapes
  assert.ok(Math.abs(mesaDb(300, 80, 400, 1, 1, 6) - mesaDb(300, 80, 400, 1, 4, 6)) > 0.5);
});

test("symmetric settings give a symmetric curve about the geometric centre", () => {
  const fl = 100, fh = 400, c = Math.sqrt(fl * fh);
  for (const o of [0.1, 0.5, 1, 1.5, 2, 3]) close(mesaDb(c * 2 ** o, fl, fh, 1.5, 1.5, 6), mesaDb(c * 2 ** -o, fl, fh, 1.5, 1.5, 6), 1e-12, `${o} octaves`);
});

test("negative gain is the exact mirror image; zero gain is flat; invert works through the layer", () => {
  for (const f of [30, 80, 150, 400, 900, 5000]) {
    close(mesaDb(f, 80, 400, 1, 2, -6), -mesaDb(f, 80, 400, 1, 2, 6), 0, `mirror at ${f}`);
    assert.equal(mesaDb(f, 80, 400, 1, 2, 0) + 0, 0);
    close(layerDb(f, { ...m(), invert: true }), -layerDb(f, m()), 0, `invert at ${f}`);
  }
});

test("a highly overlapping pair of flanks gives a lower peak, never a NaN, and is finite everywhere", () => {
  // upper edge close to the lower one with wide flanks: the two steps overlap
  const peak = Math.max(...[...Array(400)].map((_, i) => mesaDb(100 * 2 ** (i / 40 - 5), 100, 110, 4, 4, 6)));
  assert.ok(peak < 6 && peak > 0, `peak ${peak}`);
  for (const f of [1e-300, 1e-9, 1, 1e9, 1e300, Number.MAX_VALUE]) assert.ok(Number.isFinite(mesaDb(f, 80, 400, 1, 2, 6)), String(f));
});

test("layer: new layer defaults, load and save, limits, validation, export, name, corners", () => {
  assert.ok(Object.hasOwn(LAYER_KINDS, "mesa"));
  const l = newLayer("mesa");
  assert.deepEqual({ fLow: l.fLow, fHigh: l.fHigh, wLow: l.wLow, wHigh: l.wHigh, db: l.db }, { fLow: 80, fHigh: 400, wLow: 1, wHigh: 2, db: 6 });
  const d = newDoc();
  d.layers.push(l);
  const r = buildCrv(d);
  assert.ok(r.text, JSON.stringify(r.issues));
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.layers.at(-1), { ...l, id: back.layers.at(-1).id });
  assert.deepEqual(evaluate(back), evaluate(d));
  const bad = [{ fLow: 0 }, { fHigh: -1 }, { fLow: 500 }, { fLow: 400 }, { wLow: 0.05 }, { wHigh: 11 }, { wLow: "x" }, { db: 61 }, { db: NaN }, { fLow: undefined }];
  for (const o of bad) {
    assert.throws(() => loadDoc({ version: 1, layers: [{ ...l, ...o }] }), Error, JSON.stringify(o));
    const e = newDoc();
    e.layers.push({ ...l, ...o });
    if (!("fLow" in o) || o.fLow !== undefined) assert.equal(buildCrv(e).text, null, JSON.stringify(o));
  }
  const named = newDoc();
  named.layers.push({ id: "n", ...m({ fLow: 63, fHigh: 250, wLow: 0.5, wHigh: 1.5, db: -4 }) });
  assert.equal(suggestName(named), "Mesa-4dB_63-250Hz_0.5-1.5oct");
  const k = keyFrequencies([m()]);
  const near = (f) => k.some((x) => Math.abs(x / f - 1) < 1e-12);
  for (const f of [80, 400, 80 * 2 ** -0.5, 80 * 2 ** 0.5, 200, 800]) assert.ok(near(f), `corner ${f}`);
});

test("breakpoints export of a mesa filter stays within the chosen error", () => {
  const d = newDoc();
  d.layers.push(newLayer("mesa"));
  d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.1 };
  const pts = buildCrv(d).points;
  assert.ok(pts.length < 40, `${pts.length} points`);
  const full = Object.fromEntries(evaluate({ ...d, grid: { mode: "resample", fraction: 24, fmin: 20, fmax: 20000 } }));
  const lin = (f) => {
    let i = pts.findIndex(([x]) => x >= f);
    if (i <= 0) return pts[0][1];
    const [f0, g0] = pts[i - 1], [f1, g1] = pts[i];
    return g0 + ((g1 - g0) * (Math.log2(f / f0))) / Math.log2(f1 / f0);
  };
  for (const [f, g] of Object.entries(full)) assert.ok(Math.abs(lin(+f) - g) < 0.15, `${f}: ${lin(+f)} vs ${g}`);
});

test("overlapping flanks can never turn a boost into a cut (the result stays between 0 and the gain)", () => {
  // the case found by the independent check: a wide lower flank and a narrow upper flank that overlap
  for (const f of [100, 119, 150, 200, 320]) assert.ok(mesaDb(f, 80, 100, 4, 0.5, 6) >= 0, `${f} Hz`);
  for (let i = 0; i < 2000; i++) {
    const fl = 20 * 2 ** ((i % 17) / 2), fh = fl * (1 + (i % 7) / 3 + 0.01), wl = 0.1 + (i % 13) * 0.75, wh = 0.1 + (i % 11) * 0.9;
    for (const db of [6, -6]) {
      for (let k = -30; k <= 30; k++) {
        const v = mesaDb(fh * 2 ** (k / 4), fl, fh, wl, wh, db) / db;
        assert.ok(v >= -1e-15 && v <= 1 + 1e-15, `${fl} ${fh} ${wl} ${wh} at k=${k}: ${v}`);
      }
    }
  }
});

test("an off Mesa layer with bad settings does not block export, like every other layer", () => {
  const d = newDoc();
  d.layers.push({ id: "m", ...m({ fLow: 500, fHigh: 100, on: false }) });
  assert.ok(buildCrv(d).text);
  d.layers.at(-1).on = true;
  assert.equal(buildCrv(d).text, null);
});
