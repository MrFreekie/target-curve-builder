# Target Curve Builder

Build, import, visualise and edit sound system tuning **target curves** in the browser, and export them as **Smaart transfer function target curves (`.crv`)**.

> Status: scaffold. The app is built by following `docs/BUILD_PLAN.md`.

## Planned features (v1)
- **Layers:** points, full-spectrum tilt, LF tilt (with floor), HF tilt, high-pass and low-pass (Butterworth and Linkwitz-Riley) and a gain offset.
- **Plot:** live preview with the Smaart tolerance band and draggable points.
- **File properties:** colour picker, line width, show, tolerance and offset.
- **Import:** load an existing `.crv` to view it, modify it and export a new file. The original stays visible as an overlay.
- **Presets:** saved in the browser, plus JSON files you can share.

TF target curves need measurement-capable **Smaart 9.4+** or Smaart Data Modeler.

## Run locally
```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## Tests
```bash
node --test tests/
python3 -I reference/curve_ref.py --check
```

## Docs
- `docs/SPEC.md`: requirements, maths, file format, UI.
- `docs/BUILD_PLAN.md`: phases, agents, models and effort.
- `docs/SMAART_NOTES.md`: what we know about how Smaart reads `.crv` files.
