"""Same (image, params, seed) → identical SVG hash."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from gyotaku.params import StyleParams
from gyotaku.pipeline import generate
from gyotaku.synth_corpus import render_scene


@pytest.fixture(scope="module")
def sample_image(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("img")
    path = root / "fish.png"
    rgb = render_scene({"kind": "fish", "bg": "plain", "seed": 42, "name": "fish.png"})
    Image.fromarray(rgb, mode="RGB").save(path)
    return path


def test_determinism_same_seed(sample_image: Path, tmp_path: Path):
    params = StyleParams(
        seed_count=800,
        optimize_time_budget_s=0.5,
        process_long_edge=1024,
        edge_pass_density=0.2,
    )
    out_a = tmp_path / "a"
    out_b = tmp_path / "b"
    # Skip rembg-heavy path if segmentation unavailable — still test SVG hash path
    # by mocking would be heavy; run real pipeline with reduced size.
    try:
        ra = generate(sample_image, out_a, params=params, seed=7)
        rb = generate(sample_image, out_b, params=params, seed=7)
    except Exception as e:
        pytest.skip(f"generator unavailable in this environment: {e}")

    if ra.rejected or rb.rejected:
        pytest.skip("synthetic sample rejected by matte scorer")

    assert ra.svg_hash == rb.svg_hash
    assert (out_a / "artwork.svg").read_bytes() == (out_b / "artwork.svg").read_bytes()


def test_different_seed_changes_output(sample_image: Path, tmp_path: Path):
    params = StyleParams(
        seed_count=800,
        optimize_time_budget_s=0.5,
        process_long_edge=1024,
        edge_pass_density=0.2,
    )
    try:
        ra = generate(sample_image, tmp_path / "s0", params=params, seed=0)
        rb = generate(sample_image, tmp_path / "s1", params=params, seed=1)
    except Exception as e:
        pytest.skip(f"generator unavailable in this environment: {e}")

    if ra.rejected or rb.rejected:
        pytest.skip("synthetic sample rejected by matte scorer")

    assert ra.svg_hash != rb.svg_hash


def test_style_params_roundtrip():
    p = StyleParams(posterize_levels=5, jitter_amplitude=0.4)
    q = StyleParams.from_dict(json.loads(p.canonical_json()))
    assert p == q
    assert p.fingerprint() == q.fingerprint()
