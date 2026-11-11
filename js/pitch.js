// Musical note names and wavelengths for frequencies, for display only. Pure module: no DOM access.

/** Speed of sound used for wavelengths, in metres per second (about 20 °C air). */
export const SPEED_OF_SOUND = 343;

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/**
 * The nearest equal-tempered note for a frequency, in scientific pitch notation with A4 = 440 Hz
 * (middle C is C4, the lowest piano key A0 is 27.5 Hz), and how far off it is in cents.
 * @param {number} f Frequency in Hz.
 * @param {number} [a4] Reference pitch for A4 in Hz.
 * @returns {{name: string, octave: number, cents: number, midi: number}|null} null if f is not above 0
 */
export function nearestNote(f, a4 = 440) {
  if (!(f > 0) || !Number.isFinite(f)) return null;
  const exact = 69 + 12 * Math.log2(f / a4); // MIDI note number, A4 = 69
  const midi = Math.round(exact);
  const cents = (exact - midi) * 100;
  return { name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents, midi };
}

/**
 * Note label for display, for example "A4", "B1 +35¢", "D♯0 −49¢".
 * The cents are shown only when they round to a non-zero whole number.
 * @param {number} f Frequency in Hz.
 * @returns {string} "" if f is not above 0
 */
export function noteLabel(f) {
  const n = nearestNote(f);
  if (!n) return "";
  const c = Math.round(n.cents);
  return `${n.name}${n.octave}${c === 0 ? "" : ` ${c > 0 ? "+" : "−"}${Math.abs(c)}¢`}`;
}

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
