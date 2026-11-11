import { test } from "node:test";
import assert from "node:assert/strict";
import { bellDb, resonantDb, hillDb, chebyshevDb, besselDb } from "../js/eq.js";
import { filterDb } from "../js/layers.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

test("bell: exactly db at fc, 0 far away, symmetric in log frequency, mirror for cuts", () => {
  for (const [q, db] of [[0.5, 3], [1, -6], [4, 9], [30, -40]]) {
    close(bellDb(1000, 1000, q, db), db, 1e-9, `centre q${q}`);
    close(bellDb(1e-3, 1000, q, db), 0, 1e-6, "far below");
    close(bellDb(1e9, 1000, q, db), 0, 1e-6, "far above");
    for (const k of [0.3, 0.5, 0.8]) close(bellDb(1000 * k, 1000, q, db), bellDb(1000 / k, 1000, q, db), 1e-9, "log symmetry");
    close(bellDb(700, 1000, q, db), -bellDb(700, 1000, q, -db), 1e-9, "mirror");
  }
  assert.ok(bellDb(1000, 1000, 0.5, 6) > 5.99 && bellDb(500, 1000, 0.5, 6) > bellDb(500, 1000, 8, 6), "lower Q is wider");
  // closed form check by hand: Q = 1, db = 6 (A = 10^(6/40)), x = 2
  const A = 10 ** (6 / 40), x = 2, d = (1 - x * x) ** 2;
  close(bellDb(2000, 1000, 1, 6), 10 * Math.log10((d + (x * A) ** 2) / (d + (x / A) ** 2)), 1e-12, "formula");
});

test("resonant 2nd order: Q = 0.7071 equals Butterworth 12; Q at the corner; peaking above 0.7071", () => {
  for (const f of [20, 50, 100, 400, 3000]) {
    close(resonantDb(f, 100, Math.SQRT1_2, "lp"), filterDb(f, 100, "BW", 12, "lp"), 1e-9, `lp ${f}`);
    close(resonantDb(f, 100, Math.SQRT1_2, "hp"), filterDb(f, 100, "BW", 12, "hp"), 1e-9, `hp ${f}`);
  }
  close(resonantDb(100, 100, 2, "lp"), 20 * Math.log10(2), 1e-9, "Q 2 at fc (lp)");
  close(resonantDb(100, 100, 2, "hp"), 20 * Math.log10(2), 1e-9, "Q 2 at fc (hp)");
  close(resonantDb(100, 100, 0.5, "lp"), -6.0206, 1e-3, "Q 0.5 at fc");
  let peak = -Infinity;
  for (let i = 0; i < 400; i++) peak = Math.max(peak, resonantDb(100 * 2 ** (-1 + i / 200), 100, 4, "lp"));
  assert.ok(peak > 11.9 && peak < 12.2, `peak ${peak}`);
  close(resonantDb(1e6, 100, 1, "lp"), -80 * 2 + 0 * 1 - 0, 3.1, "asymptote about -40 dB/decade");
  assert.ok(Number.isFinite(resonantDb(1e200, 100, 1, "hp")) && Number.isFinite(resonantDb(1e-200, 100, 1, "lp")));
});

test("hill: full db at the centre, half at +/- width/2 octaves, mirror in log frequency", () => {
  close(hillDb(250, 250, 2, 6), 6, 1e-12, "centre");
  close(hillDb(250 * 2, 250, 2, 6), 6 * 2 ** -1, 1e-12, "one octave up, width 2: Δ = w/2");
  close(hillDb(250 / 2, 250, 2, 6), 3, 1e-12, "one octave down");
  close(hillDb(20000, 250, 1, 6), 0, 1e-6, "far");
  close(hillDb(250 * 2, 250, 1, -4), -4 * 2 ** -4, 1e-12, "w = 1, Δ = 1 octave");
});

test("Chebyshev I: -ripple dB at fc for every order, ripple band bounded, steeper than Butterworth", () => {
  for (const n of [1, 2, 3, 4, 8]) {
    close(chebyshevDb(n, 1, 1), -1, 1e-9, `fc, n ${n}`);
    for (let i = 0; i <= 100; i++) {
      const v = chebyshevDb(n, i / 100, 1);
      assert.ok(v <= 1e-12 && v >= -1 - 1e-9, `ripple band n${n} r${i / 100}: ${v}`);
    }
  }
  close(chebyshevDb(2, 0, 1), -1, 1e-9, "even order sits at -ripple at DC");
  close(chebyshevDb(3, 0, 1), 0, 1e-9, "odd order at 0 dB at DC");
  // n = 1: 1/(1 + e^2 r^2)
  const e2 = 10 ** 0.1 - 1;
  close(chebyshevDb(1, 3, 1), -10 * Math.log10(1 + e2 * 9), 1e-12, "n=1 closed form");
  // far above: slope about 6.02 n dB/oct plus a constant lead over BW
  const slope = chebyshevDb(4, 512, 1) - chebyshevDb(4, 1024, 1);
  close(slope, 4 * 6.0206, 0.01, "n=4 asymptotic slope");
  assert.ok(chebyshevDb(4, 2, 1) < filterDb(2 * 100, 100, "BW", 24, "lp"), "steeper edge than Butterworth");
  assert.ok(Number.isFinite(chebyshevDb(16, 1e6, 1)) && Number.isFinite(chebyshevDb(16, 1e30, 1)));
});

test("Bessel: order 1 is Butterworth 6, order 2 from the closed form, -3.0103 dB at fc", () => {
  for (const r of [0.1, 0.5, 1, 2, 10]) close(besselDb(1, r), -10 * Math.log10(1 + r * r), 1e-9, `n=1 r=${r}`);
  // order 2: |H|^2 = 9 / ((3 - x^2)^2 + 9 x^2), with x = w3 r and w3^2 = (-3 + sqrt(45)) / 2
  const w3 = Math.sqrt((-3 + Math.sqrt(45)) / 2);
  for (const r of [0.2, 0.7, 1, 1.5, 6]) {
    const x = w3 * r;
    close(besselDb(2, r), 10 * Math.log10(9 / ((3 - x * x) ** 2 + 9 * x * x)), 1e-9, `n=2 r=${r}`);
  }
  for (let n = 1; n <= 16; n++) close(besselDb(n, 1), -3.0103, 1e-4, `corner n=${n}`);
  for (let n = 1; n <= 8; n++) {
    close(besselDb(n, 1e-4), 0, 1e-6, "dc");
    const slope = besselDb(n, 4000) - besselDb(n, 8000);
    close(slope, n * 6.0206, 0.01, `asymptotic slope n=${n}`);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = besselDb(n, i / 20);
      assert.ok(v <= prev + 1e-9, `monotonic n=${n}`);
      prev = v;
    }
  }
  assert.ok(Number.isFinite(besselDb(16, 1e12)));
  // Bessel is gentler than Butterworth just above the corner, then falls off at the same ultimate rate
  assert.ok(besselDb(4, 2) > filterDb(200, 100, "BW", 24, "lp"));
});
