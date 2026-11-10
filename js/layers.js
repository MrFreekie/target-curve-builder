// Pure layer maths and the filter registry. No DOM access. See docs/SPEC.md §4.
import { pos } from "./curve.js";

/**
 * Filter registry. Add a filter type by adding one entry.
 * magnitudeDb(f, fc, slope, mode) -> dB, mode is "hp" or "lp". Throws on an illegal slope.
 */
export const FILTERS = {
  BW: {
    id: "BW",
    label: "Butterworth",
    allowedSlopes: [6, 12, 18, 24, 30, 36, 42, 48],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      const n = slope / 6;
      const r = mode === "hp" ? fc / f : f / fc;
      return -10 * Math.log10(1 + r ** (2 * n));
    },
  },
  LR: {
    id: "LR",
    label: "Linkwitz-Riley",
    allowedSlopes: [12, 24, 36, 48],
    magnitudeDb(f, fc, slope, mode) {
      checkSlope(this, slope);
      const n = slope / 6;
      const r = mode === "hp" ? fc / f : f / fc;
      return -20 * Math.log10(1 + r ** n);
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
  const filter = FILTERS[type];
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
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  const x = pos(f);
  if (x <= pos(pts[0][0])) return pts[0][1];
  if (x >= pos(pts[pts.length - 1][0])) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
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
    default:
      throw new RangeError(`Unknown layer kind ${layer.kind}`);
  }
}

