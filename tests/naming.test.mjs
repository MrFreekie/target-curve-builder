import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestName } from "../js/naming.js";
import { newDoc } from "../js/doc.js";
import { readdirSync } from "node:fs";

const layer = (d, kind) => d.layers.find((l) => l.kind === kind);

test("a new document with nothing switched on is Flat", () => {
  assert.equal(suggestName(newDoc()), "Flat");
});

test("matches the reference file names", () => {
  const d = newDoc();
  layer(d, "lfTilt").on = true;
  assert.equal(suggestName(d), "Tilt_3dBoct_1000Hz");
  const h = layer(d, "hpf");
  h.on = true;
  for (const fc of [32, 40, 50, 63, 80, 100]) {
    h.fc = fc;
    const expected = `Tilt_3dBoct_1000Hz_HPF${fc}_LR48`;
    assert.ok(readdirSync("reference/samples").includes(`${expected}.crv`), expected);
    assert.equal(suggestName(d), expected);
  }
});

test("order: tilts, gain, HPF, LPF; disabled layers are ignored", () => {
  const d = newDoc();
  Object.assign(layer(d, "lpf"), { on: true, fc: 16000, type: "BW", slope: 12 });
  Object.assign(layer(d, "hpf"), { on: true, fc: 31.5, type: "LR", slope: 24 });
  Object.assign(layer(d, "hfTilt"), { on: true, dbPerOct: 1.5, corner: 4000 });
  Object.assign(layer(d, "fullTilt"), { on: false });
  d.layers.push({ id: "g", kind: "gain", on: true, db: -3 });
  assert.equal(suggestName(d), "HFRoll_1.5dBoct_4000Hz_-3dB_HPF31.5_LR24_LPF16000_BW12");
});

test("lf tilt floor, positive gain, points layers", () => {
  const d = newDoc();
  Object.assign(layer(d, "lfTilt"), { on: true, floor: 40 });
  assert.equal(suggestName(d), "Tilt_3dBoct_1000Hz_floor40Hz");
  layer(d, "lfTilt").on = false;
  d.layers.push({ id: "g", kind: "gain", on: true, db: 2.5 });
  assert.equal(suggestName(d), "+2.5dB");
  layer(d, "points").points = [[63, 7], [315, 0], [20000, 0]];
  assert.equal(suggestName(d), "Pts3_+2.5dB");
  layer(d, "points").points = [[20, 4], [20000, 4]];
  assert.equal(suggestName(d), "Flat4dB_+2.5dB");
});

test("a zero gain layer changes nothing, long decimals are trimmed", () => {
  const d = newDoc();
  d.layers.push({ id: "g", kind: "gain", on: true, db: 0 });
  assert.equal(suggestName(d), "Flat");
  Object.assign(layer(d, "fullTilt"), { on: true, dbPerOct: 1.23456, pivot: 1000 });
  assert.equal(suggestName(d), "FullTilt_1.23dBoct_1000Hz");
});

test("the suggestion is a safe file name", () => {
  const d = newDoc();
  for (const l of d.layers) l.on = true;
  assert.match(suggestName(d), /^[A-Za-z0-9._+-]+$/);
});
