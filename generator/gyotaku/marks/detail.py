"""Photo-faithful detail passes — silhouette, edges, ridges, eye.

Flowfield follows a smoothed orientation field and reads as swirls.
These passes trace *real* image structure so the drawing still looks like the catch.

Note: iso-luminance form contours are optional and off by default — they tend to
reintroduce the same swirl / topo-map look we are trying to escape.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from gyotaku.marks.base import Path
from gyotaku.params import StyleParams


def _polyline_length(pts: np.ndarray) -> float:
    if len(pts) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def _thinness(pts: np.ndarray, area: float) -> float:
    """High for stroke-like contours, low for filled blobs."""
    length = _polyline_length(pts)
    if area < 1.0:
        return length
    return (length * length) / area


def _canny_undilated(luminance: np.ndarray, matte: np.ndarray, params: StyleParams) -> np.ndarray:
    """Fresh thin Canny — tonal.edges is dilated for fill sampling and is too fat here."""
    u8 = np.clip(luminance * 255.0, 0, 255).astype(np.uint8)
    blur = cv2.GaussianBlur(u8, (0, 0), 1.2)
    sharp = cv2.addWeighted(u8, 1.45, blur, -0.45, 0)
    e1 = cv2.Canny(sharp, int(params.edge_low), int(params.edge_high))
    e2 = cv2.Canny(cv2.GaussianBlur(u8, (0, 0), 0.7), max(20, int(params.edge_low) - 12), int(params.edge_high))
    edges = cv2.bitwise_or(e1, e2)
    mask = (matte > 0.3).astype(np.uint8) * 255
    edges = cv2.bitwise_and(edges, mask)
    # Bridge 1px gaps without fattening into blobs
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8), iterations=1)
    return edges


def _contour_polylines(
    binary: np.ndarray,
    *,
    min_length_px: float,
    min_points: int,
    stride: int,
    max_paths: int,
    min_thinness: float = 35.0,
) -> list[np.ndarray]:
    """Extract stroke-like polylines from a thin binary edge/ridge map."""
    if np.count_nonzero(binary) < 20:
        return []
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out: list[np.ndarray] = []
    stride_i = max(1, int(stride))
    min_pts = max(4, int(min_points))

    for cnt in contours:
        if len(cnt) < min_pts:
            continue
        pts = cnt[:, 0, :].astype(np.float32)
        length = _polyline_length(pts)
        if length < min_length_px:
            continue
        area = float(cv2.contourArea(cnt))
        if _thinness(pts, area) < min_thinness and length < min_length_px * 3:
            continue
        # Thin edge contours often go forth-and-back; keep the longer half
        if len(pts) >= 12 and area < length * 0.85:
            mid = len(pts) // 2
            a, b = pts[: mid + 1], pts[mid:]
            pts = a if _polyline_length(a) >= _polyline_length(b) else b
            if len(pts) < 3:
                continue
        simplified = pts[::stride_i]
        if len(simplified) < 2:
            continue
        if not np.allclose(simplified[-1], pts[-1], atol=1.0):
            simplified = np.vstack([simplified, pts[-1:]])
        out.append(simplified.astype(np.float32))

    if max_paths and len(out) > max_paths:
        out.sort(key=_polyline_length, reverse=True)
        out = out[:max_paths]
    return out


def matte_silhouette_polylines(matte: np.ndarray, params: StyleParams) -> list[Path]:
    """Outer fish outline from the matte — the strongest 'this is a fish' cue."""
    if not params.detail_silhouette_enabled:
        return []
    mask = (matte > 0.45).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []
    cnt = max(contours, key=cv2.contourArea)
    pts = cnt[:, 0, :].astype(np.float32)
    if len(pts) < 20:
        return []
    stride = max(1, int(params.detail_silhouette_stride))
    simplified = pts[::stride]
    if len(simplified) < 3:
        return []
    if not np.allclose(simplified[0], simplified[-1], atol=1.5):
        simplified = np.vstack([simplified, simplified[0:1]])

    paths = [Path(points=simplified.astype(np.float32), kind="detail")]

    if params.detail_silhouette_double:
        eroded = cv2.erode(mask, np.ones((5, 5), np.uint8), iterations=1)
        inner, _ = cv2.findContours(eroded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if inner:
            ic = max(inner, key=cv2.contourArea)
            ipts = ic[:, 0, :].astype(np.float32)
            if len(ipts) >= 20:
                isimp = ipts[:: max(1, stride + 1)]
                if len(isimp) >= 3:
                    if not np.allclose(isimp[0], isimp[-1], atol=1.5):
                        isimp = np.vstack([isimp, isimp[0:1]])
                    paths.append(Path(points=isimp.astype(np.float32), kind="detail"))
    return paths


def feature_edge_polylines(
    edges: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
    *,
    luminance: np.ndarray | None = None,
) -> list[Path]:
    """Trace thin Canny edges as polylines (fins, gill, eye, mouth)."""
    if not params.detail_edge_enabled:
        return []

    if luminance is not None:
        binary = _canny_undilated(luminance, matte, params)
    else:
        # Fall back: erode dilated edge map toward a thin stroke
        mask = ((edges > 0) & (matte > 0.3)).astype(np.uint8) * 255
        binary = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)
        if np.count_nonzero(binary) < 40:
            binary = mask

    polylines = _contour_polylines(
        binary,
        min_length_px=params.detail_edge_min_length_px,
        min_points=params.detail_edge_min_points,
        stride=params.detail_edge_stride,
        max_paths=params.detail_edge_max_paths,
        min_thinness=30.0,
    )
    return [Path(points=p, kind="detail") for p in polylines]


def dark_ridge_polylines(
    luminance: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
) -> list[Path]:
    """Trace dark valleys (gill, lateral line, jaw, fin bases)."""
    if not params.detail_ridge_enabled:
        return []

    subject = matte > 0.35
    inv = (1.0 - np.clip(luminance, 0.0, 1.0)) * subject.astype(np.float32)
    u8 = np.clip(inv * 255.0, 0, 255).astype(np.uint8)
    # Multi-scale black-hat for gill / lateral line width variation
    parts = []
    for ksz in (5, 9, 13):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz))
        parts.append(cv2.morphologyEx(u8, cv2.MORPH_BLACKHAT, kernel))
    blackhat = np.maximum.reduce(parts)
    thr_val = max(12, int(np.percentile(blackhat[subject], 88)))
    _, thr = cv2.threshold(blackhat, thr_val, 255, cv2.THRESH_BINARY)
    thr = cv2.bitwise_and(thr, subject.astype(np.uint8) * 255)
    thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # Thin for contour extraction
    thr = cv2.erode(thr, np.ones((2, 2), np.uint8), iterations=1)

    polylines = _contour_polylines(
        thr,
        min_length_px=params.detail_ridge_min_length_px,
        min_points=8,
        stride=params.detail_ridge_stride,
        max_paths=params.detail_ridge_max_paths,
        min_thinness=25.0,
    )
    return [Path(points=p, kind="detail") for p in polylines]


def eye_mark_paths(
    luminance: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
) -> list[Path]:
    """Detect a dark compact eye blob and stroke a small ring + pupil tick."""
    if not params.detail_eye_enabled:
        return []

    subject = matte > 0.4
    if np.count_nonzero(subject) < 200:
        return []

    ys, xs = np.where(subject)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)

    # Fish may face either way — search both end thirds and keep the best eye
    zones: list[np.ndarray] = []
    if bw >= bh:
        left = subject.copy()
        left[:, x0 + int(bw * 0.38) :] = False
        right = subject.copy()
        right[:, : x0 + int(bw * 0.62)] = False
        zones.extend([left, right])
    else:
        top = subject.copy()
        top[y0 + int(bh * 0.38) :, :] = False
        bot = subject.copy()
        bot[: y0 + int(bh * 0.62), :] = False
        zones.extend([top, bot])

    dark_full = (1.0 - np.clip(luminance, 0.0, 1.0)) * subject.astype(np.float32)
    best = None
    best_score = -1.0
    min_r = max(2.5, 0.014 * max(bw, bh))
    max_r = max(min_r + 1.0, 0.06 * max(bw, bh))

    for head in zones:
        if np.count_nonzero(head) < 50:
            continue
        dark = dark_full * head.astype(np.float32)
        u8 = np.clip(dark * 255.0, 0, 255).astype(np.uint8)
        blur = cv2.GaussianBlur(u8, (0, 0), 1.2)
        thr_val = max(40, int(np.percentile(blur[head], 93)))
        _, thr = cv2.threshold(blur, thr_val, 255, cv2.THRESH_BINARY)
        thr = cv2.bitwise_and(thr, head.astype(np.uint8) * 255)
        thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

        n, labels, stats, centroids = cv2.connectedComponentsWithStats(thr, connectivity=8)
        if n <= 1:
            continue
        for i in range(1, n):
            area = float(stats[i, cv2.CC_STAT_AREA])
            ww = float(stats[i, cv2.CC_STAT_WIDTH])
            hh = float(stats[i, cv2.CC_STAT_HEIGHT])
            if area < 8 or area > math.pi * (max_r**2) * 2.0:
                continue
            r = 0.5 * math.sqrt(ww * ww + hh * hh)
            if r < min_r or r > max_r:
                continue
            roundness = min(ww, hh) / max(ww, hh)
            mean_dark = float(dark[labels == i].mean()) if area > 0 else 0.0
            score = mean_dark * (0.55 + 0.45 * roundness) * math.log1p(area)
            if score > best_score:
                best_score = score
                cx, cy = float(centroids[i, 0]), float(centroids[i, 1])
                best = (cx, cy, max(min_r, min(max_r, r * 0.9)))

    if best is None:
        return []

    cx, cy, r = best
    nseg = max(18, int(2 * math.pi * r / max(1.0, params.detail_eye_stride)))
    angles = np.linspace(0, 2 * math.pi, nseg, endpoint=True)
    ring = np.stack([cx + r * np.cos(angles), cy + r * np.sin(angles)], axis=1).astype(
        np.float32
    )
    s = max(1.5, r * 0.4)
    cross_h = np.asarray([[cx - s, cy], [cx + s, cy]], dtype=np.float32)
    cross_v = np.asarray([[cx, cy - s], [cx, cy + s]], dtype=np.float32)
    return [
        Path(points=ring, kind="detail"),
        Path(points=cross_h, kind="detail"),
        Path(points=cross_v, kind="detail"),
    ]


def luminance_form_contours(
    luminance: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
) -> list[Path]:
    """Iso-luminance contours — optional; often reads as topo swirls."""
    if not params.detail_contour_enabled:
        return []

    levels = max(3, min(6, int(params.posterize_levels)))
    blend = float(params.detail_contour_blend)
    if blend <= 0:
        return []

    blur = cv2.GaussianBlur(luminance.astype(np.float32), (0, 0), 1.1)
    inv = 1.0 - np.clip(blur, 0.0, 1.0)
    subject = matte > 0.35
    paths: list[Path] = []
    stride = max(1, int(params.detail_contour_stride))

    for band in range(levels):
        if band >= levels - 1:
            continue
        lo = band / levels
        hi = (band + 1) / levels
        mask = ((inv >= lo) & (inv < hi) & subject).astype(np.uint8) * 255
        if np.count_nonzero(mask) < 80:
            continue
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for cnt in contours:
            if len(cnt) < 16:
                continue
            pts = cnt[:, 0, :].astype(np.float32)
            length = _polyline_length(pts)
            if length < params.detail_contour_min_length_px:
                continue
            keep_every = max(1, int(round(1.0 / max(0.15, blend))))
            area = float(cv2.contourArea(cnt))
            if int(area) % keep_every != 0 and blend < 0.99 and length < 200:
                continue
            simplified = pts[::stride]
            if len(simplified) >= 3:
                paths.append(Path(points=simplified.astype(np.float32), kind="detail"))

    max_paths = max(0, int(params.detail_contour_max_paths))
    if max_paths and len(paths) > max_paths:
        paths.sort(key=lambda p: _polyline_length(p.points), reverse=True)
        paths = paths[:max_paths]
    return paths


def build_detail_paths(
    *,
    luminance: np.ndarray,
    edges: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
) -> list[Path]:
    """Silhouette + eye + photo edges + dark ridges (+ optional form contours)."""
    paths: list[Path] = []
    paths.extend(matte_silhouette_polylines(matte, params))
    paths.extend(eye_mark_paths(luminance, matte, params))
    paths.extend(
        feature_edge_polylines(edges, matte, params, luminance=luminance)
    )
    paths.extend(dark_ridge_polylines(luminance, matte, params))
    paths.extend(luminance_form_contours(luminance, matte, params))
    return paths
