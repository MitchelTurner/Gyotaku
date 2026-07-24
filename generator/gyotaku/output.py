"""SVG plot output and raster preview / print renders."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from gyotaku.color_mode import ink_color_for_path, normalize_color_mode, rgb_to_hex
from gyotaku.marks.base import Path as StrokePath
from gyotaku.params import CANVAS_MM, INCH_TO_MM, StyleParams


@dataclass
class Layout:
    canvas_w_mm: float
    canvas_h_mm: float
    offset_x_mm: float
    offset_y_mm: float
    px_to_mm: float
    # subject crop size in px
    subject_w_px: int
    subject_h_px: int
    fish_length_in: float | None = None
    fish_length_mm: float | None = None


def compute_layout(subject_w: int, subject_h: int, params: StyleParams) -> Layout:
    """Map subject pixel space → physical millimetres on paper.

    If ``fish_length_in`` is set, the subject's long edge (nose–tail in the matte
    bbox) is scaled to that exact length and the paper grows to fit + margins.
    Otherwise the fish is fitted into a named canvas via ``subject_fill``.
    """
    if params.fish_length_in is not None and params.fish_length_in > 0:
        length_mm = float(params.fish_length_in) * INCH_TO_MM
        long_px = max(subject_w, subject_h, 1)
        scale_mm_per_px = length_mm / float(long_px)
        placed_w = subject_w * scale_mm_per_px
        placed_h = subject_h * scale_mm_per_px
        cw = placed_w + 2 * params.margin_mm
        ch = placed_h + 2 * params.margin_mm
        return Layout(
            canvas_w_mm=cw,
            canvas_h_mm=ch,
            offset_x_mm=params.margin_mm,
            offset_y_mm=params.margin_mm,
            px_to_mm=scale_mm_per_px,
            subject_w_px=subject_w,
            subject_h_px=subject_h,
            fish_length_in=float(params.fish_length_in),
            fish_length_mm=length_mm,
        )

    cw, ch = CANVAS_MM[params.canvas]
    # Drawable area inside margins
    draw_w = cw - 2 * params.margin_mm
    draw_h = ch - 2 * params.margin_mm
    if draw_w <= 0 or draw_h <= 0:
        raise ValueError("Margins leave no drawable area")

    # Fit subject into fill fraction of drawable area
    target_w = draw_w * params.subject_fill
    target_h = draw_h * params.subject_fill
    scale_mm_per_px = min(target_w / max(subject_w, 1), target_h / max(subject_h, 1))
    placed_w = subject_w * scale_mm_per_px
    placed_h = subject_h * scale_mm_per_px
    ox = params.margin_mm + (draw_w - placed_w) * 0.5
    oy = params.margin_mm + (draw_h - placed_h) * 0.5
    return Layout(
        canvas_w_mm=cw,
        canvas_h_mm=ch,
        offset_x_mm=ox,
        offset_y_mm=oy,
        px_to_mm=scale_mm_per_px,
        subject_w_px=subject_w,
        subject_h_px=subject_h,
    )


def _uses_color_ink(params: StyleParams) -> bool:
    return normalize_color_mode(params.color_mode) != "black_and_white"


def paths_to_svg(
    paths: list[StrokePath],
    layout: Layout,
    *,
    seed: int,
    image_hash: str,
    style_fingerprint: str,
    params: StyleParams | None = None,
    subject_rgb: np.ndarray | None = None,
) -> str:
    color_mode = normalize_color_mode(
        params.color_mode if params is not None else "black_and_white"
    )
    colored = color_mode != "black_and_white" and subject_rgb is not None

    life = ""
    if layout.fish_length_in is not None and layout.fish_length_mm is not None:
        life = (
            f' data-fish-length-in="{layout.fish_length_in:.3f}" '
            f'data-fish-length-mm="{layout.fish_length_mm:.3f}"'
        )
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{layout.canvas_w_mm}mm" height="{layout.canvas_h_mm}mm" '
            f'viewBox="0 0 {layout.canvas_w_mm} {layout.canvas_h_mm}" '
            f'data-seed="{seed}" data-image-hash="{escape(image_hash)}" '
            f'data-style="{escape(style_fingerprint)}" '
            f'data-color-mode="{escape(color_mode)}"{life}>'
        ),
        "<!-- gyotaku plotter output: fill then anatomy (detail drawn heavier) -->",
    ]

    sx = layout.px_to_mm
    ox = layout.offset_x_mm
    oy = layout.offset_y_mm

    def _path_d(pts: np.ndarray) -> str:
        cmds = [f"M {ox + pts[0, 0] * sx:.4f} {oy + pts[0, 1] * sx:.4f}"]
        for i in range(1, len(pts)):
            cmds.append(f"L {ox + pts[i, 0] * sx:.4f} {oy + pts[i, 1] * sx:.4f}")
        return " ".join(cmds)

    def _emit_bw(path_list: list[StrokePath]) -> None:
        for path in path_list:
            pts = path.points
            if len(pts) < 2:
                continue
            parts.append(f'<path d="{_path_d(pts)}"/>')

    def _emit_colored(path_list: list[StrokePath], *, detail: bool, width: str) -> None:
        for path in path_list:
            pts = path.points
            if len(pts) < 2:
                continue
            rgb = ink_color_for_path(
                path, subject_rgb, color_mode, detail=detail
            )
            hex_c = rgb_to_hex(rgb)
            parts.append(
                f'<path d="{_path_d(pts)}" stroke="{hex_c}" '
                f'stroke-width="{width}" fill="none" '
                f'stroke-linecap="round" stroke-linejoin="round"/>'
            )

    fill_paths = [p for p in paths if getattr(p, "kind", "fill") != "detail"]
    detail_paths = [p for p in paths if getattr(p, "kind", "fill") == "detail"]

    if colored:
        parts.append('<g id="pen-fill">')
        _emit_colored(fill_paths, detail=False, width="0.32")
        parts.append("</g>")
        parts.append('<g id="pen-detail">')
        _emit_colored(detail_paths, detail=True, width="0.5")
        parts.append("</g>")
        emphasis = []
        for p in detail_paths:
            pts = p.points
            if len(pts) < 24:
                continue
            if float(np.linalg.norm(pts[0] - pts[-1])) < 3.0:
                emphasis.append(p)
        if emphasis:
            parts.append('<g id="pen-detail-emphasis">')
            _emit_colored(emphasis, detail=True, width="0.4")
            parts.append("</g>")
    else:
        parts.append(
            '<g id="pen-fill" fill="none" stroke="#000000" stroke-width="0.32" '
            'stroke-linecap="round" stroke-linejoin="round">'
        )
        _emit_bw(fill_paths)
        parts.append("</g>")
        parts.append(
            '<g id="pen-detail" fill="none" stroke="#000000" stroke-width="0.5" '
            'stroke-linecap="round" stroke-linejoin="round">'
        )
        _emit_bw(detail_paths)
        parts.append("</g>")
        emphasis = []
        for p in detail_paths:
            pts = p.points
            if len(pts) < 24:
                continue
            if float(np.linalg.norm(pts[0] - pts[-1])) < 3.0:
                emphasis.append(p)
        if emphasis:
            parts.append(
                '<g id="pen-detail-emphasis" fill="none" stroke="#000000" '
                'stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round">'
            )
            _emit_bw(emphasis)
            parts.append("</g>")

    parts.append("</svg>")
    parts.append("")
    return "\n".join(parts)


def _path_canvas_pix(
    path: StrokePath,
    layout: Layout,
    mm_to_px: float,
) -> np.ndarray | None:
    pts = path.points
    if len(pts) < 2:
        return None
    xs = layout.offset_x_mm + pts[:, 0] * layout.px_to_mm
    ys = layout.offset_y_mm + pts[:, 1] * layout.px_to_mm
    pix = np.stack([xs * mm_to_px, ys * mm_to_px], axis=1)
    return np.round(pix).astype(np.int32)


def _composite_colored_ink(
    paper: np.ndarray,
    paths: list[StrokePath],
    layout: Layout,
    params: StyleParams,
    subject_rgb: np.ndarray,
    *,
    mm_to_px: float,
    fill_thickness: int,
    detail_thickness: int,
    fill_alpha: float,
    detail_alpha: float,
    bleed_sigma: float,
) -> np.ndarray:
    """Draw per-stroke colored ink onto paper (float RGB 0–1)."""
    h, w = paper.shape[:2]
    ink_rgb = np.zeros((h, w, 3), dtype=np.float32)
    ink_a = np.zeros((h, w), dtype=np.float32)
    mode = normalize_color_mode(params.color_mode)

    def _stroke(path_list: list[StrokePath], thickness: int, alpha: float, detail: bool) -> None:
        for path in path_list:
            pix = _path_canvas_pix(path, layout, mm_to_px)
            if pix is None:
                continue
            color = ink_color_for_path(path, subject_rgb, mode, detail=detail)
            mask = np.zeros((h, w), dtype=np.float32)
            cv2.polylines(
                mask,
                [pix],
                isClosed=False,
                color=alpha,
                thickness=thickness,
                lineType=cv2.LINE_AA,
            )
            # Keep strongest coverage; refresh color where this stroke wins
            stronger = mask >= ink_a
            if np.any(stronger):
                np.maximum(ink_a, mask, out=ink_a)
                c = np.array(color, dtype=np.float32) / 255.0
                ink_rgb[stronger] = c

    fill_paths = [p for p in paths if getattr(p, "kind", "fill") != "detail"]
    detail_paths = [p for p in paths if getattr(p, "kind", "fill") == "detail"]
    _stroke(fill_paths, fill_thickness, fill_alpha, detail=False)
    _stroke(detail_paths, detail_thickness, detail_alpha, detail=True)

    if bleed_sigma > 0:
        ink_a = cv2.GaussianBlur(ink_a, (0, 0), bleed_sigma)
        ink_a = np.clip(ink_a * 1.12, 0, 1)
        for c in range(3):
            ink_rgb[:, :, c] = cv2.GaussianBlur(ink_rgb[:, :, c], (0, 0), bleed_sigma)

    a = ink_a[:, :, None]
    out = paper * (1.0 - a) + ink_rgb * a
    return np.clip(out, 0, 1)


def render_preview_png(
    paths: list[StrokePath],
    layout: Layout,
    params: StyleParams,
    *,
    watermark: bool | None = None,
    subject_rgb: np.ndarray | None = None,
) -> np.ndarray:
    """Rasterize strokes onto a paper-textured canvas; return RGB uint8."""
    use_wm = params.watermark if watermark is None else watermark
    # Scale so longest canvas edge ≈ preview_px
    scale = params.preview_px / max(layout.canvas_w_mm, layout.canvas_h_mm)
    w = max(1, int(round(layout.canvas_w_mm * scale)))
    h = max(1, int(round(layout.canvas_h_mm * scale)))

    # Paper base with subtle warm fiber noise
    rng = np.random.default_rng(0xC0FFEE)  # fixed — texture is not artwork-deterministic-critical
    paper = np.ones((h, w, 3), dtype=np.float32) * np.array(
        [0.96, 0.94, 0.90], dtype=np.float32
    )
    noise = rng.normal(0, params.paper_texture_strength, size=(h, w)).astype(np.float32)
    # Low-pass the noise
    noise = cv2.GaussianBlur(noise, (0, 0), 1.2)
    paper += noise[:, :, None]
    paper = np.clip(paper, 0, 1)

    if _uses_color_ink(params) and subject_rgb is not None:
        bleed = max(0.0, float(params.ink_bleed_px))
        rgb_f = _composite_colored_ink(
            paper,
            paths,
            layout,
            params,
            subject_rgb,
            mm_to_px=scale,
            fill_thickness=1,
            detail_thickness=2,
            fill_alpha=0.82,
            detail_alpha=0.95,
            bleed_sigma=bleed,
        )
        rgb = (np.clip(rgb_f, 0, 1) * 255).astype(np.uint8)
    else:
        ink = np.zeros((h, w), dtype=np.float32)
        mm_to_px = scale

        def _stroke(path_list: list, thickness: int, strength: float) -> None:
            for path in path_list:
                pix = _path_canvas_pix(path, layout, mm_to_px)
                if pix is not None:
                    cv2.polylines(
                        ink,
                        [pix],
                        isClosed=False,
                        color=strength,
                        thickness=thickness,
                        lineType=cv2.LINE_AA,
                    )

        fill_paths = [p for p in paths if getattr(p, "kind", "fill") != "detail"]
        detail_paths = [p for p in paths if getattr(p, "kind", "fill") == "detail"]
        _stroke(fill_paths, thickness=1, strength=0.78)
        _stroke(detail_paths, thickness=2, strength=1.0)

        if params.ink_bleed_px > 0:
            k = max(1.0, params.ink_bleed_px)
            ink = cv2.GaussianBlur(ink, (0, 0), k)
            ink = np.clip(ink * 1.15, 0, 1)

        rgb = paper * (1.0 - ink[:, :, None] * 0.92)
        rgb = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)

    if use_wm:
        rgb = _apply_watermark(rgb)

    return rgb


def render_print_png(
    paths: list[StrokePath],
    layout: Layout,
    params: StyleParams,
    *,
    subject_rgb: np.ndarray | None = None,
) -> np.ndarray:
    """300 DPI render at final trim size for giclée path."""
    dpi = params.print_dpi
    w = max(1, int(round(layout.canvas_w_mm / 25.4 * dpi)))
    h = max(1, int(round(layout.canvas_h_mm / 25.4 * dpi)))
    scale = w / layout.canvas_w_mm

    if _uses_color_ink(params) and subject_rgb is not None:
        paper = np.ones((h, w, 3), dtype=np.float32)
        bleed = 0.0
        if params.ink_bleed_px > 0:
            bleed = params.ink_bleed_px * (
                scale / (params.preview_px / max(layout.canvas_w_mm, layout.canvas_h_mm))
            )
        rgb_f = _composite_colored_ink(
            paper,
            paths,
            layout,
            params,
            subject_rgb,
            mm_to_px=scale,
            fill_thickness=1,
            detail_thickness=2,
            fill_alpha=0.88,
            detail_alpha=0.97,
            bleed_sigma=max(0.0, bleed),
        )
        return (np.clip(rgb_f, 0, 1) * 255).astype(np.uint8)

    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    ink = np.zeros((h, w), dtype=np.uint8)
    fill_paths = [p for p in paths if getattr(p, "kind", "fill") != "detail"]
    detail_paths = [p for p in paths if getattr(p, "kind", "fill") == "detail"]
    for path in fill_paths:
        pix = _path_canvas_pix(path, layout, scale)
        if pix is not None:
            cv2.polylines(ink, [pix], isClosed=False, color=220, thickness=1, lineType=cv2.LINE_AA)
    for path in detail_paths:
        pix = _path_canvas_pix(path, layout, scale)
        if pix is not None:
            cv2.polylines(ink, [pix], isClosed=False, color=255, thickness=2, lineType=cv2.LINE_AA)

    if params.ink_bleed_px > 0:
        # Scale bleed with DPI relative to preview (~1600px ≈ preview)
        bleed = params.ink_bleed_px * (
            scale / (params.preview_px / max(layout.canvas_w_mm, layout.canvas_h_mm))
        )
        ink_f = cv2.GaussianBlur(ink.astype(np.float32) / 255.0, (0, 0), max(0.3, bleed))
        ink = np.clip(ink_f * 255, 0, 255).astype(np.uint8)

    canvas = canvas.astype(np.float32)
    a = (ink.astype(np.float32) / 255.0)[:, :, None]
    canvas = canvas * (1.0 - a * 0.95)
    return np.clip(canvas, 0, 255).astype(np.uint8)


def _apply_watermark(rgb: np.ndarray) -> np.ndarray:
    img = Image.fromarray(rgb, mode="RGB").convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    text = "GYOTAKU PREVIEW"
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    # Diagonal repeating watermark
    step_x, step_y = 280, 160
    for y in range(-img.height, img.height * 2, step_y):
        for x in range(-img.width, img.width * 2, step_x):
            draw.text((x, y), text, fill=(0, 0, 0, 28), font=font)
    overlay = overlay.rotate(25, expand=False, resample=Image.Resampling.BILINEAR)
    composed = Image.alpha_composite(img, overlay)
    return np.asarray(composed.convert("RGB"), dtype=np.uint8)


def write_png(path: str | Path, rgb: np.ndarray) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, mode="RGB").save(path, format="PNG", optimize=True)


def write_svg(path: str | Path, svg: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")


def svg_sha256(svg: str) -> str:
    import hashlib

    return hashlib.sha256(svg.encode("utf-8")).hexdigest()
