// Plain text export (.txt), write only: one "Hz<TAB>dB" row per point, no header.
// Reads easily into REW (house curve), HouseCurve, spreadsheets and most other tools that take a frequency and a level.
// Hz is written to 3 decimals and dB to 2: plenty for these tools, and never "-0.00". Lines end CRLF, as for the Smaart files.
import { validateTf } from "./smaart.js";
import { fmt2 } from "./smaart-ascii.js";

/** Hz to 3 decimals, never "-0.000". */
const fmt3 = (x) => (Math.round(x * 1000) / 1000 + 0).toFixed(3);

/**
 * Write the points as tab-separated text.
 * @param {object} _doc
 * @param {number[][]} points [[hz, db], ...]
 * @returns {string}
 */
export function writePlainText(_doc, points) {
  return points.map(([f, g]) => `${fmt3(f)}\t${fmt2(g)}`).join("\r\n") + "\r\n";
}

/** Same point, layer and name checks as the .crv writer; .crv-only properties are ignored. */
export function validatePlainText(doc, points) {
  return validateTf({ ...doc, props: { name: doc.props?.name } }, points);
}

/** Plain text adapter (export only). */
export const plainText = {
  id: "plain-text",
  label: "Plain text, Hz and dB (.txt)",
  ext: ".txt",
  mime: "text/plain",
  canExport: true,
  detect() {
    return 0;
  },
  read() {
    throw new Error("Use Reference trace to read plain text files.");
  },
  write: writePlainText,
  validate: validatePlainText,
};
