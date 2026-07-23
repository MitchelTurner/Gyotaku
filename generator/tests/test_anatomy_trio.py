"""Operculum, fin rays, and body-aligned orientation."""

from __future__ import annotations

import numpy as np

from gyotaku.marks.anatomy import (
    blend_orientation_fields,
    body_axis_orientation,
    build_fish_frame,
    fin_ray_paths,
    operculum_jaw_paths,
)
from gyotaku.marks.detail import build_detail_paths
from gyotaku.params import StyleParams
from gyotaku.tonal import VectorField


def _synthetic_fish_with_fins(
    h: int = 240, w: int = 480
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w * 0.48, h * 0.5
    rx, ry = w * 0.36, h * 0.28
    body = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) <= 1.0
    # Dorsal fin protrusion
    dorsal = (xx > cx - rx * 0.1) & (xx < cx + rx * 0.25) & (yy < cy - ry * 0.7) & (
        yy > cy - ry * 1.35
    )
    # Caudal fin (tail) on the right
    tail = (xx > cx + rx * 0.85) & (xx < cx + rx * 1.25) & (
        np.abs(yy - cy) < ry * (1.1 - (xx - (cx + rx * 0.85)) / (rx * 0.5))
    )
    matte = (body | dorsal | tail).astype(np.float32)
    lum = np.ones((h, w), dtype=np.float32) * 0.85
    lum = np.where(matte > 0, 0.4 + 0.35 * ((yy - cy) / (ry + 1e-6) * 0.5 + 0.5), lum)
    # Eye on the left (head)
    eye = (xx - (cx - rx * 0.55)) ** 2 + (yy - cy) ** 2 <= (min(h, w) * 0.035) ** 2
    lum = np.where(eye & (matte > 0), 0.08, lum)
    import cv2

    u8 = np.clip(lum * 255, 0, 255).astype(np.uint8)
    edges = cv2.Canny(u8, 40, 120)
    edges = np.where(matte > 0.2, edges, 0).astype(np.uint8)
    return lum, edges, matte


def test_fish_frame_finds_head_from_eye():
    lum, _, matte = _synthetic_fish_with_fins()
    frame = build_fish_frame(matte, lum)
    assert frame is not None
    assert frame.horizontal
    assert frame.eye is not None
    assert frame.head_is_low  # eye on left


def test_operculum_and_jaw_emit_detail():
    lum, _, matte = _synthetic_fish_with_fins()
    params = StyleParams(detail_operculum_enabled=True)
    paths = operculum_jaw_paths(lum, matte, params)
    assert len(paths) >= 1
    assert all(p.kind == "detail" for p in paths)
    # Gill arc should be a meaningful curve
    assert max(len(p.points) for p in paths) >= 6


def test_fin_rays_from_protrusions():
    lum, _, matte = _synthetic_fish_with_fins()
    params = StyleParams(detail_fin_rays_enabled=True, detail_fin_ray_count=5)
    paths = fin_ray_paths(matte, params, luminance=lum)
    assert len(paths) >= 3
    assert all(p.kind == "detail" and len(p.points) >= 2 for p in paths)


def test_body_axis_blend_changes_field():
    lum, _, matte = _synthetic_fish_with_fins()
    frame = build_fish_frame(matte, lum)
    assert frame is not None
    body = body_axis_orientation(matte, frame)
    # Fake swirl field (mostly vertical)
    h, w = matte.shape
    swirl = VectorField(
        dx=np.zeros((h, w), dtype=np.float32),
        dy=np.ones((h, w), dtype=np.float32),
    )
    blended = blend_orientation_fields(swirl, body, 0.8, matte)
    # Inside body, should lean horizontal (fish long axis)
    ys, xs = np.where(matte > 0.5)
    i = len(xs) // 2
    assert abs(float(blended.dx[ys[i], xs[i]])) > abs(float(blended.dy[ys[i], xs[i]]))


def test_build_detail_includes_trio():
    lum, edges, matte = _synthetic_fish_with_fins()
    params = StyleParams(
        detail_operculum_enabled=True,
        detail_fin_rays_enabled=True,
        detail_contour_enabled=False,
    )
    paths = build_detail_paths(luminance=lum, edges=edges, matte=matte, params=params)
    assert len(paths) >= 5
