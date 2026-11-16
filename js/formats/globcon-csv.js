// GLOBCON CSV export (.csv), write only: "FREQUENCY,MAGNITUDE" then 1024 rows of Hz and dB on a fixed log grid.
// Modelled on a curve file used with GLOBCON: LF line endings, a final newline, and every number written the way Java prints a
// 32-bit float widened to a double (shortest digits, "0.0" for zero, an E exponent below 0.001). The grid is the one in that
// file: 1024 points, 10 Hz to 32 kHz, equal steps in log frequency, each rounded to 32-bit float.
import { validateTf } from "./smaart.js";

/** Rows in the file. */
export const GLOBCON_POINTS = 1024;
/** The fixed frequencies, Hz: 10 * 3200^(k/1023), rounded to 32-bit float (exactly the file's own 1024 values). */
export const GLOBCON_GRID = Object.freeze(Array.from({ length: GLOBCON_POINTS }, (_, k) => Math.fround(10 * 3200 ** (k / (GLOBCON_POINTS - 1)))));

/** A number as Java's Double.toString writes it: "0.0", "10.0", "-12.385234832763672", "-5.665079224854708E-4". */
export function javaDouble(x) {
  if (!Number.isFinite(x)) throw new RangeError("A value that is not a finite number can't be written.");
  if (x === 0) return "0.0"; // never "-0.0"
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) {
    const s = String(x);
    return s.includes(".") ? s : `${s}.0`;
  }
  const [mantissa, exponent] = x.toExponential().split("e");
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}E${exponent.replace("+", "")}`;
}

/**
 * Write the curve as GLOBCON CSV. `points` must be the curve evaluated at GLOBCON_GRID.
 * @param {object} _doc
 * @param {number[][]} points [[hz, db], ...]
 * @returns {string}
 */
export function writeGlobconCsv(_doc, points) {
  const rows = points.map(([f, g]) => `${javaDouble(Math.fround(f))},${javaDouble(Math.fround(g))}`);
  return `FREQUENCY,MAGNITUDE\n${rows.join("\n")}\n`;
}

/** The same point, layer and name checks as the other writers, and the points must be the fixed grid. */
export function validateGlobconCsv(doc, points) {
  const out = validateTf({ ...doc, props: { name: doc.props?.name } }, points);
  if (points.length && !out.length && (points.length !== GLOBCON_POINTS || points.some((p, k) => p[0] !== GLOBCON_GRID[k]))) {
    out.push({ level: "error", message: "GLOBCON CSV needs its own 1024-point grid." });
  }
  if (points.some((p) => !Number.isFinite(Math.fround(p[1])))) out.push({ level: "error", message: "A level is too large to write." });
  return out;
}

/** GLOBCON CSV adapter (export only). `fixedGrid` tells the exporter to evaluate the curve on that grid, not the Output grid. */
export const globconCsv = {
  id: "globcon-csv",
  label: "GLOBCON CSV (.csv)",
  ext: ".csv",
  mime: "text/csv",
  canExport: true,
  fixedGrid: GLOBCON_GRID,
  detect() {
    return 0;
  },
  read() {
    throw new Error("GLOBCON CSV files are written, not read. Use Reference trace to draw one.");
  },
  write: writeGlobconCsv,
  validate: validateGlobconCsv,
};
