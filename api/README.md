# Gyotaku API

NestJS service: uploads, rendition jobs, Stripe checkout, operator APIs, captain affiliates.

See also:

- [Root README](../README.md)
- [Deployment](../docs/DEPLOYMENT.md)
- [Pricing](../docs/PRICING.md)
- [Affiliates](../docs/AFFILIATES.md)
- [Operator](../docs/OPERATOR.md)

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Deep checks: Postgres, Redis, S3, Stripe + alerts |
| `POST` | `/uploads/presign` | Create upload record |
| `PUT` | `/uploads/:id/content` | Browser upload proxy → S3 |
| `POST` | `/uploads/:id/complete` | Confirm upload, hash + dimensions |
| `POST` | `/renditions` | Enqueue generation |
| `GET` | `/renditions/:id` | Poll status / preview URL |
| `GET` | `/share/renditions/:id` | Public share preview |
| `GET` | `/orders/quote` | Length-band SKU + shipping quote |
| `POST` | `/orders/checkout` | Stripe Checkout (`giftNote`, `affiliateCode` optional) |
| `POST` | `/orders/waitlist` | Join waitlist when plotted tier is closed |
| `GET` | `/orders/:id` | Order status (session-scoped) |
| `GET` | `/orders/:id/artifacts` | Paid unlock: clean preview + SVG |
| `GET` | `/orders/availability/plotted` | Queue ETA + open/closed |
| `POST` | `/webhooks/stripe` | `checkout.session.completed` (raw body) |
| `POST` | `/webhooks/prodigi` | Prodigi order stage / shipment callbacks |
| `POST` | `/internal/print-ready` | Worker hook after `print.png` (auto Prodigi) |
| `POST` | `/operator/orders/:id/prodigi` | Manual Prodigi submit |
| `GET` | `/affiliates/:code` | Public captain resolve for QR landing |
| `GET` | `/operator/orders` | Fulfillment queue (`x-operator-token`) |
| `PATCH` | `/operator/orders/:id` | Update fulfillment status |
| `POST` | `/operator/orders/:id/label` | Buy EasyPost/Shippo label → SHIPPED |
| `POST` | `/operator/orders/:id/print` | Queue 300 DPI `printKey` |
| `GET` | `/operator/affiliates` | Captains + owed commissions |
| `POST` | `/operator/affiliates` | Create captain |
| `POST` | `/operator/affiliates/:id/mark-paid` | Settle commissions |
| `GET` | `/operator/waitlist` | Plotted waitlist entries |
| `GET` | `/operator/renditions/failed` | Failed jobs + dead-letter peek |
| `POST` | `/operator/renditions/:id/retry` | Re-queue failed rendition |
| `GET` | `/operator/metrics` | p50/p95 generate time, reject rates |

Operator UI: `/operator` on the web app (tabs: Fulfillment / Captains / Waitlist / Failed jobs / Metrics).

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

Start the Python worker separately (see [`../generator/worker/README.md`](../generator/worker/README.md)).

## Stripe

1. Set `STRIPE_SECRET_KEY`
2. Set `PUBLIC_WEB_URL=https://gyotaku.up.railway.app`
3. Webhook `https://gyotaku-api.up.railway.app/webhooks/stripe` → `checkout.session.completed` → `STRIPE_WEBHOOK_SECRET`
4. Set `OPERATOR_TOKEN` for operator routes

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

## Env

See [`.env.example`](.env.example) for Stripe, S3/R2, pricing bands, shipping, affiliates, queue limits, and alerts.
