// Pure layer maths and the filter registry. No DOM access. See docs/SPEC.md §4.
import { pos } from "./curve.js";
import { bellDb, resonantDb, hillDb, besselDb, chebyshevDb, weightingDb, shapeDb, mesaDb } from "./eq.js";

/** Allowed ranges for layer parameters (SPEC §4.4b to §4.4e). */
export const LAYER_LIMITS = { q: [0.1, 50], resonantQ: [0.1, 20], width: [0.1, 10], db: [-60, 60], flat: [0, 0.99], count: [0.5, 16] };

/**
 * Filter registry. Add a filter type by adding one entry.
 * magnitudeDb(f, fc, slope, mode) -> dB, mode is "hp" or "lp". Throws on an illegal slope.
 */
export const FILTERS = {
  BW: {
    id: "BW",
    label: "Butterworth",
    allowedSlopes: [6, 12, 18, 24, 30, 36, 42, 48, 72, 96],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      const n = slope / 6;
      const r = mode === "hp" ? fc / f : f / fc;
      // Above the corner use the log form so a huge ratio can't overflow to -Infinity.
      return r > 1 ? -10 * (2 * n * Math.log10(r) + Math.log10(1 + r ** (-2 * n))) : -10 * Math.log10(1 + r ** (2 * n));
    },
  },
  LR: {
    id: "LR",
    label: "Linkwitz-Riley",
    allowedSlopes: [12, 24, 36, 48, 72, 96],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      const n = slope / 6;
      const r = mode === "hp" ? fc / f : f / fc;
      return r > 1 ? -20 * (n * Math.log10(r) + Math.log10(1 + r ** -n)) : -20 * Math.log10(1 + r ** n);
    },
  },
  BS: {
    id: "BS",
    label: "Bessel",
    allowedSlopes: [6, 12, 18, 24, 30, 36, 42, 48],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      return besselDb(slope / 6, mode === "hp" ? fc / f : f / fc);
    },
  },
  CH1: {
    id: "CH1",
    label: "Chebyshev (1 dB ripple)",
    shelfSafe: false, // its passband ripples, so a shelf made from it would not reach the full gain
    allowedSlopes: [6, 12, 18, 24, 30, 36, 42, 48],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      return chebyshevDb(slope / 6, mode === "hp" ? fc / f : f / fc, 1);
    },
  },
};

function checkSlope(filter, slope) {
  slope = Number(slope);
  if (!filter.allowedSlopes.includes(slope)) {
    throw new RangeError(`${filter.label} slope must be one of ${filter.allowedSlopes.join(", ")} dB/oct (got ${slope})`);
  }
}

/**
 * Magnitude of a high-pass or low-pass filter in dB, using the real frequency in Hz.
 * @param {number} f Frequency in Hz.
 * @param {number} fc Corner frequency in Hz.
 * @param {string} type Registry id, e.g. "LR".
 * @param {number} slope Nominal slope in dB/oct.
 * @param {"hp"|"lp"} mode
 * @returns {number} dB
 */
export function filterDb(f, fc, type, slope, mode) {
  const filter = Object.hasOwn(FILTERS, type) ? FILTERS[type] : undefined;
  if (!filter) throw new RangeError(`Unknown filter type ${type}`);
  return filter.magnitudeDb(f, fc, slope, mode);
}

/**
 * Linear interpolation in dB against octave position; end values are held outside the range.
 * @param {number} f
 * @param {number[][]} points [[hz, db], ...]
 * @returns {number}
 */
export function interpPoints(f, points) {
  // Sort only when needed (the editor keeps them in order), so a long list isn't copied for every frequency.
  let sorted = true;
  for (let i = 1; i < points.length; i++) if (points[i][0] < points[i - 1][0]) { sorted = false; break; }
  const pts = sorted ? points : [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  const x = pos(f);
  if (x <= pos(pts[0][0])) return pts[0][1];
  if (x >= pos(pts[pts.length - 1][0])) return pts[pts.length - 1][1];
  // Skip the segments that cannot hold f. pos() equals log2(f / 1000) except at the nominal labels, which it moves by
  // under 0.03 octave, so a segment that ends more than 0.1 octave below f can't match: find the first point that
  // is not that far below f (binary search on Hz), start one segment earlier, and scan forward in the usual order.
  const reach = f * 2 ** -0.1;
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < reach) lo = mid + 1; else hi = mid;
  }
  const start = Math.max(0, lo - 1);
  for (let i = start; i < pts.length - 1; i++) {
    const x0 = pos(pts[i][0]);
    const x1 = pos(pts[i + 1][0]);
    if (x >= x0 && x <= x1) {
      return x1 === x0 ? pts[i][1] : pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * dB contributed by one layer at frequency f (ignores the layer's `on` flag).
 * @param {number} f Frequency in Hz.
 * @param {object} layer
 * @returns {number} dB
 */
export function layerDb(f, layer) {
  const v = layerValue(f, layer);
  return layer.invert === true ? -v : v;
}

function layerValue(f, layer) {
  switch (layer.kind) {
    case "points":
      return interpPoints(f, layer.points);
    case "fullTilt":
      return layer.dbPerOct * (pos(layer.pivot) - pos(f));
    case "lfTilt": {
      let x = pos(f);
      if (layer.floor != null) x = Math.max(x, pos(layer.floor));
      return layer.dbPerOct * Math.max(0, pos(layer.pivot) - x);
    }
    case "hfTilt":
      return -layer.dbPerOct * Math.max(0, pos(f) - pos(layer.corner));
    case "hpf":
      return filterDb(f, layer.fc, layer.type, layer.slope, "hp");
    case "lpf":
      return filterDb(f, layer.fc, layer.type, layer.slope, "lp");
    case "gain":
      return layer.db;
    case "hiShelf":
      // High shelf: same idea as the sub boost, scaled by the linear magnitude of the matching high-pass.
      return layer.db * 10 ** (filterDb(f, layer.fc, layer.type, layer.slope, "hp") / 20);
    case "bell":
      return bellDb(f, layer.fc, layer.q, layer.db);
    case "rLpf":
      return resonantDb(f, layer.fc, layer.q, "lp");
    case "rHpf":
      return resonantDb(f, layer.fc, layer.q, "hp");
    case "hill":
      return hillDb(f, layer.fc, layer.width, layer.db);
    case "weighting":
      return weightingDb(layer.curve, f);
    case "mesa":
      return mesaDb(f, layer.fLow, layer.fHigh, layer.wLow, layer.wHigh, layer.db);
    case "shape":
      return shapeDb(layer.shape, f, layer.fc, layer.width, layer.db, layer.flat, layer.count);
    case "subBoost":
      // "Haystack": gain below a low-pass corner. db is scaled by the filter's linear magnitude (1 far below
      // the corner, 0 far above), so the full boost is reached well below fc and the corner gives a half
      // boost for Linkwitz-Riley.
      return layer.db * 10 ** (filterDb(f, layer.fc, layer.type, layer.slope, "lp") / 20);
    default:
      throw new RangeError(`Unknown layer kind ${layer.kind}`);
  }
}

