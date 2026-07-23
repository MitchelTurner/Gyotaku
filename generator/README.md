# Gyotaku Generator

Offline CLI + Redis worker that turn a photo into gyotaku-style pen-plotter artwork (**SVG paths + preview PNG**).

The NestJS API enqueues jobs; this package consumes them. See [Deployment](../docs/DEPLOYMENT.md) and [`worker/README.md`](worker/README.md).

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

## Salmon corpus

Real catch photos + Wikimedia salmon live in [`corpus/`](corpus/README.md):

```bash
gyotaku corpus                 # regenerate + contact sheet
gyotaku corpus --gate          # fail on metric drift vs baseline
gyotaku corpus --write-baseline
```

Do **not** run `gyotaku make-corpus` on this tree — that regenerates synthetic placeholders and wipes real photos.

## Determinism & quality

`(imageHash, styleParams, seed)` → byte-identical SVG.

```bash
pytest -q
```

Optional style params: `species` (`chinook|coho|sockeye|other`) and `side` (`left|right`) nudge mark density; salmon-aware matte scoring reduces false rejects on finned silhouettes.

## Pipeline

```
ingest → rembg matte → tonal maps (CLAHE / posterize / structure tensor / edges)
      → mark strategy (flowfield | contour | stipple)
      → ink physics (jitter / dropout)
      → simplify + reorder → SVG + preview (+ optional 300 DPI print)
```

`StyleParams` in `gyotaku/params.py` exposes every constant. Prefer tiny ink-physics amplitudes — if you can name the effect, it's too high.

## Worker (Railway)

Root directory for the worker service is **`generator/`**. It needs its own `REDIS_URL`, `DATABASE_URL`, and `S3_*` (same bucket as the API). Details: [`worker/README.md`](worker/README.md).
