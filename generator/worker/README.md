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
pip install -r worker/requirements.txt

export DATABASE_URL=postgresql://gyotaku:gyotaku@localhost:5432/gyotaku
export REDIS_URL=redis://localhost:6379
export S3_ENDPOINT=http://localhost:9000
export S3_ACCESS_KEY_ID=minio
export S3_SECRET_ACCESS_KEY=minio12345
export S3_BUCKET=gyotaku
export S3_FORCE_PATH_STYLE=true

python worker/worker.py
```

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
