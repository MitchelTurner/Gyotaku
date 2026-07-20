"""SVG plot output and raster preview / print renders."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from gyotaku.marks.base import Path as StrokePath
from gyotaku.params import CANVAS_MM, StyleParams


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


def compute_layout(subject_w: int, subject_h: int, params: StyleParams) -> Layout:
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


def paths_to_svg(
    paths: list[StrokePath],
    layout: Layout,
    *,
    seed: int,
    image_hash: str,
    style_fingerprint: str,
) -> str:
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{layout.canvas_w_mm}mm" height="{layout.canvas_h_mm}mm" '
            f'viewBox="0 0 {layout.canvas_w_mm} {layout.canvas_h_mm}" '
            f'data-seed="{seed}" data-image-hash="{escape(image_hash)}" '
            f'data-style="{escape(style_fingerprint)}">'
        ),
        "<!-- gyotaku plotter output: paths only, single black layer -->",
        '<g id="pen-black" fill="none" stroke="#000000" stroke-width="0.35" '
        'stroke-linecap="round" stroke-linejoin="round">',
    ]
    sx = layout.px_to_mm
    ox = layout.offset_x_mm
    oy = layout.offset_y_mm
    for path in paths:
        pts = path.points
        if len(pts) < 2:
            continue
        cmds = [f"M {ox + pts[0, 0] * sx:.4f} {oy + pts[0, 1] * sx:.4f}"]
        for i in range(1, len(pts)):
            cmds.append(f"L {ox + pts[i, 0] * sx:.4f} {oy + pts[i, 1] * sx:.4f}")
        parts.append(f'<path d="{" ".join(cmds)}"/>')
    parts.append("</g>")
    parts.append("</svg>")
    parts.append("")
    return "\n".join(parts)


def render_preview_png(
    paths: list[StrokePath],
    layout: Layout,
    params: StyleParams,
    *,
    watermark: bool | None = None,
) -> np.ndarray:
    """Rasterize strokes onto a paper-textured canvas; return RGB uint8."""
    use_wm = params.watermark if watermark is None else watermark
    # Scale so longest canvas edge ≈ preview_px
    scale = params.preview_px / max(layout.canvas_w_mm, layout.canvas_h_mm)
    w = max(1, int(round(layout.canvas_w_mm * scale)))
    h = max(1, int(round(layout.canvas_h_mm * scale)))

    # Paper base with subtle warm fiber noise
    rng = np.random.default_rng(0xC0FFEE)  # fixed — texture is not artwork-deterministic-critical
    paper = np.ones((h, w, 3), dtype=np.float32) * np.array([0.96, 0.94, 0.90], dtype=np.float32)
    noise = rng.normal(0, params.paper_texture_strength, size=(h, w)).astype(np.float32)
    # Low-pass the noise
    noise = cv2.GaussianBlur(noise, (0, 0), 1.2)
    paper += noise[:, :, None]
    paper = np.clip(paper, 0, 1)

    ink = np.zeros((h, w), dtype=np.float32)
    mm_to_px = scale
    for path in paths:
        pts = path.points
        xs = layout.offset_x_mm + pts[:, 0] * layout.px_to_mm
        ys = layout.offset_y_mm + pts[:, 1] * layout.px_to_mm
        pix = np.stack([xs * mm_to_px, ys * mm_to_px], axis=1)
        pix = np.round(pix).astype(np.int32)
        if len(pix) >= 2:
            cv2.polylines(ink, [pix], isClosed=False, color=1.0, thickness=1, lineType=cv2.LINE_AA)

    # Slight ink bleed
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
) -> np.ndarray:
    """300 DPI render at final trim size for giclée path."""
    dpi = params.print_dpi
    w = max(1, int(round(layout.canvas_w_mm / 25.4 * dpi)))
    h = max(1, int(round(layout.canvas_h_mm / 25.4 * dpi)))
    scale = w / layout.canvas_w_mm

    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    ink = np.zeros((h, w), dtype=np.uint8)
    for path in paths:
        pts = path.points
        xs = layout.offset_x_mm + pts[:, 0] * layout.px_to_mm
        ys = layout.offset_y_mm + pts[:, 1] * layout.px_to_mm
        pix = np.stack([xs * scale, ys * scale], axis=1)
        pix = np.round(pix).astype(np.int32)
        if len(pix) >= 2:
            cv2.polylines(ink, [pix], isClosed=False, color=255, thickness=1, lineType=cv2.LINE_AA)

    if params.ink_bleed_px > 0:
        # Scale bleed with DPI relative to preview (~1600px ≈ preview)
        bleed = params.ink_bleed_px * (scale / (params.preview_px / max(layout.canvas_w_mm, layout.canvas_h_mm)))
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
