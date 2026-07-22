"""Style parameters for the gyotaku generator.

Every tunable constant lives here so (imageHash, styleParams, seed)
can reproduce byte-identical output.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Literal, Optional


CanvasSize = Literal["A3", "A2", "18x24in"]
MarkStrategyName = Literal["flowfield", "contour", "stipple"]

# Physical canvas sizes in millimetres (width × height, landscape available via rotate)
CANVAS_MM: dict[str, tuple[float, float]] = {
    "A3": (297.0, 420.0),
    "A2": (420.0, 594.0),
    "18x24in": (457.2, 609.6),
}

# Life-size print: measured fish length (nose–tail) in inches
MIN_FISH_LENGTH_IN = 4.0
MAX_FISH_LENGTH_IN = 60.0
INCH_TO_MM = 25.4


@dataclass(frozen=True)
class StyleParams:
    """All knobs that affect visual output. Defaults tuned for flowfield."""

    strategy: MarkStrategyName = "flowfield"

    # Canvas / layout
    canvas: CanvasSize = "A3"
    margin_mm: float = 25.0
    subject_fill: float = 0.72  # subject bbox as fraction of drawable area
    # When set, the fish long edge is plotted at exactly this length (inches).
    # Paper grows to fit (margins included). None = fit to named canvas via subject_fill.
    fish_length_in: Optional[float] = None

    # Ingest
    process_long_edge: int = 2048
    mark_long_edge: int = 1024  # tonal + marks at this scale (paths scaled to match)
    min_short_edge: int = 600

    # Segmentation
    matte_score_threshold: float = 0.40
    matte_feather_px: float = 1.5
    crop_margin_ratio: float = 0.08

    # Tonal
    clahe_clip: float = 2.5
    clahe_grid: int = 8
    posterize_levels: int = 4  # 3–6
    orientation_sigma: float = 5.0
    edge_low: int = 40
    edge_high: int = 120

    # Flowfield marks
    seed_count: int = 4200
    step_px: float = 1.35
    max_stroke_length_px: float = 90.0
    max_cum_angle_rad: float = 1.35
    min_separation_light: float = 4.5  # white / light regions
    min_separation_dark: float = 1.25  # near-black
    density_gamma: float = 1.45  # seed bias toward dark
    min_stroke_points: int = 5

    # Contour (secondary)
    contour_hatch_base: float = 2.5

    # Stipple (tertiary)
    stipple_points: int = 8000
    stipple_lloyd_iters: int = 4

    # Ink physics — keep barely perceptible
    jitter_amplitude: float = 0.14
    jitter_scale: float = 36.0
    jitter_region_scale: float = 110.0
    dropout_threshold: float = 0.10
    dropout_scale: float = 65.0
    contact_edge_boost: float = 0.4
    edge_pass_spacing: float = 1.5
    edge_pass_length_px: float = 14.0
    edge_pass_density: float = 0.28

    # Output
    douglas_peucker_epsilon_mm: float = 0.04
    optimize_time_budget_s: float = 2.0
    preview_px: int = 1600
    print_dpi: int = 300
    paper_texture_strength: float = 0.06
    ink_bleed_px: float = 0.6
    watermark: bool = False

    # Misc
    rng_stream: int = 0  # reserved for multi-stream expansion

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def canonical_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()[:16]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StyleParams:
        known = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in data.items() if k in known}
        if "fish_length_in" in filtered:
            raw = filtered["fish_length_in"]
            if raw is None or raw == "":
                filtered["fish_length_in"] = None
            else:
                filtered["fish_length_in"] = float(raw)
        return cls(**filtered)

    @classmethod
    def from_json_file(cls, path: str) -> StyleParams:
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


# Named presets mapping UI-ish controls to params
PRESETS: dict[str, dict[str, Any]] = {
    "default": {},
    "dense": {
        "posterize_levels": 5,
        "seed_count": 6500,
        "min_separation_light": 3.4,
        "min_separation_dark": 0.95,
    },
    "sparse": {
        "posterize_levels": 3,
        "seed_count": 2800,
        "min_separation_light": 5.5,
        "min_separation_dark": 1.6,
    },
    "soft_ink": {
        "jitter_amplitude": 0.55,
        "dropout_threshold": 0.28,
        "edge_pass_density": 0.22,
    },
    "crisp": {
        "jitter_amplitude": 0.15,
        "dropout_threshold": 0.08,
        "edge_pass_density": 0.45,
        "matte_feather_px": 1.0,
    },
}


def resolve_params(
    base: StyleParams | None = None,
    overrides: dict[str, Any] | None = None,
    preset: str | None = None,
) -> StyleParams:
    data = (base or StyleParams()).to_dict()
    if preset:
        if preset not in PRESETS:
            raise ValueError(f"Unknown preset '{preset}'. Choose from: {sorted(PRESETS)}")
        data.update(PRESETS[preset])
    if overrides:
        data.update(overrides)
    # Clamp posterize
    levels = int(data.get("posterize_levels", 4))
    data["posterize_levels"] = max(3, min(6, levels))
    # Clamp / clear fish length
    fl = data.get("fish_length_in")
    if fl is None or fl == "":
        data["fish_length_in"] = None
    else:
        data["fish_length_in"] = max(
            MIN_FISH_LENGTH_IN, min(MAX_FISH_LENGTH_IN, float(fl))
        )
    return StyleParams.from_dict(data)
