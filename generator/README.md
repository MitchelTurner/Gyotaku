# Gyotaku Generator — Phase 0 / worker

Offline CLI that turns a photo into gyotaku-style pen-plotter artwork: **SVG paths + preview PNG**.

Phase 1 adds a Redis queue worker in [`worker/`](worker/README.md) that runs the same pipeline for the NestJS API.

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

## Determinism & quality gates

`(imageHash, styleParams, seed)` → byte-identical SVG. Asserted in CI:

```bash
pytest -q
# optional full corpus drift check (needs corpus images + rembg weights):
gyotaku corpus --gate
```

Optional style params: `species` (`chinook|coho|sockeye|other`) and `side` (`left|right`) nudge mark density; salmon-aware matte scoring reduces false rejects on finned silhouettes.

## Architecture (this package)

```
ingest → rembg matte → tonal maps (CLAHE / posterize / structure tensor / edges)
      → mark strategy (flowfield | contour | stipple)
      → ink physics (jitter / dropout)
      → simplify + reorder → SVG + preview
```

`StyleParams` in `gyotaku/params.py` exposes every constant. Prefer tiny ink-physics amplitudes — if you can name the effect, it's too high.
