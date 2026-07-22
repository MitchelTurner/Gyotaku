"""Subject isolation via rembg (U²-Net) with matte confidence scoring."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from gyotaku.params import StyleParams
from gyotaku.salmon import fish_likeness, salmon_matte_bonus


@dataclass
class SegmentationResult:
    matte: np.ndarray  # HxW float32 in [0, 1], feathered
    matte_score: float
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1 inclusive-exclusive
    rgb_cutout: np.ndarray  # HxWx3 uint8 subject on white


class SegmentationRejected(Exception):
    """Soft failure: matte quality too low to generate."""

    def __init__(self, score: float, reason: str):
        self.score = score
        self.reason = reason
        super().__init__(reason)


_session = None


def _get_rembg_session():
    global _session
    if _session is None:
        from rembg import new_session

        # u2net is the rembg default; good on pets/fish
        _session = new_session("u2net")
    return _session


def remove_background(rgb: np.ndarray) -> np.ndarray:
    """Return RGBA uint8 with alpha matte from rembg."""
    from rembg import remove

    session = _get_rembg_session()
    pil = Image.fromarray(rgb, mode="RGB")
    out = remove(pil, session=session)
    return np.asarray(out.convert("RGBA"), dtype=np.uint8)


def _edge_coherence(alpha: np.ndarray) -> float:
    """Score how smooth/coherent the matte boundary is (higher = better).

    Uses solidity (area / convex-hull area) rather than isoperimetric
    compactness so elongated subjects (fish, dogs) are not penalized.
    """
    a = (alpha * 255).astype(np.uint8)
    edges = cv2.Canny(a, 50, 150)
    edge_count = int(np.count_nonzero(edges))
    if edge_count < 20:
        return 0.0

    contours, _ = cv2.findContours(a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return 0.0
    main = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(main))
    if area < 1e-3:
        return 0.0

    hull = cv2.convexHull(main)
    hull_area = float(cv2.contourArea(hull))
    solidity = min(1.0, area / (hull_area + 1e-6))

    # Fish fins lower solidity; remap so typical salmon (~0.75–0.9) still scores well
    x0, y0, bw, bh = cv2.boundingRect(main)
    aspect = max(bw, bh) / float(max(1, min(bw, bh)))
    if aspect >= 1.6 and solidity >= 0.62:
        solidity = min(1.0, solidity + (1.0 - solidity) * 0.45)

    # Smoothness: how well a polygon approx reconstructs the contour
    peri = float(cv2.arcLength(main, True))
    approx = cv2.approxPolyDP(main, 0.01 * peri, True)
    # Fewer vertices relative to perimeter → smoother boundary
    smooth = float(np.clip(1.0 - (len(approx) / max(peri / 8.0, 1.0)), 0.0, 1.0))

    mask = np.zeros_like(a)
    cv2.drawContours(mask, [main], -1, 255, thickness=3)
    overlap = np.count_nonzero((edges > 0) & (mask > 0)) / float(edge_count)

    return float(0.45 * solidity + 0.25 * smooth + 0.30 * overlap)


def score_matte(alpha: np.ndarray, *, salmon_aware: bool = True) -> float:
    """
    Confidence from subject area ratio, edge coherence, and single-subject purity.
    Returns value in roughly [0, 1]. Below threshold → soft reject (do not generate).

    When salmon_aware, elongated silhouettes with fin-like convexity defects get a
    small bonus and lighter purity/solidity penalties (fins look "fragmented" to a
    generic blob scorer).
    """
    h, w = alpha.shape
    total = float(h * w)
    subject = float(np.count_nonzero(alpha > 0.4))
    ratio = subject / total

    # Prefer subjects filling a sensible portion of the frame
    if ratio < 0.02:
        area_score = ratio / 0.02 * 0.25
    elif ratio > 0.92:
        area_score = max(0.0, 1.0 - (ratio - 0.92) / 0.08) * 0.4
    else:
        # Peak around 0.15–0.65
        if ratio < 0.15:
            area_score = 0.5 + 0.5 * (ratio - 0.02) / 0.13
        elif ratio > 0.65:
            area_score = 1.0 - 0.35 * (ratio - 0.65) / 0.27
        else:
            area_score = 1.0

    coherence = _edge_coherence(alpha)
    likeness = fish_likeness(alpha) if salmon_aware else 0.0

    binary = (alpha > 0.5).astype(np.uint8)
    holes = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    hole_frac = float(np.count_nonzero(holes != binary)) / total
    noise_penalty = min(0.35, hole_frac * 8.0)
    # Fins create small morphological "holes" near the outline — ease the penalty
    if likeness > 0.4:
        noise_penalty *= 1.0 - 0.45 * likeness

    # Soft / uncertain alpha band — busy scenes leave lots of partial coverage
    uncertain = float(np.count_nonzero((alpha > 0.15) & (alpha < 0.85))) / total
    uncertain_penalty = min(0.4, uncertain * 6.0)
    if likeness > 0.45:
        # Soft fin edges shouldn't tank a clean catch photo
        uncertain_penalty *= 1.0 - 0.35 * likeness

    # Single primary component should dominate the matte
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    purity_penalty = 0.0
    if n_labels <= 1:
        purity_penalty = 0.5
    else:
        areas = stats[1:, cv2.CC_STAT_AREA]  # skip background
        primary = float(areas.max()) if len(areas) else 0.0
        subject_px = max(subject, 1.0)
        purity = primary / subject_px
        # Many mid-size components → fragmented / busy matte
        mid = int(np.count_nonzero(areas > max(40, primary * 0.05)))
        if purity < 0.75:
            purity_penalty += (0.75 - purity) * 0.8
        if mid > 3:
            purity_penalty += min(0.35, (mid - 3) * 0.08)
        # Detached fin tips / splash droplets are common on salmon mattes
        if likeness > 0.5 and mid <= 6:
            purity_penalty *= 1.0 - 0.5 * likeness

    score = (
        0.45 * area_score
        + 0.55 * coherence
        - noise_penalty
        - uncertain_penalty
        - purity_penalty
    )
    if salmon_aware:
        score += salmon_matte_bonus(alpha)
    return float(np.clip(score, 0.0, 1.0))


def feather_matte(alpha: np.ndarray, feather_px: float) -> np.ndarray:
    if feather_px <= 0:
        return alpha.astype(np.float32)
    # Gaussian blur then re-clamp; small radius softens cut-paste edges
    k = max(3, int(round(feather_px * 2)) * 2 + 1)
    blurred = cv2.GaussianBlur(alpha.astype(np.float32), (k, k), feather_px)
    return np.clip(blurred, 0.0, 1.0)


def subject_bbox(alpha: np.ndarray, threshold: float = 0.25) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        h, w = alpha.shape
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def expand_bbox(
    bbox: tuple[int, int, int, int],
    shape: tuple[int, int],
    margin_ratio: float,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = bbox
    h, w = shape
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    mx = int(round(bw * margin_ratio))
    my = int(round(bh * margin_ratio))
    return (
        max(0, x0 - mx),
        max(0, y0 - my),
        min(w, x1 + mx),
        min(h, y1 + my),
    )


def segment_subject(rgb: np.ndarray, params: StyleParams) -> SegmentationResult:
    rgba = remove_background(rgb)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    score = score_matte(alpha, salmon_aware=params.salmon_matte_enabled)

    if score < params.matte_score_threshold:
        raise SegmentationRejected(
            score=score,
            reason=(
                "Subject separation confidence is too low "
                f"(score={score:.2f}, need ≥ {params.matte_score_threshold:.2f}). "
                "The subject needs to be clearly separated from the background — "
                "try a photo with more contrast behind it."
            ),
        )

    alpha = feather_matte(alpha, params.matte_feather_px)

    # Present right-side fish mirrored so head faces a consistent direction
    working_rgb = rgb
    if params.flip_horizontal:
        alpha = np.ascontiguousarray(np.fliplr(alpha))
        working_rgb = np.ascontiguousarray(np.fliplr(rgb))

    bbox = expand_bbox(subject_bbox(alpha), alpha.shape, params.crop_margin_ratio)

    # Subject on pure white void for downstream tonal work
    cutout = working_rgb.copy()
    white = np.ones_like(cutout) * 255
    a = alpha[..., None]
    cutout = (cutout.astype(np.float32) * a + white.astype(np.float32) * (1.0 - a)).astype(
        np.uint8
    )

    return SegmentationResult(
        matte=alpha,
        matte_score=score,
        bbox=bbox,
        rgb_cutout=cutout,
    )
