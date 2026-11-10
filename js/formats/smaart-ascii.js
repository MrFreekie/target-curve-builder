// Smaart ASCII trace export (.txt), write only.
// Layout copied from a Smaart "export ASCII" file (see docs/SMAART_NOTES.md):
//   <TAB>name<TAB><TAB>
//   Frequency (Hz)<TAB>Magnitude (dB)<TAB>Phase (degrees)<TAB>Coherence
//   freq(6 decimals)<TAB>dB(2)<TAB>phase(2)<TAB>coherence(2)     one row per point
// All line endings are CRLF, including the one after the last row.
// A target curve has no phase or coherence, so those columns are written as 0.00 and 1.00.
import { fmt6, validateTf } from "./smaart.js";

/** Format to 2 decimals, never "-0.00". */
export function fmt2(x) {
  return (Math.round(x * 100) / 100 + 0).toFixed(2).replace(/^-0\.00$/, "0.00");
}

/**
 * Write a Smaart ASCII trace.
 * @param {{props: {name?: string}}} doc
 * @param {number[][]} points [[hz, db], ...]
 * @returns {string}
 */
export function writeAscii(doc, points) {
  const name = String(doc.props?.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  const lines = [
    `\t${name}\t\t`,
    "Frequency (Hz)\tMagnitude (dB)\tPhase (degrees)\tCoherence",
    ...points.map(([f, g]) => `${fmt6(f)}\t${fmt2(g)}\t0.00\t1.00`),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Same point, layer and name checks as the .crv writer; .crv-only properties are ignored. */
export function validateAscii(doc, points) {
  return validateTf({ ...doc, props: { name: doc.props?.name } }, points);
}

/** Smaart ASCII trace adapter (export only). */
export const smaartAscii = {
  id: "smaart-ascii",
  label: "Smaart ASCII trace (.txt)",
  ext: ".txt",
  mime: "text/plain",
  canExport: true,
  detect() {
    return 0;
  },
  read() {
    throw new Error("Importing Smaart ASCII files isn't supported.");
  },
  write: writeAscii,
  validate: validateAscii,
};
