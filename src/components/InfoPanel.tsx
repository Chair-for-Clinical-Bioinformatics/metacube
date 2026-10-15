import type { CubeCell, InfoEntry } from "../data/dataModel";
import type { CubeConfig } from "../data/config";
import { SourceCards } from "./SourceCards";
import { AXIS_COLORS } from "../data/colors";
import {
  PANEL_BG_SOLID, PANEL_BORDER, CARD_BG, BACKDROP,
  TEXT_BODY, TEXT_MUTED, TEXT_DIM,
} from "../data/theme";

interface InfoPanelProps {
  cell: CubeCell;
  entries: InfoEntry[];
  config: CubeConfig;
  onClose: () => void;
  hoveredStudy?: string | null;
  onStudyHover?: (study: string | null) => void;
}

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function InfoPanel({ cell, entries, config, onClose, hoveredStudy, onStudyHover }: InfoPanelProps) {
  const nPublications = new Set(entries.map((e) => e.title).filter(Boolean)).size;
  const zDisplay = cell.z.includes(" - ") ? cell.z.split(" - ").slice(1).join(" - ") : cell.z;
  const cellVals: ["x" | "y" | "z", string][] = [["x", cell.x], ["y", cell.y], ["z", zDisplay]];

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
          padding: "20px 24px", maxWidth: 700, width: "calc(100vw - 80px)",
          maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginBottom: 6 }}>
              {cellVals.map(([ax, val], i) => {
                const color = config.axisColors?.[ax] ?? AXIS_COLORS[ax];
                return (
                  <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {i > 0 && <span style={{ color: PANEL_BORDER, marginRight: 6 }}>·</span>}
                    <span style={{ fontSize: 11, color: TEXT_MUTED }}>{config.axes[ax].label}</span>
                    <span style={{
                      padding: "1px 7px", borderRadius: 9, fontSize: 11,
                      background: `${color}14`, color,
                      border: `1px solid ${color}34`, fontWeight: 600,
                    }}>
                      {val}
                    </span>
                  </span>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: TEXT_DIM }}>
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
              {nPublications > 0 && ` · ${nPublications} publication${nPublications === 1 ? "" : "s"}`}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: CARD_BG, border: `1px solid ${PANEL_BORDER}`, color: TEXT_BODY,
            borderRadius: 6, padding: "4px 12px", fontSize: 18, cursor: "pointer", lineHeight: 1,
            fontFamily: FONT,
          }}>×</button>
        </div>

        {/* Entries, grouped into one card per publication */}
        <SourceCards
          entries={entries}
          size="large"
          countLabel={config.countLabel}
          hovered={hoveredStudy}
          onHover={onStudyHover}
        />
      </div>
    </div>
  );
}
