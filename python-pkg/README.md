# metacube (Python)

Interactive 3D cube visualization for tabular data. Provide a CSV and a config YAML — metacube transforms it and produces a self-contained HTML file or serves it locally.

**[Try it in the browser without installing →](https://chair-for-clinical-bioinformatics.github.io/metacube/playground/)**

## Installation

```bash
pip install metacube
```

## Quick Start

```bash
# Copy bundled example files
metacube examples --dest my_data/

# Explore interactively (no files written)
metacube dev my_data/census_tissue_general_counts_primary.csv \
  --config my_data/census_tissue_general_zoom.yaml

# Export a standalone HTML file
metacube export my_data/census_tissue_general_counts_primary.csv \
  --config my_data/census_tissue_general_zoom.yaml \
  --output viz.html
```

## CLI Reference

### `metacube dev` — transform and serve in one step

```
metacube dev <CSV_FILE> --config <CONFIG_YAML> [--port 8000] [--no-browser]
```

Transforms the CSV in memory and serves a local visualization. Nothing is written to disk. Press `Ctrl+C` to stop.

```bash
metacube dev data.csv --config config.yaml
metacube dev data.csv --config config.yaml --port 9000 --no-browser
```

---

### `metacube export` — transform and export in one step

```
metacube export <CSV_FILE> --config <CONFIG_YAML> [--output viz.html]
```

Produces a fully self-contained HTML file that works offline (no server needed). Default output name: `<csv_stem>.html`.

```bash
metacube export data.csv --config config.yaml
metacube export data.csv --config config.yaml --output my_viz.html
```

---

### `metacube transform` — CSV → JSON

```
metacube transform <CSV_FILE> --config <CONFIG_YAML> [--output data.json]
```

Converts a CSV + config to an intermediate CubeData JSON. Use this when you want to cache the transformed data and serve or build from it later.

```bash
metacube transform data.csv --config config.yaml            # writes data.json
metacube transform data.csv --config config.yaml -o out.json
metacube transform data.csv --config config.yaml | jq .config  # pipe to jq
```

---

### `metacube build` — JSON → HTML

```
metacube build <DATA_JSON> [--output cube.html]
```

Injects a pre-transformed CubeData JSON into the visualization template.

```bash
metacube build data.json
metacube build data.json --output my_viz.html
```

---

### `metacube serve` — JSON → browser

```
metacube serve <DATA_JSON> [--port 8000] [--no-browser]
```

Serves a pre-transformed JSON locally.

```bash
metacube serve data.json
metacube serve data.json --port 9000
```

---

### `metacube examples` — copy bundled example files

```
metacube examples [--dest ./] [--list]
```

Copies bundled example CSV and config YAML files to a local directory.

```bash
metacube examples                    # copy to current directory
metacube examples --dest my_data/    # copy to my_data/
metacube examples --list             # print file names only
```

---

## Python API

```python
from metacube import csv_to_cube_data, build_html, serve

# Transform
data = csv_to_cube_data("data.csv", "config.yaml")

# Export standalone HTML
build_html(data, "viz.html")

# Serve locally
serve(data, port=8000, open_browser=True)
```

---

## Step-by-step Workflow

```bash
# 1. Transform CSV → JSON (once, reuse for multiple outputs)
metacube transform dataset.csv --config config.yaml --output data.json

# 2a. Explore in browser
metacube serve data.json

# 2b. Or export for sharing
metacube build data.json --output shareable.html
```

---

## Config YAML Reference

> **Full reference with all modes and examples:** [docs/config.md](https://github.com/Chair-for-Clinical-Bioinformatics/metacube/blob/main/docs/config.md)

The config YAML maps CSV columns to visualization axes and enables optional features.

### Minimal config

```yaml
title: "My Dataset"

axes:
  x:
    label: "Species"
    column: "species"
  y:
    label: "Assay"
    column: "assay"
  z:
    label: "Tissue"
    column: "tissue"

size_colour: "cell_count"
```

### Full config with all options

```yaml
title: "My Dataset"

axes:
  x:
    label: "Organism"
    column: "organism"
    max_labels: 5          # keep only top N values by count (optional)
    colors:                # per-value hex colors (optional)
      "Human": "#3b82f6"
      "Mouse": "#10b981"
    group_separator: " - " # group axis labels by prefix (optional)
  y:
    label: "Assay"
    column: "assay"
    max_labels: 20
  z:
    label: "Tissue"
    column: "tissue"
    max_labels: 30

size_colour: "cell_count"     # numeric column for the colour gradient (omit for a single colour)
datasets_column: "dataset_id" # column of dataset IDs, shown in hover tooltip (optional)

# ── Colour and legend ─────────────────────────────────────────────────────────

count_label: "cells"                   # unit noun for the magnitude 
count_label_legend: "Number of cells"  # legend title (default: "Number of <count_label>")
color_scale: "sqrt"                    # "linear" (default) | "sqrt" | "log"; switchable in the legend
label_rotation: "auto"                 # axis labels follow the camera; "horizontal" keeps them level

# ── Drilldown: click a cell to see more detail ────────────────────────────────

drilldown:
  # Option A: treemap popup (floating panel, stays alongside the cube)
  type: "treemap"
  category_column: "dataset_title"    # outer grouping in the treemap
  subcategory_column: "cell_type"     # inner tiles in the treemap
  count_column: "cell_count"          # column to sum for tile size

  # Option B: zoom into a finer-grained inner cube
  # type: "zoom"
  # axes:
  #   z:                              # redefine one or more axes
  #     label: "Organ"
  #     column: "organ"
  #     max_labels: 30
  # size_colour: "cell_count"
  # treemap:                          # optional: also show treemap panel in zoom view
  #   category_column: "dataset_title"
  #   subcategory_column: "cell_type"
  #   count_column: "cell_count"

# ── Slice: 2D matrix for the selected cell ───────────────────────────────────

slice:
  fixed_axis: "x"            # "x", "y", or "z" — the axis held fixed
  count_column: "cell_count" # optional; must be the magnitude column (size_colour)

# ── Info panel: structured text on click ─────────────────────────────────────

info:
  columns:
    title:  "study_title"
    author: "first_author"
    year:   "year"
    doi:    "doi"
    url:    "url"

# Inline info box in the details panel (one card per publication when `title` is set):
info_box:
  columns:
    title:    "publication"
    citation: "citation"
    dataset:  "dataset_title"
    doi:      "doi"

# ── Optional lookup table joined onto the main CSV ────────────────────────────

metadata_csv: "publications.csv"   # path relative to the main CSV / config
metadata_join_key: "id"

# ── Axis ordering ─────────────────────────────────────────────────────────────

axis_order: "frequency"  # "frequency" (default) or "cluster"
                         # frequency: labels ordered by descending total count
                         #            (same rank as max_labels — most common first)
                         # cluster:   after max_labels selection, labels are reordered
                         #            by average-linkage cosine clustering on their
                         #            co-occurrence profiles across the other two axes.
                         #            Groups categories with similar occupancy patterns.
```

### Config options summary

| Field | Required | Description |
|---|---|---|
| `title` | no | Visualization title shown in the header |
| `axes.{x,y,z}.column` | yes | CSV column name for each axis |
| `axes.{x,y,z}.label` | no | Display label (defaults to column name) |
| `axes.{x,y,z}.max_labels` | no | Keep only top N values by count |
| `axes.{x,y,z}.colors` | no | Map of value → hex color |
| `axes.{x,y,z}.group_separator` | no | String to split labels into groups |
| `size_colour` | no | Numeric column for the colour gradient (omit for a single colour) |
| `datasets_column` | no | Column of dataset/study IDs, shown in hover tooltip |
| `count_label` | no | Unit noun for the magnitude, shown next to counts (e.g. `cells`) |
| `count_label_legend` | no | Colour-legend title (default `Number of <count_label>`) |
| `color_scale` | no | `linear` (default), `sqrt` or `log` colour scaling; switchable in the legend |
| `label_rotation` | no | `auto` (default): labels follow the camera; `horizontal`: keep them level |
| `metadata_csv` / `metadata_join_key` | no | Left-join a lookup CSV (e.g. publication titles) by key |
| `drilldown.category_label_column` | no | Display label for the treemap source tiles (e.g. citation) |
| `drilldown.category_noun` | no | Plural noun for the source unit (e.g. `publications`) |
| `drilldown` | no | Drilldown config (treemap or zoom) |
| `slice` | no | 2D matrix slice in the details panel |
| `info` | no | Structured entries shown as center modal on cell click |
| `info_box` | no | Structured entries shown inline in the side panel on cell click |
| `axis_order` | no | `"frequency"` (default) or `"cluster"` — see below |

**Slice:** each entry is the summed magnitude (the same number the cube colours by) for one
combination of the two free axes, at the selected cell's value on `fixed_axis`.

**`axis_order: "frequency"` (default):** labels are presented in descending order of total count, matching the `max_labels` selection rank.

**`axis_order: "cluster"`:** after `max_labels` selection, each axis is reordered by average-linkage hierarchical clustering on co-occurrence profiles. Each label becomes a row vector of its counts across all combinations of the other two axes (mode-*k* tensor unfolding); rows are L2-normalised and pairwise cosine distances feed `scipy.cluster.hierarchy.linkage(method="average")`. This groups categories with similar occupancy patterns together, making large-scale structure easier to read. This uses scipy, which is installed as a dependency of metacube. The R package uses `stats::hclust` and needs no additional dependencies.

---

## Complete Example

Given a CSV `data.csv`:
```
organism,assay,tissue,study,cell_type,count
Human,scRNA-seq,blood,Study A,T cell,5000
Human,scRNA-seq,blood,Study A,B cell,2000
Human,scRNA-seq,liver,Study B,hepatocyte,8000
Mouse,scRNA-seq,blood,Study C,T cell,3000
```

And `config.yaml`:
```yaml
title: "Single-cell Atlas"

axes:
  x:
    label: "Organism"
    column: "organism"
  y:
    label: "Assay"
    column: "assay"
  z:
    label: "Tissue"
    column: "tissue"

size_colour: "count"

drilldown:
  type: "treemap"
  category_column: "study"
  subcategory_column: "cell_type"
  count_column: "count"

slice:
  fixed_axis: "x"
  count_column: "count"
```

```bash
metacube export data.csv --config config.yaml --output atlas.html
# Open atlas.html in any browser — no server needed
```

## License

MIT — see [LICENSE](LICENSE).
