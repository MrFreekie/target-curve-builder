import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColour, luminance, contrastRatio, hslToRgb, toHex, randomContrastingColour } from "../js/colour.js";

// small deterministic generator
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

test("parseColour reads hex and rgb()/rgba()", () => {
  assert.deepEqual(parseColour("#1d2026"), [29, 32, 38]);
  assert.deepEqual(parseColour("rgb(255, 221, 0)"), [255, 221, 0]);
  assert.deepEqual(parseColour("rgba(0, 0, 0, 0.5)"), [0, 0, 0]);
  assert.equal(parseColour("transparent"), null);
});

test("WCAG numbers: black on white is 21, same colour is 1", () => {
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
  assert.equal(contrastRatio([10, 20, 30], [10, 20, 30]), 1);
  assert.ok(Math.abs(luminance([255, 255, 255]) - 1) < 1e-9);
});

test("hslToRgb and toHex", () => {
  assert.deepEqual(hslToRgb(0, 100, 50), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 100, 50), [0, 255, 0]);
  assert.deepEqual(hslToRgb(240, 100, 50), [0, 0, 255]);
  assert.deepEqual(hslToRgb(0, 0, 100), [255, 255, 255]);
  assert.equal(toHex([255, 0, 10]), "#ff000a");
});

test("random colours contrast with dark and light backgrounds, and vary", () => {
  const rng = lcg(7);
  for (const bg of ["#1d2026", "rgb(29, 32, 38)", "#ffffff", "#eceef2", "#000000"]) {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const c = randomContrastingColour(bg, rng);
      assert.match(c, /^#[0-9a-f]{6}$/);
      assert.ok(contrastRatio(parseColour(c), parseColour(bg)) >= 4.5, `${c} on ${bg}`);
      seen.add(c);
    }
    assert.ok(seen.size > 100, `${bg}: only ${seen.size} different colours`);
  }
});

test("dark backgrounds get light colours, light backgrounds get dark ones", () => {
  const rng = lcg(3);
  for (let i = 0; i < 100; i++) {
    assert.ok(luminance(parseColour(randomContrastingColour("#1d2026", rng))) > 0.2);
    assert.ok(luminance(parseColour(randomContrastingColour("#ffffff", rng))) < 0.3);
  }
});

test("an unreadable background falls back to a dark one", () => {
  assert.match(randomContrastingColour("nonsense", lcg(1)), /^#[0-9a-f]{6}$/);
});
