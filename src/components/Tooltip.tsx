import { useEffect, useState } from "react";
import type { CubeCell, Dominance } from "../data/dataModel";
import type { CubeConfig } from "../data/config";
import { AXIS_COLORS, getAxisColor } from "../data/colors";
import { PANEL_BG, PANEL_BORDER, TEXT_BODY, TEXT_MUTED, TEXT_DIM } from "../data/theme";

interface TooltipProps {
  cell: CubeCell | null;
  config: CubeConfig;
  cellBreakdown?: Record<string, Record<string, number>>;
  /** Zoom mode: outer-key prefix for an inner cell (breakdowns are keyed outer|inner). */
  outerKeyFor?: (cell: CubeCell) => string;
  /** Map of dataset key → human-readable title. When a key is present, its title is shown instead of the key. */
  datasetTitles?: Record<string, string>;
  /** Source-concentration measure for the hovered cell (treemap/zoom modes). Null hides the row. */
  dominance?: Dominance | null;
}

export function Tooltip({ cell, config, cellBreakdown, outerKeyFor, datasetTitles, dominance }: TooltipProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  if (!cell) return null;

  const zDisplay = cell.z.includes(" - ") ? cell.z.split(" - ").slice(1).join(" - ") : cell.z;
  const axisValues: ["x" | "y" | "z", string, string][] = [
    ["x", config.axes.x.label, cell.x],
    ["y", config.axes.y.label, cell.y],
    ["z", config.axes.z.label, zDisplay],
  ];

  return (
    <div style={{
      position: "fixed",
      left: pos.x + 14, top: pos.y + 14,
      background: PANEL_BG,
      border: `1px solid ${PANEL_BORDER}`,
      borderRadius: 8, padding: "10px 14px",
      pointerEvents: "none", zIndex: 1000,
      maxWidth: 320, fontSize: 13, lineHeight: 1.5,
      color: TEXT_BODY,
      backdropFilter: "blur(10px)",
      boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", marginBottom: 4 }}>
        {axisValues.map(([ax, label, val]) => {
          let color: string;
          if (ax === "y" && config.axes.y.groupSeparator) {
            const sep = config.axes.y.groupSeparator;
            const idx = val.indexOf(sep);
            const group = idx > 0 ? val.slice(0, idx) : val;
            color = getAxisColor(group, config);
          } else {
            color = config.axisColors?.[ax] ?? AXIS_COLORS[ax];
          }
          return (
            <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <span style={{ color: TEXT_DIM }}>{label}</span>
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
        <div>
          <span style={{ color: TEXT_DIM }}>
            {config.countLabel
              ? `${config.countLabel.charAt(0).toUpperCase()}${config.countLabel.slice(1)}: `
              : config.colorAggregation === "mean" ? "Count: " : "Size: "}
          </span>
          {config.colorAggregation === "mean"
            ? Math.round(cell.size).toLocaleString()
            : cell.size.toLocaleString()}
        </div>
      )}
      {config.hasColorValues && cell.color !== undefined && (config.colorLabel || config.colorAggregation === "mean") && (
        <div>
          <span style={{ color: TEXT_DIM }}>
            {config.colorLabel ? `${config.colorLabel}: ` : "Mean: "}
          </span>
          {cell.color.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
      {dominance && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
          <span style={{ color: TEXT_DIM }}>N<sub>eff</sub> =</span>
          <span style={{ color: dominance.color, fontWeight: 600 }}>{dominance.nEff.toFixed(1)}</span>
          <span style={{ color: TEXT_DIM }}>· D =</span>
          <span style={{ color: dominance.color, fontWeight: 600 }}>{dominance.D.toFixed(2)}</span>
        </div>
      )}
      {cell.datasets.length > 0 && (
        <>
          <div style={{ marginTop: 6, fontSize: 12, color: TEXT_DIM }}>
            Datasets:
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: TEXT_BODY }}>
            {cell.datasets.slice(0, 5).map((d, i) => <li key={i}>{datasetTitles?.[d] ?? d}</li>)}
          </ul>
        </>
      )}
      {(() => {
        const innerKey = `${cell.x}|${cell.y}|${cell.z}`;
        const key = outerKeyFor ? `${outerKeyFor(cell)}|${innerKey}` : innerKey;
        const breakdown = cellBreakdown?.[key];
        if (!breakdown) return null;
        const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) return null;
        return (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 2 }}>Subtypes:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {entries.map(([name, count]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                  <span style={{ color: TEXT_BODY }}>{name}</span>
                  <span style={{ color: TEXT_MUTED, fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
