"""CSV + config.yaml → CubeData JSON."""
from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

from .autoaxes import apply_auto_axes


def csv_to_cube_data(csv_path: str | Path, config_path: str | Path) -> dict[str, Any]:
    """Transform a CSV file and config YAML into a CubeData JSON-serialisable dict.

    Args:
        csv_path: Path to the input CSV file.
        config_path: Path to the config YAML file defining axis mappings.

    Returns:
        A dict matching the CubeData schema expected by window.__CUBE_DATA__.
    """
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    df = pd.read_csv(csv_path)

    # metadata_csv: left-join a secondary lookup table (title/year/doi …) onto the
    # main data so info panels can reference those columns without repeating them
    # per row. Runs before everything else so joined columns are axis candidates.
    if cfg.get("metadata_csv"):
        df = _join_metadata(df, csv_path, cfg["metadata_csv"],
                            cfg.get("metadata_join_key", "dataset_key"))

    # axes.mode: auto → fill in axis columns by data-driven variety scoring.
    # No-op for manual configs.
    cfg = apply_auto_axes(df, cfg)

    # Multi-column axes: materialise any `columns` axis into a synthetic combined
    # column on the (in-memory) dataframe. No-op unless `columns` is used.
    _resolve_axis_columns(df, cfg)

    x_col = cfg["axes"]["x"]["column"]
    y_col = cfg["axes"]["y"]["column"]
    z_col = cfg["axes"]["z"]["column"]
    # size_colour drives both block size and colour; colour drives colour only
    # (size stays at the row count). rank_col is whichever numeric column exists.
    size_col_col = cfg.get("size_colour")
    colour_col   = cfg.get("colour")
    rank_col     = size_col_col or colour_col
    datasets_col = cfg.get("datasets_column")

    for col, label in [(x_col, "axes.x.column"), (y_col, "axes.y.column"), (z_col, "axes.z.column")]:
        if col not in df.columns:
            raise ValueError(f"Column '{col}' ({label}) not found in CSV. Available: {list(df.columns)}")
    for col, label in [(size_col_col, "size_colour"), (colour_col, "colour")]:
        if col and col not in df.columns:
            raise ValueError(f"Column '{col}' ({label}) not found in CSV. Available: {list(df.columns)}")

    max_x = cfg["axes"]["x"].get("max_labels")
    max_y = cfg["axes"]["y"].get("max_labels")
    max_z = cfg["axes"]["z"].get("max_labels")

    if max_x or max_y or max_z:
        df = _apply_max_labels(df, x_col, y_col, z_col, rank_col, max_x, max_y, max_z)

    records: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rec: dict[str, Any] = {
            "x": str(row[x_col]),
            "y": str(row[y_col]),
            "z": str(row[z_col]),
            "size": 1,
            "datasets": [str(row[datasets_col])] if datasets_col and pd.notna(row.get(datasets_col)) else [],
        }
        if colour_col and pd.notna(row.get(colour_col)):
            # colour-only: size stays at the row count (1), colour carries the value
            rec["color"] = float(row[colour_col])
        elif size_col_col and pd.notna(row.get(size_col_col)):
            val = float(row[size_col_col])
            rec["size"] = val
            rec["color"] = val
        records.append(rec)

    xs = _ordered_unique(df[x_col].dropna().astype(str))
    ys = _ordered_unique(df[y_col].dropna().astype(str))
    zs = _ordered_unique(df[z_col].dropna().astype(str))

    if cfg.get("axis_order", "frequency") == "cluster":
        xs, ys, zs = _cluster_axis_order(df, x_col, y_col, z_col, rank_col, xs, ys, zs)

    cube_config = _build_config(cfg)
    result: dict[str, Any] = {
        "config": cube_config,
        "records": records,
        "xs": xs,
        "ys": ys,
        "zs": zs,
    }

    drilldown_cfg = cfg.get("drilldown")
    if drilldown_cfg:
        size_from_color = bool(size_col_col or drilldown_cfg.get("size_colour"))
        result["drilldown"] = _build_drilldown(
            df, drilldown_cfg, x_col, y_col, z_col, rank_col, size_from_color
        )
        treemap_cfg = drilldown_cfg.get("treemap") if drilldown_cfg.get("type") == "zoom" else None
        if treemap_cfg:
            result["treemap"] = _build_treemap(df, treemap_cfg, x_col, y_col, z_col)

    info_cfg = cfg.get("info")
    if info_cfg:
        result["info"] = _build_info(df, info_cfg, x_col, y_col, z_col)

    info_box_cfg = cfg.get("info_box")
    if info_box_cfg:
        # For zoom drilldown, key info_box by inner axes so the lookup matches
        # the selected inner cell (which carries inner column values, not outer).
        ix, iy, iz = _resolve_info_axes(cfg, x_col, y_col, z_col)
        # Zoom: also scope by the outer cell (6-part key) so sources from different
        # outer cells don't bleed into each other — matches the playground transform.
        drill = cfg.get("drilldown") or {}
        outer = (x_col, y_col, z_col) if drill.get("type") == "zoom" and drill.get("axes") else None
        result["infoBox"] = _build_info(
            df, info_box_cfg, ix, iy, iz, outer_cols=outer, source_col=_source_column(cfg),
        )

    breakdown_col = cfg.get("tooltip_breakdown")
    if breakdown_col:
        # Weight by size_colour (the cell's size); in colour-only mode size is the
        # row count, so the weight is 1 per row — matches the playground transform.
        result["cellBreakdown"] = _build_cell_breakdown(df, x_col, y_col, z_col, breakdown_col, size_col_col)
        # Zoom: also key by outer|inner (6-part) so inner cells get their own breakdown.
        if drilldown_cfg and drilldown_cfg.get("type") == "zoom" and drilldown_cfg.get("axes"):
            ix, iy, iz = _resolve_info_axes(cfg, x_col, y_col, z_col)
            inner = _build_cell_breakdown(
                df, ix, iy, iz, breakdown_col, size_col_col, prefix_axes=(x_col, y_col, z_col)
            )
            result["cellBreakdown"].update(inner)

    return result


def _join_metadata(
    df: pd.DataFrame,
    main_csv_path: str | Path,
    metadata_csv: str,
    join_key: str,
) -> pd.DataFrame:
    """Left-join a secondary metadata CSV onto ``df`` by ``join_key``.

    The metadata path is resolved relative to the main CSV when not absolute.
    Columns absent from ``df`` are added; for columns already present, only
    blank/missing cells are filled — existing values are never overwritten.
    Missing file or join key is a warning, not an error (the join is skipped).
    """
    meta_path = Path(metadata_csv)
    if not meta_path.is_absolute():
        meta_path = Path(main_csv_path).resolve().parent / meta_path
    if not meta_path.exists():
        warnings.warn(f"metadata_csv not found: {meta_path} — skipping join", stacklevel=2)
        return df
    if join_key not in df.columns:
        warnings.warn(
            f"metadata_join_key '{join_key}' not in main CSV — skipping join", stacklevel=2)
        return df

    meta = pd.read_csv(meta_path, dtype=str)
    if join_key not in meta.columns:
        warnings.warn(
            f"metadata_join_key '{join_key}' not in {meta_path.name} — skipping join", stacklevel=2)
        return df

    meta = meta.drop_duplicates(subset=[join_key]).set_index(join_key)
    keys = df[join_key].astype("string")
    for col in meta.columns:
        mapped = keys.map(meta[col])
        if col in df.columns:
            existing = df[col].astype("string")
            blank = existing.isna() | (existing.str.strip() == "")
            df[col] = existing.where(~blank, mapped)
        else:
            df[col] = mapped
    return df


def _combined_series(df: pd.DataFrame, axis_cfg: dict[str, Any]) -> list[str]:
    """Build one combined string per row from ``axis_cfg['columns']``.

    Each component is optionally remapped via ``column_value_labels`` (a value
    mapped to "" is dropped), then the surviving components are joined with
    ``combine_separator`` (default " — "). Missing columns are treated as "".
    """
    cols = axis_cfg.get("columns") or []
    sep = axis_cfg.get("combine_separator", " — ")
    col_labels = axis_cfg.get("column_value_labels") or {}
    components: list[list[str]] = []
    for c in cols:
        s = (df[c] if c in df.columns else pd.Series([""] * len(df), index=df.index))
        s = s.astype("string").fillna("")
        m = col_labels.get(c)
        if m:
            s = s.map(lambda v, _m=m: _m.get(v, v))
        components.append(list(s))
    return [sep.join(v for v in row if v != "") for row in zip(*components)] if components else [""] * len(df)


def _resolve_axis_columns(df: pd.DataFrame, cfg: dict[str, Any]) -> None:
    """Materialise `columns` (multi-column) axes into synthetic dataframe columns.

    For any outer or zoom-drilldown axis that declares ``columns`` but no
    ``column``, add a combined column to ``df`` (in memory — the source CSV is
    never modified) and point the axis at it. No-op when ``columns`` is unused.
    """
    def _resolve(axis_cfg: Any, key: str) -> None:
        # axis_cfg must be the live dict from cfg so the assignment writes back.
        if isinstance(axis_cfg, dict) and axis_cfg.get("columns") and not axis_cfg.get("column"):
            df[key] = _combined_series(df, axis_cfg)
            axis_cfg["column"] = key

    axes = cfg.get("axes") or {}
    for ax in ("x", "y", "z"):
        _resolve(axes.get(ax), f"__combined_{ax}")

    drill_axes = (cfg.get("drilldown") or {}).get("axes") or {}
    for ax in ("x", "y", "z"):
        _resolve(drill_axes.get(ax), f"__combined_drill_{ax}")


def _cluster_axis_order(
    df: pd.DataFrame,
    x_col: str, y_col: str, z_col: str,
    size_col: str | None,
    xs: list[str], ys: list[str], zs: list[str],
) -> tuple[list[str], list[str], list[str]]:
    """Reorder each axis by average-linkage cosine clustering on co-occurrence profiles.

    For each axis, the mode-k unfolding of the count tensor is used: each label
    becomes a row vector of its co-occurrence counts across all combinations of the
    other two axes. Rows are L2-normalised and pairwise cosine distances are fed to
    average-linkage hierarchical clustering; the dendrogram leaf order becomes the
    new axis order. Axes with ≤2 labels are left unchanged.

    Requires scipy. Falls back to frequency order with a warning if scipy is absent.
    """
    try:
        from scipy.cluster.hierarchy import leaves_list, linkage
        from scipy.spatial.distance import pdist
    except ImportError:
        warnings.warn(
            "scipy is required for axis_order='cluster'. "
            "Install it with: pip install scipy. "
            "Falling back to frequency order.",
            stacklevel=4,
        )
        return xs, ys, zs

    xi = {v: i for i, v in enumerate(xs)}
    yi = {v: i for i, v in enumerate(ys)}
    zi = {v: i for i, v in enumerate(zs)}

    tensor = np.zeros((len(xs), len(ys), len(zs)), dtype=float)
    xv = df[x_col].astype(str)
    yv = df[y_col].astype(str)
    zv = df[z_col].astype(str)
    sv = df[size_col].fillna(0).astype(float) if size_col and size_col in df.columns else pd.Series(1.0, index=df.index)

    for x, y, z, s in zip(xv, yv, zv, sv):
        if x in xi and y in yi and z in zi:
            tensor[xi[x], yi[y], zi[z]] += s

    def _reorder(labels: list[str], M: np.ndarray) -> list[str]:
        n = len(labels)
        if n <= 2:
            return labels
        norms = np.linalg.norm(M, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        M_norm = M / norms
        dists = pdist(M_norm, metric="cosine")
        Z = linkage(dists, method="average")
        return [labels[i] for i in leaves_list(Z)]

    # Mode-k unfoldings: each row is the flattened co-occurrence profile for one label.
    xs_new = _reorder(xs, tensor.reshape(len(xs), -1))
    ys_new = _reorder(ys, tensor.transpose(1, 0, 2).reshape(len(ys), -1))
    zs_new = _reorder(zs, tensor.transpose(2, 0, 1).reshape(len(zs), -1))
    return xs_new, ys_new, zs_new


def _ordered_unique(series: pd.Series) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in series:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _top_labels(df: pd.DataFrame, col: str, rank_col: str | None, n: int) -> set[str]:
    """Return top n values in col, ranked by sum of rank_col (or by row count if None)."""
    if rank_col:
        totals = df.groupby(col)[rank_col].sum().nlargest(n)
    else:
        totals = df.groupby(col).size().nlargest(n)
    return set(totals.index.astype(str))


def _apply_max_labels(
    df: pd.DataFrame,
    x_col: str, y_col: str, z_col: str,
    color_col: str | None,
    max_x: int | None, max_y: int | None, max_z: int | None,
) -> pd.DataFrame:
    if max_x:
        df = df[df[x_col].astype(str).isin(_top_labels(df, x_col, color_col, max_x))]
    if max_y:
        df = df[df[y_col].astype(str).isin(_top_labels(df, y_col, color_col, max_y))]
    if max_z:
        df = df[df[z_col].astype(str).isin(_top_labels(df, z_col, color_col, max_z))]
    return df


def _axis_label(a: dict[str, Any]) -> str:
    """Axis display label: explicit `label`, else combined `columns`, else `column`."""
    if a.get("label"):
        return a["label"]
    if a.get("columns"):
        return " / ".join(str(c) for c in a["columns"])
    return str(a.get("column", ""))


def _build_config(cfg: dict) -> dict[str, Any]:
    axes_cfg = cfg["axes"]
    config: dict[str, Any] = {
        "title": cfg.get("title", "My Dataset"),
        "axes": {
            "x": {"label": _axis_label(axes_cfg["x"])},
            "y": {"label": _axis_label(axes_cfg["y"])},
            "z": {"label": _axis_label(axes_cfg["z"])},
        },
    }
    for ax in ("x", "y", "z"):
        colors = axes_cfg[ax].get("colors")
        if colors:
            config["axes"][ax]["colors"] = colors
        # Multi-column axes group by their first component, so combine_separator
        # doubles as the group separator unless one is set explicitly.
        sep = axes_cfg[ax].get("group_separator")
        if not sep and len(axes_cfg[ax].get("columns") or []) > 1:
            sep = axes_cfg[ax].get("combine_separator", " — ")
        if sep:
            config["axes"][ax]["groupSeparator"] = sep

    if cfg.get("colors"):
        config["colors"] = cfg["colors"]
    if cfg.get("axis_colors"):
        config["axisColors"] = cfg["axis_colors"]
    if cfg.get("background"):
        config["background"] = cfg["background"]
    if cfg.get("tilt_group_labels"):
        config["tiltGroupLabels"] = True
    if cfg.get("colour_scheme"):
        config["colour_scheme"] = cfg["colour_scheme"]
    if cfg.get("concentration_thresholds"):
        config["concentrationThresholds"] = cfg["concentration_thresholds"]

    drilldown_cfg = cfg.get("drilldown")
    if drilldown_cfg:
        drill: dict[str, Any] = {"type": drilldown_cfg["type"]}
        if "axes" in drilldown_cfg:
            drill["axes"] = {
                ax: {"label": _axis_label(drilldown_cfg["axes"][ax])}
                for ax in ("x", "y", "z")
                if ax in drilldown_cfg.get("axes", {})
            }
        if drilldown_cfg.get("axis_colors"):
            drill["axisColors"] = drilldown_cfg["axis_colors"]
        noun = drilldown_cfg.get("category_noun") or (drilldown_cfg.get("treemap") or {}).get("category_noun")
        if noun:
            drill["categoryNoun"] = noun
        config["drilldown"] = drill

    # Colour value present when either size_colour (size + colour) or colour (colour only).
    colour_value = cfg.get("size_colour") or cfg.get("colour")
    if colour_value:
        config["hasColorValues"] = True
        palette = cfg.get("color_palette")
        if palette:
            config["colorPalette"] = {"name": palette} if isinstance(palette, str) else palette
        if cfg.get("color_aggregation"):
            config["colorAggregation"] = cfg["color_aggregation"]
        if cfg.get("color_label"):
            config["colorLabel"] = cfg["color_label"]
        if cfg.get("color_scale"):
            config["colorScale"] = cfg["color_scale"]
    elif cfg.get("uniform_cell_color"):
        # Only pin an explicit cell colour; otherwise leave the renderer to fall
        # back to the active theme's default (so it stays reactive to light/dark).
        config["uniformCellColor"] = cfg["uniform_cell_color"]

    if cfg.get("count_label"):
        config["countLabel"] = cfg["count_label"]
    if cfg.get("count_label_legend"):
        config["countLabelLegend"] = cfg["count_label_legend"]
    if cfg.get("label_rotation"):
        config["labelRotation"] = cfg["label_rotation"]

    if cfg.get("ghost_datasets"):
        config["ghost_datasets"] = cfg["ghost_datasets"]
    if cfg.get("accent_datasets"):
        config["accent_datasets"] = cfg["accent_datasets"]
    if cfg.get("accent_color"):
        config["accent_color"] = cfg["accent_color"]
    if cfg.get("accent_label"):
        config["accent_label"] = cfg["accent_label"]

    slice_cfg = cfg.get("slice")
    if slice_cfg:
        count_col = slice_cfg.get("count_column")
        if count_col and count_col != colour_value:
            # The slice sums the per-record magnitude; other columns can't be honoured.
            warnings.warn(
                f'slice.count_column "{count_col}" is ignored: the 2D slice sums the '
                f'magnitude column ({colour_value or "row count"}).'
            )
        if count_col and count_col == colour_value:
            count_field = "color"
        else:
            count_field = "size"
        config["slice"] = {
            "fixed_axis": slice_cfg["fixed_axis"],
            "count_field": count_field,
        }

    return config


def _build_drilldown(
    df: pd.DataFrame,
    drilldown_cfg: dict,
    x_col: str, y_col: str, z_col: str,
    outer_color_col: str | None = None,
    size_from_color: bool = True,
) -> dict[str, Any]:
    drill_type = drilldown_cfg["type"]
    result: dict[str, Any] = {}

    if drill_type == "treemap":
        cat_col = drilldown_cfg.get("category_column")
        sub_col = drilldown_cfg.get("subcategory_column")
        label_col = drilldown_cfg.get("category_label_column")
        count_col = drilldown_cfg.get("count_column")
        if not cat_col:
            return result

        def _lbl(sub):
            return ({"label": str(sub[label_col].iloc[0])}
                    if label_col and label_col in sub.columns and len(sub) else {})

        def _n(sub):
            return int(sub[count_col].sum()) if count_col and count_col in sub.columns else int(sub.shape[0])

        for (xv, yv, zv), group in df.groupby([x_col, y_col, z_col]):
            key = f"{xv}|{yv}|{zv}"
            entries = []
            if sub_col and sub_col in df.columns:
                for (d, c), sub in group.groupby([cat_col, sub_col]):
                    entries.append({"d": str(d), "c": str(c), "n": _n(sub), **_lbl(sub)})
            else:
                for d, sub in group.groupby(cat_col):
                    entries.append({"d": str(d), "c": str(d), "n": _n(sub), **_lbl(sub)})
            result[key] = entries

    elif drill_type == "zoom":
        inner_axes_cfg = drilldown_cfg.get("axes", {})
        color_col = drilldown_cfg.get("size_colour") or outer_color_col
        # Inner-cube size comes from the colour value only when a size_colour is in
        # play (outer or inner). With colour-only, size stays at the row count.
        inner_size_from_color = bool(drilldown_cfg.get("size_colour")) or size_from_color
        outer_cols = {"x": x_col, "y": y_col, "z": z_col}

        # For each axis: use the new column if defined in zoom.axes, else inherit outer column
        inner_col = {
            ax: inner_axes_cfg.get(ax, {}).get("column") or outer_cols[ax]
            for ax in ("x", "y", "z")
        }

        # Axes that are being replaced (have an explicit column in zoom.axes)
        replaced = [ax for ax in ("x", "y", "z") if inner_axes_cfg.get(ax, {}).get("column")]
        if not replaced:
            return result

        group_cols = [outer_cols[ax] for ax in replaced]

        for group_vals, group in df.groupby(group_cols):
            if not isinstance(group_vals, tuple):
                group_vals = (group_vals,)
            key = "|".join(str(v) for v in group_vals)

            # Apply max_labels for each replaced axis
            for ax in replaced:
                max_n = inner_axes_cfg.get(ax, {}).get("max_labels")
                col = inner_col[ax]
                if max_n and col in group.columns:
                    top_vals = _top_labels(group, col, color_col, int(max_n))
                    group = group[group[col].astype(str).isin(top_vals)]

            inner_records = []
            for _, row in group.iterrows():
                color_val = float(row[color_col]) if color_col and color_col in group.columns and pd.notna(row.get(color_col)) else None
                rec: dict[str, Any] = {
                    "x": str(row[inner_col["x"]]),
                    "y": str(row[inner_col["y"]]),
                    "z": str(row[inner_col["z"]]),
                    "size": color_val if (color_val is not None and inner_size_from_color) else 1,
                    "datasets": [],
                }
                if color_val is not None:
                    rec["color"] = color_val
                inner_records.append(rec)

            inner_block: dict[str, Any] = {
                "records": inner_records,
                "xs": _ordered_unique(group[inner_col["x"]].dropna().astype(str)),
                "ys": _ordered_unique(group[inner_col["y"]].dropna().astype(str)),
                "zs": _ordered_unique(group[inner_col["z"]].dropna().astype(str)),
            }
            # Per-inner-cell treemap so each hovered inner cell gets its own D
            # (source concentration), computed the same way as the outer cube.
            tm_cfg = drilldown_cfg.get("treemap")
            if tm_cfg and tm_cfg.get("category_column"):
                inner_block["treemap"] = _build_inner_treemap(group, inner_col, tm_cfg)
            result[key] = inner_block

    return result


def _build_inner_treemap(
    group: pd.DataFrame,
    inner_col: dict[str, str],
    treemap_cfg: dict,
) -> dict[str, Any]:
    """Treemap entries keyed by inner-cell key (``x|y|z`` of inner column values).

    Mirrors :func:`_build_treemap` but at the inner-cube granularity so the
    hover tooltip and treemap panel can show a per-inner-cell concentration.
    """
    cat_col = treemap_cfg.get("category_column")
    sub_col = treemap_cfg.get("subcategory_column")
    label_col = treemap_cfg.get("category_label_column")
    count_col = treemap_cfg.get("count_column")
    cols = [inner_col["x"], inner_col["y"], inner_col["z"]]
    if not cat_col or cat_col not in group.columns or any(c not in group.columns for c in cols):
        return {}

    def _lbl(sub):
        return ({"label": str(sub[label_col].iloc[0])}
                if label_col and label_col in sub.columns and len(sub) else {})

    out: dict[str, Any] = {}
    for cell_vals, cell_group in group.groupby(cols):
        if not isinstance(cell_vals, tuple):
            cell_vals = (cell_vals,)
        ckey = "|".join(str(v) for v in cell_vals)
        entries = []
        if sub_col and sub_col in group.columns:
            for (d, c), sub in cell_group.groupby([cat_col, sub_col]):
                n = int(sub[count_col].sum()) if count_col and count_col in sub.columns else int(sub.shape[0])
                entries.append({"d": str(d), "c": str(c), "n": n, **_lbl(sub)})
        else:
            for d, sub in cell_group.groupby(cat_col):
                n = int(sub[count_col].sum()) if count_col and count_col in sub.columns else int(sub.shape[0])
                entries.append({"d": str(d), "c": str(d), "n": n, **_lbl(sub)})
        out[ckey] = entries
    return out


def _build_treemap(
    df: pd.DataFrame,
    treemap_cfg: dict,
    x_col: str, y_col: str, z_col: str,
) -> dict[str, Any]:
    cat_col = treemap_cfg.get("category_column")
    sub_col = treemap_cfg.get("subcategory_column")
    label_col = treemap_cfg.get("category_label_column")
    count_col = treemap_cfg.get("count_column")
    if not cat_col:
        return {}

    def _lbl(sub):
        return ({"label": str(sub[label_col].iloc[0])}
                if label_col and label_col in sub.columns and len(sub) else {})

    result: dict[str, Any] = {}
    for (xv, yv, zv), group in df.groupby([x_col, y_col, z_col]):
        key = f"{xv}|{yv}|{zv}"
        entries = []
        if sub_col and sub_col in df.columns:
            for (d, c), sub in group.groupby([cat_col, sub_col]):
                n = int(sub[count_col].sum()) if count_col and count_col in sub.columns else int(sub.shape[0])
                entries.append({"d": str(d), "c": str(c), "n": n, **_lbl(sub)})
        else:
            for d, sub in group.groupby(cat_col):
                n = int(sub[count_col].sum()) if count_col and count_col in sub.columns else int(sub.shape[0])
                entries.append({"d": str(d), "c": str(d), "n": n, **_lbl(sub)})
        result[key] = entries
    return result


def _resolve_info_axes(cfg: dict, x_col: str, y_col: str, z_col: str) -> tuple[str, str, str]:
    drill = cfg.get("drilldown", {})
    if drill.get("type") != "zoom":
        return x_col, y_col, z_col
    axes = drill.get("axes", {})
    return (
        axes.get("x", {}).get("column") or x_col,
        axes.get("y", {}).get("column") or y_col,
        axes.get("z", {}).get("column") or z_col,
    )


def _source_column(cfg: dict) -> str | None:
    """Column identifying a record's source (the treemap's grouping unit), if any."""
    drill = cfg.get("drilldown") or {}
    treemap = drill.get("treemap") or {}
    return (
        treemap.get("category_column")
        or (drill.get("category_column") if drill.get("type") == "treemap" else None)
        or cfg.get("datasets_column")
    )


def _build_info(
    df: pd.DataFrame,
    info_cfg: dict,
    x_col: str, y_col: str, z_col: str,
    outer_cols: tuple[str, str, str] | None = None,
    source_col: str | None = None,
) -> dict[str, Any]:
    columns: dict[str, str] = info_cfg.get("columns", {})
    result: dict[str, Any] = {}
    group_cols = [*(outer_cols or ()), x_col, y_col, z_col]
    for keys, group in df.groupby(group_cols, sort=False):
        key = "|".join(str(k) for k in keys)
        seen: set[str] = set()
        entries = []
        for _, row in group.iterrows():
            entry: dict[str, str] = {}
            for field, col in columns.items():
                if col in df.columns and pd.notna(row.get(col)):
                    entry[field] = str(row[col])
            if not entry:
                continue
            # Tag each entry with its source id (the treemap's grouping unit) so the
            # info box can group, count and highlight by source. Entries are deduped
            # on all fields, so a source keeps one entry per distinct dataset within it.
            if source_col and source_col in df.columns and pd.notna(row.get(source_col)):
                entry["_source"] = str(row[source_col])
            fingerprint = json.dumps(entry, sort_keys=True)
            if fingerprint not in seen:
                seen.add(fingerprint)
                entries.append(entry)
        if entries:
            result[key] = entries
    return result


def _build_cell_breakdown(
    df: pd.DataFrame,
    x_col: str, y_col: str, z_col: str,
    col: str,
    size_col: str | None = None,
    prefix_axes: tuple[str, str, str] | None = None,
) -> dict[str, dict[str, float]]:
    """Per-cell aggregation of ``col`` for the hover tooltip breakdown.

    Keyed by ``x|y|z`` (outer cells) or ``ox|oy|oz|ix|iy|iz`` when ``prefix_axes``
    is given (zoom inner cells). Empty and "unknown" values are skipped; weights
    come from ``size_col`` (else 1 per row). Mirrors the playground transform.
    """
    if col not in df.columns:
        return {}
    result: dict[str, dict[str, float]] = {}
    for _, row in df.iterrows():
        raw = row.get(col)
        val = "" if pd.isna(raw) else str(raw).strip()
        if not val or val.lower() == "unknown":
            continue
        inner = f"{row[x_col]}|{row[y_col]}|{row[z_col]}"
        if prefix_axes:
            px, py, pz = prefix_axes
            key = f"{row[px]}|{row[py]}|{row[pz]}|{inner}"
        else:
            key = inner
        n = float(row[size_col]) if (size_col and pd.notna(row.get(size_col))) else 1.0
        if n <= 0:
            continue
        bucket = result.setdefault(key, {})
        bucket[val] = bucket.get(val, 0.0) + n
    return result


def save_cube_data(data: dict[str, Any], output_path: str | Path) -> None:
    """Write CubeData dict to a JSON file."""
    with open(output_path, "w") as f:
        json.dump(data, f)
