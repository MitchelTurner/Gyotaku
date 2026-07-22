# Gyotaku Plotter Prints

Upload a salmon photo → gyotaku-style pen-plotter artwork → order a hand-plotted original or giclée.

**Current focus: Phase 3** — Stripe checkout + operator fulfillment on top of the Phase 2 preview UI.

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

Phase 3 adds **Order this print** → Stripe Checkout (plotted original or giclée) and an operator queue at `GET /operator/orders` (header `x-operator-token`).

### Railway

Deploy **three services** (not one):

1. **web** — root directory `web/` — **this is the live site**
2. **api** — root directory `api/`
3. **worker** — root directory `generator/` (JSON health only — not the UI)

If you only have a generator/worker service, add a new service from the same repo with **Root Directory = `web`**, enable a public domain, set build-time `VITE_API_URL` to your API origin, and deploy. Opening the worker URL will never show the React app.

**Worker Variables are separate from the API** — linking Redis to the project is not enough; each service needs its own references:

1. Open the **worker** service (not Redis, not API)
2. **Variables** → **+ New Variable** → **Add Reference**
3. Select your Redis service → `REDIS_URL` (name the variable `REDIS_URL`)
4. Repeat for Postgres → `DATABASE_URL`
5. Copy the same `S3_*` values you use on the API
6. Redeploy the worker

If the Redis service is named something other than `Redis`, the reference uses that name (Railway shows it in the picker). Worker `/health` returns `503` with `"missing":["REDIS_URL"]` until this is set.

**If the web UI says Failed to fetch**, fix Railway variables then redeploy api + web:

1. **api** → delete `CORS_ORIGINS` (a leftover `localhost:5173` blocks `gyotaku-web`)
2. **web** → delete `VITE_API_URL` (app should call same-origin `/api`)
3. **web** → add `API_PROXY_TARGET=https://gyotaku.up.railway.app`

**Storage:** set real `S3_*` on api + worker (not `localhost:9000`).

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

- Open **`/operator`** on the web app (token = `OPERATOR_TOKEN`): fulfillment, captains/affiliates, failed-job retry, metrics.
- **Captain affiliates:** create a captain under Ops → Captains, print their QR (`/?ref=code`). Guests scan → order; captain earns a % of the product (default 10%). Mark commissions paid when you settle up.
- Originals stay limited; if plot-queue ETA exceeds `PLOTTED_QUEUE_MAX_DAYS`, that tier closes automatically.
- Paid giclées enqueue a 300 DPI `printKey` for POD handoff.
- Optional EasyPost/Shippo: **Buy label + ship** writes tracking and marks SHIPPED.
- `/health` on API + worker probes Redis, R2/S3, Stripe config and surfaces queue-depth / MinIO-default alerts (`ALERT_WEBHOOK_URL` optional).

### What “finished” really means

Generator quality first (Phase 0). Phase 1 exposes it as a preview API. The product people buy is the **line work**, not the app.
