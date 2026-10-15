import { useState, useRef, useCallback } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text, Billboard, Html } from "@react-three/drei";
import type { AxisGroup } from "../data/config";
import { getAxisColor, getAxisColorDim, AXIS_COLORS } from "../data/colors";
import type { CubeConfig } from "../data/config";
import { useTheme } from "../data/themeContext";

interface AxisLabelsProps {
  xs: string[];
  ys: string[];
  zs: string[];
  cubeSize: number;
  gap: number;
  bandX: number;
  bandY: number;
  bandZ: number;
  config: CubeConfig;
  dataXs?: Set<string>;
  dataYs?: Set<string>;
  dataZs?: Set<string>;
  fontScale?: number;
  hideAxisTitles?: boolean;
  activeXs?: Set<string>;
  activeYs?: Set<string>;
  activeZs?: Set<string>;
  partialXs?: Set<string>;
  partialYs?: Set<string>;
  partialZs?: Set<string>;
  filterMatchXs?: Set<string>;
  filterMatchYs?: Set<string>;
  filterMatchZs?: Set<string>;
  xGroups?: AxisGroup[];
  yGroups?: AxisGroup[];
  zGroups?: AxisGroup[];
  onToggleX?: (v: string) => void;
  onToggleY?: (v: string) => void;
  onToggleZ?: (v: string) => void;
  onLabelHover?: (axis: "x" | "y" | "z", value: string) => void;
  onLabelHoverEnd?: () => void;
}

// ── View-dependent layout ─────────────────────────────────────────────────────
//
// Each axis's labels sit along one of the four cube edges parallel to it. Every
// frame we (1) move them to the silhouette edge facing the viewer (lowest edge on
// screen for X/Z, leftmost for Y), (2) rotate value labels perpendicular to the
// axis as it appears on screen, so neighbours stack by text height rather than
// width, and (3) fade labels whose on-screen spacing is too tight to read — never
// below MIN_FADE, so nothing disappears. Group headers and titles are pushed out
// past the longest label. Discrete choices (edge, anchors) go through React state;
// continuous ones (rotation, opacity, title offsets) are written to the objects.

type Axis = "x" | "y" | "z";
/** Signs of the two coordinates that pick an edge: x → [y, z], y → [x, z], z → [x, y]. */
type Edge = [number, number];
type AnchorX = "left" | "center" | "right";
type AnchorY = "top" | "middle" | "bottom";

interface AxisLayout {
  edge: Edge;
  labelAnchorX: AnchorX;
  labelAnchorY: AnchorY;
  outerAnchorX: AnchorX;
  outerAnchorY: AnchorY;
}

const AXES: Axis[] = ["x", "y", "z"];
const EDGES: Edge[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const INITIAL_LAYOUT: Record<Axis, AxisLayout> = {
  x: { edge: [-1, 1], labelAnchorX: "center", labelAnchorY: "middle", outerAnchorX: "center", outerAnchorY: "top" },
  y: { edge: [-1, 1], labelAnchorX: "right", labelAnchorY: "middle", outerAnchorX: "right", outerAnchorY: "middle" },
  z: { edge: [1, -1], labelAnchorX: "left", labelAnchorY: "middle", outerAnchorX: "left", outerAnchorY: "middle" },
};

/** World gap between the cube edge and a value label's anchor. */
const LABEL_GAP = 0.2;
/** World gap between consecutive label rings (values → group headers → title). */
const RING_PAD = 0.08;
/** Lowest opacity a crowded label fades to. */
const MIN_FADE = 0.18;
/** Edge switch hysteresis in NDC units, so labels don't flicker near ties. */
const EDGE_HYSTERESIS = 0.03;
/** Rotations closer than this to horizontal (≈12°) snap to level text. */
const SNAP_LEVEL = THREE.MathUtils.degToRad(12);
/** Approximate glyph advance (em) for text whose layout hasn't synced yet. */
const GLYPH_EM = 0.55;

function edgePoint(axis: Axis, [a, b]: Edge, t: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (axis === "x") return out.set(t, a * h, b * h);
  if (axis === "y") return out.set(a * h, t, b * h);
  return out.set(a * h, b * h, t);
}

function outwardDir(axis: Axis, [a, b]: Edge, out = new THREE.Vector3()): THREE.Vector3 {
  if (axis === "x") return out.set(0, a, b).normalize();
  if (axis === "y") return out.set(a, 0, b).normalize();
  return out.set(a, b, 0).normalize();
}

type TroikaText = THREE.Mesh & {
  fillOpacity: number;
  outlineOpacity: number;
  fontSize: number;
  text: string;
  textRenderInfo?: { blockBounds: [number, number, number, number] } | null;
};

/** Text block size in world units (falls back to an estimate before first sync). */
function textSize(t: TroikaText): [number, number] {
  const bb = t.textRenderInfo?.blockBounds;
  if (bb) return [bb[2] - bb[0], bb[3] - bb[1]];
  return [String(t.text ?? "").length * GLYPH_EM * t.fontSize, t.fontSize * 1.2];
}

/** Anchor for horizontal text placed outward along screen direction n. */
function anchorsFor(n: THREE.Vector2): [AnchorX, AnchorY] {
  if (Math.abs(n.x) > 0.7) return [n.x > 0 ? "left" : "right", "middle"];
  return ["center", n.y < 0 ? "top" : "bottom"];
}

function BillboardLabel({
  position, text, fontSize, color, anchorX, anchorY, fontWeight, rotation, textRef, onClick, onPointerOver, onPointerOut,
}: {
  position?: [number, number, number];
  text: string;
  fontSize: number;
  color: string;
  anchorX?: AnchorX;
  anchorY?: AnchorY;
  fontWeight?: "bold" | "normal";
  /** In-plane rotation (radians) applied within the camera-facing billboard. e.g. [0,0,Math.PI/2] → text reads bottom-to-top. */
  rotation?: [number, number, number];
  textRef?: (t: TroikaText | null) => void;
  onClick?: (event: any) => void;
  onPointerOver?: (event: any) => void;
  onPointerOut?: (event: any) => void;
}) {
  const { theme, mode } = useTheme();
  // The text outline separates labels from the busy dark stage. In light mode
  // (dark text on a light page) it's an unwanted halo, so drop it there.
  const outline = mode === "dark";
  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <Text
        ref={textRef as any}
        fontSize={fontSize}
        color={color}
        anchorX={anchorX ?? "center"}
        anchorY={anchorY ?? "middle"}
        fontWeight={fontWeight}
        rotation={rotation}
        outlineWidth={outline ? fontSize * 0.14 : 0}
        outlineColor={theme.axis_outline}
        outlineOpacity={outline ? 0.9 : 0}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        {text}
      </Text>
    </Billboard>
  );
}

export function AxisLabels({
  xs, ys, zs,
  cubeSize, gap, bandX, bandY, bandZ,
  config,
  dataXs, dataYs, dataZs,
  fontScale = 1.3,
  hideAxisTitles = false,
  activeXs, activeYs, activeZs,
  partialXs, partialYs, partialZs,
  filterMatchXs, filterMatchYs, filterMatchZs,
  xGroups, yGroups,
  onToggleX, onToggleY, onToggleZ,
  onLabelHover, onLabelHoverEnd,
}: AxisLabelsProps) {
  const { theme, mode } = useTheme();
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{ text: string; pos: [number, number, number] } | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<{ text: string; pos: [number, number, number] } | null>(null);

  const rotateLabels = (config.labelRotation ?? "auto") === "auto";
  const [layout, setLayout] = useState<Record<Axis, AxisLayout>>(INITIAL_LAYOUT);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Objects updated every frame: value-label meshes, and the groups holding the
  // group headers / titles (positioned along the outward direction).
  const labelRefs = useRef<Record<Axis, (TroikaText | null)[]>>({ x: [], y: [], z: [] });
  // Per-label base opacity: labels unavailable under the active filters are
  // dimmed; the per-frame crowding fade multiplies onto this.
  const labelBase = useRef<Record<Axis, number[]>>({ x: [], y: [], z: [] });
  const groupHeaderRefs = useRef<Record<Axis, Map<string, { obj: THREE.Object3D | null; text: TroikaText | null; t: number; tilt: boolean }>>>({
    x: new Map(), y: new Map(), z: new Map(),
  });
  const titleRefs = useRef<Record<Axis, THREE.Object3D | null>>({ x: null, y: null, z: null });
  const titleTextRefs = useRef<Record<Axis, TroikaText | null>>({ x: null, y: null, z: null });

  const half = cubeSize / 2;
  const fs = (base: number) => base * fontScale;

  const xPos = (i: number) => -half + gap * (i + 1) + bandX * i + bandX / 2;
  const yPos = (j: number) => -half + gap * (j + 1) + bandY * j + bandY / 2;
  const zPos = (k: number) => -half + gap * (k + 1) + bandZ * k + bandZ / 2;
  const tickPos: Record<Axis, (i: number) => number> = { x: xPos, y: yPos, z: zPos };
  const subLabel = (val: string, group: AxisGroup) => val.slice(group.label.length + group.separator.length);

  /** World position of a value label: on the active edge, nudged outward. */
  const labelWorldPos = (axis: Axis, t: number): [number, number, number] => {
    const p = edgePoint(axis, layout[axis].edge, t, half);
    p.addScaledVector(outwardDir(axis, layout[axis].edge), LABEL_GAP);
    return [p.x, p.y, p.z];
  };

  // ── Per-frame layout ───────────────────────────────────────────────────────
  const tmp = useRef({
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), o: new THREE.Vector3(),
    right: new THREE.Vector3(),
  }).current;

  useFrame(({ camera, size }) => {
    const w2 = size.width / 2;
    const h2 = size.height / 2;
    const toPx = (v: THREE.Vector3): THREE.Vector2 => {
      const p = tmp.c.copy(v).project(camera);
      return new THREE.Vector2(p.x * w2, p.y * h2);
    };
    const ndc = (v: THREE.Vector3) => tmp.c.copy(v).project(camera);
    tmp.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    // Screen pixels per world unit for a screen-parallel segment at point p.
    const pxPerWorld = (p: THREE.Vector3) => {
      const p0 = toPx(p);
      return toPx(tmp.a.copy(p).add(tmp.right)).distanceTo(p0);
    };
    const center = toPx(new THREE.Vector3(0, 0, 0));
    const next: Record<Axis, AxisLayout> = { ...layoutRef.current };
    let changed = false;

    for (const axis of AXES) {
      const cur = layoutRef.current[axis];

      // 1. Silhouette edge: lowest on screen for X/Z, leftmost for Y. Nearer edges
      //    win ties (ndc.z), and Z prefers the right-hand edge in top views.
      const score = (e: Edge) => {
        const m = ndc(edgePoint(axis, e, 0, half, tmp.b));
        if (axis === "y") return m.x + 0.05 * m.z;
        return m.y + 0.05 * m.z - (axis === "z" ? 0.01 * m.x : 0);
      };
      let best = cur.edge;
      let bestScore = score(cur.edge) - EDGE_HYSTERESIS;
      for (const e of EDGES) {
        const s = score(e);
        if (s < bestScore) { best = e; bestScore = s; }
      }
      const edge = best;

      // 2. Screen geometry of this edge: axis direction u, outward normal n.
      const A = toPx(edgePoint(axis, edge, -half, half, tmp.b));
      const B = toPx(edgePoint(axis, edge, half, half, tmp.b));
      const M = edgePoint(axis, edge, 0, half, new THREE.Vector3());
      const Mpx = toPx(M);
      const u = B.clone().sub(A);
      const axisLen = u.length();
      const outScreen = Mpx.clone().sub(center);
      let n: THREE.Vector2;
      if (axisLen < 1e-3) {
        u.set(1, 0);
        n = outScreen.lengthSq() > 1e-6 ? outScreen.clone().normalize() : new THREE.Vector2(0, -1);
      } else {
        u.divideScalar(axisLen);
        n = new THREE.Vector2(-u.y, u.x);
        if (n.dot(outScreen) < 0) n.negate();
      }

      // Value-label rotation/anchor. Auto: text runs outward along n, flipped to
      // stay readable (left-to-right); hysteresis keeps it from flipping near vertical.
      let labelAnchorX: AnchorX;
      let labelAnchorY: AnchorY = "middle";
      let theta = 0;
      if (rotateLabels) {
        const keepRight = cur.labelAnchorX === "right";
        const useRight = Math.abs(n.x) < 0.05 ? keepRight : n.x < 0;
        labelAnchorX = useRight ? "right" : "left";
        theta = useRight ? Math.atan2(-n.y, -n.x) : Math.atan2(n.y, n.x);
        // Nearly level text reads better perfectly level.
        if (Math.abs(theta) < SNAP_LEVEL) theta = 0;
      } else {
        [labelAnchorX, labelAnchorY] = anchorsFor(n);
      }
      const textDir = new THREE.Vector2(Math.cos(theta), Math.sin(theta));
      const textNormal = new THREE.Vector2(-textDir.y, textDir.x);

      // 3. Fade crowded labels; measure how far the labels reach outward.
      const meshes = labelRefs.current[axis];
      const ticks = meshes.map((_, i) => toPx(edgePoint(axis, edge, tickPos[axis](i), half, tmp.b)));
      let reach = 0;
      meshes.forEach((mesh, i) => {
        if (!mesh) return;
        mesh.rotation.z = theta;
        const s = pxPerWorld(edgePoint(axis, edge, tickPos[axis](i), half, tmp.o));
        const [ww, hw] = textSize(mesh);
        const W = ww * s;
        const H = hw * s;
        // How far the text reaches outward (for placing group headers / title).
        const alongOut = Math.abs(n.dot(textDir)) * W + Math.abs(n.dot(textNormal)) * H;
        reach = Math.max(reach, alongOut);
        // Neighbouring labels are offset by `spacing` along u. In the text's own
        // frame two equal boxes overlap only if they overlap both across the text
        // (offset < H) and along it (offset < W), so the clearance ratio is the
        // larger of the two; ≥ 1 means no overlap.
        let spacing = Infinity;
        if (i > 0) spacing = Math.min(spacing, ticks[i].distanceTo(ticks[i - 1]));
        if (i < ticks.length - 1) spacing = Math.min(spacing, ticks[i].distanceTo(ticks[i + 1]));
        const r = Math.max(
          (spacing * Math.abs(u.dot(textNormal))) / Math.max(H, 1e-3),
          (spacing * Math.abs(u.dot(textDir))) / Math.max(W, 1e-3),
        );
        const fade = Math.min(1, Math.max(MIN_FADE, (r - 0.5) / 0.5));
        const base = labelBase.current[axis][i] ?? 1;
        mesh.fillOpacity = fade * base;
        mesh.outlineOpacity = mode === "dark" ? 0.9 * fade * base : 0;
      });

      // 4. Rings: group headers just past the labels, then the title.
      const outW = outwardDir(axis, edge, new THREE.Vector3());
      const sM = pxPerWorld(M);
      const q = Math.max(toPx(tmp.a.copy(M).add(outW)).sub(Mpx).dot(n), 0.3 * sM);
      const ringGroup = LABEL_GAP + reach / q + RING_PAD;
      let groupReach = 0;
      for (const g of groupHeaderRefs.current[axis].values()) {
        if (!g.obj || !g.text) continue;
        const [ww, hw] = textSize(g.text);
        const W = ww * sM;
        const H = hw * sM;
        const ext = g.tilt ? Math.abs(n.x) * H + Math.abs(n.y) * W : Math.abs(n.x) * W + Math.abs(n.y) * H;
        groupReach = Math.max(groupReach, ext);
        const d = ringGroup + (g.tilt ? (ext / 2) / q : 0);
        edgePoint(axis, edge, g.t, half, g.obj.position).addScaledVector(outW, d);
      }
      const ringTitle = groupReach > 0 ? ringGroup + groupReach / q + RING_PAD : ringGroup;
      const title = titleRefs.current[axis];
      if (title) {
        if (axis === "y") {
          // Y title sits above the top of its edge rather than beside the labels.
          edgePoint(axis, edge, half + 0.16, half, title.position).addScaledVector(outW, LABEL_GAP);
        } else {
          edgePoint(axis, edge, 0, half, title.position).addScaledVector(outW, ringTitle);
        }
      }

      const [outerAnchorX, outerAnchorY] = axis === "y"
        ? [n.x < 0 ? "right" : "left", "middle"] as [AnchorX, AnchorY]
        : anchorsFor(n);
      const nextAxis: AxisLayout = { edge, labelAnchorX, labelAnchorY, outerAnchorX, outerAnchorY };
      if (
        nextAxis.edge[0] !== cur.edge[0] || nextAxis.edge[1] !== cur.edge[1] ||
        nextAxis.labelAnchorX !== cur.labelAnchorX || nextAxis.labelAnchorY !== cur.labelAnchorY ||
        nextAxis.outerAnchorX !== cur.outerAnchorX || nextAxis.outerAnchorY !== cur.outerAnchorY
      ) {
        next[axis] = nextAxis;
        changed = true;
      }
    }
    if (changed) {
      layoutRef.current = next;
      setLayout(next);
    }
  });

  const setLabelRef = useCallback((axis: Axis, i: number) => (t: TroikaText | null) => {
    labelRefs.current[axis][i] = t;
  }, []);
  // Drop stale refs when an axis shrinks (e.g. switching datasets).
  labelRefs.current.x.length = xs.length;
  labelRefs.current.y.length = ys.length;
  labelRefs.current.z.length = zs.length;

  const registerGroupHeader = (axis: Axis, key: string, t: number, tilt: boolean) => ({
    obj: (o: THREE.Object3D | null) => {
      const m = groupHeaderRefs.current[axis];
      if (!o) { m.delete(key); return; }
      m.set(key, { ...(m.get(key) ?? { text: null }), obj: o, t, tilt });
    },
    text: (tx: TroikaText | null) => {
      const m = groupHeaderRefs.current[axis];
      const e = m.get(key);
      if (e) e.text = tx;
      else if (tx) m.set(key, { obj: null, text: tx, t, tilt });
    },
  });

  // Tooltips for axis-title descriptions anchor at the title's current position.
  const titleHandlers = (axis: Axis, desc: string | undefined) => {
    if (!desc) return {};
    const pos = (): [number, number, number] => {
      const p = titleRefs.current[axis]?.position;
      return p ? [p.x, p.y, p.z] : [0, 0, 0];
    };
    return {
      onPointerOver: (e: any) => { e.stopPropagation(); setHoverTooltip({ text: desc, pos: pos() }); document.body.style.cursor = "pointer"; },
      onPointerOut:  (e: any) => { e.stopPropagation(); setHoverTooltip(null); document.body.style.cursor = ""; },
      onClick:       (e: any) => { e.stopPropagation(); setPinnedTooltip(p => p?.text === desc ? null : { text: desc, pos: pos() }); },
    };
  };

  const hoverHandlers = (key: string, axis: Axis, value: string) =>
    onToggleX || onToggleY || onToggleZ
      ? {
          onPointerOver: (e: any) => { e.stopPropagation(); setHoveredLabel(key); document.body.style.cursor = "pointer"; onLabelHover?.(axis, value); },
          onPointerOut:  (e: any) => { e.stopPropagation(); setHoveredLabel(null); document.body.style.cursor = ""; onLabelHoverEnd?.(); },
        }
      : {};

  // Per-axis colors: use config.axisColors overrides when available (e.g. inner zoom cube)
  const axColorX = config.axisColors?.x ?? AXIS_COLORS.x;
  const axColorY = config.axisColors?.y ?? AXIS_COLORS.y;
  const axColorZ = config.axisColors?.z ?? AXIS_COLORS.z;

  const axLabelColor = (axColor: string, isActive: boolean, isPartial: boolean, isHovered: boolean, hasData: boolean, inFilter: boolean) => {
    if (!hasData) return theme.text_dim;
    if (isActive) return axColor;                     // in filter → full axis colour
    if (isPartial || isHovered) return axColor;       // involved → prominent (was a white blend, invisible on light)
    if (inFilter) return theme.text;                  // available under the filters → full-contrast text
    return theme.text_dim;                            // not available → dim (plus reduced opacity, see labelBase)
  };
  // With a filter active, labels with no data under it drop to 30% opacity.
  const baseFor = (inFilter: boolean, isActive: boolean) => (inFilter || isActive ? 1 : 0.3);

  const handleGroupClick = (group: AxisGroup, e: any) => {
    e.stopPropagation();
    if (!onToggleX) return;
    const allOn = group.members.every((m) => activeXs?.has(m));
    if (allOn) group.members.filter((m) => activeXs?.has(m)).forEach((m) => onToggleX(m));
    else group.members.filter((m) => !activeXs?.has(m)).forEach((m) => onToggleX(m));
  };

  const handleGroupClickY = (group: AxisGroup, e: any) => {
    e.stopPropagation();
    if (!onToggleY) return;
    const allOn = group.members.every((m) => activeYs?.has(m));
    if (allOn) group.members.filter((m) => activeYs?.has(m)).forEach((m) => onToggleY(m));
    else group.members.filter((m) => !activeYs?.has(m)).forEach((m) => onToggleY(m));
  };

  // Titles use their axis colour, matching the axis chips in the details panel
  // and the highlighted value labels.
  const axisColor: Record<Axis, string> = { x: axColorX, y: axColorY, z: axColorZ };
  const renderTitle = (axis: Axis) => {
    const desc = config.axes[axis].description;
    const titleColor = pinnedTooltip?.text === desc && desc ? theme.accent : axisColor[axis];
    const { outerAnchorX, outerAnchorY } = layout[axis];
    return (
      <group ref={(o) => { titleRefs.current[axis] = o; }}>
        <BillboardLabel
          text={desc ? `${config.axes[axis].label} ?` : config.axes[axis].label}
          fontSize={fs(0.09)}
          color={titleColor}
          anchorX={outerAnchorX}
          anchorY={outerAnchorY}
          fontWeight="bold"
          textRef={(t) => { titleTextRefs.current[axis] = t; }}
          {...titleHandlers(axis, desc)}
        />
      </group>
    );
  };

  const { labelAnchorX: xAX, labelAnchorY: xAY } = layout.x;
  const { labelAnchorX: yAX, labelAnchorY: yAY } = layout.y;
  const { labelAnchorX: zAX, labelAnchorY: zAY } = layout.z;

  return (
    <group>
      {/* X axis value labels */}
      {xs.map((val, i) => {
        const hasData = dataXs ? dataXs.has(val) : true;
        const isActive = activeXs?.has(val) ?? false;
        const isPartial = !isActive && (partialXs?.has(val) ?? false);
        const isHovered = hoveredLabel === `x-${val}`;
        const group = xGroups?.find((g) => g.members.includes(val));
        const displayText = group ? subLabel(val, group) : val;
        const inFilter = filterMatchXs ? filterMatchXs.has(val) : true;
        labelBase.current.x[i] = baseFor(inFilter, isActive);

        let color: string;
        if (!hasData) {
          color = theme.text_dim;
        } else if (group) {
          const sc = getAxisColor(group.label, config);
          const scDim = getAxisColorDim(group.label, config);
          color = isActive || isPartial || isHovered || inFilter ? sc : scDim;
        } else {
          color = axLabelColor(axColorX, isActive, isPartial, isHovered, true, inFilter);
        }

        return (
          <BillboardLabel
            key={`x-${val}`}
            position={labelWorldPos("x", xPos(i))}
            text={displayText}
            fontSize={fs(hasData ? 0.055 : 0.04)}
            color={color}
            anchorX={xAX}
            anchorY={xAY}
            textRef={setLabelRef("x", i)}
            onClick={onToggleX ? (e) => { e.stopPropagation(); onToggleX(val); } : undefined}
            {...hoverHandlers(`x-${val}`, "x", val)}
          />
        );
      })}

      {/* X axis group headers */}
      {xGroups?.map((group) => {
        const indices = group.members.map((m) => xs.indexOf(m)).filter((i) => i >= 0).sort((a, b) => a - b);
        if (indices.length === 0) return null;

        // Centre the header on the group's span.
        const mid = Math.floor((indices.length - 1) / 2);
        const cx = indices.length === 1
          ? xPos(indices[0])
          : (xPos(indices[mid]) + xPos(indices[mid + 1])) / 2;

        const allOn = group.members.every((m) => activeXs?.has(m));
        const anyOn = group.members.some((m) => activeXs?.has(m));
        const anyMatch = filterMatchXs ? group.members.some((m) => filterMatchXs.has(m)) : true;
        const isHovered = hoveredLabel === `grp-${group.label}`;
        const sc = getAxisColor(group.label, config);
        const labelColor = anyOn || isHovered ? sc : anyMatch ? sc : getAxisColorDim(group.label, config);
        const reg = registerGroupHeader("x", group.label, cx, false);

        return (
          <group key={`grp-${group.label}`} ref={reg.obj}>
            <BillboardLabel
              text={`${allOn ? "▼ " : anyOn ? "◆ " : "▷ "}${group.label}`}
              fontSize={fs(0.078)}
              color={labelColor}
              fontWeight="bold"
              anchorX={layout.x.outerAnchorX}
              anchorY={layout.x.outerAnchorY}
              textRef={reg.text}
              onClick={(e) => handleGroupClick(group, e)}
              onPointerOver={(e: any) => { e.stopPropagation(); setHoveredLabel(`grp-${group.label}`); document.body.style.cursor = "pointer"; }}
              onPointerOut={(e: any) => { e.stopPropagation(); setHoveredLabel(null); document.body.style.cursor = ""; }}
            />
          </group>
        );
      })}

      {!hideAxisTitles && renderTitle("x")}

      {/* Y axis value labels */}
      {ys.map((val, j) => {
        const hasData = dataYs ? dataYs.has(val) : true;
        const isActive = activeYs?.has(val) ?? false;
        const isPartial = !isActive && (partialYs?.has(val) ?? false);
        const isHovered = hoveredLabel === `y-${val}`;
        const group = yGroups?.find((g) => g.members.includes(val));
        const displayText = group ? subLabel(val, group) : val;
        const inFilter = filterMatchYs ? filterMatchYs.has(val) : true;
        labelBase.current.y[j] = baseFor(inFilter, isActive);

        let color: string;
        if (!hasData) {
          color = theme.text_dim;
        } else if (group) {
          const sc = getAxisColor(group.label, config);
          const scDim = getAxisColorDim(group.label, config);
          color = isActive || isPartial || isHovered || inFilter ? sc : scDim;
        } else {
          color = axLabelColor(axColorY, isActive, isPartial, isHovered, hasData, inFilter);
        }

        return (
          <BillboardLabel
            key={`y-${val}`}
            position={labelWorldPos("y", yPos(j))}
            text={displayText}
            fontSize={fs(hasData ? 0.055 : 0.04)}
            color={color}
            anchorX={yAX}
            anchorY={yAY}
            textRef={setLabelRef("y", j)}
            onClick={onToggleY ? (e) => { e.stopPropagation(); onToggleY(val); } : undefined}
            {...hoverHandlers(`y-${val}`, "y", val)}
          />
        );
      })}

      {/* Y axis group headers */}
      {yGroups?.map((group) => {
        const indices = group.members.map((m) => ys.indexOf(m)).filter((i) => i >= 0).sort((a, b) => a - b);
        if (indices.length === 0) return null;

        // Place the group label in the gap between the two middle members.
        const ymid = Math.floor((indices.length - 1) / 2);
        const cy = indices.length === 1
          ? yPos(indices[0])
          : (yPos(indices[ymid]) + yPos(indices[ymid + 1])) / 2;
        const yTop    = yPos(indices[0]) + bandY * 0.42;
        const yBottom = yPos(indices[indices.length - 1]) - bandY * 0.42;
        const barCy   = (yTop + yBottom) / 2;

        const allOn    = group.members.every((m) => activeYs?.has(m));
        const anyOn    = group.members.some((m) => activeYs?.has(m));
        const anyMatch = filterMatchYs ? group.members.some((m) => filterMatchYs.has(m)) : true;
        const isHovG   = hoveredLabel === `grp-y-${group.label}`;
        const sc       = getAxisColor(group.label, config);
        const labelColor = anyOn || isHovG ? sc : anyMatch ? sc : getAxisColorDim(group.label, config);

        // When tilt_group_labels is set, the header is rotated to run vertically
        // (parallel to the Y axis), centred on the group's span and font-scaled to
        // fit it so short groups don't overflow into neighbours or the axis title.
        // Otherwise it stays a plain horizontal header beside the group.
        const tilt = config.tiltGroupLabels ?? false;
        // Group's true vertical extent; ~0.55 em average glyph advance.
        const groupHeight = Math.abs(yPos(indices[indices.length - 1]) - yPos(indices[0])) + bandY;
        const headerChars = group.label.length + 2; // + "▷ " prefix
        const headerFs = Math.min(fs(0.072), Math.max(0.038, (groupHeight * 0.9) / (headerChars * GLYPH_EM)));
        const reg = registerGroupHeader("y", group.label, tilt ? barCy : cy, tilt);

        return (
          <group key={`grp-y-${group.label}`} ref={reg.obj}>
            <BillboardLabel
              text={`${allOn ? "▼ " : anyOn ? "◆ " : "▷ "}${group.label}`}
              fontSize={tilt ? headerFs : fs(0.078)}
              color={labelColor}
              fontWeight="bold"
              anchorX={tilt ? "center" : layout.y.outerAnchorX}
              anchorY="middle"
              rotation={tilt ? [0, 0, Math.PI / 2] : undefined}
              textRef={reg.text}
              onClick={(e) => handleGroupClickY(group, e)}
              onPointerOver={(e: any) => { e.stopPropagation(); setHoveredLabel(`grp-y-${group.label}`); document.body.style.cursor = "pointer"; }}
              onPointerOut={(e: any) => { e.stopPropagation(); setHoveredLabel(null); document.body.style.cursor = ""; }}
            />
          </group>
        );
      })}

      {!hideAxisTitles && renderTitle("y")}

      {/* Z axis value labels */}
      {zs.map((val, k) => {
        const hasData = dataZs ? dataZs.has(val) : true;
        const isActive = activeZs?.has(val) ?? false;
        const isPartial = !isActive && (partialZs?.has(val) ?? false);
        const isHovered = hoveredLabel === `z-${val}`;
        const inFilter = filterMatchZs ? filterMatchZs.has(val) : true;
        labelBase.current.z[k] = baseFor(inFilter, isActive);
        const displayVal = val.includes(" - ") ? val.split(" - ").slice(1).join(" - ") : val;
        return (
          <BillboardLabel
            key={`z-${val}`}
            position={labelWorldPos("z", zPos(k))}
            text={displayVal}
            fontSize={fs(hasData ? 0.06 : 0.045)}
            color={axLabelColor(axColorZ, isActive, isPartial, isHovered, hasData, inFilter)}
            anchorX={zAX}
            anchorY={zAY}
            textRef={setLabelRef("z", k)}
            onClick={onToggleZ ? (e) => { e.stopPropagation(); onToggleZ(val); } : undefined}
            {...hoverHandlers(`z-${val}`, "z", val)}
          />
        );
      })}

      {!hideAxisTitles && renderTitle("z")}

      {/* Description tooltip (hover or pinned) */}
      {(pinnedTooltip ?? hoverTooltip) && (() => {
        const t = pinnedTooltip ?? hoverTooltip!;
        return (
          <Html position={t.pos} center zIndexRange={[400, 0]} style={{ pointerEvents: "none" }}>
            <div style={{
              transform: "translateY(calc(-100% - 10px))",
              background: "#1f2937", color: "#f9fafb",
              padding: "10px 14px", borderRadius: 8,
              fontSize: 12, minWidth: 180, maxWidth: 320, whiteSpace: "pre-line",
              pointerEvents: "none",
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
              lineHeight: 1.65, textAlign: "left",
              outline: pinnedTooltip ? `2px solid ${theme.accent}` : "none",
              outlineOffset: 2,
            }}>
              {t.text}
            </div>
          </Html>
        );
      })()}
    </group>
  );
}
