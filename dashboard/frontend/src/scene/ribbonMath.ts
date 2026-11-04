import * as THREE from "three";
import type { Pose } from "./poses";

/** The shader's `Pose` struct, as the JS object three.js uploads to it. */
export interface PoseUniform {
  center: THREE.Vector3;
  rot: THREE.Matrix3;
  scale: number;
  band: number;
  depth: number;
  thick: number;
  twist: number;
  phase: number;
  breath: number;
  color: THREE.Color;
  edge: THREE.Color;
}

export const makePoseUniform = (): PoseUniform => ({
  center: new THREE.Vector3(), rot: new THREE.Matrix3(), scale: 1, band: 0.3, depth: 0.03,
  thick: 0.01, twist: 0.5, phase: 0, breath: 1, color: new THREE.Color(), edge: new THREE.Color(),
});

/** Deterministic per-slat random number in [0, 1), for the shader's per-slat shading. */
export const rand = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Same curve as the shader: an infinity sign, with some depth so its two strands pass at the crossing. */
function curve(t: number, out: THREE.Vector3) {
  return out.set(Math.sin(t), 0.6 * Math.sin(2 * t), 0.32 * Math.cos(t));
}

// The curve's length (for scale 1), so slat thickness can be a fixed share of the spacing between slats.
const LENGTH = (() => {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < 2000; i++) {
    curve((i / 2000) * Math.PI * 2, a);
    curve(((i + 1) / 2000) * Math.PI * 2, b);
    len += a.distanceTo(b);
  }
  return len;
})();

const euler = new THREE.Euler();
const m4 = new THREE.Matrix4();

/**
 * Fill the pose uniform for this frame: rocking, twist flow and colours included.
 * `lift` raises the whole figure (world units), so it can leave with the page.
 */
export function writePose(
  out: PoseUniform, pose: Pose, time: number, count: number, lift: number, color: THREE.Color, edge: THREE.Color,
) {
  out.center.set(pose.center[0], pose.center[1] + lift, pose.center[2]);
  euler.set(
    pose.tilt[0] + pose.sway[0] * Math.sin(time * 0.23),
    pose.tilt[1] + pose.sway[1] * Math.sin(time * 0.17 + 1.3),
    pose.tilt[2] + pose.sway[2] * Math.sin(time * 0.11 + 2.1),
  );
  out.rot.setFromMatrix4(m4.makeRotationFromEuler(euler));
  out.scale = pose.scale;
  out.band = pose.band * pose.scale;
  out.depth = pose.depth * pose.scale;
  out.thick = (0.34 * LENGTH * pose.scale) / count; // a third slat, two thirds gap
  out.twist = pose.twist;
  out.phase = pose.flow * time;
  out.breath = pose.breath;
  out.color.copy(color);
  out.edge.copy(edge);
}

const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
const side = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);

/** Centre of slat `u` (0..1 along the band) in pose `p` (mirrors `place()` in the vertex shader). */
export function slatCenter(p: PoseUniform, u: number, time: number, out: THREE.Vector3) {
  const t = u * Math.PI * 2;
  curve(t, c);
  curve(t + 0.004, a);
  curve(t - 0.004, b);
  side.subVectors(a, b).normalize().cross(Z).normalize();
  c.multiplyScalar(1 + 0.035 * p.breath * Math.sin(time * 0.8));
  c.addScaledVector(side, 0.022 * p.breath * Math.sin(3 * t + time * 1.1));
  return out.copy(c).multiplyScalar(p.scale).applyMatrix3(p.rot).add(p.center);
}
