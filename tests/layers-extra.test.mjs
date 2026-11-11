import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../js/curve.js";
import { layerDb, filterDb, FILTERS, LAYER_LIMITS } from "../js/layers.js";
import { bellDb, resonantDb, besselDb, chebyshevDb } from "../js/eq.js";
import { newDoc, newLayer, loadDoc, LAYER_KINDS } from "../js/doc.js";
import { suggestName } from "../js/naming.js";
import { buildCrv } from "../js/build.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const KINDS = ["subBoost", "hiShelf", "bell", "hill", "rHpf", "rLpf"];

test("high shelf: db times the linear high-pass magnitude (closed forms), mirror for cuts", () => {
  const lrLin = (f, fc, s) => 1 / (1 + (fc / f) ** (s / 6));
  const bwLin = (f, fc, s) => 1 / Math.sqrt(1 + (fc / f) ** (s / 3));
  for (const [type, slope, lin] of [["LR", 24, lrLin], ["LR", 96, lrLin], ["BW", 6, bwLin], ["BW", 12, bwLin], ["BW", 72, bwLin]]) {
    for (const db of [6, -4]) {
      for (const f of [500, 4000, 8000, 12000, 20000]) {
        const got = layerDb(f, { kind: "hiShelf", fc: 8000, type, slope, db }, 0);
        close(got, db * lin(f, 8000, slope), 1e-10, `${type}${slope} ${db} at ${f}`);
      }
    }
  }
  close(layerDb(8000, { kind: "hiShelf", fc: 8000, type: "LR", slope: 24, db: 6 }, 0), 3, 1e-12, "half at the LR corner");
  close(layerDb(1e6, { kind: "hiShelf", fc: 8000, type: "LR", slope: 24, db: 6 }, 0), 6, 1e-6, "full far above");
  close(layerDb(20, { kind: "hiShelf", fc: 8000, type: "LR", slope: 24, db: 6 }, 0), 0, 1e-6, "none far below");
});

test("layer kinds delegate to the closed forms in eq.js", () => {
  close(layerDb(700, { kind: "bell", fc: 1000, q: 2, db: -9 }, 0), bellDb(700, 1000, 2, -9), 0, "bell");
  close(layerDb(1000, { kind: "bell", fc: 1000, q: 2, db: -9 }, 0), -9, 1e-9, "bell centre");
  close(layerDb(90, { kind: "rLpf", fc: 100, q: 3 }, 0), resonantDb(90, 100, 3, "lp"), 0, "rLpf");
  close(layerDb(90, { kind: "rHpf", fc: 100, q: 3 }, 0), resonantDb(90, 100, 3, "hp"), 0, "rHpf");
  close(layerDb(120, { kind: "hill", fc: 60, width: 2, db: 6 }, 0), 3, 1e-12, "hill half height at +1 octave");
  close(layerDb(60, { kind: "hill", fc: 60, width: 2, db: 6 }, 0), 6, 1e-12, "hill centre");
});

test("Bessel and Chebyshev filter types work as HPF and LPF with the registry's slopes", () => {
  assert.ok(FILTERS.BS && FILTERS.CH1);
  for (const type of ["BS", "CH1"]) {
    for (const slope of FILTERS[type].allowedSlopes) {
      for (const f of [30, 80, 500, 4000]) {
        // a high-pass is the low-pass mirrored about the corner (s -> 1/s)
        close(filterDb(f, 100, type, slope, "hp"), filterDb((100 * 100) / f, 100, type, slope, "lp"), 1e-9, `${type}${slope} ${f}`);
      }
    }
  }
  close(filterDb(100, 100, "BS", 24, "lp"), -3.0103, 1e-4, "Bessel corner");
  close(filterDb(100, 100, "CH1", 24, "lp"), -1, 1e-9, "Chebyshev corner is -ripple");
  assert.equal(filterDb(1000, 100, "BS", 24, "lp"), besselDb(4, 10));
  assert.equal(filterDb(1000, 100, "CH1", 12, "lp"), chebyshevDb(2, 10, 1));
  assert.throws(() => filterDb(1000, 100, "BS", 72, "lp"), RangeError);
  assert.throws(() => filterDb(1000, 100, "CH1", 54, "lp"), RangeError);
});

test("72 and 96 dB/oct Butterworth and Linkwitz-Riley: corner values and true asymptotic slope", () => {
  for (const slope of [72, 96]) {
    close(filterDb(100, 100, "BW", slope, "lp"), -3.0103, 1e-4, `BW${slope} corner`);
    close(filterDb(100, 100, "LR", slope, "hp"), -6.0206, 1e-4, `LR${slope} corner`);
    const sBw = filterDb(100 * 4, 100, "BW", slope, "lp") - filterDb(100 * 8, 100, "BW", slope, "lp");
    close(sBw, (slope / 6) * 6.0206, 0.01, `BW${slope} slope`);
    const sLr = filterDb(100 / 4, 100, "LR", slope, "hp") - filterDb(100 / 8, 100, "LR", slope, "hp");
    close(sLr, (slope / 6) * 6.0206, 0.01, `LR${slope} slope`);
  }
  assert.throws(() => filterDb(100, 100, "LR", 60, "lp"), RangeError);
  assert.throws(() => filterDb(100, 100, "BW", 54, "lp"), RangeError);
});

test("every new kind: newLayer is valid and exports, survives loadDoc, evaluates finite, simplifies", () => {
  for (const kind of KINDS) {
    assert.ok(Object.hasOwn(LAYER_KINDS, kind), kind);
    const d = newDoc();
    const l = newLayer(kind);
    d.layers.push(l);
    const r = buildCrv(d);
    assert.ok(r.text, `${kind}: ${JSON.stringify(r.issues)}`);
    assert.ok(r.points.every(([, g]) => Number.isFinite(g) && !Object.is(g, -0)), kind);
    const back = loadDoc(JSON.parse(JSON.stringify(d)));
    assert.deepEqual(back.layers.at(-1), { ...l, id: back.layers.at(-1).id }, kind);
    d.grid = { mode: "simplified", fmin: 20, fmax: 20000, epsilon: 0.1 };
    const s = buildCrv(d);
    assert.ok(s.text && s.points.length < r.points.length, `${kind} simplifies`);
  }
});

test("extreme settings stay finite", () => {
  const d = newDoc();
  d.layers.push({ id: "a", kind: "bell", on: true, fc: 20, q: 50, db: -60 });
  d.layers.push({ id: "b", kind: "rLpf", on: true, fc: 20, q: 20 });
  d.layers.push({ id: "c", kind: "rHpf", on: true, fc: 20000, q: 0.1 });
  d.layers.push({ id: "d", kind: "hill", on: true, fc: 20000, width: 0.1, db: 60 });
  d.layers.push({ id: "e", kind: "hpf", on: true, fc: 20, type: "CH1", slope: 48 });
  d.layers.push({ id: "f", kind: "lpf", on: true, fc: 20, type: "BS", slope: 48 });
  d.layers.push({ id: "g", kind: "hpf", on: true, fc: 20000, type: "LR", slope: 96 });
  for (const [f, g] of evaluate(d, [1, 20, 100, 1000, 20000, 24000])) assert.ok(Number.isFinite(g) && !Object.is(g, -0), `${f}: ${g}`);
});

test("limits: Q, width and gain are checked by loadDoc and by export validation", () => {
  const bad = [
    { kind: "bell", on: true, fc: 1000, q: 0.05, db: 3 },
    { kind: "bell", on: true, fc: 1000, q: 51, db: 3 },
    { kind: "bell", on: true, fc: 1000, q: 1, db: 61 },
    { kind: "hill", on: true, fc: 60, width: 0.05, db: 3 },
    { kind: "hill", on: true, fc: 60, width: 11, db: 3 },
    { kind: "rLpf", on: true, fc: 1000, q: 21 },
    { kind: "rHpf", on: true, fc: 0, q: 1 },
    { kind: "hiShelf", on: true, fc: 8000, type: "LR", slope: 18, db: 3 },
    { kind: "hiShelf", on: true, fc: 8000, type: "LR", slope: 24 },
  ];
  for (const l of bad) assert.throws(() => loadDoc({ version: 1, layers: [l] }), Error, JSON.stringify(l));
  const [lo, hi] = LAYER_LIMITS.q;
  for (const q of [lo, hi]) assert.doesNotThrow(() => loadDoc({ version: 1, layers: [{ kind: "bell", on: true, fc: 1000, q, db: -60 }] }));
  for (const l of bad.slice(0, 8)) {
    const d = newDoc();
    d.layers.push({ id: "x", ...l });
    const r = buildCrv(d);
    if (l.kind === "hiShelf") assert.ok(r.issues.some((i) => /High shelf: .*dB\/oct/.test(i.message)));
    assert.equal(r.text, null, JSON.stringify(l));
  }
});

test("name suggestions for the new layers", () => {
  const d = newDoc();
  d.layers.push({ id: "a", kind: "bell", on: true, fc: 250, q: 0.7, db: -3 });
  assert.equal(suggestName(d), "Bell-3dB_250Hz_Q0.7");
  d.layers.push({ id: "b", kind: "hill", on: true, fc: 60, width: 2, db: 6 });
  d.layers.push({ id: "c", kind: "hiShelf", on: true, fc: 10000, type: "BW", slope: 12, db: -2 });
  d.layers.push({ id: "d", kind: "rLpf", on: true, fc: 16000, q: 1 });
  d.layers.find((l) => l.kind === "hpf").on = true;
  d.layers.push({ id: "e", kind: "rHpf", on: true, fc: 40, q: 1.2 });
  assert.equal(suggestName(d), "Bell-3dB_250Hz_Q0.7_Hill+6dB_60Hz_2oct_HiShelf-2dB_10000Hz_BW12_HPF32_LR48_RHPF40_Q1.2_RLPF16000_Q1");
  assert.match(suggestName(d), /^[A-Za-z0-9._+-]+$/);
  const f = newDoc();
  Object.assign(f.layers.find((l) => l.kind === "hpf"), { on: true, type: "BS", slope: 24 });
  assert.equal(suggestName(f), "HPF32_BS24");
});

// ---- regressions from the independent check
test("huge frequency ratios no longer overflow: bell, Butterworth and Linkwitz-Riley", () => {
  for (const x of [1e50, 1e77, 1.2e77, 1e100, 1e160, 1e300]) {
    for (const [q, db] of [[0.1, 60], [1, -6], [50, -60]]) {
      const v = bellDb(1000 * x, 1000, q, db);
      assert.ok(Number.isFinite(v) && Math.abs(v) < 1e-6, `bell x=${x}: ${v}`);
      close(v, bellDb(1000 / x, 1000, q, db), 1e-12, "log symmetry");
    }
  }
  // BW96 high-pass at fc 4.3e9, f = 1 Hz: true value 192 log10 of the ratio, about -3082.7 dB
  close(filterDb(1, 4.3e9, "BW", 96, "hp"), -(10 * 2 * 16 * Math.log10(4.3e9)), 1e-6, "BW96");
  close(filterDb(1, 4.3e9, "LR", 96, "hp"), -(20 * 16 * Math.log10(4.3e9)), 1e-6, "LR96");
  for (const type of ["BW", "LR"]) {
    for (const slope of FILTERS[type].allowedSlopes) {
      const v = filterDb(1, 1e12, type, slope, "hp");
      assert.ok(Number.isFinite(v) && v < -100, `${type}${slope}: ${v}`);
    }
  }
  // the log form joins the plain form at the corner and agrees just above it
  for (const [type, slope] of [["BW", 24], ["LR", 48], ["BW", 96]]) {
    close(filterDb(100 * (1 + 1e-9), 100, type, slope, "lp"), filterDb(100 * (1 - 1e-9), 100, type, slope, "lp"), 1e-6, `${type}${slope} continuity`);
  }
});

test("Chebyshev can't be a shelf: refused by loadDoc and export validation, hidden in the UI list", () => {
  for (const kind of ["subBoost", "hiShelf"]) {
    assert.throws(() => loadDoc({ version: 1, layers: [{ kind, on: true, fc: 100, type: "CH1", slope: 24, db: 6 }] }), /shelf/);
    const d = newDoc();
    d.layers.push({ id: "x", kind, on: true, fc: 100, type: "CH1", slope: 24, db: 6 });
    const r = buildCrv(d);
    assert.equal(r.text, null);
    assert.ok(r.issues.some((i) => /can't be used for a shelf/.test(i.message)), JSON.stringify(r.issues));
    for (const type of ["BW", "LR", "BS"]) {
      assert.doesNotThrow(() => loadDoc({ version: 1, layers: [{ kind, on: true, fc: 100, type, slope: 24, db: 6 }] }));
    }
  }
  // as an HPF or LPF it is fine
  assert.doesNotThrow(() => loadDoc({ version: 1, layers: [{ kind: "hpf", on: true, fc: 100, type: "CH1", slope: 24 }] }));
});
