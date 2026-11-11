import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_PRESETS, SMPTE_ST202_TABLE_1 } from "../js/presets.js";
import { buildCrv } from "../js/build.js";
import { pos } from "../js/curve.js";

// SMPTE ST 202:2010, Table 1 (medium sized theatre): 1/3-octave centre frequency Hz -> level dB.
// Typed here from the standard, independently of js/presets.js.
const TABLE_1 = {
  31.5: -2, 40: -1, 50: 0, 63: 0, 80: 0, 100: 0, 125: 0, 160: 0, 200: 0, 250: 0, 315: 0, 400: 0, 500: 0, 630: 0,
  800: 0, 1000: 0, 1250: 0, 1600: 0, 2000: 0, 2500: -1, 3150: -2, 4000: -3, 5000: -4, 6300: -5, 8000: -6,
  10000: -7, 12500: -9, 16000: -11,
};
// Table A.1 corrections added to Table 1 at 4 kHz and 8 kHz (0 at 2 kHz): 150 seats and 1000 seats.
const A1 = { 150: { 4000: 0.5, 8000: 1.0 }, 1000: { 4000: -0.5, 8000: -1.0 } };

const preset = (re) => BUILT_IN_PRESETS.find((p) => re.test(p.name));
const asMap = (p) => Object.fromEntries(buildCrv(p.build()).points);

test("the medium theatre preset reproduces Table 1 exactly at every listed frequency, and only those", () => {
  const out = asMap(preset(/medium theatre/));
  // in ascending order, point by point (object keys are not kept in this order, so use an explicit list)
  const ORDER = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
  assert.deepEqual(buildCrv(preset(/medium theatre/).build()).points.map(([f]) => f), ORDER);
  assert.deepEqual(buildCrv(preset(/medium theatre/).build()).points.map(([, g]) => g), ORDER.map((f) => TABLE_1[f]));
  assert.equal(Object.keys(out).length, ORDER.length);
  for (const [f, v] of Object.entries(TABLE_1)) assert.equal(out[f], v, `${f} Hz`);
});

test("the corner list in the code is the table (flat run between 50 Hz and 2 kHz)", () => {
  for (const [f, v] of SMPTE_ST202_TABLE_1) assert.equal(TABLE_1[f], v, `${f}`);
  assert.equal(SMPTE_ST202_TABLE_1.length, 13);
});

test("size variants add the Table A.1 corrections at 4 and 8 kHz, nothing at or below 2 kHz", () => {
  for (const [seats, corr] of Object.entries(A1)) {
    const out = asMap(preset(new RegExp(`${seats} seats`)));
    for (const [f, base] of Object.entries(TABLE_1)) {
      const c = f <= 2000 ? 0 : f == 4000 ? corr[4000] : f == 8000 ? corr[8000] : null;
      if (c !== null) assert.equal(out[f], base + c, `${seats} seats at ${f}`);
      else if (f > 8000) assert.equal(out[f], base + corr[8000], `held above 8 kHz (${seats} seats, ${f})`);
      else {
        // between the table's correction frequencies: linear in octave position (SPEC §3.1, §4.1)
        const lo = f < 4000 ? [2000, 0] : [4000, corr[4000]];
        const hi = f < 4000 ? [4000, corr[4000]] : [8000, corr[8000]];
        const t = (pos(f) - pos(lo[0])) / (pos(hi[0]) - pos(lo[0]));
        assert.ok(Math.abs(out[f] - (base + lo[1] + t * (hi[1] - lo[1]))) < 2e-6, `${seats} seats at ${f}`);
      }
    }
  }
});

test("export settings: tolerance 3 dB shown, range limited to what the standard defines, valid .crv", () => {
  for (const p of BUILT_IN_PRESETS.filter((x) => /SMPTE ST 202/.test(x.name))) {
    const d = p.build();
    assert.equal(d.props.tolerance, 3);
    assert.equal(d.props.useTolerance, 1);
    const r = buildCrv(d);
    assert.ok(r.text, JSON.stringify(r.issues));
    assert.equal(r.points[0][0], 31.5);
    assert.equal(r.points.at(-1)[0], 16000);
    assert.ok(r.text.includes("UseTolerance:\t1"));
  }
  assert.equal(BUILT_IN_PRESETS.filter((x) => /SMPTE ST 202/.test(x.name)).length, 3);
});
