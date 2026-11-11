// Format adapter registry (docs/SPEC.md §6). Add a format by adding one adapter here.
import { smaartTf, smaartSpectrum } from "./smaart.js";
import { smaartAscii } from "./smaart-ascii.js";
import { plainText } from "./plain-text.js";

/** All adapters, in the order they are tried by detect(). */
export const ADAPTERS = [smaartTf, smaartSpectrum, smaartAscii, plainText];

/** Look up an adapter by id, or undefined. */
export function getAdapter(id) {
  return ADAPTERS.find((a) => a.id === id);
}

/** Adapters that can write a file. */
export function writableAdapters() {
  return ADAPTERS.filter((a) => a.canExport);
}

/**
 * Pick the best adapter for some file text.
 * @param {string} text
 * @returns {{adapter: object, score: number}|null} null if nothing recognises the file
 */
export function detectFormat(text) {
  let best = null;
  for (const adapter of ADAPTERS) {
    const score = adapter.detect(text);
    if (score > 0 && (!best || score > best.score)) best = { adapter, score };
  }
  return best;
}
