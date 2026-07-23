"""Dedicated fish anatomy strokes: operculum, jaw, fin rays, body frame.

These are geometric / photo-guided marks that read as fish structure even when
the flowfield fill is sparse.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from gyotaku.marks.base import Path
from gyotaku.params import StyleParams
from gyotaku.tonal import VectorField


@dataclass
class FishFrame:
    """Normalized fish pose in subject-crop coordinates."""

    x0: int
    y0: int
    x1: int
    y1: int
    horizontal: bool
    head_is_low: bool  # head toward smaller x (horizontal) or smaller y (vertical)
    eye: tuple[float, float] | None
    # Unit long-axis direction pointing toward the tail
    axis_x: float
    axis_y: float
    # Per-column (or row) centerline midpoints along the long axis
    along: np.ndarray  # N float positions on long axis
    across: np.ndarray  # N float midpoints on short axis


def _subject_bbox(matte: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(matte > 0.4)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def detect_eye_center(
    luminance: np.ndarray,
    matte: np.ndarray,
) -> tuple[float, float] | None:
    """Best compact dark blob in either end-third — shared by eye marks + operculum."""
    subject = matte > 0.4
    if np.count_nonzero(subject) < 200:
        return None
    ys, xs = np.where(subject)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)

    zones: list[np.ndarray] = []
    if bw >= bh:
        left = subject.copy()
        left[:, x0 + int(bw * 0.38) :] = False
        right = subject.copy()
        right[:, : x0 + int(bw * 0.62)] = False
        zones.extend([left, right])
    else:
        top = subject.copy()
        top[y0 + int(bh * 0.38) :, :] = False
        bot = subject.copy()
        bot[: y0 + int(bh * 0.62), :] = False
        zones.extend([top, bot])

    dark_full = (1.0 - np.clip(luminance, 0.0, 1.0)) * subject.astype(np.float32)
    best = None
    best_score = -1.0
    min_r = max(2.5, 0.014 * max(bw, bh))
    max_r = max(min_r + 1.0, 0.06 * max(bw, bh))

    for head in zones:
        if np.count_nonzero(head) < 50:
            continue
        dark = dark_full * head.astype(np.float32)
        u8 = np.clip(dark * 255.0, 0, 255).astype(np.uint8)
        blur = cv2.GaussianBlur(u8, (0, 0), 1.2)
        thr_val = max(40, int(np.percentile(blur[head], 93)))
        _, thr = cv2.threshold(blur, thr_val, 255, cv2.THRESH_BINARY)
        thr = cv2.bitwise_and(thr, head.astype(np.uint8) * 255)
        thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(thr, connectivity=8)
        if n <= 1:
            continue
        for i in range(1, n):
            area = float(stats[i, cv2.CC_STAT_AREA])
            ww = float(stats[i, cv2.CC_STAT_WIDTH])
            hh = float(stats[i, cv2.CC_STAT_HEIGHT])
            if area < 8 or area > math.pi * (max_r**2) * 2.0:
                continue
            r = 0.5 * math.sqrt(ww * ww + hh * hh)
            if r < min_r or r > max_r:
                continue
            roundness = min(ww, hh) / max(ww, hh)
            mean_dark = float(dark[labels == i].mean()) if area > 0 else 0.0
            score = mean_dark * (0.55 + 0.45 * roundness) * math.log1p(area)
            if score > best_score:
                best_score = score
                best = (float(centroids[i, 0]), float(centroids[i, 1]))
    return best


def build_fish_frame(matte: np.ndarray, luminance: np.ndarray) -> FishFrame | None:
    bbox = _subject_bbox(matte)
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    horizontal = bw >= bh
    eye = detect_eye_center(luminance, matte)

    # Centerline along the long axis
    subject = matte > 0.4
    if horizontal:
        along = []
        across = []
        for x in range(x0, x1 + 1):
            col = subject[:, x]
            ys = np.where(col)[0]
            if len(ys) < 2:
                continue
            along.append(float(x))
            across.append(float(ys.mean()))
        if len(along) < 8:
            return None
        along_a = np.asarray(along, dtype=np.float32)
        across_a = np.asarray(across, dtype=np.float32)
        # Smooth centerline
        k = max(5, len(across_a) // 20 * 2 + 1)
        across_a = cv2.GaussianBlur(across_a.reshape(1, -1), (k, 1), 0).ravel()
    else:
        along = []
        across = []
        for y in range(y0, y1 + 1):
            row = subject[y, :]
            xs = np.where(row)[0]
            if len(xs) < 2:
                continue
            along.append(float(y))
            across.append(float(xs.mean()))
        if len(along) < 8:
            return None
        along_a = np.asarray(along, dtype=np.float32)
        across_a = np.asarray(across, dtype=np.float32)
        k = max(5, len(across_a) // 20 * 2 + 1)
        across_a = cv2.GaussianBlur(across_a.reshape(1, -1), (k, 1), 0).ravel()

    # Head toward the end containing the eye; else toward the blunter (taller) end
    if eye is not None:
        if horizontal:
            head_is_low = eye[0] < (x0 + x1) * 0.5
        else:
            head_is_low = eye[1] < (y0 + y1) * 0.5
    else:
        # Compare mean thickness of first vs last quartile
        n = len(along_a)
        q = max(2, n // 4)
        if horizontal:
            t0 = float(np.mean([np.count_nonzero(subject[:, int(a)]) for a in along_a[:q]]))
            t1 = float(np.mean([np.count_nonzero(subject[:, int(a)]) for a in along_a[-q:]]))
        else:
            t0 = float(np.mean([np.count_nonzero(subject[int(a), :]) for a in along_a[:q]]))
            t1 = float(np.mean([np.count_nonzero(subject[int(a), :]) for a in along_a[-q:]]))
        # Head is usually deeper-bodied than the tail tip
        head_is_low = t0 >= t1

    if horizontal:
        axis_x = -1.0 if head_is_low else 1.0  # toward tail
        axis_y = 0.0
    else:
        axis_x = 0.0
        axis_y = -1.0 if head_is_low else 1.0

    return FishFrame(
        x0=x0,
        y0=y0,
        x1=x1,
        y1=y1,
        horizontal=horizontal,
        head_is_low=head_is_low,
        eye=eye,
        axis_x=axis_x,
        axis_y=axis_y,
        along=along_a,
        across=across_a,
    )


def body_axis_orientation(matte: np.ndarray, frame: FishFrame) -> VectorField:
    """Orientation field following the fish centerline (body-aligned strokes)."""
    h, w = matte.shape
    dx = np.zeros((h, w), dtype=np.float32)
    dy = np.zeros((h, w), dtype=np.float32)

    # Tangents along centerline
    al = frame.along
    ac = frame.across
    if len(al) < 3:
        dx[:] = frame.axis_x
        dy[:] = frame.axis_y
        return VectorField(dx=dx, dy=dy)

    # Finite-difference tangent in image coords
    txs = np.zeros(len(al), dtype=np.float32)
    tys = np.zeros(len(al), dtype=np.float32)
    for i in range(len(al)):
        i0 = max(0, i - 2)
        i1 = min(len(al) - 1, i + 2)
        if frame.horizontal:
            tx = al[i1] - al[i0]
            ty = ac[i1] - ac[i0]
        else:
            tx = ac[i1] - ac[i0]
            ty = al[i1] - al[i0]
        mag = math.hypot(float(tx), float(ty)) or 1.0
        txs[i] = tx / mag
        tys[i] = ty / mag
        # Flip to point roughly toward tail
        if txs[i] * frame.axis_x + tys[i] * frame.axis_y < 0:
            txs[i] = -txs[i]
            tys[i] = -tys[i]

    if frame.horizontal:
        for i, x in enumerate(al):
            xi = int(round(x))
            if 0 <= xi < w:
                dx[:, xi] = txs[i]
                dy[:, xi] = tys[i]
        # Fill gaps by horizontal blur / copy
        for x in range(w):
            if abs(dx[0, x]) + abs(dy[0, x]) < 1e-6:
                # nearest centerline sample
                j = int(np.argmin(np.abs(al - x)))
                dx[:, x] = txs[j]
                dy[:, x] = tys[j]
    else:
        for i, y in enumerate(al):
            yi = int(round(y))
            if 0 <= yi < h:
                dx[yi, :] = txs[i]
                dy[yi, :] = tys[i]
        for y in range(h):
            if abs(dx[y, 0]) + abs(dy[y, 0]) < 1e-6:
                j = int(np.argmin(np.abs(al - y)))
                dx[y, :] = txs[j]
                dy[y, :] = tys[j]

    # Mild smooth so column seams don't show
    dx = cv2.GaussianBlur(dx, (0, 0), 2.0)
    dy = cv2.GaussianBlur(dy, (0, 0), 2.0)
    mag = np.sqrt(dx * dx + dy * dy) + 1e-12
    dx /= mag
    dy /= mag
    # Outside subject → keep body axis default
    mask = matte > 0.2
    dx = np.where(mask, dx, frame.axis_x).astype(np.float32)
    dy = np.where(mask, dy, frame.axis_y).astype(np.float32)
    return VectorField(dx=dx, dy=dy)


def blend_orientation_fields(
    primary: VectorField,
    body: VectorField,
    blend: float,
    matte: np.ndarray,
) -> VectorField:
    """Blend structure-tensor with body-axis; align signs before mixing."""
    b = float(np.clip(blend, 0.0, 1.0))
    if b <= 1e-6:
        return primary
    px, py = primary.dx, primary.dy
    bx, by = body.dx, body.dy
    # Align body to primary per-pixel (π ambiguity)
    flip = (px * bx + py * by) < 0
    bx = np.where(flip, -bx, bx)
    by = np.where(flip, -by, by)
    dx = (1.0 - b) * px + b * bx
    dy = (1.0 - b) * py + b * by
    mag = np.sqrt(dx * dx + dy * dy) + 1e-12
    dx = (dx / mag).astype(np.float32)
    dy = (dy / mag).astype(np.float32)
    mask = matte > 0.15
    dx = np.where(mask, dx, px).astype(np.float32)
    dy = np.where(mask, dy, py).astype(np.float32)
    return VectorField(dx=dx, dy=dy)


def headness_map(matte: np.ndarray, frame: FishFrame) -> np.ndarray:
    """0 at tail → 1 at head tip (for shorter strokes near the head)."""
    h, w = matte.shape
    if frame.horizontal:
        xs = np.linspace(0, 1, w, dtype=np.float32)
        if frame.head_is_low:
            t = 1.0 - xs  # head at low x → high headness
        else:
            t = xs
        return np.broadcast_to(t[None, :], (h, w)).copy()
    ys = np.linspace(0, 1, h, dtype=np.float32)
    if frame.head_is_low:
        t = 1.0 - ys
    else:
        t = ys
    return np.broadcast_to(t[:, None], (h, w)).copy()


def _arc_polyline(
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    a0: float,
    a1: float,
    n: int = 28,
) -> np.ndarray:
    angles = np.linspace(a0, a1, max(6, n), dtype=np.float32)
    pts = np.stack([cx + rx * np.cos(angles), cy + ry * np.sin(angles)], axis=1)
    return pts.astype(np.float32)


def operculum_jaw_paths(
    luminance: np.ndarray,
    matte: np.ndarray,
    params: StyleParams,
    frame: FishFrame | None = None,
) -> list[Path]:
    """Forced gill-plate arc + jaw line in the head region."""
    if not params.detail_operculum_enabled:
        return []
    frame = frame or build_fish_frame(matte, luminance)
    if frame is None:
        return []

    subject = matte > 0.35
    bw = max(1, frame.x1 - frame.x0)
    bh = max(1, frame.y1 - frame.y0)
    paths: list[Path] = []

    # Head reference: eye if found, else head-end centroid
    if frame.eye is not None:
        ex, ey = frame.eye
    else:
        if frame.horizontal:
            if frame.head_is_low:
                zone = subject[:, frame.x0 : frame.x0 + int(bw * 0.3)]
                ox = frame.x0
            else:
                zone = subject[:, frame.x1 - int(bw * 0.3) : frame.x1 + 1]
                ox = frame.x1 - int(bw * 0.3)
            ys, xs = np.where(zone)
            if len(xs) == 0:
                return []
            ex = float(ox + xs.mean())
            ey = float(frame.y0 + ys.mean())
        else:
            if frame.head_is_low:
                zone = subject[frame.y0 : frame.y0 + int(bh * 0.3), :]
                oy = frame.y0
            else:
                zone = subject[frame.y1 - int(bh * 0.3) : frame.y1 + 1, :]
                oy = frame.y1 - int(bh * 0.3)
            ys, xs = np.where(zone)
            if len(xs) == 0:
                return []
            ex = float(xs.mean())
            ey = float(oy + ys.mean())

    # Posterior direction (toward body/tail)
    if frame.horizontal:
        post = 1.0 if frame.head_is_low else -1.0
        gill_x = ex + post * bw * float(params.detail_operculum_offset)
        # Clamp inside subject
        gill_x = float(np.clip(gill_x, frame.x0 + bw * 0.08, frame.x1 - bw * 0.08))
        # Vertical span of body at that x
        col = subject[:, int(round(gill_x))]
        ys = np.where(col)[0]
        if len(ys) < 4:
            return []
        y_top, y_bot = float(ys.min()), float(ys.max())
        span = y_bot - y_top
        # Operculum: convex arc bulging toward the head
        rx = max(6.0, bw * 0.055)
        cy = 0.5 * (y_top + y_bot)
        ry = span * 0.42
        # Arc facing the head (bulge anterior)
        if frame.head_is_low:
            # head left → bulge left → angles around π
            a0, a1 = math.pi * 0.55, math.pi * 1.45
            cx = gill_x + rx * 0.15
        else:
            a0, a1 = -math.pi * 0.45, math.pi * 0.45
            cx = gill_x - rx * 0.15
        arc = _arc_polyline(cx, cy, rx, ry, a0, a1, n=int(params.detail_operculum_segments))
        # Keep points inside matte
        keep = []
        for p in arc:
            xi, yi = int(round(p[0])), int(round(p[1]))
            if 0 <= yi < matte.shape[0] and 0 <= xi < matte.shape[1] and matte[yi, xi] > 0.3:
                keep.append(p)
        if len(keep) >= 6:
            paths.append(Path(points=np.asarray(keep, dtype=np.float32), kind="detail"))

        # Jaw: from snout toward eye, slightly ventral
        if frame.head_is_low:
            snout_x = float(frame.x0 + bw * 0.02)
        else:
            snout_x = float(frame.x1 - bw * 0.02)
        snout_col = subject[:, int(round(np.clip(snout_x, 0, matte.shape[1] - 1)))]
        sy = np.where(snout_col)[0]
        if len(sy) >= 2:
            snout_y = float(sy.max()) - (sy.max() - sy.min()) * 0.35  # lower-mouth bias
            mid_x = 0.55 * snout_x + 0.45 * ex
            mid_y = max(snout_y, ey) + bh * 0.04
            jaw = np.asarray(
                [[snout_x, snout_y], [mid_x, mid_y], [ex - post * bw * 0.02, ey + bh * 0.06]],
                dtype=np.float32,
            )
            paths.append(Path(points=jaw, kind="detail"))
    else:
        # Vertical fish — operculum as horizontal-ish arc
        post = 1.0 if frame.head_is_low else -1.0
        gill_y = ex  # placeholder; use eye y
        gill_y = ey + post * bh * float(params.detail_operculum_offset)
        gill_y = float(np.clip(gill_y, frame.y0 + bh * 0.08, frame.y1 - bh * 0.08))
        row = subject[int(round(gill_y)), :]
        xs = np.where(row)[0]
        if len(xs) >= 4:
            x_l, x_r = float(xs.min()), float(xs.max())
            span = x_r - x_l
            ry = max(6.0, bh * 0.055)
            cx = 0.5 * (x_l + x_r)
            rx = span * 0.42
            if frame.head_is_low:
                a0, a1 = math.pi * 0.55, math.pi * 1.45
                cy = gill_y + ry * 0.15
            else:
                a0, a1 = -math.pi * 0.45, math.pi * 0.45
                cy = gill_y - ry * 0.15
            arc = _arc_polyline(cx, cy, rx, ry, a0, a1, n=int(params.detail_operculum_segments))
            keep = []
            for p in arc:
                xi, yi = int(round(p[0])), int(round(p[1]))
                if 0 <= yi < matte.shape[0] and 0 <= xi < matte.shape[1] and matte[yi, xi] > 0.3:
                    keep.append(p)
            if len(keep) >= 6:
                paths.append(Path(points=np.asarray(keep, dtype=np.float32), kind="detail"))

    return paths


def fin_ray_paths(
    matte: np.ndarray,
    params: StyleParams,
    frame: FishFrame | None = None,
    luminance: np.ndarray | None = None,
) -> list[Path]:
    """Fan strokes inside fin protrusions (base → tip)."""
    if not params.detail_fin_rays_enabled:
        return []
    if frame is None:
        if luminance is None:
            return []
        frame = build_fish_frame(matte, luminance)
    if frame is None:
        return []

    subject = (matte > 0.4).astype(np.uint8) * 255
    bw = max(1, frame.x1 - frame.x0)
    bh = max(1, frame.y1 - frame.y0)
    # Large open removes fins; elliptical kernel along body
    if frame.horizontal:
        kx = max(9, int(bw * 0.08) | 1)
        ky = max(9, int(bh * 0.42) | 1)
    else:
        kx = max(9, int(bw * 0.42) | 1)
        ky = max(9, int(bh * 0.08) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kx, ky))
    body = cv2.morphologyEx(subject, cv2.MORPH_OPEN, kernel, iterations=1)
    body = cv2.dilate(body, np.ones((5, 5), np.uint8), iterations=1)
    fins = cv2.subtract(subject, body)
    fins = cv2.morphologyEx(fins, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    n, labels, stats, centroids = cv2.connectedComponentsWithStats(fins, connectivity=8)
    if n <= 1:
        return []

    min_area = max(40.0, 0.004 * bw * bh)
    max_rays = max(3, int(params.detail_fin_ray_count))
    paths: list[Path] = []
    dist_body = cv2.distanceTransform((body == 0).astype(np.uint8), cv2.DIST_L2, 3)

    components = []
    for i in range(1, n):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        components.append((area, i))
    components.sort(reverse=True)

    for _, i in components[: int(params.detail_fin_max_fins)]:
        mask = labels == i
        ys, xs = np.where(mask)
        if len(xs) < 12:
            continue
        # Tip = farthest from body core; base = closest
        d = dist_body[ys, xs]
        tip_idx = int(np.argmax(d))
        tip = np.array([xs[tip_idx], ys[tip_idx]], dtype=np.float32)
        # Base centroid: points in the nearest 25% to body
        order = np.argsort(d)
        n_base = max(4, len(order) // 4)
        base_pts = np.stack([xs[order[:n_base]], ys[order[:n_base]]], axis=1).astype(np.float32)
        base_c = base_pts.mean(axis=0)
        # Direction base → tip
        direction = tip - base_c
        mag = float(np.linalg.norm(direction))
        if mag < 4.0:
            continue
        direction /= mag

        # Spread axis perpendicular to ray direction
        perp = np.array([-direction[1], direction[0]], dtype=np.float32)
        # Project base points onto perp for fan width
        rel = base_pts - base_c
        spreads = rel @ perp
        s_lo, s_hi = float(spreads.min()), float(spreads.max())
        if abs(s_hi - s_lo) < 2.0:
            s_lo, s_hi = -mag * 0.15, mag * 0.15

        ray_len = mag * float(params.detail_fin_ray_length)
        for t in np.linspace(0.08, 0.92, max_rays):
            spread = s_lo + t * (s_hi - s_lo)
            start = base_c + perp * spread
            end = start + direction * ray_len
            # Clip end to stay in fin mask / subject
            steps = max(4, int(ray_len))
            pts = []
            for s in np.linspace(0, 1, steps):
                p = start * (1 - s) + end * s
                xi, yi = int(round(p[0])), int(round(p[1]))
                if yi < 0 or yi >= matte.shape[0] or xi < 0 or xi >= matte.shape[1]:
                    break
                if matte[yi, xi] < 0.3:
                    break
                pts.append(p)
            if len(pts) >= 2:
                paths.append(Path(points=np.asarray(pts, dtype=np.float32), kind="detail"))

    return paths
