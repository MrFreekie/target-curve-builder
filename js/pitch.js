// Wavelengths for frequencies, for display only. Pure module: no DOM access.

/** Speed of sound used for wavelengths, in metres per second (about 20 °C air). */
export const SPEED_OF_SOUND = 343;

/**
 * Wavelength in metres: speed of sound divided by frequency.
 * @param {number} f Frequency in Hz.
 * @param {number} [c] Speed of sound in m/s.
 * @returns {number} NaN if f is not above 0
 */
export function wavelength(f, c = SPEED_OF_SOUND) {
  return Number.isFinite(f) && f > 0 ? c / f : NaN;
}

/**
 * Wavelength for display with a sensible unit: metres from 1 m, centimetres from 1 cm, otherwise millimetres,
 * to 3 significant figures.
 * @param {number} f Frequency in Hz.
 * @returns {string} "" if f is not above 0
 */
export function wavelengthLabel(f) {
  const m = wavelength(f);
  if (!Number.isFinite(m)) return "";
  if (m >= 1) return `${+m.toPrecision(3)} m`;
  if (m >= 0.01) return `${+(m * 100).toPrecision(3)} cm`;
  return `${+(m * 1000).toPrecision(3)} mm`;
}
