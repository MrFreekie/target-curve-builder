#!/usr/bin/env python3
"""Reference implementation of the Target Curve Builder maths and Smaart .crv writer.

This file is the independent "source of truth" the JavaScript app is tested against.
It must follow docs/SPEC.md exactly. Do not import anything outside the standard library.

Usage:
  python3 -I reference/curve_ref.py --write   # regenerate reference/golden.json
  python3 -I reference/curve_ref.py --check   # verify golden.json + sanity checks + sample files
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "golden.json")
SAMPLES = os.path.join(HERE, "samples")
TOL_DB = 1e-6
OCT = 20 * math.log10(2) / 6  # 1.00343: 6 dB/oct per order is really 6.0206 dB

NOMINAL_3 = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
             630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
             10000, 12500, 16000, 20000]
NOMINAL_1 = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


# ---------------------------------------------------------------- frequency position
def pos(f):
    """Octave position relative to 1 kHz.

    Nominal ISO 1/3-octave labels snap to their exact band position (index/3), so
    63 Hz is exactly -4 octaves. Any other frequency uses log2(f/1000).
    """
    for i, n in enumerate(NOMINAL_3):
        if abs(f - n) < 1e-9:
            return (i - NOMINAL_3.index(1000)) / 3.0
    return math.log2(f / 1000.0)


# ---------------------------------------------------------------- grids
def make_grid(grid):
    """Return list of output frequencies (Hz) for a grid spec."""
    n, fmin, fmax = grid.get("fraction", 3), grid.get("fmin", 20), grid.get("fmax", 20000)
    if n == 3:
        return [f for f in NOMINAL_3 if fmin - 1e-9 <= f <= fmax + 1e-9]
    if n == 1:
        return [f for f in NOMINAL_1 if fmin - 1e-9 <= f <= fmax + 1e-9]
    out, k = [], math.floor(n * math.log2(fmin / 1000.0)) - 1
    while True:
        f = 1000.0 * 2 ** (k / n)
        if f > fmax * (1 + 1e-9):
            break
        if f >= fmin * (1 - 1e-9):
            out.append(round(f, 6))
        k += 1
    return out


# ---------------------------------------------------------------- filters
def filt_db(f, fc, ftype, slope, mode):
    """Magnitude in dB of a high-pass ('hp') or low-pass ('lp') filter.

    BW (Butterworth), order n = slope/6:    -10*log10(1 + r^(2n))   (-3.01 dB at fc)
    LR (Linkwitz-Riley) = BW(n/2) squared:  -20*log10(1 + r^n)      (-6.02 dB at fc)
    r = fc/f for high-pass, f/fc for low-pass.
    """
    r = fc / f if mode == "hp" else f / fc
    n = slope / 6.0
    if ftype == "LR":
        if slope % 12:
            raise ValueError("LR slope must be a multiple of 12 dB/oct")
        return -20.0 * math.log10(1.0 + r ** n)
    if ftype == "BW":
        if slope % 6:
            raise ValueError("BW slope must be a multiple of 6 dB/oct")
        return -10.0 * math.log10(1.0 + r ** (2 * n))
    raise ValueError(f"unknown filter type {ftype}")


# ---------------------------------------------------------------- layers
def interp_points(f, pts):
    """Linear in dB versus octave position; hold end values outside the range."""
    pts = sorted(pts, key=lambda p: p[0])
    x = pos(f)
    if x <= pos(pts[0][0]):
        return pts[0][1]
    if x >= pos(pts[-1][0]):
        return pts[-1][1]
    for (f0, g0), (f1, g1) in zip(pts, pts[1:]):
        x0, x1 = pos(f0), pos(f1)
        if x0 <= x <= x1:
            return g0 if x1 == x0 else g0 + (g1 - g0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def layer_db(f, L):
    k = L["kind"]
    if k == "points":
        return interp_points(f, L["points"])
    if k == "fullTilt":          # dbPerOct > 0 lifts the low end: g = s * octaves below pivot
        return L["dbPerOct"] * (pos(L["pivot"]) - pos(f))
    if k == "lfTilt":            # rises below pivot; optional floor stops the rise
        x = pos(f)
        if L.get("floor"):
            x = max(x, pos(L["floor"]))
        return L["dbPerOct"] * max(0.0, pos(L["pivot"]) - x)
    if k == "hfTilt":            # falls above corner (dbPerOct > 0 means roll-off)
        return -L["dbPerOct"] * max(0.0, pos(f) - pos(L["corner"]))
    if k == "hpf":
        return filt_db(f, L["fc"], L["type"], L["slope"], "hp")
    if k == "lpf":
        return filt_db(f, L["fc"], L["type"], L["slope"], "lp")
    if k == "gain":
        return L["db"]
    raise ValueError(f"unknown layer kind {k}")


def total_db(f, layers):
    return sum(layer_db(f, L) for L in layers if L.get("on", True))


def evaluate(model, freqs=None):
    freqs = freqs or make_grid(model.get("grid", {}))
    layers = model["layers"]
    out = [(f, total_db(f, layers)) for f in freqs]
    nm = model.get("normalise") or {}
    if nm.get("on"):
        ref = total_db(nm["at"], layers)
        out = [(f, g - ref) for f, g in out]
    return [(f, round(g, 6) + 0.0) for f, g in out]


# ---------------------------------------------------------------- Smaart .crv
TF_ORDER = ["Line", "Color", "Show", "Type", "Tolerance", "UseTolerance", "Offset"]


def fmt_num(x):
    return f"{(round(x, 6) + 0.0):.6f}"


def write_smaart_tf(props, points, nl="\r\n"):
    hdr = [f"Line:\t{props.get('line', 2)}", f"Color:\t{props.get('color', 'ffff0000')}",
           f"Show:\t{props.get('show', 1)}", "Type:\tTF",
           f"Tolerance:\t{float(props.get('tolerance', 0)):.4f}",
           f"UseTolerance:\t{props.get('useTolerance', 0)}"]
    if props.get("offset") is not None:
        hdr.append(f"Offset:\t{float(props['offset']):.4f}")
    body = "".join(f"{fmt_num(f)}\t{fmt_num(g)}{nl}" for f, g in points)
    return (nl.join(hdr) + nl + nl + body).encode("utf-8")


def read_crv(data):
    text = data.decode("utf-8", "replace")
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(nl)
    header, i = [], 0
    while i < len(lines) and lines[i].strip():
        k, _, v = lines[i].partition(":")
        header.append((k.strip(), v.strip()))
        i += 1
    pts = []
    for line in lines[i:]:
        parts = line.replace(",", " ").split()
        if len(parts) >= 2:
            pts.append((float(parts[0]), float(parts[1])))
    return header, pts, nl


# ---------------------------------------------------------------- golden cases
def base(grid=None):
    return {"grid": grid or {"fraction": 3, "fmin": 20, "fmax": 20000}, "normalise": {"on": False}}


def case(cid, layers, note, grid=None, normalise=None):
    m = base(grid)
    m["layers"] = layers
    if normalise:
        m["normalise"] = normalise
    return {"id": cid, "note": note, "model": m, "expected": evaluate(m)}


def build_cases():
    lf3 = {"kind": "lfTilt", "on": True, "dbPerOct": 3, "pivot": 1000, "floor": None}
    c = [case("flat", [{"kind": "gain", "on": True, "db": 0}], "all zeros")]
    c.append(case("lfTilt_3dB_1k", [lf3], "63 Hz = +12.0, 1 kHz and above = 0"))
    for fc in (32, 40, 50, 63, 80, 100):
        c.append(case(f"lfTilt_3dB_1k_hpf_LR48_{fc}",
                      [lf3, {"kind": "hpf", "on": True, "fc": fc, "type": "LR", "slope": 48}],
                      f"matches samples/Tilt_3dBoct_1000Hz_HPF{fc}_LR48.crv"))
    for t, s in (("LR", 12), ("LR", 24), ("LR", 36), ("BW", 6), ("BW", 12), ("BW", 18), ("BW", 24), ("BW", 48)):
        c.append(case(f"hpf_{t}{s}_50", [{"kind": "hpf", "on": True, "fc": 50, "type": t, "slope": s}],
                      f"{t}{s} HPF at 50 Hz"))
    c.append(case("lpf_LR24_16k", [{"kind": "lpf", "on": True, "fc": 16000, "type": "LR", "slope": 24}], "LR24 LPF 16 kHz"))
    c.append(case("lpf_BW12_18k", [{"kind": "lpf", "on": True, "fc": 18000, "type": "BW", "slope": 12}], "BW12 LPF 18 kHz (not a nominal freq)"))
    c.append(case("fullTilt_1dB_1k", [{"kind": "fullTilt", "on": True, "dbPerOct": 1, "pivot": 1000}],
                  "+1 dB/oct lift below 1k, -1 dB/oct above"))
    c.append(case("hfTilt_1p5_4k", [{"kind": "hfTilt", "on": True, "dbPerOct": 1.5, "corner": 4000}], "roll-off above 4 kHz"))
    c.append(case("lfTilt_3dB_floor40", [dict(lf3, floor=40)], "rise stops below 40 Hz (+14 held)"))
    pts = [[63, 7], [315, 0], [20000, 0]]
    c.append(case("points_LA_7dB_315", [{"kind": "points", "on": True, "points": pts}], "user's LA_7dB_at_315k, held below 63 Hz"))
    c.append(case("points_LA_hpf_LR48_32", [{"kind": "points", "on": True, "points": pts},
                                            {"kind": "hpf", "on": True, "fc": 32, "type": "LR", "slope": 48}],
                  "user's curve + 32 Hz LR48"))
    c.append(case("normalise_fullTilt_pivot500", [{"kind": "fullTilt", "on": True, "dbPerOct": 2, "pivot": 500}],
                  "normalised to 0 dB at 1 kHz", normalise={"on": True, "at": 1000}))
    c.append(case("grid12_hpf_LR48_32", [{"kind": "hpf", "on": True, "fc": 32, "type": "LR", "slope": 48}],
                  "1/12-octave exact grid", grid={"fraction": 12, "fmin": 20, "fmax": 20000}))
    c.append(case("disabled_layer", [lf3, {"kind": "hpf", "on": False, "fc": 100, "type": "LR", "slope": 48}],
                  "disabled HPF must have no effect (same as lfTilt_3dB_1k)"))
    return c


def sanity():
    errs = []
    def near(a, b, tol, msg):
        if abs(a - b) > tol:
            errs.append(f"{msg}: got {a:.6f}, want {b:.6f}")
    for s in (12, 24, 36, 48):
        near(filt_db(80, 80, "LR", s, "hp"), -6.0206, 1e-3, f"LR{s} at fc")
        near(filt_db(80, 80, "LR", s, "lp"), -6.0206, 1e-3, f"LR{s} LP at fc")
        # asymptotic slope: nominal "s dB/oct" is really (s/6) * 20*log10(2) = s * 1.00343 dB/oct
        d = filt_db(80 / 1024, 80, "LR", s, "hp") - filt_db(80 / 512, 80, "LR", s, "hp")
        near(d, -s * OCT, 0.01, f"LR{s} stop-band slope")
    for s in (6, 12, 18, 24, 48):
        near(filt_db(80, 80, "BW", s, "hp"), -3.0103, 1e-3, f"BW{s} at fc")
        d = filt_db(80 / 1024, 80, "BW", s, "hp") - filt_db(80 / 512, 80, "BW", s, "hp")
        near(d, -s * OCT, 0.01, f"BW{s} stop-band slope")
    near(filt_db(20000, 80, "LR", 48, "hp"), 0.0, 1e-6, "HPF pass band")
    near(layer_db(63, {"kind": "lfTilt", "dbPerOct": 3, "pivot": 1000}), 12.0, 1e-12, "3 dB/oct at 63 Hz")
    near(layer_db(500, {"kind": "lfTilt", "dbPerOct": 3, "pivot": 1000}), 3.0, 1e-12, "3 dB/oct at 500 Hz")
    return errs


def check_samples():
    errs = []
    lf3 = {"kind": "lfTilt", "on": True, "dbPerOct": 3, "pivot": 1000}
    for fn in sorted(os.listdir(SAMPLES)):
        if not fn.startswith("Tilt_3dBoct_1000Hz"):
            continue
        layers = [lf3]
        if "_HPF" in fn:
            fc = float(fn.split("_HPF")[1].split("_")[0])
            layers.append({"kind": "hpf", "on": True, "fc": fc, "type": "LR", "slope": 48})
        m = base(); m["layers"] = layers
        raw = open(os.path.join(SAMPLES, fn), "rb").read()
        header, _, nl = read_crv(raw)
        props = {k.lower(): v for k, v in header}
        out = write_smaart_tf({"line": props["line"], "color": props["color"], "show": props["show"],
                               "tolerance": props["tolerance"], "useTolerance": props["usetolerance"]},
                              evaluate(m), nl)
        if out != raw:
            errs.append(f"sample {fn} does not match the engine byte-for-byte")
    return errs


def main():
    if "--write" in sys.argv:
        data = {"tolerance_db": TOL_DB, "spec": "docs/SPEC.md", "cases": build_cases()}
        with open(GOLDEN, "w") as fh:
            json.dump(data, fh, indent=1)
        print(f"wrote {GOLDEN} ({len(data['cases'])} cases)")
        return 0
    if "--check" in sys.argv:
        errs = sanity() + check_samples()
        stored = json.load(open(GOLDEN))
        fresh = {c["id"]: c for c in build_cases()}
        for c in stored["cases"]:
            exp = fresh.get(c["id"])
            if not exp:
                errs.append(f"golden case {c['id']} no longer generated"); continue
            for (f1, g1), (f2, g2) in zip(c["expected"], exp["expected"]):
                if abs(f1 - f2) > 1e-6 or abs(g1 - g2) > TOL_DB:
                    errs.append(f"{c['id']} differs at {f1} Hz: {g1} vs {g2}"); break
        for e in errs:
            print("FAIL", e)
        print("OK" if not errs else f"{len(errs)} failure(s)")
        return 1 if errs else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
