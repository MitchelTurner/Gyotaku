# Gyotaku API — Phase 1–3

NestJS API: upload → enqueue generation → poll watermarked preview → Stripe checkout → operator fulfillment.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness (+ storage summary) |
| `POST` | `/uploads/presign` | Create upload record |
| `PUT` | `/uploads/:id/content` | Browser uploads bytes; API writes to S3 |
| `POST` | `/uploads/:id/complete` | Confirm upload, hash + dimensions |
| `POST` | `/renditions` | Enqueue generation |
| `GET` | `/renditions/:id` | Poll status / preview URL |
| `GET` | `/orders/quote` | Length-band SKU price + shipping for product |
| `POST` | `/orders/checkout` | Create Stripe Checkout (product + shipping lines, optional `giftNote` / `affiliateCode`) |
| `POST` | `/orders/waitlist` | Join waitlist when plotted queue is closed |
| `GET` | `/affiliates/:code` | Public captain lookup for QR landing |
| `GET` | `/operator/affiliates` | List captains + owed commissions |
| `POST` | `/operator/affiliates` | Create captain (returns QR URL) |
| `POST` | `/operator/affiliates/:id/mark-paid` | Mark unpaid commissions paid |
| `GET` | `/orders/:id` | Order status (session-scoped) |
| `POST` | `/webhooks/stripe` | Stripe webhook (raw body) |
| `GET` | `/operator/orders` | Fulfillment queue (`x-operator-token`) |
| `PATCH` | `/operator/orders/:id` | Update fulfillment status |
| `POST` | `/operator/orders/:id/label` | Buy EasyPost/Shippo label → tracking + SHIPPED |
| `POST` | `/operator/orders/:id/print` | Queue 300 DPI `printKey` for giclée |
| `GET` | `/operator/waitlist` | Plotted-original waitlist |
| `GET` | `/orders/availability/plotted` | Queue ETA + whether plotted originals are open |
| `GET` | `/health` | Deep checks: Postgres, Redis, R2/S3, Stripe + alerts |
| `GET` | `/operator/renditions/failed` | Failed jobs + dead-letter peek |
| `POST` | `/operator/renditions/:id/retry` | Re-queue a failed rendition |
| `GET` | `/operator/metrics` | p50/p95 generate time, reject/fail rates |

Operator UI: open `/operator` on the web app and paste `OPERATOR_TOKEN` (tabs: Fulfillment / Captains / Waitlist / Failed jobs / Metrics).

Rate limits (per `sessionId`): **10 uploads/hour**, **30 renditions/hour**.

## Local setup

```bash
# from repo root
docker compose up -d   # postgres, redis, minio

cd api
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

In another terminal, start the Python worker (see `../generator/worker`).

## Stripe (Phase 3)

1. Create a Stripe account → Developers → API keys → set `STRIPE_SECRET_KEY`
2. Set `PUBLIC_WEB_URL` to the web origin (e.g. `https://gyotaku-web.up.railway.app`)
3. Add webhook endpoint `https://<api>/webhooks/stripe` for `checkout.session.completed` → `STRIPE_WEBHOOK_SECRET`
4. Set `OPERATOR_TOKEN` for the plot queue API

Local webhook forwarding:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

## Env

See `.env.example`.
