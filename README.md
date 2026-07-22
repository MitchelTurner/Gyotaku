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

1. **web** — root directory `web/` (set `VITE_API_URL` to the API origin at **build** time). This is the public app URL.
2. **api** — root directory `api/` (public or private; web calls it via `VITE_API_URL`)
3. **worker** — root directory `generator/` (can be private; only needs Redis/Postgres/S3)

Attach Postgres, Redis, and an S3-compatible bucket; set the env vars from `api/.env.example`.

**Open the web service URL** for the UI. The worker URL only returns a JSON health check — it is not the app.

**Worker Variables are separate from the API** — linking Redis to the project is not enough; each service needs its own references:

1. Open the **worker** service (not Redis, not API)
2. **Variables** → **+ New Variable** → **Add Reference**
3. Select your Redis service → `REDIS_URL` (name the variable `REDIS_URL`)
4. Repeat for Postgres → `DATABASE_URL`
5. Copy the same `S3_*` values you use on the API
6. Redeploy the worker

If the Redis service is named something other than `Redis`, the reference uses that name (Railway shows it in the picker). Worker `/health` returns `503` with `"missing":["REDIS_URL"]` until this is set.

On **web**, set `VITE_API_URL=https://<your-api-service>.up.railway.app` (no trailing slash) before/at build. On **api**, set `CORS_ORIGINS` to the web origin.

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
