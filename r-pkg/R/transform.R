#' Transform a data frame into a CubeData list
#'
#' @param df A data.frame with columns matching the config mappings.
#' @param config A named list matching the config YAML schema, or a path to a
#'   YAML file (requires the \pkg{yaml} package).
#' @return A list ready for \code{jsonlite::toJSON()} and \code{cube_build()}.
#' @export
cube_transform <- function(df, config) {
  # Resolve relative metadata_csv paths against the config file's directory when
  # config is a path (R receives df pre-loaded, so there is no main-CSV path);
  # otherwise the working directory.
  config_dir <- if (is.character(config)) dirname(config) else getwd()
  if (is.character(config)) {
    config <- yaml::read_yaml(config)
  }

  # metadata_csv: left-join a secondary lookup table (title/year/doi …) onto df so
  # info panels can reference those columns without repeating them per row. Runs
  # first so joined columns are available as axis candidates.
  if (!is.null(config$metadata_csv)) {
    join_key <- if (!is.null(config$metadata_join_key)) config$metadata_join_key else "dataset_key"
    df <- .join_metadata(df, config$metadata_csv, config_dir, join_key)
  }

  # axes$mode == "auto" -> fill in axis columns by data-driven variety scoring.
  # No-op for manual configs.
  config <- .apply_auto_axes(df, config)

  # Multi-column axes: materialise any `columns` axis into a synthetic combined
  # column on the (in-memory) data.frame. No-op unless `columns` is used.
  resolved <- .resolve_axis_columns(df, config)
  df <- resolved$df; config <- resolved$config

  x_col      <- config$axes$x$column
  y_col      <- config$axes$y$column
  z_col      <- config$axes$z$column
  # Canonical keys: size_colour (drives size + colour) and colour (colour only;
  # size = row count). Fall back to legacy size_column / color_column names.
  size_col   <- if (!is.null(config$size_colour)) config$size_colour else config$size_column
  colour_col <- if (!is.null(config$colour))      config$colour      else config$color_column
  rank_col   <- if (!is.null(size_col)) size_col else colour_col
  ds_col     <- config$datasets_column
  prio_col   <- config$priority_column

  stopifnot(all(c(x_col, y_col, z_col) %in% names(df)))
  for (cc in c(size_col, colour_col)) if (!is.null(cc)) stopifnot(cc %in% names(df))

  df <- .apply_max_labels(df, config$axes, x_col, y_col, z_col, rank_col)

  records <- lapply(seq_len(nrow(df)), function(i) {
    row <- df[i, ]
    rec <- list(
      x       = as.character(row[[x_col]]),
      y       = as.character(row[[y_col]]),
      z       = as.character(row[[z_col]]),
      size    = 1L,
      datasets = if (!is.null(ds_col) && ds_col %in% names(df) && !is.na(row[[ds_col]]))
                   list(as.character(row[[ds_col]])) else list()
    )
    if (!is.null(colour_col) && !is.na(row[[colour_col]])) {
      # colour-only: size stays at the row count (1), colour carries the value
      rec$color <- as.numeric(row[[colour_col]])
    } else if (!is.null(size_col) && !is.na(row[[size_col]])) {
      v <- as.numeric(row[[size_col]]); rec$size <- v; rec$color <- v
    }
    if (!is.null(prio_col) && prio_col %in% names(df) && !is.na(row[[prio_col]]))
      rec$priority <- as.integer(row[[prio_col]])
    rec
  })

  xs <- unique(as.character(df[[x_col]]))
  ys <- unique(as.character(df[[y_col]]))
  zs <- unique(as.character(df[[z_col]]))

  if (identical(config$axis_order, "cluster")) {
    reordered <- .cluster_axis_order(df, x_col, y_col, z_col, rank_col, xs, ys, zs)
    xs <- reordered$xs; ys <- reordered$ys; zs <- reordered$zs
  }

  result <- list(
    config  = .build_config(config),
    records = records,
    xs      = xs,
    ys      = ys,
    zs      = zs
  )

  if (!is.null(config$drilldown)) {
    size_from_color <- !is.null(size_col) || !is.null(config$drilldown$size_colour)
    result$drilldown <- .build_drilldown(df, config$drilldown, x_col, y_col, z_col,
                                         rank_col, size_from_color)
    if (!is.null(config$drilldown$type) && config$drilldown$type == "zoom" &&
        !is.null(config$drilldown$treemap)) {
      result$treemap <- .build_treemap(df, config$drilldown$treemap, x_col, y_col, z_col)
    }
  }

  if (!is.null(config$info)) {
    result$info <- .build_info(df, config$info, x_col, y_col, z_col)
  }

  if (!is.null(config$info_box)) {
    # Zoom: key by inner axes, scoped by the outer cell (6-part key) so sources
    # from different outer cells don't bleed together — matches the playground.
    inner <- .resolve_info_axes(config, x_col, y_col, z_col)
    is_zoom <- identical(config$drilldown$type, "zoom") && !is.null(config$drilldown$axes)
    result$infoBox <- .build_info(df, config$info_box, inner[[1]], inner[[2]], inner[[3]],
                                  outer_cols = if (is_zoom) c(x_col, y_col, z_col) else NULL,
                                  source_col = .source_column(config))
  }

  breakdown_col <- config$tooltip_breakdown
  if (!is.null(breakdown_col)) {
    # Weight by size_col (the cell's size); colour-only mode -> 1 per row.
    result$cellBreakdown <- .build_cell_breakdown(df, x_col, y_col, z_col, breakdown_col, size_col)
    if (!is.null(config$drilldown$type) && config$drilldown$type == "zoom" &&
        !is.null(config$drilldown$axes)) {
      inner_axes <- .resolve_info_axes(config, x_col, y_col, z_col)
      inner_bd <- .build_cell_breakdown(df, inner_axes[[1]], inner_axes[[2]], inner_axes[[3]],
                                        breakdown_col, size_col,
                                        prefix_axes = c(x_col, y_col, z_col))
      result$cellBreakdown <- modifyList(result$cellBreakdown, inner_bd)
    }
  }

  result
}

.build_config <- function(cfg) {
  axes_cfg <- cfg$axes
  config <- list(
    title = if (!is.null(cfg$title)) cfg$title else "My Dataset",
    axes  = list(
      x = list(label = .axis_label(axes_cfg$x)),
      y = list(label = .axis_label(axes_cfg$y)),
      z = list(label = .axis_label(axes_cfg$z))
    )
  )
  for (ax in c("x", "y", "z")) {
    if (!is.null(axes_cfg[[ax]]$colors))
      config$axes[[ax]]$colors <- axes_cfg[[ax]]$colors
    # Multi-column axes group by their first component, so combine_separator
    # doubles as the group separator unless one is set explicitly.
    sep <- axes_cfg[[ax]]$group_separator
    if (is.null(sep) && length(axes_cfg[[ax]]$columns) > 1)
      sep <- if (!is.null(axes_cfg[[ax]]$combine_separator)) axes_cfg[[ax]]$combine_separator else " — "
    if (!is.null(sep)) config$axes[[ax]]$groupSeparator <- sep
  }
  if (!is.null(cfg$colors)) config$colors <- cfg$colors
  if (!is.null(cfg$axis_colors)) config$axisColors <- cfg$axis_colors
  if (!is.null(cfg$background)) config$background <- cfg$background
  if (!is.null(cfg$tilt_group_labels)) config$tiltGroupLabels <- cfg$tilt_group_labels
  if (!is.null(cfg$colour_scheme)) config$colour_scheme <- cfg$colour_scheme

  if (!is.null(cfg$drilldown)) {
    drill <- list(type = cfg$drilldown$type)
    if (!is.null(cfg$drilldown$axes)) {
      drill$axes <- lapply(cfg$drilldown$axes, function(a) {
        list(label = .axis_label(a))
      })
    }
    if (!is.null(cfg$drilldown$axis_colors)) drill$axisColors <- cfg$drilldown$axis_colors
    noun <- if (!is.null(cfg$drilldown$category_noun)) cfg$drilldown$category_noun
            else cfg$drilldown$treemap$category_noun
    if (!is.null(noun)) drill$categoryNoun <- noun
    config$drilldown <- drill
  }

  # Colour value present when size_colour / colour (or legacy size_column / color_column).
  colour_value <- if (!is.null(cfg$size_colour)) cfg$size_colour
                  else if (!is.null(cfg$colour)) cfg$colour
                  else if (!is.null(cfg$size_column)) cfg$size_column
                  else cfg$color_column
  if (!is.null(colour_value)) {
    config$hasColorValues <- TRUE
    if (!is.null(cfg$color_palette))
      config$colorPalette <- if (is.character(cfg$color_palette)) list(name = cfg$color_palette) else cfg$color_palette
    if (!is.null(cfg$color_aggregation)) config$colorAggregation <- cfg$color_aggregation
    if (!is.null(cfg$color_label)) config$colorLabel <- cfg$color_label
    if (!is.null(cfg$color_scale)) config$colorScale <- cfg$color_scale
  } else if (!is.null(cfg$uniform_cell_color)) {
    config$uniformCellColor <- cfg$uniform_cell_color
  }

  if (!is.null(cfg$ghost_datasets)) config$ghost_datasets <- cfg$ghost_datasets
  if (!is.null(cfg$accent_datasets)) config$accent_datasets <- cfg$accent_datasets
  if (!is.null(cfg$accent_color)) config$accent_color <- cfg$accent_color
  if (!is.null(cfg$accent_label)) config$accent_label <- cfg$accent_label
  if (!is.null(cfg$count_label)) config$countLabel <- cfg$count_label
  if (!is.null(cfg$count_label_legend)) config$countLabelLegend <- cfg$count_label_legend
  if (!is.null(cfg$label_rotation)) config$labelRotation <- cfg$label_rotation
  if (!is.null(cfg$concentration_thresholds)) config$concentrationThresholds <- cfg$concentration_thresholds

  if (!is.null(cfg$slice)) {
    if (!is.null(cfg$slice$count_column) &&
        (is.null(colour_value) || cfg$slice$count_column != colour_value))
      warning(sprintf('slice.count_column "%s" is ignored: the 2D slice sums the magnitude column.',
                      cfg$slice$count_column))
    count_field <- if (!is.null(cfg$slice$count_column) && !is.null(colour_value) &&
                       cfg$slice$count_column == colour_value) "color" else "size"
    config$slice <- list(
      fixed_axis  = cfg$slice$fixed_axis,
      count_field = count_field
    )
  }
  config
}

.build_drilldown <- function(df, drill_cfg, x_col, y_col, z_col,
                             outer_color_col = NULL, size_from_color = TRUE) {
  result <- list()

  if (drill_cfg$type == "treemap") {
    cat_col <- drill_cfg$category_column
    sub_col <- drill_cfg$subcategory_column
    label_col <- drill_cfg$category_label_column
    count_col <- drill_cfg$count_column
    if (is.null(cat_col)) return(result)
    groups <- split(df, list(df[[x_col]], df[[y_col]], df[[z_col]]), drop = TRUE)
    for (key_parts in names(groups)) {
      g <- groups[[key_parts]]
      xv <- as.character(g[[x_col]][1]); yv <- as.character(g[[y_col]][1]); zv <- as.character(g[[z_col]][1])
      key <- paste(xv, yv, zv, sep = "|")
      has_label <- !is.null(label_col) && label_col %in% names(g)
      has_count <- !is.null(count_col) && count_col %in% names(g)
      # Tile size = summed count_column (real counts), falling back to row count when
      # no count_column is configured. Mirrors .build_treemap / Python _build_drilldown.
      .n <- function(p) if (has_count) as.integer(sum(p[[count_col]], na.rm = TRUE)) else nrow(p)
      if (!is.null(sub_col) && sub_col %in% names(g)) {
        parts <- split(g, list(as.character(g[[cat_col]]), as.character(g[[sub_col]])), drop = TRUE)
        entries <- lapply(parts, function(p) {
          e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[sub_col]][1]), n = .n(p))
          if (has_label) e$label <- as.character(p[[label_col]][1])
          e
        })
      } else {
        parts <- split(g, as.character(g[[cat_col]]), drop = TRUE)
        entries <- lapply(parts, function(p) {
          e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[cat_col]][1]), n = .n(p))
          if (has_label) e$label <- as.character(p[[label_col]][1])
          e
        })
      }
      names(entries) <- NULL
      result[[key]] <- entries
    }
    return(result)
  }

  if (drill_cfg$type == "zoom") {
    axes_cfg  <- if (!is.null(drill_cfg$axes)) drill_cfg$axes else list()
    # Colour value column: inner size_colour overrides the inherited outer column.
    color_col <- if (!is.null(drill_cfg$size_colour)) drill_cfg$size_colour else outer_color_col
    inner_size_from_color <- !is.null(drill_cfg$size_colour) || isTRUE(size_from_color)
    outer_col <- list(x = x_col, y = y_col, z = z_col)

    # For each axis: use the new column if defined in zoom.axes, else inherit outer column
    inner_col <- list(
      x = if (!is.null(axes_cfg$x$column)) axes_cfg$x$column else x_col,
      y = if (!is.null(axes_cfg$y$column)) axes_cfg$y$column else y_col,
      z = if (!is.null(axes_cfg$z$column)) axes_cfg$z$column else z_col
    )

    # Axes being replaced (have an explicit column in zoom.axes)
    replaced <- Filter(function(ax) !is.null(axes_cfg[[ax]]$column), c("x", "y", "z"))
    if (length(replaced) == 0) return(result)

    group_cols <- sapply(replaced, function(ax) outer_col[[ax]])
    split_list <- lapply(group_cols, function(col) df[[col]])
    names(split_list) <- group_cols
    groups <- split(df, split_list, drop = TRUE)

    for (gname in names(groups)) {
      g <- groups[[gname]]
      key_parts <- sapply(replaced, function(ax) as.character(g[[outer_col[[ax]]]][1]))
      key <- paste(key_parts, collapse = "|")

      # Apply max_labels for each replaced axis
      for (ax in replaced) {
        max_n <- axes_cfg[[ax]]$max_labels
        col   <- inner_col[[ax]]
        if (!is.null(max_n) && col %in% names(g))
          g <- g[g[[col]] %in% .top_labels(g, col, color_col, as.integer(max_n)), ]
      }

      inner_recs <- lapply(seq_len(nrow(g)), function(i) {
        color_val <- if (!is.null(color_col) && color_col %in% names(g) && !is.na(g[[color_col]][i]))
                       as.numeric(g[[color_col]][i]) else NULL
        rec <- list(
          x        = as.character(g[[inner_col$x]][i]),
          y        = as.character(g[[inner_col$y]][i]),
          z        = as.character(g[[inner_col$z]][i]),
          size     = if (!is.null(color_val) && inner_size_from_color) color_val else 1L,
          datasets = list()
        )
        if (!is.null(color_val)) rec$color <- color_val
        rec
      })
      inner_block <- list(
        records = inner_recs,
        xs      = unique(as.character(g[[inner_col$x]])),
        ys      = unique(as.character(g[[inner_col$y]])),
        zs      = unique(as.character(g[[inner_col$z]]))
      )
      # Per-inner-cell treemap so each hovered inner cell gets its own D
      # (source concentration), computed the same way as the outer cube.
      if (!is.null(drill_cfg$treemap) && !is.null(drill_cfg$treemap$category_column)) {
        inner_block$treemap <- .build_inner_treemap(g, inner_col, drill_cfg$treemap)
      }
      result[[key]] <- inner_block
    }
    return(result)
  }

  result
}

# Treemap entries keyed by inner-cell key ("x|y|z" of inner column values).
# Mirrors .build_treemap but at the inner-cube granularity.
.build_inner_treemap <- function(g, inner_col, treemap_cfg) {
  cat_col   <- treemap_cfg$category_column
  sub_col   <- treemap_cfg$subcategory_column
  label_col <- treemap_cfg$category_label_column
  count_col <- treemap_cfg$count_column
  cols <- c(inner_col$x, inner_col$y, inner_col$z)
  if (is.null(cat_col) || !(cat_col %in% names(g)) || !all(cols %in% names(g)))
    return(list())
  out <- list()
  cells <- split(g, list(g[[inner_col$x]], g[[inner_col$y]], g[[inner_col$z]]), drop = TRUE)
  for (cname in names(cells)) {
    cg <- cells[[cname]]
    ckey <- paste(
      as.character(cg[[inner_col$x]][1]),
      as.character(cg[[inner_col$y]][1]),
      as.character(cg[[inner_col$z]][1]),
      sep = "|"
    )
    if (!is.null(sub_col) && sub_col %in% names(cg)) {
      pairs <- split(cg, list(cg[[cat_col]], cg[[sub_col]]), drop = TRUE)
      entries <- lapply(pairs, function(p) {
        n <- if (!is.null(count_col) && count_col %in% names(p)) as.integer(sum(p[[count_col]], na.rm = TRUE)) else nrow(p)
        e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[sub_col]][1]), n = n)
        if (!is.null(label_col) && label_col %in% names(p)) e$label <- as.character(p[[label_col]][1])
        e
      })
    } else {
      subs <- split(cg, cg[[cat_col]], drop = TRUE)
      entries <- lapply(subs, function(p) {
        n <- if (!is.null(count_col) && count_col %in% names(p)) as.integer(sum(p[[count_col]], na.rm = TRUE)) else nrow(p)
        e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[cat_col]][1]), n = n)
        if (!is.null(label_col) && label_col %in% names(p)) e$label <- as.character(p[[label_col]][1])
        e
      })
    }
    if (length(entries) > 0) out[[ckey]] <- unname(entries)
  }
  out
}

.build_treemap <- function(df, treemap_cfg, x_col, y_col, z_col) {
  cat_col   <- treemap_cfg$category_column
  sub_col   <- treemap_cfg$subcategory_column
  label_col <- treemap_cfg$category_label_column
  count_col <- treemap_cfg$count_column
  if (is.null(cat_col)) return(list())
  result <- list()
  groups <- split(df, list(df[[x_col]], df[[y_col]], df[[z_col]]), drop = TRUE)
  for (key_parts in names(groups)) {
    g <- groups[[key_parts]]
    xv <- as.character(g[[x_col]][1]); yv <- as.character(g[[y_col]][1]); zv <- as.character(g[[z_col]][1])
    key <- paste(xv, yv, zv, sep = "|")
    if (!is.null(sub_col) && sub_col %in% names(g)) {
      pairs <- split(g, list(g[[cat_col]], g[[sub_col]]), drop = TRUE)
      entries <- lapply(pairs, function(p) {
        n <- if (!is.null(count_col) && count_col %in% names(p)) as.integer(sum(p[[count_col]], na.rm = TRUE)) else nrow(p)
        e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[sub_col]][1]), n = n)
        if (!is.null(label_col) && label_col %in% names(p)) e$label <- as.character(p[[label_col]][1])
        e
      })
    } else {
      subs <- split(g, g[[cat_col]], drop = TRUE)
      entries <- lapply(subs, function(p) {
        n <- if (!is.null(count_col) && count_col %in% names(p)) as.integer(sum(p[[count_col]], na.rm = TRUE)) else nrow(p)
        e <- list(d = as.character(p[[cat_col]][1]), c = as.character(p[[cat_col]][1]), n = n)
        if (!is.null(label_col) && label_col %in% names(p)) e$label <- as.character(p[[label_col]][1])
        e
      })
    }
    if (length(entries) > 0) result[[key]] <- unname(entries)
  }
  result
}

.build_info <- function(df, info_cfg, x_col, y_col, z_col,
                        outer_cols = NULL, source_col = NULL) {
  columns <- info_cfg$columns
  result <- list()
  key_cols <- c(outer_cols, x_col, y_col, z_col)
  key_vec <- do.call(paste, c(lapply(key_cols, function(k) as.character(df[[k]])), sep = "|"))
  has_na <- Reduce(`|`, lapply(key_cols, function(k) is.na(df[[k]])))
  use_source <- !is.null(source_col) && source_col %in% names(df)
  for (key in unique(key_vec[!has_na])) {
    g <- df[!has_na & key_vec == key, , drop = FALSE]
    seen <- character(0)
    entries <- list()
    for (i in seq_len(nrow(g))) {
      entry <- list()
      for (field in names(columns)) {
        col <- columns[[field]]
        if (col %in% names(g) && !is.na(g[[col]][i]) && nzchar(as.character(g[[col]][i])))
          entry[[field]] <- as.character(g[[col]][i])
      }
      if (length(entry) == 0) next
      # Tag each entry with its source id (the treemap's grouping unit); entries are
      # deduplicated on all fields, so a source keeps one entry per distinct dataset.
      if (use_source && !is.na(g[[source_col]][i]))
        entry[["_source"]] <- as.character(g[[source_col]][i])
      fp <- paste(names(entry), unlist(entry), sep = "=", collapse = "\x1f")
      if (fp %in% seen) next
      seen <- c(seen, fp)
      entries[[length(entries) + 1]] <- entry
    }
    if (length(entries) > 0) result[[key]] <- entries
  }
  result
}

# Column identifying a record's source (the treemap's grouping unit), if any.
.source_column <- function(cfg) {
  d <- cfg$drilldown
  if (!is.null(d$treemap$category_column)) return(d$treemap$category_column)
  if (identical(d$type, "treemap") && !is.null(d$category_column)) return(d$category_column)
  cfg$datasets_column
}

# For a zoom drilldown, the inner-cell axes are the replaced columns (else outer).
.resolve_info_axes <- function(cfg, x_col, y_col, z_col) {
  if (is.null(cfg$drilldown) || !identical(cfg$drilldown$type, "zoom") ||
      is.null(cfg$drilldown$axes))
    return(list(x_col, y_col, z_col))
  ax <- cfg$drilldown$axes
  list(
    if (!is.null(ax$x$column)) ax$x$column else x_col,
    if (!is.null(ax$y$column)) ax$y$column else y_col,
    if (!is.null(ax$z$column)) ax$z$column else z_col
  )
}

# Per-cell aggregation of `col` for the hover tooltip breakdown. Keyed by x|y|z
# (outer) or ox|oy|oz|ix|iy|iz when prefix_axes is given (zoom inner cells).
# Empty/"unknown" values skipped; weights from size_col (else 1 per row).
.build_cell_breakdown <- function(df, x_col, y_col, z_col, col, size_col = NULL, prefix_axes = NULL) {
  if (!(col %in% names(df))) return(list())
  n_rows <- nrow(df)
  xv <- as.character(df[[x_col]]); yv <- as.character(df[[y_col]]); zv <- as.character(df[[z_col]])
  vals <- as.character(df[[col]])
  weights <- if (!is.null(size_col) && size_col %in% names(df))
               suppressWarnings(as.numeric(df[[size_col]])) else rep(1, n_rows)
  has_prefix <- !is.null(prefix_axes)
  if (has_prefix) {
    pxv <- as.character(df[[prefix_axes[1]]]); pyv <- as.character(df[[prefix_axes[2]]]); pzv <- as.character(df[[prefix_axes[3]]])
  }
  result <- list()
  for (i in seq_len(n_rows)) {
    v <- vals[i]
    if (is.na(v)) next
    v <- trimws(v)
    if (v == "" || tolower(v) == "unknown") next
    n <- weights[i]
    if (is.na(n) || n <= 0) next
    inner <- paste(xv[i], yv[i], zv[i], sep = "|")
    key <- if (has_prefix) paste(pxv[i], pyv[i], pzv[i], inner, sep = "|") else inner
    if (is.null(result[[key]])) result[[key]] <- list()
    prev <- result[[key]][[v]]
    result[[key]][[v]] <- (if (is.null(prev)) 0 else prev) + n
  }
  result
}

# Axis display label: explicit label, else combined `columns`, else `column`.
.axis_label <- function(a) {
  if (!is.null(a$label)) return(a$label)
  if (!is.null(a$columns)) return(paste(unlist(a$columns), collapse = " / "))
  a$column
}

# Build one combined string per row from axis_cfg$columns: each component
# optionally remapped via column_value_labels (value -> "" drops it), survivors
# joined by combine_separator (default " — "). Missing columns treated as "".
.combined_series <- function(df, axis_cfg) {
  cols <- unlist(axis_cfg$columns)
  sep <- if (!is.null(axis_cfg$combine_separator)) axis_cfg$combine_separator else " — "
  col_labels <- axis_cfg$column_value_labels
  parts <- lapply(cols, function(c) {
    raw <- if (c %in% names(df)) as.character(df[[c]]) else rep("", nrow(df))
    raw[is.na(raw)] <- ""
    m <- col_labels[[c]]
    if (!is.null(m)) raw <- vapply(raw, function(v) {
      mapped <- m[[v]]; if (is.null(mapped)) v else mapped
    }, character(1), USE.NAMES = FALSE)
    raw
  })
  vapply(seq_len(nrow(df)), function(i) {
    vals <- vapply(parts, `[`, character(1), i)
    paste(vals[vals != ""], collapse = sep)
  }, character(1))
}

# Materialise `columns` (multi-column) axes into synthetic data.frame columns,
# in memory; the source CSV is never modified. Returns the updated df + config.
.resolve_axis_columns <- function(df, config) {
  resolve <- function(df, config, path, key) {
    a <- config[[path[1]]]
    for (p in path[-1]) a <- a[[p]]
    if (!is.null(a$columns) && length(a$columns) > 0 && is.null(a$column)) {
      df[[key]] <- .combined_series(df, a)
      # write the resolved column back into the nested config slot
      if (length(path) == 2) config[[path[1]]][[path[2]]]$column <- key
      else config[[path[1]]][[path[2]]][[path[3]]]$column <- key
    }
    list(df = df, config = config)
  }
  for (ax in c("x", "y", "z")) {
    r <- resolve(df, config, c("axes", ax), paste0("__combined_", ax))
    df <- r$df; config <- r$config
  }
  if (!is.null(config$drilldown$axes)) {
    for (ax in c("x", "y", "z")) {
      r <- resolve(df, config, c("drilldown", "axes", ax), paste0("__combined_drill_", ax))
      df <- r$df; config <- r$config
    }
  }
  list(df = df, config = config)
}

# Left-join a secondary metadata CSV onto df by join_key. Columns absent from df
# are added; for existing columns only blank/NA cells are filled (never overwritten).
# Missing file or join key is a warning, not an error (join skipped).
.join_metadata <- function(df, metadata_csv, base_dir, join_key) {
  is_abs <- grepl("^(/|~|[A-Za-z]:[\\\\/])", metadata_csv)
  meta_path <- if (is_abs) metadata_csv else file.path(base_dir, metadata_csv)
  if (!file.exists(meta_path)) {
    warning(sprintf("metadata_csv not found: %s -- skipping join", meta_path)); return(df)
  }
  if (!(join_key %in% names(df))) {
    warning(sprintf("metadata_join_key '%s' not in data -- skipping join", join_key)); return(df)
  }
  meta <- utils::read.csv(meta_path, stringsAsFactors = FALSE, check.names = FALSE,
                          colClasses = "character")
  if (!(join_key %in% names(meta))) {
    warning(sprintf("metadata_join_key '%s' not in %s -- skipping join",
                    join_key, basename(meta_path))); return(df)
  }
  meta <- meta[!duplicated(meta[[join_key]]), , drop = FALSE]
  rownames(meta) <- meta[[join_key]]
  keys <- as.character(df[[join_key]])
  for (col in setdiff(names(meta), join_key)) {
    mapped <- meta[keys, col]   # aligned to df rows; NA where key not matched
    if (col %in% names(df)) {
      existing <- as.character(df[[col]])
      blank <- is.na(existing) | trimws(existing) == ""
      existing[blank] <- mapped[blank]
      df[[col]] <- existing
    } else {
      df[[col]] <- mapped
    }
  }
  df
}

.top_labels <- function(df, col, rank_col, n) {
  if (!is.null(rank_col)) {
    totals <- tapply(df[[rank_col]], df[[col]], sum, na.rm = TRUE)
  } else {
    totals <- table(df[[col]])
  }
  names(sort(totals, decreasing = TRUE)[seq_len(min(n, length(totals)))])
}

.apply_max_labels <- function(df, axes_cfg, x_col, y_col, z_col, color_col) {
  if (!is.null(axes_cfg$x$max_labels))
    df <- df[df[[x_col]] %in% .top_labels(df, x_col, color_col, as.integer(axes_cfg$x$max_labels)), ]
  if (!is.null(axes_cfg$y$max_labels))
    df <- df[df[[y_col]] %in% .top_labels(df, y_col, color_col, as.integer(axes_cfg$y$max_labels)), ]
  if (!is.null(axes_cfg$z$max_labels))
    df <- df[df[[z_col]] %in% .top_labels(df, z_col, color_col, as.integer(axes_cfg$z$max_labels)), ]
  df
}

# Reorder each axis by average-linkage cosine clustering on co-occurrence profiles.
# For each axis, mode-k unfolding of the count tensor is used: each label becomes a
# row vector of its co-occurrence counts across all combinations of the other two axes.
# Rows are L2-normalised; pairwise cosine distances feed stats::hclust(method="average").
# Axes with <=2 labels are left unchanged. Uses only base R (stats package).
.cluster_axis_order <- function(df, x_col, y_col, z_col, size_col, xs, ys, zs) {
  nx <- length(xs); ny <- length(ys); nz <- length(zs)

  xi <- stats::setNames(seq_len(nx), xs)
  yi <- stats::setNames(seq_len(ny), ys)
  zi <- stats::setNames(seq_len(nz), zs)

  tensor <- array(0.0, dim = c(nx, ny, nz))
  xv <- as.character(df[[x_col]])
  yv <- as.character(df[[y_col]])
  zv <- as.character(df[[z_col]])
  sv <- if (!is.null(size_col) && size_col %in% names(df)) {
    s <- as.numeric(df[[size_col]]); s[is.na(s)] <- 0; s
  } else rep(1.0, nrow(df))

  for (k in seq_len(nrow(df))) {
    ix <- xi[xv[k]]; iy <- yi[yv[k]]; iz <- zi[zv[k]]
    if (!is.na(ix) && !is.na(iy) && !is.na(iz))
      tensor[ix, iy, iz] <- tensor[ix, iy, iz] + sv[k]
  }

  reorder_axis <- function(labels, M) {
    n <- length(labels)
    if (n <= 2L) return(labels)
    norms <- sqrt(rowSums(M^2))
    norms[norms == 0] <- 1
    M_norm <- M / norms
    cos_dist <- 1 - tcrossprod(M_norm)
    diag(cos_dist) <- 0
    cos_dist[cos_dist < 0] <- 0  # numerical guard
    hc <- stats::hclust(stats::as.dist(cos_dist), method = "average")
    labels[hc$order]
  }

  list(
    xs = reorder_axis(xs, matrix(tensor,                           nrow = nx)),
    ys = reorder_axis(ys, matrix(aperm(tensor, c(2L, 1L, 3L)),    nrow = ny)),
    zs = reorder_axis(zs, matrix(aperm(tensor, c(3L, 1L, 2L)),    nrow = nz))
  )
}
