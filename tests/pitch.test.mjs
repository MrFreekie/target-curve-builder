import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestNote, noteLabel, wavelength, wavelengthLabel, SPEED_OF_SOUND } from "../js/pitch.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

test("reference notes: A4 440, middle C 261.6256, lowest piano key A0 27.5, top key C8", () => {
  assert.equal(noteLabel(440), "A4");
  assert.equal(noteLabel(261.6256), "C4");
  assert.equal(noteLabel(27.5), "A0");
  assert.equal(noteLabel(4186.009), "C8");
  assert.equal(noteLabel(880), "A5");
  assert.equal(noteLabel(220), "A3");
  assert.equal(noteLabel(16.3516), "C0");
});

test("every semitone from C0 to B8 is named in order with zero cents", () => {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  for (let midi = 12; midi <= 119; midi++) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const n = nearestNote(f);
    assert.equal(n.name + n.octave, `${names[midi % 12]}${Math.floor(midi / 12) - 1}`, `midi ${midi}`);
    close(n.cents, 0, 1e-6, `cents at midi ${midi}`);
    assert.equal(noteLabel(f), `${names[midi % 12]}${Math.floor(midi / 12) - 1}`);
  }
});

test("cents: sign, rounding, and the half-way point between two notes", () => {
  assert.equal(noteLabel(440 * 2 ** (30 / 1200)), "A4 +30¢");
  assert.equal(noteLabel(440 * 2 ** (-30 / 1200)), "A4 −30¢");
  assert.equal(noteLabel(440 * 2 ** (0.3 / 1200)), "A4", "under half a cent is not shown");
  assert.equal(noteLabel(440 * 2 ** (49 / 1200)), "A4 +49¢");
  assert.equal(noteLabel(440 * 2 ** (51 / 1200)), "A♯4 −49¢");
  // the target-curve frequencies: 20 Hz is a little sharp of D#0, 63 Hz a little sharp of B1
  assert.equal(noteLabel(20), "D♯0 +49¢");
  assert.equal(noteLabel(63), "B1 +35¢");
  assert.equal(noteLabel(1000), "B5 +21¢", "1 kHz is 21 cents above B5 (987.77 Hz)");
});

test("octave boundaries and very low or high frequencies", () => {
  assert.equal(noteLabel(246.9417), "B3");
  assert.equal(noteLabel(261.6256), "C4");
  assert.equal(nearestNote(8.1758).midi, 0);
  assert.equal(noteLabel(8.1758), "C-1");
  assert.ok(/^[A-G]/.test(noteLabel(0.001)) && /^[A-G]/.test(noteLabel(1e6)));
});

test("bad input gives no note and no wavelength", () => {
  for (const f of [0, -5, NaN, Infinity, "x", null, undefined]) {
    assert.equal(nearestNote(f), null, String(f));
    assert.equal(noteLabel(f), "", String(f));
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
