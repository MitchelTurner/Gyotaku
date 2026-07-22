# Gyotaku Plotter Prints

Upload a salmon photo → gyotaku-style pen-plotter artwork → order a hand-plotted original or giclée.

**Current focus: Phase 2** — upload / preview web UI on top of the Phase 1 API.

| Package | Role |
|---|---|
| [`web/`](web/README.md) | React upload → generate → preview UI |
| [`api/`](api/README.md) | NestJS upload / rendition preview API |
| [`generator/`](generator/README.md) | Offline CLI + Python queue worker |

```bash
docker compose up -d
cd api && cp .env.example .env && npm i && npx prisma migrate deploy && npm run start:dev
cd generator && pip install -e ".[worker]" && python worker/worker.py
cd web && npm i && npm run dev
```

Phase 3 (checkout, fulfillment) comes next.

### Railway

Deploy **three services**:

1. **web** — root directory `web/` (set `VITE_API_URL` to the API origin at build time)
2. **api** — root directory `api/`
3. **worker** — root directory `generator/`

Attach Postgres, Redis, and an S3-compatible bucket; set the env vars from `api/.env.example`.

**Worker must get the same Redis/Postgres/S3 vars as the API** (sharing is not automatic). On the worker service Variables tab, add references such as:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

plus your `S3_*` values. If `REDIS_URL` is missing, the worker falls back to `localhost:6379` and crash-loops.

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
