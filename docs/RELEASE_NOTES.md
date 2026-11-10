# Release notes

## v1.0.0

First release. Build, import, edit and export Smaart transfer function target curves (`.crv`) in the browser.

### Included
- Layers: points, full tilt, LF tilt with floor, HF tilt, HPF and LPF (Butterworth 6–48 dB/oct, Linkwitz-Riley 12–48 dB/oct), gain, plus normalise.
- Live SVG plot with tolerance band, hover readout, ±15 to ±40 dB zoom, and draggable points (Shift also moves frequency).
- Import of Smaart TF curves, with the original shown as an overlay; view-only import of spectrum curves with Convert to TF.
- Output grids: 1/12 octave (default), 1/1, 1/3, 1/6, 1/24, or the imported file's own frequencies.
- Undo and redo, autosave, saved presets, preset JSON files, three built-in presets.
- Byte-exact round trip of the sample files in `reference/samples/`.
- Dark, light and automatic themes.

### Not in v1
- Batch export (deliberately left out).
- Spectrum (RTA) curve export.
- Other export formats, other filter types, share-by-URL, offline install.

### Known open check
- The colour order in `.crv` files (assumed AARRGGBB) is confirmed by loading `reference/manual/colour_test_green.crv` and `colour_test_blue.crv` in Smaart. See `docs/SMAART_NOTES.md`.
