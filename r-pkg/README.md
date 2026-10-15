# metacube (R)

Interactive 3D cube visualization for tabular data. Provide a data frame and a config list (or YAML path) — metacube transforms it and produces a self-contained HTML file or serves it locally.

**[Try it in the browser without installing →](https://chair-for-clinical-bioinformatics.github.io/metacube/playground/)**

## Installation

```r
# From GitHub
devtools::install_github("Chair-for-Clinical-Bioinformatics/metacube", subdir = "r-pkg")

# Local development
devtools::load_all("r-pkg/")
```

Suggests: `httpuv` (needed for `cube_serve()`), `yaml` (needed for YAML config loading).

## Quick Start

```r
library(metacube)
library(yaml)

df <- read.csv("data.csv")
config <- yaml::read_yaml("config.yaml")

# Explore interactively (opens browser, blocks until stopped)
cube_serve(cube_transform(df, config))

# Export a standalone HTML file
cube_build(cube_transform(df, config), output = "viz.html")
```

## API Reference

### `cube_transform(df, config)`

Transform a data frame into a CubeData list ready for `cube_build()` or `cube_serve()`.

**Arguments:**
- `df` — a `data.frame` with columns matching the config mappings
- `config` — a named list matching the config YAML schema, or a path to a YAML file (requires the `yaml` package)

**Returns:** A list (CubeData) suitable for `jsonlite::toJSON()`, `cube_build()`, and `cube_serve()`.

```r
# From a data frame + config list
config <- list(
  title = "My Dataset",
  axes = list(
    x = list(label = "Organism", column = "organism"),
    y = list(label = "Assay",    column = "assay"),
    z = list(label = "Tissue",   column = "tissue")
  ),
  size_column = "count"
)
data <- cube_transform(df, config)

# From a YAML file
data <- cube_transform(df, "config.yaml")
```

---

### `cube_build(data, output)`

Generate a standalone HTML file from a CubeData list.

**Arguments:**
- `data` — CubeData list (output of `cube_transform()`)
- `output` — path to the output `.html` file (default: `"cube.html"`)

The resulting HTML is fully self-contained and works offline in any browser.

```r
cube_build(data, output = "my_visualization.html")
```

---

### `cube_serve(data, port, open_browser)`

Serve a CubeData list locally and open in the browser. Blocks until the session is stopped (Ctrl+C or interrupt).

**Arguments:**
- `data` — CubeData list (output of `cube_transform()`)
- `port` — port to serve on (default: `8000`)
- `open_browser` — whether to open the browser automatically (default: `TRUE`)

Requires the `httpuv` package.

---

## Config YAML Reference

> **Full reference with all modes and examples:** [docs/config.md](https://github.com/Chair-for-Clinical-Bioinformatics/metacube/blob/main/docs/config.md)

The config can be loaded from a YAML file (`yaml::read_yaml("config.yaml")`) or constructed as a named R list.

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

size_column: "cell_count"
```

### Full config with all options

```yaml
title: "My Dataset"

axes:
  x:
    label: "Organism"
    column: "organism"
    max_labels: 5          # keep only top N values by size (optional)
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

size_column: "cell_count"
color_column: "cell_count"    # numeric column for color gradient (optional)
datasets_column: "dataset_id" # column of dataset IDs, shown in tooltip (optional)
priority_column: "priority"   # integer 1–4 for cell rendering priority (optional)

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
  # size_column: "cell_count"
  # treemap:                          # optional: also show treemap panel in zoom view
  #   category_column: "dataset_title"
  #   subcategory_column: "cell_type"
  #   count_column: "cell_count"

# ── Slice: 2D matrix for the selected cell ───────────────────────────────────

slice:
  fixed_axis: "x"            # "x", "y", or "z" — the axis held fixed
  count_column: "cell_count" # optional; must be the magnitude column (defaults to it)

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
| `size_column` | yes | Numeric column for cell volume |
| `color_column` | no | Numeric column for color gradient |
| `datasets_column` | no | Column of dataset/study IDs |
| `priority_column` | no | Integer 1–4 rendering priority |
| `count_label` | no | Unit noun for the magnitude, shown next to counts (e.g. `cells`) |
| `count_label_legend` | no | Colour-legend title (default `Number of <count_label>`) |
| `color_scale` | no | `linear` (default), `sqrt` or `log` colour scaling; switchable in the legend |
| `label_rotation` | no | `auto` (default): labels follow the camera; `horizontal`: keep them level |
| `metadata_csv` / `metadata_join_key` | no | Left-join a lookup CSV (e.g. publication titles) by key |
| `drilldown.category_label_column` | no | Display label for the treemap source tiles (e.g. citation) |
| `drilldown.category_noun` | no | Plural noun for the source unit (e.g. `publications`) |
| `drilldown` | no | Drilldown config (treemap or zoom) |
| `slice` | no | 2D matrix slice in the details panel |
| `info` | no | Structured info panel on cell click |
| `info_box` | no | Structured entries shown inline in the side panel on cell click |

**Slice:** each entry is the summed magnitude (the same number the cube colours by) for one
combination of the two free axes, at the selected cell's value on `fixed_axis`.

### Equivalent R list

```r
config <- list(
  title = "My Dataset",
  axes = list(
    x = list(label = "Organism", column = "organism", max_labels = 5L),
    y = list(label = "Assay",    column = "assay",    max_labels = 20L),
    z = list(label = "Tissue",   column = "tissue",   max_labels = 30L)
  ),
  size_column  = "cell_count",
  color_column = "cell_count",
  drilldown = list(
    type               = "treemap",
    category_column    = "study_title",
    subcategory_column = "cell_type",
    count_column       = "cell_count"
  ),
  slice = list(
    fixed_axis   = "x",
    count_column = "cell_count"
  )
)
```

---

## Complete Example

```r
library(metacube)

# Build a small synthetic dataset
df <- data.frame(
  organism  = c("Human", "Human", "Human", "Mouse", "Mouse"),
  assay     = c("scRNA-seq", "scRNA-seq", "ATAC-seq", "scRNA-seq", "scRNA-seq"),
  tissue    = c("blood", "liver", "blood", "blood", "brain"),
  study     = c("Study A", "Study B", "Study A", "Study C", "Study C"),
  cell_type = c("T cell", "hepatocyte", "B cell", "T cell", "neuron"),
  count     = c(5000L, 8000L, 2000L, 3000L, 6000L)
)

config <- list(
  title = "Single-cell Atlas",
  axes = list(
    x = list(label = "Organism", column = "organism"),
    y = list(label = "Assay",    column = "assay"),
    z = list(label = "Tissue",   column = "tissue")
  ),
  size_column  = "count",
  color_column = "count",
  drilldown = list(
    type               = "treemap",
    category_column    = "study",
    subcategory_column = "cell_type",
    count_column       = "count"
  ),
  slice = list(fixed_axis = "x", count_column = "count")
)

data <- cube_transform(df, config)

# Export
cube_build(data, output = "atlas.html")

# Or explore interactively
cube_serve(data)
```

## License

MIT — see [LICENSE](LICENSE).
