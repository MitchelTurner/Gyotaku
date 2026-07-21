# Gyotaku Plotter Prints

Upload a salmon photo → gyotaku-style pen-plotter artwork → order a hand-plotted original or giclée.

**Current focus: Phase 1** — job queue + preview API around the Phase 0 generator.

| Package | Role |
|---|---|
| [`generator/`](generator/README.md) | Offline CLI + Python queue worker |
| [`api/`](api/README.md) | NestJS upload / rendition preview API |

```bash
# Generator (Phase 0)
cd generator && pip install -e ".[dev]"
gyotaku generate corpus/images/01_fish.jpg -o /tmp/gyotaku-out

# API + worker (Phase 1)
docker compose up -d
cd api && cp .env.example .env && npm install && npx prisma migrate deploy && npm run start:dev
# other terminal:
cd generator && pip install -e . && pip install -r worker/requirements.txt && python worker/worker.py
```

Phases 2–3 (web UI, checkout, fulfillment) come after the preview API is solid.

### Railway

Deploy **two services** from this repo:

1. **api** — root directory `api/` (`railpack.json` → NestJS)
2. **worker** — root directory `generator/` (`railpack.json` → `python worker/worker.py`)

Attach Postgres, Redis, and an S3-compatible bucket; set the env vars from `api/.env.example`.

---

## How it works when finished

### For the customer

1. **Upload** a salmon photo from their phone (drag-drop or camera roll).
2. **Wait ~20–90s** while the generator runs: cut the fish from the background → turn tone into pen strokes → apply light “ink” imperfections → make an SVG + preview.
3. **Preview** a watermarked print on paper texture. Tweak style (density / ink character). Each tweak makes a new version; good combos are cached.
4. If the photo is bad (busy background, blur, etc.), they get a clear “try another photo” message — not a muddy fake print.
5. **Order** size + type:
   - **Plotted original** — hand-drawn on an AxiDraw, signed/editioned
   - **Giclée** — high-res print, no hand plotting
6. Pay via Stripe → shipping → done. No account until checkout.

### Behind the scenes

```
Phone → website → NestJS API → BullMQ/Redis ──> Python worker ──> S3
                          │                         │
                          └─────── Postgres ────────┘
```

Every artwork stores its **seed + settings**, so a reprint or re-plot is identical.

### For the operator

- A small **plot queue**: download SVG, see estimated plot time, mark plotting → packed → shipped, add tracking.
- Originals stay limited; if the queue gets too long, that tier closes automatically.
- Giclées go out through a print-on-demand path without touching each one.

### What “finished” really means

Generator quality first (Phase 0). Phase 1 exposes it as a preview API. The product people buy is the **line work**, not the app.
