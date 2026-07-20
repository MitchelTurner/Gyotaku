# Gyotaku Generator — Phase 0

Offline CLI that turns a photo into gyotaku-style pen-plotter artwork: **SVG paths + preview PNG**.

Phase 0 is the product. No web, no DB, no queue until the generator produces images worth hanging.

## Setup

```bash
cd generator
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

First run downloads the `rembg` U²-Net weights (~176 MB).

## Generate one image

```bash
gyotaku generate path/to/photo.jpg -o out/ --seed 0
# optional: --params style.json --preset dense --set posterize_levels=5
```

Writes `out/artwork.svg`, `out/preview.png`, `out/meta.json`.

Exit code `2` means the matte was rejected (soft failure — try another photo).

## Test corpus

```bash
gyotaku make-corpus          # synthesize 20 stand-in photos into corpus/images/
gyotaku corpus               # regenerate all → corpus/runs/<timestamp>/ + contact sheet
```

Replace the synthetic images in `corpus/images/` with real photos when available (same filenames or any `*.jpg`/`*.png`). Every generator change should re-run the corpus and be reviewed by eye.

## Determinism

`(imageHash, styleParams, seed)` → byte-identical SVG. Asserted in CI:

```bash
pytest -q
```

## Architecture (this package)

```
ingest → rembg matte → tonal maps (CLAHE / posterize / structure tensor / edges)
      → mark strategy (flowfield | contour | stipple)
      → ink physics (jitter / dropout)
      → simplify + reorder → SVG + preview
```

`StyleParams` in `gyotaku/params.py` exposes every constant. Prefer tiny ink-physics amplitudes — if you can name the effect, it's too high.
