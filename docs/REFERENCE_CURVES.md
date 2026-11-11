# Reference curves in the built-in presets

What each preset is based on, so you can check it against the source. Nothing here has been tried in Smaart or by ear.

## Weighting and classic EQ curves (SPEC §4.4f)
- **A and C weighting:** IEC 61672-1, analytic formulas with poles at 20.598997, 107.65265, 737.86223 and 12194.217 Hz, shifted to exactly 0 dB at 1 kHz. Tested against the standard's Table 3 (1/3-octave values) to the table's 0.1 dB rounding.
- **RIAA playback:** time constants 3180 µs, 318 µs and 75 µs, shifted to 0 dB at 1 kHz. Tested against the published table (+19.27 dB at 20 Hz, −19.62 dB at 20 kHz). The recording curve is its inverse.
- **FM pre-emphasis:** 75 µs (Americas, Japan) and 50 µs (Europe), 0 dB at low frequencies, +3.01 dB at 1/(2πτ).
- Every layer has an **Invert** button that flips its sign, so the inverse of A-weighting, the RIAA recording curve and de-emphasis come from the same curve.

## Cinema X-curve: SMPTE ST 202:2010
Source: SMPTE ST 202:2010, *Motion-Pictures: Dubbing Stages (Mixing Rooms), Screening Rooms and Indoor Theaters: B-Chain Electroacoustic Response* (https://pub.smpte.org/pub/st202/st0202-2010.pdf). The standard says "All contemporary practice is targeted to the X-Curve" (section 4.9).
- **Medium theatre (200 to 500 seats):** Table 1, in 1/3-octave bands: 31.5 Hz −2 dB, 40 Hz −1, 50 Hz to 2 kHz 0, then −1 dB per band from 2.5 kHz: 2.5k −1, 3.15k −2, 4k −3, 5k −4, 6.3k −5, 8k −6, 10k −7, 12.5k −9, 16k −11. The preset exports exactly those 28 points, 31.5 Hz to 16 kHz, which is the range the table defines.
- **Tolerances:** the standard gives +3 dB and −3 dB from 80 Hz to 8 kHz, widening to −7 dB at 31.5 Hz and −6 dB at 16 kHz. The preset uses a symmetric ±3 dB band.
- **Room size:** Table A.1 (informative) gives corrections added to Table 1 at 4 kHz and 8 kHz, none at or below 2 kHz: 150 seats +0.5 and +1.0 dB, 500 seats 0, 1000 seats −0.5 and −1.0 dB. The small and large presets add them as a second Points layer, interpolated between 2, 4 and 8 kHz. The standard gives nothing above 8 kHz, so the 8 kHz correction is held there. This is an assumption.
- **Subwoofer:** section 6.3 asks for a flat response within ±3 dB from 25 Hz to 120 Hz after equalisation.
- **Not included:** the surround-channel characteristic (Annex A.6), and other X-curve variants some sources describe (for example a 1.5 dB/oct slope, or Allen's later "Real X-Curve"). I found no primary source for Dolby Atmos or DCI reference-room curves.
