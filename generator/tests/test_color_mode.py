"""Ink color mode helpers and SVG/raster branching."""

import numpy as np

from gyotaku.color_mode import (
    ink_color_for_path,
    normalize_color_mode,
    rgb_to_hex,
    sample_mean_rgb,
)
from gyotaku.marks.base import Path as StrokePath
from gyotaku.output import compute_layout, paths_to_svg, render_preview_png
from gyotaku.params import StyleParams, resolve_params


def test_normalize_color_mode_aliases():
    assert normalize_color_mode(None) == "black_and_white"
    assert normalize_color_mode("bw") == "black_and_white"
    assert normalize_color_mode("Fish Color") == "fish_color"
    assert normalize_color_mode("vivid") == "vibrant"
    assert normalize_color_mode("nope") == "black_and_white"


def test_resolve_params_clamps_color_mode():
    p = resolve_params(overrides={"color_mode": "VIBRANT"})
    assert p.color_mode == "vibrant"
    p2 = resolve_params(overrides={})
    assert p2.color_mode == "black_and_white"


def test_sample_and_ink_colors_differ_by_mode():
    # Red-orange fish body on white
    rgb = np.ones((40, 80, 3), dtype=np.uint8) * 255
    rgb[10:30, 10:70] = (180, 70, 40)
    path = StrokePath(
        points=np.array([[15.0, 20.0], [40.0, 20.0], [65.0, 22.0]], dtype=np.float32),
        kind="fill",
    )
    sample = sample_mean_rgb(path, rgb)
    assert sample[0] > sample[1]  # reddish

    bw = ink_color_for_path(path, rgb, "black_and_white")
    assert bw == (0, 0, 0)

    fish = ink_color_for_path(path, rgb, "fish_color")
    assert fish != (0, 0, 0)
    assert fish[0] > fish[2]

    vibrant = ink_color_for_path(path, rgb, "vibrant")
    assert vibrant != (0, 0, 0)
    # Vibrant should push saturation — green or blue channel relative shift vs fish
    assert vibrant != fish


def test_rgb_to_hex():
    assert rgb_to_hex((255, 0, 16)) == "#ff0010"


def test_colored_svg_uses_per_path_strokes():
    rgb = np.ones((50, 100, 3), dtype=np.uint8) * 255
    rgb[5:45, 5:95] = (40, 120, 90)
    path = StrokePath(
        points=np.array([[10.0, 25.0], [50.0, 25.0], [90.0, 28.0]], dtype=np.float32),
        kind="fill",
    )
    params = StyleParams(color_mode="fish_color", preview_px=400)
    layout = compute_layout(100, 50, params)
    svg = paths_to_svg(
        [path],
        layout,
        seed=1,
        image_hash="abc",
        style_fingerprint="deadbeef",
        params=params,
        subject_rgb=rgb,
    )
    assert 'data-color-mode="fish_color"' in svg
    assert 'stroke="#' in svg
    assert 'stroke="#000000"' not in svg or "pen-fill" in svg


def test_bw_svg_keeps_group_black():
    path = StrokePath(
        points=np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 5.0]], dtype=np.float32),
    )
    params = StyleParams(color_mode="black_and_white")
    layout = compute_layout(40, 20, params)
    svg = paths_to_svg(
        [path],
        layout,
        seed=0,
        image_hash="x",
        style_fingerprint="y",
        params=params,
        subject_rgb=None,
    )
    assert 'stroke="#000000"' in svg
    assert 'data-color-mode="black_and_white"' in svg


def test_colored_preview_is_not_grayscale():
    rgb = np.ones((60, 120, 3), dtype=np.uint8) * 255
    rgb[10:50, 10:110] = (200, 40, 30)
    path = StrokePath(
        points=np.array(
            [[20.0, 30.0], [40.0, 30.0], [60.0, 32.0], [80.0, 30.0], [100.0, 30.0]],
            dtype=np.float32,
        ),
        kind="fill",
    )
    params = StyleParams(color_mode="vibrant", preview_px=320, paper_texture_strength=0.0)
    layout = compute_layout(120, 60, params)
    preview = render_preview_png(
        [path], layout, params, watermark=False, subject_rgb=rgb
    )
    # Some pixels should carry chroma (not near-equal RGB)
    r = preview[:, :, 0].astype(np.int16)
    g = preview[:, :, 1].astype(np.int16)
    b = preview[:, :, 2].astype(np.int16)
    chroma = np.maximum(np.abs(r - g), np.abs(g - b))
    assert int(chroma.max()) > 12
