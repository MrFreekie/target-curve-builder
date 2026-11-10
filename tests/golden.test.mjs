import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../js/curve.js";

const golden = JSON.parse(readFileSync(new URL("../reference/golden.json", import.meta.url), "utf8"));
const tol = golden.tolerance_db;

for (const c of golden.cases) {
  test(`golden: ${c.id}`, () => {
    const got = evaluate(c.model);
    assert.equal(got.length, c.expected.length,
      `[${c.id}] point count: expected ${c.expected.length}, got ${got.length}`);
    for (let i = 0; i < c.expected.length; i++) {
      const [ef, ed] = c.expected[i];
      const [gf, gd] = got[i];
      assert.ok(Math.abs(gf - ef) <= tol,
        `[${c.id}] freq mismatch at index ${i}: expected ${ef} Hz, got ${gf} Hz`);
      assert.ok(Math.abs(gd - ed) <= tol,
        `[${c.id}] ${ef} Hz: expected ${ed} dB, got ${gd} dB (diff ${gd - ed}, tol ${tol})`);
    }
  });
}
