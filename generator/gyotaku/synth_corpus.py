"""Synthesize a fixed Phase 0 test corpus.

These are stand-ins until real photos (dogs, cats, fish, bird, bad inputs)
are dropped into corpus/images/. Filenames and seeds are stable so
regeneration is deterministic.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


CORPUS_SPEC: list[dict] = [
    # Good subjects — clear silhouette on simple background
    {"name": "01_fish_side.jpg", "kind": "fish", "bg": "plain", "seed": 101},
    {"name": "02_fish_held.jpg", "kind": "fish", "bg": "hands", "seed": 102},
    {"name": "03_dog_profile.jpg", "kind": "dog", "bg": "plain", "seed": 103},
    {"name": "04_dog_facing.jpg", "kind": "dog", "bg": "gradient", "seed": 104},
    {"name": "05_cat_sit.jpg", "kind": "cat", "bg": "plain", "seed": 105},
    {"name": "06_cat_curl.jpg", "kind": "cat", "bg": "gradient", "seed": 106},
    {"name": "07_bird_perch.jpg", "kind": "bird", "bg": "plain", "seed": 107},
    {"name": "08_fish_dark.jpg", "kind": "fish", "bg": "plain", "seed": 108, "dark": True},
    {"name": "09_dog_fur.jpg", "kind": "dog", "bg": "plain", "seed": 109, "furry": True},
    {"name": "10_fish_fin_detail.jpg", "kind": "fish", "bg": "gradient", "seed": 110},
    {"name": "11_cat_high_contrast.jpg", "kind": "cat", "bg": "plain", "seed": 111},
    {"name": "12_dog_low_angle.jpg", "kind": "dog", "bg": "gradient", "seed": 112},
    {"name": "13_fish_small_margin.jpg", "kind": "fish", "bg": "plain", "seed": 113, "tight": True},
    {"name": "14_bird_wing.jpg", "kind": "bird", "bg": "gradient", "seed": 114},
    # Borderline
    {"name": "15_fish_busy_ok.jpg", "kind": "fish", "bg": "busy_mild", "seed": 115},
    {"name": "16_dog_shadow.jpg", "kind": "dog", "bg": "shadow", "seed": 116},
    # Deliberately bad — should REJECT (camouflaged / ruined for rembg)
    {"name": "17_bad_busy_bg.jpg", "kind": "fish", "bg": "busy", "seed": 117, "camouflage": True, "expect": "reject"},
    {"name": "18_bad_motion_blur.jpg", "kind": "dog", "bg": "plain", "seed": 118, "blur": 35, "motion": True, "noise": 55, "camouflage": True, "expect": "reject"},
    {"name": "19_bad_low_light.jpg", "kind": "cat", "bg": "dark", "seed": 119, "noise": 40, "expect": "reject"},
    {"name": "20_bad_no_subject.jpg", "kind": "none", "bg": "empty", "seed": 120, "expect": "reject"},
]


def write_corpus(output_dir: str | Path) -> int:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    # Drop stale files so renames/removals in CORPUS_SPEC stick
    for old in output_dir.glob("*"):
        if old.is_file():
            old.unlink()
    for spec in CORPUS_SPEC:
        rgb = render_scene(spec)
        Image.fromarray(rgb, mode="RGB").save(
            output_dir / spec["name"], format="JPEG", quality=92, optimize=True
        )
    return len(CORPUS_SPEC)


def render_scene(spec: dict) -> np.ndarray:
    rng = np.random.default_rng(spec["seed"])
    h, w = 1200, 1600
    bg = _background(spec.get("bg", "plain"), h, w, rng)
    mask, texture = _subject(spec["kind"], h, w, rng, spec)

    if spec.get("tiny"):
        # Shrink subject to a speck — rembg either misses it or returns junk
        small = cv2.resize(mask, (max(8, w // 28), max(8, h // 28)), interpolation=cv2.INTER_NEAREST)
        tex_s = cv2.resize(texture, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_LINEAR)
        mask = np.zeros_like(mask)
        texture = np.zeros_like(texture)
        y0, x0 = int(h * 0.55), int(w * 0.55)
        mask[y0 : y0 + small.shape[0], x0 : x0 + small.shape[1]] = small
        texture[y0 : y0 + tex_s.shape[0], x0 : x0 + tex_s.shape[1]] = tex_s

    if spec.get("tight"):
        # Subject fills most of frame
        ys, xs = np.where(mask > 0)
        if len(xs):
            x0, x1 = xs.min(), xs.max()
            y0, y1 = ys.min(), ys.max()
            crop = mask[y0:y1, x0:x1]
            tex_c = texture[y0:y1, x0:x1]
            mask = cv2.resize(crop, (w, h), interpolation=cv2.INTER_NEAREST)
            texture = cv2.resize(tex_c, (w, h), interpolation=cv2.INTER_LINEAR)

    if spec.get("camouflage"):
        # Paint subject with background-like texture so rembg cannot isolate it
        texture = bg.copy()
        texture = texture.astype(np.float32)
        texture += rng.normal(0, 8, size=texture.shape)
        texture = np.clip(texture, 0, 255).astype(np.uint8)

    a = (mask.astype(np.float32) / 255.0)[:, :, None]
    rgb = (texture.astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)

    if spec.get("dark"):
        rgb = (rgb.astype(np.float32) * 0.55).astype(np.uint8)
    if spec.get("motion"):
        # Directional smear — kills silhouette for rembg
        k = int(spec.get("blur", 25))
        kernel = np.zeros((1, k), dtype=np.float32)
        kernel[0, :] = 1.0 / k
        rgb = cv2.filter2D(rgb, -1, kernel)
        rgb = cv2.GaussianBlur(rgb, (0, 0), 3.0)
    elif spec.get("blur"):
        k = int(spec["blur"]) * 2 + 1
        rgb = cv2.GaussianBlur(rgb, (k, k), float(spec["blur"]))
    if spec.get("bg") == "dark":
        rgb = (rgb.astype(np.float32) * 0.12).astype(np.uint8)
    if spec.get("noise"):
        rgb = np.clip(
            rgb.astype(np.float32) + rng.normal(0, float(spec["noise"]), size=rgb.shape),
            0,
            255,
        ).astype(np.uint8)

    return rgb


def _background(kind: str, h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    if kind == "plain":
        base = np.array([220, 215, 205], dtype=np.float32)
        img = np.ones((h, w, 3), dtype=np.float32) * base
        img += rng.normal(0, 3, size=img.shape)
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind == "gradient":
        ys = np.linspace(200, 240, h)[:, None]
        xs = np.linspace(190, 230, w)[None, :]
        g = (ys + xs) / 2
        img = np.stack([g, g * 0.98, g * 0.92], axis=-1)
        img += rng.normal(0, 2, size=img.shape)
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind == "hands":
        img = _background("plain", h, w, rng).astype(np.float32)
        # Soft skin-tone blobs at bottom (hands holding)
        for _ in range(3):
            cx = int(rng.integers(w * 0.2, w * 0.8))
            cy = int(rng.integers(h * 0.65, h * 0.95))
            axes = (int(rng.integers(120, 220)), int(rng.integers(60, 120)))
            overlay = img.copy()
            cv2.ellipse(overlay, (cx, cy), axes, float(rng.integers(0, 40)), 0, 360, (210, 170, 140), -1)
            img = cv2.addWeighted(img, 0.55, overlay, 0.45, 0)
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind == "shadow":
        img = _background("gradient", h, w, rng).astype(np.float32)
        vv = np.linspace(0.7, 1.0, w)[None, :, None]
        img *= vv
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind == "dark":
        img = np.ones((h, w, 3), dtype=np.float32) * 30
        img += rng.normal(0, 5, size=img.shape)
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind in ("busy", "busy_mild"):
        img = rng.integers(40, 220, size=(h, w, 3), dtype=np.uint8).astype(np.float32)
        img = cv2.GaussianBlur(img, (0, 0), 3 if kind == "busy" else 8)
        # Add shapes
        for _ in range(40 if kind == "busy" else 12):
            color = tuple(int(c) for c in rng.integers(0, 255, size=3))
            pt1 = (int(rng.integers(0, w)), int(rng.integers(0, h)))
            pt2 = (int(rng.integers(0, w)), int(rng.integers(0, h)))
            cv2.rectangle(img, pt1, pt2, color, thickness=-1 if rng.random() < 0.3 else 2)
        return np.clip(img, 0, 255).astype(np.uint8)
    if kind == "empty":
        # Smooth featureless field — rembg returns an empty / near-empty matte
        ys = np.linspace(180, 210, h)[:, None]
        xs = np.linspace(185, 205, w)[None, :]
        g = (ys + xs) * 0.5
        img = np.stack([g, g, g], axis=-1)
        img += rng.normal(0, 1.5, size=img.shape)
        return np.clip(img, 0, 255).astype(np.uint8)
    return _background("plain", h, w, rng)


def _subject(
    kind: str,
    h: int,
    w: int,
    rng: np.random.Generator,
    spec: dict,
) -> tuple[np.ndarray, np.ndarray]:
    mask = np.zeros((h, w), dtype=np.uint8)
    if kind == "none":
        return mask, np.zeros((h, w, 3), dtype=np.uint8)
    cx, cy = w // 2, h // 2
    if kind == "fish":
        body = (int(w * 0.28), int(h * 0.12))
        cv2.ellipse(mask, (cx - 40, cy), body, 0, 0, 360, 255, -1)
        # Tail
        tail = np.array(
            [
                [cx - body[0] - 20, cy],
                [cx - body[0] - 140, cy - 90],
                [cx - body[0] - 140, cy + 90],
            ],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(mask, tail, 255)
        # Fin
        fin = np.array(
            [[cx, cy - body[1]], [cx + 40, cy - body[1] - 80], [cx + 80, cy - body[1]]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(mask, fin, 255)
        # Eye hole (not cut — darker in texture)
    elif kind == "dog":
        # Body
        cv2.ellipse(mask, (cx, cy + 40), (int(w * 0.18), int(h * 0.14)), 0, 0, 360, 255, -1)
        # Head
        cv2.ellipse(mask, (cx + int(w * 0.14), cy - 40), (90, 80), 0, 0, 360, 255, -1)
        # Ear
        ear = np.array(
            [
                [cx + int(w * 0.10), cy - 100],
                [cx + int(w * 0.06), cy - 200],
                [cx + int(w * 0.18), cy - 120],
            ],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(mask, ear, 255)
        # Snout
        cv2.ellipse(mask, (cx + int(w * 0.22), cy - 20), (70, 40), 10, 0, 360, 255, -1)
        # Legs
        for lx in (-80, -20, 40, 90):
            cv2.rectangle(
                mask,
                (cx + lx - 18, cy + 80),
                (cx + lx + 18, cy + 220),
                255,
                -1,
            )
    elif kind == "cat":
        cv2.ellipse(mask, (cx, cy + 20), (int(w * 0.14), int(h * 0.12)), 0, 0, 360, 255, -1)
        cv2.circle(mask, (cx + int(w * 0.12), cy - 60), 70, 255, -1)
        # Ears
        for sign in (-1, 1):
            ear = np.array(
                [
                    [cx + int(w * 0.12) + sign * 30, cy - 100],
                    [cx + int(w * 0.12) + sign * 55, cy - 190],
                    [cx + int(w * 0.12) + sign * 5, cy - 120],
                ],
                dtype=np.int32,
            )
            cv2.fillConvexPoly(mask, ear, 255)
        # Tail
        for t in range(40):
            ang = t / 40 * math.pi * 0.8
            x = int(cx - 120 - math.cos(ang) * 100)
            y = int(cy + 40 - math.sin(ang) * 80)
            cv2.circle(mask, (x, y), 14, 255, -1)
    else:  # bird
        cv2.ellipse(mask, (cx, cy), (70, 100), -20, 0, 360, 255, -1)
        cv2.circle(mask, (cx + 50, cy - 90), 40, 255, -1)
        wing = np.array(
            [[cx - 20, cy - 20], [cx - 180, cy - 40], [cx - 40, cy + 60]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(mask, wing, 255)
        beak = np.array(
            [[cx + 80, cy - 90], [cx + 140, cy - 80], [cx + 80, cy - 70]],
            dtype=np.int32,
        )
        cv2.fillConvexPoly(mask, beak, 255)

    # Soften silhouette
    mask = cv2.GaussianBlur(mask, (0, 0), 2.0)
    _, mask = cv2.threshold(mask, 40, 255, cv2.THRESH_BINARY)

    # Texture inside subject — scale / fur / ink-like mottling
    texture = _subject_texture(mask, kind, rng, furry=bool(spec.get("furry")))
    return mask, texture


def _subject_texture(
    mask: np.ndarray,
    kind: str,
    rng: np.random.Generator,
    furry: bool = False,
) -> np.ndarray:
    h, w = mask.shape
    # Base coloration
    if kind == "fish":
        base = np.array([40, 90, 120], dtype=np.float32)
    elif kind == "dog":
        base = np.array([90, 70, 45], dtype=np.float32)
    elif kind == "cat":
        base = np.array([60, 60, 65], dtype=np.float32)
    else:
        base = np.array([50, 55, 70], dtype=np.float32)

    tex = np.ones((h, w, 3), dtype=np.float32) * base
    noise = rng.normal(0, 18, size=(h, w)).astype(np.float32)
    noise = cv2.GaussianBlur(noise, (0, 0), 2.5)
    tex += noise[:, :, None]

    # Form shading along the body axis (horizontal) — gives structure-tensor
    # a coherent along-body orientation instead of concentric swirls.
    yy = np.linspace(-1, 1, h)[:, None]
    xx = np.linspace(-1, 1, w)[None, :]
    shade = 0.72 + 0.28 * (1.0 - np.abs(yy) * 0.85) + 0.12 * xx
    # Soft belly highlight / back darkening
    shade -= 0.18 * np.clip(yy, 0, 1)
    tex *= shade[:, :, None]

    # Dense body-aligned streaks drive flowfield orientation
    n_streaks = 220 if kind in ("dog", "cat", "bird") or furry else 140
    base_ang = 0.0 if kind != "bird" else -0.35
    for _ in range(n_streaks):
        x0 = int(rng.integers(0, w))
        y0 = int(rng.integers(0, h))
        if mask[y0, x0] == 0:
            continue
        ang = base_ang + float(rng.uniform(-0.25, 0.25))
        length = int(rng.integers(25, 70))
        x1 = int(x0 + math.cos(ang) * length)
        y1 = int(y0 + math.sin(ang) * length)
        color = tuple(int(c) for c in (base + rng.normal(0, 30, 3)).clip(0, 255))
        cv2.line(tex, (x0, y0), (x1, y1), color, 1, cv2.LINE_AA)

    if kind == "fish":
        # Scale rows following the body
        ys, xs = np.where(mask > 0)
        if len(xs):
            pick = rng.choice(len(xs), size=min(500, len(xs)), replace=False)
            for i in pick:
                cv2.ellipse(
                    tex,
                    (int(xs[i]), int(ys[i])),
                    (int(rng.integers(3, 7)), int(rng.integers(2, 4))),
                    0,
                    0,
                    360,
                    (30, 70, 100),
                    1,
                )

    # Eye
    if kind != "bird":
        cv2.circle(tex, (w // 2 + 80, h // 2 - 20), 12, (10, 10, 10), -1)
        cv2.circle(tex, (w // 2 + 84, h // 2 - 24), 4, (220, 220, 220), -1)

    tex = np.clip(tex, 0, 255).astype(np.uint8)
    # Apply mask softness later in composite; here full texture
    return tex
