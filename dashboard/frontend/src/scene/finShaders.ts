/*
 * GLSL for the ∞ fin sculpture on the overview.
 *
 * Ported from rhine-lock (https://github.com/tmc5csxr9m-cpu/rhine-lock, frontend/src/lib/scene/shaders.ts),
 * a GNU AGPL-3.0-or-later project; this file stays under that licence. The fin shaders are unchanged.
 * The final grade differs in three ways: it draws onto the dashboard's own paper (a transparent canvas)
 * instead of painting rhine-lock's paper; its vignette and chromatic aberration are measured in
 * rhine-lock's 16:9 frame (uFrame), wherever the dashboard puts that frame; and the card stream that
 * rhine-lock also draws is left out.
 *
 * Injected into MeshStandardMaterial / MeshDepthMaterial via onBeforeCompile, so the fins keep three's
 * PBR lighting, shadows and image-based lighting.
 */

export const common = /* glsl */ `
float rl_hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}
vec3 rl_rotateAxis(vec3 v, vec3 axis, float a) {
    float s = sin(a), c = cos(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
vec3 rl_toLinear(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
`;

// ───────────────────────────── fins ─────────────────────────────

export const finUniformsGlsl = /* glsl */ `
uniform float uTime, uFlow, uCount, uRadius, uAspect, uDepth, uTwist, uSpin;
uniform float uThickness, uLean, uCorner, uWidth, uHeight;
uniform float uAssemble, uVerify, uDenied, uAlign, uDisorder, uDissolve;
uniform float uPulseT[16];
uniform float uPulseO[16];
varying vec3 vLocal;
varying float vSeed;
varying float vPulse;
varying float vParam;
varying float vTip;
`;

export const finVertexGlsl = /* glsl */ `
attribute float aIndex;

vec3 rl_curve(float t) {
    float s = sin(t), c = cos(t);
    // Gerono figure-eight; the branches separate in depth so the band passes over itself
    return vec3(uRadius * c, uRadius * uAspect * s * c, uDepth * s);
}
float rl_easeOutBack(float x) {
    float c1 = 1.70158, c3 = c1 + 1.0;
    return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0);
}

void rl_finTransform(in vec3 lp, in vec3 nrm, out vec3 worldPos, out vec3 worldNrm) {
    float idx = aIndex;
    float seed = rl_hash11(idx * 1.618 + 4.7);
    float t = 6.2831853 * fract((idx + uFlow) / uCount);

    vec3 p = rl_curve(t);
    vec3 T = normalize(rl_curve(t + 0.002) - rl_curve(t - 0.002));
    vec3 ref = vec3(0.0, 0.0, 1.0);
    vec3 N0 = normalize(ref - dot(ref, T) * T);
    vec3 B0 = cross(T, N0);

    // travelling keystroke pulses (16 ring-buffered start times / origins)
    float pulse = 0.0;
    for (int i = 0; i < 16; ++i) {
        float age = uTime - uPulseT[i];
        if (age >= 0.0 && age < 2.6) {
            float front = fract(uPulseO[i] + age * 0.32);
            float d = abs(fract(t / 6.2831853 - front + 0.5) - 0.5);
            float life = smoothstep(0.0, 0.08, age) * exp(-age * 1.5) * (1.0 - smoothstep(2.0, 2.6, age));
            pulse += exp(-d * d * 900.0) * life;
        }
    }
    pulse = min(pulse, 1.4);

    float wave = sin(2.0 * t - uTime * 0.55) * 0.55 + sin(5.0 * t + uTime * 0.31) * 0.12;
    float phi = uTwist * t + wave + uSpin + pulse * 1.3;
    phi = mix(phi, 1.5707963, uAlign);
    phi += (seed - 0.5) * uDisorder * 3.0 + sin(uTime * 9.0 + seed * 40.0) * uDisorder * 0.2;

    vec3 W = cos(phi) * N0 + sin(phi) * B0;
    vec3 H = cross(T, W);
    float lean = uLean + sin(t * 3.0 + uTime * 0.4) * 0.12;
    vec3 Tl = cos(lean) * T + sin(lean) * H;
    H = cross(Tl, W);
    T = Tl;

    // assembly: drawn like the logo's pen stroke from the crossing
    float along = fract(t / 6.2831853 - 0.25);
    float window = 0.085;
    float local = clamp((uAssemble * (1.0 + window) - along) / window, 0.0, 1.0);
    float settle = 1.0 - pow(1.0 - local, 3.0);
    float grow = local > 0.0 ? rl_easeOutBack(local) : 0.0;
    float swing = (1.0 - settle) * 1.1;
    W = rl_rotateAxis(W, T, swing);
    H = rl_rotateAxis(H, T, swing);

    // unlock: cards peel off the band in a wave from the crossing and fly
    // outward, tumbling, while they shrink away
    float peel = clamp(uDissolve * 1.6 - along * 0.6 - seed * 0.25, 0.0, 1.0);
    float peelE = peel * peel * (3.0 - 2.0 * peel);
    vec3 axis = normalize(vec3(seed - 0.5, 0.6, 0.3 + seed));
    W = rl_rotateAxis(W, axis, peelE * (2.0 + seed * 4.0));
    H = rl_rotateAxis(H, axis, peelE * (2.0 + seed * 4.0));
    vec3 Tt = cross(W, H);

    vec3 size = vec3(uThickness, uWidth * (1.0 + pulse * 0.35), uHeight * (1.0 + pulse * 0.9)) * grow;
    size *= 1.0 - peelE * 0.85;

    vec3 radial = normalize(vec3(p.x, p.y * 1.4, p.z + 120.0));
    vec3 centre = p + H * (pulse * 7.0 + (1.0 - settle) * 16.0)
                + (radial * 520.0 + vec3(0.0, 0.0, 380.0)) * peelE * (0.6 + seed);

    worldPos = centre + Tt * lp.x * size.x + W * lp.y * size.y + H * lp.z * size.z;
    worldNrm = normalize(Tt * nrm.x + W * nrm.y + H * nrm.z);

    float dt = along - uAssemble * (1.0 + window) + window * 0.5;
    vTip = exp(-dt * dt * 2600.0) * (1.0 - smoothstep(0.9, 1.0, uAssemble));
    vLocal = lp;
    vSeed = seed;
    vPulse = pulse;
    vParam = t / 6.2831853;
}
`;

// fragment: corner carve (shared by colour and depth passes)
export const finCarveGlsl = /* glsl */ `
    {
        vec2 rc = max(abs(vLocal.yz) - vec2(0.5 - uCorner), 0.0);
        if (length(rc) > uCorner) discard;
    }
`;

export const finSurfaceGlsl = /* glsl */ `
    vec2 rq = abs(vLocal.yz) * 2.0;
    float rm = max(rq.x, rq.y);
    float onFace = step(0.49, abs(vLocal.x));
    float bevel = smoothstep(0.86, 1.0, rm);
    float rim = onFace * smoothstep(0.90, 0.94, rm) * (1.0 - smoothstep(0.97, 0.995, rm));

    vec3 rlPaper = rl_toLinear(vec3(0.935, 0.895, 0.830));
    vec3 rlGraphite = rl_toLinear(vec3(0.06, 0.062, 0.068));
    vec3 rlBody = mix(rlPaper, rlGraphite, uDenied) * (0.95 + vSeed * 0.07);
`;

export const finEmissiveGlsl = /* glsl */ `
    {
        vec3 orange = rl_toLinear(vec3(1.0, 0.482, 0.0));
        vec3 lime = rl_toLinear(vec3(0.725, 0.894, 0.196));
        vec3 glow = vec3(0.0);
        float scan = smoothstep(0.55, 1.0, sin(vParam * 6.2831853 * 3.0 - uTime * 2.4));
        glow += rim * orange * (0.25 + 1.6 * scan) * uDenied;
        glow += vPulse * rim * mix(lime * 0.9, orange * 1.4, uDenied);
        glow += uVerify * rim * orange * 0.8 * step(0.55, fract(vParam * 18.0 - uTime * 1.2));
        glow += vTip * rim * vec3(1.0, 0.92, 0.8) * 1.4;
        totalEmissiveRadiance = glow;
    }
`;

// ───────────────────────────── final grade ─────────────────────────────
// postprocessing Effect: chromatic aberration + digital tear (UV), tone mapping, film grain, vignette.
// Works in and returns display (sRGB) values, as straight (unpremultiplied) colour with the fins'
// coverage in alpha: the browser lays that over the dashboard's paper.

export const gradeFragment = /* glsl */ `
uniform float uTime;
uniform float uGlitch;
uniform float uAberration;
uniform float uVignette;
uniform float uDenied;
uniform float uExposure;
uniform vec3 uPaperBase;
uniform float uTonemap;
uniform float uSat;
uniform vec4 uFrame; // rhine-lock's 16:9 frame in this canvas: centre and size, in uv

float g_hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
// Khronos PBR Neutral: keeps the paper and cards' hues where the film has them
vec3 g_neutral(vec3 color) {
    const float startCompression = 0.8 - 0.04;
    const float desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    const float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
}
// ACES fitted (Stephen Hill): the filmic shoulder Quick3D's Filmic mode resembles
vec3 g_aces(vec3 c) {
    const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    c = i * c;
    vec3 a = c * (c + 0.0245786) - 0.000090537;
    vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
    return clamp(o * (a / b), 0.0, 1.0);
}
vec3 g_tonemap(vec3 c) { return uTonemap > 0.5 ? g_aces(c) : g_neutral(c); }
vec3 g_toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor) {
    vec2 uv = uv0;
    float g = clamp(uGlitch, 0.0, 1.0);
    float tick = floor(uTime * 28.0);
    if (g > 0.001) {
        float band = floor(uv.y * 46.0);
        float on = step(1.0 - g * 0.55, g_hash(vec2(band, tick)));
        uv.x += (g_hash(vec2(band * 1.7, tick + 3.0)) - 0.5) * 0.11 * g * on;
        float br = floor(uv.y * 12.0), bc = floor(uv.x * 9.0);
        float block = step(1.0 - g * 0.18, g_hash(vec2(br + bc * 13.0, tick)));
        uv += (vec2(g_hash(vec2(bc, tick)), g_hash(vec2(br, tick))) - 0.5) * 0.04 * block;
    }
    // measured in rhine-lock's frame, so the sculpture shades the same wherever it sits
    vec2 d = (uv - uFrame.xy) / uFrame.zw;
    float ca = uAberration * dot(d, d) + g * 0.012;
    vec2 shift = d * ca * uFrame.zw;
    vec4 base = texture2D(inputBuffer, uv);
    vec4 r = texture2D(inputBuffer, uv + shift);
    vec4 b = texture2D(inputBuffer, uv - shift);
    vec3 hdr = vec3(r.r, base.g, b.b) * uExposure;
    vec3 tm = g_tonemap(hdr);
    tm = mix(vec3(dot(tm, vec3(0.2126, 0.7152, 0.0722))), tm, uSat);
    vec3 col = g_toSrgb(clamp(tm, 0.0, 1.0));

    vec2 res = resolution;
    float scan = step(0.5, fract(uv.y * res.y * 0.5));
    col *= 1.0 - g * 0.18 * scan;
    col += g * 0.06 * (g_hash(vec2(floor(uv.y * res.y), tick)) - 0.5);

    // The scene was cleared to the colour that tone-maps to the paper, so antialiased and blurred edges
    // are already mixed with paper. Take that share out again: what's left is the fins' own colour,
    // which the browser lays over the page's paper with the coverage as alpha.
    float a = clamp(base.a, 0.0, 1.0);
    if (a < 0.004) {
        outputColor = vec4(0.0);
        return;
    }
    vec3 fin = (col - uPaperBase * (1.0 - a)) / a;
    float grain = g_hash(uv0 * res + fract(floor(uTime * 24.0) * 0.137) * 1000.0) - 0.5;
    fin += grain * mix(0.014, 0.028, uDenied);
    float v = smoothstep(1.05, 0.28, length(d * vec2(1.0, 0.9)));
    fin *= mix(1.0, v, uVignette);

    outputColor = vec4(clamp(fin, 0.0, 1.0), a); // display space: the output colour space is linear (no re-encode)
}
`;
