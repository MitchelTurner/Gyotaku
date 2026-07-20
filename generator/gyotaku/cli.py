"""CLI entry points for Phase 0."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import click
from tqdm import tqdm

from gyotaku.params import PRESETS, StyleParams, resolve_params
from gyotaku.pipeline import GenerationError, generate


def _load_params(params_file: str | None, preset: str | None, extra: tuple[str, ...]) -> StyleParams:
    overrides: dict = {}
    if params_file:
        with open(params_file, encoding="utf-8") as f:
            overrides.update(json.load(f))
    for item in extra:
        if "=" not in item:
            raise click.ClickException(f"Override must be key=value, got: {item}")
        k, v = item.split("=", 1)
        overrides[k] = _parse_value(v)
    return resolve_params(overrides=overrides or None, preset=preset)


def _parse_value(raw: str):
    if raw.lower() in ("true", "false"):
        return raw.lower() == "true"
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


@click.group()
@click.version_option(package_name="gyotaku")
def main() -> None:
    """Gyotaku plotter generator — Phase 0 offline CLI."""


@main.command("generate")
@click.argument("image", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "-o",
    "--output",
    "output_dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("output"),
    show_default=True,
    help="Directory for SVG, preview PNG, and meta.json",
)
@click.option(
    "-p",
    "--params",
    "params_file",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="JSON file of StyleParams overrides",
)
@click.option("--preset", type=click.Choice(sorted(PRESETS)), default=None)
@click.option("--seed", type=int, default=0, show_default=True)
@click.option("--print-raster/--no-print-raster", default=False, show_default=True)
@click.option(
    "--set",
    "overrides",
    multiple=True,
    help="Inline override key=value (repeatable)",
)
@click.option("-q", "--quiet", is_flag=True)
def generate_cmd(
    image: Path,
    output_dir: Path,
    params_file: Path | None,
    preset: str | None,
    seed: int,
    print_raster: bool,
    overrides: tuple[str, ...],
    quiet: bool,
) -> None:
    """Generate plotter SVG + preview PNG from a photo."""
    params = _load_params(str(params_file) if params_file else None, preset, overrides)

    def on_progress(stage: str, detail: str) -> None:
        if not quiet:
            click.echo(f"[{stage}] {detail}")

    try:
        result = generate(
            image,
            output_dir,
            params=params,
            seed=seed,
            write_print=print_raster,
            progress=None if quiet else on_progress,
        )
    except GenerationError as e:
        raise click.ClickException(str(e)) from e

    if result.rejected:
        click.echo(f"REJECTED (matteScore={result.matte_score:.2f}): {result.failure_reason}", err=True)
        sys.exit(2)

    click.echo(
        f"OK  paths={result.path_count}  matte={result.matte_score:.2f}  "
        f"est_plot={result.est_plot_seconds}s  svg={result.svg_path}"
    )


@main.command("corpus")
@click.option(
    "--corpus-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=None,
    help="Defaults to generator/corpus/images relative to package",
)
@click.option(
    "-o",
    "--output",
    "output_dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=None,
    help="Defaults to generator/corpus/runs/<date>",
)
@click.option(
    "-p",
    "--params",
    "params_file",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
)
@click.option("--preset", type=click.Choice(sorted(PRESETS)), default=None)
@click.option("--seed", type=int, default=0, show_default=True)
@click.option(
    "--set",
    "overrides",
    multiple=True,
    help="Inline override key=value (repeatable)",
)
def corpus_cmd(
    corpus_dir: Path | None,
    output_dir: Path | None,
    params_file: Path | None,
    preset: str | None,
    seed: int,
    overrides: tuple[str, ...],
) -> None:
    """Regenerate the full test corpus and write a contact sheet."""
    from datetime import datetime, timezone

    from gyotaku.corpus_runner import run_corpus

    root = Path(__file__).resolve().parent.parent
    corpus_dir = corpus_dir or (root / "corpus" / "images")
    if output_dir is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_dir = root / "corpus" / "runs" / stamp

    params = _load_params(str(params_file) if params_file else None, preset, overrides)
    summary = run_corpus(corpus_dir, output_dir, params=params, seed=seed)
    click.echo(
        f"Corpus done: {summary['ready']} ready, {summary['rejected']} rejected, "
        f"{summary['failed']} failed → {output_dir}"
    )
    if summary["failed"]:
        sys.exit(1)


@main.command("make-corpus")
@click.option(
    "-o",
    "--output",
    "output_dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=None,
)
def make_corpus_cmd(output_dir: Path | None) -> None:
    """Synthesize the ~20-image Phase 0 test corpus (placeholders for real photos)."""
    from gyotaku.synth_corpus import write_corpus

    root = Path(__file__).resolve().parent.parent
    output_dir = output_dir or (root / "corpus" / "images")
    n = write_corpus(output_dir)
    click.echo(f"Wrote {n} corpus images to {output_dir}")


if __name__ == "__main__":
    main()
