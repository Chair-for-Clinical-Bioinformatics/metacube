import { useRef, useState } from "react";
import * as THREE from "three";
import { ThreeEvent } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import type { CubeCell } from "../data/dataModel";
import { useTheme } from "../data/themeContext";

/** How a cell relates to the current selection (clicked cell, axis filter, or
 *  dataset highlight). With no selection every cell is "normal". */
export type CellEmphasis = "normal" | "focus" | "dim";

interface CubeCellMeshProps {
  cell: CubeCell;
  position: [number, number, number];
  dimensions: [number, number, number];
  color: string;
  /** Base opacity used when nothing is selected (opacity slider × depth fade). */
  opacity: number;
  emphasis: CellEmphasis;
  /** The clicked cell itself — gets the thickest outline. */
  isSelected: boolean;
  isHovered: boolean;
  isGhost: boolean;
  isGhostHighlighted?: boolean;
  isAccent?: boolean;
  accentColor?: string;
  /** When true (gradient/size_colour mode), render data cells unlit so the encoded
   * colour is faithful — scene lighting must not modulate a value-carrying hue. */
  unlit?: boolean;
  onHover: (cell: CubeCell | null) => void;
  onClick: (cell: CubeCell) => void;
}

// threshold 1° draws only the 12 box edges; 0 would also draw each face's
// triangle diagonal, which reads as a busy wireframe.
const EDGE_THRESHOLD = 1;

// Unselected cells: no fill at all, only a clearly visible outline (theme
// edge_dim: grey in light mode, white in dark), and no depth writes so they
// never occlude the selection behind them.
const DIM_OPACITY = 0;
const DIM_EDGE_OPACITY = 0.6;

export function CubeCellMesh({
  cell, position, dimensions, color, opacity, emphasis,
  isSelected, isHovered, isGhost, isGhostHighlighted = false,
  isAccent = false, accentColor, unlit = false,
  onHover, onClick,
}: CubeCellMeshProps) {
  const { theme } = useTheme();
  const ref = useRef<THREE.Mesh>(null);
  const [localHover, setLocalHover] = useState(false);

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setLocalHover(true); onHover(cell); };
  const handlePointerOut  = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setLocalHover(false); onHover(null); };
  const handleClick       = (e: ThreeEvent<MouseEvent>)   => { e.stopPropagation(); onClick(cell); };

  const hovered = isHovered || localHover;
  const dim = emphasis === "dim" && !hovered;
  const focus = emphasis === "focus";

  if (isGhost) {
    const ghostOpacity = hovered ? 0.15 : isGhostHighlighted ? 0.18 : 0.0;
    const ghostEdge = hovered || isGhostHighlighted ? "#9fb4af" : "#6f8580";
    const ghostWidth = hovered ? 2.5 : isGhostHighlighted ? 2.0 : 1.5;
    return (
      <mesh ref={ref} position={position} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut} onClick={handleClick}>
        <boxGeometry args={dimensions} />
        <meshStandardMaterial color="#d1d5db" transparent opacity={ghostOpacity} />
        <Edges threshold={EDGE_THRESHOLD} color={ghostEdge} lineWidth={ghostWidth} />
      </mesh>
    );
  }

  const baseColor = isAccent ? (accentColor ?? theme.cell_accent) : color;
  const finalColor = dim ? theme.cell_dim : baseColor;
  const finalOpacity = dim ? DIM_OPACITY : focus ? 1.0 : opacity;
  // Base glow so cells self-illuminate against the dark gradient stage.
  const emissiveIntensity = hovered ? 0.55 : focus ? 0.4 : dim ? 0 : 0.22;

  const edgeColor = hovered ? theme.edge_hover
    : focus ? theme.edge_focus
    : dim ? theme.edge_dim
    : theme.edge;
  const edgeWidth = isSelected ? 3 : focus ? 2 : hovered ? 2 : 1;

  return (
    <mesh
      ref={ref}
      position={position}
      // Draw the selection after the dimmed context so it is never washed out.
      renderOrder={focus ? 2 : dim ? 0 : 1}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <boxGeometry args={dimensions} />
      {unlit && !isAccent ? (
        // Unlit: displayed colour == finalColor exactly, independent of lighting/normals,
        // so the value-encoding gradient reads faithfully. Hover/selection emphasis is
        // carried by the Edges below.
        <meshBasicMaterial color={finalColor} transparent opacity={finalOpacity} depthWrite={!dim} />
      ) : (
        <meshStandardMaterial color={finalColor} transparent opacity={finalOpacity} depthWrite={!dim} emissive={finalColor} emissiveIntensity={emissiveIntensity} />
      )}
      <Edges
        threshold={EDGE_THRESHOLD}
        color={edgeColor}
        lineWidth={edgeWidth}
        transparent={dim}
        opacity={dim ? DIM_EDGE_OPACITY : 1}
        depthWrite={!dim}
        renderOrder={focus ? 3 : dim ? 0 : 1}
      />
    </mesh>
  );
}
