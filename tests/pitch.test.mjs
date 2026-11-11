import { test } from "node:test";
import assert from "node:assert/strict";
import { wavelength, wavelengthLabel, SPEED_OF_SOUND } from "../js/pitch.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

test("bad input gives no wavelength", () => {
  for (const f of [0, -5, NaN, Infinity, "x", null, undefined]) {
    assert.equal(wavelengthLabel(f), "", String(f));
  }
  assert.ok(Number.isNaN(wavelength(0)));
});

test("wavelength is 343 m/s divided by frequency, shown in m, cm or mm to 3 figures", () => {
  assert.equal(SPEED_OF_SOUND, 343);
  close(wavelength(343), 1, 1e-12, "343 Hz is 1 m");
  close(wavelength(1000), 0.343, 1e-12, "1 kHz");
  close(wavelength(20), 17.15, 1e-12, "20 Hz is 17.15 m");
  close(wavelength(100, 340), 3.4, 1e-12, "other speed of sound");
  assert.equal(wavelengthLabel(25), "13.7 m");
  assert.equal(wavelengthLabel(63), "5.44 m");
  assert.equal(wavelengthLabel(343), "1 m");
  assert.equal(wavelengthLabel(342), "1 m");
  assert.equal(wavelengthLabel(500), "68.6 cm");
  assert.equal(wavelengthLabel(1000), "34.3 cm");
  assert.equal(wavelengthLabel(8000), "4.29 cm");
  assert.equal(wavelengthLabel(16000), "2.14 cm");
  assert.equal(wavelengthLabel(50000), "6.86 mm");
  assert.equal(wavelengthLabel(100000), "3.43 mm");
});
