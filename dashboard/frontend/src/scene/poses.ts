/**
 * Where the ribbon sits on the overview, and how it moves. It only appears on that page: when you
 * leave it, the ribbon drifts up and fades out with the page (see Ribbon.tsx and Scene.tsx).
 *
 * Units: `vw`/`vh` are the visible width/height in world units at depth 0, so the pose adapts to any
 * screen shape. x = 0 is the middle of the screen, +0.5·vw the right edge, +0.5·vh the top.
 */
export interface Pose {
  center: [number, number, number];
  tilt: [number, number, number]; // base rotation (radians, applied X, Y, Z)
  sway: [number, number, number]; // slow rocking around each axis (radians)
  scale: number; // radius of the figure (world units)
  band: number; // band width = slat length, relative to scale
  depth: number; // slat depth, relative to scale
  twist: number; // turns of the band per loop (0.5 = a Möbius strip)
  flow: number; // how fast the twist travels round the band (rad/s)
  breath: number; // amount of breathing and rippling
}

export function overviewPose(vw: number, vh: number, compact: boolean): Pose {
  if (compact) {
    return { center: [0, 0.2 * vh, 0], tilt: [-0.45, 0.3, -0.05], sway: [0.07, 0.18, 0.03],
      scale: Math.min(0.4 * vw, 0.21 * vh), band: 0.3, depth: 0.034, twist: 0.5, flow: 0.12, breath: 1 };
  }
  // Centre-right, rocking slowly and breathing.
  // pages.css (--ribbon-left, --ribbon-right) keeps the moisture card and the light callout clear of it:
  // update those if you move or resize this.
  return { center: [0.12 * vw, -0.02 * vh, 0], tilt: [-0.42, 0.3, -0.05], sway: [0.07, 0.16, 0.03],
    scale: Math.min(0.235 * vw, 0.43 * vh), band: 0.3, depth: 0.09, twist: 0.5, flow: 0.12, breath: 1 };
}
