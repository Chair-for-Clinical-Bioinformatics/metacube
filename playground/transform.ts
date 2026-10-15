/**
 * TypeScript port of python-pkg/src/metacube/transform.py.
 * Converts a CSV string + YAML config string into a CubeData object.
 */

import Papa from "papaparse";
import * as yaml from "js-yaml";
import type { CubeData, CubeRecord, TreemapEntry, InnerCubeData, ChartSpec } from "../src/data/dataModel";
import type { CubeConfig, ColorPaletteConfig } from "../src/data/config";
import { resolveAutoAxes } from "./autoaxes";

// ── Internal types for parsed YAML (not exported) ────────────────────────────

interface RawAxisCfg {
  /**
   * Single source column. Omit when using `columns` — resolveAxisColumns will
   * synthesise a combined column and set this field before downstream code runs.
   */
  column: string;
  /** Combine multiple CSV columns into one axis value (e.g. ["assay_title","target"]). */
  columns?: string[];
  /** Separator used when joining `columns` values. Also auto-sets `group_separator`. Default: " — " */
  combine_separator?: string;
  /**
   * Per-column value remapping applied before joining `columns`.
   * Values that remap to "" are dropped from the join entirely.
   * Example: { target: { none: "" } } drops "none" targets
   * so "TF ChIP-seq — none" becomes just "TF ChIP-seq".
   */
  column_value_labels?: Record<string, Record<string, string>>;
  label?: string;
  description?: string;
  max_labels?: number;
  group_separator?: string;
  /** Explicit label order. Listed values appear first in order; any unlisted values follow at end. */
  value_order?: string[];
  colors?: Record<string, string>;
  value_labels?: Record<string, string>;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

interface RawDrilldownAxisCfg {
  column?: string;
  columns?: string[];
  combine_separator?: string;
  column_value_labels?: Record<string, Record<string, string>>;
  label?: string;
  description?: string;
  max_labels?: number;
  value_labels?: Record<string, string>;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  value_order?: string[];
}

interface RawTreemapCfg {
  category_column?: string;
  category_label_column?: string;
  category_noun?: string;
  subcategory_column?: string;
  count_column?: string;
}

interface RawDrilldownCfg {
  type: "treemap" | "zoom";
  category_column?: string;
  category_label_column?: string;
  category_noun?: string;
  subcategory_column?: string;
  count_column?: string;
  size_colour?: string;
  axes?: { x?: RawDrilldownAxisCfg; y?: RawDrilldownAxisCfg; z?: RawDrilldownAxisCfg };
  treemap?: RawTreemapCfg;
  /** Per-axis color overrides applied to the inner zoom cube's axis labels and titles. */
  axis_colors?: Partial<Record<"x" | "y" | "z", string>>;
}

interface RawConfig {
  title?: string;
  axes: { x: RawAxisCfg; y: RawAxisCfg; z: RawAxisCfg };
  /** Outer-axis ordering: "frequency" (insertion order, default) or "cluster"
   *  (average-linkage cosine clustering on co-occurrence profiles). Mirrors the
   *  Python package's axis_order; see clusterAxisOrder(). */
  axis_order?: "frequency" | "cluster";
  size_colour?: string;
  /** Sets only the color field; size becomes count (1 per row). Use with color_aggregation: mean. */
  colour?: string;
  color_aggregation?: "sum" | "mean";
  color_label?: string;
  count_label?: string;
  /** Legend title for the colour scale, e.g. "Number of cells". Defaults to "Number of <count_label>". */
  count_label_legend?: string;
  /** Value compression before the colour ramp: "linear" (default), "sqrt" or "log". */
  color_scale?: "linear" | "sqrt" | "log";
  /** In-plane orientation of the 3D axis value labels: "auto" (perpendicular to the on-screen axis, default) or "horizontal". */
  label_rotation?: "auto" | "horizontal";
  /** Either a palette name string ("RdYlGn") or a full palette object. */
  color_palette?: string | ColorPaletteConfig;
  colors?: Record<string, string>;
  /** Per-axis color overrides for the outer cube's axis titles and label highlights. */
  axis_colors?: Partial<Record<"x" | "y" | "z", string>>;
  /** Fixed color for every cube cell (only applies when no size_colour/colour gradient is set). Defaults to "#60a5fa". */
  uniform_cell_color?: string;
  /** Scene background — any CSS background value (solid hex or gradient). Defaults to white. */
  background?: string;
  /** Rotate grouped-axis headers to run parallel to their axis (vertical Y group headers). Default false. */
  tilt_group_labels?: boolean;
  /** Named colour scheme: "default" or "asap". Light/dark is chosen at runtime. Defaults to "default". */
  colour_scheme?: "default" | "asap";
  /** Concentration label thresholds on the effective number of sources (inverse Simpson): [skewedBelow, diverseAtOrAbove]. Default [2, 5]. */
  concentration_thresholds?: [number, number];
  datasets_column?: string;
  drilldown?: RawDrilldownCfg;
  slice?: { fixed_axis: "x" | "y" | "z"; count_column?: string };
  info?: { columns?: Record<string, string> };
  info_box?: { columns?: Record<string, string> };
  charts_json?: string;
  ghost_datasets?: string;
  accent_datasets?: string;
  /** Column name to aggregate per-cell for tooltip breakdown (e.g. "cell_type"). */
  tooltip_breakdown?: string;
  accent_color?: string;
  accent_label?: string;
  /**
   * Path (relative to the main CSV) to a secondary CSV used as a lookup table.
   * Rows are left-joined onto the main data using `metadata_join_key` (default: dataset_key).
   * Columns in the metadata CSV are added to every matching row, enabling info_box
   * fields like `title`, `year`, `doi` without duplicating them in the main CSV.
   */
  metadata_csv?: string;
  metadata_join_key?: string;
}

type Row = Record<string, string>;

// ── Main entry point ──────────────────────────────────────────────────────────

export async function transformCsvYaml(
  csvText: string,
  yamlText: string,
  chartsData?: Record<string, ChartSpec>,
  metadataCsvText?: string,
): Promise<CubeData> {
  // Yield to the event loop so the loading message renders before CPU work starts
  await new Promise(r => setTimeout(r, 16));

  const cfg = yaml.load(yamlText) as RawConfig;
  const rows = parseCsv(csvText);

  // Left-join metadata CSV if provided (adds title/year/doi etc. without repeating in main CSV)
  if (metadataCsvText) {
    const joinKey = cfg.metadata_join_key ?? "dataset_key";
    const meta = new Map(parseCsv(metadataCsvText).map(r => [r[joinKey], r]));
    for (const r of rows) {
      const m = meta.get(r[joinKey]);
      if (m) for (const [k, v] of Object.entries(m)) if (!(k in r) || !r[k]) r[k] = v;
    }
  }

  // axes.mode: auto → fill x/y/z (and zoom inner axes) by data-driven scoring.
  // Must run before resolveAxisColumns / validateColumns. No-op for manual configs.
  resolveAutoAxes(rows, cfg as unknown as Record<string, unknown>);

  resolveAxisColumns(rows, cfg);
  validateColumns(rows, cfg);

  const filtered = applyMaxLabels(rows, cfg);
  const records = buildRecords(filtered, cfg);
  let xs = orderedUnique(filtered.map(r => applyValueLabel(r[cfg.axes.x.column], cfg.axes.x)).filter(Boolean));
  let ys = orderedUnique(filtered.map(r => applyValueLabel(r[cfg.axes.y.column], cfg.axes.y)).filter(Boolean));
  let zs = orderedUnique(filtered.map(r => applyValueLabel(r[cfg.axes.z.column], cfg.axes.z)).filter(Boolean));
  if (cfg.axes.x.sort_by) xs = sortLabels(xs, filtered, cfg.axes.x.column, r => applyValueLabel(r, cfg.axes.x), cfg.axes.x.sort_by, cfg.axes.x.sort_order ?? "desc");
  if (cfg.axes.y.sort_by) ys = sortLabels(ys, filtered, cfg.axes.y.column, r => applyValueLabel(r, cfg.axes.y), cfg.axes.y.sort_by, cfg.axes.y.sort_order ?? "desc");
  if (cfg.axes.z.sort_by) zs = sortLabels(zs, filtered, cfg.axes.z.column, r => applyValueLabel(r, cfg.axes.z), cfg.axes.z.sort_by, cfg.axes.z.sort_order ?? "desc");
  if (cfg.axes.x.value_order) xs = applyValueOrder(xs, cfg.axes.x.value_order);
  if (cfg.axes.y.value_order) ys = applyValueOrder(ys, cfg.axes.y.value_order);
  if (cfg.axes.z.value_order) zs = applyValueOrder(zs, cfg.axes.z.value_order);
  if (cfg.axis_order === "cluster") [xs, ys, zs] = clusterAxisOrder(filtered, cfg, xs, ys, zs);

  const result: CubeData = { config: buildConfig(cfg), records, xs, ys, zs };

  if (cfg.drilldown) {
    result.drilldown = buildDrilldown(filtered, cfg);
    if (cfg.drilldown.type === "zoom" && cfg.drilldown.treemap) {
      result.treemap = buildTreemap(
        filtered, cfg.drilldown.treemap,
        cfg.axes.x.column, cfg.axes.y.column, cfg.axes.z.column,
      );
    }
  }

  if (cfg.info) result.info = buildInfo(filtered, cfg.axes, cfg.info.columns ?? {});
  if (cfg.info_box) {
    const infoAxes = resolveInfoAxes(cfg);
    // For zoom drilldown, scope by outer+inner axes so datasets from different
    // outer cells don't bleed into each other's info panels.
    const outerAxesForInfo = cfg.drilldown?.type === "zoom" && cfg.drilldown.axes ? cfg.axes : undefined;
    result.infoBox = buildInfo(filtered, infoAxes, cfg.info_box.columns ?? {}, outerAxesForInfo, sourceColumn(cfg));
  }

  if (chartsData) {
    result.charts = chartsData;
  }

  if (cfg.tooltip_breakdown) {
    result.cellBreakdown = buildCellBreakdown(filtered, cfg.axes, cfg.tooltip_breakdown, cfg.size_colour);
    // Also build inner-cell breakdowns (6-part key) for zoom drilldown
    if (cfg.drilldown?.type === "zoom" && cfg.drilldown.axes) {
      const innerAxes = resolveInfoAxes(cfg);
      const inner = buildCellBreakdown(filtered, innerAxes, cfg.tooltip_breakdown, cfg.size_colour, cfg.axes);
      Object.assign(result.cellBreakdown, inner);
    }
  }

  return result;
}

// ── Per-cell column breakdown (for tooltip) ───────────────────────────────────

function buildCellBreakdown(
  rows: Row[],
  axes: RawConfig["axes"],
  col: string,
  sizeCol: string | undefined,
  prefixAxes?: RawConfig["axes"],   // when set, key = outerKey|innerKey
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const val = r[col]?.trim();
    if (!val || val === "unknown" || val === "") continue;
    const innerKey = `${r[axes.x.column]}|${r[axes.y.column]}|${r[axes.z.column]}`;
    const key = prefixAxes
      ? `${r[prefixAxes.x.column]}|${r[prefixAxes.y.column]}|${r[prefixAxes.z.column]}|${innerKey}`
      : innerKey;
    if (!result[key]) result[key] = {};
    const n = sizeCol ? (parseFloat(r[sizeCol]) || 0) : 1;
    if (n > 0) result[key][val] = (result[key][val] ?? 0) + n;
  }
  return result;
}

// ── Column combining ─────────────────────────────────────────────────────────

/**
 * When an axis uses `columns: [a, b]` instead of a single `column`, synthesise a
 * combined column in every row and set `axisCfg.column` to the synthetic key.
 * Must run before validateColumns and all downstream code.
 */
function resolveAxisColumns(rows: Row[], cfg: RawConfig): void {
  // RawAxisCfg types `column` as required, but when `columns` is used in YAML
  // the field is absent at runtime. The cast below lets us detect and fill that.
  type MaybeUnresolved = {
    column?: string; columns?: string[];
    combine_separator?: string;
    column_value_labels?: Record<string, Record<string, string>>;
  };

  // Build a join function for a given axis config.
  // column_value_labels remaps individual column values before joining;
  // values that remap to "" are dropped (e.g. strip "unknown" subtypes).
  const makeJoin = (axisCfg: MaybeUnresolved) => {
    const sep = axisCfg.combine_separator ?? " — ";
    const colLabels = axisCfg.column_value_labels ?? {};
    return (r: Row) =>
      (axisCfg.columns ?? [])
        .map(c => { const raw = r[c] ?? ""; const m = colLabels[c]; return m ? (m[raw] ?? raw) : raw; })
        .filter(v => v !== "")
        .join(sep);
  };

  for (const ax of ["x", "y", "z"] as const) {
    const axisCfg = cfg.axes[ax] as unknown as MaybeUnresolved;
    if (axisCfg.columns?.length && !axisCfg.column) {
      const join = makeJoin(axisCfg);
      const key = `__combined_${ax}`;
      for (const r of rows) r[key] = join(r);
      axisCfg.column = key;
    }
  }
  if (cfg.drilldown?.axes) {
    for (const ax of ["x", "y", "z"] as const) {
      const axisCfg = cfg.drilldown.axes[ax] as unknown as MaybeUnresolved | undefined;
      if (axisCfg?.columns?.length && !axisCfg.column) {
        const join = makeJoin(axisCfg);
        const key = `__combined_drill_${ax}`;
        for (const r of rows) r[key] = join(r);
        axisCfg.column = key;
      }
    }
  }
}

// ── Column validation ─────────────────────────────────────────────────────────

function validateColumns(rows: Row[], cfg: RawConfig): void {
  const available = rows.length > 0 ? Object.keys(rows[0]) : [];
  for (const ax of ["x", "y", "z"] as const) {
    const col = cfg.axes[ax]?.column;
    if (!col) throw new Error(`axes.${ax}.column is not set in your config YAML. Use "column" or "columns".`);
    if (!available.includes(col) && !col.startsWith("__combined_"))
      throw new Error(`Column "${col}" (axes.${ax}.column) not found in CSV. Available: ${available.join(", ")}`);
  }
  if (cfg.size_colour && !available.includes(cfg.size_colour))
    throw new Error(`Column "${cfg.size_colour}" (size_colour) not found in CSV. Available: ${available.join(", ")}`);
  if (cfg.colour && !available.includes(cfg.colour))
    throw new Error(`Column "${cfg.colour}" (colour) not found in CSV. Available: ${available.join(", ")}`);
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCsv(text: string): Row[] {
  // Strip UTF-8 BOM (common in Excel-generated CSVs) so the first column name is clean
  const cleaned = text.startsWith('﻿') ? text.slice(1) : text;
  return Papa.parse<Row>(cleaned, { header: true, skipEmptyLines: true, dynamicTyping: false }).data;
}

// ── Grouping utility ──────────────────────────────────────────────────────────

function groupBy(rows: Row[], keyFn: (r: Row) => string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const bucket = map.get(k);
    if (bucket) bucket.push(r);
    else map.set(k, [r]);
  }
  return map;
}

// ── Top-N label ranking ───────────────────────────────────────────────────────

function topLabels(rows: Row[], col: string, rankCol: string | undefined, n: number): Set<string> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const val = r[col];
    if (!val) continue;
    const prev = totals.get(val) ?? 0;
    if (rankCol) {
      const v = parseFloat(r[rankCol]);
      totals.set(val, prev + (isNaN(v) ? 0 : v));
    } else {
      totals.set(val, prev + 1);
    }
  }
  return new Set(
    [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k),
  );
}

// ── Max-labels filter ─────────────────────────────────────────────────────────

function applyMaxLabels(rows: Row[], cfg: RawConfig): Row[] {
  const { x, y, z } = cfg.axes;
  const rankCol = cfg.size_colour;
  let out = rows;
  if (x.max_labels) { const top = topLabels(out, x.column, rankCol, x.max_labels); out = out.filter(r => top.has(r[x.column])); }
  if (y.max_labels) { const top = topLabels(out, y.column, rankCol, y.max_labels); out = out.filter(r => top.has(r[y.column])); }
  if (z.max_labels) { const top = topLabels(out, z.column, rankCol, z.max_labels); out = out.filter(r => top.has(r[z.column])); }
  return out;
}

// ── Insertion-order dedup ─────────────────────────────────────────────────────

function orderedUnique(vals: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals) { if (!seen.has(v)) { seen.add(v); out.push(v); } }
  return out;
}

// ── Record building ───────────────────────────────────────────────────────────

function applyValueLabel(raw: string, ax: RawAxisCfg | RawDrilldownAxisCfg): string {
  return ax.value_labels?.[raw] ?? raw;
}

function sortLabels(
  labels: string[],
  rows: Row[],
  axisCol: string,
  labelFn: (raw: string) => string,
  sortByCol: string,
  order: "asc" | "desc",
): string[] {
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const lbl = labelFn(r[axisCol]);
    const v = parseFloat(r[sortByCol]);
    if (!isNaN(v)) {
      const e = agg.get(lbl) ?? { sum: 0, n: 0 };
      e.sum += v; e.n += 1;
      agg.set(lbl, e);
    }
  }
  return [...labels].sort((a, b) => {
    const aV = agg.has(a) ? agg.get(a)!.sum / agg.get(a)!.n : 0;
    const bV = agg.has(b) ? agg.get(b)!.sum / agg.get(b)!.n : 0;
    return order === "asc" ? aV - bV : bV - aV;
  });
}

function applyValueOrder(labels: string[], order: string[]): string[] {
  const rank = new Map(order.map((v, i) => [v, i]));
  return [...labels].sort((a, b) => {
    const ra = rank.get(a) ?? Infinity;
    const rb = rank.get(b) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b); // alphabetical tiebreak for unlisted values
  });
}

// ── Average-linkage cosine clustering of axis labels ──────────────────────────
// Faithful port of the Python package's transform.py::_cluster_axis_order so the
// playground reproduces `axis_order: "cluster"` layouts. For each outer axis, every
// label becomes a vector of its (count-weighted) co-occurrences across all combinations
// of the other two axes (mode-k unfolding of the count tensor). Rows are L2-normalised,
// pairwise cosine distances feed average-linkage (UPGMA) clustering, and the dendrogram
// leaf order becomes the new axis order. Axes with <=2 labels are left unchanged.
//
// The leaf order matches scipy's leaves_list convention: average linkage is monotonic
// (no inversions), so greedily merging the closest pair yields merges already in
// distance order; each merge stores its two child cluster ids smaller-first, and a
// pre-order traversal (child[0] before child[1]) emits the leaves. Exact ties (rare with
// real counts) may break differently from scipy, so layouts can differ marginally.
function clusterAxisOrder(
  rows: Row[],
  cfg: RawConfig,
  xs: string[], ys: string[], zs: string[],
): [string[], string[], string[]] {
  const { x, y, z } = cfg.axes;
  const rankCol = cfg.size_colour ?? cfg.colour;
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const zi = new Map(zs.map((v, i) => [v, i]));

  // tensor[ix][iy][iz] = summed weight (count column, or 1 per row if none)
  const tensor = xs.map(() => ys.map(() => new Array<number>(zs.length).fill(0)));
  for (const r of rows) {
    const ix = xi.get(applyValueLabel(r[x.column], x));
    const iy = yi.get(applyValueLabel(r[y.column], y));
    const iz = zi.get(applyValueLabel(r[z.column], z));
    if (ix === undefined || iy === undefined || iz === undefined) continue;
    const w = rankCol ? (parseFloat(r[rankCol]) || 0) : 1;
    tensor[ix][iy][iz] += w;
  }

  // Mode-k unfoldings: one flattened co-occurrence row per label. Column order is
  // arbitrary as long as it is consistent across rows (cosine is permutation-invariant).
  const xMat = xs.map((_, ix) => tensor[ix].flat());
  const yMat = ys.map((_, iy) => xs.flatMap((_, ix) => tensor[ix][iy]));
  const zMat = zs.map((_, iz) => xs.flatMap((_, ix) => ys.map((_, iy) => tensor[ix][iy][iz])));

  return [reorderByCluster(xs, xMat), reorderByCluster(ys, yMat), reorderByCluster(zs, zMat)];
}

function reorderByCluster(labels: string[], mat: number[][]): string[] {
  const n = labels.length;
  if (n <= 2) return labels;

  // L2-normalise rows (zero rows stay zero → cosine distance 1 to everything).
  const norm = mat.map(row => {
    const len = Math.sqrt(row.reduce((s, v) => s + v * v, 0)) || 1;
    return row.map(v => v / len);
  });
  const cosDist = (a: number[], b: number[]): number => {
    let dot = 0;
    for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
    return 1 - dot;
  };

  // Active clusters keyed by id (leaf id < n, merged id = n + step). Greedy UPGMA:
  // repeatedly merge the globally-closest pair, updating distances via the
  // Lance-Williams average rule. Children are recorded smaller-id-first.
  const active: { id: number; size: number }[] = labels.map((_, i) => ({ id: i, size: 1 }));
  const dist = new Map<number, Map<number, number>>();
  const setDist = (a: number, b: number, v: number) => {
    (dist.get(a) ?? dist.set(a, new Map()).get(a)!).set(b, v);
    (dist.get(b) ?? dist.set(b, new Map()).get(b)!).set(a, v);
  };
  const getDist = (a: number, b: number) => dist.get(a)!.get(b)!;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) setDist(i, j, cosDist(norm[i], norm[j]));

  const children = new Map<number, [number, number]>();
  let nextId = n;
  while (active.length > 1) {
    let bi = 0, bj = 1, best = Infinity;
    for (let a = 0; a < active.length; a++)
      for (let b = a + 1; b < active.length; b++) {
        const d = getDist(active[a].id, active[b].id);
        if (d < best) { best = d; bi = a; bj = b; }
      }
    const ca = active[bi], cb = active[bj];
    const newId = nextId++;
    const newSize = ca.size + cb.size;
    children.set(newId, [Math.min(ca.id, cb.id), Math.max(ca.id, cb.id)]);
    for (const c of active) {
      if (c === ca || c === cb) continue;
      setDist(newId, c.id, (ca.size * getDist(ca.id, c.id) + cb.size * getDist(cb.id, c.id)) / newSize);
    }
    active.splice(bj, 1); active.splice(bi, 1);
    active.push({ id: newId, size: newSize });
  }

  // leaves_list: pre-order traversal from the root, smaller child first.
  const order: string[] = [];
  const visit = (id: number) => {
    if (id < n) { order.push(labels[id]); return; }
    const [a, b] = children.get(id)!;
    visit(a); visit(b);
  };
  visit(nextId - 1);
  return order;
}

function buildRecords(rows: Row[], cfg: RawConfig): CubeRecord[] {
  const { x, y, z } = cfg.axes;
  const { size_colour, colour, datasets_column } = cfg;
  const records: CubeRecord[] = [];

  for (const r of rows) {
    const rec: CubeRecord = {
      x: applyValueLabel(r[x.column], x),
      y: applyValueLabel(r[y.column], y),
      z: applyValueLabel(r[z.column], z),
      size: 1,
      datasets: datasets_column && r[datasets_column] ? [r[datasets_column]] : [],
    };

    if (colour) {
      // colour-only mode: size stays as count (1), color gets the numeric value
      const c = parseFloat(r[colour]);
      if (!isNaN(c)) rec.color = c;
    } else if (size_colour) {
      // size_colour mode: both size and color come from the same field (old behaviour)
      const c = parseFloat(r[size_colour]);
      if (!isNaN(c)) { rec.size = c; rec.color = c; }
    }

    records.push(rec);
  }
  return records;
}

// ── Config building ───────────────────────────────────────────────────────────

function buildConfig(cfg: RawConfig): CubeConfig {
  const { x, y, z } = cfg.axes;

  const axisLabel = (a: RawAxisCfg, fallback: string) =>
    a.label ?? (a.columns?.join(" / ")) ?? a.column ?? fallback;

  const config: CubeConfig = {
    title: cfg.title ?? "My Dataset",
    axes: {
      x: { label: axisLabel(x, "x") },
      y: { label: axisLabel(y, "y") },
      z: { label: axisLabel(z, "z") },
    },
  };

  for (const ax of ["x", "y", "z"] as const) {
    const axisCfg = cfg.axes[ax];
    if (axisCfg.colors) config.axes[ax].colors = axisCfg.colors;
    const sep = axisCfg.group_separator
      ?? ((axisCfg.columns?.length ?? 0) > 1 ? (axisCfg.combine_separator ?? " — ") : undefined);
    if (sep) config.axes[ax].groupSeparator = sep;
    if (axisCfg.description) config.axes[ax].description = axisCfg.description;
  }

  if (cfg.colors) config.colors = cfg.colors;
  if (cfg.axis_colors) config.axisColors = cfg.axis_colors;
  if (cfg.background) config.background = cfg.background;
  if (cfg.tilt_group_labels) config.tiltGroupLabels = true;
  if (cfg.colour_scheme) config.colour_scheme = cfg.colour_scheme;
  if (cfg.concentration_thresholds) config.concentrationThresholds = cfg.concentration_thresholds;

  if (cfg.drilldown) {
    const drill = cfg.drilldown;
    const drillOut: CubeConfig["drilldown"] = { type: drill.type };
    if (drill.axes) {
      drillOut.axes = {};
      for (const ax of ["x", "y", "z"] as const) {
        const axCfg = drill.axes[ax];
        if (axCfg) {
          drillOut.axes[ax] = { label: axCfg.label ?? axCfg.column ?? ax };
          if (axCfg.description) drillOut.axes[ax]!.description = axCfg.description;
        }
      }
    }
    if (drill.axis_colors) drillOut.axisColors = drill.axis_colors;
    const noun = drill.category_noun ?? drill.treemap?.category_noun;
    if (noun) drillOut.categoryNoun = noun;
    config.drilldown = drillOut;
  }

  if (cfg.size_colour || cfg.colour) {
    config.hasColorValues = true;
    if (cfg.color_palette) {
      config.colorPalette = typeof cfg.color_palette === "string"
        ? { name: cfg.color_palette }
        : cfg.color_palette;
    }
    if (cfg.color_aggregation) config.colorAggregation = cfg.color_aggregation;
    if (cfg.color_label) config.colorLabel = cfg.color_label;
    if (cfg.color_scale) config.colorScale = cfg.color_scale;
  } else if (cfg.uniform_cell_color) {
    // Only pin an explicit cell colour; otherwise leave undefined so the cube
    // falls back to the active theme's cell_default (reactive to light/dark).
    config.uniformCellColor = cfg.uniform_cell_color;
  }
  if (cfg.count_label) config.countLabel = cfg.count_label;
  if (cfg.count_label_legend) config.countLabelLegend = cfg.count_label_legend;
  if (cfg.label_rotation) config.labelRotation = cfg.label_rotation;

  if (cfg.ghost_datasets) config.ghost_datasets = cfg.ghost_datasets;
  if (cfg.accent_datasets) config.accent_datasets = cfg.accent_datasets;
  if (cfg.accent_color) config.accent_color = cfg.accent_color;
  if (cfg.accent_label) config.accent_label = cfg.accent_label;

  if (cfg.slice) {
    // The slice sums the per-record magnitude; records carry only size/colour, so
    // a count_column other than the magnitude column cannot be honoured.
    const magnitudeCol = cfg.size_colour ?? cfg.colour;
    if (cfg.slice.count_column && cfg.slice.count_column !== magnitudeCol) {
      console.warn(`slice.count_column "${cfg.slice.count_column}" is ignored: the 2D slice sums the magnitude column (${magnitudeCol ?? "row count"}).`);
    }
    const countField = cfg.slice.count_column && cfg.slice.count_column === cfg.size_colour
      ? "color" as const
      : "size" as const;
    config.slice = { fixed_axis: cfg.slice.fixed_axis, count_field: countField };
  }

  return config;
}

// ── Drilldown building ────────────────────────────────────────────────────────

function buildDrilldown(rows: Row[], cfg: RawConfig): Record<string, TreemapEntry[] | InnerCubeData> {
  const drill = cfg.drilldown!;
  const { x, y, z } = cfg.axes;
  if (drill.type === "treemap")
    return buildTreemapDrilldown(rows, drill, x.column, y.column, z.column);
  return buildZoomDrilldown(rows, cfg);
}

function buildTreemapDrilldown(
  rows: Row[], drillCfg: RawDrilldownCfg,
  xCol: string, yCol: string, zCol: string,
): Record<string, TreemapEntry[]> {
  const catCol = drillCfg.category_column;
  if (!catCol) return {};

  const subCol = drillCfg.subcategory_column;
  const labelCol = drillCfg.category_label_column;
  const countCol = drillCfg.count_column;
  const result: Record<string, TreemapEntry[]> = {};

  // Tile size = summed count_column (real counts), falling back to row count when
  // no count_column is configured. Mirrors buildTreemap() so the treemap-type
  // drilldown and the zoom+treemap combo size tiles identically.
  const sumN = (group: Row[]) => countCol
    ? Math.round(group.reduce((s, r) => { const v = parseFloat(r[countCol]); return s + (isNaN(v) ? 0 : v); }, 0))
    : group.length;
  const labelOf = (group: Row[]) => labelCol ? { label: group[0]?.[labelCol] } : {};

  for (const [key, group] of groupBy(rows, r => `${r[xCol]}|${r[yCol]}|${r[zCol]}`)) {
    const entries: TreemapEntry[] = [];
    if (subCol) {
      for (const [pairKey, sub] of groupBy(group, r => `${r[catCol]}|||${r[subCol]}`)) {
        const [d, c] = pairKey.split("|||");
        entries.push({ d, c, n: sumN(sub), ...labelOf(sub) });
      }
    } else {
      for (const [d, sub] of groupBy(group, r => r[catCol])) {
        entries.push({ d, c: d, n: sumN(sub), ...labelOf(sub) });
      }
    }
    result[key] = entries;
  }
  return result;
}

function buildZoomDrilldown(rows: Row[], cfg: RawConfig): Record<string, InnerCubeData> {
  const drillCfg = cfg.drilldown!;
  const innerAxesCfg = drillCfg.axes ?? {};
  const outerCols = { x: cfg.axes.x.column, y: cfg.axes.y.column, z: cfg.axes.z.column };

  const innerCol = {
    x: innerAxesCfg.x?.column ?? outerCols.x,
    y: innerAxesCfg.y?.column ?? outerCols.y,
    z: innerAxesCfg.z?.column ?? outerCols.z,
  };

  // Only axes that explicitly define a new column are "replaced" (key is built from these)
  const replaced = (["x", "y", "z"] as const).filter(ax => innerAxesCfg[ax]?.column);
  if (replaced.length === 0) return {};

  const colorCol = drillCfg.size_colour ?? cfg.size_colour ?? cfg.colour;
  // When color comes from `colour:` (not `size_colour:`), size = 1 per row (count semantics)
  const sizeFromColor = !!(drillCfg.size_colour ?? cfg.size_colour);

  const result: Record<string, InnerCubeData> = {};

  for (const [key, group] of groupBy(rows, r => replaced.map(ax => applyValueLabel(r[outerCols[ax]], cfg.axes[ax])).join("|"))) {
    let g = group;

    // Apply per-axis max_labels for replaced axes
    for (const ax of replaced) {
      const maxN = innerAxesCfg[ax]?.max_labels;
      if (maxN) {
        const top = topLabels(g, innerCol[ax], colorCol, maxN);
        g = g.filter(r => top.has(r[innerCol[ax]]));
      }
    }

    const innerAxLabel = (ax: "x" | "y" | "z", raw: string): string => {
      const innerCfg = innerAxesCfg[ax];
      if (innerCfg?.value_labels?.[raw]) return innerCfg.value_labels[raw];
      if (!innerCfg?.column) return applyValueLabel(raw, cfg.axes[ax]);
      return raw;
    };

    const innerRecords: CubeRecord[] = [];
    for (const r of g) {
      let colorVal: number | undefined;
      if (colorCol && r[colorCol] !== undefined && r[colorCol] !== "") {
        const c = parseFloat(r[colorCol]);
        if (!isNaN(c)) colorVal = c;
      }
      const rec: CubeRecord = {
        x: innerAxLabel("x", r[innerCol.x]),
        y: innerAxLabel("y", r[innerCol.y]),
        z: innerAxLabel("z", r[innerCol.z]),
        size: sizeFromColor ? (colorVal ?? 1) : 1,
        datasets: cfg.datasets_column && r[cfg.datasets_column] ? [r[cfg.datasets_column]] : [],
      };
      if (colorVal !== undefined) rec.color = colorVal;
      innerRecords.push(rec);
    }

    let innerXs = orderedUnique(g.map(r => innerAxLabel("x", r[innerCol.x])).filter(Boolean));
    let innerYs = orderedUnique(g.map(r => innerAxLabel("y", r[innerCol.y])).filter(Boolean));
    let innerZs = orderedUnique(g.map(r => innerAxLabel("z", r[innerCol.z])).filter(Boolean));
    if (innerAxesCfg.x?.sort_by) innerXs = sortLabels(innerXs, g, innerCol.x, r => innerAxLabel("x", r), innerAxesCfg.x.sort_by, innerAxesCfg.x.sort_order ?? "desc");
    if (innerAxesCfg.y?.sort_by) innerYs = sortLabels(innerYs, g, innerCol.y, r => innerAxLabel("y", r), innerAxesCfg.y.sort_by, innerAxesCfg.y.sort_order ?? "desc");
    if (innerAxesCfg.z?.sort_by) innerZs = sortLabels(innerZs, g, innerCol.z, r => innerAxLabel("z", r), innerAxesCfg.z.sort_by, innerAxesCfg.z.sort_order ?? "desc");
    if (innerAxesCfg.x?.value_order) innerXs = applyValueOrder(innerXs, innerAxesCfg.x.value_order);
    if (innerAxesCfg.y?.value_order) innerYs = applyValueOrder(innerYs, innerAxesCfg.y.value_order);
    if (innerAxesCfg.z?.value_order) innerZs = applyValueOrder(innerZs, innerAxesCfg.z.value_order);

    const innerBlock: InnerCubeData = {
      records: innerRecords,
      xs: innerXs,
      ys: innerYs,
      zs: innerZs,
    };
    // Per-inner-cell treemap so each hovered inner cell gets its own D
    // (source concentration), computed the same way as the outer cube.
    const tmCfg = drillCfg.treemap;
    if (tmCfg?.category_column) {
      const catCol = tmCfg.category_column;
      const subCol = tmCfg.subcategory_column;
      const labelCol = tmCfg.category_label_column;
      const countCol = tmCfg.count_column;
      const sumN = (grp: Row[]) => countCol
        ? Math.round(grp.reduce((s, r) => { const v = parseFloat(r[countCol]); return s + (isNaN(v) ? 0 : v); }, 0))
        : grp.length;
      const labelOf = (grp: Row[]) => labelCol ? { label: grp[0]?.[labelCol] } : {};
      const tm: Record<string, TreemapEntry[]> = {};
      const cellKeyOf = (r: Row) =>
        `${innerAxLabel("x", r[innerCol.x])}|${innerAxLabel("y", r[innerCol.y])}|${innerAxLabel("z", r[innerCol.z])}`;
      for (const [ck, cellRows] of groupBy(g, cellKeyOf)) {
        const entries: TreemapEntry[] = [];
        if (subCol) {
          for (const [pairKey, sub] of groupBy(cellRows, r => `${r[catCol]}|||${r[subCol]}`)) {
            const [d, c] = pairKey.split("|||");
            entries.push({ d, c, n: sumN(sub), ...labelOf(sub) });
          }
        } else {
          for (const [d, sub] of groupBy(cellRows, r => r[catCol])) {
            entries.push({ d, c: d, n: sumN(sub), ...labelOf(sub) });
          }
        }
        tm[ck] = entries;
      }
      innerBlock.treemap = tm;
    }
    result[key] = innerBlock;
  }
  return result;
}

// ── Treemap building (zoom + treemap combo) ───────────────────────────────────

function buildTreemap(
  rows: Row[], treemapCfg: RawTreemapCfg,
  xCol: string, yCol: string, zCol: string,
): Record<string, TreemapEntry[]> {
  const catCol = treemapCfg.category_column;
  if (!catCol) return {};

  const subCol = treemapCfg.subcategory_column;
  const labelCol = treemapCfg.category_label_column;
  const countCol = treemapCfg.count_column;
  const result: Record<string, TreemapEntry[]> = {};

  const sumN = (group: Row[]) => countCol
    ? Math.round(group.reduce((s, r) => { const v = parseFloat(r[countCol]); return s + (isNaN(v) ? 0 : v); }, 0))
    : group.length;
  const labelOf = (group: Row[]) => labelCol ? { label: group[0]?.[labelCol] } : {};

  for (const [key, group] of groupBy(rows, r => `${r[xCol]}|${r[yCol]}|${r[zCol]}`)) {
    const entries: TreemapEntry[] = [];
    if (subCol) {
      for (const [pairKey, sub] of groupBy(group, r => `${r[catCol]}|||${r[subCol]}`)) {
        const [d, c] = pairKey.split("|||");
        entries.push({ d, c, n: sumN(sub), ...labelOf(sub) });
      }
    } else {
      for (const [d, sub] of groupBy(group, r => r[catCol])) {
        entries.push({ d, c: d, n: sumN(sub), ...labelOf(sub) });
      }
    }
    result[key] = entries;
  }
  return result;
}

// ── Info building ─────────────────────────────────────────────────────────────

function resolveInfoAxes(cfg: RawConfig): RawConfig["axes"] {
  if (cfg.drilldown?.type !== "zoom" || !cfg.drilldown.axes) return cfg.axes;
  const inner = cfg.drilldown.axes;
  return {
    x: inner.x?.column ? { ...cfg.axes.x, column: inner.x.column } : cfg.axes.x,
    y: inner.y?.column ? { ...cfg.axes.y, column: inner.y.column } : cfg.axes.y,
    z: inner.z?.column ? { ...cfg.axes.z, column: inner.z.column } : cfg.axes.z,
  };
}

/** Column identifying a record's source (the treemap's grouping unit), if configured. */
function sourceColumn(cfg: RawConfig): string | undefined {
  const d = cfg.drilldown;
  return d?.treemap?.category_column ?? (d?.type === "treemap" ? d.category_column : undefined) ?? cfg.datasets_column;
}

function buildInfo(
  rows: Row[],
  axes: RawConfig["axes"],
  columns: Record<string, string>,
  outerAxes?: RawConfig["axes"],
  sourceCol?: string,
): Record<string, Record<string, string>[]> {
  if (Object.keys(columns).length === 0) return {};
  const { x, y, z } = axes;
  const result: Record<string, Record<string, string>[]> = {};

  for (const [key, group] of groupBy(rows, r => {
    const inner = `${r[x.column]}|${r[y.column]}|${r[z.column]}`;
    if (!outerAxes) return inner;
    return `${r[outerAxes.x.column]}|${r[outerAxes.y.column]}|${r[outerAxes.z.column]}|${inner}`;
  })) {
    const seen = new Set<string>();
    const entries: Record<string, string>[] = [];
    for (const r of group) {
      const entry: Record<string, string> = {};
      for (const [field, col] of Object.entries(columns)) {
        if (r[col] !== undefined && r[col] !== "") entry[field] = r[col];
      }
      if (Object.keys(entry).length === 0) continue;
      // Tag each entry with its source id (the treemap's grouping unit) so the info
      // box can group, count and highlight by source. Entries are deduplicated on
      // all fields, so a source keeps one entry per distinct dataset within it.
      if (sourceCol && r[sourceCol]) entry._source = r[sourceCol];
      const fingerprint = JSON.stringify(entry);
      if (!seen.has(fingerprint)) { seen.add(fingerprint); entries.push(entry); }
    }
    if (entries.length > 0) result[key] = entries;
  }
  return result;
}
