export interface ColorPaletteConfig {
  /** Named matplotlib/d3 palette (e.g. "RdYlGn", "plasma", "inferno"). Takes priority over hex colors. */
  name?: string;
  /**
   * "sequential": maps [minVal, maxVal] → [0, 1].
   * "diverging":  maps [-absMax, +absMax] → [0, 1], midpoint at 0.
   * Omit to auto-detect: diverging when minVal < 0, sequential otherwise.
   */
  type?: "sequential" | "diverging";
  /** Fallback hex colors used only when name is not set. */
  low_color?: string;
  mid_color?: string;
  high_color?: string;
}

export interface AxisConfig {
  label: string;
  description?: string;
  colors?: Record<string, string>;
  groupSeparator?: string;
}

export interface DrilldownConfig {
  type: "treemap" | "zoom";
  // Only define the axes that change — omitted axes are inherited from the outer cube.
  // 1 axis → slice-zoom behaviour; 2 axes → partial cube; 3 axes → full inner cube.
  axes?: {
    x?: AxisConfig;
    y?: AxisConfig;
    z?: AxisConfig;
  };
  /** Per-axis color overrides for the inner zoom cube. Replaces AXIS_COLORS for axis titles and label highlights. */
  axisColors?: Partial<Record<"x" | "y" | "z", string>>;
  /** Plural noun for the treemap category in the UI ("N <noun>"), e.g. "labs". Default "datasets". */
  categoryNoun?: string;
}

export interface SliceConfig {
  fixed_axis: "x" | "y" | "z";
  count_field?: "size" | "color";
}

export interface CubeConfig {
  title: string;
  axes: {
    x: AxisConfig;
    y: AxisConfig;
    z: AxisConfig;
  };
  colors?: Record<string, string>;
  drilldown?: DrilldownConfig;
  hasColorValues?: boolean;
  uniformCellColor?: string;
  colorPalette?: ColorPaletteConfig;
  colorAggregation?: "sum" | "mean";
  colorLabel?: string;
  /** Noun for one unit of the magnitude (size_colour), shown next to counts in the UI, e.g. "cells" or "experiments". Default: "entries"/"Size". */
  countLabel?: string;
  /** Colour-legend title, e.g. "Number of cells". Falls back to "Number of <countLabel>". */
  countLabelLegend?: string;
  /** Value compression applied before the colour ramp. Default "linear". */
  colorScale?: "linear" | "sqrt" | "log";
  /** Axis value label orientation: "auto" (perpendicular to the on-screen axis) or "horizontal". Default "auto". */
  labelRotation?: "auto" | "horizontal";
  slice?: SliceConfig;
  /** Substring to match against dataset keys. Cells whose every dataset key contains this string are rendered as ghost (transparent fill, outline only). */
  ghost_datasets?: string;
  /** Substring to match against dataset keys. Cells where any dataset key contains this string are rendered in a fixed accent color instead of the count gradient. */
  accent_datasets?: string;
  /** Hex color used for accent cells. Defaults to amber (#f59e0b). */
  accent_color?: string;
  /** Display label for accent cells in the legend. */
  accent_label?: string;
  /** Per-axis color overrides. When set, these replace AXIS_COLORS for axis titles and individual label highlighting. */
  axisColors?: Partial<Record<"x" | "y" | "z", string>>;
  /** Scene background. Any CSS background value — a solid hex ("#ffffff") or a gradient ("linear-gradient(...)"). Defaults to white. */
  background?: string;
  /** When true, grouped-axis headers are rotated to run parallel to their axis (e.g. vertical Y group headers). Default: false (headers stay horizontal). */
  tiltGroupLabels?: boolean;
  /** Named colour scheme to theme the app with: "default" (classic look) or "asap" (ASAP/CRN brand). Light/dark mode is chosen at runtime by the toggle. Defaults to "default". */
  colour_scheme?: "default" | "asap";
  /** Thresholds on the effective number of sources (inverse Simpson) for the concentration label/colour: [skewedBelow, diverseAtOrAbove]. Default [2, 5]. */
  concentrationThresholds?: [number, number];
}

export type AxisGroup = { label: string; members: string[]; separator: string };
