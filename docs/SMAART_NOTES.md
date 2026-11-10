# Smaart notes

Findings about how Smaart handles `.crv` target curves. Keep this up to date.

## Known (Rational Acoustics support article, "How to Create and Import Target Curve Files")
- **Two kinds of target curve:** spectrum and transfer function. A file is a TF curve when its header contains `Type: TF`. Without `Type`, it is read as a spectrum curve.
- **TF requirements:** TF target curves need measurement-capable Smaart 9.4 or later, or Smaart Data Modeler. Smaart RTA can't import TF curves.
- **Data:** tab-separated `frequency<TAB>dB`. Spaces or commas can crash Smaart. At least 2 points. One blank line between the header and the data.
- **`Line`:** thickness from 1 to 5. **`Show`:** 0 or 1. **`Tolerance`:** ±dB drawn as a shaded band. **`Offset`:** y offset normalised to 1 kHz.
- **Spectrum curves** need `Band` (1, 3, 6, 12, 24 or 48) and are locked to SPL values.
- **File extension:** the file must be `.crv`. Watch out for `.crv.txt` on macOS.
- **Creating curves in Smaart:** from 9.5, a trace can be right-clicked and exported as a target curve.

## Observed in the user's files
- **Header order:** `Line, Color, Show, Type, Tolerance, UseTolerance`. CRLF line endings. Values have 6 decimals.
- **`UseTolerance`:** present in the user's files but not mentioned in the article.
- **Colour:** `Color: ffff0000` draws red. AARRGGBB is assumed but **not yet confirmed**.

## To confirm (manual test)
- [ ] Load `reference/manual/colour_test_green.crv` (`ff00ff00`) and `colour_test_blue.crv` (`ff0000ff`) in Smaart. Expected: green and blue. Actual: ___
- [ ] Does Smaart accept 1/24-octave (or denser) TF curves without lag? ___
- [ ] Is `Offset` respected on import, and how does it combine with the curve data? ___
- [ ] What does Smaart do outside the curve's first and last points (hold the end values, or not draw)? ___
