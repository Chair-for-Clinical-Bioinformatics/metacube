# metacube — 3D Data Cube Visualization

Interactive 3D cube visualization for exploring tabular data across three categorical dimensions. Provide a CSV and a YAML config — metacube transforms it into a self-contained HTML file or serves it locally.



**[Try it in the browser →](https://chair-for-clinical-bioinformatics.github.io/metacube/playground/)**

## Packages

| Package | Install | Docs |
|---------|---------|------|
| Python | `pip install metacube` | [python-pkg/README.md](python-pkg/README.md) |
| R | `devtools::install_github("Chair-for-Clinical-Bioinformatics/metacube", subdir = "r-pkg")` | [r-pkg/README.md](r-pkg/README.md) |

No Node.js required by end users — the JS bundle is pre-built and embedded in both packages.

## How it works

You provide two files:
- **A CSV** with one row per data point and columns for the three axes and a count/size value
- **A YAML config** that maps CSV columns to axes and enables optional features (drilldown, color gradient, 2D slice)

The transform step aggregates the data into a `CubeData` structure that drives the visualization. The result is a fully self-contained HTML file — open it in any browser, no server needed.

## Input

metacube always operates on **one metadata table** (CSV, pandas or R data frame) plus a YAML config:

- **Rows (records)** are single observations or pre-aggregated groups. With a magnitude column (`size_colour`, e.g. a cell count) each row contributes that value; otherwise each row counts as 1.
- **Three categorical columns** become the cube axes (chosen in the YAML or automatically with `axes.mode: auto`); further columns can serve as finer zoom axes, info-box fields or tooltip breakdowns.
- **An optional source column** names where each record comes from (e.g. a study, publication or lab). It is an ordinary column, designated as the grouping unit for the treemap and the source-concentration measures (N_eff, D); the info box can list finer units within each source.

The table's scope is up to you: a single study's sample sheet works just as well as a repository-wide export that aggregates records from many independent datasets (e.g. the CELLxGENE Census example: 119.8M primary cells from 645 datasets in 300 publications, in one table). metacube does not query repositories itself — export and aggregate the metadata first;
the Census example (`census_tissue_general_counts_primary.csv`) counts primary cells only
(`is_primary_data == True`), so each cell is counted once; [`scripts/build_census_counts.py`](scripts/build_census_counts.py) and [`scripts/build_encode_counts.py`](scripts/build_encode_counts.py) build the two bundled examples.

## Repository Layout

```
metacube/
├── index.html                  # Local dev page + source of the package template (not deployed)
├── src/                        # Vite + React + Three.js source (JS visualization)
├── playground/                 # Browser-based playground page (deployed to GitHub Pages)
├── python-pkg/                 # Python package (pip-installable)
│   └── src/metacube/
│       ├── _template.html      # Pre-built JS bundle (committed asset)
│       ├── examples/           # Bundled example CSV + YAML files
│       ├── transform.py        # CSV + config → CubeData JSON
│       ├── build.py            # CubeData JSON → standalone HTML
│       ├── serve.py            # Local HTTP server
│       └── cli.py              # Click CLI entry point
├── r-pkg/                      # R package (devtools-installable)
│   ├── R/
│   │   ├── transform.R         # data.frame + config → CubeData list
│   │   ├── build.R             # CubeData → HTML file
│   │   └── serve.R             # httpuv local server
│   └── inst/template.html      # Same pre-built JS bundle
├── public/                     # Static assets served by Vite
│   ├── examples/               # Bundled example CSV + YAML files
│   └── template.html           # Pre-built single-file bundle (for playground download)
└── pixi.toml                   # Dev environment (Node + Python via conda)
```

## Development Setup

Requires [Pixi](https://pixi.sh):

```bash
pixi install                 # Install conda environment (Node, Python)
pixi run dev                 # Start Vite dev server (hot reload)
pixi run build               # GitHub Pages build → dist/ (playground + root redirect)
pixi run export-template     # Rebuild public/template.html after JS changes
pixi run package-template    # Rebuild the template and sync it to both packages
```

The npm dependencies (Vite, React, Three.js, …) are installed automatically by the
`install-js` task that every `pixi run` step depends on. To install them explicitly,
run `pixi run install-js` (or `npm ci`).

Type-check:
```bash
pixi run -e default npx tsc --noEmit
```

## Running the Playground Locally

Both pages render the viewer straight from `src/`, so code changes show up immediately (hot reload).
The pre-built template in `public/template.html` is only needed for the playground's standalone HTML
download; rebuild it with `pixi run export-template`. Example data is already in `public/examples/` and committed to the repo.

```bash
pixi run export-template   # builds template and copies to public/template.html
pixi run dev               # → http://localhost:5173/metacube/playground/
```

| URL | Page | Purpose |
|---|---|---|
| `http://localhost:5173/metacube/playground/` | Playground (`playground/index.html`) | Pre-defined example datasets, CSV + YAML upload, standalone HTML download |
| `http://localhost:5173/metacube/` | Development page (root `index.html`) | Bare cube view of the example data embedded in the page; also the source of the package template (the embedded data is stripped when the template is built) |

### Keeping the development page data up to date

The two pages differ in where their data comes from:

- The **playground** transforms the example CSV + YAML in the browser on every load, so it always
  reflects the current transform and examples.
- The **development page** shows a fixed snapshot: the `window.__CUBE_DATA__ = {...}` block pasted
  into the root `index.html`. Its viewer code is live, but its data is whatever the transform
  produced when the snapshot was last generated. Nothing regenerates it automatically (not `pixi run dev`,
  not the build).

A stale snapshot looks like a bug in the viewer, for example "0 datasets" in a zoomed-in cube or
outdated treemap labels, while the playground shows the same view correctly. Regenerate the snapshot
whenever one of these changes:

- the transform (`python-pkg/src/metacube/transform.py`; the snapshot is built with the Python transform),
- the example CSV or YAML it is built from,
- the data format the viewer expects (new or renamed fields in the cube data, info-box keys, …).

```bash
# one-time: an environment with the transform's dependencies (the pixi env has no pandas)
pixi run python -m venv .venv
.venv/bin/pip install pandas pyyaml

# regenerate the snapshot from the current Python transform and examples
.venv/bin/python scripts/update_dev.py \
    public/examples/census_tissue_general_counts_primary.csv \
    public/examples/census_tissue_general_zoom.yaml
```

Vite reloads the page automatically. Any CSV + YAML pair works; the census zoom example covers the
most features (zoom drilldown, treemap, info box). The snapshot is stripped when the template is
built, so it never reaches the packages or exported files, but commit the regenerated `index.html`
so the next developer starts from current data.

If the development page and the playground disagree on the same example, regenerate the snapshot
first. If they still disagree, the Python and TypeScript transforms (`playground/transform.ts`)
have drifted apart and need to be brought back in line.

Only the playground is deployed. In the production build (`pixi run build`, as deployed to
GitHub Pages) the site root redirects to `/metacube/playground/`. To check that build locally,
run `pixi run build && pixi run preview` and open `http://localhost:4173/metacube/`.

### Deep links

The playground opens in a reproducible state from URL parameters (see `src/viewParams.ts`):
`?dataset=census_zoom` loads an example, `x=…&y=…&z=…` selects a cell, plus `slice=1`,
`theme=light|dark`, `camera=default|front|top|side`, `zoom=1.2`,
`treemap=small`, and `ui=full` (hide the download bar). The same parameters work on
exported standalone HTML files. `figure=…` renders chrome-free
figure panels instead.

## Updating the Pre-built Bundle

After any JS changes that should be visible to package users, run:

```bash
pixi run package-template
```

This rebuilds the single-file bundle, stages it as `public/template.html`, and copies it to `python-pkg/src/metacube/_template.html` and `r-pkg/inst/template.html`. Both package files must be committed.

## Key Features

| Feature | Config key | Description |
|---|---|---|
| Count gradient | `size_colour` | Block colour + size from a numeric column |
| Colour transform & legend | `color_scale`, `count_label_legend` | √/log colour scale for skewed counts; legend titled with what is encoded |
| Uniform colour mode | *(omit `size_colour`)* | All cells flat-coloured; useful when only presence matters |
| Zoom drilldown | `drilldown.type: zoom` | Click a cell to open a full inner 3D cube on finer axes |
| Treemap drilldown | `drilldown.type: treemap` | Click opens a hierarchical treemap of dataset/category breakdown |
| Ghost datasets | `ghost_datasets` | Matching cells render as transparent wireframe (e.g. planned data) |
| Accent datasets | `accent_datasets` / `accent_color` | Matching cells render in a fixed colour instead of the gradient |
| Multi-column axis | `columns: [col1, col2]` | Combine multiple CSV columns into one axis value with a separator |
| Per-column remapping | `column_value_labels` | Remap or drop individual components before combining |
| Explicit label order | `value_order` | Control axis label order regardless of frequency or sort_by |
| Metadata join | `metadata_csv` | Left-join a secondary CSV (title/doi/year) by key — keeps main CSV lean |
| Tooltip breakdown | `tooltip_breakdown` | Show per-cell breakdown of a column (e.g. cell types) on hover |
| Inner zoom colours | `drilldown.axis_colors` | Override axis label colours for the inner zoom cube |
| Source highlighting | *(click info card / treemap tile)* | Click an info-box card or a treemap tile to highlight every cube cell containing that source |
| Filter summary | *(automatic)* | Live "selected: X entries" panel when axis labels are clicked |
| 2D slice | `slice` | Toggle a heatmap of the two free axes at the selected cell's fixed value |
| Per-cell charts | `charts_json` | Per-cell sparkline, line, or bar chart in the details panel |
| View-aware axis labels | `label_rotation` | Labels follow the camera: silhouette edge, perpendicular rotation, fading when crowded |
| Camera presets | *(buttons)* | Default 3/4 view, front, top, side |

## Documentation

- **[Config file reference →](docs/config.md)** — all YAML options, visualization modes, worked examples

## Tech Stack

- **Visualization:** React 19 + TypeScript + Three.js (react-three-fiber) + d3-hierarchy
- **Build:** Vite 8
- **Python package:** Click CLI, pandas, pyyaml
- **R package:** jsonlite, yaml, httpuv

## License

MIT — see [LICENSE](LICENSE).
