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
| `GET` | `/orders/quote` | Price for product + fish length |
| `POST` | `/orders/checkout` | Create Stripe Checkout session |
| `GET` | `/orders/:id` | Order status (session-scoped) |
| `POST` | `/webhooks/stripe` | Stripe webhook (raw body) |
| `GET` | `/operator/orders` | Fulfillment queue (`x-operator-token`) |
| `PATCH` | `/operator/orders/:id` | Update fulfillment status |

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
