import { useFrame } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { moistureColor, moistureEdge } from "../lib/moisture";
import { ANCHORS, anchorBus } from "./anchors";
import { overviewPose } from "./poses";
import { makePoseUniform, rand, slatCenter, writePose, type PoseUniform } from "./ribbonMath";
import { fragmentShader, vertexShader } from "./ribbonShader";

const PAGE_SLIDE = 0.12; // pages slide 12vh per page as you move between them (see PageFrame)
const PAGE_BG = "#ebeae6"; // --bg in base.css: the far slats fade toward it
const ORIGIN = new THREE.Vector3();
const point = new THREE.Vector3();

interface Props {
  offset: MotionValue<number>; // how far the overview is from the view, in pages
  moisture: number | null;
  compact: boolean;
  reduceMotion: boolean;
}

/** The infinity sign made of thin slats on the overview. As you leave the page, it slides away with it. */
export function Ribbon({ offset, moisture, compact, reduceMotion }: Props) {
  const count = compact ? 340 : 460;

  // Built once per slat count: one box geometry drawn `count` times, plus the shader material.
  const mesh = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const index = new Float32Array(count);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      index[i] = i;
      rnd[i] = rand(i);
    }
    geometry.setAttribute("aIndex", new THREE.InstancedBufferAttribute(index, 1));
    geometry.setAttribute("aRand", new THREE.InstancedBufferAttribute(rnd, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPose: { value: makePoseUniform() },
        uTime: { value: 0 },
        uCount: { value: count },
        uBg: { value: new THREE.Color(PAGE_BG) },
        uLight: { value: new THREE.Vector3(-0.35, 0.55, 0.75).normalize() },
      },
    });
    const m = new THREE.InstancedMesh(geometry, material, count);
    m.frustumCulled = false; // positions are computed in the shader, so three.js can't know the bounds
    return m;
  }, [count]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh],
  );

  // The slat colour eases toward the latest moisture reading instead of snapping.
  const target = useMemo(
    () => ({ color: new THREE.Color(moistureColor(moisture)), edge: new THREE.Color(moistureEdge(moisture)) }),
    [moisture],
  );
  const live = useRef({ color: target.color.clone(), edge: target.edge.clone(), time: 0 });

  useFrame((state, delta) => {
    const L = live.current;
    L.time += Math.min(delta, 0.1) * (reduceMotion ? 0.25 : 1);
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.5);
    L.color.lerp(target.color, k);
    L.edge.lerp(target.edge, k);

    const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
    // The page above the view (offset < 0) has slid up: lift the figure by as much (world y is up).
    const o = Math.max(-1, Math.min(1, offset.get()));
    const vp = state.viewport.getCurrentViewport(state.camera, ORIGIN);
    const pose = uniforms.uPose.value as PoseUniform;
    writePose(pose, overviewPose(vp.width, vp.height, compact), L.time, count, -o * PAGE_SLIDE * vp.height, L.color, L.edge);
    uniforms.uTime.value = L.time;

    // Screen positions of the slats the overview's leader lines point at.
    anchorBus.visible = Math.abs(o) < 0.98;
    if (anchorBus.visible) {
      ANCHORS.forEach(({ u }, j) => {
        const i = Math.round(u * count) % count;
        slatCenter(pose, i / count, L.time, point).project(state.camera);
        anchorBus.xy[2 * j] = ((point.x + 1) / 2) * state.size.width;
        anchorBus.xy[2 * j + 1] = ((1 - point.y) / 2) * state.size.height;
      });
    }
  });

  return <primitive object={mesh} />;
}
