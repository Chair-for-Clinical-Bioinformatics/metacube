// ── Colour schemes ────────────────────────────────────────────────────────────
// Two named schemes — `default` (the classic cube look) and `asap` (ASAP/CRN
// brand) — each with a `light` and `dark` palette. The palettes are authored in
// editable YAML (src/data/colour_schemes/*.yaml) and inlined at build time via
// Vite `?raw`, so `pixi run dev` / `pixi run export-template` recompile from them.
//
// A dataset config selects the scheme with one line (`colour_scheme: asap`); the
// light/dark mode is chosen at runtime by the toggle (seeded from the OS setting).
// Components read the active palette through useTheme() — see data/themeContext.

import { load } from "js-yaml";
import defaultRaw from "./colour_schemes/colours.yaml?raw";
import asapRaw from "./colour_schemes/asap_colours.yaml?raw";

// ── ASAP brand hexes ──────────────────────────────────────────────────────────
// Kept as a named export because colors.ts builds the ASAP/PuGn gradient
// interpolators (matplotlib-style, mode-independent) from these brand colours.
export const ASAP = {
  green:      "#239c6c",
  greenDark:  "#1b7d56",
  greenLight: "#5cbf95",
  greenGlow:  "#2bc88c",
  purple:     "#8c4e9f",
  purpleDark: "#6f3d80",
  purpleLight:"#b07cc0",
  teal:       "#035c81",
  teal2:      "#1793ad",
  blue:       "#0c8dc3",
  violet:     "#745ba6",
  amber:      "#f59e0b",
} as const;

export type ThemeMode = "light" | "dark";
export type ColourScheme = "default" | "asap";

/** Resolved palette for one scheme + mode. Mirrors the YAML preset keys. */
export interface Theme {
  background: string;
  panel_bg: string;
  panel_bg_solid: string;
  panel_border: string;
  card_bg: string;
  card_bg_active: string;
  backdrop: string;

  text: string;
  text_body: string;
  text_muted: string;
  text_dim: string;

  accent: string;
  accent_strong: string;
  accent_fill: string;
  accent_soft_bg: string;
  accent_soft_border: string;

  cell_default: string;
  cell_accent: string;
  edge: string;
  edge_hover: string;
  edge_selected: string;
  /** Fill for cells outside the current selection (colour removed). */
  cell_dim: string;
  /** Edge colour for cells outside the current selection. */
  edge_dim: string;
  /** Strong outline for selected cells (white in dark mode, near-black in light). */
  edge_focus: string;
  wire: string;
  grid: string;

  axis: { x: string; y: string; z: string };
  axis_title: string;
  axis_outline: string;

  categorical: string[];
  size_scale: { low: string; mid: string; high: string };
}

type SchemePair = { light: Theme; dark: Theme };

const defaultScheme = load(defaultRaw) as SchemePair;
const asapScheme = load(asapRaw) as SchemePair;

export const SCHEMES: Record<ColourScheme, SchemePair> = {
  default: defaultScheme,
  asap: asapScheme,
};

/** Scheme used when a config doesn't specify `colour_scheme`. */
export const DEFAULT_SCHEME: ColourScheme = "default";

export function isColourScheme(v: unknown): v is ColourScheme {
  return v === "default" || v === "asap";
}

/** Resolve the active palette, falling back to the default scheme for unknown names. */
export function resolveTheme(scheme: ColourScheme, mode: ThemeMode): Theme {
  return (SCHEMES[scheme] ?? SCHEMES[DEFAULT_SCHEME])[mode];
}

// ── CSS variables (chrome) ────────────────────────────────────────────────────
// The chrome tokens (panels, text, borders, accents, page background) are exposed
// as CSS custom properties so the DOM panels switch instantly when the provider
// rewrites them on a mode/scheme change — no per-component re-render needed. The
// ThemeProvider writes these onto the document root via applyThemeVars().
export function themeToCssVars(t: Theme): Record<string, string> {
  return {
    "--ct-bg":                t.background,
    "--ct-panel-bg":          t.panel_bg,
    "--ct-panel-bg-solid":    t.panel_bg_solid,
    "--ct-panel-border":      t.panel_border,
    "--ct-card-bg":           t.card_bg,
    "--ct-card-bg-active":    t.card_bg_active,
    "--ct-backdrop":          t.backdrop,
    "--ct-text":              t.text,
    "--ct-text-body":         t.text_body,
    "--ct-text-muted":        t.text_muted,
    "--ct-text-dim":          t.text_dim,
    "--ct-accent":            t.accent,
    "--ct-accent-strong":     t.accent_strong,
    "--ct-accent-fill":       t.accent_fill,
    "--ct-accent-soft-bg":    t.accent_soft_bg,
    "--ct-accent-soft-border": t.accent_soft_border,
  };
}

// Chrome constants resolve to the CSS variables above. Components keep importing
// these names; their inline styles become `var(--ct-…)` and track the live theme.
export const PAGE_GRADIENT      = "var(--ct-bg)";
export const PANEL_BG           = "var(--ct-panel-bg)";
export const PANEL_BG_SOLID     = "var(--ct-panel-bg-solid)";
export const PANEL_BORDER       = "var(--ct-panel-border)";
export const CARD_BG            = "var(--ct-card-bg)";
export const CARD_BG_ACTIVE     = "var(--ct-card-bg-active)";
export const BACKDROP           = "var(--ct-backdrop)";
export const TEXT               = "var(--ct-text)";
export const TEXT_BODY          = "var(--ct-text-body)";
export const TEXT_MUTED         = "var(--ct-text-muted)";
export const TEXT_DIM           = "var(--ct-text-dim)";
export const ACCENT             = "var(--ct-accent)";
export const ACCENT_STRONG      = "var(--ct-accent-strong)";
export const ACCENT_FILL        = "var(--ct-accent-fill)";
export const ACCENT_SOFT_BG     = "var(--ct-accent-soft-bg)";
export const ACCENT_SOFT_BORDER = "var(--ct-accent-soft-border)";
