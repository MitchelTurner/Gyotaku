"""Contour / iso-luminance hatching — secondary strategy."""

from __future__ import annotations

import cv2
import numpy as np

from gyotaku.marks.base import MarkStrategy, Path
from gyotaku.params import StyleParams
from gyotaku.tonal import VectorField


class ContourStrategy(MarkStrategy):
    name = "contour"

    def generate(
        self,
        *,
        luminance: np.ndarray,
        orientation: VectorField,
        edges: np.ndarray,
        matte: np.ndarray,
        params: StyleParams,
        rng: np.random.Generator,
    ) -> list[Path]:
        levels = params.posterize_levels
        paths: list[Path] = []
        # Band masks from dark to light
        for band in range(levels):
            # Spacing tighter for darker bands
            t = band / max(1, levels - 1)
            spacing = params.contour_hatch_base * (0.7 + 1.4 * t)
            lo = band / levels
            hi = (band + 1) / levels
            inv = 1.0 - luminance
            mask = ((inv >= lo) & (inv < hi) & (matte > 0.35)).astype(np.uint8) * 255
            if np.count_nonzero(mask) < 40:
                continue
            # Morphological cleanup
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
            for cnt in contours:
                if len(cnt) < 8:
                    continue
                pts = cnt[:, 0, :].astype(np.float32)
                # Resample along contour with spacing
                paths.extend(self._hatch_along_contour(pts, spacing, matte, rng))

        # Light edge emphasis shared with flowfield aesthetic
        ys, xs = np.where((edges > 0) & (matte > 0.35))
        if len(xs) > 0 and params.edge_pass_density > 0:
            n = min(2000, int(len(xs) * params.edge_pass_density * 0.5))
            pick = rng.choice(len(xs), size=n, replace=False)
            for i in pick:
                x, y = float(xs[i]), float(ys[i])
                # Short ticks along local orientation
                tx = float(orientation.dx[int(y), int(x)])
                ty = float(orientation.dy[int(y), int(x)])
                half = params.edge_pass_length_px * 0.5
                p0 = (x - tx * half, y - ty * half)
                p1 = (x + tx * half, y + ty * half)
                paths.append(Path(points=np.asarray([p0, p1], dtype=np.float32)))

        return paths

    def _hatch_along_contour(
        self,
        pts: np.ndarray,
        spacing: float,
        matte: np.ndarray,
        rng: np.random.Generator,
    ) -> list[Path]:
        if len(pts) < 2:
            return []
        # Cumulative arc length
        d = np.sqrt(((pts[1:] - pts[:-1]) ** 2).sum(axis=1))
        s = np.concatenate([[0.0], np.cumsum(d)])
        total = float(s[-1])
        if total < spacing * 2:
            return [Path(points=pts.copy())]

        out: list[Path] = []
        # Emit the contour itself (primary)
        # Simplify by stride
        stride = max(1, int(round(spacing * 0.35)))
        simplified = pts[::stride]
        if len(simplified) >= 2:
            out.append(Path(points=simplified.astype(np.float32)))

        # Offset hatch segments between parallel-ish samples
        n_marks = int(total / spacing)
        for k in range(n_marks):
            t = (k + float(rng.random()) * 0.3) * spacing
            if t >= total:
                break
            i = int(np.searchsorted(s, t) - 1)
            i = max(0, min(i, len(pts) - 2))
            p = pts[i]
            tangent = pts[i + 1] - pts[i]
            tn = np.linalg.norm(tangent)
            if tn < 1e-6:
                continue
            tangent = tangent / tn
            normal = np.array([-tangent[1], tangent[0]], dtype=np.float32)
            half = spacing * 0.85
            a = p - normal * half
            b = p + normal * half
            # Stay inside matte
            h, w = matte.shape
            if not (0 <= a[0] < w and 0 <= a[1] < h and 0 <= b[0] < w and 0 <= b[1] < h):
                continue
            if matte[int(a[1]), int(a[0])] < 0.3 or matte[int(b[1]), int(b[0])] < 0.3:
                continue
            out.append(Path(points=np.asarray([a, b], dtype=np.float32)))
        return out
