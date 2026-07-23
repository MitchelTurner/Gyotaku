# Deployment (Railway)

Gyotaku runs as **three** Railway services from one GitHub repo. Do not point a single service at the whole monorepo root.

## Services

| Service | Root directory | Public domain | Purpose |
|---|---|---|---|
| **web** | `web/` | `gyotaku.up.railway.app` | React app + Caddy `/api` proxy |
| **api** | `api/` | `gyotaku-api.up.railway.app` | NestJS API + Stripe webhooks |
| **worker** | `generator/` | optional | Python job consumer + `/health` |

Live:

- Web: https://gyotaku.up.railway.app
- API: https://gyotaku-api.up.railway.app

Also provision **Postgres**, **Redis**, and object storage (**Cloudflare R2** or S3). Link references into each service that needs them.

---

## Web

| Variable | Value |
|---|---|
| `API_PROXY_TARGET` | `https://gyotaku-api.up.railway.app` |
| `VITE_API_URL` | **Leave empty** — browser calls same-origin `/api` |

Production builds call the API at `https://gyotaku-api.up.railway.app` directly (see `web/src/lib/api.ts`). The API reflects CORS origins by default.

Optional: web also runs `node server.mjs` with `/api` → `API_PROXY_TARGET` for same-origin calls. Set on **web**:

| Variable | Value |
|---|---|
| `API_PROXY_TARGET` | `https://gyotaku-api.up.railway.app` |
| `RAILPACK_SPA_OUTPUT_DIR` | **delete** if present (forces static SPA and breaks Node start) |
| `VITE_API_URL` | leave empty (prod default is the API host) |

If uploads fail with “Failed to fetch”, confirm the API is up and CORS isn’t locked to `localhost`.

---

## API

Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres reference |
| `REDIS_URL` | Redis reference |
| `S3_*` | Same bucket credentials as the worker (R2 recommended) |
| `STRIPE_SECRET_KEY` | Checkout |
| `STRIPE_WEBHOOK_SECRET` | Endpoint `https://gyotaku-api.up.railway.app/webhooks/stripe` · events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded` |
| `PUBLIC_WEB_URL` | `https://gyotaku.up.railway.app` |
| `OPERATOR_TOKEN` | Shared secret for `/operator` + operator APIs |

Recommended:

| Variable | Notes |
|---|---|
| `STRIPE_AUTOMATIC_TAX` | `true` only after Stripe Tax is enabled in the Dashboard |
| `AFFILIATE_DEFAULT_COMMISSION_BPS` | Default `1000` (10%) |
| `SHIPPING_DOMESTIC_CENTS` | Flat US/CA shipping line item |
| `PLOTTED_QUEUE_MAX_DAYS` | Auto-close plotted originals / waitlist |
| `PRICE_*` / `PRICE_BAND_*` | Length-band SKU overrides — see [PRICING.md](PRICING.md) |
| `SHIPPING_PROVIDER` + EasyPost/Shippo keys | Buy-label fulfillment |
| `ALERT_WEBHOOK_URL` | Slack/Discord-style depth alerts |

**CORS:** delete a leftover `CORS_ORIGINS=http://localhost:5173` on Railway — it blocks the live web origin. Prefer leaving origins open (default reflect) or set `https://gyotaku.up.railway.app`.

After deploy:

```bash
npx prisma migrate deploy   # runs in release / start if configured
```

Ensure migrations through `affiliate_captains` and `business_pricing_waitlist` are applied.

---

## Worker

Root directory **`generator/`**. Variables are **not** inherited from the API service — set them on the worker explicitly:

| Variable | Notes |
|---|---|
| `REDIS_URL` | Redis reference |
| `DATABASE_URL` | Postgres reference |
| `S3_*` | **Identical** to API (same bucket) |

Worker `/health` returns `503` with `"missing":["REDIS_URL"]` until Redis is wired.

Job queues: `gyotaku:jobs` (generate / print), failures → `gyotaku:deadletter`.

---

## “Application not found” (Railway JSON 404)

If the browser or `curl` shows:

```json
{"status":"error","code":404,"message":"Application not found"}
```

with header `x-railway-fallback: true`, **no service is bound to that domain** (or the service was deleted / never deployed). This is not an app bug.

### Check which host is which

```bash
# Should be Nest JSON — NOT HTML
curl -sS https://gyotaku-api.up.railway.app/health | head

# Should be the React HTML shell — NOT "Application not found"
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://gyotaku.up.railway.app/

# Same-origin proxy through web → API (must be JSON, not HTML)
curl -sS https://gyotaku.up.railway.app/api/health | head
```

If `/api/health` on the web host returns **HTML**, fix **web** `API_PROXY_TARGET` to `https://gyotaku-api.up.railway.app` and redeploy web.

### Domain map

| Service | Root Directory | Public domain |
|---|---|---|
| **web** | `web` | `gyotaku.up.railway.app` |
| **api** | `api` | `gyotaku-api.up.railway.app` |
| **worker** | `generator` | optional |

1. Confirm all three services exist and are **Active**.
2. Root directories as above.
3. Domains attached as above (do not put the web domain on the API service).
4. **web**: `API_PROXY_TARGET=https://gyotaku-api.up.railway.app` (no `VITE_API_URL`)
5. **api**: `PUBLIC_WEB_URL=https://gyotaku.up.railway.app`, Stripe, `OPERATOR_TOKEN`, DB/Redis/S3
6. Redeploy **api**, then **web**, then **worker**
7. Re-run the `curl` checks

---

## “Failed to fetch” checklist

1. **api** — remove stale `CORS_ORIGINS` (especially `localhost:5173`)
2. **web** — remove `VITE_API_URL`; set `API_PROXY_TARGET=https://gyotaku-api.up.railway.app`
3. Redeploy **api** and **web**
4. Confirm `https://gyotaku.up.railway.app/api/health` returns Nest JSON
5. Confirm uploads go via `/api/uploads/.../content` (not a private MinIO URL)
6. Confirm **api** + **worker** share real R2/S3 credentials

---

## Stripe

1. API keys → `STRIPE_SECRET_KEY`
2. Webhook → `https://gyotaku-api.up.railway.app/webhooks/stripe` for:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `charge.refunded`
3. `PUBLIC_WEB_URL=https://gyotaku.up.railway.app`
4. Optional tax: enable Stripe Tax in Dashboard, then `STRIPE_AUTOMATIC_TAX=true` on the API service

Local forwarding:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## Health

- `GET https://gyotaku-api.up.railway.app/health` — Postgres, Redis, S3, Stripe config + alerts
- `GET https://gyotaku.up.railway.app/api/health` — same, via web proxy
- Worker `/health` — Redis + storage probes, queue depth
