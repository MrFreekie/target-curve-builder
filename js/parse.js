// Reading numbers typed into text boxes, and binding a box to a number in the document.

/** Parse "12", "-3.5" or "3,5". Rejects "1,000", "1e3", "0x10" and empty text (returns NaN). */
export function parseNum(s) {
  const t = String(s).trim();
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return NaN;
  if (/^[-+]?\d{1,3},\d{3}$/.test(t)) return NaN; // "1,000" is ambiguous: thousands or decimal?
  return Number(t.replace(",", "."));
}

/**
 * Make the binder for number boxes. The returned function ties a box to a number in the document.
 * @param {{$: (id: string) => HTMLElement, update: () => void}} app
 */
export function createBindNum({ $, update }) {
  /**
   * A text box bound to a number in the document. `get` gives the value the document holds now, so a box that was
   * typed into badly goes back to what the document really has, even after a preset, undo or shared link changed it.
   */
  return (id, set, get, { optional = false, check = null } = {}) => {
    $(id).addEventListener("blur", () => {
      if ($(id).getAttribute("aria-invalid")) { $(id).value = String(get() ?? ""); $(id).removeAttribute("aria-invalid"); }
    });
    $(id).addEventListener("input", () => {
      const raw = $(id).value.trim();
      const n = parseNum(raw);
      if (raw === "" && optional) { $(id).removeAttribute("aria-invalid"); set(null); }
      else if (Number.isFinite(n) && (!check || check(n))) { $(id).removeAttribute("aria-invalid"); set(n); }
      else { $(id).setAttribute("aria-invalid", "true"); return; }
      update();
    });
  };
}
