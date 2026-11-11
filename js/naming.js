// Suggested curve names built from the enabled layers, in the style of the reference files,
// e.g. "Tilt_3dBoct_1000Hz_HPF32_LR48". Pure module: no DOM access.

/** Compact number for a name: 32 -> "32", 1.5 -> "1.5", 1.2345 -> "1.23". */
function n(x) {
  return String(Number(Number(x).toFixed(2)));
}

/** "HPF32_LR48": frequency in Hz, then filter type and slope. */
function filterName(l, label) {
  return `${label}${n(l.fc)}_${l.type}${n(l.slope)}`;
}

/** Name parts for one enabled layer; an empty list means the layer changes nothing. */
function parts(l) {
  const p = rawParts(l);
  return l.invert === true ? p.map((x) => `Inv${x}`) : p;
}

function rawParts(l) {
  switch (l.kind) {
    case "weighting":
      const short = { A: "AWt", C: "CWt", RIAA: "RIAA", FM75: "FM75", FM50: "FM50" };
      return [Object.hasOwn(short, l.curve) ? short[l.curve] : "Wt"];
    case "lfTilt":
      return [`Tilt_${n(l.dbPerOct)}dBoct_${n(l.pivot)}Hz`, ...(l.floor != null ? [`floor${n(l.floor)}Hz`] : [])];
    case "fullTilt":
      return [`FullTilt_${n(l.dbPerOct)}dBoct_${n(l.pivot)}Hz`];
    case "hfTilt":
      return [`HFRoll_${n(l.dbPerOct)}dBoct_${n(l.corner)}Hz`];
    case "gain":
      return l.db ? [`${l.db > 0 ? "+" : ""}${n(l.db)}dB`] : [];
    case "points": {
      // A flat 0 dB points layer (the default) adds nothing to the name.
      const flat = l.points.every((p) => p[1] === l.points[0][1]);
      return flat && !l.points[0]?.[1] ? [] : [flat ? `Flat${n(l.points[0][1])}dB` : `Pts${l.points.length}`];
    }
    case "hiShelf":
      return l.db ? [`HiShelf${l.db > 0 ? "+" : ""}${n(l.db)}dB_${n(l.fc)}Hz_${l.type}${n(l.slope)}`] : [];
    case "bell":
      return l.db ? [`Bell${l.db > 0 ? "+" : ""}${n(l.db)}dB_${n(l.fc)}Hz_Q${n(l.q)}`] : [];
    case "hill":
      return l.db ? [`Hill${l.db > 0 ? "+" : ""}${n(l.db)}dB_${n(l.fc)}Hz_${n(l.width)}oct`] : [];
    case "rHpf":
      return [`RHPF${n(l.fc)}_Q${n(l.q)}`];
    case "rLpf":
      return [`RLPF${n(l.fc)}_Q${n(l.q)}`];
    case "subBoost":
      return l.db ? [`Sub${l.db > 0 ? "+" : ""}${n(l.db)}dB_${n(l.fc)}Hz_${l.type}${n(l.slope)}`] : [];
    case "hpf":
      return [filterName(l, "HPF")];
    case "lpf":
      return [filterName(l, "LPF")];
    default:
      return [];
  }
}

/**
 * Suggest a name from the enabled layers: tilts and points first, then gain, the sub boost, then the
 * high-pass and low-pass filters. A curve with nothing switched on is "Flat".
 * @param {{layers: object[]}} doc
 * @returns {string}
 */
export function suggestName(doc) {
  const on = doc.layers.filter((l) => l.on !== false && l.on !== 0);
  const order = { points: 0, fullTilt: 1, lfTilt: 1, hfTilt: 2, gain: 3, weighting: 3.1, bell: 3.2, hill: 3.3, subBoost: 3.5, hiShelf: 3.6, hpf: 4, rHpf: 4.5, lpf: 5, rLpf: 5.5 };
  const sorted = [...on].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  const name = sorted.flatMap(parts).join("_");
  return name || "Flat";
}
