#!/usr/bin/env python3
"""Phase 1 generator worker — Redis queue consumer, no web framework.

Job payload in → artifact keys out (and Rendition row updated in Postgres).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
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
DATABASE_URL = os.environ.get("DATABASE_URL", "")
S3_ENDPOINT = (os.environ.get("S3_ENDPOINT") or "").strip() or None
S3_BUCKET = os.environ.get("S3_BUCKET", "gyotaku")
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "minio")
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minio12345")
_IS_R2 = bool(S3_ENDPOINT and "r2.cloudflarestorage.com" in S3_ENDPOINT)
# R2 requires region "auto". Default path-style works for MinIO; R2 prefers virtual-hosted
# unless S3_FORCE_PATH_STYLE is explicitly set.
S3_REGION = os.environ.get("S3_REGION") or ("auto" if _IS_R2 else "us-east-1")
if "S3_FORCE_PATH_STYLE" in os.environ:
    S3_FORCE_PATH_STYLE = os.environ.get("S3_FORCE_PATH_STYLE", "true") == "true"
else:
    S3_FORCE_PATH_STYLE = not _IS_R2
_DEFAULT_MINIO_CREDS = S3_ACCESS_KEY_ID == "minio" and S3_SECRET_ACCESS_KEY == "minio12345"

LOCAL_REDIS_DEFAULT = "redis://localhost:6379"

# Shared with the health HTTP handler (updated as config/connect progresses).
HEALTH: dict[str, Any] = {
    "status": "starting",
    "service": "gyotaku-worker",
    "message": "starting",
    "missing": [],
}


def log(msg: str) -> None:
    print(f"[worker] {msg}", flush=True)


def peek_redis_url() -> str | None:
    """Return a Redis URL from env, or None if unset."""
    for key in ("REDIS_URL", "REDIS_PRIVATE_URL", "REDIS_PUBLIC_URL"):
        value = os.environ.get(key, "").strip()
        if value:
            return value

    host = os.environ.get("REDISHOST") or os.environ.get("REDIS_HOST")
    port = os.environ.get("REDISPORT") or os.environ.get("REDIS_PORT") or "6379"
    password = os.environ.get("REDISPASSWORD") or os.environ.get("REDIS_PASSWORD")
    user = os.environ.get("REDISUSER") or os.environ.get("REDIS_USER") or "default"
    if host:
        if password:
            return f"redis://{user}:{password}@{host}:{port}"
        return f"redis://{host}:{port}"

    if os.environ.get("RAILWAY_ENVIRONMENT"):
        return None
    return LOCAL_REDIS_DEFAULT


REDIS_SETUP_HINT = (
    "On the worker service → Variables → New Variable → "
    "Variable Reference → pick your Redis service's REDIS_URL "
    "(or set REDIS_URL=${{Redis.REDIS_URL}} using your Redis service name). "
    "Also set DATABASE_URL the same way from Postgres. Redeploy after saving."
)


def require_or_wait(label: str, value: str | None, hint: str) -> str:
    """If value is missing, stay alive with a health error (no crash loop).

    Railway injects Variables at process start — after you add them, redeploy.
    """
    if value:
        return value
    HEALTH.update(
        {
            "status": "misconfigured",
            "message": f"{label} is not set on this service",
            "missing": sorted(set([*HEALTH.get("missing", []), label])),
            "hint": hint,
        }
    )
    log(f"{label} is not set. {hint} Waiting (redeploy after adding Variables)…")
    while True:
        time.sleep(60)


def connect_redis(url: str, *, delay_sec: float = 2.0) -> redis.Redis:
    """Retry forever until Redis accepts connections."""
    attempt = 0
    while True:
        attempt += 1
        try:
            client = redis.from_url(url, decode_responses=True, socket_connect_timeout=5)
            client.ping()
            return client
        except Exception as e:
            HEALTH.update(
                {
                    "status": "waiting_for_redis",
                    "message": f"cannot connect to redis: {e}",
                }
            )
            log(f"redis connect attempt {attempt} failed: {e}")
            time.sleep(delay_sec)


def start_health_server() -> None:
    """Bind PORT so Railway public networking / health checks don't 502.

    The worker is not the product UI — open the *web* service URL for that.
    """
    port_raw = os.environ.get("PORT")
    if not port_raw:
        return
    port = int(port_raw)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path not in ("/", "/health", "/healthz"):
                payload = b'{"error":"not_found"}'
                self.send_response(404)
            else:
                body = dict(HEALTH)
                body["storage"] = s3_config_summary()
                payload = json.dumps(body).encode("utf-8")
                code = 200 if body.get("status") == "ok" else 503
                self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, fmt: str, *args: Any) -> None:
            return

    server = HTTPServer(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=server.serve_forever, name="health", daemon=True)
    thread.start()
    log(f"health listening on 0.0.0.0:{port}")


def s3_config_summary() -> dict[str, Any]:
    return {
        "bucket": S3_BUCKET,
        "endpoint": S3_ENDPOINT,
        "region": S3_REGION,
        "forcePathStyle": S3_FORCE_PATH_STYLE,
        "usingDefaultMinioCreds": _DEFAULT_MINIO_CREDS,
        "isR2": _IS_R2,
    }


def assert_s3_configured() -> None:
    if _DEFAULT_MINIO_CREDS and (os.environ.get("RAILWAY_ENVIRONMENT") or _IS_R2):
        raise RuntimeError(
            "Worker S3 credentials are still the MinIO defaults (minio/minio12345). "
            "Copy the same S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / "
            "S3_SECRET_ACCESS_KEY / S3_REGION=auto from the API service onto the worker, "
            "then redeploy."
        )


def s3_client():
    assert_s3_configured()
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY_ID,
        aws_secret_access_key=S3_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "virtual"},
        ),
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
    job_type = (job.get("type") or "generate").lower()
    if job_type == "print":
        process_print_job(job)
    else:
        process_generate_job(job)


def process_print_job(job: dict[str, Any]) -> None:
    """Re-run pipeline with write_print=True and upload printKey for giclée POD."""
    rendition_id = job["renditionId"]
    s3_key = job["s3Key"]
    seed = int(job.get("seed") or 0)
    style_params = job.get("styleParams") or {}

    s3 = s3_client()
    conn = db_connect()
    try:
        # Skip if already present
        with conn.cursor() as cur:
            cur.execute('SELECT "printKey" FROM "Rendition" WHERE id = %s', (rendition_id,))
            row = cur.fetchone()
            if row and row[0]:
                log(f"{rendition_id}: printKey already set — skip")
                return

        with tempfile.TemporaryDirectory(prefix="gyotaku-print-") as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "input.bin"
            out_dir = tmp_path / "out"
            out_dir.mkdir()

            log(f"{rendition_id}: print download s3://{S3_BUCKET}/{s3_key}")
            s3.download_file(S3_BUCKET, s3_key, str(src))
            ext = Path(s3_key).suffix.lower() or ".jpg"
            image_path = tmp_path / f"input{ext}"
            src.rename(image_path)

            params = resolve_params(
                overrides=style_params if isinstance(style_params, dict) else {}
            )
            # Print raster must be clean (no watermark)
            params = StyleParams.from_dict({**params.to_dict(), "watermark": False})

            result = generate(
                image_path,
                out_dir,
                params=params,
                seed=seed,
                write_print=True,
                progress=lambda stage, detail="": log(f"{rendition_id}: print [{stage}] {detail}"),
            )
            if result.rejected or not result.print_path or not result.print_path.exists():
                log(f"{rendition_id}: print generation failed / rejected")
                return

            print_key = f"renditions/{rendition_id}/print.png"
            s3.upload_file(
                str(result.print_path),
                S3_BUCKET,
                print_key,
                ExtraArgs={"ContentType": "image/png"},
            )
            update_rendition(conn, rendition_id, {"printKey": print_key})
            log(f"{rendition_id}: printKey ready")
    except Exception as e:
        log(f"{rendition_id}: print FAILED {e}")
        traceback.print_exc()
    finally:
        conn.close()


def process_generate_job(job: dict[str, Any]) -> None:
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
            preview_clean_key = f"renditions/{rendition_id}/preview_clean.png"
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
            if result.preview_clean_path and result.preview_clean_path.exists():
                s3.upload_file(
                    str(result.preview_clean_path),
                    S3_BUCKET,
                    preview_clean_key,
                    ExtraArgs={"ContentType": "image/png"},
                )
            else:
                preview_clean_key = None

            update_rendition(
                conn,
                rendition_id,
                {
                    "status": "READY",
                    "stage": "done",
                    "matteScore": result.matte_score,
                    "svgKey": svg_key,
                    "previewKey": preview_key,
                    "previewCleanKey": preview_clean_key,
                    "estPlotSeconds": result.est_plot_seconds,
                    "paperWidthMm": result.paper_width_mm or None,
                    "paperHeightMm": result.paper_height_mm or None,
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
    start_health_server()

    require_or_wait(
        "DATABASE_URL",
        DATABASE_URL.strip() or None,
        "Worker Variables → Add Reference → Postgres → DATABASE_URL, then redeploy.",
    )
    redis_url = require_or_wait("REDIS_URL", peek_redis_url(), REDIS_SETUP_HINT)

    # Avoid logging passwords
    safe_redis = redis_url
    try:
        p = urlparse(redis_url)
        if p.password:
            safe_redis = redis_url.replace(p.password, "***")
    except Exception:
        pass

    log(
        f"starting; redis={safe_redis} queue={QUEUE_KEY} "
        f"s3={S3_ENDPOINT} bucket={S3_BUCKET} region={S3_REGION}"
    )
    try:
        parsed = urlparse(DATABASE_URL)
        log(f"database host={parsed.hostname}")
    except Exception:
        pass

    try:
        assert_s3_configured()
    except RuntimeError as e:
        HEALTH.update(
            {
                "status": "misconfigured",
                "message": str(e),
                "missing": ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
                "hint": str(e),
                "storage": s3_config_summary(),
            }
        )
        log(str(e))
        while True:
            time.sleep(60)

    HEALTH.update({"status": "connecting", "message": "connecting to redis", "missing": []})
    r = connect_redis(redis_url)
    HEALTH.update(
        {
            "status": "ok",
            "message": "Queue worker is up. Use the web service URL for the app UI.",
            "missing": [],
            "hint": None,
            "storage": s3_config_summary(),
        }
    )
    log("redis ok; waiting for jobs")

    while True:
        try:
            item = r.blpop(QUEUE_KEY, timeout=5)
            if not item:
                continue
            _, raw = item
            job = json.loads(raw)
            log(
                f"job received type={job.get('type') or 'generate'} "
                f"renditionId={job.get('renditionId')}"
            )
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
