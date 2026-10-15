import { useState, useCallback, useRef, useEffect } from "react";
import App from "../src/App";
import FigureMode from "../src/FigureMode";
import { ThemeProvider, useTheme } from "../src/data/themeContext";
import { DEFAULT_SCHEME } from "../src/data/theme";
import { transformCsvYaml } from "./transform";
import { downloadStandaloneHtml } from "./download";
import { readViewParams } from "../src/viewParams";
import type { CubeData, ChartSpec } from "../src/data/dataModel";
import {
  ASAP,
  PAGE_GRADIENT,
  PANEL_BG,
  PANEL_BORDER,
  CARD_BG,
  TEXT,
  TEXT_BODY,
  TEXT_MUTED,
  TEXT_DIM,
} from "../src/data/theme";

const BASE = import.meta.env.BASE_URL;
const TEMPLATE_URL = `${BASE}template.html`;

// `key` is a stable identifier used for deep-linking (e.g. the capture script's
// ?dataset=<key> URL param). Keep these keys in sync with scripts/capture_config.yaml.
interface ExampleDef { key: string; label: string; csv: string; yaml: string; hidden?: boolean; }
// Census counts: primary cells only (is_primary_data), so each cell is counted once.
const CENSUS_PRIMARY = `${BASE}examples/census_tissue_general_counts_primary.csv`;
const EXAMPLES: ExampleDef[] = [
  {
    key:  "census_flat",
    label: "CellxGene — flat cube",
    csv:  CENSUS_PRIMARY,
    yaml: `${BASE}examples/census_tissue_general_flat.yaml`,
  },
  {
    key:  "census_treemap",
    label: "CellxGene — treemap",
    csv:  CENSUS_PRIMARY,
    yaml: `${BASE}examples/census_tissue_general_treemap.yaml`,
  },
  {
    key:  "census_zoom",
    label: "CellxGene — zoom cube",
    csv:  CENSUS_PRIMARY,
    yaml: `${BASE}examples/census_tissue_general_zoom.yaml`,
  },
  {
    // Capture-only: fine-tissue treemap source for the prefrontal-cortex panel
    // (Fig 1D). Hidden from the playground dropdown but resolvable via ?dataset.
    key:  "census_fine",
    label: "CellxGene — fine tissue treemap",
    csv:  CENSUS_PRIMARY,
    yaml: `${BASE}examples/census_fine_treemap.yaml`,
    hidden: true,
  },
  {
    key:  "encode",
    label: "ENCODE — automatic axes",
    csv:  `${BASE}examples/encode_experiment_counts.csv`,
    yaml: `${BASE}examples/encode_auto.yaml`,
  },
];

// Deep-link params, read once at module load. `?dataset=<key>` auto-loads an
// example; if `?figure=` is also present we render chrome-free FigureMode so the
// capture script gets a clean screenshot.
const _urlParams = new URLSearchParams(window.location.search);
const DATASET_PARAM = _urlParams.get("dataset");
const FIGURE_PARAM = _urlParams.get("figure");
// ?ui=full renders the complete app UI without the playground's download bar
// (used for the annotated full-interface figure).
const UI_FULL = _urlParams.get("ui") === "full";
const VIEW = readViewParams();

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// ── State machine ─────────────────────────────────────────────────────────────

type Phase =
  | { tag: "landing" }
  | { tag: "loading"; message: string }
  | { tag: "ready"; data: CubeData; key: number }
  | { tag: "error"; message: string };

// ── Root component ────────────────────────────────────────────────────────────

export default function PlaygroundApp() {
  const [phase, setPhase] = useState<Phase>({ tag: "landing" });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [yamlFile, setYamlFile] = useState<File | null>(null);

  const runTransform = useCallback(async (
    csvText: string,
    yamlText: string,
    chartsData?: Record<string, ChartSpec>,
    metadataCsvText?: string,
  ) => {
    setPhase({ tag: "loading", message: "Transforming data…" });
    try {
      const data = await transformCsvYaml(csvText, yamlText, chartsData, metadataCsvText);
      setPhase({ tag: "ready", data, key: Date.now() });
    } catch (e) {
      setPhase({ tag: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!csvFile || !yamlFile) return;
    setPhase({ tag: "loading", message: "Reading files…" });
    const [csvText, yamlText] = await Promise.all([csvFile.text(), yamlFile.text()]);
    await runTransform(csvText, yamlText);
  }, [csvFile, yamlFile, runTransform]);

  const handleExample = useCallback(async (ex: ExampleDef) => {
    setPhase({ tag: "loading", message: "Fetching example data…" });
    try {
      const bust = `?t=${Date.now()}`;
      const [csvRes, yamlRes] = await Promise.all([fetch(ex.csv + bust), fetch(ex.yaml + bust)]);
      if (!csvRes.ok) throw new Error(`Failed to fetch example CSV (${csvRes.status})`);
      if (!yamlRes.ok) throw new Error(`Failed to fetch example config (${yamlRes.status})`);
      const [csvText, yamlText] = await Promise.all([csvRes.text(), yamlRes.text()]);

      // Pre-load charts_json if specified, resolving relative paths against BASE
      let chartsData: Record<string, ChartSpec> | undefined;
      const chartsMatch = yamlText.match(/^\s*charts_json:\s*["']?([^"'\n#]+?)["']?\s*$/m);
      if (chartsMatch) {
        const path = chartsMatch[1].trim();
        const url = path.startsWith("http") ? path : `${BASE}${path}`;
        try {
          const res = await fetch(url);
          if (res.ok) chartsData = await res.json();
        } catch { /* charts unavailable, continue without */ }
      }

      // Pre-load metadata_csv if specified (left-joined by transform on dataset_key)
      let metadataCsvText: string | undefined;
      const metaMatch = yamlText.match(/^\s*metadata_csv:\s*["']?([^"'\n#]+?)["']?\s*$/m);
      if (metaMatch) {
        const metaPath = metaMatch[1].trim();
        const csvBase = ex.csv.replace(/[^/]+$/, "");
        const metaUrl = (metaPath.startsWith("http") ? metaPath : csvBase + metaPath) + bust;
        try {
          const res = await fetch(metaUrl);
          if (res.ok) metadataCsvText = await res.text();
        } catch { /* metadata unavailable, continue without */ }
      }

      await runTransform(csvText, yamlText, chartsData, metadataCsvText);
    } catch (e) {
      setPhase({ tag: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [runTransform]);

  const handleDownload = useCallback(async () => {
    if (phase.tag !== "ready") return;
    try {
      await downloadStandaloneHtml(phase.data, TEMPLATE_URL);
    } catch (e) {
      alert(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [phase]);

  const handleReset = useCallback(() => {
    setPhase({ tag: "landing" });
    setCsvFile(null);
    setYamlFile(null);
  }, []);

  // Deep-link auto-load: ?dataset=<key> loads the matching example once on mount.
  const didAutoload = useRef(false);
  useEffect(() => {
    if (didAutoload.current || !DATASET_PARAM) return;
    didAutoload.current = true;
    const ex = EXAMPLES.find(e => e.key === DATASET_PARAM);
    if (ex) {
      handleExample(ex);
    } else {
      const known = EXAMPLES.map(e => e.key).join(", ");
      setPhase({ tag: "error", message: `Unknown dataset key "${DATASET_PARAM}". Known keys: ${known}` });
    }
  }, [handleExample]);

  // Chrome-free figure capture: when both ?dataset and ?figure are present,
  // render FigureMode directly (no landing UI, no download bar).
  if (FIGURE_PARAM && phase.tag === "ready") {
    return (
      <ThemeProvider scheme={phase.data.config.colour_scheme ?? DEFAULT_SCHEME} forcedMode={VIEW.theme}>
        <FigureMode figureId={FIGURE_PARAM} data={phase.data} view={VIEW} />
      </ThemeProvider>
    );
  }

  if (phase.tag === "ready") {
    const BAR_H = UI_FULL ? 0 : 52; // DownloadBar height: 8px padding × 2 + ~36px buttons
    return (
      <ThemeProvider scheme={phase.data.config.colour_scheme ?? DEFAULT_SCHEME} forcedMode={VIEW.theme}>
        <div style={{ width: "100vw", height: `calc(100vh - ${BAR_H}px)`, position: "relative", overflow: "hidden" }} key={phase.key}>
          <App data={phase.data} view={VIEW} />
          {!UI_FULL && <DownloadBar onDownload={handleDownload} onReset={handleReset} />}
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider scheme={DEFAULT_SCHEME} forcedMode={VIEW.theme}>
      <LandingPanel
        phase={phase}
        csvFile={csvFile}
        yamlFile={yamlFile}
        onCsvChange={setCsvFile}
        onYamlChange={setYamlFile}
        onUpload={handleUpload}
        onExample={handleExample}
      />
    </ThemeProvider>
  );
}

// Compact light/dark toggle for the landing page (top-right corner).
function LandingModeToggle() {
  const { mode, setMode } = useTheme();
  const btn = (m: "light" | "dark"): React.CSSProperties => ({
    padding: "4px 9px", fontSize: 13, cursor: "pointer", lineHeight: 1,
    borderRadius: 6, fontFamily: FONT,
    background: mode === m ? CARD_BG : "transparent",
    border: `1px solid ${mode === m ? TEXT_MUTED : PANEL_BORDER}`,
    color: mode === m ? TEXT : TEXT_DIM,
  });
  return (
    <div style={{ position: "fixed", top: 14, right: 14, display: "flex", gap: 4, zIndex: 10 }}>
      <button style={btn("light")} onClick={() => setMode("light")} title="Light mode">☀</button>
      <button style={btn("dark")} onClick={() => setMode("dark")} title="Dark mode">☾</button>
    </div>
  );
}

// ── Landing panel ─────────────────────────────────────────────────────────────

interface LandingPanelProps {
  phase: Phase;
  csvFile: File | null;
  yamlFile: File | null;
  onCsvChange: (f: File | null) => void;
  onYamlChange: (f: File | null) => void;
  onUpload: () => void;
  onExample: (ex: ExampleDef) => void;
}

function LandingPanel({ phase, csvFile, yamlFile, onCsvChange, onYamlChange, onUpload, onExample }: LandingPanelProps) {
  const isLoading = phase.tag === "loading";

  return (
    <div style={{
      minHeight: "100vh",
      background: PAGE_GRADIENT,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: FONT,
      padding: 24,
    }}>
      <LandingModeToggle />
      <div style={{
        background: PANEL_BG,
        backdropFilter: "blur(10px)",
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 12,
        padding: "36px 40px",
        boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
        width: 460,
        maxWidth: "100%",
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEXT }}>metacube Playground</div>
          <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 4 }}>
            Upload a CSV and YAML config to render an interactive 3D cube in your browser.
            Files stay on your device — nothing is uploaded.
          </div>
        </div>

        {/* Upload section */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          <FileInput label="CSV data file" accept=".csv" file={csvFile} onChange={onCsvChange} disabled={isLoading} />
          <FileInput label="YAML config file" accept=".yaml,.yml" file={yamlFile} onChange={onYamlChange} disabled={isLoading} />
          <button
            onClick={onUpload}
            disabled={!csvFile || !yamlFile || isLoading}
            style={primaryButtonStyle(!csvFile || !yamlFile || isLoading)}
          >
            Render
          </button>
        </div>

        <Divider label="or try an example" />

        {/* Example buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {EXAMPLES.filter(ex => !ex.hidden).map(ex => (
            <button
              key={ex.label}
              onClick={() => onExample(ex)}
              disabled={isLoading}
              style={secondaryButtonStyle(isLoading)}
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/* Status messages */}
        {phase.tag === "loading" && (
          <div style={{ marginTop: 20, fontSize: 13, color: TEXT_MUTED, textAlign: "center" }}>
            {phase.message}
          </div>
        )}
        {phase.tag === "error" && (
          <div style={{
            marginTop: 20, fontSize: 12, color: "#ef4444",
            background: "rgba(239,68,68,0.15)", borderRadius: 6, padding: "10px 14px",
            wordBreak: "break-word",
          }}>
            <strong>Error:</strong> {phase.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Download bar (overlaid on the cube view) ──────────────────────────────────

function DownloadBar({ onDownload, onReset }: { onDownload: () => void; onReset: () => void }) {
  return (
    <div style={{
      position: "fixed",
      bottom: 0, left: 0, right: 0,
      zIndex: 100,
      background: PANEL_BG,
      backdropFilter: "blur(10px)",
      borderTop: `1px solid ${PANEL_BORDER}`,
      padding: "8px 16px",
      display: "flex",
      justifyContent: "flex-end",
      gap: 8,
      fontFamily: FONT,
    }}>
      <button onClick={onDownload} style={primaryButtonStyle(false)}>
        Download HTML
      </button>
      <button onClick={onReset} style={secondaryButtonStyle(false)}>
        New dataset
      </button>
    </div>
  );
}

// ── File input ────────────────────────────────────────────────────────────────

function FileInput({ label, accept, file, onChange, disabled }: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div style={{ fontSize: 12, color: TEXT_BODY, marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 13,
          color: file ? TEXT : TEXT_DIM,
          cursor: disabled ? "not-allowed" : "pointer",
          background: disabled ? CARD_BG : PANEL_BG,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          userSelect: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file ? file.name : `Choose ${accept} file…`}
        </span>
        {file && (
          <span
            onClick={e => { e.stopPropagation(); onChange(null); }}
            style={{ marginLeft: 8, color: TEXT_DIM, cursor: "pointer", flexShrink: 0 }}
          >
            ✕
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={e => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: PANEL_BORDER }} />
      <span style={{ fontSize: 12, color: TEXT_DIM, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: PANEL_BORDER }} />
    </div>
  );
}

// ── Button styles ─────────────────────────────────────────────────────────────

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 6,
    border: "none",
    background: disabled ? CARD_BG : ASAP.green,
    color: disabled ? TEXT_DIM : "white",
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    width: "100%",
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 6,
    border: `1px solid ${PANEL_BORDER}`,
    background: disabled ? CARD_BG : PANEL_BG,
    color: disabled ? TEXT_DIM : TEXT_BODY,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    width: "100%",
  };
}
