"""Image ingest and normalization."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass


@dataclass
class IngestedImage:
    """Normalized processing image + original for final raster."""

    process_rgb: np.ndarray  # HxWx3 uint8, longest edge capped
    original_rgb: np.ndarray  # HxWx3 uint8, EXIF-rotated, EXIF stripped
    image_hash: str
    path: Path


class IngestError(ValueError):
    pass


def _to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        composed = Image.alpha_composite(background, img.convert("RGBA"))
        return composed.convert("RGB")
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def load_and_normalize(path: str | Path, process_long_edge: int, min_short_edge: int) -> IngestedImage:
    path = Path(path)
    if not path.exists():
        raise IngestError(f"File not found: {path}")

    with Image.open(path) as raw:
        # Auto-rotate from EXIF, then drop EXIF by round-tripping pixels only
        rotated = ImageOps.exif_transpose(raw)
        rgb = _to_rgb(rotated)
        original = np.asarray(rgb, dtype=np.uint8).copy()

    h, w = original.shape[:2]
    short = min(h, w)
    if short < min_short_edge:
        raise IngestError(
            f"Image too small: short edge is {short}px (minimum {min_short_edge}px)."
        )

    image_hash = hashlib.sha256(original.tobytes()).hexdigest()

    long_edge = max(h, w)
    if long_edge > process_long_edge:
        scale = process_long_edge / float(long_edge)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        process_img = Image.fromarray(original).resize((new_w, new_h), Image.Resampling.LANCZOS)
        process_rgb = np.asarray(process_img, dtype=np.uint8)
    else:
        process_rgb = original.copy()

    return IngestedImage(
        process_rgb=process_rgb,
        original_rgb=original,
        image_hash=image_hash,
        path=path,
    )
