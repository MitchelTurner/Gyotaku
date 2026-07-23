"""Salmon-specific matte heuristics and species/side density nudges.

Designed to cut false rejects on real catch photos: elongated silhouettes
with fin protrusions that look "fragmented" to a generic blob scorer.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

import cv2
import numpy as np

SpeciesTag = Literal["chinook", "coho", "sockeye", "other"]
SideTag = Literal["left", "right", "unknown"]

VALID_SPECIES = frozenset({"chinook", "coho", "sockeye", "other"})
VALID_SIDES = frozenset({"left", "right", "unknown"})


def _primary_contour(alpha: np.ndarray) -> np.ndarray | None:
    binary = (alpha > 0.5).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)


def silhouette_aspect(alpha: np.ndarray) -> float:
    """Long/short bbox edge ratio of the primary subject (1 = square)."""
    ys, xs = np.where(alpha > 0.4)
    if len(xs) < 20:
        return 1.0
    bw = float(xs.max() - xs.min() + 1)
    bh = float(ys.max() - ys.min() + 1)
    short = max(1.0, min(bw, bh))
    long = max(bw, bh)
    return long / short


def fin_protrusion_score(alpha: np.ndarray) -> float:
    """
    Score fin-like convexity defects on the primary contour.

    Fish silhouettes have several deep defects (dorsal, pelvic, caudal fork).
    Round blobs score near 0; salmon-like shapes score higher.
    """
    contour = _primary_contour(alpha)
    if contour is None or len(contour) < 40:
        return 0.0

    hull = cv2.convexHull(contour, returnPoints=False)
    if hull is None or len(hull) < 3:
        return 0.0
    # convexityDefects requires clockwise hull indices
    hull = np.array(sorted(int(i) for i in hull.flatten()), dtype=np.int32).reshape(-1, 1)
    try:
        defects = cv2.convexityDefects(contour, hull)
    except cv2.error:
        return 0.0
    if defects is None or len(defects) == 0:
        return 0.0

    peri = float(cv2.arcLength(contour, True)) + 1e-6
    # OpenCV returns Nx1x4 (start, end, farthest, depth×256)
    arr = np.asarray(defects)
    if arr.ndim == 3:
        depths = arr[:, 0, 3].astype(np.float64) / 256.0
    elif arr.ndim == 2 and arr.shape[1] >= 4:
        depths = arr[:, 3].astype(np.float64) / 256.0
    else:
        return 0.0
    # Meaningful fins are a few % of perimeter deep
    significant = depths[depths > peri * 0.012]
    if len(significant) == 0:
        return 0.0

    # Reward 2–6 fin-like defects; more than that looks noisy
    count = float(len(significant))
    count_term = float(np.clip(count / 4.0, 0.0, 1.0))
    if count > 8:
        count_term *= max(0.3, 1.0 - (count - 8) * 0.1)

    depth_term = float(np.clip(float(np.mean(significant)) / (peri * 0.06), 0.0, 1.0))
    return float(np.clip(0.55 * count_term + 0.45 * depth_term, 0.0, 1.0))


def fish_likeness(alpha: np.ndarray) -> float:
    """Combined 0–1 score: elongated + fin protrusions."""
    aspect = silhouette_aspect(alpha)
    # Salmon side views typically ~2.2–4.5; held/angled still ~1.6+
    if aspect < 1.35:
        aspect_score = 0.0
    elif aspect < 1.8:
        aspect_score = (aspect - 1.35) / 0.45 * 0.55
    elif aspect <= 5.0:
        aspect_score = 0.55 + 0.45 * min(1.0, (aspect - 1.8) / 1.4)
    else:
        # Extremely long thin strips can be nets/ropes — soft falloff
        aspect_score = max(0.2, 1.0 - (aspect - 5.0) * 0.15)

    fins = fin_protrusion_score(alpha)
    return float(np.clip(0.55 * aspect_score + 0.45 * fins, 0.0, 1.0))


def salmon_matte_bonus(alpha: np.ndarray) -> float:
    """
    Extra confidence for fish-like mattes that generic scoring underrates.

    Applied additively in score_matte. Cap keeps busy backgrounds from passing
    solely on a vaguely elongated blob.
    """
    likeness = fish_likeness(alpha)
    if likeness < 0.35:
        return 0.0
    # Up to +0.14 for clear salmon silhouettes
    return float(0.14 * ((likeness - 0.35) / 0.65))


def normalize_species(raw: Any) -> Optional[SpeciesTag]:
    if raw is None or raw == "":
        return None
    s = str(raw).strip().lower()
    if s in VALID_SPECIES:
        return s  # type: ignore[return-value]
    return None


def normalize_side(raw: Any) -> Optional[SideTag]:
    if raw is None or raw == "":
        return None
    s = str(raw).strip().lower()
    if s in VALID_SIDES:
        return s  # type: ignore[return-value]
    return None


def species_density_overrides(species: Optional[str]) -> dict[str, Any]:
    """Mild mark-density nudges by species (chinook denser, coho softer)."""
    tag = normalize_species(species)
    if tag == "chinook":
        return {
            "seed_count": 6200,
            "min_separation_light": 3.2,
            "min_separation_dark": 1.05,
            "posterize_levels": 6,
            "density_gamma": 1.6,
            "orientation_sigma": 2.2,
            "edge_pass_density": 0.6,
            "max_stroke_length_px": 50.0,
        }
    if tag == "coho":
        return {
            "seed_count": 4800,
            "min_separation_light": 3.8,
            "min_separation_dark": 1.2,
            "posterize_levels": 5,
            "edge_pass_density": 0.5,
            "density_gamma": 1.45,
            "orientation_sigma": 2.5,
            "max_stroke_length_px": 55.0,
        }
    if tag == "sockeye":
        return {
            "seed_count": 5600,
            "min_separation_light": 3.4,
            "min_separation_dark": 1.1,
            "posterize_levels": 5,
            "density_gamma": 1.55,
            "edge_pass_density": 0.58,
            "orientation_sigma": 2.3,
            "max_stroke_length_px": 52.0,
        }
    return {}


def side_density_overrides(side: Optional[str]) -> dict[str, Any]:
    """
    Side tags mainly document presentation; right-side fish get a slightly
    denser edge pass so reverse-facing silhouettes keep comparable weight.
    """
    tag = normalize_side(side)
    if tag == "right":
        return {"edge_pass_density": 0.32, "flip_horizontal": True}
    if tag == "left":
        return {"flip_horizontal": False}
    return {}
