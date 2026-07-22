"""Life-size fish length scales the plot to exact inches."""

from gyotaku.output import compute_layout
from gyotaku.params import INCH_TO_MM, StyleParams


def test_fish_length_sets_exact_long_edge_mm():
    params = StyleParams(fish_length_in=18.0, margin_mm=25.0)
    # Landscape-ish subject: 1800 × 600 px → long edge is width
    layout = compute_layout(1800, 600, params)
    placed_long_mm = 1800 * layout.px_to_mm
    assert abs(placed_long_mm - 18.0 * INCH_TO_MM) < 1e-6
    assert abs(layout.fish_length_in - 18.0) < 1e-9
    assert abs(layout.canvas_w_mm - (18.0 * INCH_TO_MM + 50.0)) < 1e-6
    assert abs(layout.canvas_h_mm - (600 * layout.px_to_mm + 50.0)) < 1e-6


def test_fish_length_uses_vertical_long_edge():
    params = StyleParams(fish_length_in=12.0, margin_mm=20.0)
    layout = compute_layout(400, 1200, params)
    assert abs(1200 * layout.px_to_mm - 12.0 * INCH_TO_MM) < 1e-6


def test_without_fish_length_uses_named_canvas():
    params = StyleParams(canvas="A3", fish_length_in=None)
    layout = compute_layout(1000, 400, params)
    assert layout.canvas_w_mm == 297.0
    assert layout.canvas_h_mm == 420.0
    assert layout.fish_length_in is None
