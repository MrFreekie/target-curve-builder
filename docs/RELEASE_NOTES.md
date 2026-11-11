# Release notes

## v1.1.0 (2026-11-11)
- Works offline: after the first visit the app opens with no network (a service worker keeps a copy), and it can be installed from the browser. It re-checks the server every time it is online, so an old copy is never used while a new one exists.
- Search and sharing: a proper page title and description, a short About section, a preview image, a sitemap and robots file.
- Browser regression tests (`node e2e/smoke.mjs`) drive a real headless Chrome or Edge through loading, import, editing, undo, shared links, a broken autosave, layout at four widths and offline start. They run in the project's checks on every push.
- A saved curve that can't be restored now says why instead of quietly starting a new one, and the point limit is enforced wherever points are added.
- Fixes from a code review: number boxes always go back to the document's value after bad input; opening a shared link asks before replacing your curve and also works when pasted into an open tab; a curve that can't be drawn no longer traps the page on reload (`?fresh` starts a new curve); points are capped at 20 000 in total and long point lists evaluate faster; a saved header line can no longer smuggle a bad value into an export; imported files with unsorted or repeated frequencies are tidied with a warning; vertical drags no longer rewrite a point's frequency; notices clear on the next edit; the points table and file text aren't rebuilt on every drag move; preset saves leave out the reference trace and say whether storage is full or blocked.
- Output grid: Breakpoints only is now a tick box that works with any resolution (it keeps the points that matter from the chosen grid, plus every layer corner), and Hide points is a tick box too. A 1/48 octave choice was added. Each trim has a tick box and shows 20 Hz and 20 kHz as its starting values. Normalise has its tick box beside the Hz box. Older saved documents that used the Breakpoints only mode load as breakpoints only on 1/48 octave.
- Plain text export: Hz and dB, tab separated (Hz to 3 decimals, dB to 2), for REW, HouseCurve and spreadsheets.
- Reference trace: import a measurement or any Hz and dB text to draw behind the target, with offset, smoothing and 0 dB at 1 kHz, a show/hide box, and an Add as a layer button. Never exported (SPEC §10).
- Share: Copy link to this curve (SPEC §11).
- Shark fin shape, and four fun built-in presets drawn as points: Skyline, Heartbeat, Mountain range and Castle (crenellations).
- Layers are now organised in tabs, one for each of the three groups (every layer is in a group; new ones start in A), each with its own Add layer control and an eye button that shows or hides the group's layers; the group name and Shown/Hidden button sit at the top of its tab. The left bar is wider, "Random colour" is shorter, the suggested-name button sits next to the Name box, and the Buy me a beer link moved to the top bar.
- Mesa-style asymmetric filter layer: a bump or dip with independent slopes on its lower and upper sides, made from two raised-cosine shelf steps as the Lake Mesa EQ is described. Our own construction, not Lake's published algorithm (SPEC §4.4h).
- Layer groups: three renamable groups (A, B, C) with independent Shown/Hidden buttons above the layer list, and a Group choice on every layer. A hidden group's layers are left out of the plot, the table, the ghosts and the export. See SPEC §4.8.
- Import can now add as well as replace: when a curve is already open, importing a `.crv` asks "Replace the current curve" or "Add as a layer". Adding keeps your curve and adds the file's points as a new Points layer, named after the file, that sums with the other layers (a spectrum file is shifted to 0 dB at 1 kHz first). A blank new document still just takes the file. All of it can be undone.
- The hover readout over the plot also shows the wavelength at 343 m/s. It is display only: not in the points table or any export. (An earlier note-name option was removed.)
- Layer ghosts: a global toggle above the plot draws each enabled layer's own contribution as a faint coloured line behind the curve, with a matching colour stripe on its row in the layer list. A view setting only; it is not exported.
- Low trim and high trim in the Output grid section: crop the preview and the exported points to a frequency range (SPEC §3.5). Empty by default, so imported files still export unchanged. The plot axis stays at the full range; only the curve is cropped.
- Shape layer: pyramid (triangle), box (square), half circle, trapezoid, cosine bump, parabola, rising and falling ramps (sawtooth), sine wave, square wave and staircase, with a centre, a base width in octaves and a height of ±dB. See SPEC §4.4g.
- Bell filter width can be entered as Q or as bandwidth in octaves (between the half-gain points). The layer title shows both.
- Weighting layer (A, C, RIAA, FM pre-emphasis) and an Invert button on every layer, with presets for them.
- Cinema X-curve presets from SMPTE ST 202:2010 Table 1 (medium theatre) and the Table A.1 size corrections (small and large). Sources in `docs/REFERENCE_CURVES.md`.
- More filter shapes (SPEC §4.4 to §4.4e): high shelf, bell (peak, notch, band-stop), hill (haystack bump) and resonant 2nd-order high-pass and low-pass layers; Bessel and Chebyshev (1 dB ripple) filter types; Butterworth and Linkwitz-Riley up to 96 dB/oct. The Sub boost layer is now called Low shelf.
- Lines-only toggle, random colour that contrasts with the theme, and Reset to imported .crv.
- Y offset: slide the plot's visible dB window up or down by up to ±20 dB (next to the zoom). A view setting only.
- Sub boost ("haystack") layer: boost or cut by ± dB everything below a low-pass corner, with Butterworth or Linkwitz-Riley slope. See SPEC §4.4a.
- "Breakpoints only" output grid: exports just the points needed to stay within a chosen dB error, because Smaart draws straight lines between points. See SPEC §3.4.
- Name suggestion under the Name field, built from the enabled layers in the style of the reference files (for example `Tilt_3dBoct_1000Hz_HPF32_LR48`). It updates as you edit, and a click applies it.
- Export as a Smaart ASCII trace (`.txt`), chosen next to the Export button. Layout copied from a Smaart ASCII export; phase is written as 0 and coherence as 1.
- A text file with no header is no longer mistaken for a spectrum `.crv` on import.

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

### Verified in Smaart
- Colour order is AARRGGBB: `ff00ff00` shows green and `ff0000ff` shows blue (`reference/manual/colour_test_*.crv`).

### Still to confirm
- Smaart's behaviour with dense (1/12 octave or finer) curves, `Offset` on import, and outside the first and last points. See `docs/SMAART_NOTES.md`.
