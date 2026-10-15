import type { CubeConfig } from "./config";

export interface CubeRecord {
  x: string;
  y: string;
  z: string;
  size: number;
  datasets: string[];
  color?: number;
}

export interface CubeCell {
  x: string;
  y: string;
  z: string;
  size: number;
  datasets: string[];
  color?: number;
}

export interface TreemapEntry {
  d: string;
  c: string;
  n: number;
  /** Optional display label for the category `d` (e.g. a title when `d` is an opaque id). */
  label?: string;
}

export interface Dominance {
  /** Largest single source's share of the cell (0–1), an intuitive companion to nEff. */
  D: number;
  /** Number of contributing sources (e.g. collections). */
  nSources: number;
  /** Effective number of sources — inverse Simpson, 1 / Σ pᵢ² (primary concentration measure). */
  nEff: number;
  /** Effective number of sources — Shannon, exp(−Σ pᵢ ln pᵢ) (reported for comparison). */
  nEffShannon: number;
  label: "single-source" | "skewed" | "diverse";
  color: string;
}

/**
 * Default thresholds on the effective number of sources (inverse Simpson):
 * nEff < lo → single-source, lo ≤ nEff < hi → skewed, nEff ≥ hi → diverse.
 * Overridable via `config.concentrationThresholds`.
 */
export const DEFAULT_CONCENTRATION_THRESHOLDS: [number, number] = [2, 5];

/**
 * Source-concentration of a cell's drilldown, computed over ALL contributing
 * sources (the treemap's `category_column` — e.g. collection). Reports the
 * effective number of sources via inverse Simpson (nEff, primary) and Shannon
 * (nEffShannon, for comparison), plus the single-largest share D. The label and
 * colour are banded by `thresholds` on nEff. Returns null with no drilldown data.
 */
export function computeDominance(
  entries: TreemapEntry[] | null | undefined,
  thresholds: [number, number] = DEFAULT_CONCENTRATION_THRESHOLDS,
): Dominance | null {
  if (!entries || entries.length === 0) return null;
  const sourceTotals = new Map<string, number>();
  for (const e of entries) {
    sourceTotals.set(e.d, (sourceTotals.get(e.d) || 0) + e.n);
  }
  const totals = [...sourceTotals.values()].filter((v) => v > 0);
  if (totals.length === 0) return null;
  const N = totals.reduce((a, b) => a + b, 0);
  const ps = totals.map((v) => v / N);
  const D = Math.max(...ps);
  const simpson = ps.reduce((a, p) => a + p * p, 0);
  const nEff = simpson > 0 ? 1 / simpson : totals.length;
  const shannonH = -ps.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0);
  const nEffShannon = Math.exp(shannonH);
  const [lo, hi] = thresholds;
  const label = nEff < lo ? "single-source" : nEff < hi ? "skewed" : "diverse";
  // Okabe–Ito colour-vision-deficiency–safe trio: vermillion / orange / bluish-green.
  const color = nEff < lo ? "#D55E00" : nEff < hi ? "#E69F00" : "#009E73";
  return { D, nSources: totals.length, nEff, nEffShannon, label, color };
}

export interface InnerCubeData {
  records: CubeRecord[];
  xs: string[];
  ys: string[];
  zs: string[];
  /** Per-inner-cell treemap entries, keyed "x|y|z". Drives per-cell D on hover. */
  treemap?: Record<string, TreemapEntry[]>;
}

export type InfoEntry = Record<string, string>;

export type DrilldownValue = TreemapEntry[] | InnerCubeData;

/** A single [label, value] point in a per-cell chart series. */
export type ChartPoint = [string | number, number];

/**
 * A per-cell chart specification (see `charts_json`). Three kinds are supported:
 *  - `sparkline` (default): percentage-return area sparkline; series given as
 *    `price` (legacy field) or `data`, as [date, value] pairs.
 *  - `line`: plain line chart of `data` ([x, value] pairs).
 *  - `bar`: categorical bar chart of `data` ([category, value] pairs).
 * A bare `{ price: [...] }` (no `type`) is treated as a sparkline for backward
 * compatibility.
 */
export interface ChartSpec {
  type?: "sparkline" | "line" | "bar";
  /** Sparkline series (legacy field); [date, value] pairs. */
  price?: ChartPoint[];
  /** Generic series for line/bar (and an alternative to `price` for sparkline). */
  data?: ChartPoint[];
  x_label?: string;
  y_label?: string;
  /** Override colour for line/bar charts (any CSS colour). */
  color?: string;
}

export interface CubeData {
  config: CubeConfig;
  records: CubeRecord[];
  xs: string[];
  ys: string[];
  zs: string[];
  drilldown?: Record<string, DrilldownValue>;
  treemap?: Record<string, TreemapEntry[]>;
  info?: Record<string, InfoEntry[]>;
  infoBox?: Record<string, InfoEntry[]>;
  charts?: Record<string, ChartSpec>;
  /** Per-cell breakdown of a configured column (e.g. cell_type). Key = "x|y|z". */
  cellBreakdown?: Record<string, Record<string, number>>;
}

export function buildCubeCells(
  records: CubeRecord[],
  colorAggregation: "sum" | "mean" = "sum",
): CubeCell[] {
  const map = new Map<string, CubeCell>();
  const colorCount = new Map<string, number>();
  for (const r of records) {
    const key = `${r.x}|${r.y}|${r.z}`;
    if (!map.has(key)) {
      map.set(key, { x: r.x, y: r.y, z: r.z, size: 0, datasets: [] });
      colorCount.set(key, 0);
    }
    const cell = map.get(key)!;
    cell.size += r.size;
    cell.datasets.push(...r.datasets);
    if (r.color !== undefined) {
      cell.color = (cell.color ?? 0) + r.color;
      colorCount.set(key, colorCount.get(key)! + 1);
    }
  }
  for (const [key, cell] of map.entries()) {
    cell.datasets = [...new Set(cell.datasets)];
    if (colorAggregation === "mean" && cell.color !== undefined) {
      const n = colorCount.get(key) ?? 1;
      if (n > 0) cell.color = cell.color / n;
    }
  }
  return [...map.values()];
}

export function getXs(records: CubeRecord[]): string[] {
  return [...new Set(records.map((r) => r.x))];
}

export function getYs(records: CubeRecord[]): string[] {
  return [...new Set(records.map((r) => r.y))];
}

export function getZs(records: CubeRecord[]): string[] {
  return [...new Set(records.map((r) => r.z))];
}

export function distanceFromOrigin(
  xi: number,
  yi: number,
  zi: number,
): number {
  return Math.sqrt(xi ** 2 + yi ** 2 + zi ** 2);
}

export function cellKey(cell: { x: string; y: string; z: string }): string {
  return `${cell.x}|${cell.y}|${cell.z}`;
}

/**
 * Faceted availability under the current axis filters: for each axis, the values
 * that occur in at least one cell matching the filters of the *other* two axes
 * (an axis's own filter is ignored, so its unticked values stay discoverable).
 * Returns undefined when no filter is active.
 */
export function availableAxisValues(
  cells: { x: string; y: string; z: string }[],
  xFilter: Set<string>, yFilter: Set<string>, zFilter: Set<string>,
): { x: Set<string>; y: Set<string>; z: Set<string> } | undefined {
  if (xFilter.size === 0 && yFilter.size === 0 && zFilter.size === 0) return undefined;
  const ok = (f: Set<string>, v: string) => f.size === 0 || f.has(v);
  const out = { x: new Set<string>(), y: new Set<string>(), z: new Set<string>() };
  for (const c of cells) {
    const xm = ok(xFilter, c.x), ym = ok(yFilter, c.y), zm = ok(zFilter, c.z);
    if (ym && zm) out.x.add(c.x);
    if (xm && zm) out.y.add(c.y);
    if (xm && ym) out.z.add(c.z);
  }
  return out;
}
