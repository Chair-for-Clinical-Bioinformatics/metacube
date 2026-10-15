# metacube — Config File Reference

The config YAML tells metacube how to map CSV columns to axes and which interactive
features to enable. This document explains every option and when to use it.

---

## 1. Quick Start — Minimal Config

```yaml
title: "My Dataset"

axes:
  mode: auto

size_colour: "cell_count"
```

**That's it.** This produces a 3D cube where:
- Axes are assigned automatically: metacube scores how much categorical variety each CSV column adds and puts a moderate number of
  well-balanced categories on the three outer faces, reserving finer-grained (high-cardinality) columns for the zoom drilldown. Columns
  already used elsewhere (e.g. `size_colour`) and identifier-like columns are skipped. See [§2d](#2d-automatic-axis-assignment-axesmode-auto)
  for the full scoring rules, and how to pin or tune the selection.
- Block colour encodes `cell_count` via a gradient
- Hovering shows axis values; clicking opens a side panel with the cell stats

Prefer to assign axes yourself? Set `axes.mode: manual` (or just omit `mode`) and name a `column` for each of `x`/`y`/`z` — see [§2](#2-axes).

If you **omit `size_colour`** every block is flat blue —
useful when you only care about which combinations exist.

---

## 2. Axes

All three axes follow the same schema:

```yaml
axes:
  x:
    column: "csv_column_name"   # required — CSV column to group by
                                # (or `columns` to combine several, §2b; or `axes.mode: auto`, §2d)
    label:  "Display Label"     # optional — shown in UI (defaults to column name)
    description: "Explanation"  # optional — shown as tooltip on hover/click of the axis label
    max_labels: 20              # optional — keep only top-N values by count
    sort_by: "numeric_col"      # optional — sort axis values by mean of this CSV column
    sort_order: "desc"          # optional — "asc" or "desc" (default: "desc")
    value_labels:               # optional — map raw CSV values to display labels
      "raw_val": "Display Val"
    colors:                     # optional — assign specific hex colours per value
      "Human":  "#3b82f6"
      "Mouse":  "#10b981"
    group_separator: " - "      # optional — group axis values by prefix (see §8)
    value_order:                # optional — explicit label order (see §2c)
      - "First value"
      - "Second value"
```

### `description`

Free-text description shown as a tooltip when hovering the axis title in the 3D scene
or the control panel. Supports `\n` for line breaks. Clicking the label pins the
tooltip until clicked again.

### `max_labels`

Filters the axis down to the N most frequent values (by `size_colour` / `colour` sum,
or by row count if neither is set). Useful when an axis has dozens of values and you
want to keep the cube readable.

### `sort_by` and `sort_order`

After any `max_labels` filtering, reorder axis labels by the **mean** of a numeric CSV
column across all rows belonging to each label. `sort_order` is `"desc"` by default
(highest first). Works on both outer axes and drilldown inner axes.

```yaml
# Example: order assays by their mean cell count (largest first)
axes:
  y:
    column: "assay"
    sort_by: "count"
    sort_order: "desc"
```

### `value_labels`

Maps raw CSV values to human-readable display labels. The remapping is applied
everywhere — axis tick labels, control panel filters, tooltips, and drilldown lookups.
The original CSV values are still used internally for filtering and sorting.

```yaml
axes:
  x:
    column: "organism"
    value_labels:
      "Homo sapiens": "Human"
      "Mus musculus": "Mouse"
```

---

## 2b. Multi-Column Axes (`columns` and `combine_separator`)

Instead of mapping one CSV column to an axis, you can combine several columns into a
single compound label — built in memory at transform time (your CSV is never modified).

```yaml
axes:
  z:
    label: "Assay — Target"
    columns:
      - "assay_title"
      - "target"
    combine_separator: " — "    # optional, default " — "
    column_value_labels:        # optional — remap individual column values before joining
      target:
        "none": ""              # empty string → drop this component from the label
```

**How it works:**

1. For each row, the values of the listed `columns` are looked up. Any value that
   remaps to `""` via `column_value_labels` is dropped from the join entirely.
2. The remaining values are joined with `combine_separator` (default `" — "`).
3. The resulting compound string becomes the axis value for that row.
4. `combine_separator` is also automatically used as `group_separator`, so compound
   labels are grouped in the control panel by their first component (e.g. all
   `"Histone ChIP-seq — …"` entries appear under a shared `"Histone ChIP-seq"`
   heading — see §8).

**When to use it:** when your data has a primary category and an optional
sub-classification in separate columns and you want both to appear on one axis without
pre-concatenating them in the CSV.

**`column` takes precedence over `columns`** — if an axis sets an explicit `column`,
combining is skipped and `columns` is ignored. (In `axes.mode: auto`, the auto-chosen
`column` likewise pre-empts any `columns` on that face.)

### `column_value_labels`

A nested map of `column_name → value_map` applied per-component **before** joining.
Values that remap to `""` are excluded from the combined label. This is useful for
suppressing placeholder values like `"unknown"` or `"N/A"` that clutter axis labels.

```yaml
column_value_labels:
  target:
    "none": ""              # rows with target "none" → label is just the assay
```

Note that `column_value_labels` is distinct from `value_labels`. `column_value_labels`
operates on the individual input columns before joining; `value_labels` would remap the
already-joined compound label.

---

## 2c. Explicit Value Order (`value_order`)

```yaml
axes:
  y:
    column: "age_group"
    value_order:
      - "0–20"
      - "21–40"
      - "41–60"
      - "61–80"
      - "80+"
```

`value_order` pins the listed labels to the front of the axis in the given order.
Any labels present in the data but not listed appear afterward, sorted alphabetically.
This overrides `axis_order` (frequency or cluster) for the values that are listed.

Works on both outer `axes` and `drilldown.axes`.

**When to use it:** ordinal categories (age groups, severity grades, disease stages)
where alphabetical or frequency-based ordering would be misleading.

---

## 2d. Automatic Axis Assignment (`axes.mode: auto`)

By default axes are **manual** — you name the `column` for each of x/y/z (and any
zoom-drilldown axes). Set `axes.mode: auto` and metacube instead picks the axis
columns from your CSV by scoring how much *visual variety* each column adds.

```yaml
axes:
  mode: auto          # "manual" (default) | "auto"
size_colour: "count"
```

**How it scores.** Each candidate column is ranked by its count-weighted
effective number of distinct categories `D = exp(H)` (a Hill number). `D` already
drops toward 1 when one value dominates, so skew is reflected without an extra
penalty — columns where a few categories legitimately dominate (e.g. human/mouse
over-representation) are *not* demoted for it. The scoring is
*mode-sensitive*:

- **Outer faces** favour a small number of clean, balanced buckets, so a
  high-cardinality column (e.g. 400 cell types) is kept *off* the faces.
- **Inner / zoom axes** favour fine detail, so those high-cardinality columns are
  reserved for the drilldown.

**Coarse-out, fine-in is derived from your data.** If knowing column B's value
determines column A's (but not the reverse), A is the coarse *parent* and B the
fine *child* — the parent may sit on an outer face, the child is pushed to the
drilldown. This nesting is computed via conditional entropy, so it adapts to any
columns; nothing is hardcoded. (It also means misleadingly-named columns sort
themselves out: whichever column is *actually* finer goes inside.)

**Columns that already have a job are skipped.** Any column named elsewhere in
the config — `size_colour`, `datasets_column`, the treemap `category_column` /
`subcategory_column` / `count_column`, `info` / `info_box` columns, `slice` —
is excluded from axis candidacy, as are constant and near-unique (identifier-like)
columns.

**Drilldown.** When `drilldown.type: zoom`, the inner cube axes are auto-filled
too (preferring the children of the chosen outer faces, so the nesting reads
correctly). A `treemap` drilldown is **not** auto-configured — it needs a
`category_column` / `subcategory_column`, which you still set by hand.

**Pinning.** You can fix individual faces and let the rest be chosen — a face that
already names a `column` is kept verbatim:

```yaml
axes:
  mode: auto
  x: { column: "assay", label: "Assay" }   # pinned; y and z are auto-filled
```

**Tuning** (all optional) lives under `axes.auto`:

```yaml
axes:
  mode: auto
  max_labels: 20            # cap labels on EVERY auto axis (outer + inner)
  auto:
    weighting: cube_cells   # cube_cells (default) | count | presence
    exclude_columns: ["batch_id"]       # never use these as axes
    semantic_priors: { assay: 0.3 } # additive nudge for favoured columns (0 = neutral)
    outer_max_labels: 30    # overrides axes.max_labels for the outer faces
    inner_max_labels: 40    # overrides axes.max_labels for the inner drilldown
```

- **`weighting`** — how each row contributes to a column's distribution.
  `cube_cells` (default) weights every row equally (variety = spread of cube
  cells, robust to dataset size); `count` weights by the size column (observation
  mass); `presence` is an alias of `cube_cells`.
- **`semantic_priors`** — a per-column multiplier nudge (`0` = neutral) for when a
  domain-meaningful column should win over a more "entropic" but less interesting
  one.

The chosen axes and a full per-column scoring table are logged when the config is
transformed, so the selection is auditable. If you disagree with a pick, switch to
manual mode (or pin that face).

---

## 3. Top-Level Columns

```yaml
size_colour: "score"          # numeric — drives both block size and colour gradient
colour: "score"               # numeric — drives colour only; block size = row count
color_aggregation: "mean"     # "sum" (default) or "mean" — how to aggregate colour values per cell
color_label: "Avg score"      # label shown next to the colour value in hover tooltip
count_label: "cells"          # noun for one unit of the magnitude (size), e.g. "cells" / "experiments"
count_label_legend: "Number of cells"  # title of the colour legend (default: "Number of <count_label>")
color_scale: "sqrt"           # "linear" (default) | "sqrt" | "log" — compression before the colour ramp
datasets_column: "dataset_id" # string — shown in hover tooltip as a list
colors:                       # global value→hex map (applies to all axes)
  "Human": "#3b82f6"
```

### `size_colour` vs `colour`

- **`size_colour`**: each row contributes its numeric value to both the block's size
  and colour. Aggregated by sum (or mean with `color_aggregation: mean`).
- **`colour`**: block size always represents row count (one per row); only the colour
  comes from the numeric column. Use this when you want cell size = number of items and
  colour = average of some metric 

### `color_aggregation`

Controls how multiple rows are combined into a single cell colour. Default is `"sum"`;
set to `"mean"` when the colour column holds a per-item metric (rates, returns,
percentages) rather than a count.

### `color_label`

Short label displayed in the hover tooltip next to the colour value (e.g.
`"Avg score: 0.42"`). If omitted, the tooltip shows `"Mean:"` or `"Value:"`.

### `count_label`

Noun for **one unit of the magnitude** (the aggregated `size_colour`), shown next
to counts throughout the UI — the hover tooltip, the cell details panel, and the
treemap header. It makes the bare number unambiguous in the dataset's own units:

```yaml
count_label: "cells"        # CZ CELLxGENE → "21.2M cells"
count_label: "experiments"  # ENCODE       → "1.2k experiments"
```

If omitted, the magnitude is shown without a unit (the tooltip falls back to
`"Size:"` / `"Count:"`, the details panel to `"entries"`). Distinct from
`color_label`, which labels the *colour* value; `count_label` labels the *size*.

### `count_label_legend`

Title of the colour legend in the control panel (and the inner zoom panel), i.e.
what the colour encodes, e.g. `"Number of cells"`. Defaults to
`"Number of <count_label>"`; without `count_label` it falls back to `color_label`.
Under the title the legend states the aggregation and transform
(e.g. *"total per cube cell · √ scale"*; inner cubes add *"within <outer cell>"*),
and the ticks show the minimum, the midpoint of the bar and the maximum with units.

### `color_scale`

Compression applied to the magnitude before it is mapped onto a sequential colour
ramp: `"linear"` (default), `"sqrt"` or `"log"` (log1p). Counts usually span
orders of magnitude (a few huge datasets, many small ones), so a linear ramp
leaves almost every cell at the low end; `sqrt` or `log` spread the range across
the palette. Legend ticks are spaced in the same transformed space, so the middle
tick shows the value that actually sits there. Diverging palettes are never
transformed. The bundled Census and ENCODE examples use `"sqrt"`. The value only sets the
starting scale: viewers can switch between linear, √ and log with the buttons under
the legend (outer and inner cube share the choice).

---

## 3b. Supplementary Metadata (`metadata_csv` and `metadata_join_key`)

When several rows in your main CSV share the same dataset or study, it is wasteful to
repeat title, year, and DOI in every row. `metadata_csv` lets you keep that information
in a separate lookup table that is joined at load time.

```yaml
metadata_csv: "study_metadata.csv"    # path relative to the main CSV file
metadata_join_key: "dataset_id"       # column used for the join (default: "dataset_key")
```

**How it works:** rows from `metadata_csv` are left-joined onto the main data on the
`metadata_join_key` column. Columns that already exist in the main CSV are not
overwritten. The resulting merged table is what all `info_box`, `info`, and
`tooltip_breakdown` lookups operate on.

**Typical layout:**

*main CSV (one row per cell-type × tissue × dataset combination):*

| dataset_id | tissue | cell_type | count |
|---|---|---|---|
| dset_a1b2 | frontal cortex | neuron     | 4200 |
| dset_c3d4 | amygdala       | astrocyte  | 870 |

*study_metadata.csv:*

| dataset_id | title | year | doi |
|---|---|---|---|
| dset_a1b2 | Human cortex atlas    | 2024 | 10.1126/... |
| dset_c3d4 | Cortical snRNA-seq v2 | 2023 | 10.1038/... |

The merged table then has `title`, `year`, and `doi` available for `info_box` without
them appearing in every row of the main CSV.

---

## 3c. Ghost Datasets (`ghost_datasets`)

```yaml
ghost_datasets: "planned"
```

Cells where **all** contributing datasets contain the given substring in their dataset
key/name are rendered as transparent wireframe outlines ("ghost" style) instead of
solid blocks. This visually distinguishes planned or placeholder data from real data,
while still showing where those cells will appear in the cube.

**When to use it:** when your CSV contains rows for future or provisional datasets that
you want to show as "coming soon" without misleading viewers with solid blocks.

**Requires `datasets_column`** to be set so that metacube knows which column holds the
dataset identifiers to inspect.

**Partial ghosting:** if a cell has contributions from both `"planned_*"` datasets and
real datasets, it renders as a normal solid block (ghost only applies when the substring
matches every contributing dataset).

---

## 3d. Accent Datasets (`accent_datasets`, `accent_color`, `accent_label`)

```yaml
accent_datasets: "organoid"
accent_color: "#f59e0b"       # optional, default #f59e0b (amber)
accent_label: "Organoid data" # optional — legend label in ControlPanel
```

Cells where **any** contributing dataset contains the given substring are rendered in
a fixed accent colour instead of the standard count gradient. This lets you call out
a subset of the data (e.g. organoid-derived cells vs. primary tissue) without changing
the axis structure.

**Requires `datasets_column`** to be set.

`accent_color` accepts any CSS hex colour (`"#rrggbb"`). The default is amber
(`#f59e0b`). `accent_label` sets the legend entry in the ControlPanel "Cell type"
section; if omitted, the accent bucket is unlabelled in the legend.

**Interaction with `ghost_datasets`:** ghost takes precedence. A cell that qualifies
for both ghost and accent treatment is always ghosted.

---

## 3e. Tooltip Breakdown (`tooltip_breakdown`)

```yaml
tooltip_breakdown: "cell_type"
```

Adds a **subtypes** section to the hover tooltip showing how a cell's rows are
distributed across the values of the given column. Empty strings and the literal value
`"unknown"` are silently skipped. Results are sorted by count descending and capped at
a readable number of entries.

Works on both outer cube cells and inner zoom-drilldown cells.

**When to use it:** when each cube cell aggregates many rows with different subtypes
(cell types, brain regions, sample IDs) and you want a quick glance at the composition
without opening the full drilldown.


---

## 3f. Appearance — Colour Scheme, Gradient Palette & Background

These top-level keys control how the scene *looks*, independent of which columns
drive the axes. All are optional.

```yaml
colour_scheme: "asap"          # named app theme: "default" | "asap"
color_palette: "RdYlGn"        # gradient palette for the numeric colour value
axis_colors:                   # per-axis colour for outer titles + label highlights
  x: "#3b82f6"
  y: "#10b981"
  z: "#f59e0b"
background: "#ffffff"          # scene background — any CSS background value
uniform_cell_color: "#60a5fa"  # flat cell colour when no size_colour/colour gradient
tilt_group_labels: true        # rotate grouped-axis headers parallel to their axis
label_rotation: "auto"         # "auto" (default) | "horizontal" — 3D axis value labels
```

### `colour_scheme`
Named app theme: `"default"` (classic) or `"asap"` (ASAP/CRN brand palette).
Light/dark is still chosen at runtime by the in-app toggle; this only selects the
colour family. Defaults to `"default"`.

### `color_palette`
Palette for the numeric **colour value** (`size_colour` or `colour`). Either a
named matplotlib/d3 palette string or an object:

```yaml
color_palette:
  name: "RdYlGn"               # named palette takes priority over hex stops below
  type: "diverging"            # "sequential" | "diverging" (auto-detected if omitted:
                               #   diverging when values go negative, else sequential)
  low_color:  "#2166ac"        # hex fallbacks, used only when `name` is unset
  mid_color:  "#f7f7f7"
  high_color: "#b2182b"
```

A bare string is shorthand for `{ name: "<palette>" }`. Only applies when a
`size_colour` / `colour` gradient is in play.

### `axis_colors`
Per-axis hex colour for the **outer** cube's axis titles and label highlights
(`x` / `y` / `z`, each optional). The inner zoom cube has its own
`drilldown.axis_colors` (see §4e).

### `background`
Scene background — any CSS background value: a solid hex (`"#ffffff"`) or a
gradient (`"linear-gradient(...)"`). Defaults to white.

### `uniform_cell_color`
Flat colour for every cell, used **only** when there is no `size_colour` / `colour`
gradient (presence-only cubes). Defaults to a light blue (`#60a5fa`). If omitted,
the active theme's default cell colour is used (so it stays reactive to light/dark).

### `tilt_group_labels`
When `true`, grouped-axis headers (see §8, `group_separator`) are rotated to run
parallel to their axis — e.g. vertical Y-group headers. Default `false`.

### `label_rotation`
How the 3D axis value labels follow the camera. With `"auto"` (default) each
axis's labels move to the cube edge facing the viewer, are rotated perpendicular
to the axis as it appears on screen (so neighbours stack by text height, not
width), and fade — never below ~20% opacity — where the on-screen spacing is too
tight to read, e.g. at the far end of an axis that points towards the viewer.
Group headers and the axis title are pushed out past the longest label.
`"horizontal"` keeps the edge switching and fading but leaves the text level.

---

## 4. Visualization Modes — What Happens on Click

### 4a. No drilldown (flat cube)

The default. Clicking a cell opens the right-side details panel showing:
- The selected cell's axis values (coloured badges)
- Count and percentage of total (always shown)
- A 2D slice matrix (if `slice` is configured — see §6)
- Inline info (if `info_box` is configured — see §5)

No config needed beyond axes.

---

### 4b. Treemap drilldown

```yaml
drilldown:
  type: "treemap"
  category_column: "dataset_id"      # outer grouping = the source unit (one tile each)
  category_label_column: "dataset_title"  # optional — display label when category is an opaque id
  category_noun: "datasets"          # optional — plural noun for the count (default "datasets")
  subcategory_column: "cell_type"    # inner tiles (optional)
  count_column: "cell_count"         # column to sum for tile sizes
```

**What it looks like:** clicking a cube opens a full-screen blur overlay with a
hierarchical treemap. The treemap shows how the cell's count is distributed across
the `category_column` groups and, optionally, the `subcategory_column` within each.
The header reports the source concentration (`N_eff` / `D`, see §4f).

**When to use it:** when each cube cell aggregates rows from multiple sources
(studies, datasets, labs) and you want to inspect that breakdown and its concentration.

### `category_column` vs `category_label_column`

`category_column` is the **grouping key** — tiles and the `N_eff`/`D` concentration
are computed over its distinct values, so it should be the stable *source* identifier
(e.g. `dataset_id`, `collection_id`, `lab`). When that identifier is an opaque UUID,
set **`category_label_column`** to a human-readable column (e.g. `dataset_title`):
grouping stays keyed on the id (correct), but tiles are *labelled* by the title.

### `category_noun`

Plural noun for the category count shown in the treemap header and hover (e.g.
"6 **labs**", "14 **datasets**"). Default `"datasets"`. Set it to match your
`category_column` — `"labs"`, `"collections"`, `"studies"`, etc.

---

### 4c. Zoom drilldown — inner cube

```yaml
drilldown:
  type: "zoom"
  axes:
    z:                       # replace one or more outer axes with finer-grained ones
      label: "Organ"
      column: "organ_col"
      max_labels: 30
  size_colour: "score"       # optional — inner cube colour column
```

**What it looks like:** clicking a cube opens a full-screen inner 3D cube where the
replaced axis (here `z`) has been swapped for a finer axis. You can filter, rotate,
and click cells in the inner cube exactly like the outer one.

**Trivial zoom (single sub-value):** if the replaced axis has only one unique value
for the clicked cell, the inner cube is skipped and a compact center panel appears
instead — showing the single sub-label plus any `info_box` content.

**Replacing multiple axes:**

```yaml
drilldown:
  type: "zoom"
  axes:
    y:
      label: "Cell Type"
      column: "cell_type_col"
    z:
      label: "Organ"
      column: "organ_col"
```

You can replace 1, 2, or all 3 axes. Axes not listed inherit from the outer cube.

**Source highlighting:** clicking an info-box card, one of the rows inside it (when
each row is its own source), or a treemap tile highlights every cube cell that
contains that source; all other cells are greyed out. Click again to deselect; "Clear Sel."
resets. Cells are found through the per-cell treemaps, so this needs a source column
(`drilldown.treemap.category_column`, or `datasets_column` as a fallback). Works in the
inner zoom cube and, for treemap drilldowns, in the outer cube.

---

### 4d. Zoom + treemap combo

```yaml
drilldown:
  type: "zoom"
  axes:
    z:
      label: "Organ"
      column: "organ_col"
  treemap:                         # optional — adds a treemap side panel to the zoom view
    category_column: "dataset_id"  # same treemap keys as §4b (category_label_column,
    category_noun: "datasets"      # category_noun, etc. all apply here too)
    subcategory_column: "cell_type"
    count_column: "cell_count"
```

**What it looks like:** the inner cube opens full-screen AND a collapsible treemap
panel appears alongside it, showing the distribution of datasets within the selected
outer cell.

---

### 4e. Drilldown Axis Colors (`drilldown.axis_colors`)

By default the inner zoom cube uses blue, green, and amber for its three axis
labels and titles. Override any of these with `drilldown.axis_colors`:

```yaml
drilldown:
  type: "zoom"
  axes:
    z:
      label: "Brain region"
      column: "tissue_canonical"
  axis_colors:
    x: "#8b5cf6"   # violet — X axis
    y: "#06b6d4"   # cyan — Y axis
    z: "#14b8a6"   # teal — Z axis
```

All three keys (`x`, `y`, `z`) are optional — omit any to keep the default colour for
that axis. Accepts any CSS hex colour string.

---

## 4f. Source Concentration (`N_eff` and `D`) and `concentration_thresholds`

Whenever a treemap is configured (treemap mode or the zoom+treemap combo), the
header and the cube hover report **how concentrated a cell's magnitude is across its
sources** — the distinct values of the treemap `category_column`:

- **`N_eff`** — the *effective number of sources*, the inverse Simpson index
  `1 / Σ pᵢ²` (where `pᵢ` is each source's share). It reads as "this cell is
  equivalent to ~`N_eff` equally-contributing sources." (A Shannon variant,
  `exp(H)`, is also computed and reported in logs.)
- **`D`** — the single largest source's share (max `pᵢ`), an intuitive companion.

Both are computed over **all** sources in the cell (not a top-N subset).

```yaml
concentration_thresholds: [2, 5]   # [skewedBelow, diverseAtOrAbove] on N_eff; default [2, 5]
```

`concentration_thresholds` sets the colour bands on `N_eff`: below the first value =
"single-source", between = "skewed", at/above the second = "diverse" (rendered in a
colour-vision-deficiency-safe palette). Tune it to your data — e.g. `[1.3, 4]` to
flag only near-single-source cells.

**Interpretation.** Read `N_eff`/`D` *together with cell size*: a **large** cell with
low `N_eff` is the cautionary case (apparent magnitude rests on one source). A
**small** cell with low `N_eff` is just sparse coverage. `D = 1` is a reliable
single-source flag; a *low* `D` is **not** an all-clear, since it depends on how
independent the chosen `category_column` units actually are. Choose `category_column`
to be the most defensible *independent source* for your data (e.g. a study/collection,
or a producing lab), and state which it is.

---

## 5. Info Panels — Showing Text on Click

Two separate config sections, each maps a display name to a CSV column.

### `info_box` — inline in the right-side panel

```yaml
info_box:
  columns:
    manuscript: "manuscript_title"
    url:        "manuscript_url"
    year:       "manuscript_year"
    doi:        "doi_col"
```

Entries appear directly in the details panel on the right whenever a cell is
selected, under a header counting the cell's sources (e.g. *"31 publications · 183
datasets"*). When a source column is configured — `drilldown.treemap.category_column`
(zoom), `drilldown.category_column` (treemap) or `datasets_column` — every entry is
tagged with its source, so the number of sources matches the treemap of the same cell.
Rows that produce identical entries are deduplicated.

A field named `title` becomes the card heading (otherwise `dataset` is used). Entries
sharing a `title` are grouped into **one card per title** (e.g. one per publication)
that lists the finer units behind it (the `dataset` field) with their magnitude; cards
are sorted by magnitude. Fields identical across a card's entries (e.g. citation, doi)
are shown once. Titles and citations that are not in the main table can be joined in
from a lookup table via `metadata_csv` (§3b).

Fields named `url` or `doi` are rendered as clickable links. A `doi` field value is
automatically prefixed with `https://doi.org/`.

### `info` — full-screen center modal

```yaml
info:
  columns:
    title:  "study_title"
    author: "first_author"
    doi:    "doi_col"
    url:    "url_col"
```

Clicking a cell (with no zoom or treemap drilldown) opens a full-screen blur overlay
listing all matching entries. Same deduplication and link behaviour as `info_box`.

### Using both together

You can configure `info_box` and `info` simultaneously. `info_box` always appears
inline in the side panel; `info` always appears as the center modal.

---

## 5b. Per-Cell Charts (`charts_json`)


Points to a JSON file (relative path from the HTML base, or an absolute URL) mapping each
key to a small chart shown in the details panel when a cell whose axis value matches that
key is selected. Each key is a raw axis value (before `value_labels` remapping). When an
outer cell contains exactly one matching key with no inner cell selected, the chart appears
automatically.

**Three chart types** are supported via the `type` field: `sparkline` (the default),
`line`, and `bar`.

```json
{
  "AAPL":  { "type": "sparkline", "price": [["2025-01-01", 182.50], ["2025-01-08", 187.20]] },
  "Blood": { "type": "line", "data": [[2019, 12], [2020, 31], [2021, 64]], "y_label": "datasets" },
  "Brain": { "type": "bar",  "data": [["10x 3' v3", 63], ["10x 3' v2", 21], ["Smart-seq", 4]], "color": "#1793ad" }
}
```

- **`sparkline`** (default) — a percentage-return area sparkline. The series is given as
  `price` (or `data`) as `[date, value]` pairs; the chart converts values to percentage
  return since the first point and colours the area green above zero, red below. A bare
  `{ "price": [...] }` with no `type` is treated as a sparkline, so existing configs keep
  working unchanged.
- **`line`** — a plain line chart of `data` (`[x, value]` pairs), plotted on its raw value
  scale (no percentage transform). Optional `x_label`, `y_label`, and `color`.
- **`bar`** — a categorical bar chart of `data` (`[category, value]` pairs). Optional
  `y_label` and `color`.

`color` accepts any CSS colour and applies to `line`/`bar` only (the sparkline uses fixed
green/red). All three render as compact, self-contained SVG — no external charting library
is pulled in.

---

## 6. 2D Slice

```yaml
slice:
  fixed_axis: "x"             # "x", "y", or "z" — axis held fixed
  count_column: "count"       # optional — must be the magnitude column (size_colour / colour)
```

**What it looks like:** a "View 2D Slice" toggle appears in the right-side panel.
When expanded it shows a matrix heatmap of the two free axes at the fixed value of
the selected cell. Useful for comparing counts across all (y, z) combinations for a
given organism, for example.

**What it counts:** each entry is the **sum of the magnitude** (`size_colour`, or
`colour`) over all records in that (fixed value, row, column) combination — the same
number the cube colours by, shown flat and exact. Without a magnitude column every
record counts as 1 (number of table rows). It never counts sources; use the treemap
for that. Rows and columns with no data at the fixed value are omitted. The slice
cannot aggregate other columns: a `count_column` other than the magnitude column is
ignored with a warning.

---

## 7. Axis Ordering (`axis_order`)

```yaml
axis_order: "frequency"   # default — most common categories first (same rank as max_labels)
# or
axis_order: "cluster"     # reorder by co-occurrence similarity after max_labels selection
```

Controls the order in which axis labels are displayed.

**`frequency` (default):** labels are sorted by descending total count, matching the
`max_labels` selection rank. The most common category appears first on each axis. No
extra dependencies required.

**`cluster`:** after `max_labels` selection, each axis is independently reordered by
average-linkage cosine clustering on co-occurrence profiles. Each label is represented
as a vector of its counts across all combinations of the other two axes (mode-*k* tensor
unfolding); vectors are L2-normalised and pairwise cosine distances feed
average-linkage hierarchical clustering. The dendrogram leaf order becomes the
displayed axis order. This groups categories with similar occupancy patterns together,
making spatial structure easier to read in large views. Axes with ≤ 2 labels are left
unchanged.

> **Python:** uses scipy, which is installed automatically as a dependency of metacube.
>
> **R:** uses `stats::hclust` from base R — no extra package needed.

Note: `value_order` (see §2c) takes precedence over `axis_order` for any axis that
has an explicit `value_order` list.

---

## 8. Axis Grouping (`group_separator`)

```yaml
axes:
  x:
    column: "organism_assay"
    group_separator: "_"
```

If axis values follow a `prefix_suffix` pattern (e.g. `human_singlecell`,
`human_bulkRNA`, `mouse_singlecell`), setting `group_separator` groups them visually
in the control panel under a shared heading. The prefix becomes the group label and
the suffix is shown as the sub-item.

`group_separator` works on all three axes (X, Y, and Z). When you use `columns` with
a `combine_separator` (see §2b), the `combine_separator` is automatically used as
`group_separator` as well, so no separate declaration is needed.

---

## 9. Quick Reference

Fields are grouped by function and ordered the way a config is usually assembled:
**axis assignment → per-axis settings → magnitude & colour → appearance → dataset highlighting → drill-down → detail views.**

> **A note on the three colour maps.** `axes.{x,y,z}.colors` and the global `colors` are the **same mechanism** at different scopes —
> a `value → "#hex"` map that colours the **data categories** (per-axis overrides the global map). `axis_colors.{x,y,z}` is unrelated:
> it sets one colour for an **axis's title/label chrome**, not for data values.

### General

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | no | Header title |

### Axis assignment (manual vs. auto, §2d)

| Field | Type | Required | Description |
|---|---|---|---|
| `axes.mode` | `"manual"` \| `"auto"` | no | `auto` picks axis columns by data-driven variety scoring; default `manual` |
| `axes.max_labels` | int | no | In auto mode, caps labels on every chosen axis (outer + inner) |
| `axes.auto.weighting` | `"cube_cells"` \| `"count"` \| `"presence"` | no | Row weighting for auto scoring (default `cube_cells`) |
| `axes.auto.exclude_columns` | list | no | Columns never used as auto axes |
| `axes.auto.semantic_priors` | map | no | `column: nudge` additive bias for auto scoring (0 = neutral) |
| `axes.auto.outer_max_labels` / `inner_max_labels` | int | no | Per-tier label caps; override `axes.max_labels` |

### Per-axis settings (`axes.{x,y,z}`)

| Field | Type | Required | Description |
|---|---|---|---|
| `.column` | string | yes* | CSV column name (*or use `columns`, or `axes.mode: auto` §2d) |
| `.columns` | list | yes* | Combine multiple CSV columns into one axis value (§2b); ignored if `column` is set |
| `.combine_separator` | string | no | Separator joining `columns` values (default `" — "`); also sets `group_separator` |
| `.column_value_labels` | nested map | no | Per-column value remapping applied before joining `columns`; values remapping to `""` are dropped |
| `.label` | string | no | Display label (defaults to column name) |
| `.description` | string | no | Tooltip text shown on hover/click of axis title; supports `\n` |
| `.max_labels` | int | no | Keep top-N values by count |
| `.sort_by` | string | no | Sort axis labels by mean of this numeric CSV column |
| `.sort_order` | `"asc"` \| `"desc"` | no | Sort direction (default: `"desc"`) |
| `.value_labels` | map | no | `raw_value: "Display Label"` remapping |
| `.value_order` | list | no | Explicit label order; listed values first, unlisted values alphabetically after |
| `.colors` | map | no | Per-axis `value: "#hex"` colour map; overrides the global `colors` |
| `.group_separator` | string | no | Splits values into groups by prefix; works on X, Y, and Z axes |

### Magnitude & colour value

| Field | Type | Required | Description |
|---|---|---|---|
| `size_colour` | string | no | Numeric column → block size + colour gradient |
| `colour` | string | no | Numeric column → colour only; block size = row count |
| `color_aggregation` | `"sum"` \| `"mean"` | no | How to combine colour values per cell (default: `"sum"`) |
| `color_label` | string | no | Label shown next to colour value in hover tooltip |
| `count_label` | string | no | Noun for one unit of the magnitude (size), shown next to counts, e.g. `"cells"` / `"experiments"` (§3) |
| `color_palette` | string \| map | no | Gradient palette for the numeric colour value — named palette or `{name,type,low/mid/high_color}` (§3f) |
| `colors` | map | no | Global `value: "#hex"` map applied to all axes; override per-axis via `axes.{x,y,z}.colors` |

### Appearance & theming (§3f)

| Field | Type | Required | Description |
|---|---|---|---|
| `colour_scheme` | `"default"` \| `"asap"` | no | Named app theme; light/dark still chosen at runtime |
| `axis_colors.{x,y,z}` | string | no | Per-axis hex colour for an axis's **title/label chrome** (not data values — contrast `axes.*.colors`) |
| `background` | string | no | Scene background — any CSS background (solid hex or gradient); default white |
| `uniform_cell_color` | string | no | Flat cell colour when no `size_colour`/`colour` gradient (default `#60a5fa`) |
| `tilt_group_labels` | bool | no | Rotate grouped-axis headers parallel to their axis (default `false`) |

### Ordering

| Field | Type | Required | Description |
|---|---|---|---|
| `axis_order` | `"frequency"` \| `"cluster"` | no | Label order — frequency (default) or cosine-clustering; overridden per-axis by `value_order` |

### Dataset highlighting & metadata

| Field | Type | Required | Description |
|---|---|---|---|
| `datasets_column` | string | no | String column → shown in hover tooltip; required by `ghost_datasets` and `accent_datasets` |
| `ghost_datasets` | string | no | Cells where ALL datasets contain this substring render as wireframe outlines |
| `accent_datasets` | string | no | Cells where ANY dataset contains this substring render in accent colour; requires `datasets_column` |
| `accent_color` | string | no | Hex colour for accent cells (default `#f59e0b`) |
| `accent_label` | string | no | Legend label for accent cells in ControlPanel |
| `metadata_csv` | string | no | Path to a secondary CSV (relative to main CSV) joined onto main data by `metadata_join_key` |
| `metadata_join_key` | string | no | Column used to join `metadata_csv` (default: `dataset_key`) |
| `tooltip_breakdown` | string | no | Column to aggregate per-cell for a subtypes section in the hover tooltip; skips empty and "unknown" values |

### Drill-down (`drilldown`)

| Field | Type | Required | Description |
|---|---|---|---|
| `.type` | `"treemap"` \| `"zoom"` | no | Click-to-expand mode |
| `.category_column` | string | treemap | Outer grouping = the source unit; tiles and `N_eff`/`D` are computed over its distinct values (§4b) |
| `.category_label_column` | string | no | Human-readable label for tiles when `category_column` is an opaque id (§4b) |
| `.category_noun` | string | no | Plural noun for the category count in the UI, e.g. `"labs"` (default `"datasets"`) (§4b) |
| `.subcategory_column` | string | no | Inner tiles in treemap |
| `.count_column` | string | no | Column to sum for treemap tile sizes |
| `.axes.{x,y,z}` | map | zoom | Axis replacement config for inner cube; supports `label`, `description`, `column`, `columns`, `max_labels`, `sort_by`, `sort_order`, `value_labels`, `value_order` |
| `.size_colour` | string | no | Inner-cube colour column (zoom only) |
| `.treemap` | map | no | Treemap panel alongside zoom view (accepts the same `category_*` / `subcategory_column` / `count_column` keys) |
| `.axis_colors.{x,y,z}` | string | no | Per-axis hex colour overrides for inner zoom cube title/label chrome |

### Source concentration (§4f)

| Field | Type | Required | Description |
|---|---|---|---|
| `concentration_thresholds` | `[number, number]` | no | `N_eff` band cutoffs `[skewedBelow, diverseAtOrAbove]` for the treemap concentration colour (default `[2, 5]`) |

### Detail panel & plots

| Field | Type | Required | Description |
|---|---|---|---|
| `info_box.columns` | map | no | `display_name: csv_column` → inline side panel |
| `info.columns` | map | no | `display_name: csv_column` → center modal |
| `slice.fixed_axis` | `"x"` \| `"y"` \| `"z"` | if slice | Axis held fixed in 2D slice |
| `slice.count_column` | string | no | Column to aggregate in slice |
| `charts_json` | string | no | Path to a JSON file with per-cell charts shown in the details panel; each entry's `type` selects `sparkline` (default), `line`, or `bar` (§5b) |

---

## 10. Worked Examples

All three examples use the bundled `census_tissue_general_counts_primary.csv` (columns:
`organism, tissue_general, tissue, assay, dataset_id, collection_id, dataset_title,
collection_doi, cell_type, count`). It counts primary cells only (`is_primary_data ==
True`), so cells that Census re-releases in subset or integrated datasets are counted once.

Publication titles and citations come from `census_collections.csv`, joined on
`collection_id` via `metadata_csv`. All files ship with both packages
(`metacube examples --dest .`) and are available in the browser playground.

**Terms used for Census:** a *source* is a publication (Census *collection*) — the
unit for the treemap tiles and N_eff / D; a *dataset* is one of Census's individual
files within a publication, listed under its publication in the info box.

---

### Example A — Flat cube with inline publication info

No drilldown. Clicking a cell lists the contributing publications in the right-side
panel via `info_box`: one card per publication (title, citation, DOI) with its datasets.
Publication titles and citations are joined in from a lookup table via `metadata_csv`.

```yaml
title: "CellxGene Census — Flat"

axes:
  x:
    label: "Organism"
    column: "organism"
  y:
    label: "Assay"
    column: "assay"
    max_labels: 20
  z:
    label: "Tissue"
    column: "tissue_general"
    max_labels: 30

size_colour: "count"
count_label: "cells"

metadata_csv: "census_collections.csv"
metadata_join_key: "collection_id"

info_box:
  columns:
    title:    "publication"
    citation: "citation"
    dataset:  "dataset_title"
    doi:      "collection_doi"
```

---

### Example B — Treemap drilldown

Clicking a cell opens a full-screen treemap showing how cell counts are distributed
across datasets and cell types.

```yaml
title: "CellxGene Census — Treemap"

axes:
  x:
    label: "Organism"
    column: "organism"
  y:
    label: "Assay"
    column: "assay"
    max_labels: 20
  z:
    label: "Tissue Group"
    column: "tissue_general"
    max_labels: 30

size_colour: "count"
count_label: "cells"

drilldown:
  type: "treemap"
  category_column: "collection_id"        # source = publication (concentration unit)
  category_label_column: "citation"       # tiles labelled "Siletti et al. (2023) Science"
  category_noun: "publications"
  subcategory_column: "cell_type"
  count_column: "count"

slice:
  fixed_axis: "x"
  count_column: "count"
```

The treemap header reports `N_eff` / `D` over publications (the source
concentration, §4f), with tiles labelled by citation (joined from
`census_collections.csv` via `metadata_csv: "census_collections.csv"`,
`metadata_join_key: "collection_id"`) and counts in `count_label` units
("21.2M cells").

---

### Example C — Zoom into finer tissue resolution + treemap panel

Clicking a tissue-group cell opens a full inner cube broken down by specific tissue,
with a treemap side panel showing dataset contributions.

```yaml
title: "CellxGene Census — Zoom"

axes:
  x:
    label: "Organism"
    column: "organism"
  y:
    label: "Assay"
    column: "assay"
    max_labels: 20
  z:
    label: "Tissue Group"
    column: "tissue_general"
    max_labels: 30

size_colour: "count"
count_label: "cells"

drilldown:
  type: "zoom"
  axes:
    z:
      label: "Tissue"
      column: "tissue"
      max_labels: 30
  treemap:
    category_column: "collection_id"
    category_label_column: "citation"
    category_noun: "publications"
    subcategory_column: "cell_type"
    count_column: "count"

slice:
  fixed_axis: "x"
  count_column: "count"
```

---

