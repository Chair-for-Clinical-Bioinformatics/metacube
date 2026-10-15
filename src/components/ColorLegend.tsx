import { useState } from "react";
import { useTheme } from "../data/themeContext";
import type { CubeConfig } from "../data/config";
import {
  getColorScaleLegendStops, legendTickValues, colorScaleLabel, colorScaleKind,
  type ColorScaleType,
} from "../data/colors";
import {
  PANEL_BORDER, TEXT, TEXT_DIM, TEXT_MUTED, CARD_BG,
  ACCENT, ACCENT_SOFT_BG, ACCENT_SOFT_BORDER,
} from "../data/theme";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${+(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  if (Number.isInteger(v) || a >= 100) return String(Math.round(v));
  return v.toFixed(1);
}

/** Legend title: explicit `count_label_legend`, else "Number of <count_label>",
 *  else the magnitude description, else a generic fallback. */
export function legendTitle(config: CubeConfig): string {
  if (config.countLabelLegend) return config.countLabelLegend;
  if (config.countLabel) return `Number of ${config.countLabel}`;
  return config.colorLabel ?? "Value";
}

/**
 * Colour-scale legend shared by the outer control panel and the inner zoom panel.
 * Shows what is encoded (title), how it is aggregated and compressed (subtitle),
 * and three ticks with units, spaced in the scale's own (sqrt/log) space.
 */
const SCALES: { key: ColorScaleType; label: string; title: string }[] = [
  { key: "linear", label: "linear", title: "Colour proportional to the value" },
  { key: "sqrt",   label: "√",      title: "Square-root scale: spreads skewed counts, keeps small values visible" },
  { key: "log",    label: "log",    title: "Log scale (log1p): for counts spanning many orders of magnitude" },
];

export function ColorLegend({ config, minValue, maxValue, scope, onScaleChange }: {
  config: CubeConfig;
  minValue: number;
  maxValue: number;
  /** Extra context for the subtitle, e.g. the outer cell an inner cube is scoped to. */
  scope?: string;
  /** When set, shows linear / √ / log buttons that switch the colour transform. */
  onScaleChange?: (s: ColorScaleType) => void;
}) {
  const [showDesc, setShowDesc] = useState(false);
  // Subscribe to the theme: the default ramp's colours depend on light/dark mode.
  useTheme();
  const kind = colorScaleKind(config.colorPalette, minValue);
  const scaleType = kind === "diverging" ? undefined : config.colorScale;
  const stops = getColorScaleLegendStops(maxValue, minValue, config.colorPalette, scaleType);
  const [lo, mid, hi] = legendTickValues(maxValue, minValue, config.colorPalette, scaleType, 3);
  const unit = config.countLabel ? ` ${config.countLabel}` : "";
  const agg = config.colorAggregation === "mean" ? "mean" : "total";
  const subtitle = [
    `${agg} per cube cell`,
    kind === "diverging" ? "diverging" : colorScaleLabel(scaleType),
    scope,
  ].filter(Boolean).join(" · ");
  // The free-text magnitude description stays available behind the "?" badge
  // whenever it isn't already the title.
  const desc = config.colorLabel && config.colorLabel !== legendTitle(config) ? config.colorLabel : null;

  return (
    <div data-testid="color-legend" style={{ marginBottom: 12, fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }}>
        <span style={{ fontWeight: 700, fontSize: 11.5, color: TEXT }}>{legendTitle(config)}</span>
        {desc && (
          <span
            onMouseEnter={() => setShowDesc(true)}
            onMouseLeave={() => setShowDesc(false)}
            style={{
              fontSize: 9, cursor: "help", color: showDesc ? ACCENT : TEXT_DIM,
              border: `1px solid ${showDesc ? ACCENT_SOFT_BORDER : PANEL_BORDER}`,
              background: showDesc ? ACCENT_SOFT_BG : "transparent",
              borderRadius: 10, padding: "0 4px", lineHeight: 1.7, fontWeight: 700,
            }}
          >?</span>
        )}
        {desc && showDesc && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 600,
            background: "#1f2937", color: "#f9fafb", padding: "8px 11px", borderRadius: 7,
            fontSize: 11, maxWidth: 240, whiteSpace: "pre-line", pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)", lineHeight: 1.6,
          }}>{desc}</div>
        )}
      </div>
      <div style={{ fontSize: 9.5, color: TEXT_MUTED, margin: "1px 0 4px" }}>{subtitle}</div>
      <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", border: `1px solid ${PANEL_BORDER}`, marginBottom: 3 }}>
        {stops.map((s, i) => <div key={i} style={{ flex: 1, background: s.color }} />)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: TEXT_DIM }}>
        <span>{fmt(lo)}</span>
        <span>{fmt(mid)}</span>
        <span>{fmt(hi)}{unit}</span>
      </div>
      {onScaleChange && kind === "sequential" && (
        <div data-testid="color-scale-toggle" style={{ display: "flex", marginTop: 5 }}>
          {SCALES.map((s, i) => {
            const on = (config.colorScale ?? "linear") === s.key;
            return (
              <button key={s.key} title={s.title} onClick={() => onScaleChange(s.key)} style={{
                flex: 1, padding: "2px 0", fontSize: 10, fontWeight: on ? 700 : 500, cursor: "pointer",
                fontFamily: "inherit",
                background: on ? ACCENT_SOFT_BG : CARD_BG,
                color: on ? ACCENT : TEXT_MUTED,
                borderStyle: "solid",
                borderColor: on ? ACCENT_SOFT_BORDER : PANEL_BORDER,
                borderWidth: i === 0 || on ? 1 : "1px 1px 1px 0",
                borderRadius: i === 0 ? "4px 0 0 4px" : i === SCALES.length - 1 ? "0 4px 4px 0" : 0,
              }}>{s.label}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
