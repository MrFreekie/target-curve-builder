# Target Curve Builder

Build, import, visualise and edit sound system tuning **target curves** in the browser, and export them as **Smaart transfer function target curves (`.crv`)**, one file at a time.

**Live site:** https://mrfreekie.github.io/target-curve-builder/

TF target curves need a measurement-capable edition of **Smaart 9.4 or later**, or Smaart Data Modeler. Smaart RTA can't import them.

## What it does
- **Layers, summed in dB:** points, full-spectrum tilt, LF tilt (with an optional floor), HF tilt, high-pass and low-pass filters (Butterworth and Linkwitz-Riley), and a gain offset. Each layer can be switched on or off, edited, reordered or deleted.
- **Live plot:** log frequency axis from 20 Hz to 20 kHz, the Smaart tolerance band, a hover readout, and a zoom from ±15 to ±40 dB (or auto).
- **Edit points on the plot:** drag a point up or down to change its level. Hold Shift to move its frequency as well (snaps to 1/24 octave). With a point focused, use Up/Down to nudge it and Left/Right to switch point.
- **Import:** drop a `.crv` anywhere on the page, or use **Import .crv**. The original stays on the plot as a dashed grey line. Spectrum curves can be viewed and converted to TF.
- **Output grid:** 1/12 octave by default, or 1/1, 1/3, 1/6, 1/24, or keep the imported file's own frequencies.
- **Undo and redo:** Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, at least 50 steps. Your work is autosaved in the browser.
- **Presets:** save curves in the browser, or as JSON files you can share. Three built-in presets are included.
- **Export:** one `.crv` at a time, with tabs only, 6-decimal values and CRLF line endings, as Smaart expects. An unchanged import exports byte for byte as it came in.

## How to use it
1. Open the live site. Start from a preset, a new curve, or **Import .crv**.
2. Switch layers on and set their values (for example LF tilt 3 dB/oct at 1 kHz, plus an HPF at 32 Hz, Linkwitz-Riley 48 dB/oct).
3. Set the name, colour, line width, tolerance and offset under **File properties**.
4. Check the validation line says **Ready to export**, then press **Export .crv** and load the file in Smaart.

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
- `docs/BUILD_PLAN.md`: phases, agents, models and effort.
- `docs/SMAART_NOTES.md`: what we know about how Smaart reads `.crv` files, and the open checks.
- `docs/RELEASE_NOTES.md`: what is in each release.
