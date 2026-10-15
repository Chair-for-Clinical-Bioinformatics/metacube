import { useState } from "react";
import type { CubeConfig, AxisGroup } from "../data/config";
import { getColorScaleLegendStops, getGroupColor, type ColorScaleType } from "../data/colors";
import { ColorLegend } from "./ColorLegend";
import { useTheme } from "../data/themeContext";
import type { ThemeMode } from "../data/theme";
import {
  PANEL_BG, PANEL_BORDER, CARD_BG, TEXT, TEXT_BODY, TEXT_MUTED, TEXT_DIM,
  ACCENT, ACCENT_SOFT_BG, ACCENT_SOFT_BORDER,
} from "../data/theme";

/** Light / dark mode toggle (also shown in the zoom-mode panel). */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const modeBtn = (m: ThemeMode): React.CSSProperties => ({
    flex: 1,
    padding: "3px 0",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: 5,
    fontFamily: "inherit",
    background: mode === m ? ACCENT_SOFT_BG : CARD_BG,
    border: `1px solid ${mode === m ? ACCENT_SOFT_BORDER : PANEL_BORDER}`,
    color: mode === m ? ACCENT : TEXT_MUTED,
  });
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
      <button style={modeBtn("light")} onClick={() => setMode("light")}>☀ Light</button>
      <button style={modeBtn("dark")} onClick={() => setMode("dark")}>☾ Dark</button>
    </div>
  );
}

interface ControlPanelProps {
  /** Switch the colour transform from the legend (linear / √ / log). */
  onColorScaleChange?: (s: ColorScaleType) => void;
  /** Per-axis values with data under the current filters (faceted). */
  available?: { x: Set<string>; y: Set<string>; z: Set<string> };
  xs: string[];
  ys: string[];
  zs: string[];
  config: CubeConfig;
  xGroups?: AxisGroup[];
  yGroups?: AxisGroup[];
  zGroups?: AxisGroup[];
  xFilter: Set<string>;
  toggleX: (v: string) => void;
  setXFilter: (f: Set<string>) => void;
  yFilter: Set<string>;
  toggleY: (v: string) => void;
  setYFilter: (f: Set<string>) => void;
  zFilter: Set<string>;
  toggleZ: (v: string) => void;
  setZFilter: (f: Set<string>) => void;
  cellOpacity: number;
  setCellOpacity: (v: number) => void;
  maxColorValue: number;
  minColorValue?: number;
  onResetView: () => void;
  onClearSelection: () => void;
}

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

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

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 12, left: 12, width: 224,
  background: PANEL_BG,
  border: `1px solid ${PANEL_BORDER}`,
  borderRadius: 10,
  padding: "10px 13px",
  fontSize: 13, color: TEXT_BODY,
  zIndex: 100,
  maxHeight: "calc(100vh - 76px)",
  overflowY: "auto",
  backdropFilter: "blur(12px)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
  fontFamily: FONT,
};

const sectionStyle: React.CSSProperties = { marginBottom: 8 };
const labelStyle: React.CSSProperties = {
  fontWeight: 600, fontSize: 11,
  textTransform: "uppercase", letterSpacing: 0.5, color: TEXT_MUTED,
};
const allNoneBtn: React.CSSProperties = {
  padding: "1px 6px", fontSize: 10, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: 0.3,
  background: "transparent", border: `1px solid ${PANEL_BORDER}`,
  color: TEXT_MUTED, borderRadius: 3, cursor: "pointer", lineHeight: 1.4,
};

function CheckItem({ label, checked, onChange, indent = false, available = true }: {
  label: string; checked: boolean; onChange: () => void; indent?: boolean;
  /** False when the value has no data under the other axes' filters. */
  available?: boolean;
}) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "2px 0", paddingLeft: indent ? 14 : 0,
      cursor: "pointer", fontSize: 12,
      color: checked ? TEXT : available ? TEXT_BODY : TEXT_DIM,
      fontWeight: checked ? 600 : 400,
      opacity: checked || available ? 1 : 0.45,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function AxisSection({
  label, values, filter, toggle, setFilter,
  groups, config, description, available,
}: {
  label: string;
  values: string[];
  /** Values with data under the other axes' filters (undefined = no filter). */
  available?: Set<string>;
  filter: Set<string>;
  toggle: (v: string) => void;
  setFilter: (f: Set<string>) => void;
  groups?: AxisGroup[];
  config?: CubeConfig;
  description?: string;
}) {
  const [show, setShow] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 3 }}>
          <span
            style={{
              ...labelStyle,
              cursor: description ? "pointer" : undefined,
              color: pinned && description ? ACCENT : TEXT_MUTED,
            }}
            onMouseEnter={description ? () => setShow(true) : undefined}
            onMouseLeave={description ? () => setShow(false) : undefined}
            onClick={description ? () => setPinned(p => !p) : undefined}
          >{label}</span>
          {description && (
            <span style={{
              fontSize: 8, position: "relative", top: -3,
              color: pinned ? ACCENT : TEXT_DIM,
              fontWeight: 700, lineHeight: 1, cursor: "pointer",
              pointerEvents: "none",
            }}>?</span>
          )}
          {description && (show || pinned) && <DescTooltip text={description} anchor="top" />}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <button style={allNoneBtn} onClick={() => setFilter(new Set(values))}>all</button>
          <button style={allNoneBtn} onClick={() => setFilter(new Set())}>none</button>
        </div>
      </div>
      {groups ? (
        groups.map((group) => {
          const allOn = group.members.every((m) => filter.has(m));
          const anyOn = group.members.some((m) => filter.has(m));
          const groupColor = config ? getGroupColor(group.label, config) : TEXT;
          return (
            <div key={group.label}>
              <label style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "2px 0 1px", cursor: "pointer",
                fontSize: 12, fontWeight: 700,
                color: anyOn ? groupColor : TEXT_MUTED,
              }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = anyOn && !allOn; }}
                  onChange={() => {
                    const next = new Set(filter);
                    if (allOn) group.members.forEach((m) => next.delete(m));
                    else group.members.forEach((m) => next.add(m));
                    setFilter(next);
                  }}
                />
                {group.label}
              </label>
              {group.members.map((m) => {
                const sub = m.slice(group.label.length + group.separator.length);
                return (
                  <CheckItem key={m} label={sub} checked={filter.has(m)} onChange={() => toggle(m)} indent available={!available || available.has(m)} />
                );
              })}
            </div>
          );
        })
      ) : (
        values.map((v) => (
          <CheckItem key={v} label={v} checked={filter.has(v)} onChange={() => toggle(v)} available={!available || available.has(v)} />
        ))
      )}
    </div>
  );
}

export function ControlPanel({
  xs, ys, zs, config, xGroups, yGroups, zGroups,
  xFilter, toggleX, setXFilter,
  yFilter, toggleY, setYFilter,
  zFilter, toggleZ, setZFilter,
  cellOpacity, setCellOpacity,
  maxColorValue, minColorValue = 0, onResetView, onClearSelection, available, onColorScaleChange,
}: ControlPanelProps) {
  const { theme } = useTheme();
  // Only show the count gradient when the cube is actually gradient-coloured
  // (size_colour/colour set). A uniform cube has counts too, so gating on
  // maxColorValue alone wrongly shows a scale for single-coloured cubes.
  const showScale = !!config.hasColorValues && !config.uniformCellColor;
  const legendStops = showScale && maxColorValue > 0
    ? getColorScaleLegendStops(maxColorValue, minColorValue, config.colorPalette, config.colorScale)
    : null;


  return (
    <div style={panelStyle}>
      <ThemeToggle />
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: TEXT }}>
        {config.title}
      </div>

      {(config.accent_datasets || config.ghost_datasets) && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Cell type</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {legendStops ? (
                <div style={{ display: "flex", width: 22, height: 12, borderRadius: 2, overflow: "hidden", flexShrink: 0, border: `1px solid ${PANEL_BORDER}` }}>
                  {legendStops.map((s, i) => (
                    <div key={i} style={{ flex: 1, background: s.color }} />
                  ))}
                </div>
              ) : (
                <div style={{ width: 22, height: 12, borderRadius: 2, background: config.uniformCellColor ?? theme.cell_default, flexShrink: 0, border: `1px solid ${PANEL_BORDER}` }} />
              )}
              <span style={{ fontSize: 12, color: TEXT_BODY }}>Primary tissue</span>
            </div>
            {config.accent_datasets && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 12, borderRadius: 2, background: config.accent_color ?? "#f59e0b", flexShrink: 0, border: `1px solid ${PANEL_BORDER}` }} />
                <span style={{ fontSize: 12, color: TEXT_BODY }}>{config.accent_label ?? config.accent_datasets}</span>
              </div>
            )}
            {config.ghost_datasets && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 12, borderRadius: 2, background: "transparent", flexShrink: 0, border: `1.5px solid ${TEXT_DIM}`, boxSizing: "border-box" }} />
                <span style={{ fontSize: 12, color: TEXT_BODY }}>Planned</span>
              </div>
            )}
          </div>
        </div>
      )}

      {legendStops && (
        <ColorLegend config={config} minValue={minColorValue} maxValue={maxColorValue} onScaleChange={onColorScaleChange} />
      )}

      <AxisSection
        label={`${config.axes.x.label} (X)`}
        values={xs}
        available={available?.x}
        filter={xFilter}
        toggle={toggleX}
        setFilter={setXFilter}
        groups={xGroups}
        config={config}
        description={config.axes.x.description}
      />
      <AxisSection
        label={`${config.axes.y.label} (Y)`}
        values={ys}
        available={available?.y}
        filter={yFilter}
        toggle={toggleY}
        setFilter={setYFilter}
        groups={yGroups}
        config={config}
        description={config.axes.y.description}
      />
      <AxisSection
        label={`${config.axes.z.label} (Z)`}
        values={zs}
        available={available?.z}
        filter={zFilter}
        toggle={toggleZ}
        setFilter={setZFilter}
        groups={zGroups}
        config={config}
        description={config.axes.z.description}
      />

      <div style={sectionStyle}>
        <span style={labelStyle}>Cell Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={cellOpacity}
          onChange={(e) => setCellOpacity(Number(e.target.value))}
          style={{ width: "100%", accentColor: ACCENT }} />
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={onResetView} style={{
          flex: 1, padding: "5px 8px", fontSize: 11,
          background: ACCENT_SOFT_BG, border: `1px solid ${ACCENT_SOFT_BORDER}`,
          color: ACCENT, borderRadius: 5, cursor: "pointer",
        }}>Reset View</button>
        <button onClick={onClearSelection} style={{
          flex: 1, padding: "5px 8px", fontSize: 11,
          background: CARD_BG, border: `1px solid ${PANEL_BORDER}`,
          color: TEXT_MUTED, borderRadius: 5, cursor: "pointer",
        }}>Clear Sel.</button>
      </div>
    </div>
  );
}
