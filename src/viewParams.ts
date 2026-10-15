// URL-driven initial view state, used by the playground deep links and the
// figure-capture script to open the app in a reproducible state:
//
//   ?x=…&y=…&z=…        pre-select (and drill into) this outer cell
//   ?slice=1            open the 2D slice in the details panel
//   ?theme=light|dark   force the colour mode (ignores the remembered choice)
//   ?camera=top         start from a named camera preset (default|front|top|side)
//   ?zoom=0.9           scale the camera distance (<1 closer, >1 farther)
//   ?treemap=small      start the zoom-mode treemap panel compact (bottom right); also "medium"

import { CAMERA_PRESETS } from "./components/CameraPresets";

export interface ViewParams {
  cell?: { x: string; y: string; z: string };
  slice?: boolean;
  theme?: "light" | "dark";
  cameraPosition?: [number, number, number];
  treemapSize?: { w: number; h: number };
}

export const SMALL_TREEMAP = { w: 400, h: 270 };
export const MEDIUM_TREEMAP = { w: 470, h: 320 };

export function readViewParams(search: string = window.location.search): ViewParams {
  const p = new URLSearchParams(search);
  const out: ViewParams = {};
  const x = p.get("x"), y = p.get("y"), z = p.get("z");
  if (x && y && z) out.cell = { x, y, z };
  if (p.get("slice") === "1" || p.get("slice") === "true") out.slice = true;
  const theme = p.get("theme");
  if (theme === "light" || theme === "dark") out.theme = theme;
  const preset = CAMERA_PRESETS.find((c) => c.key === p.get("camera"));
  const zoom = parseFloat(p.get("zoom") ?? "");
  if (preset || Number.isFinite(zoom)) {
    const base = preset?.pos ?? CAMERA_PRESETS[0].pos;
    const k = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    out.cameraPosition = [base[0] * k, base[1] * k, base[2] * k];
  }
  if (p.get("treemap") === "small") out.treemapSize = SMALL_TREEMAP;
  if (p.get("treemap") === "medium") out.treemapSize = MEDIUM_TREEMAP;
  return out;
}
