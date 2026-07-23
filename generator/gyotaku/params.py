"""Style parameters for the gyotaku generator.

Every tunable constant lives here so (imageHash, styleParams, seed)
can reproduce byte-identical output.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Literal, Optional

from gyotaku.salmon import (
    normalize_side,
    normalize_species,
    side_density_overrides,
    species_density_overrides,
)


CanvasSize = Literal["A3", "A2", "18x24in"]
MarkStrategyName = Literal["flowfield", "contour", "stipple"]
SpeciesTag = Literal["chinook", "coho", "sockeye", "other"]
SideTag = Literal["left", "right", "unknown"]

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

    # Optional subject tags — nudge mark density / presentation
    species: Optional[SpeciesTag] = None
    side: Optional[SideTag] = None
    # Mirror subject after matte (set automatically for side=right)
    flip_horizontal: bool = False

    # Ingest
    process_long_edge: int = 2048
    # Higher mark resolution keeps scale / fin texture before stroke tracing
    mark_long_edge: int = 1536
    min_short_edge: int = 600

    # Segmentation
    matte_score_threshold: float = 0.40
    matte_feather_px: float = 1.5
    crop_margin_ratio: float = 0.08
    # Extra confidence budget for fish-like silhouettes (fins / aspect)
    salmon_matte_enabled: bool = True

    # Tonal — finer CLAHE + more bands so mottling / scales get distinct density
    clahe_clip: float = 3.2
    clahe_grid: int = 16
    posterize_levels: int = 5  # 3–6
    # Lower sigma = orientation follows local anatomy, not just body silhouette
    orientation_sigma: float = 2.5
    edge_low: int = 35
    edge_high: int = 110

    # Flowfield marks — denser, shorter strokes resolve gill / fin / scale detail
    seed_count: int = 5500
    step_px: float = 1.25
    max_stroke_length_px: float = 55.0
    max_cum_angle_rad: float = 0.85
    min_separation_light: float = 3.5  # white / light regions
    min_separation_dark: float = 1.15  # near-black
    density_gamma: float = 1.55  # seed bias toward dark
    min_stroke_points: int = 4

    # Contour (secondary)
    contour_hatch_base: float = 2.5

    # Stipple (tertiary)
    stipple_points: int = 8000
    stipple_lloyd_iters: int = 4

    # Ink physics — slight hand tremor; edge pass carries anatomical accents
    jitter_amplitude: float = 0.35
    jitter_scale: float = 36.0
    jitter_region_scale: float = 110.0
    dropout_threshold: float = 0.10
    dropout_scale: float = 65.0
    contact_edge_boost: float = 0.55
    edge_pass_spacing: float = 1.0
    edge_pass_length_px: float = 28.0
    edge_pass_density: float = 0.55
    # Fraction of edge-pass strokes drawn perpendicular to flow (scale ticks)
    edge_pass_crossgrain: float = 0.40

    # Photo-faithful detail — continuous lines from the image (not orientation swirls)
    detail_silhouette_enabled: bool = True
    detail_silhouette_stride: int = 2
    detail_silhouette_double: bool = False  # single confident outline reads cleaner
    detail_eye_enabled: bool = True
    detail_eye_stride: float = 1.5
    # Forced gill plate + jaw in the head region
    detail_operculum_enabled: bool = True
    detail_operculum_offset: float = 0.10  # fraction of body length behind the eye
    detail_operculum_segments: int = 28
    # Fan strokes inside dorsal / caudal / anal protrusions
    detail_fin_rays_enabled: bool = True
    detail_fin_ray_count: int = 7
    detail_fin_ray_length: float = 0.92  # fraction of base→tip distance
    detail_fin_max_fins: int = 6
    detail_edge_enabled: bool = True
    detail_edge_stride: int = 2
    detail_edge_min_points: int = 10
    detail_edge_min_length_px: float = 28.0
    detail_edge_max_paths: int = 180
    detail_ridge_enabled: bool = True
    detail_ridge_stride: int = 2
    detail_ridge_min_length_px: float = 36.0
    detail_ridge_max_paths: int = 90
    # Off by default — iso-luminance bands read as topo swirls, not fish anatomy
    detail_contour_enabled: bool = False
    detail_contour_blend: float = 0.35  # 0–1 how many iso-luminance form lines to keep
    detail_contour_stride: int = 3
    detail_contour_min_length_px: float = 70.0
    detail_contour_max_paths: int = 40
    # Scale down pure flowfield fill so feature lines stay readable
    detail_flowfield_seed_scale: float = 0.22
    # Blend structure-tensor orientation toward the fish long-axis / centerline
    body_axis_blend: float = 0.55
    # Shorten fill strokes near the head (1 = no change, 0.3 = much shorter)
    head_stroke_scale: float = 0.45

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
        if "species" in filtered:
            filtered["species"] = normalize_species(filtered["species"])
        if "side" in filtered:
            filtered["side"] = normalize_side(filtered["side"])
        if "flip_horizontal" in filtered:
            filtered["flip_horizontal"] = bool(filtered["flip_horizontal"])
        if "salmon_matte_enabled" in filtered:
            filtered["salmon_matte_enabled"] = bool(filtered["salmon_matte_enabled"])
        return cls(**filtered)

    @classmethod
    def from_json_file(cls, path: str) -> StyleParams:
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


# Named presets mapping UI-ish controls to params
PRESETS: dict[str, dict[str, Any]] = {
    "default": {},
    "dense": {
        "posterize_levels": 6,
        "seed_count": 7000,
        "min_separation_light": 2.8,
        "min_separation_dark": 0.85,
        "orientation_sigma": 2.0,
        "max_stroke_length_px": 45.0,
        "edge_pass_density": 0.65,
        "edge_pass_length_px": 32.0,
    },
    "sparse": {
        "posterize_levels": 3,
        "seed_count": 2800,
        "min_separation_light": 5.5,
        "min_separation_dark": 1.6,
        "max_stroke_length_px": 70.0,
        "orientation_sigma": 3.0,
    },
    "soft_ink": {
        "jitter_amplitude": 0.55,
        "dropout_threshold": 0.28,
        "edge_pass_density": 0.35,
    },
    "crisp": {
        "jitter_amplitude": 0.18,
        "dropout_threshold": 0.08,
        "edge_pass_density": 0.65,
        "edge_pass_length_px": 32.0,
        "matte_feather_px": 1.0,
        "orientation_sigma": 2.0,
        "max_stroke_length_px": 48.0,
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

    # Species / side tags apply mild density nudges unless the caller already
    # set those density keys explicitly in overrides.
    override_keys = set(overrides.keys()) if overrides else set()
    for key, value in species_density_overrides(data.get("species")).items():
        if key not in override_keys:
            data[key] = value
    for key, value in side_density_overrides(data.get("side")).items():
        if key not in override_keys and key != "flip_horizontal":
            data[key] = value
        elif key == "flip_horizontal" and "flip_horizontal" not in override_keys:
            data[key] = value

    # Clamp posterize / cross-grain fraction
    levels = int(data.get("posterize_levels", 5))
    data["posterize_levels"] = max(3, min(6, levels))
    cg = float(data.get("edge_pass_crossgrain", 0.4))
    data["edge_pass_crossgrain"] = max(0.0, min(1.0, cg))
    data["detail_contour_blend"] = max(
        0.0, min(1.0, float(data.get("detail_contour_blend", 0.35)))
    )
    data["detail_flowfield_seed_scale"] = max(
        0.12, min(1.0, float(data.get("detail_flowfield_seed_scale", 0.22)))
    )
    data["body_axis_blend"] = max(
        0.0, min(1.0, float(data.get("body_axis_blend", 0.55)))
    )
    data["head_stroke_scale"] = max(
        0.2, min(1.0, float(data.get("head_stroke_scale", 0.45)))
    )
    data["detail_operculum_offset"] = max(
        0.04, min(0.25, float(data.get("detail_operculum_offset", 0.10)))
    )
    for flag in (
        "detail_silhouette_enabled",
        "detail_silhouette_double",
        "detail_eye_enabled",
        "detail_operculum_enabled",
        "detail_fin_rays_enabled",
        "detail_edge_enabled",
        "detail_ridge_enabled",
        "detail_contour_enabled",
    ):
        if flag in data:
            data[flag] = bool(data[flag])
    # Clamp / clear fish length
    fl = data.get("fish_length_in")
    if fl is None or fl == "":
        data["fish_length_in"] = None
    else:
        data["fish_length_in"] = max(
            MIN_FISH_LENGTH_IN, min(MAX_FISH_LENGTH_IN, float(fl))
        )
    data["species"] = normalize_species(data.get("species"))
    data["side"] = normalize_side(data.get("side"))
    return StyleParams.from_dict(data)
