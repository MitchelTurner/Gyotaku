"""Salmon matte heuristics, species tags, and corpus gate unit tests."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from gyotaku.corpus_gate import (
    CorpusGateError,
    assert_summary_within_baseline,
    baseline_from_summary,
    compare_summary_to_baseline,
)
from gyotaku.params import StyleParams, resolve_params
from gyotaku.salmon import (
    fin_protrusion_score,
    fish_likeness,
    normalize_species,
    salmon_matte_bonus,
    silhouette_aspect,
    species_density_overrides,
)
from gyotaku.segment import score_matte


def _ellipse_matte(h: int, w: int, rx: float, ry: float) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    matte = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0).astype(np.float32)
    return matte


def _fish_matte(h: int = 180, w: int = 420) -> np.ndarray:
    """Elongated body + simple fin protrusions (no rembg)."""
    matte = _ellipse_matte(h, w, rx=w * 0.42, ry=h * 0.28)
    # dorsal fin triangle
    dorsal = np.array(
        [[int(w * 0.45), int(h * 0.22)], [int(w * 0.55), int(h * 0.05)], [int(w * 0.62), int(h * 0.22)]],
        dtype=np.int32,
    )
    import cv2

    cv2.fillConvexPoly(matte, dorsal, 1.0)
    # caudal fork
    tail = np.array(
        [
            [int(w * 0.82), int(h * 0.50)],
            [int(w * 0.96), int(h * 0.28)],
            [int(w * 0.90), int(h * 0.50)],
            [int(w * 0.96), int(h * 0.72)],
        ],
        dtype=np.int32,
    )
    cv2.fillConvexPoly(matte, tail, 1.0)
    # pelvic fin
    pelvic = np.array(
        [[int(w * 0.40), int(h * 0.72)], [int(w * 0.48), int(h * 0.92)], [int(w * 0.52), int(h * 0.72)]],
        dtype=np.int32,
    )
    cv2.fillConvexPoly(matte, pelvic, 1.0)
    return matte


def test_silhouette_aspect_elongated():
    m = _ellipse_matte(120, 360, rx=150, ry=40)
    assert silhouette_aspect(m) > 2.5


def test_fish_likeness_higher_than_blob():
    fish = _fish_matte()
    blob = _ellipse_matte(200, 200, rx=70, ry=70)
    assert fish_likeness(fish) > fish_likeness(blob) + 0.15
    assert fin_protrusion_score(fish) > fin_protrusion_score(blob)


def test_salmon_bonus_helps_borderline_fish():
    fish = _fish_matte()
    # Add mild fragmentation that used to inflate purity penalty
    fish[20:35, 40:55] = 1.0
    base = score_matte(fish, salmon_aware=False)
    with_salmon = score_matte(fish, salmon_aware=True)
    assert with_salmon >= base
    assert salmon_matte_bonus(fish) > 0.0
    assert with_salmon > 0.40


def test_busy_noise_still_scores_low():
    # Sparse speckles / no coherent subject — should soft-reject
    rng = np.random.default_rng(0)
    speckles = (rng.random((200, 300)) > 0.97).astype(np.float32)
    assert score_matte(speckles, salmon_aware=True) < 0.35
    empty = np.zeros((200, 300), dtype=np.float32)
    assert score_matte(empty, salmon_aware=True) < 0.2


def test_species_density_nudges():
    chinook = resolve_params(overrides={"species": "chinook"})
    coho = resolve_params(overrides={"species": "coho"})
    assert chinook.seed_count > coho.seed_count
    assert chinook.species == "chinook"
    right = resolve_params(overrides={"side": "right"})
    assert right.flip_horizontal is True
    left = resolve_params(overrides={"side": "left"})
    assert left.flip_horizontal is False


def test_explicit_density_override_wins_over_species():
    p = resolve_params(overrides={"species": "chinook", "seed_count": 999})
    assert p.seed_count == 999


def test_corpus_gate_detects_status_drift():
    baseline = {
        "matteAbsTol": 0.08,
        "pathRelTol": 0.25,
        "images": [
            {"image": "a.jpg", "status": "READY", "matteScore": 0.7, "pathCount": 1000},
            {"image": "b.jpg", "status": "REJECTED", "matteScore": 0.2, "pathCount": 0},
        ],
    }
    summary = {
        "results": [
            {"image": "a.jpg", "status": "REJECTED", "matteScore": 0.7, "pathCount": 0},
            {"image": "b.jpg", "status": "REJECTED", "matteScore": 0.2, "pathCount": 0},
        ]
    }
    fails = compare_summary_to_baseline(summary, baseline)
    assert any("a.jpg" in f and "status" in f for f in fails)


def test_corpus_gate_detects_path_drift():
    baseline = baseline_from_summary(
        {
            "seed": 0,
            "results": [
                {"image": "a.jpg", "status": "READY", "matteScore": 0.7, "pathCount": 1000},
            ],
        }
    )
    summary = {
        "results": [
            {"image": "a.jpg", "status": "READY", "matteScore": 0.71, "pathCount": 2000},
        ]
    }
    with pytest.raises(CorpusGateError):
        assert_summary_within_baseline(summary, baseline)


def test_committed_baseline_matches_sources_expect():
    root = Path(__file__).resolve().parents[1]
    sources = json.loads((root / "corpus" / "SOURCES.json").read_text(encoding="utf-8"))
    baseline = json.loads((root / "corpus" / "baseline_metrics.json").read_text(encoding="utf-8"))
    by_name = {e["image"]: e for e in baseline["images"]}
    assert len(by_name) == len(sources)
    for src in sources:
        entry = by_name[src["file"]]
        want = "READY" if src["expect"] == "ok" else "REJECTED"
        assert entry["status"] == want


def test_species_overrides_table_complete():
    for sp in ("chinook", "coho", "sockeye", "pink"):
        assert species_density_overrides(sp)
    assert species_density_overrides("other") == {}
    assert species_density_overrides(None) == {}


def test_species_aliases():
    assert normalize_species("king") == "chinook"
    assert normalize_species("humpy") == "pink"
    assert resolve_params(overrides={"species": "king"}).species == "chinook"
