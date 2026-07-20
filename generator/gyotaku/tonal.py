"""Tonal decomposition: luminance, posterization, orientation field, edges."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from gyotaku.params import StyleParams


@dataclass
class VectorField:
    """Per-pixel unit orientation (ambiguous sign — flow lines are undirected)."""

    dx: np.ndarray  # HxW float32
    dy: np.ndarray  # HxW float32


@dataclass
class TonalMaps:
    luminance: np.ndarray  # HxW float32 in [0, 1], CLAHE-enhanced
    posterized: np.ndarray  # HxW uint8 levels 0..N-1 (0 = darkest)
    orientation: VectorField
    edges: np.ndarray  # HxW uint8 0/255
    matte: np.ndarray  # HxW float32 cropped


def to_luminance(rgb: np.ndarray) -> np.ndarray:
    # Rec. 709
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def apply_clahe(luminance: np.ndarray, clip: float, grid: int) -> np.ndarray:
    u8 = np.clip(luminance * 255.0, 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(grid, grid))
    out = clahe.apply(u8)
    return out.astype(np.float32) / 255.0


def posterize(luminance: np.ndarray, levels: int, matte: np.ndarray) -> np.ndarray:
    """Map subject luminance to discrete bands; outside matte → lightest band."""
    levels = max(3, min(6, levels))
    # Invert so dark → high density index conceptually: store 0 = darkest
    inv = 1.0 - np.clip(luminance, 0.0, 1.0)
    # Only consider subject pixels for level breaks (percentile-ish via linspace)
    bands = np.floor(inv * levels).astype(np.int32)
    bands = np.clip(bands, 0, levels - 1).astype(np.uint8)
    bands = np.where(matte > 0.2, bands, levels - 1).astype(np.uint8)
    return bands


def structure_tensor_orientation(
    luminance: np.ndarray,
    sigma: float,
) -> VectorField:
    """
    Dominant local orientation from the structure tensor.
    Eigenvector of the smaller eigenvalue → coherence direction (stroke along form).
    """
    blur = cv2.GaussianBlur(luminance.astype(np.float32), (0, 0), sigmaX=max(0.5, sigma * 0.5))
    gx = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)

    jxx = gx * gx
    jxy = gx * gy
    jyy = gy * gy

    # Smooth tensor components
    k = max(3, int(round(sigma)) * 2 + 1)
    jxx = cv2.GaussianBlur(jxx, (k, k), sigma)
    jxy = cv2.GaussianBlur(jxy, (k, k), sigma)
    jyy = cv2.GaussianBlur(jyy, (k, k), sigma)

    # Smaller-eigenvalue eigenvector for (Jxx, Jxy; Jxy, Jyy)
    # For 2x2: v = (jxy, lambda_min - jxx) or similar
    trace = jxx + jyy
    det_term = np.sqrt(np.maximum((jxx - jyy) ** 2 + 4.0 * jxy * jxy, 0.0))
    lambda_min = 0.5 * (trace - det_term)

    dx = jxy
    dy = lambda_min - jxx
    # Fallback where gradient is tiny: horizontal
    mag = np.sqrt(dx * dx + dy * dy)
    weak = mag < 1e-8
    dx = np.where(weak, 1.0, dx)
    dy = np.where(weak, 0.0, dy)
    mag = np.sqrt(dx * dx + dy * dy)
    dx = dx / (mag + 1e-12)
    dy = dy / (mag + 1e-12)

    # Extra smooth + renormalize to kill high-frequency flips
    dx = cv2.GaussianBlur(dx.astype(np.float32), (k, k), sigma)
    dy = cv2.GaussianBlur(dy.astype(np.float32), (k, k), sigma)
    mag = np.sqrt(dx * dx + dy * dy)
    dx = dx / (mag + 1e-12)
    dy = dy / (mag + 1e-12)

    # Resolve local sign flips so neighboring vectors are coherent
    dx, dy = _smooth_orientation_sign(dx, dy)

    # Second, wider smooth pass after sign reconciliation — longer, calmer strokes
    k2 = max(k, int(round(sigma * 2)) * 2 + 1)
    dx = cv2.GaussianBlur(dx.astype(np.float32), (k2, k2), sigma * 1.5)
    dy = cv2.GaussianBlur(dy.astype(np.float32), (k2, k2), sigma * 1.5)
    mag = np.sqrt(dx * dx + dy * dy) + 1e-12
    dx, dy = dx / mag, dy / mag

    return VectorField(dx=dx.astype(np.float32), dy=dy.astype(np.float32))


def _smooth_orientation_sign(dx: np.ndarray, dy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Reduce π-ambiguity via a few passes of neighbor-aligned sign flips."""
    out_x = dx.copy()
    out_y = dy.copy()
    for _ in range(4):
        # Average of 4-neighbors (edge-safe via copy shifts)
        rx = (
            np.roll(out_x, 1, axis=1)
            + np.roll(out_x, -1, axis=1)
            + np.roll(out_x, 1, axis=0)
            + np.roll(out_x, -1, axis=0)
        ) * 0.25
        ry = (
            np.roll(out_y, 1, axis=1)
            + np.roll(out_y, -1, axis=1)
            + np.roll(out_y, 1, axis=0)
            + np.roll(out_y, -1, axis=0)
        ) * 0.25
        flip = (out_x * rx + out_y * ry) < 0
        out_x = np.where(flip, -out_x, out_x)
        out_y = np.where(flip, -out_y, out_y)
    return out_x, out_y


def edge_map(luminance: np.ndarray, matte: np.ndarray, low: int, high: int) -> np.ndarray:
    u8 = np.clip(luminance * 255.0, 0, 255).astype(np.uint8)
    edges = cv2.Canny(u8, low, high)
    # Restrict to subject; dilate slightly for rim accumulation
    mask = (matte > 0.25).astype(np.uint8) * 255
    edges = cv2.bitwise_and(edges, mask)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    return edges


def build_tonal_maps(
    rgb_cutout: np.ndarray,
    matte: np.ndarray,
    bbox: tuple[int, int, int, int],
    params: StyleParams,
) -> TonalMaps:
    x0, y0, x1, y1 = bbox
    rgb = rgb_cutout[y0:y1, x0:x1]
    m = matte[y0:y1, x0:x1]

    lum = to_luminance(rgb)
    lum = apply_clahe(lum, params.clahe_clip, params.clahe_grid)
    # Push non-subject to white so marks never seed there from tone
    lum = np.where(m > 0.15, lum, 1.0).astype(np.float32)

    bands = posterize(lum, params.posterize_levels, m)
    orientation = structure_tensor_orientation(lum, params.orientation_sigma)
    edges = edge_map(lum, m, params.edge_low, params.edge_high)

    return TonalMaps(
        luminance=lum,
        posterized=bands,
        orientation=orientation,
        edges=edges,
        matte=m.astype(np.float32),
    )
