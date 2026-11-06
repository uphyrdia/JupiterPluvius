/*
 * The ∞ fin sculpture on the overview: rhine-lock's Three.js stage
 * (https://github.com/tmc5csxr9m-cpu/rhine-lock, frontend/src/lib/scene/Stage.ts), itself a port of its
 * SDDM theme's Quick3D scene. GNU AGPL-3.0-or-later, like the original. Same units, camera, lights,
 * light probe, shaders and post-processing; one instanced draw call, all motion in the vertex shader.
 *
 * What's different here:
 *  - The picture is shown mirrored (the canvas has transform: scaleX(-1), see base.css), so the smaller
 *    loop is on the left. project() returns positions as shown.
 *  - rhine-lock fills its screen with a 16:9 frame. Here `frame` says where that frame sits and how big
 *    it is; it's applied as a lens shift, so the sculpture looks exactly the same, just elsewhere.
 *  - The canvas is transparent and the dashboard's own paper shows through (see the grade in finShaders.ts).
 *  - The band's joint, which rhine-lock hides behind its login panel and the mirrored picture would show,
 *    is closed (rl_joint in finShaders.ts).
 *  - No card stream and no look-dev URL overrides; the render loop pauses while the overview is away.
 */
import { N8AOPostPass } from "n8ao";
import {
  BlendFunction, DepthOfFieldEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass,
} from "postprocessing";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import {
  common, finCarveGlsl, finEmissiveGlsl, finSurfaceGlsl, finUniformsGlsl, finVertexGlsl, gradeFragment,
} from "./finShaders";

export type Quality = "ultra" | "high" | "low";

const LOOK = { exposure: 1.5, key: 3.4, fill: 0.55, env: 0.8, tm: 0, sat: 0.7 };
const FIN_COUNT = 400;
const DEG = Math.PI / 180;
const RADIUS = 285, ASPECT = 0.95, DEPTH = 95; // the band's curve (uRadius, uAspect, uDepth)
/** rhine-lock lays its screen out at 16:9, and the sculpture is framed in one such frame. */
export const FRAME_ASPECT = 16 / 9;

export interface StageTargets {
  verify: number; // 0..1
  denied: number; // 0..1  (graphite / orange lockdown palette)
  standby: number; // 0..1
  parallaxX: number; // -1..1
  parallaxY: number;
  glitch: number; // 0..1 (post)
}

/** Where rhine-lock's 16:9 frame sits on the page: its centre and height, in CSS px, as shown. */
export interface Framing {
  x: number;
  y: number;
  h: number;
}

class GradeEffect extends Effect {
  constructor() {
    super("RhineGrade", gradeFragment, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uTime", new THREE.Uniform(0)],
        ["uGlitch", new THREE.Uniform(0)],
        ["uAberration", new THREE.Uniform(0.0016)],
        ["uVignette", new THREE.Uniform(0.32)],
        ["uDenied", new THREE.Uniform(0)],
        ["uExposure", new THREE.Uniform(1.0)],
        ["uPaperBase", new THREE.Uniform(new THREE.Vector3(0.9, 0.9, 0.9))],
        ["uTonemap", new THREE.Uniform(LOOK.tm)],
        ["uSat", new THREE.Uniform(LOOK.sat)],
        ["uFrame", new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 1, 1))],
      ]),
    });
  }
  set(name: string, v: number) {
    this.uniforms.get(name)!.value = v;
  }
}

// Khronos PBR Neutral, mirrored from the grade shader, and its inverse — used
// to pick a clear colour that lands exactly on the paper after tone mapping.
function neutral(c: number[]) {
  const sc = 0.76, desat = 0.15;
  const x = Math.min(...c), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let v = c.map((k) => k - off);
  const peak = Math.max(...v);
  if (peak < sc) return v;
  const d = 1 - sc, np = 1 - (d * d) / (peak + d - sc);
  v = v.map((k) => (k * np) / peak);
  const g = 1 - 1 / (desat * (peak - np) + 1);
  return v.map((k) => k + (np - k) * g);
}
function aces(c: number[]) {
  const i = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
  const o = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const v = mul(i, c).map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(o, v).map((x) => Math.min(1, Math.max(0, x)));
}
// the grade's object path: exposure → tone curve → saturation (linear in, linear out)
function forward(c: number[]) {
  const e = c.map((x) => x * LOOK.exposure);
  const t = LOOK.tm > 0.5 ? aces(e) : neutral(e);
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return t.map((x) => l + (x - l) * LOOK.sat);
}
function inverseForward(target: number[]) {
  let x = target.slice();
  for (let i = 0; i < 40; ++i) {
    const y = forward(x);
    x = x.map((k, j) => Math.max(0, k + (target[j] - y[j]) / LOOK.exposure));
  }
  return x;
}
const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const PAPER_LIGHT = [235 / 255, 234 / 255, 230 / 255]; // the dashboard's paper, --bg in base.css (display space)
const PAPER_DARK = [0.043, 0.043, 0.047];

function instanced(base: THREE.BufferGeometry, count: number) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("normal", base.getAttribute("normal"));
  g.setAttribute("uv", base.getAttribute("uv"));
  const idx = new Float32Array(count);
  for (let i = 0; i < count; ++i) idx[i] = i;
  g.setAttribute("aIndex", new THREE.InstancedBufferAttribute(idx, 1));
  g.instanceCount = count;
  return g;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sculpture = new THREE.Group();
  /** resolves once the light probe has loaded (or failed to) */
  readonly ready: Promise<void>;
  private composer: EffectComposer;
  private grade = new GradeEffect();
  private finU: Record<string, THREE.IUniform>;
  private environmentTarget: THREE.WebGLRenderTarget | null = null;
  private raf = 0;
  private running = false;
  private disposed = false;
  private lastBase = -1;
  private lastRender = 0;
  private lastNow = 0;
  private width = 1;
  private height = 1;
  private tmp = new THREE.Vector3();
  /** frame-rate cap, 0 = every display frame */
  maxFps = 0;
  /** how fast the sculpture's own clock runs (reduced motion slows it down) */
  timeScale = 1;
  /** where rhine-lock's 16:9 frame sits on the page (see Framing) */
  frame: Framing = { x: 0, y: 0, h: 1 };

  // animated state
  time = 0;
  private flow = 0;
  private spin = 0;
  private disorder = 0;
  private dolly = 0;
  private assemble = 1;
  private assembleAnim: { from: number; to: number; t0: number; dur: number } | null = null;
  private dissolve = 0;
  private dissolveAnim: { t0: number; dur: number } | null = null;
  private pulseT = new Float32Array(16).fill(-99);
  private pulseO = new Float32Array(16).fill(0.25);
  private pulseSlot = 0;
  sculptureOffset = -10;

  targets: StageTargets = { verify: 0, denied: 0, standby: 0, parallaxX: 0, parallaxY: 0, glitch: 0 };
  /** called at the start of every frame with the frame time (s), so targets never render stale */
  onFrame: ((dt: number) => void) | null = null;
  stats = { frames: 0, slow: 0, ms: 0 };

  constructor(private canvas: HTMLCanvasElement, readonly quality: Quality, environmentUrl: string) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, stencil: false, depth: true,
      // keep the clear colour un-premultiplied: rgb = paper base, alpha = 0 marks background
      // (and the grade hands the browser straight colour, see finShaders.ts)
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    // Linear output: the grade pass writes display-space values itself.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(30, FRAME_ASPECT, 20, 6000);
    this.camera.rotation.order = "YXZ";

    this.lights();
    this.ready = this.environment(environmentUrl);

    // ── fins ──
    const finGeo = instanced(new THREE.BoxGeometry(1, 1, 1), FIN_COUNT);
    this.finU = {
      uTime: { value: 0 }, uFlow: { value: 0 }, uCount: { value: FIN_COUNT },
      uRadius: { value: RADIUS }, uAspect: { value: ASPECT }, uDepth: { value: DEPTH }, uTwist: { value: 1.5 },
      uSpin: { value: 0 }, uThickness: { value: 4.2 }, uLean: { value: 0.62 }, uCorner: { value: 0.14 },
      uWidth: { value: 84 }, uHeight: { value: 84 }, uAssemble: { value: 1 }, uVerify: { value: 0 },
      uDenied: { value: 0 }, uAlign: { value: 0 }, uDisorder: { value: 0 }, uDissolve: { value: 0 },
      uPulseT: { value: this.pulseT }, uPulseO: { value: this.pulseO },
    };
    const finMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.5, side: THREE.DoubleSide });
    finMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.finU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${common}\n${finUniformsGlsl}\n${finVertexGlsl}`)
        .replace("#include <beginnormal_vertex>",
          `vec3 rlPos; vec3 rlNrm; rl_finTransform(position, normal, rlPos, rlNrm);\nvec3 objectNormal = rlNrm;`)
        .replace("#include <begin_vertex>", "vec3 transformed = rlPos;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n${common}\n${finUniformsGlsl}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${finCarveGlsl}\n${finSurfaceGlsl}`)
        .replace("#include <color_fragment>", "diffuseColor.rgb = rlBody;")
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix(0.55, 0.36, bevel);")
        .replace("#include <emissivemap_fragment>", finEmissiveGlsl);
    };
    const finDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    finDepth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.finU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${common}\n${finUniformsGlsl}\n${finVertexGlsl}`)
        .replace("#include <begin_vertex>",
          `vec3 rlPos; vec3 rlNrm; rl_finTransform(position, normal, rlPos, rlNrm);\nvec3 transformed = rlPos;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n${finUniformsGlsl}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${finCarveGlsl}`);
    };
    const fins = new THREE.Mesh(finGeo, finMat);
    fins.customDepthMaterial = finDepth;
    fins.frustumCulled = false;
    fins.castShadow = fins.receiveShadow = true;
    this.sculpture.add(fins);
    this.scene.add(this.sculpture);

    // ── post ──
    const samples = quality === "ultra" ? 8 : quality === "high" ? 4 : 0;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: samples });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality !== "low") {
      const ao = new N8AOPostPass(this.scene, this.camera, 1920, 1080);
      ao.configuration.aoRadius = 26;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = quality === "ultra" ? 2.6 : 2.2;
      ao.configuration.gammaCorrection = false;
      ao.configuration.screenSpaceRadius = false;
      ao.setQualityMode(quality === "ultra" ? "High" : "Medium");
      this.composer.addPass(ao);
      const dof = new DepthOfFieldEffect(this.camera, {
        focusDistance: 1060, focusRange: 520, bokehScale: 1.2, resolutionScale: 0.5,
      });
      this.composer.addPass(new EffectPass(this.camera, dof));
    }
    this.composer.addPass(new EffectPass(this.camera, this.grade));

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private lights() {
    // key: Quick3D eulerRotation (-52, -38, 0) → direction (0.379, -0.788, -0.485)
    const key = new THREE.DirectionalLight(0xfff6ea, LOOK.key);
    key.position.set(-0.379, 0.788, 0.485).multiplyScalar(1200);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -520; cam.right = 520; cam.top = 420; cam.bottom = -420; cam.near = 400; cam.far = 2000;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    key.shadow.radius = 5;
    this.scene.add(key, key.target);
    // cool fill from camera-right/back: eulerRotation (-10, 120, 0)
    const fill = new THREE.DirectionalLight(0xdfe8ff, LOOK.fill);
    fill.position.set(0.853, 0.174, -0.4925).multiplyScalar(1200);
    this.scene.add(fill, fill.target);
  }

  private environment(url: string) {
    return new Promise<void>((resolve) => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      new HDRLoader().load(url, (hdr) => {
        if (this.disposed) { hdr.dispose(); pmrem.dispose(); return resolve(); }
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        this.environmentTarget = pmrem.fromEquirectangular(hdr);
        const env = this.environmentTarget.texture;
        this.scene.environment = env;
        this.scene.environmentIntensity = LOOK.env;
        this.scene.environmentRotation.set(0, -25 * DEG, 0);
        hdr.dispose();
        pmrem.dispose();
        resolve();
      }, undefined, () => { pmrem.dispose(); resolve(); });
    });
  }

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
  };

  // ── control ──
  pulse(origin = 0.25) {
    const i = this.pulseSlot;
    this.pulseT[i] = this.time;
    this.pulseO[i] = origin;
    this.pulseSlot = (i + 1) % 16;
  }
  /** Draw the band in, like the logo's pen stroke from the crossing. */
  playAssemble(duration = 2300, from = this.assemble) {
    this.dissolve = 0;
    this.dissolveAnim = null;
    this.assemble = from;
    this.assembleAnim = { from, to: 1, t0: this.time, dur: duration / 1000 };
  }
  setAssembled() {
    this.assemble = 1;
    this.assembleAnim = null;
    this.dissolve = 0;
    this.dissolveAnim = null;
  }
  hideBand() {
    this.assemble = 0;
    this.assembleAnim = null;
    this.dissolve = 0;
    this.dissolveAnim = null;
  }
  /** Unlock: the fins peel off the band and fly outward, tumbling, while they shrink away. */
  playDissolve(duration = 1100) {
    this.dissolveAnim = { t0: this.time, dur: duration / 1000 };
  }
  get intro() {
    const a = Math.min(1, Math.max(0, this.assemble));
    return 1 - Math.pow(1 - a, 3);
  }
  /** The band is whole: fully drawn, nothing peeling. */
  get settled() {
    return this.assemble >= 1 && !this.assembleAnim && this.dissolve === 0 && !this.dissolveAnim;
  }
  /** The band is drawing itself in or peeling apart right now. */
  get busy() {
    return this.assembleAnim !== null || this.dissolveAnim !== null;
  }

  /** Where the band's centre line at u (0..1 along the curve) is on the page, in CSS px (as shown). */
  project(u: number) {
    const t = u * Math.PI * 2;
    const v = this.tmp.set(RADIUS * Math.cos(t), RADIUS * ASPECT * Math.sin(t) * Math.cos(t), DEPTH * Math.sin(t));
    this.sculpture.localToWorld(v);
    v.project(this.camera);
    return { x: this.width - (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }
  /** How much of the band is there at u: 0 not drawn yet (or peeled away), 1 drawn. */
  drawn(u: number) {
    const along = (((u - 0.25) % 1) + 1) % 1;
    const local = Math.min(1, Math.max(0, (this.assemble * 1.085 - along) / 0.085));
    return local * (1 - Math.min(1, this.dissolve * 1.6));
  }

  /** Start or pause the render loop (the canvas keeps showing its last frame while paused). */
  setRunning(on: boolean) {
    if (on === this.running || this.disposed) return;
    this.running = on;
    if (on) {
      this.lastNow = 0;
      this.raf = requestAnimationFrame(this.loop);
    } else {
      cancelAnimationFrame(this.raf);
      // the clock stops too: a pulse still under way would carry on when the overview comes back
      this.pulseT.fill(-99);
    }
  }

  private loop = (now: number) => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.maxFps > 0 && now - this.lastRender < 1000 / this.maxFps - 2) return;
    this.lastRender = now;
    this.step(now);
  };

  private step(now: number) {
    const raw = this.lastNow > 0 ? (now - this.lastNow) / 1000 : 1 / 60;
    this.lastNow = now;
    const real = Math.min(raw, 0.05);
    const dt = real * this.timeScale;
    this.stats.frames++;
    this.stats.ms = raw * 1000;
    if (raw > 0.022) this.stats.slow++;
    this.time += dt;
    this.onFrame?.(real); // the owner updates targets first, so no frame renders stale state
    const T = this.targets;

    // conveyor kept below one card spacing per frame (no wagon-wheel strobing)
    this.flow = (this.flow + dt * (1.6 + T.verify * 4.0)) % FIN_COUNT;
    this.spin += dt * (0.05 + T.verify * 1.4);
    const k = 1 - Math.exp(-dt * 3.2);
    this.disorder += (T.denied * 0.12 - this.disorder) * k;
    this.dolly += (T.verify * 70 - T.standby * 40 - this.dolly) * (1 - Math.exp(-dt * 2.0));

    if (this.assembleAnim) {
      const a = this.assembleAnim;
      const x = Math.min(1, (this.time - a.t0) / a.dur);
      this.assemble = a.from + (a.to - a.from) * (0.5 - 0.5 * Math.cos(Math.PI * x));
      if (x >= 1) this.assembleAnim = null;
    }
    if (this.dissolveAnim) {
      const x = Math.min(1, (this.time - this.dissolveAnim.t0) / this.dissolveAnim.dur);
      this.dissolve = x * x;
      if (x >= 1) this.dissolveAnim = null; // stays peeled away until it's drawn again
    }

    const intro = this.intro;
    const u = this.finU;
    u.uTime.value = this.time;
    u.uFlow.value = this.flow;
    u.uSpin.value = this.spin;
    u.uAssemble.value = this.assemble;
    u.uVerify.value = T.verify;
    u.uDenied.value = T.denied;
    u.uAlign.value = T.verify * 0.5;
    u.uDisorder.value = this.disorder;
    u.uDissolve.value = this.dissolve;

    // camera: dolly-in during assembly, push-in while verifying, damped parallax
    this.camera.position.set(T.parallaxX * 40, 60 + T.parallaxY * 24, 1080 + (1 - intro) * 300 - this.dolly);
    this.camera.rotation.set((-3 - T.parallaxY * 1.2) * DEG, T.parallaxX * 1.6 * DEG, 0);
    this.applyFrame();
    this.sculpture.position.x = this.sculptureOffset + T.standby * 150;
    this.sculpture.rotation.order = "YXZ";
    this.sculpture.rotation.set(
      (16 + Math.sin(this.time * 0.11) * 3) * DEG,
      (Math.sin(this.time * 0.07) * 9 - (1 - intro) * 32) * DEG,
      -2 * DEG);

    this.scene.environmentIntensity = LOOK.env * (1 - T.denied * 0.72);
    this.grade.set("uExposure", LOOK.exposure);
    const base = PAPER_LIGHT.map((l, i) => l + (PAPER_DARK[i] - l) * T.denied);
    if (Math.abs(base[0] - this.lastBase) > 1e-4) {
      this.lastBase = base[0];
      const clear = inverseForward(base.map(srgbToLin));
      this.renderer.setClearColor(new THREE.Color().setRGB(clear[0], clear[1], clear[2], THREE.LinearSRGBColorSpace), 0);
      (this.grade.uniforms.get("uPaperBase")!.value as THREE.Vector3).set(base[0], base[1], base[2]);
    }
    this.grade.set("uTime", this.time);
    this.grade.set("uGlitch", T.glitch);
    this.grade.set("uDenied", T.denied);
    this.grade.set("uVignette", 0.32 + 0.25 * T.denied);

    this.composer.render(real);
  }

  /** Put rhine-lock's 16:9 frame where `frame` says, as a lens shift of the camera. */
  private applyFrame() {
    const W = this.width, H = this.height;
    const h = Math.max(1, this.frame.h), w = h * FRAME_ASPECT;
    const x = W - this.frame.x; // drawn where it lands once the canvas is flipped
    const y = this.frame.y;
    this.camera.setViewOffset(w, h, w / 2 - x, h / 2 - y, W, H);
    (this.grade.uniforms.get("uFrame")!.value as THREE.Vector4).set(x / W, 1 - y / H, w / W, h / H);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of [m.material, m.customDepthMaterial].flat()) if (mat) materials.add(mat);
    });
    for (const mat of materials) mat.dispose();
    this.environmentTarget?.dispose();
    this.environmentTarget = null;
    this.scene.environment = null;
    this.composer.dispose(); // passes, effects and their render targets
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
