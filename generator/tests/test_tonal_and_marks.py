"""Unit tests that do not require rembg."""

from __future__ import annotations

import numpy as np

from gyotaku.marks.flowfield import FlowfieldStrategy
from gyotaku.optimize import douglas_peucker, reorder_paths
from gyotaku.params import StyleParams
from gyotaku.segment import feather_matte, score_matte
from gyotaku.tonal import VectorField, posterize, structure_tensor_orientation
from gyotaku.marks.base import Path


def test_score_matte_clean_blob_high():
    matte = np.zeros((200, 300), dtype=np.float32)
    matte[40:160, 60:240] = 1.0
    assert score_matte(matte) > 0.5


def test_score_matte_empty_low():
    matte = np.zeros((200, 300), dtype=np.float32)
    assert score_matte(matte) < 0.2


def test_feather_softens_edge():
    matte = np.zeros((64, 64), dtype=np.float32)
    matte[16:48, 16:48] = 1.0
    soft = feather_matte(matte, 2.0)
    assert soft[16, 16] < 1.0
    assert soft[32, 32] > 0.9


def test_structure_tensor_on_gradient():
    y = np.linspace(0, 1, 64)[:, None]
    x = np.linspace(0, 1, 64)[None, :]
    # Vertical stripes → orientation roughly vertical (along form)
    lum = (np.sin(x * 12) * 0.5 + 0.5).astype(np.float32)
    lum = np.broadcast_to(lum, (64, 64)).copy()
    field = structure_tensor_orientation(lum, sigma=2.0)
    # Dominant orientation should be mostly vertical (along the stripe)
    assert abs(float(np.mean(np.abs(field.dy)))) > abs(float(np.mean(np.abs(field.dx)))) * 0.5


def test_flowfield_produces_paths():
    h, w = 120, 180
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    matte = (dist < 55).astype(np.float32)
    luminance = np.clip(dist / 55.0, 0, 1).astype(np.float32)
    luminance = np.where(matte > 0, luminance * 0.7, 1.0).astype(np.float32)
    # Circular orientation (tangential)
    dx = -(yy - cy)
    dy = xx - cx
    mag = np.sqrt(dx * dx + dy * dy) + 1e-6
    orientation = VectorField(dx=(dx / mag).astype(np.float32), dy=(dy / mag).astype(np.float32))
    edges = ((matte > 0) & (dist > 50)).astype(np.uint8) * 255
    params = StyleParams(seed_count=400, max_stroke_length_px=30, edge_pass_density=0.1)
    rng = np.random.default_rng(0)
    paths = FlowfieldStrategy().generate(
        luminance=luminance,
        orientation=orientation,
        edges=edges,
        matte=matte,
        params=params,
        rng=rng,
    )
    assert len(paths) > 20
    assert all(len(p.points) >= 2 for p in paths)


def test_douglas_peucker_collinear():
    pts = np.array([[0, 0], [1, 0], [2, 0], [3, 0]], dtype=np.float64)
    out = douglas_peucker(pts, 0.1)
    assert len(out) == 2


def test_reorder_deterministic():
    paths = [
        Path(points=np.array([[10, 10], [12, 10]], dtype=np.float32)),
        Path(points=np.array([[0, 0], [1, 0]], dtype=np.float32)),
        Path(points=np.array([[5, 5], [6, 5]], dtype=np.float32)),
    ]
    a = reorder_paths(paths, time_budget_s=1.0)
    b = reorder_paths(paths, time_budget_s=1.0)
    assert len(a) == len(b)
    for p, q in zip(a, b):
        np.testing.assert_array_equal(p.points, q.points)


def test_posterize_levels():
    lum = np.linspace(0, 1, 100, dtype=np.float32).reshape(10, 10)
    matte = np.ones_like(lum)
    bands = posterize(lum, 4, matte)
    assert bands.min() >= 0
    assert bands.max() <= 3
