// Q and bandwidth (in octaves) for the bell filter. Pure module: no DOM access.
// The bell's bandwidth is the width between its half-gain points (half the dB), in octaves. For the analog
// peaking prototype used in js/eq.js those points sit at x - 1/x = +/- 1/Q with x = f/fc, so the relation is exact:
//   BW = 2 asinh(1 / (2 Q)) / ln 2        Q = 1 / (2 sinh(BW ln 2 / 2)) = 2^(BW/2) / (2^BW - 1)

/**
 * Bandwidth in octaves between the half-gain points of a bell with quality factor `q`.
 * @param {number} q Quality factor, above 0.
 * @returns {number} Octaves.
 */
export function qToBw(q) {
  return (2 * Math.asinh(1 / (2 * q))) / Math.LN2;
}

/**
 * Quality factor of a bell with bandwidth `bw` octaves between the half-gain points.
 * @param {number} bw Octaves, above 0.
 * @returns {number} Q.
 */
export function bwToQ(bw) {
  return 1 / (2 * Math.sinh((bw * Math.LN2) / 2));
}
