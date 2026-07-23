# Generator worker

Plain Redis queue consumer for the Gyotaku API. No web framework.

```
BLPOP gyotaku:jobs
  → download upload from S3/R2
  → gyotaku.pipeline.generate  (or type:print for 300 DPI raster)
  → upload SVG / preview / print → update Rendition in Postgres
```

Failed jobs go to `gyotaku:deadletter`. Latencies land in `gyotaku:metrics:latency`.  
`/health` probes Redis + storage and can alert on default MinIO creds or queue-depth spikes (`QUEUE_DEPTH_ALERT`, optional `ALERT_WEBHOOK_URL`).

See [Deployment](../../docs/DEPLOYMENT.md) for Railway wiring.

## Run locally

```bash
# infra
docker compose up -d   # from repo root

cd generator
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[worker]"
# or: pip install -r requirements.txt

set -a && source worker/.env.example && set +a
python worker/worker.py
```

## Railway

On the **worker** service (root directory `generator/`), set variable **references** to Redis + Postgres — they are not inherited from the API:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Copy the API’s `S3_*` vars exactly. See [`worker/.env.example`](.env.example).

## Job payloads

Generate (default):

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

Print raster (giclée / framed handoff):

```json
{
  "type": "print",
  "renditionId": "...",
  "uploadId": "...",
  "s3Key": "uploads/session/id.jpg",
  "styleParams": {},
  "seed": 0,
  "imageHash": "..."
}
```
