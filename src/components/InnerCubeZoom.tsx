import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import type { CubeCell, CubeRecord, InnerCubeData, InfoEntry, ChartSpec } from "../data/dataModel";
import { buildCubeCells, cellKey, computeDominance, availableAxisValues } from "../data/dataModel";
import type { CubeConfig, AxisGroup } from "../data/config";
import { getColorScaleLegendStops, type ColorScaleType } from "../data/colors";
import { ColorLegend } from "./ColorLegend";
import { ThemeToggle } from "./ControlPanel";
import { toggleSources, cellsWithSources, sourceTotals } from "./SourceCards";
import {
  PAGE_GRADIENT, PANEL_BG, PANEL_BORDER, CARD_BG,
  TEXT, TEXT_BODY, TEXT_MUTED, TEXT_DIM,
  ACCENT, ACCENT_SOFT_BG, ACCENT_SOFT_BORDER,
} from "../data/theme";

import { Scene, SceneHandle } from "./Scene";
import { CameraPresets } from "./CameraPresets";
import { InfoPanel } from "./InfoPanel";
import { Tooltip } from "./Tooltip";
import { DetailsPanel } from "./DetailsPanel";
import { TreemapOverlay, TREEMAP_PANEL_H } from "./TreemapOverlay";
import type { TreemapEntry } from "../data/dataModel";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

interface InnerCubeZoomProps {
  outerCell: CubeCell;
  innerData: InnerCubeData;
  config: CubeConfig;
  totalSize: number;
  outerRecords: CubeRecord[];
  treemapEntries?: TreemapEntry[] | null;
  info?: Record<string, InfoEntry[]>;
  infoBox?: Record<string, InfoEntry[]>;
  charts?: Record<string, ChartSpec>;
  cellBreakdown?: Record<string, Record<string, number>>;
  datasetTitles?: Record<string, string>;
  onClose: () => void;
  hideSidePanels?: boolean;
  /** Initial camera position (used by figure capture for tighter framing). */
  cameraPosition?: [number, number, number];
  /** Open the DetailsPanel 2D-slice matrix on mount (figure capture). */
  autoExpandSlice?: boolean;
  /** Figure capture of a single DetailsPanel section, rendered standalone. */
  figureCapture?: "slice" | "infobox";
  /** Initial size of the treemap panel (bottom right); default 520×340. */
  treemapSize?: { w: number; h: number };
  /** Switch the colour transform from the legend (shared with the outer cube). */
  onColorScaleChange?: (s: ColorScaleType) => void;
  /** Figure capture of the inner cube with its explanatory panels only: a compact
   *  legend box (with O), the details panel (info box, no slice) and, optionally,
   *  the treemap panel — no filters, camera buttons, breadcrumb or tooltip. */
  figurePanels?: { treemap: boolean };
  /** WebGL pixel ratio for the inner scene (figure capture: full device ratio). */
  dpr?: number;
}

// ─── Left panel (mirrors ControlPanel) ──────────────────────────────────────

const LP: React.CSSProperties = {
  position: "absolute", top: 52, left: 12, width: 210,
  background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`,
  borderRadius: 10, padding: "12px 14px", fontSize: 12, color: TEXT_BODY,
  zIndex: 310, maxHeight: "calc(100vh - 70px)", overflowY: "auto",
  backdropFilter: "blur(12px)", boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
  fontFamily: FONT,
};

const SEC: React.CSSProperties = { marginBottom: 12 };
const LBL: React.CSSProperties = {
  fontWeight: 600, fontSize: 10, textTransform: "uppercase",
  letterSpacing: 0.5, color: TEXT_MUTED,
};
const ABN: React.CSSProperties = {
  padding: "1px 5px", fontSize: 9, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: 0.3, background: "transparent", border: `1px solid ${PANEL_BORDER}`,
  color: TEXT_MUTED, borderRadius: 3, cursor: "pointer", lineHeight: 1.4,
};

function DescTooltip({ text, anchor = "bottom" }: { text: string; anchor?: "bottom" | "top" }) {
  return (
    <div style={{
      position: "absolute",
      ...(anchor === "bottom"
        ? { bottom: "calc(100% + 5px)", left: 0 }
        : { top: "calc(100% + 5px)", left: 0 }),
      background: "#1f2937", color: "#f9fafb",
      padding: "9px 12px", borderRadius: 7,
      fontSize: 11, whiteSpace: "pre-line", minWidth: 160, maxWidth: 260,
      pointerEvents: "none", zIndex: 600,
      boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
      fontFamily: FONT, lineHeight: 1.65, fontWeight: 400,
    }}>
      {text}
    </div>
  );
}

function CheckItem({ label, checked, onChange, available = true }: { label: string; checked: boolean; onChange: () => void; available?: boolean }) {
  const short = label.length > 24 ? label.slice(0, 22) + "…" : label;
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 5, padding: "1px 0", cursor: "pointer", fontSize: 11,
      color: checked ? TEXT : available ? TEXT_BODY : TEXT_DIM,
      fontWeight: checked ? 600 : 400,
      opacity: checked || available ? 1 : 0.45,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span title={label}>{short}</span>
    </label>
  );
}

function FilterSection({
  title, items, filter, toggle, setFilter, groups, description, available,
}: {
  title: string; items: string[]; filter: Set<string>;
  available?: Set<string>;
  toggle: (v: string) => void; setFilter: (s: Set<string>) => void;
  groups?: AxisGroup[];
  description?: string;
}) {
  const [show, setShow] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <div style={SEC}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 3 }}>
          <span
            style={{ ...LBL, cursor: description ? "pointer" : undefined, color: pinned && description ? ACCENT : TEXT_MUTED }}
            onMouseEnter={description ? () => setShow(true) : undefined}
            onMouseLeave={description ? () => setShow(false) : undefined}
            onClick={description ? () => setPinned(p => !p) : undefined}
          >{title}</span>
          {description && (
            <span style={{ fontSize: 8, position: "relative", top: -3, color: pinned ? ACCENT : TEXT_DIM, fontWeight: 700, lineHeight: 1, pointerEvents: "none" }}>?</span>
          )}
          {description && (show || pinned) && <DescTooltip text={description} anchor="top" />}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <button style={ABN} onClick={() => setFilter(new Set(items))}>all</button>
          <button style={ABN} onClick={() => setFilter(new Set())}>none</button>
        </div>
      </div>
      {groups ? (
        groups.map((group) => {
          const allOn = group.members.every(m => filter.has(m));
          const anyOn = group.members.some(m => filter.has(m));
          return (
            <div key={group.label}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 0 1px", cursor: "pointer", fontSize: 11, fontWeight: 700, color: anyOn ? TEXT : TEXT_MUTED }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = anyOn && !allOn; }}
                  onChange={() => {
                    const next = new Set(filter);
                    if (allOn) group.members.forEach(m => next.delete(m));
                    else group.members.forEach(m => next.add(m));
                    setFilter(next);
                  }}
                />
                {group.label}
              </label>
              {group.members.map(m => {
                const sub = m.slice(group.label.length + group.separator.length);
                return <CheckItem key={m} label={sub} checked={filter.has(m)} onChange={() => toggle(m)} available={!available || available.has(m)} />;
              })}
            </div>
          );
        })
      ) : (
        items.map((v) => (
          <CheckItem key={v} label={v} checked={filter.has(v)} onChange={() => toggle(v)} available={!available || available.has(v)} />
        ))
      )}
    </div>
  );
}

function LeftPanel({
  innerData, config, outerCell, zoomedAxes, maxColorValue, minColorValue,
  xFilter, yFilter, zFilter,
  toggleX, toggleY, toggleZ,
  setXFilter, setYFilter, setZFilter,
  xGroups, yGroups, zGroups,
  cellOpacity, setCellOpacity,
  onReset, onClear, available, onColorScaleChange,
}: {
  innerData: InnerCubeData;
  config: CubeConfig;
  outerCell: CubeCell;
  zoomedAxes: ("x" | "y" | "z")[];
  maxColorValue: number;
  minColorValue: number;
  xFilter: Set<string>; yFilter: Set<string>; zFilter: Set<string>;
  toggleX: (v: string) => void; toggleY: (v: string) => void; toggleZ: (v: string) => void;
  setXFilter: (s: Set<string>) => void; setYFilter: (s: Set<string>) => void; setZFilter: (s: Set<string>) => void;
  xGroups?: AxisGroup[]; yGroups?: AxisGroup[]; zGroups?: AxisGroup[];
  cellOpacity: number; setCellOpacity: (v: number) => void;
  onReset: () => void; onClear: () => void;
  available?: { x: Set<string>; y: Set<string>; z: Set<string> };
  onColorScaleChange?: (s: ColorScaleType) => void;
}) {
  const legendStops = maxColorValue > 0
    ? getColorScaleLegendStops(maxColorValue, minColorValue, config.colorPalette, config.colorScale)
    : null;

  return (
    <div data-testid="control-panel" style={LP}>
      <ThemeToggle />
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: TEXT }}>
        {zoomedAxes.map((ax, i) => (
          <span key={ax}>{i > 0 ? " · " : ""}{config.axes[ax].label}</span>
        ))}
      </div>

      {(config.accent_datasets || config.ghost_datasets) && (
        <div style={SEC}>
          <span style={LBL}>Cell type</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {(legendStops || config.uniformCellColor) && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {legendStops ? (
                  <div style={{ display: "flex", width: 22, height: 12, borderRadius: 2, overflow: "hidden", flexShrink: 0, border: "1px solid #e5e7eb" }}>
                    {legendStops.map((s, i) => <div key={i} style={{ flex: 1, background: s.color }} />)}
                  </div>
                ) : (
                  <div style={{ width: 22, height: 12, borderRadius: 2, background: config.uniformCellColor, flexShrink: 0, border: "1px solid #e5e7eb" }} />
                )}
                <span style={{ fontSize: 12, color: "#374151" }}>Primary tissue</span>
              </div>
            )}
            {config.accent_datasets && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 12, borderRadius: 2, background: config.accent_color ?? "#f59e0b", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                <span style={{ fontSize: 12, color: "#374151" }}>{config.accent_label ?? config.accent_datasets}</span>
              </div>
            )}
            {config.ghost_datasets && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 12, borderRadius: 2, background: "transparent", flexShrink: 0, border: "1.5px solid #9ca3af", boxSizing: "border-box" }} />
                <span style={{ fontSize: 12, color: "#374151" }}>Planned</span>
              </div>
            )}
          </div>
        </div>
      )}

      {legendStops && (
        <ColorLegend
          config={config} minValue={minColorValue} maxValue={maxColorValue}
          onScaleChange={onColorScaleChange}
          scope={`within ${zoomedAxes.map(ax => outerCell[ax]).join(" · ")}`}
        />
      )}

      <FilterSection
        title={`${config.axes.x.label} (X)`}
        items={innerData.xs}
        available={available?.x}
        filter={xFilter}
        toggle={toggleX}
        setFilter={setXFilter}
        groups={xGroups}
        description={config.axes.x.description}
      />
      <FilterSection
        title={`${config.axes.y.label} (Y)`}
        items={innerData.ys}
        available={available?.y}
        filter={yFilter}
        toggle={toggleY}
        setFilter={setYFilter}
        groups={yGroups}
        description={config.axes.y.description}
      />
      <FilterSection
        title={`${config.axes.z.label} (Z)`}
        items={innerData.zs}
        available={available?.z}
        filter={zFilter}
        toggle={toggleZ}
        groups={zGroups}
        setFilter={setZFilter}
        description={config.axes.z.description}
      />

      <div style={SEC}>
        <span style={LBL}>Cell Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={cellOpacity}
          onChange={(e) => setCellOpacity(Number(e.target.value))}
          style={{ width: "100%", accentColor: ACCENT }} />
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={onReset} style={{
          flex: 1, padding: "5px 8px", fontSize: 11,
          background: ACCENT_SOFT_BG, border: `1px solid ${ACCENT_SOFT_BORDER}`, color: ACCENT,
          borderRadius: 5, cursor: "pointer",
        }}>Reset View</button>
        <button onClick={onClear} style={{
          flex: 1, padding: "5px 8px", fontSize: 11,
          background: CARD_BG, border: `1px solid ${PANEL_BORDER}`, color: TEXT_MUTED,
          borderRadius: 5, cursor: "pointer",
        }}>Clear Sel.</button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InnerCubeZoom({ outerCell, innerData, config, totalSize, outerRecords, treemapEntries, info, infoBox, charts, cellBreakdown, datasetTitles, onClose, hideSidePanels = false, cameraPosition, autoExpandSlice = false, figureCapture, treemapSize, onColorScaleChange, figurePanels, dpr }: InnerCubeZoomProps) {
  // In figure-capture mode we render only the requested DetailsPanel section,
  // suppressing the breadcrumb and all other side panels.
  const minimalCapture = !!figureCapture;
  const sceneRef = useRef<SceneHandle>(null);

  const [selectedCell, setSelectedCell]     = useState<CubeCell | null>(null);
  const [hoveredCell, setHoveredCell]       = useState<CubeCell | null>(null);
  const [showInfo, setShowInfo]             = useState(false);
  const [showTreemap, setShowTreemap]       = useState(true);
  const [hoveredStudy, setHoveredStudy]     = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => new Set());

  // Info box / tooltip breakdowns are keyed "outer x|y|z|inner x|y|z", where the
  // outer part holds each record's own outer values. Axes the zoom does not replace
  // carry the same column inside and outside, so their outer value is the inner
  // cell's own value (e.g. a zoom into human blood still shows mouse cells).
  const outerKeyFor = useCallback((c: CubeCell) => {
    const drillAxes = config.drilldown?.axes ?? {};
    return (["x", "y", "z"] as const).map(ax => (drillAxes[ax] ? outerCell[ax] : c[ax])).join("|");
  }, [config.drilldown?.axes, outerCell]);

  // Clicking an info-box card or a treemap tile toggles its sources.
  const handleSourcesToggle = useCallback((ids: string[]) => {
    setSelectedSources(prev => toggleSources(prev, ids));
  }, []);

  // Inner cells containing any selected source — fed into Scene as selectedCells.
  // Uses the per-inner-cell treemaps (they list every source in a cell), falling
  // back to the records' datasets column for configs without a treemap.
  const sourceHighlightCells = useMemo(() => {
    if (selectedSources.size === 0) return undefined;
    const fromTreemap = cellsWithSources(innerData.treemap, selectedSources);
    if (fromTreemap) return fromTreemap;
    const result = new Set<string>();
    for (const r of innerData.records) {
      if (r.datasets.some(d => selectedSources.has(d))) result.add(`${r.x}|${r.y}|${r.z}`);
    }
    return result.size > 0 ? result : undefined;
  }, [selectedSources, innerData.treemap, innerData.records]);

  // Empty set = no filter (all cells at base brightness) — matches outer cube semantics
  const [xFilter, setXFilter] = useState<Set<string>>(() => new Set());
  const [yFilter, setYFilter] = useState<Set<string>>(() => new Set());
  const [zFilter, setZFilter] = useState<Set<string>>(() => new Set());

  const [cellOpacity, setCellOpacity] = useState(0.88);

  const toggleX = useCallback((v: string) => setXFilter(f => { const n = new Set(f); n.has(v) ? n.delete(v) : n.add(v); return n; }), []);
  const toggleY = useCallback((v: string) => setYFilter(f => { const n = new Set(f); n.has(v) ? n.delete(v) : n.add(v); return n; }), []);
  const toggleZ = useCallback((v: string) => setZFilter(f => { const n = new Set(f); n.has(v) ? n.delete(v) : n.add(v); return n; }), []);

  const innerHasFilter = xFilter.size > 0 || yFilter.size > 0 || zFilter.size > 0;
  const innerFilterTotal = useMemo(() => {
    if (!innerHasFilter) return 0;
    return innerData.records.reduce((sum, r) => {
      const xm = xFilter.size === 0 || xFilter.has(r.x);
      const ym = yFilter.size === 0 || yFilter.has(r.y);
      const zm = zFilter.size === 0 || zFilter.has(r.z);
      return sum + (xm && ym && zm ? r.size : 0);
    }, 0);
  }, [innerHasFilter, innerData.records, xFilter, yFilter, zFilter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const buildInnerGroups = (vals: string[], sep: string | undefined) => {
    if (!sep) return undefined;
    const map = new Map<string, string[]>();
    for (const v of vals) {
      const idx = v.indexOf(sep);
      const lbl = idx > 0 ? v.slice(0, idx) : v;
      if (!map.has(lbl)) map.set(lbl, []);
      map.get(lbl)!.push(v);
    }
    if ([...map.values()].every(m => m.length === 1)) return undefined;
    return [...map.entries()].map(([label, members]) => ({ label, members, separator: sep }));
  };

  const innerHasColorValues = innerData.records.some(r => r.color !== undefined);

  // Each axis falls back to the outer axis if not redefined in drilldown.axes
  const innerConfig: CubeConfig = {
    ...config,
    hasColorValues: innerHasColorValues,
    drilldown: undefined,
    axisColors: config.drilldown?.axisColors,
    axes: {
      x: config.drilldown?.axes?.x ?? config.axes.x,
      y: config.drilldown?.axes?.y ?? config.axes.y,
      z: config.drilldown?.axes?.z ?? config.axes.z,
    },
  };

  // Treemap entries for an inner cell — group its records by dataset key, sum size.
  const innerCellEntries = useCallback((cell: CubeCell | null): TreemapEntry[] | null => {
    if (!cell) return null;
    const filtered = innerData.records.filter(
      r => r.x === cell.x && r.y === cell.y && r.z === cell.z
    );
    if (filtered.length === 0) return null;
    const byDataset = new Map<string, number>();
    for (const r of filtered) {
      const d = r.datasets[0];
      if (d) byDataset.set(d, (byDataset.get(d) ?? 0) + r.size);
    }
    return [...byDataset.entries()].map(([d, n]) => ({ d, c: d, n }));
  }, [innerData.records]);

  // Treemap entries for an inner cell: prefer the per-inner-cell treemap built
  // by the transform (real dataset_title × cell_type), falling back to dataset
  // grouping of the inner records for cubes configured with a datasets_column.
  const cellTreemapEntries = useCallback(
    (cell: CubeCell | null): TreemapEntry[] | null =>
      cell ? (innerData.treemap?.[cellKey(cell)] ?? innerCellEntries(cell)) : null,
    [innerData.treemap, innerCellEntries],
  );

  // DetailsPanel keeps its original dataset-based mini-treemap (unchanged).
  const selectedCellTreemapEntries = useMemo(
    () => innerCellEntries(selectedCell),
    [innerCellEntries, selectedCell],
  );

  // Concentration measure D for the hovered inner cell, shown in its tooltip.
  // Per-cell, so sibling inner cells (e.g. 10x v3 vs v1) get distinct values —
  // and these differ from the outer cell that was zoomed into.
  const hoveredDominance = useMemo(
    () => computeDominance(cellTreemapEntries(hoveredCell), config.concentrationThresholds),
    [cellTreemapEntries, hoveredCell, config.concentrationThresholds],
  );

  // The page-level treemap panel defaults to the zoomed-into outer cell and
  // switches to a single selected inner cell's treemap. Selecting several cells
  // (dataset highlight, no single selection) falls back to the default.
  const panelCell = selectedCell ?? outerCell;
  const panelTreemapEntries = useMemo(
    () => (selectedCell ? (cellTreemapEntries(selectedCell) ?? treemapEntries ?? null) : (treemapEntries ?? null)),
    [selectedCell, cellTreemapEntries, treemapEntries],
  );

  // Cells per source in the panel's scope, for sorting the info box.
  const panelSourceSizes = useMemo(() => sourceTotals(panelTreemapEntries), [panelTreemapEntries]);

  const innerXGroups = useMemo(() => buildInnerGroups(innerData.xs, innerConfig.axes.x.groupSeparator), [innerData.xs, innerConfig.axes.x.groupSeparator]);
  const innerYGroups = useMemo(() => buildInnerGroups(innerData.ys, innerConfig.axes.y.groupSeparator), [innerData.ys, innerConfig.axes.y.groupSeparator]);
  const innerZGroups = useMemo(() => buildInnerGroups(innerData.zs, innerConfig.axes.z.groupSeparator), [innerData.zs, innerConfig.axes.z.groupSeparator]);

  const innerOccupancy = useMemo(() => {
    const Cobs = new Set(innerData.records.map(r => `${r.x}|${r.y}|${r.z}`)).size;
    const Ctotal = innerData.xs.length * innerData.ys.length * innerData.zs.length;
    return Ctotal > 0 ? Cobs / Ctotal : 0;
  }, [innerData.records, innerData.xs, innerData.ys, innerData.zs]);

  const infoEntries = useMemo(() => {
    if (!selectedCell || !info) return null;
    return info[cellKey(selectedCell)] ?? null;
  }, [selectedCell, info]);

  const infoBoxEntries = useMemo(() => {
    if (!selectedCell || !infoBox) return null;
    const key = `${outerKeyFor(selectedCell)}|${cellKey(selectedCell)}`;
    return infoBox[key] ?? null;
  }, [selectedCell, infoBox, outerKeyFor]);

  // All unique dataset entries across every inner cell for this outer cell — shown
  // in the panel immediately when the zoom opens, before any inner cell is selected.
  const allInnerInfoEntries = useMemo(() => {
    if (!infoBox) return null;
    const prefix = `${outerCell.x}|${outerCell.y}|${outerCell.z}|`;
    const seen = new Set<string>();
    const entries: typeof infoBox[string] = [];
    for (const [key, keyEntries] of Object.entries(infoBox)) {
      if (!key.startsWith(prefix)) continue;
      for (const entry of keyEntries) {
        const fp = JSON.stringify(entry);
        if (!seen.has(fp)) { seen.add(fp); entries.push(entry); }
      }
    }
    return entries.length > 0 ? entries : null;
  }, [infoBox, outerCell]);

  const handleSelect = useCallback((cell: CubeCell | null) => {
    setSelectedCell(cell);
    setShowInfo(!!cell && !!(info?.[cellKey(cell)]));
  }, [info]);

  const handleCloseInfo = useCallback(() => {
    setShowInfo(false);
    setSelectedCell(null);
  }, []);

  const handleReset = useCallback(() => {
    sceneRef.current?.setCamera([4.5, 3.5, 4.5]);
  }, []);

  const handleClear = useCallback(() => {
    setSelectedCell(null);
    setXFilter(new Set());
    setYFilter(new Set());
    setZFilter(new Set());
  }, []);

  const handleSetCamera = useCallback((pos: [number, number, number]) => {
    sceneRef.current?.setCamera(pos);
  }, []);

  const zoomedAxes = (["x", "y", "z"] as const).filter(ax => config.drilldown?.axes?.[ax]);

  const innerAvailable = useMemo(
    () => availableAxisValues(innerData.records, xFilter, yFilter, zFilter),
    [innerData.records, xFilter, yFilter, zFilter],
  );
  const innerCells = useMemo(() => buildCubeCells(innerData.records, config.colorAggregation), [innerData.records, config.colorAggregation]);
  const maxColorValue = useMemo(
    () => Math.max(...innerCells.map(c => c.color ?? 0), 1),
    [innerCells],
  );
  const minColorValue = useMemo(
    () => Math.min(...innerCells.map(c => c.color ?? 0), 0),
    [innerCells],
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: innerConfig.background ?? PAGE_GRADIENT,
      fontFamily: FONT,
    }}>
      {/* Centered breadcrumb bar (matches cxg_paperready layout) */}
      {!minimalCapture && !hideSidePanels && !figurePanels && <div data-testid="zoom-header" style={{
        position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
        zIndex: 310, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
        background: PANEL_BG, borderRadius: 8, border: `1px solid ${PANEL_BORDER}`,
        backdropFilter: "blur(10px)",
        padding: "6px 12px", boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        fontSize: 12, color: TEXT_MUTED,
      }}>
        {/* Row 1: navigation + outer cell context */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} style={{
            background: "none", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5,
            padding: "3px 10px", fontSize: 12, cursor: "pointer", color: TEXT_BODY,
          }}>←</button>
          <span>
            {/* Only the axes the drilldown zooms into — a single-axis zoom
                (e.g. census z=Organ) shows just that axis's outer value. */}
            {zoomedAxes.map((ax, i) => (
              <span key={ax}>
                {i > 0 && <span style={{ color: PANEL_BORDER, margin: "0 4px" }}>·</span>}
                <strong style={{ color: TEXT }}>{outerCell[ax]}</strong>
              </span>
            ))}
          </span>
          <button onClick={onClose} style={{
            background: "none", border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 5, padding: "3px 10px", fontSize: 12, cursor: "pointer", color: TEXT_BODY,
          }}>×</button>
        </div>
        {/* Row 2: inner cube dimensions + occupancy */}
        <div style={{ fontSize: 11, color: TEXT_DIM }}>
          {innerData.xs.length} × {innerData.ys.length} × {innerData.zs.length}
          {" · "}O = {(innerOccupancy * 100).toFixed(1)}%
        </div>
      </div>}

      {/* 3D canvas — full screen */}
      <Scene
        ref={sceneRef}
        records={innerData.records}
        scaleMode="sqrt"
        sortMode="size"
        config={innerConfig}
        cellOpacity={cellOpacity}
        cameraPosition={cameraPosition}
        dpr={dpr}
        uniformCellColor={innerConfig.uniformCellColor}
        background={innerConfig.background}
        xFilter={xFilter}
        yFilter={yFilter}
        zFilter={zFilter}
        hoveredCell={hoveredCell}
        selectedCell={selectedCell}
        selectedCells={sourceHighlightCells}
        onHover={setHoveredCell}
        onSelect={handleSelect}
        axisXs={innerData.xs}
        axisYs={innerData.ys}
        axisZs={innerData.zs}
        xGroups={innerXGroups}
        yGroups={innerYGroups}
        zGroups={innerZGroups}
        onToggleX={toggleX}
        onToggleY={toggleY}
        onToggleZ={toggleZ}
      />

      {!hideSidePanels && !minimalCapture && !figurePanels && <CameraPresets onSetCamera={handleSetCamera} />}
      {!hideSidePanels && !minimalCapture && !figurePanels && <Tooltip cell={hoveredCell} config={innerConfig} cellBreakdown={cellBreakdown} outerKeyFor={outerKeyFor} datasetTitles={datasetTitles} dominance={hoveredDominance} />}

      {figurePanels && (
        <div data-testid="figure-legend" style={{ ...LP, maxHeight: undefined, overflowY: "visible", top: 12, width: 230 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: TEXT }}>
            {[outerCell.x, outerCell.y, outerCell.z].join(" · ")}
          </div>
          <div style={{ fontSize: 10.5, color: TEXT_MUTED, marginBottom: 6 }}>
            {(["x", "y", "z"] as const).map(ax => innerConfig.axes[ax].label).join(" × ")}
            {" · "}O = {(innerOccupancy * 100).toFixed(1)}%
          </div>
          <ColorLegend
            config={innerConfig} minValue={minColorValue} maxValue={maxColorValue}
            scope={`within ${zoomedAxes.map(ax => outerCell[ax]).join(" · ")}`}
          />
        </div>
      )}

      {!hideSidePanels && !minimalCapture && !figurePanels && (
        <LeftPanel
          innerData={innerData}
          config={innerConfig}
          outerCell={outerCell}
          zoomedAxes={zoomedAxes}
          maxColorValue={innerConfig.uniformCellColor ? 0 : maxColorValue}
          minColorValue={innerConfig.uniformCellColor ? 0 : minColorValue}
          xFilter={xFilter} yFilter={yFilter} zFilter={zFilter}
          toggleX={toggleX} toggleY={toggleY} toggleZ={toggleZ}
          setXFilter={setXFilter} setYFilter={setYFilter} setZFilter={setZFilter}
          xGroups={innerXGroups} yGroups={innerYGroups} zGroups={innerZGroups}
          cellOpacity={cellOpacity} setCellOpacity={setCellOpacity}
          onReset={handleReset} onClear={handleClear}
          available={innerAvailable}
          onColorScaleChange={onColorScaleChange}
        />
      )}

      {!hideSidePanels && (
        <DetailsPanel
          cell={selectedCell}
          outerCell={outerCell}
          totalSize={totalSize}
          config={innerConfig}
          records={innerData.records}
          outerConfig={config}
          outerRecords={outerRecords}
          infoEntries={selectedCell ? infoBoxEntries : allInnerInfoEntries}
          zoomedAxes={zoomedAxes}
          charts={charts}
          treemapEntries={treemapEntries != null ? selectedCellTreemapEntries : null}
          filterSummary={innerHasFilter ? { xFilter, yFilter, zFilter, total: innerFilterTotal } : null}
          onSourcesToggle={handleSourcesToggle}
          selectedSources={selectedSources}
          sourceSizes={panelSourceSizes}
          hoveredSource={hoveredStudy}
          onSourceHover={setHoveredStudy}
          initialShowMatrix={autoExpandSlice}
          figureCapture={figureCapture}
          hideSlice={!!figurePanels}
          sourceNoun={config.drilldown?.categoryNoun}
          // Keep the details panel clear of the treemap panel in the bottom-right corner.
          bottomReserve={!minimalCapture && treemapEntries && showTreemap && (!figurePanels || figurePanels.treemap) ? (treemapSize?.h ?? TREEMAP_PANEL_H) + 24 : 0}
        />
      )}

      {!hideSidePanels && !minimalCapture && treemapEntries && showTreemap && (!figurePanels || figurePanels.treemap) && (
        <TreemapOverlay
          cell={panelCell}
          entries={panelTreemapEntries}
          config={innerConfig}
          categoryNoun={config.drilldown?.categoryNoun}
          onClose={() => setShowTreemap(false)}
          panel
          initialSize={treemapSize}
          hoveredStudy={hoveredStudy}
          onStudyHover={setHoveredStudy}
          selectedSources={selectedSources}
          onSourcesToggle={handleSourcesToggle}
        />
      )}

      {showInfo && selectedCell && infoEntries && !minimalCapture && (
        <InfoPanel
          cell={selectedCell}
          entries={infoEntries}
          config={innerConfig}
          onClose={handleCloseInfo}
          hoveredStudy={hoveredStudy}
          onStudyHover={setHoveredStudy}
        />
      )}
    </div>
  );
}
