# Target Curve Builder: Specification

A single-page web app, hosted on GitHub Pages, for building, importing, visualising and editing sound system tuning target curves. It exports **one file at a time**, primarily Smaart transfer function target curves (`.crv`). The design leaves room for more formats and filter types later.

The maths in this spec is implemented independently in `reference/curve_ref.py`. Expected outputs are in `reference/golden.json`. If this spec and the reference disagree, stop and raise it. Do not quietly "fix" either one.

---

## 1. Scope

### v1 (this build)
- **Build a curve from layers:** imported or manual points, full-spectrum tilt, LF tilt (with optional floor), HF tilt, HPF, LPF and a gain offset.
- **Live plot:** log-frequency axis from 20 Hz to 20 kHz, with a tolerance band and draggable points.
- **Editable points table.**
- **File properties:** name, colour picker, line width, show, tolerance, use tolerance and offset.
- **Import an existing `.crv`:** visualise it, modify it and export it as a new file. The original stays visible as a faint overlay.
- **Export a single Smaart TF `.crv`.**
- **Presets:** save and load in the browser (localStorage), plus JSON file save and load.

### Not in v1 (design for, don't build)
- **Batch export:** explicitly out of scope. Do not add it.
- **Spectrum (RTA) target curves:** export (`Band` header) comes in milestone 5. In v1, importing a spectrum file must work for viewing, with a notice that export is TF-only.
- **Other export formats:** for example REW. Add these through the format adapter interface in §6. (Added after v1.0.0: Smaart ASCII trace `.txt`, write only. See `docs/SMAART_NOTES.md`.)
- **More filter types:** for example Bessel or custom orders. Add these through the filter registry in §4.4.
- **Share-by-URL and offline PWA.**

---

## 2. Tech constraints

- **Stack:** plain HTML, CSS and JavaScript ES modules. **No build step, no framework, no runtime dependencies.** The app must work when served as static files from the repo root.
- **Plotting:** hand-written SVG. Do not use charting libraries.
- **Tests:** `node --test` (Node 20+), plus `python3 -I reference/curve_ref.py --check`.
- **Modules:** maths modules (`js/layers.js`, `js/curve.js`, `js/formats/*.js`) must be pure. That means no DOM access and no global state, so they can be imported directly by Node tests.
- **Browser storage:** every localStorage call is wrapped in try/catch, and the app must still work if storage is unavailable.
- **Browsers:** current Chrome, Safari, Firefox and Edge on desktop, plus Safari on iPad. On phones it only needs to be usable for viewing.

---

## 3. Frequency grid and positions

### 3.1 Octave position
All log-frequency geometry (tilts, point interpolation, plot x-axis) uses a **position** in octaves relative to 1 kHz:

```
pos(f) = (index(f) - index(1000)) / 3   if f is a nominal ISO 1/3-octave label (exact match)
pos(f) = log2(f / 1000)                 otherwise
```

Nominal labels are `20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000`.

The snapping keeps the steps clean: on a 3 dB/oct tilt, 63 Hz is **exactly** +12.000000 and not 11.96. Engineers expect these numbers and check them by eye.

**Filters are the exception:** filter maths uses the **actual frequency in Hz**, not `pos()`.

### 3.2 Output grid (`grid.mode = "resample"`)
- **`fraction: 3`:** the nominal 1/3-octave labels inside `[fmin, fmax]`. The default is 20 Hz to 20 kHz, which gives 31 points.
- **`fraction: 1`:** nominal octave labels `31.5 … 16000`.
- **`fraction: 6, 12, 24, 48`:** exact frequencies `1000 · 2^(k/N)` inside `[fmin, fmax]`, rounded to 6 decimal places.

### 3.3 Keep-original grid (`grid.mode = "original"`)
Output frequencies are exactly the imported file's frequencies, in the same order. All layers are evaluated at those frequencies. This is the default after import, so that importing a file and exporting it unchanged reproduces it.

### 3.4 Breakpoints only (`grid.mode = "simplified"`)
Added after v1.0.0. A `.crv` need not list every value, because Smaart draws a straight line between two points. This mode exports only the points needed to reproduce the curve within `grid.epsilon` dB (default 0.1, allowed 0.001 to 12).
- **Dense curve:** evaluate on a 1/48-octave grid from `fmin` to `fmax` plus `fmin`, `fmax` and every layer corner (point frequencies; `pivot`, `corner`, `floor` and `fc` of enabled layers). A grid frequency with the same `pos()` as a corner, or within 1e-6 relative of one, is dropped (decided from the exact grid frequency, before rounding), so the corner keeps the frequency the user typed (62.5 Hz and 63 Hz are both -4 octaves). Corners are merged only when equal after rounding to 6 decimals.
- **Normalise** is applied to the dense curve, then the curve is reduced, then values are rounded (§4.7).
- **Reduce (Ramer-Douglas-Peucker):** always keep the first and last points. Between two kept points, if the largest vertical distance in dB from a point to the straight line between them, drawn against `pos(f)`, is more than `epsilon` minus 1e-6, keep that point and split there. (The 1 µdB margin keeps the guarantee true after rounding to 6 decimals.) An `epsilon` outside 0.001 to 12 counts as the default 0.1. `fmin` must be at least 1 Hz.
- **Guarantee:** straight lines through the exported points, against `pos(f)`, stay within `epsilon` dB of the dense curve at every dense point.
- **Assumption, not yet confirmed in Smaart:** that Smaart's straight line is against log frequency, like the plot.

---

## 4. Layers (all values in dB, summed)

The curve is `total(f) = Σ layer(f)` over layers with `on: true`, then optionally normalised (§4.6). Signs: **positive `dbPerOct` on a tilt lifts the low end** (or, for `hfTilt`, rolls off the top).

### 4.1 Points (`kind: "points"`)
- `points: [[hz, db], …]`, sorted by frequency.
- Interpolation is linear in dB against `pos(f)`.
- Outside the first and last points, **hold the end values**. The original files describe a shelf, so holding keeps that shape.
- Dragging a point on the plot changes its dB value. Holding Shift while dragging also moves its frequency, and the frequency snaps to 1/24 octave.

### 4.2 Tilts
| kind | params | formula |
|---|---|---|
| `fullTilt` | `dbPerOct`, `pivot` | `s · (pos(pivot) − pos(f))`, applied across the whole band |
| `lfTilt` | `dbPerOct`, `pivot`, `floor` (nullable) | `x = max(pos(f), pos(floor))` if `floor` is set, else `pos(f)`; then `s · max(0, pos(pivot) − x)` |
| `hfTilt` | `dbPerOct`, `corner` | `−s · max(0, pos(f) − pos(corner))` |

### 4.3 Gain (`kind: "gain"`)
`db` is a constant offset.

### 4.4 Filters (`kind: "hpf"` / `"lpf"`)
Parameters: `fc` (Hz), `type`, `slope` (dB/oct, nominal). `r = fc/f` for a high-pass and `f/fc` for a low-pass.

| type | allowed slopes | magnitude (dB) | at fc |
|---|---|---|---|
| `BW` Butterworth, order n = slope/6 | 6, 12, 18, 24, 30, 36, 42, 48 | `−10·log10(1 + r^(2n))` | −3.0103 |
| `LR` Linkwitz-Riley = BW(n/2) squared, n = slope/6 | 12, 24, 36, 48 | `−20·log10(1 + r^n)` | −6.0206 |

- **Magnitude only.** Phase is not part of a target curve.
- **True slope:** a "48 dB/oct" filter's real stop-band slope is 8 × 6.0206 = 48.165 dB/oct. Tests must expect that, not exactly 48.
- **Registry:** filters live in a registry `{ id, label, allowedSlopes, magnitudeDb(f, fc, slope, mode) }`, so adding Bessel or another type later means adding one entry.
- **Default for a new HPF:** LR 48 dB/oct at 32 Hz. This matches the user's existing files.

### 4.4a Sub boost, "haystack" (`kind: "subBoost"`)
Added after v1.0.0. Boosts or cuts everything below a low-pass corner. Parameters: `db` (± dB), `fc` (Hz), `type` and `slope` as for filters (§4.4, same allowed slopes).

`value(f) = db * M(f)`, where `M(f)` is the **linear** magnitude of the low-pass filter: `M = 10^(lpfDb(f, fc, type, slope) / 20)`. It is 1 far below `fc` and 0 far above, so the full `db` is reached well below the corner. At `fc` the Linkwitz-Riley value is half of `db` (M = 0.5), the Butterworth value is 0.7071 of `db`. Closed forms with `r = f/fc`, `n = slope/6`: LR `M = 1/(1 + r^n)`, BW `M = 1/sqrt(1 + r^(2n))`. Frequencies use Hz, like filters. A negative `db` is a cut, the exact mirror image. Magnitude only: this is not a parallel-summed filter, so phase doesn't change the result. Combine with an HPF layer for the haystack hump. `fc` is a layer corner for the "Breakpoints only" grid (§3.4).

### 4.5 Defaults for a new document
- **Layers:** `points` (`[[20,0],[20000,0]]`, on), `lfTilt` (3 dB/oct, pivot 1 kHz, off), `fullTilt` (off), `hfTilt` (off), `hpf` (off), `lpf` (off).
- **Grid:** resample at 1/12 octave (119 points from 20 Hz to 20 kHz). Chosen by the user; the built-in presets that mirror the 1/3-octave reference files keep 1/3.

### 4.6 Normalise
`normalise: { on, at }`. When on, subtract `total(at)` from every point. The default is `at: 1000`.

### 4.7 Rounding
Round values to 6 decimal places, then add `+0.0` so the file never contains `-0.000000`.

---

## 5. Smaart `.crv` format

Source: Rational Acoustics support, "How to Create and Import Target Curve Files", plus the user's own files in `reference/samples/`.

### 5.1 Transfer function (TF) curve. This is what v1 writes.
```
Line:<TAB>2
Color:<TAB>ffff0000
Show:<TAB>1
Type:<TAB>TF
Tolerance:<TAB>3.0000
UseTolerance:<TAB>0
<blank line>
63.000000<TAB>7.000000
315.000000<TAB>0.000000
...
```

- **Header order** is exactly as shown. `Offset:<TAB>x.xxxx` is appended after `UseTolerance` **only** when the user has set an offset.
- **Line:** an integer from 1 to 5 (line thickness). The default is 2.
- **Color:** 8 lowercase hex digits. **Assumed** to be AARRGGBB, which fits the user's red `ffff0000`. Alpha is `ff`. The colour picker gives `#rrggbb`, which is written as `ff` + `rrggbb`. Confirmed in Smaart with the two test files in §9 (green and blue shown correctly).
- **Show:** `0` or `1` only.
- **Tolerance:** written with 4 decimals. ±value dB is drawn as a shaded band.
- **UseTolerance:** `0` or `1`. It isn't in the Rational Acoustics article, but Smaart writes it. Keep it.
- **Offset:** a y offset normalised to 1 kHz. It is optional.
- **Data:** `freq<TAB>db`, both with 6 decimals. Use **tabs only**, because Smaart can crash on spaces or commas. At least 2 points, ascending frequency.
- **Line endings:** CRLF for new files. For a re-export of an imported file, use whatever endings the import had.
- **Trailing newline:** new files end with a single line ending after the last data row. For a re-export of an import, keep whatever the original had.
- **File name:** `<name>.crv`. The download must not end up as `.crv.txt`, so use the Blob type `application/octet-stream`. Strip `/\:*?"<>|` from the name.
- **Compatibility:** TF target curves need measurement-capable editions of Smaart 9.4 or later, or Smaart Data Modeler. Smaart RTA cannot import TF curves. Show this as a one-line note in the export area.

### 5.2 Spectrum curve (read in v1, write later)
- **Header:** `Line`, `Color`, `Show`, `Band` (1, 3, 6, 12, 24 or 48), with `Type` optional or absent.
- **Values:** levels are absolute SPL-style values.
- **On import:** plot the curve, show a notice saying "Spectrum curve: export as Spectrum arrives in a later version", and allow converting it to a TF curve (a points layer normalised at 1 kHz).

### 5.3 Reader rules (lenient)
- Accept CRLF or LF line endings, and a UTF-8 BOM.
- Header keys are case-insensitive, and the separator after `:` can be a tab or spaces.
- Data rows can be separated by tabs, spaces or commas. Skip blank or bad rows, but count them and report the count.
- **Unknown header lines are preserved in order and written back on export.**
- **Raw header text is kept:** the reader keeps the raw text of every header line. On export, a line whose property the user hasn't changed is written back exactly as read, so `Tolerance: 3` stays `Tolerance: 3` and doesn't become `3.0000`. Lines the user changed are written in the canonical format in §5.1. If the original header had no `Type: TF`, add it at the end of the header, because the output is TF.
- **Trailing newline:** `user_LA_7dB_at_315k.crv` has **no** trailing newline and the other samples have one. The round trip has to keep whichever the file had.
- Reading then writing an unchanged import with `grid.mode = "original"` must give **byte-identical** output. Every file in `reference/samples/` is tested this way.

---

## 6. Format adapters

`js/formats/index.js` exports a registry. Each adapter is:

```js
{
  id: "smaart-tf",
  label: "Smaart TF target (.crv)",
  ext: ".crv",
  detect(text) -> score 0..1,
  read(text) -> { props, points, extraHeader, lineEnding, trailingNewline, warnings },
  write(doc, points) -> string,
  validate(doc, points) -> [ { level: "error"|"warn", message } ]
}
```

v1 adapters are `smaart-tf` (read and write) and `smaart-spectrum` (read only). Export is blocked while `validate` returns any errors.

---

## 7. Document model (also the preset/JSON format)

```json
{
  "version": 1,
  "props": { "name": "LA 7dB 315", "format": "smaart-tf", "line": 2, "color": "ffff0000",
             "show": 1, "tolerance": 3.0, "useTolerance": 0, "offset": null,
             "extraHeader": [], "lineEnding": "\r\n", "trailingNewline": true },
  "grid": { "mode": "resample", "fraction": 3, "fmin": 20, "fmax": 20000 },
  "layers": [
    { "id": "pts", "kind": "points", "on": true, "points": [[63, 7], [315, 0], [20000, 0]] },
    { "id": "lft", "kind": "lfTilt", "on": false, "dbPerOct": 3, "pivot": 1000, "floor": null },
    { "id": "hp",  "kind": "hpf", "on": true, "fc": 32, "type": "LR", "slope": 48 }
  ],
  "normalise": { "on": false, "at": 1000 },
  "original": null
}
```

`original` holds the imported points, for the faint overlay. It is never exported.

---

## 8. UI

```
┌──────────────────────────────────────────────────────────────────┐
│ Target Curve Builder   [New] [Import .crv] [Presets ▾] [Export]  │
├───────────────────────┬──────────────────────────────────────────┤
│ FILE PROPERTIES       │  PLOT  (SVG)                             │
│ Name   [__________]   │  x: 20 Hz–20 kHz log, gridlines at       │
│ Colour [■ picker]     │     octaves + 1/3 octave minor           │
│ Line   [2 ▾]  Show ☑  │  y: auto range, default −24…+24 dB       │
│ Tolerance [3.0] Use ☐ │  curve in chosen colour + tolerance band │
│ Offset [   ]          │  original import: thin grey dashed       │
│                       │  points: draggable handles               │
│ LAYERS          [+ ▾] │  hover: readout "63 Hz  +6.96 dB"        │
│ ☑ Points (3)   [edit] │                                          │
│ ☐ LF tilt 3 dB/oct    ├──────────────────────────────────────────┤
│ ☑ HPF 32 Hz LR48      │  POINTS TABLE  Hz | dB   (editable)      │
│ ☐ LPF                 │  [Copy as text]                          │
│ OUTPUT GRID           │                                          │
│ ◉ 1/3 oct ○ original  │  Validation: ✓ ready to export           │
│ ○ 1/6 ○ 1/12 ○ 1/24   │  "TF curves need Smaart 9.4+"            │
│ ☐ Normalise @ [1000]  │                                          │
└───────────────────────┴──────────────────────────────────────────┘
```

- **Live updates:** changing any control updates the plot and table immediately.
- **Layers:** each layer row has an on/off switch, expandable controls, delete and reorder. Order doesn't change the sum but does help readability.
- **Points table:** shows the exported points, i.e. the evaluated curve on the output grid. "Edit points" opens the points-layer table, which is the input points.
- **Import:** by file picker or drag-and-drop onto the plot. After import, the grid mode is `original`, the points layer holds the file's data, the header fills the properties panel, and `original` is set for the overlay.
- **Keyboard and accessibility:** every control has a label, the plot has a text alternative (the table), and colour is never the only cue.
- **Undo/redo:** a stack of document snapshots, with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, keeping at least 50 steps.
- **Autosave:** the current document is autosaved to localStorage and restored on load, with try/catch around storage.

---

## 9. Acceptance criteria (definition of done for v1)

1. **Maths:** `node --test` passes, including every case in `reference/golden.json` within 1e-6 dB, and `python3 -I reference/curve_ref.py --check` prints `OK`.
2. **Round trip:** every file in `reference/samples/` imports, then exports unchanged with byte-identical output.
3. **The 3 dB/oct files:** rebuilding in the UI (LF tilt 3 dB/oct at 1 kHz, 1/3-octave grid, plus HPF LR48 at each of 32/40/50/63/80/100 Hz) exports byte-identical copies of the `Tilt_3dBoct_1000Hz*.crv` sample files. The props must match the sample headers: line 3, colour ffff0000, tolerance 3, UseTolerance 0.
4. **Validation:** export is blocked, with clear messages, when there are fewer than 2 points, non-ascending or duplicate frequencies, a NaN, Line outside 1–5, Show not 0/1, or an illegal filter slope for the chosen type.
5. **Colour test (manual, in Smaart):** export `colour_test_green.crv` (`ff00ff00`) and `colour_test_blue.crv` (`ff0000ff`). Confirm Smaart shows green and blue, and record the result in `docs/SMAART_NOTES.md`. If they come out swapped, fix the colour mapping in the adapter and its tests.
6. **Downloads:** the downloaded file name ends in `.crv` in Chrome, Safari and Firefox.
7. **Deployment:** the site works from the GitHub Pages URL and the CI workflow is green.
