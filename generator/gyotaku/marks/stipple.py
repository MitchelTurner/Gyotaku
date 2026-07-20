"""Weighted Voronoi stippling — tertiary strategy (slow to plot, low priority)."""

from __future__ import annotations

import numpy as np
from scipy.spatial import Voronoi

from gyotaku.marks.base import MarkStrategy, Path
from gyotaku.params import StyleParams
from gyotaku.tonal import VectorField


class StippleStrategy(MarkStrategy):
    name = "stipple"

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
        h, w = luminance.shape
        ys, xs = np.where(matte > 0.35)
        if len(xs) == 0:
            return []

        dark = np.clip(1.0 - luminance[ys, xs], 0.05, 1.0)
        weights = dark / dark.sum()
        n = min(params.stipple_points, len(xs))
        idx = rng.choice(len(xs), size=n, replace=False, p=weights)
        pts = np.stack([xs[idx].astype(np.float64), ys[idx].astype(np.float64)], axis=1)
        pts += rng.normal(0, 0.3, size=pts.shape)

        # Lloyd relaxation against inverted luminance as density proxy
        for _ in range(params.stipple_lloyd_iters):
            pts = self._lloyd_step(pts, luminance, matte, rng)

        paths: list[Path] = []
        # Tiny tick marks oriented with the flow — denser/darker → slightly longer
        for x, y in pts:
            ix, iy = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
            if matte[iy, ix] < 0.35:
                continue
            tx = float(orientation.dx[iy, ix])
            ty = float(orientation.dy[iy, ix])
            lum = float(luminance[iy, ix])
            half = 0.6 + (1.0 - lum) * 1.4
            a = (x - tx * half, y - ty * half)
            b = (x + tx * half, y + ty * half)
            paths.append(Path(points=np.asarray([a, b], dtype=np.float32)))

        return paths

    def _lloyd_step(
        self,
        pts: np.ndarray,
        luminance: np.ndarray,
        matte: np.ndarray,
        rng: np.random.Generator,
    ) -> np.ndarray:
        h, w = luminance.shape
        if len(pts) < 4:
            return pts
        # Bound with corners so Voronoi regions are finite-ish
        pad = np.array(
            [[-10, -10], [w + 10, -10], [-10, h + 10], [w + 10, h + 10]],
            dtype=np.float64,
        )
        try:
            vor = Voronoi(np.vstack([pts, pad]))
        except Exception:
            return pts

        new_pts = pts.copy()
        for i in range(len(pts)):
            region_index = vor.point_region[i]
            region = vor.regions[region_index]
            if not region or -1 in region:
                continue
            poly = vor.vertices[region]
            if len(poly) < 3:
                continue
            # Density-weighted centroid approximation: sample a few points in bbox
            x0, y0 = poly.min(axis=0)
            x1, y1 = poly.max(axis=0)
            if x1 <= x0 or y1 <= y0:
                continue
            samples = rng.random((12, 2))
            samples[:, 0] = x0 + samples[:, 0] * (x1 - x0)
            samples[:, 1] = y0 + samples[:, 1] * (y1 - y0)
            weights = []
            valid = []
            for sx, sy in samples:
                ix, iy = int(sx), int(sy)
                if ix < 0 or iy < 0 or ix >= w or iy >= h:
                    continue
                if matte[iy, ix] < 0.3:
                    continue
                weights.append(1.0 - float(luminance[iy, ix]) + 0.05)
                valid.append((sx, sy))
            if not valid:
                cx, cy = poly.mean(axis=0)
            else:
                ww = np.asarray(weights, dtype=np.float64)
                vv = np.asarray(valid, dtype=np.float64)
                ww = ww / ww.sum()
                cx, cy = (vv * ww[:, None]).sum(axis=0)
            cx = float(np.clip(cx, 0, w - 1))
            cy = float(np.clip(cy, 0, h - 1))
            if matte[int(cy), int(cx)] > 0.3:
                new_pts[i] = (cx, cy)
        return new_pts
