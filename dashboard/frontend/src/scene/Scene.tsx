import { Canvas } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { useState } from "react";
import { Ribbon } from "./Ribbon";

export interface SceneProps {
  progress: MotionValue<number>;
  moisture: number | null;
  compact: boolean;
  reduceMotion: boolean;
}

/**
 * The WebGL layer behind the pages. It's loaded lazily (see App.tsx), so the dashboard's text and
 * numbers appear first and the ~200 kB of three.js arrives a moment later and fades in.
 */
export default function Scene(props: SceneProps) {
  const [ready, setReady] = useState(false);
  return (
    <div className={`scene${ready ? " is-ready" : ""}`} aria-hidden="true">
      <Canvas
        flat // no tone mapping: the slat colours come out exactly as specified
        dpr={[1, props.compact ? 1.75 : 2]}
        camera={{ fov: 30, position: [0, 0, 12], near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={() => setReady(true)}
      >
        <Ribbon {...props} />
      </Canvas>
    </div>
  );
}
