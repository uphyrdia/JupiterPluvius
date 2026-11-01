import * as THREE from "three";
import type { Pose } from "./poses";

/** The shader's `Pose` struct, as the JS object three.js uploads to it. */
export interface PoseUniform {
  center: THREE.Vector3;
  rot: THREE.Matrix3;
  scale: number;
  shape: number;
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
  center: new THREE.Vector3(), rot: new THREE.Matrix3(), scale: 1, shape: 0, band: 0.3, depth: 0.03,
  thick: 0.01, twist: 0.5, phase: 0, breath: 1, color: new THREE.Color(), edge: new THREE.Color(),
});

/** Deterministic per-slat random number in [0, 1) (the same for the attribute and the anchors). */
export const rand = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Same curve as the shader: an infinity sign (with some depth) blended toward a ring. */
function curve(t: number, shape: number, out: THREE.Vector3) {
  return out.set(
    Math.sin(t),
    0.6 * Math.sin(2 * t) * (1 - shape) + Math.cos(t) * shape,
    0.32 * Math.cos(t) * (1 - shape),
  );
}

// Curve lengths (for scale 1), so slat thickness can be a fixed share of the spacing between slats.
const LENGTHS = [0, 1].map((shape) => {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < 2000; i++) {
    curve((i / 2000) * Math.PI * 2, shape, a);
    curve(((i + 1) / 2000) * Math.PI * 2, shape, b);
    len += a.distanceTo(b);
  }
  return len;
});
const curveLength = (shape: number) => LENGTHS[0] + (LENGTHS[1] - LENGTHS[0]) * shape;

const GHOST = new THREE.Color("#e8edff");
const GHOST_EDGE = new THREE.Color("#ffffff");
const euler = new THREE.Euler();
const m4 = new THREE.Matrix4();
const spinM = new THREE.Matrix4();

/** Fill a pose uniform for this frame: rocking, spinning, twist flow and colours included. */
export function writePose(out: PoseUniform, pose: Pose, time: number, count: number, color: THREE.Color, edge: THREE.Color) {
  out.center.set(...pose.center);
  euler.set(
    pose.tilt[0] + pose.sway[0] * Math.sin(time * 0.23),
    pose.tilt[1] + pose.sway[1] * Math.sin(time * 0.17 + 1.3),
    pose.tilt[2] + pose.sway[2] * Math.sin(time * 0.11 + 2.1),
  );
  m4.makeRotationFromEuler(euler);
  if (pose.spin) m4.multiply(spinM.makeRotationZ(pose.spin * time));
  out.rot.setFromMatrix4(m4);
  out.scale = pose.scale;
  out.shape = pose.shape;
  out.band = pose.band * pose.scale;
  out.depth = pose.depth * pose.scale;
  out.thick = (0.34 * curveLength(pose.shape) * pose.scale) / count; // a third slat, two thirds gap
  out.twist = pose.twist;
  out.phase = pose.flow * time;
  out.breath = pose.breath;
  out.color.copy(color).lerp(GHOST, pose.ghost);
  out.edge.copy(edge).lerp(GHOST_EDGE, pose.ghost);
}

const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
const side = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);

/** Centre of slat `t` in pose `p` (mirrors `place()` in the vertex shader). */
function slatCenter(p: PoseUniform, t: number, time: number, out: THREE.Vector3) {
  curve(t, p.shape, c);
  curve(t + 0.004, p.shape, a);
  curve(t - 0.004, p.shape, b);
  side.subVectors(a, b).normalize().cross(Z).normalize();
  c.multiplyScalar(1 + 0.035 * p.breath * Math.sin(time * 0.8));
  c.addScaledVector(side, 0.022 * p.breath * Math.sin(3 * t + time * 1.1));
  return out.copy(c).multiplyScalar(p.scale).applyMatrix3(p.rot).add(p.center);
}

const CA = new THREE.Vector3(), CB = new THREE.Vector3(), travel = new THREE.Vector3(), across = new THREE.Vector3();

/** Centre of slat `u` (0..1) while streaming from pose A to B (mirrors the vertex shader's main). */
export function streamedCenter(
  pa: PoseUniform, pb: PoseUniform, mix: number, u: number, r: number, time: number, lag: number, swirl: number,
  out: THREE.Vector3,
) {
  let m = Math.min(1, Math.max(0, (mix - u * lag) / (1 - lag)));
  m = m * m * m * (m * (m * 6 - 15) + 10);
  const flight = Math.sin(Math.PI * m);
  const t = u * Math.PI * 2;
  slatCenter(pa, t, time, CA);
  slatCenter(pb, t, time, CB);
  travel.subVectors(CB, CA);
  out.copy(CA).addScaledVector(travel, m);
  across.crossVectors(travel, Z);
  const len = across.length();
  if (len > 1e-4) out.addScaledVector(across, (flight * travel.length() * (0.16 + 0.22 * r) * swirl) / len);
  out.z += flight * (r - 0.4) * 2.4 * swirl;
  return out;
}
