# Generator worker (Phase 1)

Plain Redis queue consumer. No web framework.

```
BLPOP gyotaku:jobs → download upload from S3 → gyotaku.pipeline.generate
  → upload SVG + preview → update Rendition row in Postgres
```

## Run locally

```bash
# infra
docker compose up -d   # from repo root

cd generator
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
# or: pip install -r requirements.txt

set -a && source worker/.env.example && set +a   # or export the vars below
python worker/worker.py
```

## Railway

On the **worker** service (root directory `generator/`), set variable references to Redis + Postgres — they are not inherited from the API service:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Also copy the API’s `S3_*` vars. See [`worker/.env.example`](.env.example).

Job payload (JSON):

```json
{
  "renditionId": "...",
  "uploadId": "...",
  "s3Key": "uploads/session/id.jpg",
  "styleParams": {},
  "seed": 0,
  "imageHash": "..."
}
```
