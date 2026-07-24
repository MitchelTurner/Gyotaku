"""Ink color modes for gyotaku output — black ink, photo-matched, or vibrant."""

from __future__ import annotations

from typing import Any, Literal

import cv2
import numpy as np

ColorMode = Literal["black_and_white", "fish_color", "vibrant"]

_VALID: frozenset[str] = frozenset({"black_and_white", "fish_color", "vibrant"})


def normalize_color_mode(value: object) -> ColorMode:
    if value is None or value == "":
        return "black_and_white"
    raw = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "bw": "black_and_white",
        "b_w": "black_and_white",
        "mono": "black_and_white",
        "monochrome": "black_and_white",
        "black": "black_and_white",
        "ink": "black_and_white",
        "fish": "fish_color",
        "natural": "fish_color",
        "photo": "fish_color",
        "color": "fish_color",
        "saturated": "vibrant",
        "vivid": "vibrant",
    }
    raw = aliases.get(raw, raw)
    if raw in _VALID:
        return raw  # type: ignore[return-value]
    return "black_and_white"


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(c))) for c in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def _path_points(path: Any) -> np.ndarray:
    pts = getattr(path, "points", path)
    return np.asarray(pts, dtype=np.float32)


def sample_mean_rgb(
    path: Any,
    subject_rgb: np.ndarray,
    *,
    max_samples: int = 48,
) -> tuple[int, int, int]:
    """Average non-paper RGB along a polyline in subject-crop coordinates."""
    pts = _path_points(path)
    if pts is None or len(pts) == 0:
        return (32, 32, 32)
    h, w = subject_rgb.shape[:2]
    n = len(pts)
    step = max(1, n // max_samples)
    xs = np.clip(np.round(pts[::step, 0]).astype(np.int32), 0, w - 1)
    ys = np.clip(np.round(pts[::step, 1]).astype(np.int32), 0, h - 1)
    samples = subject_rgb[ys, xs].astype(np.float32)
    # Drop near-white / void pixels from the cutout
    lum = (
        0.2126 * samples[:, 0]
        + 0.7152 * samples[:, 1]
        + 0.0722 * samples[:, 2]
    )
    keep = lum < 245.0
    if np.any(keep):
        samples = samples[keep]
    if len(samples) == 0:
        return (40, 40, 40)
    mean = samples.mean(axis=0)
    return (int(mean[0]), int(mean[1]), int(mean[2]))


def _darken_for_ink(
    rgb: tuple[int, int, int],
    *,
    detail: bool,
) -> tuple[int, int, int]:
    """Pull sampled fish color toward print-readable ink."""
    arr = np.array([[list(rgb)]], dtype=np.uint8)
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV).astype(np.float32)[0, 0]
    h, s, v = float(hsv[0]), float(hsv[1]), float(hsv[2])
    # Keep some chroma; lower value so strokes read on warm paper
    s = min(255.0, s * 1.15 + 12.0)
    v = v * (0.55 if detail else 0.68)
    v = max(28.0, min(210.0, v))
    out = cv2.cvtColor(
        np.array([[[int(h), int(s), int(v)]]], dtype=np.uint8),
        cv2.COLOR_HSV2RGB,
    )[0, 0]
    return (int(out[0]), int(out[1]), int(out[2]))


def _vibrantize(
    rgb: tuple[int, int, int],
    *,
    detail: bool,
) -> tuple[int, int, int]:
    """Boost saturation; invent a vivid hue for silver / gray fish."""
    arr = np.array([[list(rgb)]], dtype=np.uint8)
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV).astype(np.float32)[0, 0]
    h, s, v = float(hsv[0]), float(hsv[1]), float(hsv[2])
    if s < 38.0:
        # Silver sides → sea teal / copper accent from luminance
        # OpenCV H is 0–179
        h = 18.0 + (1.0 - min(v, 255.0) / 255.0) * 85.0  # copper → teal
        s = 200.0 if detail else 170.0
        v = max(70.0, min(200.0, v * 0.85 + 40.0))
    else:
        s = min(255.0, s * 1.9 + 55.0)
        v = max(55.0, min(230.0, v * (0.75 if detail else 0.9) + 25.0))
    if detail:
        v = max(24.0, v * 0.82)
        s = min(255.0, s + 20.0)
    out = cv2.cvtColor(
        np.array([[[int(h), int(s), int(v)]]], dtype=np.uint8),
        cv2.COLOR_HSV2RGB,
    )[0, 0]
    return (int(out[0]), int(out[1]), int(out[2]))


def ink_color_for_path(
    path: Any,
    subject_rgb: np.ndarray | None,
    mode: ColorMode | str,
    *,
    detail: bool = False,
) -> tuple[int, int, int]:
    mode_n = normalize_color_mode(mode)
    if mode_n == "black_and_white" or subject_rgb is None:
        return (0, 0, 0)
    sample = sample_mean_rgb(path, subject_rgb)
    if mode_n == "fish_color":
        return _darken_for_ink(sample, detail=detail)
    return _vibrantize(sample, detail=detail)
