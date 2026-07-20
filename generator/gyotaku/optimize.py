"""Path simplification and pen-travel optimization (deterministic)."""

from __future__ import annotations

import numpy as np

from gyotaku.marks.base import Path


def douglas_peucker(points: np.ndarray, epsilon: float) -> np.ndarray:
    if len(points) < 3:
        return points
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = True
    keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        segment = points[end] - points[start]
        seg_len = float(np.linalg.norm(segment))
        if seg_len < 1e-12:
            max_dist = 0.0
            idx = start
            for i in range(start + 1, end):
                d = float(np.linalg.norm(points[i] - points[start]))
                if d > max_dist:
                    max_dist = d
                    idx = i
        else:
            unit = segment / seg_len
            max_dist = -1.0
            idx = start
            for i in range(start + 1, end):
                w = points[i] - points[start]
                proj = float(np.dot(w, unit))
                closest = points[start] + unit * np.clip(proj, 0.0, seg_len)
                d = float(np.linalg.norm(points[i] - closest))
                if d > max_dist:
                    max_dist = d
                    idx = i
        if max_dist > epsilon:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return points[keep]


def simplify_paths(paths: list[Path], epsilon_mm: float, px_to_mm: float) -> list[Path]:
    eps_px = epsilon_mm / max(px_to_mm, 1e-9)
    out: list[Path] = []
    for p in paths:
        simp = douglas_peucker(p.points.astype(np.float64), eps_px)
        if len(simp) >= 2:
            out.append(Path(points=simp.astype(np.float32)))
    return out


def _path_endpoints(path: Path) -> tuple[np.ndarray, np.ndarray]:
    return path.points[0], path.points[-1]


def reorder_paths(paths: list[Path], time_budget_s: float) -> list[Path]:
    """
    Greedy nearest-neighbor + bounded 2-opt.

    `time_budget_s` is mapped to a deterministic operation cap so output does
    not depend on wall-clock speed (required for seed reproducibility).
    """
    if len(paths) <= 2:
        return paths

    # ~5e5 distance checks ≈ 1s on a typical laptop; scale from budget
    op_budget = max(1000, int(time_budget_s * 500_000))
    ops = 0

    remaining = list(range(len(paths)))
    ordered_idx: list[int] = []
    reversed_flags: list[bool] = []

    starts = [paths[i].points[0] for i in remaining]
    dists = [float(p[0] ** 2 + p[1] ** 2) for p in starts]
    current = int(np.argmin(dists))
    ordered_idx.append(remaining.pop(current))
    reversed_flags.append(False)
    pos = paths[ordered_idx[-1]].points[-1]

    while remaining:
        best_i = 0
        best_rev = False
        best_d = 1e30
        for i, pi in enumerate(remaining):
            a, b = _path_endpoints(paths[pi])
            d0 = float((a[0] - pos[0]) ** 2 + (a[1] - pos[1]) ** 2)
            d1 = float((b[0] - pos[0]) ** 2 + (b[1] - pos[1]) ** 2)
            ops += 2
            if d0 < best_d:
                best_d, best_i, best_rev = d0, i, False
            if d1 < best_d:
                best_d, best_i, best_rev = d1, i, True
        chosen = remaining.pop(best_i)
        ordered_idx.append(chosen)
        reversed_flags.append(best_rev)
        pts = paths[chosen].points
        pos = pts[0] if best_rev else pts[-1]
        if ops > op_budget * 0.6:
            for pi in remaining:
                ordered_idx.append(pi)
                reversed_flags.append(False)
            break

    result = []
    for idx, rev in zip(ordered_idx, reversed_flags):
        pts = paths[idx].points
        if rev:
            pts = pts[::-1].copy()
        result.append(Path(points=pts.astype(np.float32)))

    return _two_opt(result, ops, op_budget)


def _tour_travel(paths: list[Path]) -> float:
    if not paths:
        return 0.0
    travel = float(np.linalg.norm(paths[0].points[0]))
    for i in range(len(paths) - 1):
        a = paths[i].points[-1]
        b = paths[i + 1].points[0]
        travel += float(np.linalg.norm(a - b))
    return travel


def _two_opt(paths: list[Path], ops: int, op_budget: int) -> list[Path]:
    n = len(paths)
    if n < 4:
        return paths
    best = paths
    best_cost = _tour_travel(best)
    improved = True
    while improved and ops < op_budget:
        improved = False
        for i in range(1, n - 2):
            for j in range(i + 1, n):
                if ops >= op_budget:
                    return best
                cand2 = best[:i] + list(reversed(best[i : j + 1])) + best[j + 1 :]
                cost = _tour_travel(cand2)
                ops += n  # approximate cost of tour eval
                if cost + 1e-6 < best_cost:
                    best = cand2
                    best_cost = cost
                    improved = True
                    break
            if improved:
                break
    return best


def estimate_plot_seconds(
    paths: list[Path],
    px_to_mm: float,
    draw_mm_s: float = 40.0,
    travel_mm_s: float = 80.0,
) -> int:
    """Rough AxiDraw-ish time estimate from path length + pen-up travel."""
    if not paths:
        return 0
    draw = 0.0
    travel = float(np.linalg.norm(paths[0].points[0])) * px_to_mm
    for p in paths:
        pts = p.points
        draw += float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1))) * px_to_mm
    for i in range(len(paths) - 1):
        a = paths[i].points[-1]
        b = paths[i + 1].points[0]
        travel += float(np.linalg.norm(a - b)) * px_to_mm
    penalty = len(paths) * 0.12
    seconds = draw / draw_mm_s + travel / travel_mm_s + penalty
    return int(max(1, round(seconds)))
