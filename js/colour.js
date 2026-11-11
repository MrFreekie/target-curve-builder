// Random curve colours that stand out against the current plot background.
// Pure module: no DOM access, importable from Node.

/** Parse "#rrggbb" or "rgb(r, g, b)" / "rgba(...)" into [r, g, b] (0-255), or null. */
export function parseColour(text) {
  const t = String(text).trim();
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/i.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, Math.round(v))) : null;
}

/** WCAG relative luminance of [r, g, b], 0 (black) to 1 (white). */
export function luminance([r, g, b]) {
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two [r, g, b] colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL (h 0-360, s and l 0-100) to [r, g, b]. */
export function hslToRgb(h, s, l) {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/** [r, g, b] to "#rrggbb". */
export function toHex(rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A random saturated colour with a WCAG contrast of at least `minContrast` against the background.
 * On a dark background it picks light colours, on a light background dark ones.
 * @param {string} background "#rrggbb" or "rgb(...)" of the plot background.
 * @param {() => number} [rng] Random source in [0, 1), for tests.
 * @param {number} [minContrast] Default 4.5.
 * @returns {string} "#rrggbb"
 */
export function randomContrastingColour(background, rng = Math.random, minContrast = 4.5) {
  const bg = parseColour(background) ?? [0, 0, 0];
  const darkBg = luminance(bg) < 0.4;
  for (let i = 0; i < 200; i++) {
    const h = Math.floor(rng() * 360);
    const s = 70 + rng() * 30;
    const l = darkBg ? 55 + rng() * 20 : 22 + rng() * 22;
    const rgb = hslToRgb(h, s, l);
    if (contrastRatio(rgb, bg) >= minContrast) return toHex(rgb);
  }
  return darkBg ? "#ffffff" : "#000000"; // can't happen for ordinary backgrounds
}
