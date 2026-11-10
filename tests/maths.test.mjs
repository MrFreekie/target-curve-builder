import { test } from "node:test";
import assert from "node:assert/strict";
import { pos, makeGrid, round6, evaluate, NOMINAL_3, NOMINAL_1 } from "../js/curve.js";
import { filterDb, layerDb, FILTERS } from "../js/layers.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b}, got ${a}`);
const doc = (layers, extra = {}) => ({ grid: { fraction: 3, fmin: 20, fmax: 20000 }, normalise: { on: false }, layers, ...extra });
const at = (curve, hz) => curve.find((p) => p[0] === hz)[1];

// ---- pos() (SPEC 3.1)
test("pos(1000) is exactly 0", () => assert.equal(pos(1000), 0));
test("pos(63) is exactly -4 (snapped, not log2)", () => assert.equal(pos(63), -4));
test("pos(250) is exactly -2", () => assert.equal(pos(250), -2));
test("pos(2000) is exactly 1", () => assert.equal(pos(2000), 1));
test("pos(20000) is 13/3", () => near(pos(20000), 13 / 3, 1e-12, "pos(20000)"));
test("pos of non-nominal 1234 Hz uses log2(f/1000)", () => assert.equal(pos(1234), Math.log2(1.234)));
test("pos(1) is log2(1/1000)", () => assert.equal(pos(1), Math.log2(1 / 1000)));
test("pos(63) differs from raw log2(63/1000)", () => assert.notEqual(pos(63), Math.log2(63 / 1000)));
test("pos steps by exactly 1/3 between all adjacent nominal labels", () => {
  for (let i = 1; i < NOMINAL_3.length; i++) {
    near(pos(NOMINAL_3[i]) - pos(NOMINAL_3[i - 1]), 1 / 3, 1e-12, `step to ${NOMINAL_3[i]}`);
  }
});

// ---- makeGrid (SPEC 3.2)
test("makeGrid 1/3 default gives the 31 nominal labels", () => {
  const g = makeGrid({ fraction: 3, fmin: 20, fmax: 20000 });
  assert.equal(g.length, 31);
  assert.deepEqual(g, [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]);
});
test("makeGrid 1/3 respects fmin and fmax", () => {
  assert.deepEqual(makeGrid({ fraction: 3, fmin: 100, fmax: 400 }), [100, 125, 160, 200, 250, 315, 400]);
});
test("makeGrid 1/1 gives nominal octave labels 31.5 to 16000", () => {
  assert.deepEqual(makeGrid({ fraction: 1, fmin: 20, fmax: 20000 }), [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  assert.deepEqual(makeGrid({ fraction: 1, fmin: 20, fmax: 20000 }), NOMINAL_1);
});
test("makeGrid 1/1 respects fmin and fmax", () => {
  assert.deepEqual(makeGrid({ fraction: 1, fmin: 100, fmax: 2000 }), [125, 250, 500, 1000, 2000]);
});
for (const n of [6, 12, 24, 48]) {
  test(`makeGrid 1/${n} is 1000*2^(k/${n}) rounded to 6 dp inside 20..20000`, () => {
    const g = makeGrid({ fraction: n, fmin: 20, fmax: 20000 });
    const kmin = Math.ceil(n * Math.log2(20 / 1000) - 1e-9);
    const kmax = Math.floor(n * Math.log2(20) + 1e-9);
    assert.equal(g.length, kmax - kmin + 1, `count for 1/${n}`);
    g.forEach((f, i) => {
      const exp = Math.round(1000 * 2 ** ((kmin + i) / n) * 1e6) / 1e6;
      near(f, exp, 1e-9, `1/${n} index ${i}`);
      assert.equal(f, Math.round(f * 1e6) / 1e6, `${f} has more than 6 dp`);
      assert.ok(f >= 20 && f <= 20000, `${f} out of range`);
    });
    assert.ok(g.includes(1000));
    for (let i = 1; i < g.length; i++) assert.ok(g[i] > g[i - 1]);
  });
}
test("makeGrid 1/12 has 119 points (matches golden grid12 case)", () => {
  assert.equal(makeGrid({ fraction: 12, fmin: 20, fmax: 20000 }).length, 119);
});
test("makeGrid 1/24 honours custom fmin/fmax", () => {
  const g = makeGrid({ fraction: 24, fmin: 500, fmax: 2000 });
  assert.equal(g.length, 49); // two octaves = 48 steps + 1
  near(g[0], 500, 1e-6, "first");
  near(g[g.length - 1], 2000, 1e-6, "last");
  assert.ok(g.includes(1000));
});

// ---- round6 (SPEC 4.7)
test("round6 rounds to 6 decimal places", () => {
  assert.equal(round6(1.23456749), 1.234567);
  assert.equal(round6(1.2345675001), 1.234568);
});
test("round6 never returns -0 for tiny negatives or -0", () => {
  for (const x of [-0, -1e-9, -4e-7, -1e-12]) {
    assert.ok(Object.is(round6(x), 0), `round6(${x}) returned ${Object.is(round6(x), -0) ? "-0" : round6(x)}`);
  }
});
test("round6 keeps real negatives", () => assert.equal(round6(-2.5), -2.5));
test("evaluate output has no -0 and nothing printing as -0.000000", () => {
  const c = evaluate(doc([
    { kind: "gain", on: true, db: -1e-9 },
    { kind: "fullTilt", on: true, dbPerOct: -0, pivot: 1000 },
  ]));
  for (const [f, d] of c) {
    assert.ok(!Object.is(d, -0), `${f} Hz is -0`);
    assert.ok(!String(d).startsWith("-0"), `String(${d}) at ${f}`);
    assert.ok(!d.toFixed(6).startsWith("-0"), `toFixed(6) at ${f} Hz is ${d.toFixed(6)}`);
  }
});
test("evaluate of an lfTilt with negative slope gives +0 above pivot, not -0", () => {
  const c = evaluate(doc([{ kind: "lfTilt", on: true, dbPerOct: -3, pivot: 1000, floor: null }]));
  for (const [f, d] of c) assert.ok(!Object.is(d, -0), `${f} Hz is -0`);
});

// ---- filters (SPEC 4.4)
test("LR48 HPF is -6.0206 dB at fc", () => near(filterDb(32, 32, "LR", 48, "hp"), -6.0206, 1e-4, "LR48 hp"));
test("LR48 LPF is -6.0206 dB at fc", () => near(filterDb(5000, 5000, "LR", 48, "lp"), -6.0206, 1e-4, "LR48 lp"));
test("BW24 HPF is -3.0103 dB at fc", () => near(filterDb(100, 100, "BW", 24, "hp"), -3.0103, 1e-4, "BW24 hp"));
test("BW6 LPF is -3.0103 dB at fc", () => near(filterDb(100, 100, "BW", 6, "lp"), -3.0103, 1e-4, "BW6 lp"));
test("HPF passes far above fc (about 0 dB)", () => near(filterDb(20000, 32, "LR", 48, "hp"), 0, 1e-6, "pass band"));
test("LPF passes far below fc (about 0 dB)", () => near(filterDb(20, 16000, "BW", 12, "lp"), 0, 1e-6, "pass band"));
test("BW12 HPF one octave below fc is -10*log10(1+2^4)", () =>
  near(filterDb(500, 1000, "BW", 12, "hp"), -10 * Math.log10(17), 1e-9, "BW12 octave"));
test("LR24 LPF one octave above fc is -20*log10(1+2^4)", () =>
  near(filterDb(2000, 1000, "LR", 24, "lp"), -20 * Math.log10(17), 1e-9, "LR24 octave"));
test("LR48 HPF real stop-band slope is about 48.165 dB/oct, not 48", () => {
  const drop = filterDb(10, 1000, "LR", 48, "hp") - filterDb(5, 1000, "LR", 48, "hp");
  near(drop, 8 * 6.0206, 1e-3, "slope between 10 and 5 Hz");
  assert.ok(Math.abs(drop - 48) > 0.1, "must not be exactly 48");
});
test("LR48 LPF real stop-band slope is about 48.165 dB/oct", () => {
  const drop = filterDb(40000, 1000, "LR", 48, "lp") - filterDb(20000, 1000, "LR", 48, "lp");
  near(-drop, 48.165, 2e-3, "lpf slope");
});
test("BW48 (8 poles) stop-band slope is about 48.165 dB/oct", () => {
  const drop = filterDb(10, 1000, "BW", 48, "hp") - filterDb(5, 1000, "BW", 48, "hp");
  near(drop, 48.165, 2e-3, "BW48 slope");
});
test("filters use real Hz, not pos(): LR48 HPF 50 Hz at 63 Hz", () => {
  near(filterDb(63, 50, "LR", 48, "hp"), -20 * Math.log10(1 + (50 / 63) ** 8), 1e-12, "LR48 at 63 Hz");
});
test("BW accepts each legal slope", () => {
  for (const s of [6, 12, 18, 24, 30, 36, 42, 48]) assert.doesNotThrow(() => filterDb(100, 50, "BW", s, "hp"), `BW ${s}`);
});
test("LR accepts each legal slope", () => {
  for (const s of [12, 24, 36, 48]) assert.doesNotThrow(() => filterDb(100, 50, "LR", s, "hp"), `LR ${s}`);
});
test("BW rejects illegal slopes", () => {
  for (const s of [0, 7, 9, 54, 60, -6, NaN]) assert.throws(() => filterDb(100, 50, "BW", s, "hp"), undefined, `BW ${s}`);
});
test("LR rejects illegal slopes (6, 18, 30, 42, 60)", () => {
  for (const s of [6, 18, 30, 42, 60, 0, NaN]) assert.throws(() => filterDb(100, 50, "LR", s, "lp"), undefined, `LR ${s}`);
});
test("unknown filter type throws", () => assert.throws(() => filterDb(100, 50, "Bessel", 24, "hp")));
test("an enabled hpf layer with an illegal slope throws through evaluate", () => {
  assert.throws(() => evaluate(doc([{ kind: "hpf", on: true, fc: 50, type: "LR", slope: 18 }])));
});
test("filter registry exposes BW and LR with allowedSlopes and magnitudeDb", () => {
  for (const id of ["BW", "LR"]) {
    assert.equal(FILTERS[id].id, id);
    assert.ok(Array.isArray(FILTERS[id].allowedSlopes));
    assert.equal(typeof FILTERS[id].magnitudeDb, "function");
  }
  assert.deepEqual(FILTERS.LR.allowedSlopes, [12, 24, 36, 48]);
  assert.deepEqual(FILTERS.BW.allowedSlopes, [6, 12, 18, 24, 30, 36, 42, 48]);
});

// ---- disabled layers
test("disabled layers are ignored", () => {
  assert.ok(evaluate(doc([{ kind: "gain", on: false, db: 10 }])).every(([, d]) => d === 0));
});
test("disabled layer with an illegal filter is never evaluated", () => {
  assert.doesNotThrow(() => evaluate(doc([{ kind: "hpf", on: false, fc: 50, type: "LR", slope: 18 }])));
});
test("only enabled layers sum", () => {
  const c = evaluate(doc([{ kind: "gain", on: true, db: 2 }, { kind: "gain", on: false, db: 100 }, { kind: "gain", on: true, db: 1.5 }]));
  assert.ok(c.every(([, d]) => d === 3.5));
});

// ---- points (SPEC 4.1)
test("points layer holds end values outside the range", () => {
  const c = evaluate(doc([{ kind: "points", on: true, points: [[100, 5], [1000, -3]] }]));
  assert.equal(at(c, 20), 5);
  assert.equal(at(c, 100), 5);
  assert.equal(at(c, 1000), -3);
  assert.equal(at(c, 20000), -3);
});
test("points layer interpolates linearly in dB against pos()", () => {
  // 100 Hz is pos -10/3, 1000 Hz is 0, 250 Hz is -2: fraction 0.4 of the way
  const c = evaluate(doc([{ kind: "points", on: true, points: [[100, 10], [1000, 0]] }]));
  near(at(c, 250), 6, 1e-9, "250 Hz");
});
test("points interpolation uses octaves, not Hz", () => {
  const c = evaluate(doc([{ kind: "points", on: true, points: [[100, 0], [400, 12]] }]), [200]);
  near(c[0][1], 6, 1e-9, "one octave of two (linear Hz would give 4)");
});
test("LA example: 63 Hz = 7, 315 Hz = 0, 125 Hz interpolated on pos", () => {
  const c = evaluate(doc([{ kind: "points", on: true, points: [[63, 7], [315, 0], [20000, 0]] }]));
  assert.equal(at(c, 63), 7);
  assert.equal(at(c, 315), 0);
  assert.equal(at(c, 20), 7);
  // pos(63) = -4, pos(315) = -5/3 + ... computed from thirds: index 12 -> (12-17)/3
  const x0 = -4, x1 = (12 - 17) / 3, x = (8 - 17) / 3; // 125 Hz is index 8
  near(at(c, 125), 7 * (1 - (x - x0) / (x1 - x0)), 1e-6, "125 Hz");
});
test("unsorted points are treated as sorted by frequency", () => {
  const c = evaluate(doc([{ kind: "points", on: true, points: [[1000, 0], [100, 10]] }]), [100]);
  near(c[0][1], 10, 1e-12, "100 Hz");
});

// ---- tilts (SPEC 4.2)
test("fullTilt 3 dB/oct about 1k gives 63 Hz = +12 exactly, 2k = -3", () => {
  const c = evaluate(doc([{ kind: "fullTilt", on: true, dbPerOct: 3, pivot: 1000 }]));
  assert.equal(at(c, 63), 12);
  assert.equal(at(c, 2000), -3);
  assert.equal(at(c, 1000), 0);
});
test("lfTilt is zero at and above the pivot", () => {
  const c = evaluate(doc([{ kind: "lfTilt", on: true, dbPerOct: 3, pivot: 1000, floor: null }]));
  for (const [f, d] of c) if (f >= 1000) assert.equal(d, 0, `${f} Hz`);
});
test("lfTilt floor holds the value at the floor frequency below it", () => {
  const c = evaluate(doc([{ kind: "lfTilt", on: true, dbPerOct: 3, pivot: 1000, floor: 40 }]));
  assert.equal(at(c, 50), 13);
  assert.equal(at(c, 40), 14);
  assert.equal(at(c, 31.5), 14);
  assert.equal(at(c, 20), 14);
});
test("lfTilt with floor null keeps rising below 40 Hz", () => {
  const c = evaluate(doc([{ kind: "lfTilt", on: true, dbPerOct: 3, pivot: 1000, floor: null }]));
  assert.equal(at(c, 20), 17);
});
test("hfTilt rolls off above the corner and is zero at and below it", () => {
  const c = evaluate(doc([{ kind: "hfTilt", on: true, dbPerOct: 3, corner: 4000 }]));
  assert.equal(at(c, 1000), 0);
  assert.equal(at(c, 4000), 0);
  assert.equal(at(c, 8000), -3);
  assert.equal(at(c, 16000), -6);
});
test("gain layer is a constant offset", () => {
  assert.ok(evaluate(doc([{ kind: "gain", on: true, db: -2.5 }])).every(([, d]) => d === -2.5));
});
test("unknown layer kind throws", () => {
  assert.throws(() => layerDb(1000, { kind: "bogus" }));
});

// ---- normalise (SPEC 4.6)
test("normalise subtracts total(at) from every point", () => {
  // raw at 1000 = 4 + 2*(pos(500) - 0) = 4 - 2 = 2 ; raw at 500 = 4 ; so normalised 500 = 2
  const c = evaluate(doc(
    [{ kind: "gain", on: true, db: 4 }, { kind: "fullTilt", on: true, dbPerOct: 2, pivot: 500 }],
    { normalise: { on: true, at: 1000 } }));
  assert.equal(at(c, 1000), 0);
  assert.equal(at(c, 500), 2);
});
test("normalise off leaves values alone", () => {
  const c = evaluate(doc([{ kind: "gain", on: true, db: 4 }], { normalise: { on: false, at: 1000 } }));
  assert.equal(at(c, 1000), 4);
});
test("normalise at another frequency makes that frequency 0 dB", () => {
  const c = evaluate(doc([{ kind: "fullTilt", on: true, dbPerOct: 3, pivot: 1000 }], { normalise: { on: true, at: 250 } }));
  assert.equal(at(c, 250), 0);
  assert.equal(at(c, 1000), -6);
});
test("a document with no normalise field evaluates", () => {
  assert.doesNotThrow(() => evaluate({ grid: { fraction: 3 }, layers: [{ kind: "gain", on: true, db: 1 }] }));
});

// ---- original grid mode (SPEC 3.3)
test("original grid mode outputs exactly the imported frequencies in order", () => {
  const original = [[5000, 1], [63, 2], [123.456, 3], [20, 4]];
  const c = evaluate(doc([{ kind: "gain", on: true, db: 1 }], { grid: { mode: "original", fraction: 3, fmin: 20, fmax: 20000 }, original }));
  assert.deepEqual(c.map((p) => p[0]), [5000, 63, 123.456, 20]);
  assert.ok(c.every(([, v]) => v === 1));
});
test("original grid mode evaluates layers at the original frequencies", () => {
  const original = [[63, 0], [1500, 0], [200, 0]];
  const c = evaluate(doc([{ kind: "fullTilt", on: true, dbPerOct: 3, pivot: 1000 }], { grid: { mode: "original" }, original }));
  assert.equal(c.length, 3);
  assert.equal(c[0][1], 12);
  near(c[1][1], -3 * Math.log2(1.5), 1e-6, "1500 Hz");
});
test("resample mode ignores doc.original", () => {
  const c = evaluate(doc([{ kind: "gain", on: true, db: 0 }], { grid: { mode: "resample", fraction: 3, fmin: 20, fmax: 20000 }, original: [[1, 0], [2, 0]] }));
  assert.equal(c.length, 31);
});
