"""Photo-faithful detail passes should emit real edge / form polylines."""

from __future__ import annotations

import numpy as np

from gyotaku.ink import apply_ink_physics
from gyotaku.marks.base import Path
from gyotaku.marks.detail import (
    build_detail_paths,
    eye_mark_paths,
    feature_edge_polylines,
    matte_silhouette_polylines,
)
from gyotaku.optimize import simplify_paths
from gyotaku.params import StyleParams


def _synthetic_fish(h: int = 240, w: int = 480) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Ellipse body + dark eye + gill arc — enough structure for edges."""
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w * 0.48, h * 0.5
    rx, ry = w * 0.38, h * 0.32
    body = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) <= 1.0
    matte = body.astype(np.float32)
    lum = np.ones((h, w), dtype=np.float32) * 0.85
    # Darker belly / dorsal gradient
    lum = np.where(body, 0.35 + 0.45 * ((yy - cy) / (ry + 1e-6) * 0.5 + 0.5), lum)
    # Eye
    eye = (xx - (cx - rx * 0.55)) ** 2 + (yy - cy) ** 2 <= (min(h, w) * 0.035) ** 2
    lum = np.where(eye & body, 0.08, lum)
    # Gill-ish dark arc
    gill = (
        ((xx - (cx - rx * 0.25)) ** 2 / (rx * 0.08) ** 2)
        + ((yy - cy) ** 2 / (ry * 0.55) ** 2)
        <= 1.0
    ) & (xx < cx)
    lum = np.where(gill & body, np.minimum(lum, 0.22), lum)
    # Simple Canny-like edge from body rim + eye
    import cv2

    u8 = np.clip(lum * 255, 0, 255).astype(np.uint8)
    edges = cv2.Canny(u8, 40, 120)
    edges = np.where(matte > 0.2, edges, 0).astype(np.uint8)
    return lum, edges, matte


def test_feature_edge_polylines_find_structure():
    lum, edges, matte = _synthetic_fish()
    params = StyleParams(
        detail_edge_enabled=True,
        detail_contour_enabled=False,
        detail_silhouette_enabled=False,
        detail_ridge_enabled=False,
        detail_eye_enabled=False,
    )
    paths = feature_edge_polylines(edges, matte, params)
    assert len(paths) >= 1
    assert all(p.kind == "detail" for p in paths)
    assert all(p.points.ndim == 2 and p.points.shape[1] == 2 for p in paths)


def test_silhouette_and_eye_present():
    lum, edges, matte = _synthetic_fish()
    params = StyleParams()
    sil = matte_silhouette_polylines(matte, params)
    assert len(sil) >= 1
    assert sil[0].kind == "detail"
    # Closed outline
    assert np.allclose(sil[0].points[0], sil[0].points[-1], atol=2.0)
    eyes = eye_mark_paths(lum, matte, params)
    assert len(eyes) >= 1


def test_build_detail_paths_combines_passes():
    lum, edges, matte = _synthetic_fish()
    params = StyleParams(
        detail_edge_enabled=True,
        detail_ridge_enabled=True,
        detail_contour_enabled=False,
        posterize_levels=5,
    )
    paths = build_detail_paths(luminance=lum, edges=edges, matte=matte, params=params)
    assert len(paths) >= 2
    assert all(p.kind == "detail" for p in paths)


def test_detail_can_be_disabled():
    lum, edges, matte = _synthetic_fish()
    params = StyleParams(
        detail_silhouette_enabled=False,
        detail_eye_enabled=False,
        detail_operculum_enabled=False,
        detail_fin_rays_enabled=False,
        detail_edge_enabled=False,
        detail_ridge_enabled=False,
        detail_contour_enabled=False,
    )
    paths = build_detail_paths(luminance=lum, edges=edges, matte=matte, params=params)
    assert paths == []


def test_ink_physics_preserves_detail_kind_and_skips_dropout():
    pts = np.asarray([[10.0, 10.0], [20.0, 10.0], [30.0, 12.0], [40.0, 10.0]], dtype=np.float32)
    paths = [Path(points=pts, kind="detail")]
    h, w = 64, 64
    lum = np.ones((h, w), dtype=np.float32) * 0.9  # bright → low contact
    edges = np.zeros((h, w), dtype=np.uint8)
    matte = np.ones((h, w), dtype=np.float32)
    params = StyleParams(dropout_threshold=0.9, jitter_amplitude=0.0)
    rng = np.random.default_rng(0)
    out = apply_ink_physics(
        paths, luminance=lum, edges=edges, matte=matte, params=params, rng=rng
    )
    assert len(out) == 1
    assert out[0].kind == "detail"
    assert len(out[0].points) == len(pts)


def test_simplify_preserves_kind():
    pts = np.linspace([0, 0], [100, 0], 40).astype(np.float32)
    paths = [Path(points=pts, kind="detail")]
    out = simplify_paths(paths, epsilon_mm=0.5, px_to_mm=0.1)
    assert len(out) == 1
    assert out[0].kind == "detail"
