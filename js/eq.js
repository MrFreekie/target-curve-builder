// Extra magnitude-only response shapes for target curves: bell, resonant 2nd-order filters, Gaussian hill,
// Bessel and Chebyshev filters. Pure module: no DOM access. All results are in dB, phase is ignored.
// Definitions are in docs/SPEC.md §4.4 and §4.6.

const LN10 = Math.LN10;

/**
 * Bell (peaking) filter, analog prototype: x = f/fc, A = 10^(db/40),
 * |H|^2 = ((1-x^2)^2 + (x A/Q)^2) / ((1-x^2)^2 + (x/(A Q))^2). Gives exactly `db` at fc, 0 far away.
 * @param {number} f Frequency in Hz.
 * @param {number} fc Centre in Hz.
 * @param {number} q Quality factor (higher is narrower).
 * @param {number} db Gain in dB (negative cuts; a deep cut with high Q is a notch).
 * @returns {number} dB
 */
export function bellDb(f, fc, q, db) {
  // The bell is symmetric in log frequency, so fold x above 1 onto 1/x: exact, and no overflow for huge ratios.
  let x = f / fc;
  if (x > 1) x = 1 / x;
  const a = 10 ** (db / 40);
  const d = (1 - x * x) ** 2;
  return (10 / LN10) * Math.log((d + (x * a / q) ** 2) / (d + (x / (a * q)) ** 2));
}

/**
 * Resonant 2nd-order filter: |H|^2 = 1/((1-x^2)^2 + (x/Q)^2) for low-pass (x = f/fc), and the same
 * times x^4 for high-pass. Q = 0.7071 is Butterworth; above that the response peaks near fc by about 20 log10 Q.
 * @param {number} f
 * @param {number} fc
 * @param {number} q
 * @param {"lp"|"hp"} mode
 * @returns {number} dB
 */
export function resonantDb(f, fc, q, mode) {
  const x = f / fc;
  const den = (1 - x * x) ** 2 + (x / q) ** 2;
  const lp = Number.isFinite(den) && den > 0 ? -(10 / LN10) * Math.log(den) : -40 * Math.log10(x);
  return mode === "lp" ? lp : lp + 40 * Math.log10(x);
}

/**
 * Gaussian hill against log frequency: db * 2^(-4 (log2(f/fc) / width)^2). Full `db` at fc and half of it
 * `width/2` octaves either side, so `width` is the full width at half height in octaves.
 * @param {number} f
 * @param {number} fc
 * @param {number} width Octaves.
 * @param {number} db
 * @returns {number} dB
 */
export function hillDb(f, fc, width, db) {
  return db * 2 ** (-4 * (Math.log2(f / fc) / width) ** 2);
}

// ---------------------------------------------------------------- Chebyshev type I
/** ln of Chebyshev polynomial |T_n(x)|, stable for large x. */
function lnCheb(n, x) {
  const ax = Math.abs(x);
  if (ax <= 1) return Math.log(Math.abs(Math.cos(n * Math.acos(ax))));
  const y = n * Math.acosh(ax);
  return y + Math.log1p(Math.exp(-2 * y)) - Math.LN2; // ln cosh y
}

/**
 * Chebyshev type I low-pass (r = f/fc) or high-pass (r = fc/f) of order n with `ripple` dB of passband ripple.
 * |H|^2 = 1/(1 + e^2 T_n(r)^2), e^2 = 10^(ripple/10) - 1. fc is the edge of the ripple band: -ripple dB.
 * @param {number} n Order, 1 or more.
 * @param {number} r Frequency ratio.
 * @param {number} ripple Passband ripple in dB.
 * @returns {number} dB
 */
export function chebyshevDb(n, r, ripple) {
  const e2 = 10 ** (ripple / 10) - 1;
  const l = Math.log(e2) + 2 * lnCheb(n, r);
  return -(10 / LN10) * (l > 700 ? l : Math.log1p(Math.exp(l)));
}

// ---------------------------------------------------------------- Bessel
/** Coefficients of the reverse Bessel polynomial B_n(s) = sum a_k s^k, a_k = (2n-k)! / (2^(n-k) k! (n-k)!). */
function besselCoeffs(n) {
  const fact = (m) => { let v = 1; for (let i = 2; i <= m; i++) v *= i; return v; };
  return Array.from({ length: n + 1 }, (_, k) => fact(2 * n - k) / (2 ** (n - k) * fact(k) * fact(n - k)));
}

/** ln |B_n(j x)|^2, computed without overflow for large x. */
function lnBesselSq(a, n, x) {
  // Horner in (jx): P = sum a_k (jx)^k. For x > 1 factor out x^n and sum a_k j^k x^(k-n) in y = 1/x.
  const big = x > 1;
  const y = big ? 1 / x : x;
  let re = 0;
  let im = 0;
  for (let k = n; k >= 0; k--) {
    const c = big ? a[n - k] : a[k]; // coefficient attached to the power of y
    // multiply (re + j im) by j y, then add c
    const nr = -im * y + c;
    const ni = re * y;
    re = nr;
    im = ni;
  }
  // After the loop the accumulated value is sum c_i (jy)^i written in Horner form with the highest power first.
  const lnQ = Math.log(re * re + im * im);
  return big ? 2 * n * Math.log(x) + lnQ : lnQ;
}

const besselCache = new Map();
/** Order-n Bessel data: coefficients and the frequency scale w3 that puts the -3.0103 dB point at x = 1. */
function bessel(n) {
  let b = besselCache.get(n);
  if (!b) {
    const a = besselCoeffs(n);
    const target = Math.log(2); // ln of |H|^-2 at -3.0103 dB
    const lnA0 = 2 * Math.log(a[0]);
    const lnH2inv = (x) => lnBesselSq(a, n, x) - lnA0;
    let lo = 0;
    let hi = 1;
    while (lnH2inv(hi) < target) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (lnH2inv(mid) < target) lo = mid; else hi = mid;
    }
    b = { a, lnA0, w3: (lo + hi) / 2 };
    besselCache.set(n, b);
  }
  return b;
}

/**
 * Bessel (maximally flat delay) low-pass (r = f/fc) or high-pass (r = fc/f) of order n, -3.0103 dB at fc.
 * H(s) = B_n(0) / B_n(s w3), with B_n the reverse Bessel polynomial and w3 chosen for the -3 dB point.
 * @param {number} n Order, 1 to 16.
 * @param {number} r Frequency ratio.
 * @returns {number} dB
 */
export function besselDb(n, r) {
  const { a, lnA0, w3 } = bessel(n);
  return -(10 / LN10) * (lnBesselSq(a, n, w3 * r) - lnA0);
}

// ---------------------------------------------------------------- Weighting and classic EQ curves
/** 10 log10(f^2 + a^2), stable for any f and a. */
function lg(f, a) {
  const hi = Math.max(f, a);
  const lo = Math.min(f, a);
  return 20 * Math.log10(hi) + 10 * Math.log10(1 + (lo / hi) ** 2);
}

/** 10 log10(1 + x^2) where x = 10^logx, computed from the log so any frequency is safe. */
function lgOne(logx) {
  return logx > 0 ? 20 * logx + 10 * Math.log10(1 + 10 ** (-2 * logx)) : 10 * Math.log10(1 + 10 ** (2 * logx));
}

/** log10 of w * tau for w = 2 pi f. */
const logWt = (f, tau) => Math.log10(2 * Math.PI * tau) + Math.log10(f);

// IEC 61672-1 pole frequencies (Hz).
const F1 = 20.598997;
const F2 = 107.65265;
const F3 = 737.86223;
const F4 = 12194.217;

const aRaw = (f) => 40 * Math.log10(F4) + 80 * Math.log10(f) - 2 * lg(f, F1) - lg(f, F2) - lg(f, F3) - 2 * lg(f, F4);
const cRaw = (f) => 40 * Math.log10(F4) + 40 * Math.log10(f) - 2 * lg(f, F1) - 2 * lg(f, F4);
// RIAA replay: (1 + s 318us) / ((1 + s 3180us)(1 + s 75us)).
const riaaRaw = (f) => lgOne(logWt(f, 318e-6)) - lgOne(logWt(f, 3180e-6)) - lgOne(logWt(f, 75e-6));
// FM pre-emphasis: 1 + s tau (tau 75 us in the Americas and Japan, 50 us in Europe), 0 dB at low frequencies.
const fmDb = (tau) => (f) => lgOne(logWt(f, tau));

/**
 * Weighting and classic EQ curves, magnitude only, in dB.
 * A, C and RIAA are shifted so the response is exactly 0 dB at 1 kHz; the FM curves are 0 dB at low frequencies.
 * @type {Record<string, {label: string, db: (f: number) => number}>}
 */
export const WEIGHTINGS = {
  A: { label: "A-weighting (dBA)", db: (f) => aRaw(f) - aRaw(1000) },
  C: { label: "C-weighting (dBC)", db: (f) => cRaw(f) - cRaw(1000) },
  RIAA: { label: "RIAA playback (replay)", db: (f) => riaaRaw(f) - riaaRaw(1000) },
  FM75: { label: "FM pre-emphasis 75 µs", db: fmDb(75e-6) },
  FM50: { label: "FM pre-emphasis 50 µs", db: fmDb(50e-6) },
};

/**
 * Value of a weighting or classic curve at one frequency.
 * @param {string} curve Key of WEIGHTINGS.
 * @param {number} f Frequency in Hz.
 * @returns {number} dB
 */
export function weightingDb(curve, f) {
  if (typeof curve !== "string" || !Object.hasOwn(WEIGHTINGS, curve)) throw new RangeError(`Unknown weighting curve ${curve}`);
  return WEIGHTINGS[curve].db(f);
}

// ---------------------------------------------------------------- Shapes
/**
 * The outline of a dog, side on, facing right, as heights from 0 to 1 against u from -1 (tail) to +1 (nose).
 * A response curve has one value per frequency, so this is the skyline of the dog: tail, back, neck, head with a
 * pointed ear, forehead, stop, snout and nose.
 * @type {ReadonlyArray<readonly [number, number]>}
 */
export const DOG_OUTLINE = [
  [-1.0, 0.4], [-0.94, 0.55], [-0.88, 0.3], [-0.8, 0.26], [-0.55, 0.3], [-0.3, 0.36], [-0.12, 0.4],
  [0.0, 0.5], [0.08, 0.66], [0.14, 0.95], [0.22, 0.68], [0.3, 0.72], [0.44, 0.64], [0.56, 0.58],
  [0.74, 0.55], [0.88, 0.5], [0.96, 0.42], [1.0, 0.3],
];

/** Straight-line interpolation through the dog's outline. */
function dogHeight(u) {
  const pts = DOG_OUTLINE;
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [u0, g0] = pts[i - 1];
      const [u1, g1] = pts[i];
      return g0 + ((g1 - g0) * (u - u0)) / (u1 - u0);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * Fun shapes drawn on the graph against log frequency: u = log2(f/fc) / (width/2), so the shape spans
 * u from -1 to +1 (the full base width, in octaves) and is 0 outside. `db` is the height (negative for a dip).
 * t = (u + 1) / 2 runs from 0 at the left edge to 1 at the right edge. `count` is the number of cycles for the
 * waves and the number of steps for the staircase; `countLabel` names it in the UI (null: not used).
 * @type {Record<string, {label: string, countLabel: string|null, value: (u: number, flat: number, count: number) => number}>}
 */
export const SHAPES = {
  pyramid: { label: "Pyramid (triangle)", countLabel: null, value: (u) => 1 - Math.abs(u) },
  box: { label: "Box (square)", countLabel: null, value: () => 1 },
  semicircle: { label: "Half circle", countLabel: null, value: (u) => Math.sqrt(1 - u * u) },
  trapezoid: { label: "Trapezoid", countLabel: null, value: (u, flat) => Math.min(1, (1 - Math.abs(u)) / (1 - flat)) },
  cosine: { label: "Cosine bump (smooth)", countLabel: null, value: (u) => 0.5 * (1 + Math.cos(Math.PI * u)) },
  parabola: { label: "Parabola (arch)", countLabel: null, value: (u) => 1 - u * u },
  rampUp: { label: "Ramp up (sawtooth)", countLabel: null, value: (u) => (1 + u) / 2 },
  rampDown: { label: "Ramp down (sawtooth)", countLabel: null, value: (u) => (1 - u) / 2 },
  sine: { label: "Sine wave", countLabel: "Cycles", value: (u, flat, count) => Math.sin(Math.PI * count * (u + 1)) },
  square: { label: "Square wave", countLabel: "Cycles", value: (u, flat, count) => (Math.sin(Math.PI * count * (u + 1)) >= 0 ? 1 : -1) },
  dog: { label: "Dog (side profile)", countLabel: null, value: (u) => dogHeight(u) },
  stairs: { label: "Staircase (rising)", countLabel: "Steps", value: (u, flat, count) => {
    const n = Math.max(2, Math.round(count));
    return Math.min(n - 1, Math.floor(((u + 1) / 2) * n)) / (n - 1);
  } },
};

/**
 * Value of a shape at one frequency.
 * @param {string} shape Key of SHAPES.
 * @param {number} f Frequency in Hz.
 * @param {number} fc Centre in Hz.
 * @param {number} width Full base width in octaves.
 * @param {number} db Height in dB.
 * @param {number} [flat] Trapezoid only: fraction of the half width that is flat on top, 0 to below 1.
 * @param {number} [count] Sine and square wave: cycles across the width. Staircase: number of steps.
 * @returns {number} dB
 */
export function shapeDb(shape, f, fc, width, db, flat = 0.5, count = 3) {
  if (typeof shape !== "string" || !Object.hasOwn(SHAPES, shape)) throw new RangeError(`Unknown shape ${shape}`);
  let u = Math.log2(f / fc) / (width / 2);
  // A frequency within 1e-12 of an edge (floating-point noise) counts as exactly on the edge.
  if (!(Math.abs(u) <= 1 + 1e-12)) return 0; // also 0 for NaN
  u = Math.max(-1, Math.min(1, u));
  return db * SHAPES[shape].value(u, flat, count);
}

// ---------------------------------------------------------------- Mesa-style asymmetric filter
/** Raised-cosine step: 0 below t = 0, 1 above t = 1, and 0.5 (1 - cos(pi t)) between. */
function rcStep(t) {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return 0.5 * (1 - Math.cos(Math.PI * t));
}

/**
 * Mesa-style asymmetric filter, built as the description of the Lake Mesa EQ says: two raised-cosine shelf steps
 * (half a cosine cycle against log frequency), one rising and one falling, each with its own slope, summed.
 * The rising step is centred on `fLow` and spans `wLow` octaves; the falling step is centred on `fHigh` and spans
 * `wHigh` octaves. `fLow` and `fHigh` are the half-gain points. This is our own construction from that description,
 * not Lake's published algorithm.
 * @param {number} f Frequency in Hz.
 * @param {number} fLow Lower edge (half-gain point) in Hz.
 * @param {number} fHigh Upper edge (half-gain point) in Hz.
 * @param {number} wLow Width of the lower flank in octaves.
 * @param {number} wHigh Width of the upper flank in octaves.
 * @param {number} db Gain in dB (negative cuts).
 * @returns {number} dB
 */
export function mesaDb(f, fLow, fHigh, wLow, wHigh, db) {
  const up = rcStep(Math.log2(f / fLow) / wLow + 0.5);
  const down = rcStep(Math.log2(f / fHigh) / wHigh + 0.5);
  // Where the two flanks overlap the plain difference can go below 0, which would turn a boost into a cut; keep it
  // between 0 and the full gain.
  return db * Math.max(0, Math.min(1, up - down));
}
