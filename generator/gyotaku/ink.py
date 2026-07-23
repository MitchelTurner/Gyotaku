"""Ink physics post-process: jitter, dropout, edge accumulation already in marks."""

from __future__ import annotations

import numpy as np

from gyotaku.marks.base import Path
from gyotaku.noise import fbm2d
from gyotaku.params import StyleParams


def _noise_field(
    h: int,
    w: int,
    scale: float,
    rng: np.random.Generator,
    octaves: int = 3,
) -> np.ndarray:
    # Generate at reduced resolution — ink noise is low-frequency by design
    factor = max(1, int(round(scale / 8.0)))
    rh = max(8, h // factor)
    rw = max(8, w // factor)
    ys = np.arange(rh, dtype=np.float64)[:, None] * (h / rh) / scale
    xs = np.arange(rw, dtype=np.float64)[None, :] * (w / rw) / scale
    yy = np.broadcast_to(ys, (rh, rw)).copy()
    xx = np.broadcast_to(xs, (rh, rw)).copy()
    small = fbm2d(xx, yy, rng, octaves=octaves)
    if rh == h and rw == w:
        return small
    import cv2

    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def _sample(field: np.ndarray, x: float, y: float) -> float:
    h, w = field.shape
    if x < 0 or y < 0 or x >= w - 1 or y >= h - 1:
        return 0.0
    x0 = int(x)
    y0 = int(y)
    fx = x - x0
    fy = y - y0
    v00 = field[y0, x0]
    v10 = field[y0, min(x0 + 1, w - 1)]
    v01 = field[min(y0 + 1, h - 1), x0]
    v11 = field[min(y0 + 1, h - 1), min(x0 + 1, w - 1)]
    return float(
        v00 * (1 - fx) * (1 - fy)
        + v10 * fx * (1 - fy)
        + v01 * (1 - fx) * fy
        + v11 * fx * fy
    )


def apply_ink_physics(
    paths: list[Path],
    *,
    luminance: np.ndarray,
    edges: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
    rng: np.random.Generator,
) -> list[Path]:
    if not paths:
        return paths

    h, w = luminance.shape
    # Region amplitude for jitter (low-frequency)
    region = _noise_field(h, w, params.jitter_region_scale, rng, octaves=2)
    region = (region + 1.0) * 0.5  # [0, 1]
    jitter_n = _noise_field(h, w, params.jitter_scale, rng, octaves=3)

    # Contact map: higher near edges / darker areas → better ink transfer
    edge_f = (edges.astype(np.float32) / 255.0)
    contact = (1.0 - luminance) * 0.55 + edge_f * params.contact_edge_boost + 0.25
    contact = np.clip(contact, 0.0, 1.0) * matte
    dropout_n = _noise_field(h, w, params.dropout_scale, rng, octaves=3)
    dropout_n = (dropout_n + 1.0) * 0.5

    out: list[Path] = []
    for path in paths:
        pts = path.points.astype(np.float64).copy()
        if len(pts) < 2:
            continue

        is_detail = getattr(path, "kind", "fill") == "detail"
        # Anatomy strokes must survive ink physics — light jitter only, no dropout
        jitter_amp = params.jitter_amplitude * (0.2 if is_detail else 1.0)

        # --- Jitter: lateral displacement along local normal ---
        if jitter_amp > 0:
            for i in range(len(pts)):
                x, y = pts[i]
                if i == 0:
                    tx, ty = pts[1] - pts[0]
                elif i == len(pts) - 1:
                    tx, ty = pts[i] - pts[i - 1]
                else:
                    tx, ty = pts[i + 1] - pts[i - 1]
                mag = np.hypot(tx, ty)
                if mag < 1e-6:
                    continue
                tx, ty = tx / mag, ty / mag
                nx, ny = -ty, tx
                amp = jitter_amp * (0.35 + 0.65 * _sample(region, x, y))
                disp = amp * _sample(jitter_n, x, y)
                pts[i, 0] += nx * disp
                pts[i, 1] += ny * disp

        # --- Dropout: remove low-contact segment runs ---
        keep = np.ones(len(pts), dtype=bool)
        if (not is_detail) and params.dropout_threshold > 0:
            for i in range(len(pts)):
                x, y = pts[i]
                c = _sample(contact, x, y)
                n = _sample(dropout_n, x, y)
                if c * n < params.dropout_threshold:
                    keep[i] = False

            # Prefer deleting whole runs: expand isolated keep holes inside dropouts
            keep = _expand_dropout_runs(keep)

        segments = _split_by_mask(pts, keep)
        for seg in segments:
            if len(seg) >= 2:
                out.append(Path(points=seg.astype(np.float32), kind=path.kind))

    return out


def _expand_dropout_runs(keep: np.ndarray) -> np.ndarray:
    """If a keep-island is tiny inside a dropout region, drop it too."""
    out = keep.copy()
    n = len(out)
    i = 0
    while i < n:
        if out[i]:
            j = i
            while j < n and out[j]:
                j += 1
            run = j - i
            # Tiny surviving bridges look like noise — remove
            if run <= 2 and (i > 0 or j < n):
                out[i:j] = False
            i = j
        else:
            i += 1
    return out


def _split_by_mask(pts: np.ndarray, keep: np.ndarray) -> list[np.ndarray]:
    segments: list[np.ndarray] = []
    buf: list[np.ndarray] = []
    for p, k in zip(pts, keep):
        if k:
            buf.append(p)
        elif buf:
            segments.append(np.asarray(buf, dtype=np.float64))
            buf = []
    if buf:
        segments.append(np.asarray(buf, dtype=np.float64))
    return segments
