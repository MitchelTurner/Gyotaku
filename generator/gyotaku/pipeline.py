"""End-to-end generation pipeline."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from gyotaku.ingest import IngestError, load_and_normalize
from gyotaku.ink import apply_ink_physics
from gyotaku.marks.base import Path as StrokePath
from gyotaku.marks.base import generate_marks
from gyotaku.optimize import estimate_plot_seconds, reorder_paths, simplify_paths
from gyotaku.output import (
    compute_layout,
    paths_to_svg,
    render_preview_png,
    render_print_png,
    svg_sha256,
    write_png,
    write_svg,
)
from gyotaku.params import StyleParams, resolve_params
from gyotaku.segment import SegmentationRejected, segment_subject
from gyotaku.tonal import TonalMaps, VectorField, build_tonal_maps


ProgressCallback = Callable[[str, str], None]


def _scale_path(path: StrokePath, scale: float) -> StrokePath:
    return StrokePath(points=(path.points * scale).astype(np.float32))


def _maybe_downsample_for_marks(tonal: TonalMaps, mark_long_edge: int) -> tuple[TonalMaps, float]:
    """Return (tonal_for_marks, scale_factor) where scale maps original → mark space."""
    h, w = tonal.luminance.shape
    long_edge = max(h, w)
    if long_edge <= mark_long_edge:
        return tonal, 1.0
    scale = mark_long_edge / float(long_edge)
    nh = max(1, int(round(h * scale)))
    nw = max(1, int(round(w * scale)))
    import cv2

    def rz(img: np.ndarray, interp: int) -> np.ndarray:
        return cv2.resize(img, (nw, nh), interpolation=interp)

    dx = rz(tonal.orientation.dx, cv2.INTER_AREA).astype(np.float32)
    dy = rz(tonal.orientation.dy, cv2.INTER_AREA).astype(np.float32)
    mag = np.sqrt(dx * dx + dy * dy) + 1e-12
    dx /= mag
    dy /= mag
    return (
        TonalMaps(
            luminance=rz(tonal.luminance, cv2.INTER_AREA).astype(np.float32),
            posterized=rz(tonal.posterized, cv2.INTER_NEAREST).astype(np.uint8),
            orientation=VectorField(dx=dx, dy=dy),
            edges=rz(tonal.edges, cv2.INTER_AREA).astype(np.uint8),
            matte=rz(tonal.matte, cv2.INTER_AREA).astype(np.float32),
        ),
        scale,
    )


@dataclass
class GenerationResult:
    svg_path: Path
    preview_path: Path
    preview_clean_path: Path | None
    print_path: Path | None
    meta_path: Path
    image_hash: str
    seed: int
    matte_score: float
    est_plot_seconds: int
    svg_hash: str
    path_count: int
    paper_width_mm: float = 0.0
    paper_height_mm: float = 0.0
    rejected: bool = False
    failure_reason: str | None = None


class GenerationError(Exception):
    pass


def _progress(cb: ProgressCallback | None, stage: str, detail: str = "") -> None:
    if cb:
        cb(stage, detail)


def generate(
    image_path: str | Path,
    output_dir: str | Path,
    *,
    params: StyleParams | None = None,
    seed: int = 0,
    write_print: bool = False,
    progress: ProgressCallback | None = None,
) -> GenerationResult:
    """
    Run the full Phase 0 pipeline.

    Writes:
      - artwork.svg
      - preview.png (watermarked when params.watermark)
      - preview_clean.png (never watermarked — paid unlock)
      - print.png (optional)
      - meta.json
    """
    params = params or StyleParams()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    _progress(progress, "ingest", "loading image")
    try:
        ingested = load_and_normalize(
            image_path,
            process_long_edge=params.process_long_edge,
            min_short_edge=params.min_short_edge,
        )
    except IngestError as e:
        raise GenerationError(str(e)) from e

    # Deterministic RNG from (imageHash, styleParams, seed)
    seed_material = f"{ingested.image_hash}:{params.canonical_json()}:{seed}".encode("utf-8")
    import hashlib

    seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "little") & 0x7FFFFFFF
    rng = np.random.default_rng(seed_int)
    # Also expose the user-facing seed unchanged in metadata

    _progress(progress, "segmenting", "isolating subject")
    try:
        seg = segment_subject(ingested.process_rgb, params)
    except SegmentationRejected as e:
        meta = {
            "status": "REJECTED",
            "matteScore": e.score,
            "failureReason": e.reason,
            "imageHash": ingested.image_hash,
            "seed": seed,
            "styleParams": params.to_dict(),
        }
        meta_path = output_dir / "meta.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return GenerationResult(
            svg_path=output_dir / "artwork.svg",
            preview_path=output_dir / "preview.png",
            preview_clean_path=None,
            print_path=None,
            meta_path=meta_path,
            image_hash=ingested.image_hash,
            seed=seed,
            matte_score=e.score,
            est_plot_seconds=0,
            svg_hash="",
            path_count=0,
            rejected=True,
            failure_reason=e.reason,
        )

    _progress(progress, "analyzing", "tonal decomposition")
    tonal = build_tonal_maps(seg.rgb_cutout, seg.matte, seg.bbox, params)
    tonal, mark_scale = _maybe_downsample_for_marks(tonal, params.mark_long_edge)

    _progress(progress, "drawing", f"mark strategy={params.strategy}")
    paths = generate_marks(tonal, params, rng)

    _progress(progress, "drawing", "ink physics")
    paths = apply_ink_physics(
        paths,
        luminance=tonal.luminance,
        edges=tonal.edges,
        matte=tonal.matte,
        params=params,
        rng=rng,
    )
    if mark_scale != 1.0:
        paths = [_scale_path(p, 1.0 / mark_scale) for p in paths]

    # Layout uses full-resolution subject crop size
    x0, y0, x1, y1 = seg.bbox
    layout = compute_layout(x1 - x0, y1 - y0, params)

    _progress(progress, "finishing", "simplify + optimize paths")
    paths = simplify_paths(paths, params.douglas_peucker_epsilon_mm, layout.px_to_mm)
    paths = reorder_paths(paths, params.optimize_time_budget_s)
    est = estimate_plot_seconds(paths, layout.px_to_mm)

    svg = paths_to_svg(
        paths,
        layout,
        seed=seed,
        image_hash=ingested.image_hash,
        style_fingerprint=params.fingerprint(),
    )
    svg_path = output_dir / "artwork.svg"
    write_svg(svg_path, svg)
    digest = svg_sha256(svg)

    _progress(progress, "finishing", "render preview")
    preview = render_preview_png(paths, layout, params, watermark=True)
    preview_path = output_dir / "preview.png"
    write_png(preview_path, preview)

    preview_clean = render_preview_png(paths, layout, params, watermark=False)
    preview_clean_path = output_dir / "preview_clean.png"
    write_png(preview_clean_path, preview_clean)

    print_path = None
    if write_print:
        _progress(progress, "finishing", "render print raster")
        print_rgb = render_print_png(paths, layout, params)
        print_path = output_dir / "print.png"
        write_png(print_path, print_rgb)

    meta: dict[str, Any] = {
        "status": "READY",
        "imageHash": ingested.image_hash,
        "seed": seed,
        "derivedRngSeed": seed_int,
        "styleParams": params.to_dict(),
        "styleFingerprint": params.fingerprint(),
        "matteScore": seg.matte_score,
        "estPlotSeconds": est,
        "pathCount": len(paths),
        "svgSha256": digest,
        "canvas": params.canvas,
        "strategy": params.strategy,
        "fishLengthIn": params.fish_length_in,
        "species": params.species,
        "side": params.side,
        "paperWidthMm": layout.canvas_w_mm,
        "paperHeightMm": layout.canvas_h_mm,
        "source": str(Path(image_path).resolve()),
    }
    meta_path = output_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    _progress(progress, "done", f"{len(paths)} paths, ~{est}s plot")
    return GenerationResult(
        svg_path=svg_path,
        preview_path=preview_path,
        preview_clean_path=preview_clean_path,
        print_path=print_path,
        meta_path=meta_path,
        image_hash=ingested.image_hash,
        seed=seed,
        matte_score=seg.matte_score,
        est_plot_seconds=est,
        svg_hash=digest,
        path_count=len(paths),
        paper_width_mm=layout.canvas_w_mm,
        paper_height_mm=layout.canvas_h_mm,
    )
