import { PANEL_BG, PANEL_BORDER, TEXT_BODY } from "../data/theme";

interface CameraPresetsProps {
  onSetCamera: (position: [number, number, number]) => void;
}

// Distance of the default view from the origin; the axis-aligned views keep it
// so every preset frames the cube at the same size.
const DEFAULT_POS: [number, number, number] = [6.0, 4.5, 6.0];
const DIST = Math.hypot(...DEFAULT_POS);

/** Camera positions exported so figure capture (?camera=…) uses the same views. */
export const CAMERA_PRESETS: { key: string; label: string; title: string; pos: [number, number, number] }[] = [
  { key: "default", label: "Default", title: "Default 3/4 view (the start-up camera)", pos: DEFAULT_POS },
  { key: "front",   label: "Front",   title: "Look along the Z axis", pos: [0, 0, DIST] },
  { key: "top",     label: "Top",     title: "Look down the Y axis", pos: [0, DIST, 0.01] },
  { key: "side",    label: "Side",    title: "Look along the X axis", pos: [DIST, 0, 0] },
];

const btnStyle: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 11,
  background: PANEL_BG,
  border: `1px solid ${PANEL_BORDER}`,
  color: TEXT_BODY,
  borderRadius: 5,
  cursor: "pointer",
  backdropFilter: "blur(10px)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};

export function CameraPresets({ onSetCamera }: CameraPresetsProps) {
  return (
    <div
      data-testid="camera-presets"
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        display: "flex",
        gap: 4,
        zIndex: 100,
      }}
    >
      {CAMERA_PRESETS.map((p) => (
        <button key={p.key} style={btnStyle} title={p.title} onClick={() => onSetCamera(p.pos)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
