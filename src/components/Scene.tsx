import { useRef, useImperativeHandle, forwardRef, useContext } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CubeMap } from "./CubeMap";
import type { CubeRecord, CubeCell } from "../data/dataModel";
import type { ScaleMode, SortMode } from "../hooks/useStore";
import type { CubeConfig, AxisGroup } from "../data/config";
import { PAGE_GRADIENT } from "../data/theme";
import { ThemeContext } from "../data/themeContext";

interface SceneProps {
  records: CubeRecord[];
  scaleMode: ScaleMode;
  sortMode: SortMode;
  config: CubeConfig;
  cellOpacity: number;
  xFilter: Set<string>;
  yFilter: Set<string>;
  zFilter: Set<string>;
  hoveredCell: CubeCell | null;
  selectedCell: CubeCell | null;
  selectedCells?: Set<string>;
  onHover: (c: CubeCell | null) => void;
  onSelect: (c: CubeCell) => void;
  onZoomComplete?: () => void;
  zoomTarget?: [number, number, number] | null;
  zoomingBack?: boolean;
  onZoomBackDone?: () => void;
  axisXs?: string[];
  axisYs?: string[];
  axisZs?: string[];
  fontScale?: number;
  hideAxisTitles?: boolean;
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  xGroups?: AxisGroup[];
  yGroups?: AxisGroup[];
  zGroups?: AxisGroup[];
  onToggleX?: (v: string) => void;
  onToggleY?: (v: string) => void;
  onToggleZ?: (v: string) => void;
  uniformCellColor?: string;
  background?: string;
  /** WebGL pixel ratio. Default caps at 2× for performance; figure capture passes
   *  the full device ratio so high-scale screenshots are rendered, not upscaled. */
  dpr?: number;
}

export interface SceneHandle {
  setCamera: (pos: [number, number, number]) => void;
  resetView: () => void;
}

const DEFAULT_CAM = new THREE.Vector3(6.0, 4.5, 6.0);
const ZOOM_OFFSET = 0.6;
const DEFAULT_FOV = 45;
const MIN_DISTANCE = 0.3;
const MAX_DISTANCE = 15;

function CameraController(
  { zoomTarget, onZoomComplete, zoomingBack, onZoomBackDone }: {
    zoomTarget?: [number, number, number] | null;
    onZoomComplete?: () => void;
    zoomingBack?: boolean;
    onZoomBackDone?: () => void;
  },
  ref: React.ForwardedRef<SceneHandle>
) {
  const { camera } = useThree();
  const isZooming = useRef(false);
  const hasNotified = useRef(false);
  const targetPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());

  useImperativeHandle(ref, () => ({
    setCamera(pos: [number, number, number]) {
      camera.position.set(...pos);
      camera.lookAt(0, 0, 0);
    },
    resetView() {
      camera.position.copy(DEFAULT_CAM);
      camera.lookAt(0, 0, 0);
      isZooming.current = false;
      hasNotified.current = false;
    },
  }));

  useFrame(() => {
    if (zoomTarget && !zoomingBack) {
      if (!isZooming.current) {
        isZooming.current = true;
        hasNotified.current = false;
        const cellPos = new THREE.Vector3(...zoomTarget);
        const camDir = new THREE.Vector3().subVectors(camera.position, cellPos).normalize();
        targetPos.current.copy(cellPos).addScaledVector(camDir, ZOOM_OFFSET);
        targetLookAt.current.copy(cellPos);
      }
      camera.position.lerp(targetPos.current, 0.07);
      const lookTarget = new THREE.Vector3();
      camera.getWorldDirection(lookTarget);
      const desiredDir = new THREE.Vector3().subVectors(targetLookAt.current, camera.position).normalize();
      lookTarget.lerp(desiredDir, 0.1);
      camera.lookAt(camera.position.x + lookTarget.x, camera.position.y + lookTarget.y, camera.position.z + lookTarget.z);
      if (camera.position.distanceTo(targetPos.current) < 0.03 && !hasNotified.current) {
        hasNotified.current = true;
        onZoomComplete?.();
      }
    } else if (zoomingBack) {
      camera.position.lerp(DEFAULT_CAM, 0.05);
      const lookTarget = new THREE.Vector3();
      camera.getWorldDirection(lookTarget);
      const toOrigin = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), camera.position).normalize();
      lookTarget.lerp(toOrigin, 0.08);
      camera.lookAt(camera.position.x + lookTarget.x, camera.position.y + lookTarget.y, camera.position.z + lookTarget.z);
      if (camera.position.distanceTo(DEFAULT_CAM) < 0.08) {
        camera.position.copy(DEFAULT_CAM);
        camera.lookAt(0, 0, 0);
        isZooming.current = false;
        hasNotified.current = false;
        onZoomBackDone?.();
      }
    } else {
      isZooming.current = false;
      hasNotified.current = false;
    }
  });

  return null;
}

const CameraControllerForwarded = forwardRef(CameraController);

export const Scene = forwardRef<SceneHandle, SceneProps>(function Scene(props, ref) {
  const camRef = useRef<SceneHandle>(null);
  // R3F's <Canvas> renders in a separate reconciler; React context does not cross
  // it automatically, so capture the theme here and re-provide it inside.
  const themeCtx = useContext(ThemeContext);

  useImperativeHandle(ref, () => ({
    setCamera(pos) { camRef.current?.setCamera(pos); },
    resetView() { camRef.current?.resetView(); },
  }));

  const isAnimating = !!(props.zoomTarget || props.zoomingBack);
  const fov = props.cameraFov ?? DEFAULT_FOV;

  return (
    <Canvas
      camera={{
        position: props.cameraPosition ?? [DEFAULT_CAM.x, DEFAULT_CAM.y, DEFAULT_CAM.z],
        fov,
        near: 0.1,
        far: 100,
      }}
      dpr={props.dpr ?? [1, 2]}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
      style={{ width: "100%", height: "100%", background: props.background ?? PAGE_GRADIENT }}
      onPointerMissed={() => { if (!isAnimating) props.onSelect(null!); }}
    >
      <ThemeContext.Provider value={themeCtx}>
      <CameraControllerForwarded
        ref={camRef}
        zoomTarget={props.zoomTarget}
        onZoomComplete={props.onZoomComplete}
        zoomingBack={props.zoomingBack}
        onZoomBackDone={props.onZoomBackDone}
      />
      <ambientLight intensity={0.95} />
      <directionalLight position={[5, 8, 5]} intensity={0.7} />
      <directionalLight position={[-3, 3, -2]} intensity={0.3} />
      <OrbitControls
        enableDamping dampingFactor={0.08}
        minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE}
        enabled={!isAnimating}
      />
      <CubeMap
        records={props.records}
        scaleMode={props.scaleMode}
        sortMode={props.sortMode}
        config={props.config}
        cellOpacity={props.cellOpacity}
        xFilter={props.xFilter}
        yFilter={props.yFilter}
        zFilter={props.zFilter}
        hoveredCell={props.hoveredCell}
        selectedCell={props.selectedCell}
        selectedCells={props.selectedCells}
        onHover={props.onHover}
        onSelect={props.onSelect}
        axisXs={props.axisXs}
        axisYs={props.axisYs}
        axisZs={props.axisZs}
        xGroups={props.xGroups}
        yGroups={props.yGroups}
        zGroups={props.zGroups}
        fontScale={props.fontScale}
        hideAxisTitles={props.hideAxisTitles}
        onToggleX={props.onToggleX}
        onToggleY={props.onToggleY}
        onToggleZ={props.onToggleZ}
        uniformCellColor={props.uniformCellColor}
      />
      </ThemeContext.Provider>
    </Canvas>
  );
});
