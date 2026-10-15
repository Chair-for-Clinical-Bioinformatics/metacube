import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { buildCubeCells, cellKey, computeDominance, availableAxisValues } from "./data/dataModel";
import type { CubeData, CubeCell, TreemapEntry, InnerCubeData, InfoEntry } from "./data/dataModel";
import type { AxisGroup } from "./data/config";
import { useStore } from "./hooks/useStore";
import { Scene, SceneHandle } from "./components/Scene";
import { Tooltip } from "./components/Tooltip";
import { ControlPanel } from "./components/ControlPanel";
import { DetailsPanel, FilterSummaryPanel } from "./components/DetailsPanel";
import { CameraPresets } from "./components/CameraPresets";
import { TreemapOverlay } from "./components/TreemapOverlay";
import { InnerCubeZoom } from "./components/InnerCubeZoom";
import { TrivialZoomPanel } from "./components/TrivialZoomPanel";
import { InfoPanel } from "./components/InfoPanel";
import { useTheme } from "./data/themeContext";
import type { ViewParams } from "./viewParams";
import type { ColorScaleType } from "./data/colors";
import { toggleSources, cellsWithSources, sourceTotals } from "./components/SourceCards";

const CUBE_SIZE = 3.8;
const GAP = 0.025;

function cellWorldPosition(
  cell: CubeCell,
  allXs: string[],
  allYs: string[],
  allZs: string[],
): [number, number, number] {
  const half = CUBE_SIZE / 2;
  const bandX = (CUBE_SIZE - GAP * (allXs.length + 1)) / allXs.length;
  const bandY = (CUBE_SIZE - GAP * (allYs.length + 1)) / allYs.length;
  const bandZ = (CUBE_SIZE - GAP * (allZs.length + 1)) / allZs.length;
  const xi = allXs.indexOf(cell.x);
  const yi = allYs.indexOf(cell.y);
  const zi = allZs.indexOf(cell.z);
  return [
    -half + GAP * (xi + 1) + bandX * xi + bandX / 2,
    -half + GAP * (yi + 1) + bandY * yi + bandY / 2,
    -half + GAP * (zi + 1) + bandZ * zi + bandZ / 2,
  ];
}

export default function App({ data, view = {} }: { data: CubeData; view?: ViewParams }) {
  const { config: baseConfig, records, xs, ys, zs, drilldown, treemap: cubeTreemap, info, infoBox, charts, cellBreakdown } = data;
  // Colour transform chosen in the legend (linear / √ / log); starts from the YAML's
  // color_scale and flows to every view through the effective config.
  const [colorScale, setColorScale] = useState<ColorScaleType>(baseConfig.colorScale ?? "linear");
  const config = useMemo(() => ({ ...baseConfig, colorScale }), [baseConfig, colorScale]);
  const { theme } = useTheme();
  const store = useStore();
  const sceneRef = useRef<SceneHandle>(null);

  const [activeCell, setActiveCell] = useState<CubeCell | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [hoveredStudy, setHoveredStudy] = useState<string | null>(null);
  const [zoomTarget, setZoomTarget] = useState<[number, number, number] | null>(null);
  const [zoomingBack, setZoomingBack] = useState(false);
  // Sources picked in the info box / treemap; their cube cells are highlighted.
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => new Set());

  const drilldownType = config.drilldown?.type;

  const buildGroups = (vals: string[], sep: string | undefined): AxisGroup[] | undefined => {
    if (!sep) return undefined;
    const groupMap = new Map<string, string[]>();
    for (const val of vals) {
      const sepIdx = val.indexOf(sep);
      const label = sepIdx > 0 ? val.slice(0, sepIdx) : val;
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(val);
    }
    if ([...groupMap.values()].every((members) => members.length === 1)) return undefined;
    return [...groupMap.entries()].map(([label, members]) => ({ label, members, separator: sep }));
  };

  const xGroups = useMemo(() => buildGroups(xs, config.axes.x.groupSeparator), [xs, config.axes.x.groupSeparator]);
  const yGroups = useMemo(() => buildGroups(ys, config.axes.y.groupSeparator), [ys, config.axes.y.groupSeparator]);
  const zGroups = useMemo(() => buildGroups(zs, config.axes.z.groupSeparator), [zs, config.axes.z.groupSeparator]);

  const totalSize = useMemo(() => records.reduce((s, r) => s + r.size, 0), [records]);

  const occupancy = useMemo(() => {
    const Cobs = new Set(records.map(r => `${r.x}|${r.y}|${r.z}`)).size;
    const Ctotal = xs.length * ys.length * zs.length;
    return Ctotal > 0 ? Cobs / Ctotal : 0;
  }, [records, xs, ys, zs]);

  const cubeCells = useMemo(() => buildCubeCells(records, config.colorAggregation), [records, config.colorAggregation]);
  const availableValues = useMemo(
    () => availableAxisValues(cubeCells, store.xFilter, store.yFilter, store.zFilter),
    [cubeCells, store.xFilter, store.yFilter, store.zFilter],
  );

  const hasActiveFilter = store.xFilter.size > 0 || store.yFilter.size > 0 || store.zFilter.size > 0;
  const filterTotal = useMemo(() => {
    if (!hasActiveFilter) return 0;
    return records.reduce((sum, r) => {
      const xm = store.xFilter.size === 0 || store.xFilter.has(r.x);
      const ym = store.yFilter.size === 0 || store.yFilter.has(r.y);
      const zm = store.zFilter.size === 0 || store.zFilter.has(r.z);
      return sum + (xm && ym && zm ? r.size : 0);
    }, 0);
  }, [hasActiveFilter, records, store.xFilter, store.yFilter, store.zFilter]);
  const maxColorValue = useMemo(() => {
    const cells = buildCubeCells(records, config.colorAggregation);
    if (config.hasColorValues) return Math.max(...cells.map(c => c.color ?? 0), 1);
    return Math.max(...cells.map(c => c.size), 1);
  }, [records, config.hasColorValues, config.colorAggregation]);

  const minColorValue = useMemo(() => {
    if (!config.hasColorValues) return 0;
    const cells = buildCubeCells(records, config.colorAggregation);
    return Math.min(...cells.map(c => c.color ?? 0), 0);
  }, [records, config.hasColorValues, config.colorAggregation]);

  const drilldownEntries = useMemo((): TreemapEntry[] | null => {
    if (!activeCell || !drilldown || drilldownType !== "treemap") return null;
    const key = cellKey(activeCell);
    const val = drilldown[key];
    if (!val || !Array.isArray(val)) return null;
    return val as TreemapEntry[];
  }, [activeCell, drilldown, drilldownType]);

  const innerData = useMemo((): InnerCubeData | null => {
    if (!activeCell || !drilldown || drilldownType !== "zoom") return null;
    const drillAxes = config.drilldown?.axes ?? {};
    // Key = outer values of replaced axes only, joined by "|"
    const keyParts: string[] = [];
    if (drillAxes.x) keyParts.push(activeCell.x);
    if (drillAxes.y) keyParts.push(activeCell.y);
    if (drillAxes.z) keyParts.push(activeCell.z);
    if (keyParts.length === 0) return null;
    const val = drilldown[keyParts.join("|")];
    if (!val || Array.isArray(val)) return null;
    return val as InnerCubeData;
  }, [activeCell, drilldown, drilldownType, config.drilldown?.axes]);

  const zoomTreemapEntries = useMemo(() => {
    if (!activeCell || !cubeTreemap || drilldownType !== "zoom") return null;
    return cubeTreemap[cellKey(activeCell)] ?? null;
  }, [activeCell, cubeTreemap, drilldownType]);

  // Source-concentration measure D for the hovered cell, shown in the tooltip.
  // treemap mode reads the cell's treemap drilldown; zoom mode reads the
  // treemap panel data keyed on the same cell.
  const hoveredDominance = useMemo(() => {
    const c = store.hoveredCell;
    if (!c) return null;
    const key = cellKey(c);
    let entries: TreemapEntry[] | null | undefined = null;
    if (drilldownType === "treemap") {
      const val = drilldown?.[key];
      entries = Array.isArray(val) ? (val as TreemapEntry[]) : null;
    } else if (drilldownType === "zoom") {
      entries = cubeTreemap?.[key] ?? null;
    }
    return computeDominance(entries, config.concentrationThresholds);
  }, [store.hoveredCell, drilldownType, drilldown, cubeTreemap, config.concentrationThresholds]);

  // Per-cell source lists: the treemap drilldown (treemap mode) or the treemap
  // panel data (zoom mode). Used to find the cells containing selected sources.
  const cellSources = useMemo((): Record<string, TreemapEntry[]> | undefined => {
    if (drilldownType === "treemap" && drilldown) {
      const out: Record<string, TreemapEntry[]> = {};
      for (const [k, v] of Object.entries(drilldown)) if (Array.isArray(v)) out[k] = v as TreemapEntry[];
      return out;
    }
    return cubeTreemap ?? undefined;
  }, [drilldownType, drilldown, cubeTreemap]);
  const sourceHighlightCells = useMemo(() => cellsWithSources(cellSources, selectedSources), [cellSources, selectedSources]);
  const handleSourcesToggle = useCallback((ids: string[]) => setSelectedSources(prev => toggleSources(prev, ids)), []);
  const selectedCellSourceSizes = useMemo(
    () => (store.selectedCell ? sourceTotals(cellSources?.[cellKey(store.selectedCell)]) : undefined),
    [store.selectedCell, cellSources],
  );

  const infoEntries = useMemo(() => {
    if (!activeCell || !info) return null;
    return info[cellKey(activeCell)] ?? null;
  }, [activeCell, info]);

  const infoBoxEntries = useMemo(() => {
    if (!store.selectedCell || !infoBox) return null;
    return infoBox[cellKey(store.selectedCell)] ?? null;
  }, [store.selectedCell, infoBox]);

  // Map dataset key → human-readable title, harvested from all info entries.
  // Used by the tooltip to show titles instead of raw dataset keys on hover.
  const datasetTitles = useMemo(() => {
    const map: Record<string, string> = {};
    const collect = (rec?: Record<string, InfoEntry[]>) => {
      if (!rec) return;
      for (const entries of Object.values(rec)) {
        for (const e of entries) {
          if (e.dataset && e.title) map[e.dataset] = e.title;
        }
      }
    };
    collect(infoBox);
    collect(info);
    return map;
  }, [infoBox, info]);

  const replacedAxes = useMemo(
    () => (["x", "y", "z"] as const).filter(ax => !!config.drilldown?.axes?.[ax]),
    [config.drilldown?.axes],
  );

  const innerIsTrivial = useMemo(() => {
    if (!innerData || drilldownType !== "zoom") return false;
    const combos = replacedAxes.reduce(
      (p, ax) => p * innerData[`${ax}s` as "xs" | "ys" | "zs"].length, 1,
    );
    return combos < 2;
  }, [innerData, replacedAxes, drilldownType]);

  const trivialInnerCell = useMemo(() => {
    if (!innerIsTrivial || !innerData) return null;
    return { x: innerData.xs[0], y: innerData.ys[0], z: innerData.zs[0] };
  }, [innerIsTrivial, innerData]);

  const trivialInfoBoxEntries = useMemo(() => {
    if (!trivialInnerCell || !infoBox || !activeCell) return null;
    const key = `${activeCell.x}|${activeCell.y}|${activeCell.z}|${cellKey(trivialInnerCell)}`;
    return infoBox[key] ?? null;
  }, [trivialInnerCell, infoBox, activeCell]);

  const handleResetView = useCallback(() => {
    setShowOverlay(false);
    setActiveCell(null);
    setZoomTarget(null);
    setZoomingBack(true);
    setSelectedSources(new Set());
    store.setSelectedCell(null);
  }, [store.setSelectedCell]);

  const handleSetCamera = useCallback((pos: [number, number, number]) => {
    sceneRef.current?.setCamera(pos);
    setZoomTarget(null);
    setShowOverlay(false);
    setZoomingBack(false);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedSources(new Set());
    setShowOverlay(false);
    setActiveCell(null);
    setZoomTarget(null);
    setZoomingBack(true);
    store.setSelectedCell(null);
  }, [store.setSelectedCell]);

  const handleSelect = useCallback((cell: CubeCell | null) => {
    if (zoomingBack) return;
    store.setSelectedCell(cell);
    if (cell) {
      setActiveCell(cell);
      setZoomingBack(false);
      setZoomTarget(null);
      // Zoom mode: open full-screen inner cube immediately
      // Treemap/none: open floating overlay immediately (no camera animation)
      setShowOverlay(true);
    } else {
      setZoomTarget(null);
      setShowOverlay(false);
      setActiveCell(null);
    }
  }, [store.setSelectedCell, zoomingBack]);

  // Deep link (?x=&y=&z=): select that cell once on mount, as if clicked.
  const didPreselect = useRef(false);
  useEffect(() => {
    if (didPreselect.current || !view.cell) return;
    didPreselect.current = true;
    const { x, y, z } = view.cell;
    const cell = buildCubeCells(records, config.colorAggregation).find(c => c.x === x && c.y === y && c.z === z);
    if (cell) handleSelect(cell);
    else console.warn(`No cube cell for x="${x}" y="${y}" z="${z}"`);
  }, [view.cell, records, config.colorAggregation, handleSelect]);

  const handleZoomComplete = useCallback(() => setShowOverlay(true), []);

  const handleCloseOverlay = useCallback(() => {
    setShowOverlay(false);
    setActiveCell(null);
    setZoomTarget(null);
    if (drilldownType === "zoom") setZoomingBack(true);
    store.setSelectedCell(null);
  }, [store.setSelectedCell, drilldownType]);

  const handleZoomBackDone = useCallback(() => setZoomingBack(false), []);

  return (
    <>
      <Scene
        ref={sceneRef}
        records={records}
        scaleMode={store.scaleMode}
        sortMode={store.sortMode}
        config={config}
        cellOpacity={store.cellOpacity}
        uniformCellColor={config.uniformCellColor}
        background={config.background}
        xFilter={store.xFilter}
        yFilter={store.yFilter}
        zFilter={store.zFilter}
        hoveredCell={store.hoveredCell}
        selectedCell={store.selectedCell}
        selectedCells={sourceHighlightCells}
        onHover={store.setHoveredCell}
        onSelect={handleSelect}
        zoomTarget={zoomTarget}
        onZoomComplete={handleZoomComplete}
        zoomingBack={zoomingBack}
        onZoomBackDone={handleZoomBackDone}
        axisXs={xs}
        axisYs={ys}
        axisZs={zs}
        xGroups={xGroups}
        yGroups={yGroups}
        zGroups={zGroups}
        onToggleX={store.toggleX}
        onToggleY={store.toggleY}
        onToggleZ={store.toggleZ}
        cameraPosition={view.cameraPosition}
      />

      <Tooltip cell={store.hoveredCell} config={config} cellBreakdown={cellBreakdown} datasetTitles={datasetTitles} dominance={hoveredDominance} />

      {/* Title bar */}
      <div style={{
        position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
        zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        background: theme.panel_bg, border: `1px solid ${theme.panel_border}`, borderRadius: 8, padding: "6px 14px",
        boxShadow: "0 4px 18px rgba(0,0,0,0.35)", backdropFilter: "blur(10px)",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: theme.text }}>{config.title}</div>
        <div style={{ fontSize: 10, color: theme.text_muted }}>
          {records.length} records · {xs.length} × {ys.length} × {zs.length} · O = {(occupancy * 100).toFixed(1)}%
        </div>
      </div>

      {!(showOverlay && drilldownType === "zoom") && (
        <ControlPanel
          xs={xs} ys={ys} zs={zs}
          config={config}
          xGroups={xGroups}
          yGroups={yGroups}
          zGroups={zGroups}
          xFilter={store.xFilter}
          toggleX={store.toggleX}
          setXFilter={store.setXFilter}
          yFilter={store.yFilter}
          toggleY={store.toggleY}
          setYFilter={store.setYFilter}
          zFilter={store.zFilter}
          toggleZ={store.toggleZ}
          setZFilter={store.setZFilter}
          cellOpacity={store.cellOpacity}
          setCellOpacity={store.setCellOpacity}
          maxColorValue={config.uniformCellColor ? 0 : maxColorValue}
          minColorValue={config.uniformCellColor ? 0 : minColorValue}
          onResetView={handleResetView}
          onClearSelection={handleClearSelection}
          available={availableValues}
          onColorScaleChange={setColorScale}
        />
      )}

      {!(showOverlay && drilldownType === "zoom") &&
       !(activeCell && infoEntries && drilldownType !== "zoom" && !drilldownEntries) && (
        <DetailsPanel
          cell={store.selectedCell}
          totalSize={totalSize}
          config={config}
          records={records}
          infoEntries={infoBoxEntries}
          charts={charts}
          treemapEntries={store.selectedCell ? (cubeTreemap?.[cellKey(store.selectedCell)] ?? null) : null}
          initialShowMatrix={view.slice}
          sourceNoun={config.drilldown?.categoryNoun}
          onSourcesToggle={cellSources ? handleSourcesToggle : undefined}
          selectedSources={selectedSources}
          sourceSizes={selectedCellSourceSizes}
          hoveredSource={hoveredStudy}
          onSourceHover={setHoveredStudy}
        />
      )}

      {!(showOverlay && drilldownType === "zoom") && hasActiveFilter && !store.selectedCell && (
        <FilterSummaryPanel
          config={config}
          xFilter={store.xFilter}
          yFilter={store.yFilter}
          zFilter={store.zFilter}
          total={filterTotal}
        />
      )}

      {!(showOverlay && drilldownType === "zoom") && <CameraPresets onSetCamera={handleSetCamera} />}

      {/* Treemap drilldown overlay */}
      {activeCell && drilldownType === "treemap" && (
        <TreemapOverlay
          cell={activeCell}
          entries={drilldownEntries}
          config={config}
          onClose={handleCloseOverlay}
          hoveredStudy={hoveredStudy}
          onStudyHover={setHoveredStudy}
          selectedSources={selectedSources}
          onSourcesToggle={handleSourcesToggle}
        />
      )}

      {/* Info panel overlay */}
      {activeCell && infoEntries && drilldownType !== "zoom" && !drilldownEntries && (
        <InfoPanel
          cell={activeCell}
          entries={infoEntries}
          config={config}
          onClose={handleCloseOverlay}
          hoveredStudy={hoveredStudy}
          onStudyHover={setHoveredStudy}
        />
      )}

      {/* Trivial zoom: only 1 sub-value for the replaced axis — show info panel directly */}
      {showOverlay && activeCell && drilldownType === "zoom" && innerIsTrivial && trivialInnerCell && (
        <TrivialZoomPanel
          outerCell={activeCell}
          innerCell={trivialInnerCell}
          zoomedAxes={replacedAxes}
          config={config}
          totalSize={totalSize}
          infoEntries={trivialInfoBoxEntries}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Full inner cube zoom */}
      {showOverlay && activeCell && drilldownType === "zoom" && innerData && !innerIsTrivial && (
        <InnerCubeZoom
          outerCell={activeCell}
          innerData={innerData}
          config={config}
          totalSize={totalSize}
          outerRecords={records}
          treemapEntries={zoomTreemapEntries}
          info={info}
          infoBox={infoBox}
          charts={charts}
          cellBreakdown={cellBreakdown}
          datasetTitles={datasetTitles}
          onClose={handleCloseOverlay}
          cameraPosition={view.cameraPosition}
          autoExpandSlice={view.slice}
          treemapSize={view.treemapSize}
          onColorScaleChange={setColorScale}
        />
      )}
    </>
  );
}
