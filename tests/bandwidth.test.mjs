import { test } from "node:test";
import assert from "node:assert/strict";
import { qToBw, bwToQ } from "../js/bandwidth.js";
import { bellDb } from "../js/eq.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);

test("known pairs: Q 1.4142 is about 1 octave, Q 0.7071 about 1.9 octaves, Q 4.3 about 0.335 octave", () => {
  close(qToBw(Math.SQRT2), 1.0, 0.012, "Q sqrt2");
  close(bwToQ(1), 1.4142, 1e-4, "1 octave");
  close(bwToQ(2), 0.6667, 1e-4, "2 octaves: 2^1/(2^2-1) = 2/3");
  close(qToBw(4.3), 0.3348, 5e-4, "Q 4.3: 2 asinh(1/8.6) / ln 2");
});

test("the closed forms agree: Q = 2^(BW/2) / (2^BW - 1)", () => {
  for (const bw of [0.03, 0.1, 0.33, 0.5, 1, 1.5, 2, 3, 6.5]) {
    close(bwToQ(bw), 2 ** (bw / 2) / (2 ** bw - 1), 1e-9 * bwToQ(bw), `bw ${bw}`);
  }
});

test("round trip: Q -> BW -> Q and BW -> Q -> BW over the app's Q range 0.1 to 50", () => {
  for (const q of [0.1, 0.25, 0.5, 0.7071, 1, 1.4, 2, 4.3, 10, 25, 50]) close(bwToQ(qToBw(q)), q, 1e-9 * q, `Q ${q}`);
  for (const bw of [0.03, 0.2, 0.7, 1, 2, 4, 6.6]) close(qToBw(bwToQ(bw)), bw, 1e-9 * bw, `BW ${bw}`);
  close(qToBw(0.1), 6.6723, 1e-3, "Q 0.1 is about 6.67 octaves");
  close(qToBw(50), 0.0289, 1e-4, "Q 50 is about 0.029 octave");
  assert.ok(qToBw(2) < qToBw(1) && qToBw(0.5) > qToBw(1), "higher Q is narrower");
});

test("the defining property: the bell is exactly half its gain (in dB) at the edges of its bandwidth", () => {
  for (const [bw, db] of [[0.1, 6], [0.5, -9], [1, 12], [2, -6], [3, 24], [0.03, -40]]) {
    const q = bwToQ(bw);
    const fc = 1000;
    // the edges are geometrically symmetric about fc: fc * 2^(+/- bw/2) is the textbook definition for the
    // analog prototype only through x - 1/x = 1/Q, so find the edges from that and check the half-gain level
    const half = 1 / (2 * q);
    const x2 = half + Math.sqrt(half * half + 1);
    const x1 = 1 / x2;
    close(Math.log2(x2 / x1), bw, 1e-9, `edges span ${bw} octaves`);
    close(bellDb(fc * x1, fc, q, db), db / 2, 1e-9, `lower edge, bw ${bw}`);
    close(bellDb(fc * x2, fc, q, db), db / 2, 1e-9, `upper edge, bw ${bw}`);
  }
});
