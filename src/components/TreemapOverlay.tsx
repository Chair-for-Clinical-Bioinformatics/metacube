import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { treemap, hierarchy, treemapSquarify } from "d3-hierarchy";
import type { CubeCell, TreemapEntry } from "../data/dataModel";
import { computeDominance } from "../data/dataModel";
import type { CubeConfig } from "../data/config";
import {
  PANEL_BG,
  PANEL_BORDER,
  CARD_BG,
  CARD_BG_ACTIVE,
  BACKDROP,
  TEXT,
  TEXT_BODY,
  TEXT_MUTED,
  TEXT_DIM,
  ACCENT,
} from "../data/theme";
import { useTheme } from "../data/themeContext";

const PANEL_INIT_W = 520;
const PANEL_INIT_H = 340;
/** Default panel height, exported so neighbouring panels can stay clear of it. */
export const TREEMAP_PANEL_H = PANEL_INIT_H;
const PANEL_PAD_H = 132; // header + legend + padding
const PANEL_PAD_W = 44;

interface TreemapOverlayProps {
  cell: CubeCell;
  entries: TreemapEntry[] | null;
  config: CubeConfig;
  onClose: () => void;
  panel?: boolean;
  hoveredStudy?: string | null;
  onStudyHover?: (study: string | null) => void;
  /** Override for the category noun (e.g. "labs"). Needed in zoom mode where the
   * inner config drops `drilldown`; falls back to config.drilldown.categoryNoun. */
  categoryNoun?: string;
  /** Initial panel size (panel mode only). */
  initialSize?: { w: number; h: number };
  /** Highlighted source ids; clicking a tile group toggles its source. */
  selectedSources?: Set<string>;
  onSourcesToggle?: (ids: string[]) => void;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

type TreeNode = { name: string; children?: TreeNode[]; value?: number };

export function TreemapOverlay({ cell, entries, config, onClose, panel = false, hoveredStudy, onStudyHover, categoryNoun, initialSize, selectedSources, onSourcesToggle }: TreemapOverlayProps) {
  const { theme } = useTheme();
  const CT_PALETTE = theme.categorical;
  const [hoveredCT, setHoveredCT] = useState<string | null>(null);

  // Panel-mode position and size (ignored in overlay mode)
  // Spawn bottom-right, right edge aligned with DetailsPanel (right: 12)
  const initW = initialSize?.w ?? PANEL_INIT_W;
  const initH = initialSize?.h ?? PANEL_INIT_H;
  const [panelPos, setPanelPos] = useState(() => ({
    x: Math.max(10, window.innerWidth - 12 - initW),
    y: Math.max(10, window.innerHeight - initH - 12),
  }));
  const [panelSize, setPanelSize] = useState({ w: initW, h: initH });
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
          setPanelSize({ w: Math.max(300, origW + dx), h: Math.max(200, origH + dy) });
        } else if (corner === "bl") {
          const newW = Math.max(300, origW - dx);
          setPanelSize({ w: newW, h: Math.max(200, origH + dy) });
          setPanelPos({ x: origX + origW - newW, y: origY });
        } else if (corner === "tr") {
          const newH = Math.max(200, origH - dy);
          setPanelSize({ w: Math.max(300, origW + dx), h: newH });
          setPanelPos({ x: origX, y: origY + origH - newH });
        } else if (corner === "tl") {
          const newW = Math.max(300, origW - dx);
          const newH = Math.max(200, origH - dy);
          setPanelSize({ w: newW, h: newH });
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
    if (!panel) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y };
    e.preventDefault();
  }, [panel, panelPos]);

  const makeResizeStart = useCallback((corner: "br" | "bl" | "tr" | "tl") => (e: React.MouseEvent) => {
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: panelSize.w, origH: panelSize.h,
      origX: panelPos.x, origY: panelPos.y,
      corner,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [panelSize, panelPos]);

  const W = panel ? panelSize.w - PANEL_PAD_W : Math.min(window.innerWidth - 80, 900);
  const H = panel ? Math.max(100, panelSize.h - PANEL_PAD_H) : Math.min(window.innerHeight - 240, 520);
  const catNoun = categoryNoun ?? config.drilldown?.categoryNoun ?? "datasets";
  const countLabel = config.countLabel ? ` ${config.countLabel}` : "";

  const { ctColorMap, studyMap, ctTotals, studyLeaves, studyGroups, labelMap } = useMemo(() => {
    const empty = {
      ctColorMap: new Map<string, string>(),
      studyMap: new Map<string, Map<string, number>>(),
      ctTotals: new Map<string, number>(),
      studyLeaves: [] as any[],
      studyGroups: [] as any[],
      labelMap: new Map<string, string>(),
    };
    if (!entries || entries.length === 0) return empty;

    const sMap = new Map<string, Map<string, number>>();
    const ctMap = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const e of entries) {
      if (!sMap.has(e.d)) sMap.set(e.d, new Map());
      sMap.get(e.d)!.set(e.c, (sMap.get(e.d)!.get(e.c) || 0) + e.n);
      ctMap.set(e.c, (ctMap.get(e.c) || 0) + e.n);
      if (e.label && !labels.has(e.d)) labels.set(e.d, e.label);
    }

    const ctSorted = [...ctMap.entries()].sort((a, b) => b[1] - a[1]);
    const colors = new Map<string, string>();
    ctSorted.forEach(([ct], i) => colors.set(ct, i < CT_PALETTE.length ? CT_PALETTE[i] : "#b0b8c0"));

    const studies = [...sMap.entries()]
      .map(([name, cts]) => ({ name, total: [...cts.values()].reduce((a, b) => a + b, 0), cellTypes: cts }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 14);

    const rootData: TreeNode = {
      name: "root",
      children: studies.map((s) => ({
        name: s.name,
        children: [...s.cellTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
          .map(([ct, count]) => ({ name: ct, value: count })),
      })),
    };

    const root = hierarchy<TreeNode>(rootData).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const layout = treemap<TreeNode>().size([W, H]).paddingTop(4).paddingInner(3).paddingOuter(20).round(true).tile(treemapSquarify);
    const laid = layout(root);

    const groups = laid.descendants().filter((n) => n.depth === 1).map((n) => ({
      x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1, name: n.data.name, total: n.value ?? 0,
    }));

    const leaves = laid.leaves().map((n) => ({
      x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1,
      cellType: n.data.name, count: n.data.value ?? 0,
      study: n.parent?.data.name ?? "",
      color: colors.get(n.data.name) || "#b0b8c0",
    }));

    return { ctColorMap: colors, studyMap: sMap, ctTotals: ctMap, studyLeaves: leaves, studyGroups: groups, labelMap: labels };
  }, [entries, W, H, CT_PALETTE]);

  const zDisplay = cell.z.includes(" - ") ? cell.z.split(" - ").slice(1).join(" - ") : cell.z;

  const inner = (
    <div
      data-testid="treemap-overlay"
      style={{
        background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 12,
        padding: "18px 22px 14px", color: TEXT,
        backdropFilter: "blur(10px)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        ...(panel ? {
          position: "fixed",
          left: panelPos.x, top: panelPos.y,
          width: panelSize.w, height: panelSize.h,
          overflow: "hidden",
          zIndex: 310,
          userSelect: "none",
        } : {}),
      }}
      onClick={(e) => e.stopPropagation()}
    >
        <div
          onMouseDown={handleDragStart}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10,
            ...(panel ? { cursor: "grab" } : {}),
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 2 }}>
              {cell.x} · {cell.y} · {zDisplay}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, display: "flex", alignItems: "center", gap: 10 }}>
              <span>{studyMap.size} {studyMap.size === 1 ? catNoun.replace(/s$/, "") : catNoun}{studyGroups.length < studyMap.size ? ` (top ${studyGroups.length} shown)` : ""} · {fmt(cell.size)}{countLabel}</span>
              {studyMap.size > 0 && (() => {
                const dom = computeDominance(entries, config.concentrationThresholds);
                if (!dom) return null;
                return (
                  <span style={{ fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: TEXT_DIM }}>N<sub>eff</sub> =</span>
                    <span style={{ color: dom.color }}>{dom.nEff.toFixed(1)}</span>
                    <span style={{ fontSize: 10, color: TEXT_DIM }}>· D =</span>
                    <span style={{ fontSize: 10, color: dom.color }}>{dom.D.toFixed(2)}</span>
                  </span>
                );
              })()}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: CARD_BG, border: `1px solid ${PANEL_BORDER}`, color: TEXT_BODY,
            borderRadius: 6, padding: "4px 12px", fontSize: 18, cursor: "pointer", lineHeight: 1,
          }}>×</button>
        </div>

        {entries && entries.length === 0 ? (
          <div style={{ width: W, height: H, display: "flex", alignItems: "center", justifyContent: "center", color: TEXT_DIM, fontSize: 14 }}>
            No drilldown data for this cell.
          </div>
        ) : (
          <svg width={W} height={H} style={{ display: "block", borderRadius: 6 }}>
            <rect width={W} height={H} fill={CARD_BG} rx={6} />
            {studyGroups.map((s, i) => {
              const gw = s.x1 - s.x0;
              const clipId = `sg-clip-${i}`;
              const fullName = labelMap.get(s.name) ?? s.name;
              const maxTitleChars = Math.max(0, Math.floor((gw - 50) / 6.5));
              const displayTitle = fullName.length > maxTitleChars && maxTitleChars > 3
                ? fullName.slice(0, maxTitleChars - 1) + "…" : fullName;
              const isSelected = !!selectedSources?.has(s.name);
              const isStudyHighlighted = hoveredStudy === s.name || isSelected;
              return (
                <g key={`sg-${i}`}
                  onMouseEnter={() => onStudyHover?.(s.name)}
                  onMouseLeave={() => onStudyHover?.(null)}
                  onClick={onSourcesToggle ? () => onSourcesToggle([s.name]) : undefined}
                  style={{ cursor: "pointer" }}
                >
                  <title>{fullName}{onSourcesToggle ? " — click to highlight its cube cells" : ""}</title>
                  <defs><clipPath id={clipId}><rect x={s.x0} y={s.y0 - 20} width={gw} height={20} /></clipPath></defs>
                  <rect x={s.x0} y={s.y0} width={gw} height={s.y1 - s.y0}
                    fill={isStudyHighlighted ? CARD_BG_ACTIVE : "none"}
                    rx={4}
                    stroke={isStudyHighlighted ? ACCENT : PANEL_BORDER}
                    strokeWidth={isSelected ? 3 : isStudyHighlighted ? 2 : 1} />
                  {gw > 40 && (
                    <text x={s.x0 + 4} y={s.y0 - 5} fontSize={11} fontWeight={700}
                      fill={isStudyHighlighted ? ACCENT : TEXT}
                      clipPath={`url(#${clipId})`}
                      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
                      {displayTitle}
                      <tspan fill={TEXT_MUTED} fontWeight={500} fontSize={10}> ({fmt(s.total)})</tspan>
                    </text>
                  )}
                </g>
              );
            })}
            {studyLeaves.map((lf, i) => {
              const w = lf.x1 - lf.x0, h = lf.y1 - lf.y0;
              const hl = hoveredCT === lf.cellType;
              return (
                <g key={`sl-${i}`} onMouseEnter={() => setHoveredCT(lf.cellType)} onMouseLeave={() => setHoveredCT(null)}
                  onClick={onSourcesToggle ? () => onSourcesToggle([lf.study]) : undefined}
                  style={{ cursor: "pointer" }}>
                  <rect x={lf.x0} y={lf.y0} width={w} height={h} fill={lf.color}
                    opacity={hl ? 1 : hoveredCT ? 0.4 : 0.82}
                    stroke={hl ? TEXT : "rgba(255,255,255,0.6)"} strokeWidth={hl ? 2 : 0.5} rx={2} />
                  {w > 35 && h > 14 && (
                    <text x={lf.x0 + 3} y={lf.y0 + 12} fontSize={9} fontWeight={600} fill="#fff">
                      {lf.cellType.length > w / 5.5 ? lf.cellType.slice(0, Math.floor(w / 5.5)) + "…" : lf.cellType}
                    </text>
                  )}
                  {w > 45 && h > 26 && (
                    <text x={lf.x0 + 3} y={lf.y0 + 23} fontSize={8} fill="rgba(255,255,255,0.75)">{fmt(lf.count)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        <div style={{
          marginTop: 8, padding: "7px 14px", background: CARD_BG,
          borderRadius: 8, fontSize: 12, color: TEXT_BODY,
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          height: 34, minHeight: 34,
        }}>
          {hoveredCT ? (
            <>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: ctColorMap.get(hoveredCT) || "#999", flexShrink: 0 }} />
              <strong style={{ color: TEXT }}>{hoveredCT}</strong>
              <span>{fmt(ctTotals.get(hoveredCT) || 0)}</span>
              <span style={{ color: TEXT_DIM }}>in {[...studyMap.entries()].filter(([, cts]) => cts.has(hoveredCT)).length} {catNoun}</span>
            </>
          ) : (
            <span style={{ color: TEXT_DIM }}>Hover a tile for details</span>
          )}
        </div>
      {panel && (<>
        <div onMouseDown={makeResizeStart("tl")} style={{
          position: "absolute", top: 0, left: 0, width: 16, height: 16,
          cursor: "nwse-resize",
          background: `linear-gradient(315deg, transparent 50%, ${PANEL_BORDER} 50%)`,
          borderRadius: "12px 0 0 0", zIndex: 1,
        }} />
        <div onMouseDown={makeResizeStart("tr")} style={{
          position: "absolute", top: 0, right: 0, width: 16, height: 16,
          cursor: "nesw-resize",
          background: `linear-gradient(45deg, transparent 50%, ${PANEL_BORDER} 50%)`,
          borderRadius: "0 12px 0 0", zIndex: 1,
        }} />
        <div onMouseDown={makeResizeStart("bl")} style={{
          position: "absolute", bottom: 0, left: 0, width: 16, height: 16,
          cursor: "nesw-resize",
          background: `linear-gradient(225deg, transparent 50%, ${PANEL_BORDER} 50%)`,
          borderRadius: "0 0 0 12px", zIndex: 1,
        }} />
        <div onMouseDown={makeResizeStart("br")} style={{
          position: "absolute", bottom: 0, right: 0, width: 16, height: 16,
          cursor: "nwse-resize",
          background: `linear-gradient(135deg, transparent 50%, ${PANEL_BORDER} 50%)`,
          borderRadius: "0 0 12px 0", zIndex: 1,
        }} />
      </>)}
    </div>
  );

  if (panel) return inner;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: BACKDROP, backdropFilter: "blur(8px)",
        animation: "treemapFadeIn 0.3s ease-out",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
      onClick={onClose}
    >
      <style>{`@keyframes treemapFadeIn { from { opacity:0; transform:scale(0.95) } to { opacity:1; transform:scale(1) } }`}</style>
      {inner}
    </div>
  );
}
