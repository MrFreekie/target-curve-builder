// View settings kept in this browser only (localStorage). Every call is safe when storage is blocked or full:
// a read gives null and a write is quietly skipped, so the page works the same, just without remembering.

/** @param {string} key @returns {string|null} */
export function getPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
export function setPref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* storage unavailable: the setting just isn't remembered */ }
}
