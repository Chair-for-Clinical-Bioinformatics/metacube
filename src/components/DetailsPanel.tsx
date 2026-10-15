import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { treemap as d3treemap, hierarchy, treemapSquarify } from "d3-hierarchy";
import type { CubeRecord, CubeCell, InfoEntry, TreemapEntry, ChartSpec } from "../data/dataModel";
import type { CubeConfig } from "../data/config";
import { AXIS_COLORS, getAxisColor } from "../data/colors";
import {
  PANEL_BG, PANEL_BORDER, CARD_BG,
  TEXT, TEXT_BODY, TEXT_MUTED, TEXT_DIM,
  ACCENT,
} from "../data/theme";
import { useTheme } from "../data/themeContext";
import { CellChart } from "./CellChart";
import { SourceCards } from "./SourceCards";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const PANEL_W = 300;
// Max publication cards in a figure-capture info box (keeps the element under
// Playwright's 32767px screenshot limit and readable as a panel).
const FIGURE_INFOBOX_MAX = 36;

export interface FilterSummary {
  xFilter: Set<string>;
  yFilter: Set<string>;
  zFilter: Set<string>;
  total: number;
}

interface DetailsPanelProps {
  cell: CubeCell | null;
  outerCell?: CubeCell;
  totalSize: number;
  config: CubeConfig;
  records: CubeRecord[];
  outerConfig?: CubeConfig;
  outerRecords?: CubeRecord[];
  infoEntries?: InfoEntry[] | null;
  zoomedAxes?: ("x" | "y" | "z")[];
  charts?: Record<string, ChartSpec>;
  treemapEntries?: TreemapEntry[] | null;
  filterSummary?: FilterSummary | null;
  /** Toggle sources (ids from the info box) in the cube highlight selection. */
  onSourcesToggle?: (ids: string[]) => void;
  /** Currently highlighted source ids. */
  selectedSources?: Set<string>;
  /** Magnitude per source id (for sorting the info box and showing per-source counts). */
  sourceSizes?: Map<string, number>;
  /** Source hovered in the treemap (its card is highlighted), and hover callback. */
  hoveredSource?: string | null;
  onSourceHover?: (id: string | null) => void;
  /** Start with the 2D-slice matrix expanded (used by figure capture). */
  initialShowMatrix?: boolean;
  /** Render only this section, standalone and unclipped (figure capture). */
  figureCapture?: "slice" | "infobox";
  /** Plural noun for one info-box source, e.g. "datasets" (from the treemap config). */
  sourceNoun?: string;
  /** Pixels to keep free at the bottom of the viewport (another panel lives there). */
  bottomReserve?: number;
  /** Hide the 2D-slice toggle (figure capture of the info box only). */
  hideSlice?: boolean;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function axisVal(r: CubeRecord | CubeCell, axis: "x" | "y" | "z"): string {
  return axis === "x" ? r.x : axis === "y" ? r.y : r.z;
}

const DIVIDER: React.CSSProperties = { borderTop: `1px solid ${PANEL_BORDER}`, margin: "10px 0" };
const SEC_LBL: React.CSSProperties = {
  fontWeight: 600, fontSize: 10, textTransform: "uppercase",
  letterSpacing: 0.5, color: TEXT_MUTED, marginBottom: 4,
};
const GRIP_BASE: React.CSSProperties = {
  position: "absolute", width: 16, height: 16, zIndex: 1,
};

/** Chip color for a cell axis value.
 * Grouped Y axes (e.g. organism) get the group's value-specific color so they
 * match the 3D labels; every other axis uses its axis color (config override or
 * the AXIS_COLORS default) rather than neutral grey.
 */
function cellChipColor(ax: "x" | "y" | "z", val: string, config: CubeConfig): string {
  if (ax === "y" && config.axes.y.groupSeparator) {
    const sep = config.axes.y.groupSeparator;
    const idx = val.indexOf(sep);
    const group = idx > 0 ? val.slice(0, idx) : val;
    return getAxisColor(group, config);
  }
  return config.axisColors?.[ax] ?? AXIS_COLORS[ax];
}

function CellInfo({ cell, config, denominator, denominatorLabel, axes, labelConfig }: {
  cell: CubeCell;
  config: CubeConfig;
  denominator: number;
  denominatorLabel: string;
  axes?: ("x" | "y" | "z")[];
  labelConfig?: CubeConfig;
}) {
  const pct = denominator > 0 ? ((cell.size / denominator) * 100).toFixed(1) : "0";
  const displayAxes = axes ?? (["x", "y", "z"] as const);
  const labCfg = labelConfig ?? config;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", marginBottom: 4 }}>
        {displayAxes.map((ax, i) => {
          const val = cell[ax];
          const color = cellChipColor(ax, val, labCfg);
          return (
            <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              {i > 0 && <span style={{ color: PANEL_BORDER, marginRight: 2 }}>·</span>}
              <span style={{ color: TEXT_DIM }}>{labCfg.axes[ax].label}</span>
              <span style={{
                padding: "1px 7px", borderRadius: 9,
                background: `${color}18`, color,
                border: `1px solid ${color}38`,
                fontWeight: 600,
              }}>
                {val}
              </span>
            </span>
          );
        })}
      </div>
      {!config.uniformCellColor && (
        <div style={{ fontSize: 11, color: TEXT_MUTED }}>
          <span style={{ fontWeight: 600, color: TEXT_BODY }}>{fmt(cell.size)}</span>
          {` ${config.countLabel ?? "entries"} · `}
          <span style={{ fontWeight: 600, color: TEXT_BODY }}>{pct}%</span>
          {" of "}{denominatorLabel}
        </div>
      )}
    </div>
  );
}

export function DetailsPanel({ cell, outerCell, totalSize, config, records, outerConfig, outerRecords, infoEntries, zoomedAxes, charts, treemapEntries, filterSummary, onSourcesToggle, selectedSources, sourceSizes, hoveredSource, onSourceHover, initialShowMatrix = false, figureCapture, sourceNoun = "datasets", bottomReserve = 0, hideSlice = false }: DetailsPanelProps) {
  const [showMatrix, setShowMatrix] = useState(initialShowMatrix);
  const isZoomMode = outerCell !== undefined;

  // Position: bottom-right for outer cube, top-right below breadcrumb for zoom mode
  const [panelPos, setPanelPos] = useState(() => ({
    x: window.innerWidth - 12 - PANEL_W,
    y: 52,
  }));
  const [panelW, setPanelW] = useState(PANEL_W);
  // null = auto height (content-driven); fixed number once user resizes
  const [panelH, setPanelH] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{
    startX: number; startY: number;
    origW: number; origH: number;
    origX: number; origY: number;
    corner: "br" | "bl" | "tr" | "tl";
  } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPanelPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
      }
      if (resizeRef.current) {
        const { startX, startY, origW, origH, origX, origY, corner } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (corner === "br") {
          setPanelW(Math.max(200, origW + dx));
          setPanelH(Math.max(120, origH + dy));
        } else if (corner === "bl") {
          const newW = Math.max(200, origW - dx);
          setPanelW(newW);
          setPanelH(Math.max(120, origH + dy));
          setPanelPos({ x: origX + origW - newW, y: origY });
        } else if (corner === "tr") {
          const newH = Math.max(120, origH - dy);
          setPanelW(Math.max(200, origW + dx));
          setPanelH(newH);
          setPanelPos({ x: origX, y: origY + origH - newH });
        } else if (corner === "tl") {
          const newW = Math.max(200, origW - dx);
          const newH = Math.max(120, origH - dy);
          setPanelW(newW);
          setPanelH(newH);
          setPanelPos({ x: origX + origW - newW, y: origY + origH - newH });
        }
      }
    };
    const onUp = () => { dragRef.current = null; resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y };
    e.preventDefault();
  }, [panelPos]);

  const makeResizeStart = useCallback((corner: "br" | "bl" | "tr" | "tl") => (e: React.MouseEvent) => {
    // Capture actual rendered height on first resize (panel may be auto-height)
    const origH = containerRef.current?.offsetHeight ?? panelH ?? 200;
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: panelW, origH,
      origX: panelPos.x, origY: panelPos.y,
      corner,
    };
    if (panelH === null) setPanelH(origH);
    e.preventDefault();
    e.stopPropagation();
  }, [panelW, panelH, panelPos]);

  // In zoom mode, slice is computed against the outer cell + outer records
  const sliceCfg = isZoomMode ? outerConfig?.slice : config.slice;
  const sliceRecords = isZoomMode ? (outerRecords ?? []) : records;
  const sliceCell = isZoomMode ? (outerCell ?? null) : cell;
  const sliceAxesCfg = isZoomMode ? (outerConfig ?? config) : config;

  const matrixSlice = useMemo(() => {
    if (!sliceCell || !sliceCfg || !showMatrix) return null;
    const { fixed_axis, count_field = "size" } = sliceCfg;
    const fixedValue = axisVal(sliceCell, fixed_axis);
    const otherAxes = (["x", "y", "z"] as const).filter((a) => a !== fixed_axis) as [
      "x" | "y" | "z",
      "x" | "y" | "z",
    ];
    const [axis1, axis2] = otherAxes;

    const filtered = sliceRecords.filter((r) => axisVal(r, fixed_axis) === fixedValue);
    const vals1 = [...new Set(filtered.map((r) => axisVal(r, axis1)))].sort();
    const vals2 = [...new Set(filtered.map((r) => axisVal(r, axis2)))].sort();

    const lookup = new Map<string, number>();
    for (const r of filtered) {
      const key = `${axisVal(r, axis1)}|${axisVal(r, axis2)}`;
      const count = count_field === "color" ? (r.color ?? 0) : r.size;
      lookup.set(key, (lookup.get(key) ?? 0) + count);
    }

    const maxVal = Math.max(...lookup.values(), 1);
    return { vals1, vals2, lookup, maxVal, axis1, axis2 };
  }, [sliceCell, sliceCfg, sliceRecords, showMatrix]);

  if (!isZoomMode && !cell) return null;
  if (isZoomMode && !outerCell) return null;

  let chartKey: string | null = null;
  let chartTicker: string | null = null;
  if (charts && Object.keys(charts).length > 0) {
    const lookupCell = cell ?? outerCell ?? null;
    if (lookupCell) {
      for (const v of [lookupCell.z, lookupCell.y, lookupCell.x]) {
        if (v && charts[v]) { chartKey = v; chartTicker = v; break; }
      }
    }
    if (!chartKey && infoEntries) {
      for (const entry of infoEntries) {
        for (const val of Object.values(entry)) {
          if (val && charts[val]) { chartKey = val; chartTicker = val; break; }
        }
        if (chartKey) break;
      }
    }
    // In zoom mode with no inner cell selected: if there's exactly one company
    // in the drilldown records, show its sparkline automatically.
    if (!chartKey && isZoomMode && !cell && records.length > 0) {
      const found = new Set<string>();
      for (const r of records) {
        for (const v of [r.z, r.y, r.x]) {
          if (v && charts[v]) found.add(v);
        }
      }
      if (found.size === 1) {
        chartKey = [...found][0];
        chartTicker = chartKey;
      }
    }
  }
  const chartSection = chartKey && chartTicker && charts?.[chartKey]
    ? <CellChart name={chartTicker} spec={charts[chartKey]} />
    : null;

  const miniTreemapSection = treemapEntries && treemapEntries.length > 0
    ? <MiniTreemap entries={treemapEntries} />
    : null;

  // The slice heatmap on its own (title + table), with no toggle button. Used
  // both inside the interactive panel and as a standalone figure-capture target.
  // overflowX is "visible" for capture so the full matrix renders (the panel's
  // narrow width would otherwise clip it).
  const sliceMatrix = matrixSlice ? (
    <div data-testid="slice-matrix" style={{ marginTop: 8, overflowX: figureCapture === "slice" ? "visible" : "auto", background: PANEL_BG, padding: 8, borderRadius: 6 }}>
          <div style={{ ...SEC_LBL, marginBottom: 4 }}>
            {axisVal(sliceCell!, sliceCfg!.fixed_axis)}: {sliceAxesCfg.axes[matrixSlice.axis1].label} × {sliceAxesCfg.axes[matrixSlice.axis2].label}
          </div>
          <table style={{ borderCollapse: "collapse", fontSize: 9, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ padding: "2px 4px", borderBottom: `1px solid ${PANEL_BORDER}` }} />
                {matrixSlice.vals2.map((v) => (
                  <th key={v} style={{
                    padding: "2px 3px", textAlign: "center", fontSize: 8,
                    fontWeight: v === axisVal(sliceCell!, matrixSlice.axis2) ? 700 : 400,
                    color: v === axisVal(sliceCell!, matrixSlice.axis2) ? TEXT : TEXT_DIM,
                    borderBottom: `1px solid ${PANEL_BORDER}`,
                  }}>
                    {v.length > 12 ? v.slice(0, 10) + "…" : v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixSlice.vals1.map((v1) => (
                <tr key={v1}>
                  <td style={{
                    padding: "2px 4px", fontSize: 8, whiteSpace: "nowrap",
                    fontWeight: v1 === axisVal(sliceCell!, matrixSlice.axis1) ? 700 : 400,
                    color: v1 === axisVal(sliceCell!, matrixSlice.axis1) ? TEXT : TEXT_MUTED,
                    borderRight: `1px solid ${PANEL_BORDER}`,
                  }}>
                    {v1.length > 18 ? v1.slice(0, 16) + "…" : v1}
                  </td>
                  {matrixSlice.vals2.map((v2) => {
                    const val = matrixSlice.lookup.get(`${v1}|${v2}`) ?? 0;
                    const isSel = v1 === axisVal(sliceCell!, matrixSlice.axis1) && v2 === axisVal(sliceCell!, matrixSlice.axis2);
                    const intensity = val > 0 ? Math.max(0.08, Math.sqrt(val / matrixSlice.maxVal)) : 0;
                    return (
                      <td key={v2} style={{
                        padding: "2px 3px", textAlign: "center", fontSize: 8,
                        background: isSel
                          ? "rgba(140,78,159,0.2)"
                          : val > 0 ? `rgba(99,102,241,${intensity})` : "transparent",
                        color: val > 0 ? TEXT : TEXT_DIM,
                        fontWeight: isSel ? 700 : 400,
                        border: isSel ? `1.5px solid ${ACCENT}` : "none",
                      }}>
                        {val > 0 ? fmt(val) : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
    </div>
  ) : null;

  // Interactive slice section: toggle button + (when open) the matrix.
  const sliceSection = sliceCfg && !hideSlice ? (
    <div data-testid="slice-section">
      <button
        onClick={() => setShowMatrix((v) => !v)}
        style={{
          width: "100%", marginTop: 10, padding: "4px 0",
          fontSize: 10, fontWeight: 600, cursor: "pointer",
          background: showMatrix ? "rgba(43,200,140,0.20)" : CARD_BG,
          border: `1px solid ${showMatrix ? "#34d399" : PANEL_BORDER}`,
          color: showMatrix ? "#34d399" : TEXT_MUTED,
          borderRadius: 4, fontFamily: FONT,
        }}
      >
        {showMatrix ? "Hide" : "View"} 2D Slice
      </button>
      {showMatrix && sliceMatrix}
    </div>
  ) : null;

  // Figure capture: a long dataset list (e.g. census brain has hundreds) would
  // exceed Playwright's 32767px screenshot limit and isn't a usable panel, so we
  // cap it and lay the cards out in columns. The interactive panel is unchanged
  // (scrollable, full list, single column).
  const isInfoFigure = figureCapture === "infobox";
  // Header counts: sources (matches the treemap's source count) and, when the
  // entries name datasets, how many datasets those sources comprise.
  // (Plain computation, not a hook: this runs after the early returns above.)
  const infoCounts = {
    sources: new Set((infoEntries ?? []).map((e) => e._source ?? e.title ?? JSON.stringify(e))).size,
    datasets: (infoEntries ?? []).filter((e) => e.dataset).length,
  };
  const plural = (n: number, noun: string) => `${n.toLocaleString()} ${n === 1 ? noun.replace(/s$/, "") : noun}`;

  const infoHeader = infoEntries && infoEntries.length > 0 && !isInfoFigure ? (
    <div style={{ ...SEC_LBL, marginTop: 12 }}>
      {plural(infoCounts.sources, sourceNoun)}
      {infoCounts.datasets > infoCounts.sources && ` · ${plural(infoCounts.datasets, "datasets")}`}
      {onSourcesToggle && <span style={{ textTransform: "none", fontWeight: 400, color: TEXT_DIM }}> — click to highlight</span>}
    </div>
  ) : null;

  const infoSection = infoEntries && infoEntries.length > 0 ? (
    <div style={{ marginTop: isInfoFigure ? 0 : 6, ...(isInfoFigure ? { width: 920 } : {}) }}>
      <SourceCards
        entries={infoEntries}
        sizes={sourceSizes}
        countLabel={config.countLabel}
        selected={selectedSources}
        onToggle={onSourcesToggle}
        hovered={hoveredSource}
        onHover={onSourceHover}
        maxGroups={isInfoFigure ? FIGURE_INFOBOX_MAX : undefined}
        columns={isInfoFigure ? 3 : undefined}
      />
    </div>
  ) : null;

  // Figure capture: render just the requested section, standalone and unclipped.
  if (figureCapture) {
    return (
      <div style={{
        position: "fixed", left: 16, top: 16, zIndex: 500,
        width: "max-content",
        maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)",
        overflow: "visible",
        background: "#fff", border: "1px solid #d0d5dd", borderRadius: 10,
        padding: "14px 16px", color: "#374151", fontFamily: FONT,
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
      }}>
        {figureCapture === "slice" ? sliceMatrix : infoSection}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="details-panel"
      style={{
        position: "fixed",
        left: panelPos.x, top: panelPos.y,
        width: panelW,
        height: panelH ?? undefined,
        maxHeight: panelH != null ? undefined : `calc(100vh - ${panelPos.y + 16 + bottomReserve}px)`,
        boxSizing: "border-box",
        overflowY: "auto",
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 10,
        padding: "14px 16px",
        fontSize: 13, color: TEXT_BODY,
        zIndex: 250,
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        fontFamily: FONT,
        userSelect: "none",
      }}
    >
      {isZoomMode ? (
        <>
          <div style={{ ...SEC_LBL, cursor: "grab" }} onMouseDown={handleDragStart}>Selected cell</div>
          {/* The drilled-into cell is identified by all three outer axes
              (e.g. Organism · Assay · Organ), not just the axes the drilldown
              re-defines — otherwise census (which only redefines z=Organ) would
              show just the organ here. */}
          <CellInfo cell={outerCell!} config={config} labelConfig={outerConfig ?? config} denominator={totalSize} denominatorLabel="total" />
          {sliceSection}
          {filterSummary && (filterSummary.xFilter.size > 0 || filterSummary.yFilter.size > 0 || filterSummary.zFilter.size > 0) && (
            <>
              <div style={DIVIDER} />
              <FilterSummarySection summary={filterSummary} config={config} />
            </>
          )}
          {cell && (
            <>
              <div style={DIVIDER} />
              <div style={SEC_LBL}>Inner cell</div>
              <CellInfo cell={cell} config={config} denominator={outerCell!.size} denominatorLabel="outer" />
            </>
          )}
          {chartSection}
          {infoHeader}
          {infoSection}
          {miniTreemapSection}
        </>
      ) : (
        <>
          <div style={{ ...SEC_LBL, cursor: "grab" }} onMouseDown={handleDragStart}>Selected cell</div>
          <CellInfo cell={cell!} config={config} denominator={totalSize} denominatorLabel="total" />
          {sliceSection}
          {chartSection}
          {infoHeader}
          {infoSection}
          {miniTreemapSection}
        </>
      )}

      {/* 4-corner resize grips */}
      <div onMouseDown={makeResizeStart("tl")} style={{ ...GRIP_BASE, top: 0, left: 0, cursor: "nwse-resize", background: `linear-gradient(315deg, transparent 50%, ${PANEL_BORDER} 50%)`, borderRadius: "10px 0 0 0" }} />
      <div onMouseDown={makeResizeStart("tr")} style={{ ...GRIP_BASE, top: 0, right: 0, cursor: "nesw-resize", background: `linear-gradient(45deg, transparent 50%, ${PANEL_BORDER} 50%)`, borderRadius: "0 10px 0 0" }} />
      <div onMouseDown={makeResizeStart("bl")} style={{ ...GRIP_BASE, bottom: 0, left: 0, cursor: "nesw-resize", background: `linear-gradient(225deg, transparent 50%, ${PANEL_BORDER} 50%)`, borderRadius: "0 0 0 10px" }} />
      <div onMouseDown={makeResizeStart("br")} style={{ ...GRIP_BASE, bottom: 0, right: 0, cursor: "nwse-resize", background: `linear-gradient(135deg, transparent 50%, ${PANEL_BORDER} 50%)`, borderRadius: "0 0 10px 0" }} />
    </div>
  );
}

// ── Filter summary helpers ────────────────────────────────────────────────────

function FilterSummarySection({ summary, config, showTitle = true }: { summary: FilterSummary; config: CubeConfig; showTitle?: boolean }) {
  const axes = (
    [
      { ax: "x" as const, values: [...summary.xFilter] },
      { ax: "y" as const, values: [...summary.yFilter] },
      { ax: "z" as const, values: [...summary.zFilter] },
    ] as { ax: "x" | "y" | "z"; values: string[] }[]
  ).filter(({ values }) => values.length > 0);

  return (
    <div>
      {showTitle && <div style={SEC_LBL}>Filter selection</div>}
      {axes.map(({ ax, values }) => {
        const color = config.axisColors?.[ax] ?? AXIS_COLORS[ax];
        return (
          <div key={ax} style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px", marginBottom: 3, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: TEXT_DIM, flexShrink: 0 }}>{config.axes[ax].label}:</span>
            {values.map((v) => (
              <span key={v} style={{
                padding: "1px 6px", borderRadius: 8, fontSize: 10,
                background: `${color}14`, color, border: `1px solid ${color}30`, fontWeight: 600,
              }}>{v}</span>
            ))}
          </div>
        );
      })}
      <div style={{ marginTop: 5, fontSize: 11 }}>
        <span style={{ color: TEXT_DIM }}>Total: </span>
        <span style={{ fontWeight: 700, color: TEXT }}>{summary.total.toLocaleString()}</span>
        <span style={{ color: TEXT_DIM }}> {config.countLabel ?? "entries"}</span>
      </div>
    </div>
  );
}

export function FilterSummaryPanel({
  config,
  xFilter,
  yFilter,
  zFilter,
  total,
}: {
  config: CubeConfig;
  xFilter: Set<string>;
  yFilter: Set<string>;
  zFilter: Set<string>;
  total: number;
}) {
  const summary: FilterSummary = { xFilter, yFilter, zFilter, total };
  const [panelPos, setPanelPos] = useState(() => ({
    x: window.innerWidth - 12 - PANEL_W,
    y: 52,
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPanelPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y };
    e.preventDefault();
  }, [panelPos]);

  return (
    <div
      style={{
        position: "fixed",
        left: panelPos.x, top: panelPos.y,
        width: PANEL_W,
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 10,
        padding: "14px 16px",
        fontSize: 13, color: TEXT_BODY,
        zIndex: 250,
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        fontFamily: FONT,
        userSelect: "none",
      }}
    >
      <div style={{ ...SEC_LBL, cursor: "grab" }} onMouseDown={handleDragStart}>Filter selection</div>
      <FilterSummarySection summary={summary} config={config} showTitle={false} />
    </div>
  );
}

// ── Mini inline treemap ───────────────────────────────────────────────────────

type TreeNode = { name: string; children?: TreeNode[]; value?: number };

function MiniTreemap({ entries }: { entries: TreemapEntry[] }) {
  const { theme } = useTheme();
  const CT_PALETTE = theme.categorical;
  const W = 268;
  const H = 120;

  const nodes = useMemo(() => {
    // Group entries by category (d), sum subcategory counts
    const groups = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (!groups.has(e.d)) groups.set(e.d, new Map());
      groups.get(e.d)!.set(e.c, (groups.get(e.d)!.get(e.c) ?? 0) + e.n);
    }

    const allCats = [...new Set(entries.map(e => e.c))].sort();
    const ctColor = new Map(allCats.map((c, i) => [c, CT_PALETTE[i % CT_PALETTE.length]]));

    const root: TreeNode = {
      name: "root",
      children: [...groups.entries()].map(([d, subs]) => ({
        name: d,
        children: [...subs.entries()].map(([c, n]) => ({ name: c, value: n, _color: ctColor.get(c) } as TreeNode & { _color?: string })),
      })),
    };

    const layout = d3treemap<TreeNode>()
      .size([W, H])
      .paddingTop(14)
      .paddingInner(1)
      .paddingOuter(2)
      .round(true)
      .tile(treemapSquarify);

    const hier = hierarchy(root).sum(d => (d as TreeNode & { value?: number }).value ?? 0);
    layout(hier);
    return { hier, ctColor };
  }, [entries, CT_PALETTE]);

  const { hier, ctColor } = nodes;
  const groups = hier.children ?? [];

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...SEC_LBL, marginBottom: 4 }}>Datasets</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", borderRadius: 4, overflow: "hidden" }}>
        {groups.map((g) => {
          const gNode = g as typeof g & { x0: number; y0: number; x1: number; y1: number };
          return (
            <g key={g.data.name}>
              <rect x={gNode.x0} y={gNode.y0} width={gNode.x1 - gNode.x0} height={gNode.y1 - gNode.y0}
                fill={CARD_BG} stroke={PANEL_BORDER} strokeWidth={0.5} rx={2} />
              <text x={gNode.x0 + 3} y={gNode.y0 + 10} fontSize={7} fontFamily={FONT} fill={TEXT_BODY}
                style={{ pointerEvents: "none" }}>
                <title>{g.data.name}</title>
                {g.data.name.length > 18 ? g.data.name.slice(0, 16) + "…" : g.data.name}
              </text>
              {(g.children ?? []).map((leaf) => {
                const lNode = leaf as typeof leaf & { x0: number; y0: number; x1: number; y1: number };
                const color = (leaf.data as TreeNode & { _color?: string })._color ?? TEXT_DIM;
                const w = lNode.x1 - lNode.x0;
                const h = lNode.y1 - lNode.y0;
                return (
                  <rect key={leaf.data.name} x={lNode.x0} y={lNode.y0} width={w} height={h}
                    fill={color} opacity={0.75} rx={1}>
                    <title>{leaf.data.name}: {(leaf.value ?? 0).toLocaleString()}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
