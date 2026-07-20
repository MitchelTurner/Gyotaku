"""Run the generator across the fixed corpus and build a contact sheet."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from tqdm import tqdm

from gyotaku.params import StyleParams
from gyotaku.pipeline import GenerationError, generate


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"}


def list_corpus_images(corpus_dir: Path) -> list[Path]:
    files = sorted(
        p for p in corpus_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )
    return files


def run_corpus(
    corpus_dir: Path,
    output_dir: Path,
    *,
    params: StyleParams | None = None,
    seed: int = 0,
) -> dict[str, Any]:
    params = params or StyleParams()
    corpus_dir = Path(corpus_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    images = list_corpus_images(corpus_dir)
    if not images:
        raise FileNotFoundError(f"No corpus images in {corpus_dir}. Run: gyotaku make-corpus")

    results = []
    ready = rejected = failed = 0
    previews: list[tuple[str, np.ndarray | None, str]] = []

    for img in tqdm(images, desc="corpus"):
        out = output_dir / img.stem
        status = "FAILED"
        reason = None
        preview = None
        try:
            result = generate(img, out, params=params, seed=seed, write_print=False, progress=None)
            if result.rejected:
                status = "REJECTED"
                rejected += 1
                reason = result.failure_reason
            else:
                status = "READY"
                ready += 1
                preview = np.asarray(Image.open(result.preview_path).convert("RGB"))
        except (GenerationError, Exception) as e:
            failed += 1
            reason = str(e)
            status = "FAILED"

        results.append(
            {
                "image": img.name,
                "status": status,
                "reason": reason,
                "output": str(out),
            }
        )
        previews.append((img.name, preview, status))

    sheet_path = output_dir / "contact_sheet.png"
    _write_contact_sheet(previews, sheet_path)

    summary = {
        "ready": ready,
        "rejected": rejected,
        "failed": failed,
        "total": len(images),
        "seed": seed,
        "styleFingerprint": params.fingerprint(),
        "contactSheet": str(sheet_path),
        "results": results,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def _write_contact_sheet(
    items: list[tuple[str, np.ndarray | None, str]],
    path: Path,
    cell_w: int = 400,
    cell_h: int = 520,
    cols: int = 5,
) -> None:
    n = len(items)
    rows = max(1, (n + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (245, 242, 235))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except OSError:
        font = ImageFont.load_default()
        font_sm = font

    for i, (name, preview, status) in enumerate(items):
        r, c = divmod(i, cols)
        x0, y0 = c * cell_w, r * cell_h
        # Label
        draw.rectangle([x0, y0, x0 + cell_w - 1, y0 + 36], fill=(235, 230, 220))
        draw.text((x0 + 8, y0 + 8), f"{name}", fill=(20, 20, 20), font=font_sm)
        draw.text((x0 + 8, y0 + 22), status, fill=(80, 80, 80), font=font_sm)

        if preview is None:
            draw.text((x0 + 40, y0 + cell_h // 2), status, fill=(120, 60, 60), font=font)
            continue

        img = Image.fromarray(preview, mode="RGB")
        img.thumbnail((cell_w - 16, cell_h - 52), Image.Resampling.LANCZOS)
        px = x0 + (cell_w - img.width) // 2
        py = y0 + 44 + (cell_h - 52 - img.height) // 2
        sheet.paste(img, (px, py))

    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, format="PNG", optimize=True)
