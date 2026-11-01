/**
 * The overview's leader lines run from each stat to a point on the 3D infinity.
 * The 3D scene writes those points' screen positions here every frame, and the leader lines read
 * them every frame. It's plain mutable data on purpose: 60 updates a second shouldn't go through
 * React state.
 */
export const ANCHORS = [
  { id: "temp", u: 0.6 }, // u = position along the band (0..1); 0.625 is the top of the left loop
  { id: "humidity", u: 0.14 }, // top of the right loop
  { id: "light", u: 0.25 }, // the right loop's far end
  { id: "reservoir", u: 0.36 }, // bottom of the right loop
  { id: "faults", u: 0.88 }, // bottom of the left loop
] as const;

export type AnchorId = (typeof ANCHORS)[number]["id"];

export const anchorBus = {
  xy: new Float32Array(ANCHORS.length * 2), // CSS pixels, in ANCHORS order
  visible: false, // false once the overview has scrolled away (or before the scene has loaded)
};

export const anchorIndex = (id: AnchorId) => ANCHORS.findIndex((a) => a.id === id);
