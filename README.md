# Gyotaku

Turn a salmon photo into gyotaku-style pen-plotter art — then sell a hand-plotted original or a giclée.

**Live**

| Service | URL |
|---|---|
| Web app | https://gyotaku-web.up.railway.app |
| API | https://gyotaku.up.railway.app |

Guests upload a catch, preview a watermarked print, and check out through Stripe. Captains can share a QR code so charters earn a commission. Operators fulfill plots, prints, and payouts from `/operator`.

---

## Packages

| Package | Role |
|---|---|
| [`web/`](web/README.md) | React customer UI + operator console |
| [`api/`](api/README.md) | NestJS API, Stripe, Postgres, Redis jobs |
| [`generator/`](generator/README.md) | Offline CLI + Python queue worker |

Deeper guides live in [`docs/`](docs/):

| Doc | Topic |
|---|---|
| [Deployment](docs/DEPLOYMENT.md) | Railway services, env vars, Failed to fetch |
| [Operator](docs/OPERATOR.md) | Fulfillment, waitlist, metrics, labels |
| [Captain affiliates](docs/AFFILIATES.md) | QR referral program + commissions |
| [Pricing](docs/PRICING.md) | Length-band SKUs, shipping, framed upsell |

---

## Local development

```bash
docker compose up -d   # Postgres, Redis, MinIO

cd api && cp .env.example .env && npm i && npx prisma migrate deploy && npm run start:dev
cd generator && pip install -e ".[worker]" && python worker/worker.py
cd web && npm i && npm run dev
```

- Web: http://localhost:5173 (proxies `/api` → API)
- API: http://localhost:3000
- Operator UI: http://localhost:5173/operator (token = `OPERATOR_TOKEN`)

---

## Product flow

### Customer

1. **Upload** a fish photo (phone camera welcome).
2. **Size** — enter nose-to-tail length for a life-size print, or fit to paper.
3. **Generate** (~20–90s) — matte → pen strokes → SVG + watermarked preview.
4. **Tweak** density, ink, species/side tags; compare strategies; share with `/?p=<renditionId>`.
5. **Order**
   - Plotted original (editioned, AxiDraw) — or join the **waitlist** if the plot queue is closed
   - Giclée, with optional **framed** upsell
   - Optional gift note; domestic shipping (US/CA) as a flat Stripe line item
6. Pay via Stripe → clean preview + SVG unlock after payment → ship.

Prices use **length-band SKUs** (S / M / L / XL). See [Pricing](docs/PRICING.md).

### Captain (affiliate)

1. Operator creates a captain under **Ops → Captains**.
2. Captain prints the QR (`/?ref=<code>`).
3. Guest scans → orders a print → captain earns a % of the product (default 10%).
4. Operator marks commissions paid when settling up.

See [Captain affiliates](docs/AFFILIATES.md).

### Operator

Open **`/operator`** with `OPERATOR_TOKEN`:

- **Fulfillment** — plot / print / pack / buy shipping label
- **Captains** — QR links, owed commissions
- **Waitlist** — emails when plotted originals are closed
- **Failed jobs** — dead-letter retry
- **Metrics** — p50/p95 generate time, reject rates

See [Operator](docs/OPERATOR.md).

### Architecture

```
Phone → web → NestJS API → Redis queue ──> Python worker ──> S3/R2
                 │                              │
                 └────────── Postgres ──────────┘
```

Each artwork stores **seed + style params**, so reprints and re-plots match.

---

## Railway (short version)

Deploy **three** services from this repo:

1. **web** — root `web/` — public site
2. **api** — root `api/`
3. **worker** — root `generator/` (health JSON only — not the UI)

Worker needs its own `REDIS_URL`, `DATABASE_URL`, and `S3_*` (not inherited from API).

Full checklist: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quality

Generator changes should stay deterministic: `(imageHash, styleParams, seed)` → identical SVG.

```bash
cd generator && pytest -q
# optional corpus gate (real salmon photos):
gyotaku corpus --gate
```

See [`generator/corpus/README.md`](generator/corpus/README.md).
