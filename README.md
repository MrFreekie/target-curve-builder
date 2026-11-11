# Target Curve Builder

Build, import, visualise and edit sound system tuning **target curves** in the browser, and export them as **Smaart transfer function target curves (`.crv`)**, one file at a time.

**Live site:** https://mrfreekie.github.io/target-curve-builder/

TF target curves need a measurement-capable edition of **Smaart 9.4 or later**, or Smaart Data Modeler. Smaart RTA can't import them.

## What it does
- **Layers, summed in dB:** points, full-spectrum tilt, LF tilt (with an optional floor), HF tilt, high-pass and low-pass filters (Butterworth and Linkwitz-Riley), a gain offset, low and high **shelves** (± dB below or above a corner, so a low shelf is the sub "haystack"), a **bell** (peak, notch or band-stop, width as Q or bandwidth in octaves), a **hill** (smooth bump), a **Mesa-style** asymmetric filter (different slope on each side), and resonant 2nd-order filters. Filter types are Butterworth, Linkwitz-Riley (up to 96 dB/oct), Bessel and Chebyshev. Each layer can be switched on or off, edited, reordered or deleted.
- **Live plot:** log frequency axis from 20 Hz to 20 kHz, the Smaart tolerance band, a hover readout, and a zoom from ±15 to ±40 dB (or auto), and a Y offset of ±20 dB to slide the view up or down.
- **Note names and wavelength:** two toggles add the nearest musical note (with cents) and the wavelength at 343 m/s to the hover readout and the points table.
- **Layer groups:** the Layers box has tabs for three renamable groups (A, B and C; new layers start in A), each with its own Add layer button and an independent show/hide. Hide a group to leave its layers out of the plot and the export.
- **Layer ghosts:** one toggle shows what each layer contributes on its own, as faint coloured lines behind the curve (colour-matched to the layer list).
- **Edit points on the plot:** drag a point up or down to change its level. Hold Shift to move its frequency as well (snaps to 1/24 octave). With a point focused, use Up/Down to nudge it and Left/Right to switch point.
- **Import:** drop a `.crv` anywhere on the page, or use **Import .crv**. If a curve is already open you choose **Replace** or **Add as a layer** (the file's points become a new Points layer that sums with your other layers). The original stays on the plot as a dashed grey line. Spectrum curves can be viewed and converted to TF.
- **Output grid:** with optional low and high trim to crop the curve and the exported points to a frequency range (the graph axis stays full). 1/12 octave by default, or 1/1, 1/3, 1/6, 1/24, keep the imported file's own frequencies, or **Breakpoints only**: just the points needed to stay within a chosen dB error (Smaart draws straight lines between points).
- **Undo and redo:** Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, at least 50 steps. Your work is autosaved in the browser.
- **Name suggestion:** one click names the curve from its layers, for example `Tilt_3dBoct_1000Hz_HPF32_LR48`.
- **Presets:** save curves in the browser, or as JSON files you can share. Built-in presets include A and C weighting (and inverses), RIAA, FM pre-emphasis, and the SMPTE ST 202:2010 cinema X-curve for small, medium and large theatres. Sources are in `docs/REFERENCE_CURVES.md`.
- **Export:** one file at a time, as a Smaart target curve (`.crv`) or a Smaart ASCII trace (`.txt`: Hz, dB, phase 0, coherence 1). The `.crv` is written with tabs only, 6-decimal values and CRLF line endings, as Smaart expects. An unchanged import exports byte for byte as it came in.

## How to use it
1. Open the live site. Start from a preset, a new curve, or **Import .crv**.
2. Switch layers on and set their values (for example LF tilt 3 dB/oct at 1 kHz, plus an HPF at 32 Hz, Linkwitz-Riley 48 dB/oct).
3. Set the name, colour, line width, tolerance and offset under **File properties**.
4. Check the validation line says **Ready to export**, pick the export format, then press **Export** and load the file in Smaart.

## Run locally
There is no build step. Serve the folder as static files:
```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## Tests
```bash
node --test tests/
python3 -I reference/curve_ref.py --check
```
`reference/` holds an independent Python implementation of the maths, golden values, and sample `.crv` files. Never edit it to make a test pass.

## Docs
- `docs/SPEC.md`: requirements, maths, file format, UI.
- `docs/SMAART_NOTES.md`: what we know about how Smaart reads `.crv` files, and the open checks.
- `docs/REFERENCE_CURVES.md`: where each built-in reference curve comes from.
- `docs/RELEASE_NOTES.md`: what is in each release.
