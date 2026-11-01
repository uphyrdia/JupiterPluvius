/**
 * Where the ribbon is, and what it looks like, on each page ("keyframes").
 * The 3D scene blends between the poses of the two pages either side of the scroll position.
 *
 * Units: `vw`/`vh` are the visible width/height in world units at depth 0, so poses adapt to any
 * screen shape. x = 0 is the middle of the screen, +0.5·vw the right edge, +0.5·vh the top.
 */
export interface Pose {
  center: [number, number, number];
  tilt: [number, number, number]; // base rotation (radians, applied X, Y, Z)
  sway: [number, number, number]; // slow rocking around each axis (radians)
  spin: number; // steady turning around the figure's own axis (rad/s)
  scale: number; // radius of the figure (world units)
  shape: number; // 0 = infinity (lemniscate), 1 = ring
  band: number; // band width = slat length, relative to scale
  depth: number; // slat depth, relative to scale
  twist: number; // half-turns of the band per loop (0.5 = a Möbius strip)
  flow: number; // how fast the twist travels round the band (rad/s)
  breath: number; // amount of breathing and rippling
  ghost: number; // 0 = coloured by soil moisture, 1 = white (for the dark pages)
}

export function poses(vw: number, vh: number, compact: boolean): Pose[] {
  if (compact) {
    return [
      { center: [0, 0.2 * vh, 0], tilt: [-0.45, 0.3, -0.05], sway: [0.07, 0.18, 0.03], spin: 0,
        scale: Math.min(0.4 * vw, 0.21 * vh), shape: 0, band: 0.3, depth: 0.034, twist: 0.5, flow: 0.12, breath: 1, ghost: 0 },
      { center: [0.52 * vw, 0.47 * vh, 0], tilt: [0.5, -0.6, 0], sway: [0.03, 0.04, 0], spin: 0.12,
        scale: 0.36 * vw, shape: 1, band: 0.34, depth: 0.05, twist: 3.5, flow: 0.3, breath: 0.5, ghost: 0 },
      { center: [-0.46 * vw, -0.45 * vh, 0], tilt: [1.25, 0.12, 0.08], sway: [0.03, 0.04, 0], spin: -0.1,
        scale: 0.4 * vw, shape: 1, band: 0.28, depth: 0.05, twist: 2.5, flow: 0.3, breath: 0.5, ghost: 1 },
      { center: [0.33 * vw, 0.36 * vh, 0], tilt: [-0.35, 0.35, -0.05], sway: [0.06, 0.2, 0.03], spin: 0,
        scale: 0.13 * vw, shape: 0, band: 0.3, depth: 0.08, twist: 0.5, flow: 0.12, breath: 0.8, ghost: 1 },
    ];
  }
  return [
    // 01 Overview: the infinity, centre-right, rocking slowly and breathing
    { center: [0.12 * vw, -0.02 * vh, 0], tilt: [-0.42, 0.3, -0.05], sway: [0.07, 0.16, 0.03], spin: 0,
      scale: Math.min(0.235 * vw, 0.43 * vh), shape: 0, band: 0.3, depth: 0.09, twist: 0.5, flow: 0.12, breath: 1, ghost: 0 },
    // 02 Trends: swept into the top-right corner, a big twisting fan turning around the corner
    { center: [0.47 * vw, 0.5 * vh, 0], tilt: [0.5, -0.6, 0], sway: [0.03, 0.04, 0], spin: 0.12,
      scale: 0.37 * vh, shape: 1, band: 0.36, depth: 0.05, twist: 3.5, flow: 0.3, breath: 0.5, ghost: 0 },
    // 03 Analysis: a white vortex lying flat in the bottom-left corner, under the text
    { center: [-0.33 * vw, -0.31 * vh, 0], tilt: [1.3, 0.12, 0.08], sway: [0.03, 0.04, 0], spin: -0.1,
      scale: 0.24 * vh, shape: 1, band: 0.28, depth: 0.05, twist: 2.5, flow: 0.3, breath: 0.5, ghost: 1 },
    // 04 Log: a small infinity resting in the top-right corner, above the panels
    { center: [0.35 * vw, 0.33 * vh, 0], tilt: [-0.35, 0.35, -0.05], sway: [0.06, 0.2, 0.03], spin: 0,
      scale: 0.105 * vh, shape: 0, band: 0.3, depth: 0.08, twist: 0.5, flow: 0.12, breath: 0.8, ghost: 1 },
  ];
}
