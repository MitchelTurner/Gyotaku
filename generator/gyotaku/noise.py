"""Deterministic value-noise / fBm helpers (no external noise dependency)."""

from __future__ import annotations

import numpy as np


def _fade(t: np.ndarray) -> np.ndarray:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def value_noise2d(
    x: np.ndarray,
    y: np.ndarray,
    rng: np.random.Generator,
    table_size: int = 256,
) -> np.ndarray:
    """
    Smooth value noise sampled at coordinates x,y (same shape).
    Lattice hashed from a seeded permutation table.
    """
    perm = rng.permutation(table_size)
    perm = np.concatenate([perm, perm])

    # Random lattice values in [-1, 1]
    values = rng.random(table_size) * 2.0 - 1.0

    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = x - x0
    fy = y - y0
    ux = _fade(fx)
    uy = _fade(fy)

    x0m = x0 % table_size
    y0m = y0 % table_size
    x1m = (x0 + 1) % table_size
    y1m = (y0 + 1) % table_size

    def lattice(ix: np.ndarray, iy: np.ndarray) -> np.ndarray:
        return values[perm[(perm[ix] + iy) % (table_size * 2)] % table_size]

    n00 = lattice(x0m, y0m)
    n10 = lattice(x1m, y0m)
    n01 = lattice(x0m, y1m)
    n11 = lattice(x1m, y1m)
    nx0 = n00 * (1 - ux) + n10 * ux
    nx1 = n01 * (1 - ux) + n11 * ux
    return nx0 * (1 - uy) + nx1 * uy


def fbm2d(
    x: np.ndarray,
    y: np.ndarray,
    rng: np.random.Generator,
    octaves: int = 4,
    lacunarity: float = 2.0,
    gain: float = 0.5,
) -> np.ndarray:
    amp = 1.0
    freq = 1.0
    total = np.zeros_like(x, dtype=np.float64)
    norm = 0.0
    for i in range(octaves):
        # Independent lattice per octave
        octave_rng = np.random.default_rng(rng.integers(0, 2**31 - 1))
        total += amp * value_noise2d(x * freq, y * freq, octave_rng)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return (total / max(norm, 1e-9)).astype(np.float32)
