# Target Curve Builder: Specification

A single-page web app, hosted on GitHub Pages, for building, importing, visualising and editing sound system tuning target curves. It exports **one file at a time**, primarily Smaart transfer function target curves (`.crv`). The design leaves room for more formats and filter types later.

The maths in this spec is implemented independently in `reference/curve_ref.py`. Expected outputs are in `reference/golden.json`. If this spec and the reference disagree, one of them has a bug: it is raised and resolved, not worked around.

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
- **Other export formats:** for example REW. Add these through the format adapter interface in §6. (Added after v1.0.0: a plain text `.txt` of Hz and dB, tab separated, Hz to 3 decimals and dB to 2, write only; and Smaart ASCII trace `.txt`, write only. See `docs/SMAART_NOTES.md`.)
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

### 3.4 Breakpoints only (`grid.simplify = true`)
Added after v1.0.0. It is a tick box in the Output grid section; ticking it sets `grid.epsilon` to 0.02 dB if the document has none (a document with no `epsilon` still falls back to 0.1). It works with the chosen resolution: the candidate points are the resample grid of 1/`grid.fraction` octave (1, 3, 6, 12, 24 or 48), or the imported points with the Keep-original grid, plus `fmin`, `fmax` and every layer corner. The older `grid.mode = "simplified"` is the same thing on the 1/48-octave grid and loads as `mode: "resample"`, `fraction: 48`, `simplify: true`. The description below says "1/48-octave grid" for that case. A `.crv` need not list every value, because Smaart draws a straight line between two points. This mode exports only the points needed to reproduce the curve within `grid.epsilon` dB (default 0.1, allowed 0.001 to 12).
- **Dense curve:** evaluate on the candidate grid (1/48 octave for the older mode) from `fmin` to `fmax` plus `fmin`, `fmax` and every layer corner (point frequencies; `pivot`, `corner`, `floor` and `fc` of enabled layers). A grid frequency with the same `pos()` as a corner, or within 1e-6 relative of one, is dropped (decided from the exact grid frequency, before rounding), so the corner keeps the frequency the user typed (62.5 Hz and 63 Hz are both -4 octaves). Corners are merged only when equal after rounding to 6 decimals.
- **Normalise** is applied to the dense curve, then the curve is reduced, then values are rounded (§4.7).
- **Reduce (Ramer-Douglas-Peucker):** always keep the first and last points. Between two kept points, if the largest vertical distance in dB from a point to the straight line between them, drawn against `pos(f)`, is more than `epsilon` minus 1e-6, keep that point and split there. (The 1 µdB margin keeps the guarantee true after rounding to 6 decimals.) An `epsilon` outside 0.001 to 12 counts as the default 0.1. `fmin` must be at least 1 Hz.
- **Guarantee:** straight lines through the exported points, against `pos(f)`, stay within `epsilon` dB of the dense curve at every dense point.
- **Assumption, not yet confirmed in Smaart:** that Smaart's straight line is against log frequency, like the plot.

### 3.5 Trim (`grid.trimLow`, `grid.trimHigh`)
Added after v1.0.0. Optional limits that crop the curve and the exported points (not the plot axis, see below). Both are numbers from 1 to 100000 Hz and are absent by default; if both are given and `trimLow >= trimHigh` neither is kept. The **effective range** is `[trimLow ?? fmin, trimHigh ?? fmax]` (default 20 Hz to 20 kHz).
- The trim has a tick box beside each value in the UI; a ticked box sets the value and an unticked box leaves no trim. An unticked box still shows 20 Hz (low) or 20 kHz (high) as a starting value, and typing a number ticks it. The trims are off by default so an untouched import still exports byte for byte.
- **Resample and simplified grids** are built over the effective range (§3.2, §3.4), so a trim outside `fmin`/`fmax` widens the grid. For the simplified grid the first and last points are exactly the range ends.
- **Keep-original grid** drops imported points outside the range, edges included, and only when a trim is set; with no trim the imported frequencies are used unchanged, so an untouched import still exports byte for byte (§5.3). Values are not changed, only fewer points are written.
- `evaluate(doc, freqs)` with explicit frequencies is never trimmed.
- The plot's frequency axis is **not** cropped: it always shows the full 20 Hz to 20 kHz and only the curve (the exported points) is cropped. Drag handles of points outside the range are hidden. The dashed overlay of the imported file stays complete, as a reference.
- A trim that leaves fewer than 2 points, or fails the limits above, blocks export. With the resample and simplified grids, a single trim that lies past the other end of the grid (a low trim above `fmax`, or a high trim below `fmin`) leaves an empty range: it holds no points, and export is blocked with a message about the trim. With the keep-original grid the same trim simply leaves no imported points, and export is blocked as having fewer than 2 points.

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
| `BW` Butterworth, order n = slope/6 | 6, 12, 18, 24, 30, 36, 42, 48, 72, 96 | `−10·log10(1 + r^(2n))` | −3.0103 |
| `LR` Linkwitz-Riley = BW(n/2) squared, n = slope/6 | 12, 24, 36, 48, 72, 96 | `−20·log10(1 + r^n)` | −6.0206 |

| `BS` Bessel, order n = slope/6 (§4.4b) | 6, 12, 18, 24, 30, 36, 42, 48 | see §4.4b | -3.0103 |
| `CH1` Chebyshev type I, 1 dB ripple, order n = slope/6 (§4.4c) | 6, 12, 18, 24, 30, 36, 42, 48 | see §4.4c | -1.0000 |

- **Magnitude only.** Phase is not part of a target curve.
- **True slope:** a "48 dB/oct" filter's real stop-band slope is 8 × 6.0206 = 48.165 dB/oct. Tests must expect that, not exactly 48.
- **Registry:** filters live in a registry `{ id, label, allowedSlopes, magnitudeDb(f, fc, slope, mode) }`, so adding Bessel or another type later means adding one entry.
- **Default for a new HPF:** LR 48 dB/oct at 32 Hz. This matches the user's existing files.

### 4.4a Sub boost, "haystack" (`kind: "subBoost"`)
Added after v1.0.0. Boosts or cuts everything below a low-pass corner. Parameters: `db` (± dB), `fc` (Hz), `type` and `slope` as for filters (§4.4, same allowed slopes).

`value(f) = db * M(f)`, where `M(f)` is the **linear** magnitude of the low-pass filter: `M = 10^(lpfDb(f, fc, type, slope) / 20)`. It is 1 far below `fc` and 0 far above, so the full `db` is reached well below the corner. At `fc` the Linkwitz-Riley value is half of `db` (M = 0.5), the Butterworth value is 0.7071 of `db`. Closed forms with `r = f/fc`, `n = slope/6`: LR `M = 1/(1 + r^n)`, BW `M = 1/sqrt(1 + r^(2n))`. Frequencies use Hz, like filters. A negative `db` is a cut, the exact mirror image. Magnitude only: this is not a parallel-summed filter, so phase doesn't change the result. Combine with an HPF layer for the haystack hump. `fc` is a layer corner for the "Breakpoints only" grid (§3.4).

### 4.4b Bessel filter type (`BS`)
Added after v1.0.0. Order n = slope/6 (1 to 8). `r = fc/f` for a high-pass, `f/fc` for a low-pass. With the reverse Bessel polynomial `B_n(s) = sum_k a_k s^k`, `a_k = (2n-k)! / (2^(n-k) k! (n-k)!)`: `|H(r)| = a_0 / |B_n(j w3 r)|` in linear terms, so dB = `-20 log10(|B_n(j w3 r)| / a_0)`. `w3` is the number that puts the response at -3.0103 dB at r = 1 (found numerically per order). Order 1 equals Butterworth 6; order 2 has `w3^2 = (-3 + sqrt(45)) / 2` and `|H|^2 = 9 / ((3 - x^2)^2 + 9 x^2)` with `x = w3 r`. The stop-band slope is n x 6.0206 dB/oct.

### 4.4c Chebyshev type I filter type (`CH1`)
Added after v1.0.0. Order n = slope/6 (1 to 8), fixed 1 dB passband ripple. `r` as in §4.4b. `e^2 = 10^(0.1) - 1`, `T_n` the Chebyshev polynomial (`cos(n acos r)` for |r| <= 1, `cosh(n acosh r)` above): dB = `-10 log10(1 + e^2 T_n(r)^2)`. `fc` is the edge of the ripple band, so the value at `fc` is -1 dB for every order. Even orders sit at -1 dB at r = 0, odd orders at 0 dB. The stop-band slope is n x 6.0206 dB/oct.

### 4.4d High shelf (`kind: "hiShelf"`)
Added after v1.0.0. Parameters `db`, `fc`, `type`, `slope` as for §4.4a. `value(f) = db * M(f)` with `M` the **linear** magnitude of the matching **high-pass** (`r = fc/f`): 1 far above `fc`, 0 far below, half (LR) or 0.7071 (BW) of `db` at `fc`. The low shelf is §4.4a (kind `subBoost`). **Shelves accept Butterworth, Linkwitz-Riley and Bessel only:** Chebyshev (§4.4c) is refused because its passband ripples between 0.891 and 1 of `db`, so the shelf would not reach the full gain.

### 4.4e Bell, resonant 2nd-order filters and hill
Added after v1.0.0. All are magnitude only, with the real frequency in Hz, `x = f/fc`.
- **Bell** (`kind: "bell"`: `fc`, `q` 0.1 to 50, `db` -60 to +60): `A = 10^(db/40)`, `|H|^2 = ((1-x^2)^2 + (x A/Q)^2) / ((1-x^2)^2 + (x/(A Q))^2)`, dB = `10 log10 |H|^2`. Exactly `db` at `fc`, 0 far away, symmetric in log frequency, a cut is the mirror of a boost. Low Q is wide; a deep cut with high Q is a notch, and with low Q a band-stop. **Bandwidth entry:** the layer always stores `q`; the UI can also take the bandwidth in octaves between the half-gain points (half the dB): `BW = 2 asinh(1/(2Q)) / ln 2`, `Q = 1/(2 sinh(BW ln2 / 2)) = 2^(BW/2) / (2^BW - 1)`. This is exact for the formula above, because its half-gain points sit at `x - 1/x = +/-1/Q`. Q 1 is 1.388 octaves, Q 1.414 about 1 octave, Q 0.1 to 50 is 6.67 to 0.029 octaves.
- **Resonant low-pass / high-pass** (`kind: "rLpf"` / `"rHpf"`: `fc`, `q` 0.1 to 20): low-pass `|H|^2 = 1/((1-x^2)^2 + (x/Q)^2)`, high-pass the same times `x^4`. `q = 1/sqrt(2)` (0.70711) equals Butterworth 12 (typing 0.7071 differs by under 0.0001 dB); above that the response peaks near `fc`, `20 log10 Q` at `fc`.
- **Hill** (`kind: "hill"`: `fc`, `width` 0.1 to 10 octaves, `db` -60 to +60): `value = db * 2^(-4 (log2(f/fc) / width)^2)`. Full `db` at `fc`, half at `width/2` octaves either side, so `width` is the full width at half height. Uses the true log of the frequency ratio, not `pos()`.
- `fc` of each of these is a layer corner for §3.4.

### 4.4f Weighting and classic EQ curves (`kind: "weighting"`) and invert
Added after v1.0.0. `curve` is one of `A`, `C`, `RIAA`, `FM75`, `FM50`. All are magnitude only, with `f` in Hz.
- **A-weighting** (IEC 61672-1), with poles `f1 = 20.598997`, `f2 = 107.65265`, `f3 = 737.86223`, `f4 = 12194.217` Hz: `RA = f4^2 f^4 / ((f^2 + f1^2) sqrt((f^2 + f2^2)(f^2 + f3^2)) (f^2 + f4^2))`, dB = `20 log10 RA` minus its value at 1 kHz, so the result is exactly 0 dB at 1 kHz.
- **C-weighting:** `RC = f4^2 f^2 / ((f^2 + f1^2)(f^2 + f4^2))`, dB = `20 log10 RC` minus its value at 1 kHz.
- **RIAA playback (replay):** `H = (1 + j w 318e-6) / ((1 + j w 3180e-6)(1 + j w 75e-6))`, `w = 2 pi f`, dB = `20 log10 |H|` minus its value at 1 kHz (about +19.27 dB at 20 Hz, -19.62 dB at 20 kHz). The recording curve is the inverse (use invert).
- **FM pre-emphasis 75 us / 50 us:** `|H| = sqrt(1 + (w tau)^2)`, `tau = 75e-6` or `50e-6` s. It is 0 dB at low frequencies (not shifted), +3.01 dB at `1/(2 pi tau)`. The de-emphasis is the inverse.
- **Invert (every layer kind):** a layer with `invert: true` contributes the **negative** of its value at every frequency. It is a property of the layer, off unless exactly `true`. Inverting twice is the same as not inverting.

### 4.4g Shapes (`kind: "shape"`)
Added after v1.0.0. Fun shapes drawn on the graph against the true log of the frequency ratio. Parameters: `shape`, `fc` (centre, Hz), `width` (full width at the base, octaves, 0.1 to 10), `db` (height, -60 to +60) and two optional extras: `flat` (trapezoid only, 0 to 0.99, default 0.5) and `count` (sine wave, square wave and staircase only, 0.5 to 16, default 3). With `u = log2(f/fc) / (width/2)` the shape is `0` where `|u| > 1` and otherwise `db * g(u)`:
- **pyramid** (triangle): `g = 1 - |u|`.
- **box** (square): `g = 1`, so the edges at `|u| = 1` are included and the curve steps from 0 to `db` there.
- **semicircle** (half circle): `g = sqrt(1 - u^2)`.
- **trapezoid:** `g = min(1, (1 - |u|) / (1 - flat))`; `flat = 0` is the pyramid.
- **cosine** (smooth bump): `g = (1 + cos(pi u)) / 2`.
- **parabola** (arch): `g = 1 - u^2`.
- **rampUp** / **rampDown** (sawtooth): `g = (1 + u) / 2` / `g = (1 - u) / 2`. The value at the far edge is the full `db`, then it jumps to 0 beyond it.
- With `t = (u + 1) / 2` running from 0 at the left edge to 1 at the right edge:
  - **sine** (sine wave): `g = sin(pi * count * (u + 1)) = sin(2 pi count t)`, `count` cycles starting at 0 and rising, ranging from `-db` to `+db`. At exactly the right edge with a whole `count` the sine is 0 and its sign is not defined.
  - **square** (square wave): `g = +1` where that sine is >= 0 and `-1` where it is below 0.
  - **fin** (shark fin): `g = sin(pi/2 * t / 0.6)` for `t <= 0.6`, rising in a bulging sweep to the tip, then `g = ((1 - t) / 0.4)^2` falling in a hollow drop to 0 at the right edge. The tip (`t = 0.6`) is a layer corner for §3.4.
  - **stairs** (staircase): `n = max(2, round(count))` (halves round up) equal-width levels, `g = min(n-1, floor(t n)) / (n-1)`, rising from 0 to the full `db`.
A frequency within `1e-12` of an edge in `u` counts as exactly on the edge (floating-point noise), and the edge corners for section 3.4 are rounded inward to 6 decimals, so a rounded corner stays inside the shape and keeps its edge value. The pyramid, box, half circle, trapezoid, cosine bump and parabola are symmetric in log frequency; the ramps, waves and staircase are not. A negative `db` is an exact mirror for all of them. The edges (`fc * 2^(+/- width/2)`), for a trapezoid the ends of the flat top, for a square wave the `ceil(2 count) - 1` jumps at `t = k / (2 count)`, and for a staircase the `n - 1` jumps at `t = k / n`, are layer corners for §3.4.

### 4.8 Layer groups
Added after v1.0.0. A document has three groups, `groups: [{name, on}, ...]` (default names A, B and C, all `on: true`; a name is up to 24 characters). Every layer carries `group: 1`, `2` or `3`; new layers start in group 1 (A), and a loaded layer with no usable `group` is put in group 1. (The maths still never hides a raw layer that has no `group`.) The groups are independent: any combination can be shown or hidden.
- **A layer counts** when it is not hidden by its group (`group` unset, or its group has `on` not `false`) **and** its own `on` switch is on. A group never changes a layer's own `on`.
- **A hidden group's layers are left out of everything:** the curve and the exported points, the layer ghosts, the corners for §3.4, the name suggestion, and the export checks, so an invalid layer in a hidden group doesn't block export.
- The groups, their names and states, and each layer's group are saved with the document and covered by Undo. A document without groups loads with the defaults; an unusable `group` number becomes group 1. A layer added by importing a file (§8) starts in group 1.

### 4.4h Mesa-style asymmetric filter (`kind: "mesa"`)
Added after v1.0.0. A bump (or dip) whose two sides have independent slopes, in the style of the Lake Mesa EQ. Parameters: `db` (gain, -60 to +60), `fLow` and `fHigh` (Hz, `fLow < fHigh`; the half-gain points of the two flanks) and `wLow`, `wHigh` (flank widths in octaves, 0.1 to 10; a narrower flank is a steeper slope).

It is built as two raised-cosine shelf steps summed, as Lake describe the Mesa filter: with `rc(t) = 0` for `t <= 0`, `1` for `t >= 1`, and `(1 - cos(pi t)) / 2` between (half a cosine cycle),
`value(f) = db * ( rc(log2(f / fLow) / wLow + 0.5) - rc(log2(f / fHigh) / wHigh + 0.5) )`.
The difference is limited to between 0 and 1, so overlapping flanks can never turn a boost into a cut or the reverse. So the lower flank rises over `wLow` octaves centred on `fLow`, the upper flank falls over `wHigh` octaves centred on `fHigh`, the top is flat at `db` between them, and both flanks have zero slope where they meet the flat parts. The steepest slope of a flank is `(pi/2) * |db| / width` dB per octave. If the flanks overlap the peak is lower than `db`, and the limit keeps the result between 0 and `db`. A negative `db` is an exact mirror; equal widths give a curve symmetric about `sqrt(fLow * fHigh)`.

**This is our own construction from the published description, not Lake's algorithm.** Lake's sources describe a half-cycle cosine against logarithmic frequency and two shelves whose slopes are separately adjustable, but give no formulas (the maths is in an AES paper we have not read), so details such as whether the step is computed in dB or in linear gain, and the units of Lake's slope controls, may differ. The flank ends and half-gain points of each flank are layer corners for §3.4.

### 4.5 Defaults for a new document
- **Layers:** `points` (`[[20,0],[20000,0]]`, on), `lfTilt` (3 dB/oct, pivot 1 kHz, off), `fullTilt` (off), `hfTilt` (off), `hpf` (off), `lpf` (off).
- **Grid:** resample at 1/12 octave (119 points from 20 Hz to 20 kHz). Chosen by the user; the built-in presets that mirror the 1/3-octave reference files keep 1/3.

### 4.6 Normalise
`normalise: { on, at }`. When on, subtract `total(at)` from every point. The default is `at: 1000`.

### 4.7 Rounding
Round values to 6 decimal places, then add `+0.0` so the file never contains `-0.000000`.

---

## 5. Smaart `.crv` format

The writer rules in this section (6-decimal values, tabs, CRLF, no `-0.000000`) apply to the Smaart `.crv` files. The Smaart ASCII `.txt` uses 2 decimals for dB and the plain text `.txt` uses 3 decimals for Hz and 2 for dB (§6); both still never write a negative zero.

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
- **Wavelength in the hover readout:** the readout over the plot also shows the wavelength, `343 / f` metres (speed of sound 343 m/s), to 3 significant figures in m from 1 m, cm from 1 cm, otherwise mm. Display only: it is not in the points table and never exported. (Note names were tried and removed.)
- **Layer tabs:** the Layers box has three tabs, one per group (§4.8), each showing its layer count. Beside each tab is an eye button that shows or hides that group's layers (the same as the Show layers toggle in the tab); a hidden group's tab is shown in italics. The open tab lists only its own layers, with its **Add layer** control below them (a layer added in a group's tab joins that group), and each tab starts with the group's name box and its **Show layers** toggle. Moving a layer up or down swaps places with its neighbour in the same tab. The tabs follow the usual tab keys (Left, Right, Home, End). The open tab is a view setting and is not saved.
- **Layer ghosts:** a global toggle (a view setting, off by default) draws the contribution of each enabled layer on its own (including its invert, excluding normalise) as a faint coloured line over the full 20 Hz to 20 kHz, behind the curve, evaluated on the dense grid of §3.4. Each ghost has a matching colour stripe on its layer row and the layer title as a tooltip.
- **Layers:** each layer row has an on/off switch, expandable controls, delete and reorder. Order doesn't change the sum but does help readability.
- **Points table:** shows the exported points, i.e. the evaluated curve on the output grid. "Edit points" opens the points-layer table, which is the input points.
- **Import:** by file picker or drag-and-drop onto the plot. If the current document is blank (an untouched new document) the file simply replaces it. Otherwise a choice is shown: **Replace** (as below), **Add as a layer** or Cancel. Adding appends the file's points as a new Points layer (switched on, labelled with the file name) and changes nothing else: name, properties, grid, trim, normalise and the other layers stay as they are. A spectrum file is shifted so it is 0 dB at 1 kHz first. A file that can't be read is refused with a message before the choice is shown. Both choices can be undone. A Points layer may carry an optional `label`. After import, the grid mode is `original`, the points layer holds the file's data, the header fills the properties panel, and `original` is set for the overlay.
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

## 10. Reference trace (added after v1.0.0)
A document may carry one reference trace, `template`: `{ name, points: [[hz, db], ...], offset, smooth, normalise, show }`. It is drawn behind the target, in green, for comparison. It is **never exported** and never changes the target, the grid, the validation or the name suggestion. It is saved with the document and covered by Undo.
- **Reading:** a Smaart `.crv` (target or spectrum) is read as that; any other text is read line by line, taking the first two numbers on a line as Hz and dB (tab, space, comma or semicolon separated). Lines that don't start with two numbers (headers, `*` or `#` comments) are skipped; non-positive frequencies are dropped; the points are sorted and repeated frequencies dropped. At least 2 points are needed. A trace of more than 1200 points (an FFT export) is averaged into 1/48-octave bins on import. A file over 5 MB is refused.
- **Display** (`traceCurve`): the smoothed curve, then, when `normalise` is on and the trace covers 1 kHz, shifted so it reads 0 dB at 1 kHz, then plus `offset` (so a normalised trace reads exactly the offset at 1 kHz). `offset` is -60 to +60 dB. `smooth` is 0 (off) or 1/N octave with N in 1, 3, 6, 12, 24, 48: at each of the trace's own frequencies, the exact average of the dB values over a window 1/N octave wide centred there, taking the trace as straight lines between its points against log frequency and flat beyond its ends.
- **Add as a layer** turns the displayed curve (offset, smoothing and normalise applied) into a Points layer in the open group, so it can be used as a starting point for a target.
- `loadDoc` keeps a trace only if its points are valid (2 to 1200, positive frequencies), cleans the values and drops it otherwise. A document with a trace is not "blank" (§8, import).

## 11. Shareable links (added after v1.0.0)
**Copy link** puts the document in the page address: `#d=` followed by base64url of the raw-deflate compressed JSON `{ "v": 1, "doc": <document> }`. Nothing is sent anywhere. The imported original, its header and any reference trace are left out, and the Keep-original grid becomes a resample grid, because those can be large. Opening a link validates it through `loadDoc` like a saved file, then clears the address so a reload keeps your own edits. A link over 200 000 characters, one that unpacks to over 2 MB, one that is not base64url, or one that fails validation is refused with a readable message. Links over about 2000 characters get a warning that chat and mail apps may cut them off.
