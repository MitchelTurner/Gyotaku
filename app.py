"""Minimal Railway health endpoint for Phase 0.

Phase 0 is an offline CLI generator — there is no product API yet.
This process only keeps the Railway service alive with a health check
until Phase 1 (NestJS + worker) lands.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


PORT = int(os.environ.get("PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/health", "/healthz"):
            body = {
                "status": "ok",
                "phase": 0,
                "service": "gyotaku",
                "message": "Phase 0 placeholder — generator is CLI-only; product API comes in Phase 1.",
            }
            payload = json.dumps(body).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        payload = b'{"error":"not_found"}'
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args) -> None:
        # Keep Railway logs readable
        print(f"[health] {args[0]}")


if __name__ == "__main__":
    print(f"gyotaku phase-0 placeholder listening on 0.0.0.0:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
