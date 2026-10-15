"""Command-line interface for metacube."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from .build import build_html
from .serve import serve
from .transform import csv_to_cube_data, save_cube_data
from . import examples as _examples


@click.group()
def main() -> None:
    """metacube — interactive 3D cube visualization for multi-dimensional datasets.

    \b
    Typical workflows:

      Explore (transform + serve in one step, no files written):
        metacube dev data.csv --config config.yaml

      Export a standalone HTML (transform + build in one step):
        metacube export data.csv --config config.yaml --output viz.html

      Step-by-step (for scripting or reuse):
        metacube transform data.csv --config config.yaml   # writes data.json
        metacube build data.json                           # writes cube.html
        metacube serve data.json                           # opens browser
    """


# ── dev: transform + serve in memory ─────────────────────────────────────────

@main.command()
@click.argument("csv_file", type=click.Path(exists=True, path_type=Path))
@click.option("--config", "-c", required=True, type=click.Path(exists=True, path_type=Path),
              help="Config YAML file")
@click.option("--port", "-p", default=8000, show_default=True, help="Port to serve on")
@click.option("--no-browser", is_flag=True, default=False, help="Do not open browser automatically")
def dev(csv_file: Path, config: Path, port: int, no_browser: bool) -> None:
    """Transform and serve locally in one step — no files written.

    Use this to visually inspect your data before exporting.
    Press Ctrl+C to stop the server.
    """
    click.echo(f"Transforming {csv_file.name}…")
    data = csv_to_cube_data(csv_file, config)
    serve(data, port=port, open_browser=not no_browser)


# ── export: transform + build in one step ────────────────────────────────────

@main.command()
@click.argument("csv_file", type=click.Path(exists=True, path_type=Path))
@click.option("--config", "-c", required=True, type=click.Path(exists=True, path_type=Path),
              help="Config YAML file")
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None,
              help="Output HTML path (default: <csv_stem>.html in current directory)")
def export(csv_file: Path, config: Path, output: Path | None) -> None:
    """Transform and export a standalone HTML file in one step.

    The resulting file is fully self-contained and works offline.
    """
    out = output or Path(csv_file.stem + ".html")
    click.echo(f"Transforming {csv_file.name}…")
    data = csv_to_cube_data(csv_file, config)
    build_html(data, out)
    click.echo(f"Saved to {out.resolve()}")


# ── transform: CSV → JSON ─────────────────────────────────────────────────────

@main.command()
@click.argument("csv_file", type=click.Path(exists=True, path_type=Path))
@click.option("--config", "-c", required=True, type=click.Path(exists=True, path_type=Path),
              help="Config YAML file")
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None,
              help="Output JSON path (default: <csv_stem>.json in current directory)")
def transform(csv_file: Path, config: Path, output: Path | None) -> None:
    """Transform a CSV file into CubeData JSON.

    The JSON can be passed to 'build' or 'serve' in a later step.
    Defaults to writing <csv_stem>.json in the current directory.
    """
    data = csv_to_cube_data(csv_file, config)
    if output is None and not sys.stdout.isatty():
        # piped — write to stdout so `metacube transform … | jq` works
        json.dump(data, sys.stdout, ensure_ascii=False)
        return
    out = output or Path(csv_file.stem + ".json")
    save_cube_data(data, out)
    click.echo(f"Saved to {out.resolve()}")


# ── build: JSON → HTML ────────────────────────────────────────────────────────

@main.command()
@click.argument("data_file", type=click.Path(exists=True, path_type=Path))
@click.option("--output", "-o", type=click.Path(path_type=Path), default=None,
              help="Output HTML path (default: cube.html in current directory)")
def build(data_file: Path, output: Path | None) -> None:
    """Generate a standalone HTML file from a CubeData JSON file."""
    out = output or Path("cube.html")
    with open(data_file) as f:
        data = json.load(f)
    build_html(data, out)
    click.echo(f"Saved to {out.resolve()}")


# ── serve: JSON → browser ─────────────────────────────────────────────────────

@main.command("serve")
@click.argument("data_file", type=click.Path(exists=True, path_type=Path))
@click.option("--port", "-p", default=8000, show_default=True, help="Port to serve on")
@click.option("--no-browser", is_flag=True, default=False, help="Do not open browser automatically")
def serve_cmd(data_file: Path, port: int, no_browser: bool) -> None:
    """Serve a CubeData JSON file locally and open in the browser."""
    with open(data_file) as f:
        data = json.load(f)
    serve(data, port=port, open_browser=not no_browser)


@main.command("examples")
@click.option("--dest", "-d", default=".", type=click.Path(path_type=Path),
              show_default=True, help="Directory to copy example files into")
@click.option("--list", "list_only", is_flag=True, default=False, help="Print file names without copying")
def examples_cmd(dest: Path, list_only: bool) -> None:
    """Copy bundled example CSV and config files to a local directory."""
    files = _examples.list_files()
    if list_only:
        for f in files:
            click.echo(f)
        return
    dest.mkdir(parents=True, exist_ok=True)
    import shutil
    for name in files:
        src = _examples.path(name)
        target = dest / name
        shutil.copy2(src, target)
        click.echo(f"  {target}")
    click.echo(f"\nCopied {len(files)} files to {dest.resolve()}")
    click.echo("\nTry it out:")
    click.echo(f"  metacube transform {dest}/census_tissue_general_counts_primary.csv \\")
    click.echo(f"    --config {dest}/census_tissue_general_treemap.yaml \\")
    click.echo(f"    --output data.json")
    click.echo(f"  metacube serve data.json")
