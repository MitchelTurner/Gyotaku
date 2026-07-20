"""Shared mark-strategy interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from gyotaku.params import StyleParams
from gyotaku.tonal import TonalMaps, VectorField


@dataclass
class Path:
    """A single polyline in processing-pixel coordinates (cropped subject space)."""

    points: np.ndarray  # Nx2 float32, columns (x, y)


class MarkStrategy(ABC):
    name: str

    @abstractmethod
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
        raise NotImplementedError


def get_strategy(name: str) -> MarkStrategy:
    from gyotaku.marks.contour import ContourStrategy
    from gyotaku.marks.flowfield import FlowfieldStrategy
    from gyotaku.marks.stipple import StippleStrategy

    strategies: dict[str, MarkStrategy] = {
        "flowfield": FlowfieldStrategy(),
        "contour": ContourStrategy(),
        "stipple": StippleStrategy(),
    }
    if name not in strategies:
        raise ValueError(f"Unknown mark strategy '{name}'. Choose from: {sorted(strategies)}")
    return strategies[name]


def generate_marks(tonal: TonalMaps, params: StyleParams, rng: np.random.Generator) -> list[Path]:
    strategy = get_strategy(params.strategy)
    return strategy.generate(
        luminance=tonal.luminance,
        orientation=tonal.orientation,
        edges=tonal.edges,
        matte=tonal.matte,
        params=params,
        rng=rng,
    )


def paths_point_count(paths: Sequence[Path]) -> int:
    return int(sum(p.points.shape[0] for p in paths))
