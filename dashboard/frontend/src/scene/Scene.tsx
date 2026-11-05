import { Canvas } from "@react-three/fiber";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useRef, useState } from "react";
import { presence } from "../hooks/usePager";
import { anchorBus } from "./anchors";
import { Ribbon } from "./Ribbon";

export interface SceneProps {
  offset: MotionValue<number>; // how far the overview is from the view, in pages (see usePager)
  moisture: number | null;
  compact: boolean;
  reduceMotion: boolean;
}

const GONE_AT = 0.82; // like the overview's own content (see usePager's `presence`), gone 0.82 pages away

/**
 * The WebGL layer behind the pages. It's loaded lazily (see App.tsx), so the dashboard's text and
 * numbers appear first and the ~200 kB of three.js arrives a moment later and fades in.
 * The ribbon only shows on the overview: it fades out as you leave the page, and the canvas stops
 * rendering until you come back.
 */
export default function Scene(props: SceneProps) {
  const { offset } = props;
  const [ready, setReady] = useState(false);
  const [awake, setAwake] = useState(() => Math.abs(offset.get()) < GONE_AT);
  const awakeRef = useRef(awake);
  const opacity = useTransform(offset, presence);

  useMotionValueEvent(offset, "change", (o) => {
    const on = Math.abs(o) < GONE_AT;
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
