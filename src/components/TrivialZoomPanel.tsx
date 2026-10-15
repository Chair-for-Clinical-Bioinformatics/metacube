import { Fragment } from "react";
import type { CubeCell, InfoEntry } from "../data/dataModel";
import type { CubeConfig } from "../data/config";
import { AXIS_COLORS } from "../data/colors";
import { PANEL_BG_SOLID, PANEL_BORDER, CARD_BG, BACKDROP, TEXT_BODY, TEXT_MUTED, TEXT_DIM, ACCENT } from "../data/theme";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

interface TrivialZoomPanelProps {
  outerCell: CubeCell;
  innerCell: { x: string; y: string; z: string };
  zoomedAxes: ("x" | "y" | "z")[];
  config: CubeConfig;
  totalSize: number;
  infoEntries: InfoEntry[] | null;
  onClose: () => void;
}

export function TrivialZoomPanel({ outerCell, innerCell, zoomedAxes, config, totalSize, infoEntries, onClose }: TrivialZoomPanelProps) {
  const contextAxes = (["x", "y", "z"] as const).filter(ax => !zoomedAxes.includes(ax));
  const pct = totalSize > 0 ? ((outerCell.size / totalSize) * 100).toFixed(1) : "0";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: BACKDROP, backdropFilter: "blur(8px)",
        fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: PANEL_BG_SOLID, border: `1px solid ${PANEL_BORDER}`, borderRadius: 12,
          backdropFilter: "blur(10px)",
          padding: "20px 24px", maxWidth: 600, width: "calc(100vw - 80px)",
          maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            {contextAxes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginBottom: 8 }}>
                {contextAxes.map((ax, i) => {
                  const color = config.axisColors?.[ax] ?? AXIS_COLORS[ax];
                  return (
                    <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {i > 0 && <span style={{ color: PANEL_BORDER, marginRight: 6 }}>·</span>}
                      <span style={{ fontSize: 11, color: TEXT_DIM }}>{config.axes[ax].label}</span>
                      <span style={{
                        padding: "1px 7px", borderRadius: 9, fontSize: 11,
                        background: `${color}14`, color,
                        border: `1px solid ${color}34`, fontWeight: 600,
                      }}>
                        {outerCell[ax]}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
              {zoomedAxes.map((ax, i) => {
                const color = config.drilldown?.axisColors?.[ax] ?? config.axisColors?.[ax] ?? AXIS_COLORS[ax];
                const label = config.drilldown?.axes?.[ax]?.label ?? config.axes[ax].label;
                return (
                  <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {i > 0 && <span style={{ color: PANEL_BORDER, marginRight: 6 }}>·</span>}
                    <span style={{ fontSize: 11, color: TEXT_DIM }}>{label}</span>
                    <span style={{
                      padding: "1px 7px", borderRadius: 9, fontSize: 11,
                      background: `${color}14`, color,
                      border: `1px solid ${color}34`, fontWeight: 600,
                    }}>
                      {innerCell[ax]}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: CARD_BG, border: `1px solid ${PANEL_BORDER}`, color: TEXT_BODY,
              borderRadius: 6, padding: "4px 12px", fontSize: 18, cursor: "pointer",
              lineHeight: 1, fontFamily: FONT,
            }}
          >×</button>
        </div>

        {infoEntries && infoEntries.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {infoEntries.map((entry, i) => (
              <div key={i} style={{ padding: "10px 12px", background: CARD_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", rowGap: 3, columnGap: 10 }}>
                  {Object.entries(entry).filter(([k, v]) => !!v && !k.startsWith("_") && (k !== "dataset" || !!entry.title)).map(([key, val]) => {
                    const isDoi = key === "doi";
                    const isLink = key === "url" || isDoi;
                    const n = parseFloat(val);
                    const displayVal = !isLink && !isNaN(n) && Number.isInteger(n) && String(n) !== val
                      ? String(n) : val;
                    return (
                      <Fragment key={key}>
                        <span style={{ color: TEXT_DIM, fontWeight: 600, textTransform: "capitalize", fontSize: 12 }}>
                          {key}
                        </span>
                        {isLink ? (
                          <a
                            href={isDoi ? `https://doi.org/${val}` : val}
                            target="_blank" rel="noopener noreferrer"
                            style={{ color: ACCENT, textDecoration: "none", wordBreak: "break-all", fontSize: 12 }}
                          >
                            {displayVal}
                          </a>
                        ) : (
                          <span style={{ color: TEXT_BODY, wordBreak: "break-word", fontSize: 12 }}>{displayVal}</span>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : !config.uniformCellColor ? (
          <div style={{ fontSize: 12, color: TEXT_MUTED }}>
            <span style={{ fontWeight: 600, color: TEXT_BODY }}>{fmt(outerCell.size)}</span>
            {" entries · "}
            <span style={{ fontWeight: 600, color: TEXT_BODY }}>{pct}%</span>
            {" of total"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
