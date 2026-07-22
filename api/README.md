# Gyotaku API — Phase 1

NestJS preview API: upload → enqueue generation → poll watermarked preview.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `POST` | `/uploads/presign` | Create upload record (returns API upload path) |
| `PUT` | `/uploads/:id/content` | Browser uploads bytes; API writes to S3 |
| `POST` | `/uploads/:id/complete` | Confirm upload, hash + dimensions |
| `POST` | `/renditions` | Enqueue generation |
| `GET` | `/renditions/:id` | Poll status / preview URL |

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

## Env

See `.env.example`. Point `DATABASE_URL`, `REDIS_URL`, and S3_* at your Railway / MinIO services.
