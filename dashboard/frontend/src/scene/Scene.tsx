import { Canvas } from "@react-three/fiber";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useRef, useState } from "react";
import { anchorBus } from "./anchors";
import { Ribbon } from "./Ribbon";

export interface SceneProps {
  progress: MotionValue<number>;
  moisture: number | null;
  compact: boolean;
  reduceMotion: boolean;
}

const GONE_AT = 0.82; // like the overview's own content (see PageFrame), gone 0.82 pages away

/**
 * The WebGL layer behind the pages. It's loaded lazily (see App.tsx), so the dashboard's text and
 * numbers appear first and the ~200 kB of three.js arrives a moment later and fades in.
 * The ribbon only shows on the overview: it fades out as you leave the page, and the canvas stops
 * rendering until you come back.
 */
export default function Scene(props: SceneProps) {
  const { progress } = props;
  const [ready, setReady] = useState(false);
  const [awake, setAwake] = useState(() => progress.get() < GONE_AT);
  const awakeRef = useRef(awake);
  const opacity = useTransform(progress, (p) => Math.min(1, Math.max(0, 1 - p / GONE_AT)));

  useMotionValueEvent(progress, "change", (p) => {
    const on = p < GONE_AT;
    if (on === awakeRef.current) return;
    awakeRef.current = on;
    if (!on) anchorBus.visible = false; // the ribbon stops updating it once the frame loop stops
    setAwake(on);
  });

  return (
    <div className={`scene${ready ? " is-ready" : ""}`} aria-hidden="true">
      <motion.div className="scene-fade" style={{ opacity, visibility: awake ? "visible" : "hidden" }}>
        <Canvas
          frameloop={awake ? "always" : "never"}
          flat // no tone mapping: the slat colours come out exactly as specified
          dpr={[1, props.compact ? 1.75 : 2]}
          camera={{ fov: 30, position: [0, 0, 12], near: 0.1, far: 80 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={() => setReady(true)}
        >
          <Ribbon {...props} />
        </Canvas>
      </motion.div>
    </div>
  );
}
