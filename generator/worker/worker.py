#!/usr/bin/env python3
"""Phase 1 generator worker — Redis queue consumer, no web framework.

Job payload in → artifact keys out (and Rendition row updated in Postgres).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
import psycopg
import redis
from botocore.client import Config

# Allow `import gyotaku` when run from repo / installed editable
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gyotaku.params import StyleParams, resolve_params  # noqa: E402
from gyotaku.pipeline import generate  # noqa: E402

QUEUE_KEY = os.environ.get("GYOTAKU_JOB_QUEUE", "gyotaku:jobs")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")
S3_BUCKET = os.environ.get("S3_BUCKET", "gyotaku")
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "minio")
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minio12345")
S3_FORCE_PATH_STYLE = os.environ.get("S3_FORCE_PATH_STYLE", "true") == "true"


def log(msg: str) -> None:
    print(f"[worker] {msg}", flush=True)


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT or None,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY_ID,
        aws_secret_access_key=S3_SECRET_ACCESS_KEY,
        config=Config(s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"}),
    )


def db_connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    # Prisma uses postgresql:// — psycopg accepts it
    return psycopg.connect(DATABASE_URL)


def update_rendition(conn, rendition_id: str, fields: dict[str, Any]) -> None:
    cols = []
    vals = []
    for k, v in fields.items():
        cols.append(f'"{k}" = %s')
        vals.append(v)
    vals.append(rendition_id)
    sql = f'UPDATE "Rendition" SET {", ".join(cols)} WHERE id = %s'
    with conn.cursor() as cur:
        cur.execute(sql, vals)
    conn.commit()


def set_stage(conn, rendition_id: str, stage: str, status: str = "PROCESSING") -> None:
    update_rendition(
        conn,
        rendition_id,
        {"status": status, "stage": stage},
    )


def process_job(job: dict[str, Any]) -> None:
    rendition_id = job["renditionId"]
    s3_key = job["s3Key"]
    seed = int(job.get("seed") or 0)
    style_params = job.get("styleParams") or {}

    s3 = s3_client()
    conn = db_connect()
    try:
        set_stage(conn, rendition_id, "ingest")
        with tempfile.TemporaryDirectory(prefix="gyotaku-") as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "input.bin"
            out_dir = tmp_path / "out"
            out_dir.mkdir()

            log(f"{rendition_id}: download s3://{S3_BUCKET}/{s3_key}")
            s3.download_file(S3_BUCKET, s3_key, str(src))

            # Infer extension for pillow
            ext = Path(s3_key).suffix.lower() or ".jpg"
            image_path = tmp_path / f"input{ext}"
            src.rename(image_path)

            set_stage(conn, rendition_id, "segmenting")
            params = resolve_params(overrides=style_params if isinstance(style_params, dict) else {})
            # Watermark previews before purchase
            params = StyleParams.from_dict({**params.to_dict(), "watermark": True})

            stages = {"current": "segmenting"}

            def on_progress(stage: str, detail: str = "") -> None:
                stages["current"] = stage
                try:
                    set_stage(conn, rendition_id, stage)
                except Exception as e:
                    log(f"stage update failed: {e}")
                log(f"{rendition_id}: [{stage}] {detail}")

            result = generate(
                image_path,
                out_dir,
                params=params,
                seed=seed,
                write_print=False,
                progress=on_progress,
            )

            if result.rejected:
                update_rendition(
                    conn,
                    rendition_id,
                    {
                        "status": "REJECTED",
                        "stage": "rejected",
                        "matteScore": result.matte_score,
                        "failureReason": result.failure_reason,
                        "completedAt": datetime.now(timezone.utc),
                    },
                )
                log(f"{rendition_id}: REJECTED matte={result.matte_score:.2f}")
                return

            set_stage(conn, rendition_id, "finishing")
            svg_key = f"renditions/{rendition_id}/artwork.svg"
            preview_key = f"renditions/{rendition_id}/preview.png"
            s3.upload_file(
                str(result.svg_path),
                S3_BUCKET,
                svg_key,
                ExtraArgs={"ContentType": "image/svg+xml"},
            )
            s3.upload_file(
                str(result.preview_path),
                S3_BUCKET,
                preview_key,
                ExtraArgs={"ContentType": "image/png"},
            )

            update_rendition(
                conn,
                rendition_id,
                {
                    "status": "READY",
                    "stage": "done",
                    "matteScore": result.matte_score,
                    "svgKey": svg_key,
                    "previewKey": preview_key,
                    "estPlotSeconds": result.est_plot_seconds,
                    "completedAt": datetime.now(timezone.utc),
                },
            )
            log(f"{rendition_id}: READY paths={result.path_count}")
    except Exception as e:
        log(f"{rendition_id}: FAILED {e}")
        traceback.print_exc()
        try:
            update_rendition(
                conn,
                rendition_id,
                {
                    "status": "FAILED",
                    "stage": "failed",
                    "failureReason": str(e)[:500],
                    "completedAt": datetime.now(timezone.utc),
                },
            )
        except Exception:
            pass
    finally:
        conn.close()


def main() -> None:
    log(f"starting; redis={REDIS_URL} queue={QUEUE_KEY} bucket={S3_BUCKET}")
    # Validate DB URL host for logging only
    try:
        parsed = urlparse(DATABASE_URL)
        log(f"database host={parsed.hostname}")
    except Exception:
        pass

    r = redis.from_url(REDIS_URL, decode_responses=True)
    r.ping()
    log("redis ok; waiting for jobs")

    while True:
        try:
            item = r.blpop(QUEUE_KEY, timeout=5)
            if not item:
                continue
            _, raw = item
            job = json.loads(raw)
            log(f"job received renditionId={job.get('renditionId')}")
            process_job(job)
        except KeyboardInterrupt:
            log("shutdown")
            break
        except Exception as e:
            log(f"loop error: {e}")
            traceback.print_exc()
            time.sleep(1)


if __name__ == "__main__":
    main()
