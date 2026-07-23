# Deployment (Railway)

Gyotaku runs as **three** Railway services from one GitHub repo. Do not point a single service at the whole monorepo root.

## Services

| Service | Root directory | Public? | Purpose |
|---|---|---|---|
| **web** | `web/` | Yes | React app + Caddy `/api` proxy |
| **api** | `api/` | Yes | NestJS API + Stripe webhooks |
| **worker** | `generator/` | Optional | Python job consumer + `/health` |

Live defaults (change if you rename services):

- Web: `https://gyotaku-web.up.railway.app`
- API: `https://gyotaku.up.railway.app`

Also provision **Postgres**, **Redis**, and object storage (**Cloudflare R2** or S3). Link references into each service that needs them.

---

## Web

| Variable | Value |
|---|---|
| `API_PROXY_TARGET` | API public origin, e.g. `https://gyotaku.up.railway.app` |
| `VITE_API_URL` | **Leave empty** — browser calls same-origin `/api` |

Caddy (or `server.mjs`) proxies `/api/*` → `API_PROXY_TARGET`, which avoids CORS issues.

Set API `PUBLIC_WEB_URL` to the web origin so Stripe success/cancel redirects work.

---

## API

Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres reference |
| `REDIS_URL` | Redis reference |
| `S3_*` | Same bucket credentials as the worker (R2 recommended) |
| `STRIPE_SECRET_KEY` | Checkout |
| `STRIPE_WEBHOOK_SECRET` | Endpoint `https://<api>/webhooks/stripe` · event `checkout.session.completed` |
| `PUBLIC_WEB_URL` | Web origin |
| `OPERATOR_TOKEN` | Shared secret for `/operator` + operator APIs |

Recommended:

| Variable | Notes |
|---|---|
| `AFFILIATE_DEFAULT_COMMISSION_BPS` | Default `1000` (10%) |
| `SHIPPING_DOMESTIC_CENTS` | Flat US/CA shipping line item |
| `PLOTTED_QUEUE_MAX_DAYS` | Auto-close plotted originals / waitlist |
| `PRICE_*` / `PRICE_BAND_*` | Length-band SKU overrides — see [PRICING.md](PRICING.md) |
| `SHIPPING_PROVIDER` + EasyPost/Shippo keys | Buy-label fulfillment |
| `ALERT_WEBHOOK_URL` | Slack/Discord-style depth alerts |

**CORS:** delete a leftover `CORS_ORIGINS=http://localhost:5173` on Railway — it blocks the live web origin. Prefer leaving origins open (default reflect) or set the real web URL.

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
# Should be Nest JSON, e.g. {"ok":true,...} — NOT HTML
curl -sS https://gyotaku.up.railway.app/health | head

# Should be the React HTML shell — NOT "Application not found"
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://gyotaku-web.up.railway.app/
```

If `gyotaku.up.railway.app/health` returns **HTML**, the API domain is pointing at the **web** service (wrong root directory or wrong domain assignment).

### Fix in Railway dashboard

You need **three** services:

| Service | Root Directory | Public domain |
|---|---|---|
| **api** | `api` | `gyotaku.up.railway.app` |
| **web** | `web` | `gyotaku-web.up.railway.app` |
| **worker** | `generator` | optional |

1. Open the project → confirm all three services exist and are **Active** (not removed / crashed).
2. On each service → **Settings → Root Directory** as above.
3. **Settings → Networking / Domains**
   - Attach `gyotaku.up.railway.app` to **api** only
   - Attach `gyotaku-web.up.railway.app` to **web** only  
   - If a domain shows “Application not found”, generate a new domain or re-link it to the correct service
4. **web** variables: `API_PROXY_TARGET=https://gyotaku.up.railway.app` (no `VITE_API_URL`)
5. **api** variables: Stripe, `PUBLIC_WEB_URL=https://gyotaku-web.up.railway.app`, `OPERATOR_TOKEN`, DB/Redis/S3
6. Redeploy **api**, then **web**, then **worker**
7. Re-run the `curl` checks above

Do **not** set the API service root to `web/` — that replaces the API with the SPA and breaks `/health` + checkout.

---

## “Failed to fetch” checklist

1. **api** — remove stale `CORS_ORIGINS` (especially `localhost:5173`)
2. **web** — remove `VITE_API_URL`; set `API_PROXY_TARGET` to the API HTTPS origin
3. Redeploy **api** and **web**
4. Confirm uploads: browser should `PUT` via `/api/uploads/.../content` (API proxy), not a private `localhost` MinIO URL
5. Confirm **api** + **worker** share real R2/S3 credentials (not default MinIO)

---

## Stripe

1. API keys → `STRIPE_SECRET_KEY`
2. Webhook → `https://<api-host>/webhooks/stripe` for `checkout.session.completed`
3. `PUBLIC_WEB_URL` = web origin

Local forwarding:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## Health

- `GET https://<api>/health` — Postgres, Redis, S3, Stripe config + alerts
- Worker `/health` — Redis + storage probes, queue depth
