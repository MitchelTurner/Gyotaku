"""Flow-field stroke generation — primary mark strategy.

Seed points by density-weighted sampling; integrate along the orientation
field with RK4; tone comes from luminance-dependent stroke separation.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from gyotaku.marks.base import MarkStrategy, Path
from gyotaku.params import StyleParams
from gyotaku.tonal import VectorField


class SpatialHash:
    """Grid hash for minimum-separation tests."""

    def __init__(self, cell_size: float):
        self.cell = max(cell_size, 0.5)
        self.inv = 1.0 / self.cell
        self.cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)

    def _key(self, x: float, y: float) -> tuple[int, int]:
        return int(math.floor(x * self.inv)), int(math.floor(y * self.inv))

    def insert(self, x: float, y: float) -> None:
        self.cells[self._key(x, y)].append((x, y))

    def insert_polyline(self, pts: np.ndarray, stride: int = 1) -> None:
        for i in range(0, len(pts), stride):
            self.insert(float(pts[i, 0]), float(pts[i, 1]))

    def too_close(self, x: float, y: float, min_dist: float) -> bool:
        r = int(math.ceil(min_dist * self.inv))
        cx, cy = self._key(x, y)
        md2 = min_dist * min_dist
        for iy in range(cy - r, cy + r + 1):
            for ix in range(cx - r, cx + r + 1):
                for px, py in self.cells.get((ix, iy), ()):
                    dx = px - x
                    dy = py - y
                    if dx * dx + dy * dy < md2:
                        return True
        return False


def _sample_field(field: np.ndarray, x: float, y: float) -> float:
    h, w = field.shape
    if x < 0 or y < 0 or x >= w - 1 or y >= h - 1:
        return 0.0
    x0 = int(math.floor(x))
    y0 = int(math.floor(y))
    fx = x - x0
    fy = y - y0
    v00 = float(field[y0, x0])
    v10 = float(field[y0, x0 + 1])
    v01 = float(field[y0 + 1, x0])
    v11 = float(field[y0 + 1, x0 + 1])
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy


def _sample_orientation(orientation: VectorField, x: float, y: float) -> tuple[float, float]:
    dx = _sample_field(orientation.dx, x, y)
    dy = _sample_field(orientation.dy, x, y)
    mag = math.hypot(dx, dy)
    if mag < 1e-8:
        return 1.0, 0.0
    return dx / mag, dy / mag


def _separation_for_luminance(lum: float, params: StyleParams) -> float:
    # Dark → tight spacing; light → loose
    t = float(np.clip(lum, 0.0, 1.0))
    return params.min_separation_dark + t * (params.min_separation_light - params.min_separation_dark)


class FlowfieldStrategy(MarkStrategy):
    name = "flowfield"

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
        seeds = self._density_seeds(luminance, matte, params, rng)
        cell = max(0.75, params.min_separation_dark * 0.9)
        grid = SpatialHash(cell)
        paths: list[Path] = []

        # Shuffle seeds for less directional bias; already rng-ordered from choice
        for sx, sy in seeds:
            lum = _sample_field(luminance, sx, sy)
            sep = _separation_for_luminance(lum, params)
            if grid.too_close(sx, sy, sep * 0.85):
                continue
            pts = self._trace_stroke(sx, sy, luminance, orientation, matte, params, grid)
            if pts is None or len(pts) < params.min_stroke_points:
                continue
            arr = np.asarray(pts, dtype=np.float32)
            paths.append(Path(points=arr))
            grid.insert_polyline(arr, stride=max(1, int(params.step_px)))

        # Edge accumulation pass — denser short strokes along rims
        if params.edge_pass_density > 0:
            edge_paths = self._edge_pass(
                edges, luminance, orientation, matte, params, rng, grid
            )
            paths.extend(edge_paths)

        return paths

    def _density_seeds(
        self,
        luminance: np.ndarray,
        matte: np.ndarray,
        params: StyleParams,
        rng: np.random.Generator,
    ) -> list[tuple[float, float]]:
        h, w = luminance.shape
        mask = matte > 0.35
        ys, xs = np.where(mask)
        if len(xs) == 0:
            return []

        # Weight by darkness^gamma
        dark = np.clip(1.0 - luminance[ys, xs], 0.0, 1.0)
        weights = np.power(dark + 0.05, params.density_gamma)
        weights = weights / weights.sum()

        n = min(params.seed_count, len(xs))
        idx = rng.choice(len(xs), size=n, replace=False, p=weights)
        # Sub-pixel jitter within pixel
        jitter = rng.random((n, 2)) - 0.5
        seeds = [
            (float(xs[i]) + float(jitter[k, 0]), float(ys[i]) + float(jitter[k, 1]))
            for k, i in enumerate(idx)
        ]
        return seeds

    def _rk4_step(
        self,
        x: float,
        y: float,
        direction: float,
        step: float,
        orientation: VectorField,
    ) -> tuple[float, float, float, float]:
        """One RK4 step along ±orientation. Returns new x,y and unit tangent."""

        def tang(px: float, py: float, prev_tx: float, prev_ty: float) -> tuple[float, float]:
            tx, ty = _sample_orientation(orientation, px, py)
            # Keep consistent with previous direction (undirected field)
            if tx * prev_tx + ty * prev_ty < 0:
                tx, ty = -tx, -ty
            return tx, ty

        # Initial tangent aligned with direction sign
        tx0, ty0 = _sample_orientation(orientation, x, y)
        tx0, ty0 = tx0 * direction, ty0 * direction
        mag = math.hypot(tx0, ty0) or 1.0
        tx0, ty0 = tx0 / mag, ty0 / mag

        k1x, k1y = tang(x, y, tx0, ty0)
        k2x, k2y = tang(x + 0.5 * step * k1x, y + 0.5 * step * k1y, k1x, k1y)
        k3x, k3y = tang(x + 0.5 * step * k2x, y + 0.5 * step * k2y, k2x, k2y)
        k4x, k4y = tang(x + step * k3x, y + step * k3y, k3x, k3y)

        nx = x + (step / 6.0) * (k1x + 2 * k2x + 2 * k3x + k4x)
        ny = y + (step / 6.0) * (k1y + 2 * k2y + 2 * k3y + k4y)
        tx, ty = tang(nx, ny, k1x, k1y)
        return nx, ny, tx, ty

    def _trace_stroke(
        self,
        sx: float,
        sy: float,
        luminance: np.ndarray,
        orientation: VectorField,
        matte: np.ndarray,
        params: StyleParams,
        grid: SpatialHash,
    ) -> list[tuple[float, float]] | None:
        h, w = luminance.shape
        step = params.step_px
        max_len = params.max_stroke_length_px
        max_angle = params.max_cum_angle_rad

        def integrate(direction: float) -> list[tuple[float, float]]:
            pts: list[tuple[float, float]] = []
            x, y = sx, sy
            cum_angle = 0.0
            length = 0.0
            prev_tx, prev_ty = _sample_orientation(orientation, x, y)
            prev_tx, prev_ty = prev_tx * direction, prev_ty * direction
            steps = 0
            while length < max_len * 0.5:
                if x < 1 or y < 1 or x >= w - 2 or y >= h - 2:
                    break
                if _sample_field(matte, x, y) < 0.3:
                    break
                lum = _sample_field(luminance, x, y)
                sep = _separation_for_luminance(lum, params)
                # Check separation every other step so strokes can run longer
                # along the form before yielding to neighbors.
                if pts and steps > 2 and (steps % 2 == 0) and grid.too_close(x, y, sep):
                    break
                pts.append((x, y))
                nx, ny, tx, ty = self._rk4_step(x, y, direction, step, orientation)
                # Angle accumulation — use a soft threshold so gentle curves survive
                dot = max(-1.0, min(1.0, prev_tx * tx + prev_ty * ty))
                turn = abs(math.acos(dot))
                cum_angle = cum_angle * 0.92 + turn
                if cum_angle > max_angle:
                    break
                length += step
                steps += 1
                prev_tx, prev_ty = tx, ty
                x, y = nx, ny
            return pts

        backward_pts = integrate(-1.0)
        forward_pts = integrate(+1.0)
        # Both halves include the seed; drop duplicate when joining
        merged = list(reversed(backward_pts[1:])) + forward_pts
        if len(merged) < params.min_stroke_points:
            return None
        return merged

    def _edge_pass(
        self,
        edges: np.ndarray,
        luminance: np.ndarray,
        orientation: VectorField,
        matte: np.ndarray,
        params: StyleParams,
        rng: np.random.Generator,
        grid: SpatialHash,
    ) -> list[Path]:
        ys, xs = np.where(edges > 0)
        if len(xs) == 0:
            return []
        n = int(len(xs) * params.edge_pass_density)
        n = max(0, min(n, 4000))
        if n == 0:
            return []
        pick = rng.choice(len(xs), size=n, replace=False)
        paths: list[Path] = []
        max_len = params.edge_pass_length_px
        step = params.step_px
        sep = params.edge_pass_spacing

        for i in pick:
            sx = float(xs[i]) + float(rng.random() - 0.5)
            sy = float(ys[i]) + float(rng.random() - 0.5)
            if grid.too_close(sx, sy, sep * 0.8):
                continue
            pts: list[tuple[float, float]] = []
            x, y = sx, sy
            length = 0.0
            direction = 1.0 if rng.random() < 0.5 else -1.0
            while length < max_len:
                if _sample_field(matte, x, y) < 0.25:
                    break
                if pts and grid.too_close(x, y, sep):
                    break
                pts.append((x, y))
                x, y, _, _ = self._rk4_step(x, y, direction, step, orientation)
                length += step
            if len(pts) >= params.min_stroke_points:
                arr = np.asarray(pts, dtype=np.float32)
                paths.append(Path(points=arr))
                grid.insert_polyline(arr, stride=1)
        return paths
