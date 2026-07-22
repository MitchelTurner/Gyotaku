"""Corpus regression gate — compare a run summary against committed baseline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_MATTE_ABS = 0.08
DEFAULT_PATH_REL = 0.25  # ±25% path-count drift


class CorpusGateError(Exception):
    """One or more corpus metrics drifted past tolerance."""

    def __init__(self, failures: list[str]):
        self.failures = failures
        super().__init__("\n".join(failures))


def load_baseline(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def compare_summary_to_baseline(
    summary: dict[str, Any],
    baseline: dict[str, Any],
    *,
    matte_abs: float | None = None,
    path_rel: float | None = None,
) -> list[str]:
    """
    Return a list of failure messages (empty = pass).

    Checks:
      - per-image status vs expected (READY / REJECTED)
      - matteScore absolute drift (when both present)
      - pathCount relative drift (READY only, when both present)
    """
    matte_tol = float(
        matte_abs if matte_abs is not None else baseline.get("matteAbsTol", DEFAULT_MATTE_ABS)
    )
    path_tol = float(
        path_rel if path_rel is not None else baseline.get("pathRelTol", DEFAULT_PATH_REL)
    )

    by_image = {r["image"]: r for r in summary.get("results", [])}
    failures: list[str] = []

    for entry in baseline.get("images", []):
        name = entry["image"]
        expected_status = entry["status"]
        got = by_image.get(name)
        if got is None:
            failures.append(f"{name}: missing from summary")
            continue

        if got["status"] != expected_status:
            failures.append(
                f"{name}: status {got['status']} (expected {expected_status})"
            )
            continue

        exp_matte = entry.get("matteScore")
        got_matte = got.get("matteScore")
        if exp_matte is not None and got_matte is not None:
            if abs(float(got_matte) - float(exp_matte)) > matte_tol:
                failures.append(
                    f"{name}: matteScore {got_matte:.3f} drifted from "
                    f"{exp_matte:.3f} (tol ±{matte_tol})"
                )

        if expected_status == "READY":
            exp_paths = entry.get("pathCount")
            got_paths = got.get("pathCount")
            if exp_paths is not None and got_paths is not None and exp_paths > 0:
                rel = abs(int(got_paths) - int(exp_paths)) / float(exp_paths)
                if rel > path_tol:
                    failures.append(
                        f"{name}: pathCount {got_paths} drifted from "
                        f"{exp_paths} (rel {rel:.1%} > {path_tol:.0%})"
                    )

    return failures


def assert_summary_within_baseline(
    summary: dict[str, Any],
    baseline: dict[str, Any],
    **kwargs: Any,
) -> None:
    failures = compare_summary_to_baseline(summary, baseline, **kwargs)
    if failures:
        raise CorpusGateError(failures)


def baseline_from_summary(summary: dict[str, Any]) -> dict[str, Any]:
    """Build a baseline document from a corpus run summary."""
    images = []
    for r in summary.get("results", []):
        images.append(
            {
                "image": r["image"],
                "status": r["status"],
                "matteScore": r.get("matteScore"),
                "pathCount": r.get("pathCount"),
            }
        )
    return {
        "version": 1,
        "matteAbsTol": DEFAULT_MATTE_ABS,
        "pathRelTol": DEFAULT_PATH_REL,
        "seed": summary.get("seed", 0),
        "styleFingerprint": summary.get("styleFingerprint"),
        "images": images,
    }


def write_baseline(path: Path, baseline: dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
