/*
 * GLSL for the ribbon. Every slat is one instance of a unit box; the vertex shader works out where
 * the slat sits from its index along the band, so moving thousands of vertices costs the CPU nothing.
 *
 * A "pose" (see poses.ts) describes the whole band on one page. The shader computes the slat's place
 * in pose A and in pose B and blends them by uMix. Each slat starts its trip a little later than the
 * one before it (uLag), so the band streams from one pose to the next instead of sliding as a block.
 */

const POSE_STRUCT = /* glsl */ `
struct Pose {
  vec3 center;
  mat3 rot;
  float scale;
  float shape;
  float band;
  float depth;
  float thick;
  float twist;
  float phase;
  float breath;
  vec3 color;
  vec3 edge;
};
`;

export const vertexShader = /* glsl */ `
${POSE_STRUCT}
uniform Pose uA;
uniform Pose uB;
uniform float uMix;   // 0..1, from pose A to pose B
uniform float uTime;
uniform float uCount;
uniform float uLag;   // how spread out the departures are (0 = all at once)
uniform float uSwirl; // 0..1: how much the slats arc and tumble in flight

attribute float aIndex;
attribute float aRand;

varying vec3 vNormal;
varying vec3 vBox;
varying vec3 vSize;
varying vec3 vColor;
varying vec3 vEdge;
varying float vShade;
varying float vDepth;

#define TAU 6.283185307

vec3 curve(float t, float shape) {
  vec3 infinity = vec3(sin(t), 0.6 * sin(2.0 * t), 0.32 * cos(t));
  vec3 ring = vec3(sin(t), cos(t), 0.0);
  return mix(infinity, ring, shape);
}

// Slat at curve parameter t in pose p: centre C, direction along the curve T, across the band W.
void place(Pose p, float t, out vec3 C, out vec3 T, out vec3 W, out float swell) {
  vec3 c = curve(t, p.shape);
  vec3 tang = normalize(curve(t + 0.004, p.shape) - curve(t - 0.004, p.shape));
  vec3 side = normalize(cross(tang, vec3(0.0, 0.0, 1.0))); // in the figure's plane
  vec3 up = cross(side, tang);                             // out of the plane
  float a = p.twist * t + p.phase;                          // the band's twist angle here
  // Breathing: the figure swells gently and a ripple runs round the band.
  c *= 1.0 + 0.035 * p.breath * sin(uTime * 0.8);
  c += side * 0.022 * p.breath * sin(3.0 * t + uTime * 1.1);
  swell = 1.0 + 0.2 * p.breath * sin(2.0 * t - uTime * 0.9);
  C = p.center + p.rot * (c * p.scale);
  T = p.rot * tang;
  W = p.rot * (cos(a) * up + sin(a) * side);
}

void main() {
  float u = aIndex / uCount;
  float t = u * TAU;

  float m = clamp((uMix - u * uLag) / (1.0 - uLag), 0.0, 1.0);
  m = m * m * m * (m * (m * 6.0 - 15.0) + 10.0); // smootherstep
  float flight = sin(3.14159265 * m);              // 0 at both ends, 1 mid-flight

  vec3 CA, TA, WA, CB, TB, WB;
  float sA, sB;
  place(uA, t, CA, TA, WA, sA);
  place(uB, t, CB, TB, WB, sB);

  vec3 travel = CB - CA;
  vec3 C = CA + travel * m;
  // Arc sideways and in depth mid-flight, so the stream swirls instead of sliding in a line.
  vec3 across = cross(travel, vec3(0.0, 0.0, 1.0));
  float acrossLen = length(across);
  if (acrossLen > 1e-4) C += across / acrossLen * flight * length(travel) * (0.16 + 0.22 * aRand) * uSwirl;
  C.z += flight * (aRand - 0.4) * 2.4 * uSwirl;

  vec3 T = normalize(mix(TA, TB, m) + vec3(1e-5, 2e-5, 3e-5));
  vec3 W = mix(WA, WB, m);
  W = normalize(W - dot(W, T) * T + vec3(1e-5));
  vec3 H = cross(T, W);
  float tumble = flight * (1.2 + 2.2 * aRand) * uSwirl; // slats tumble while flying
  W = cos(tumble) * W + sin(tumble) * H;
  H = cross(T, W);

  // The unit box's x runs across the band, y through its depth, z along the curve.
  vec3 size = mix(vec3(uA.band * sA, uA.depth, uA.thick), vec3(uB.band * sB, uB.depth, uB.thick), m);
  vec3 world = C + W * (position.x * size.x) + H * (position.y * size.y) + T * (position.z * size.z);

  vNormal = W * normal.x + H * normal.y + T * normal.z;
  vBox = position;
  vSize = size;
  vColor = mix(uA.color, uB.color, m);
  vEdge = mix(uA.edge, uB.edge, m);
  vShade = 0.9 + 0.2 * aRand;
  vec4 view = viewMatrix * vec4(world, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

export const fragmentShader = /* glsl */ `
uniform vec3 uBg;     // page background, for depth haze
uniform vec3 uLight;  // key light direction

varying vec3 vNormal;
varying vec3 vBox;
varying vec3 vSize;
varying vec3 vColor;
varying vec3 vEdge;
varying float vShade;
varying float vDepth;

void main() {
  vec3 n = normalize(vNormal);

  // Distance (world units) to the nearest edge of the face being drawn -> crisp ~1px edge lines.
  // "minor" is half the face's narrower side: faces only a few pixels wide get no outline, or the
  // outline would swallow them whole.
  vec3 d = (0.5 - abs(vBox)) * vSize;
  vec3 h = 0.5 * vSize;
  float e, minor;
  if (d.x <= d.y && d.x <= d.z) { e = min(d.y, d.z); minor = min(h.y, h.z); }
  else if (d.y <= d.z) { e = min(d.x, d.z); minor = min(h.x, h.z); }
  else { e = min(d.x, d.y); minor = min(h.x, h.y); }
  float w = fwidth(e);
  float edge = (1.0 - smoothstep(0.35 * w, 1.35 * w, e)) * smoothstep(1.5 * w, 4.0 * w, minor);

  float key = max(dot(n, uLight), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.5, -0.4, 0.6))), 0.0);
  vec3 col = vColor * (0.34 + 0.78 * key + 0.16 * fill) * vShade;
  col = mix(col, vEdge, edge * 0.75);

  float haze = clamp((vDepth - 11.5) / 8.0, 0.0, 1.0); // further back fades into the page colour
  col = mix(col, uBg, haze * 0.45);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
