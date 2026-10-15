/**
 * Chrome-free rendering for manuscript figure capture.
 * Activated when ?figure= is present in the URL.
 *
 * ?figure=A                         — outer cube + O metric, no selection
 * ?figure=B&x=VALUE&y=VALUE&z=VALUE — outer cube + drilldown open for that cell
 * ?figure=C&x=VALUE&y=VALUE&z=VALUE — outer cube + zoom panel open for that cell
 *
 * The drilldown type (treemap vs zoom) is read from the loaded __CUBE_DATA__ config,
 * so "B" triggers whatever drilldown the current dataset uses.
 */

import { useMemo, useState, useEffect } from "react";
import { buildCubeCells, cellKey } from "./data/dataModel";
import type { CubeData, CubeCell, TreemapEntry, InnerCubeData } from "./data/dataModel";
import { Scene } from "./components/Scene";
import { TreemapOverlay } from "./components/TreemapOverlay";
import { InnerCubeZoom } from "./components/InnerCubeZoom";
import type { ViewParams } from "./viewParams";
import { ColorLegend } from "./components/ColorLegend";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const EMPTY_SET = new Set<string>();

function OMetricOverlay({ cObs, cTotal, title, axisLabels, zIndex = 50, children }: {
  cObs: number; cTotal: number; title: string; axisLabels: string[]; zIndex?: number;
  /** Extra content below the O value (the colour legend in overview captures). */
  children?: React.ReactNode;
}) {
  const O = cObs / cTotal;
  return (
    <div style={{
      position: "absolute", top: 16, left: 16, zIndex,
      background: "rgba(255,255,255,0.93)", borderRadius: 8,
      padding: "10px 16px", fontFamily: FONT,
      boxShadow: "0 2px 12px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{title}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
        {axisLabels.join(" × ")}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#3b82f6", marginTop: 6 }}>
        O = {(O * 100).toFixed(1)}%
      </div>
      <div style={{ fontSize: 10, color: "#9ca3af" }}>
        {cObs} / {cTotal} intersections occupied
      </div>
      {children && <div style={{ marginTop: 10, width: 230 }}>{children}</div>}
    </div>
  );
}

// Fixed camera for captures — the "Default" preset the live playground starts
// from (shows the whole cube with axis labels). URL params (see viewParams.ts):
// ?camera=default|front|top|side picks the direction, ?zoom= scales the
// distance (<1 closer, >1 farther).
const DEFAULT_CAM: [number, number, number] = [6.0, 4.5, 6.0];

export default function FigureMode({ figureId, data, view = {} }: { figureId: string; data: CubeData; view?: ViewParams }) {
  const params = new URLSearchParams(window.location.search);
  const targetX = params.get("x");
  const targetY = params.get("y");
  const targetZ = params.get("z");

  const cameraPosition = view.cameraPosition ?? DEFAULT_CAM;

  const { config, records, xs, ys, zs, drilldown, treemap: cubeTreemap, info, infoBox } = data;
  const drilldownType = config.drilldown?.type;

  const cells = useMemo(() => buildCubeCells(records), []);
  const cObs = cells.length;
  const cTotal = xs.length * ys.length * zs.length;

  const [activeCell, setActiveCell] = useState<CubeCell | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (figureId === "A" || !targetX || !targetY || !targetZ) return;
    const cell = cells.find(c => c.x === targetX && c.y === targetY && c.z === targetZ);
    if (!cell) {
      console.warn(`FigureMode: no cell found for x="${targetX}" y="${targetY}" z="${targetZ}"`);
      return;
    }
    // inner needs extra time for the inner cube WebGL to initialise
    const delay = figureId.startsWith("inner") ? 1200 : 500;
    setTimeout(() => { setActiveCell(cell); setShowOverlay(true); }, delay);
  }, []);

  const drilldownEntries = useMemo((): TreemapEntry[] | null => {
    if (!activeCell || !drilldown || drilldownType !== "treemap") return null;
    const val = drilldown[cellKey(activeCell)];
    if (!val || !Array.isArray(val)) return null;
    return val as TreemapEntry[];
  }, [activeCell]);

  const innerData = useMemo((): InnerCubeData | null => {
    if (!activeCell || !drilldown || drilldownType !== "zoom") return null;
    const drillAxes = config.drilldown?.axes ?? {};
    const keyParts: string[] = [];
    if (drillAxes.x) keyParts.push(activeCell.x);
    if (drillAxes.y) keyParts.push(activeCell.y);
    if (drillAxes.z) keyParts.push(activeCell.z);
    if (keyParts.length === 0) return null;
    const val = drilldown[keyParts.join("|")];
    if (!val || Array.isArray(val)) return null;
    return val as InnerCubeData;
  }, [activeCell]);

  const zoomTreemapEntries = useMemo(() => {
    if (!activeCell || !cubeTreemap) return null;
    return cubeTreemap[cellKey(activeCell)] ?? null;
  }, [activeCell]);

  // Occupancy badge for the inner cube (mirrors the outer O-metric overlay).
  // Inner axis labels fall back to the outer axis when a drilldown axis is unset.
  const innerBadge = useMemo(() => {
    if (!innerData) return null;
    const obs = new Set(innerData.records.map(r => `${r.x}|${r.y}|${r.z}`)).size;
    const total = innerData.xs.length * innerData.ys.length * innerData.zs.length;
    const drillAxes = config.drilldown?.axes ?? {};
    const labels = [
      (drillAxes.x ?? config.axes.x).label,
      (drillAxes.y ?? config.axes.y).label,
      (drillAxes.z ?? config.axes.z).label,
    ];
    const title = activeCell ? [activeCell.x, activeCell.y, activeCell.z].join(" · ") : config.title;
    return { obs, total, labels, title };
  }, [innerData, activeCell]);

  const axisLabels = [config.axes.x.label, config.axes.y.label, config.axes.z.label];
  // Colour range of the outer cube, for the overview legend.
  const colorCells = useMemo(() => buildCubeCells(records, config.colorAggregation), []);
  const maxColor = Math.max(...colorCells.map(c => c.color ?? 0), 1);
  const minColor = Math.min(...colorCells.map(c => c.color ?? 0), 0);
  const showLegend = !!config.hasColorValues && !config.uniformCellColor;
  const totalSize = useMemo(() => records.reduce((s, r) => s + r.size, 0), []);

  return (
    // Full-viewport container so the Scene's height:100% resolves to the whole
    // window. Without it (a bare fragment under #root, which has no height) the
    // canvas collapses and the cube renders tiny — the inner cube avoids this
    // only because InnerCubeZoom wraps its own Scene in a fixed inset:0 div.
    <div style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", background: config.background ?? "#ffffff" }}>
      <Scene
        records={records}
        scaleMode="sqrt"
        sortMode="size"
        config={config}
        cellOpacity={1}
        background={config.background}
        cameraPosition={cameraPosition}
        dpr={window.devicePixelRatio}
        xFilter={EMPTY_SET}
        yFilter={EMPTY_SET}
        zFilter={EMPTY_SET}
        hoveredCell={null}
        selectedCell={activeCell}
        onHover={() => {}}
        onSelect={() => {}}
        axisXs={xs}
        axisYs={ys}
        axisZs={zs}
      />

      {/* Outer-cube O-metric badge — only for the overview. For drilldown
          captures (inner / slice / infobox / treemap) it would sit behind the
          captured panel, so it's suppressed. */}
      {figureId === "A" && (
        <OMetricOverlay
          cObs={cObs}
          cTotal={cTotal}
          title={config.title}
          axisLabels={axisLabels}
        >
          {showLegend && <ColorLegend config={config} minValue={minColor} maxValue={maxColor} />}
        </OMetricOverlay>
      )}

      {/* Inner-cube O-metric badge — same look as the overview, sits above the
          zoom overlay (zIndex 200) so it's visible in the inner-cube capture. */}
      {figureId === "inner" && innerBadge && (
        <OMetricOverlay
          cObs={innerBadge.obs}
          cTotal={innerBadge.total}
          title={innerBadge.title}
          axisLabels={innerBadge.labels}
          zIndex={400}
        />
      )}

      {showOverlay && activeCell && drilldownType === "treemap" && (figureId === "treemap" || figureId === "B") && (
        <TreemapOverlay
          cell={activeCell}
          entries={drilldownEntries}
          config={config}
          onClose={() => {}}
        />
      )}

      {showOverlay && activeCell && drilldownType === "zoom" && innerData && figureId !== "A" && (
        <InnerCubeZoom
          outerCell={activeCell}
          innerData={innerData}
          config={config}
          totalSize={totalSize}
          outerRecords={records}
          treemapEntries={zoomTreemapEntries}
          info={info}
          infoBox={infoBox}
          cameraPosition={cameraPosition}
            autoExpandSlice={figureId === "slice" || figureId === "B"}
          figureCapture={figureId === "slice" ? "slice" : figureId === "infobox" ? "infobox" : undefined}
          onClose={() => {}}
          hideSidePanels={figureId === "inner"}
          figurePanels={figureId === "inner_panels" ? { treemap: !!view.treemapSize } : undefined}
          treemapSize={view.treemapSize}
          dpr={window.devicePixelRatio}
        />
      )}
    </div>
  );
}
