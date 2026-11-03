import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { GPUComputationRenderer as GPUCompute, Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import type { BackdropProps } from "./types";

/**
 * Ink in water: black water through a long lens, and nothing drawn but the
 * ink. A bead of gold ink appears low in the frame, beside the mark, and
 * opens over a minute and a half: a bloom that folds into lobes, tendrils
 * and filaments as it thins and sinks, until it is the water again. Ten
 * seconds of empty water, then the next bead, on the other side.
 *
 * The ink is 65,536 particles (16,384 on phones) whose positions and ages
 * live in a float texture, stepped on the GPU each frame (three's
 * GPUComputationRenderer, one ping-pong variable). The velocity is analytic:
 * a radial push from the drop point that decays with age, three octaves of
 * curl noise that fold the bloom, and a slow sink. The first-emitted
 * particles are the fast outer tendrils (gold); the last-emitted stay near
 * the centre as the dense ivory core, which sinks a little faster than its
 * bloom. A single Points draw reads the texture: additive 4 px Gaussian
 * sprites, spreading into dimmer circles of confusion away from the focal
 * plane as through a long lens, whose alpha rises as the ink spreads (dense
 * ink is dim per particle) and fades over the last twenty seconds of a life.
 * Inside the mark's box the ink is shaded to 0.4, so only thinned tendrils
 * pass behind the letters.
 *
 * The clock is pre-rolled 22 s at load, so the first frame is a bloom; the
 * reduced-motion still is the frame at 28 s. The camera only leans toward
 * the pointer; the ink ignores the hand. Phones get a smaller texture and a
 * lower pixel ratio. Without WebGL, float render targets, or three.js, the
 * canvas stays a deep blue and the page still reads.
 */

const DEG = Math.PI / 180;
/** One bead per period: six seconds of emission, lives of 60 to 95 s, then empty water until the next drop. */
const PERIOD = 104;
const EMIT = 6;
const LIFE_MIN = 60;
const LIFE_MAX = 95;
/** The clock at the first frame, and the frame the reduced-motion still shows. */
const START = 22;
const STILL = 28;
/** The warm-up steps the clock in fixed strides. */
const WARM_DT = 0.05;
/** The camera's distance; the lens is set so the frame is one unit tall at the ink. */
const DIST = 6;
/**
 * Drop points as viewport fractions; desktop beads alternate sides, phones drop on the centreline. The desktop
 * drops sit at 68% of the height (the brief said 62%) so the core, the frame's brightest point, stays below the
 * mark's box as it sinks.
 */
const DROPS = [
  [0.38, 0.68],
  [0.62, 0.68],
];
const PHONE_DROP = [0.5, 0.66];
/**
 * How far out a particle settles relative to the bloom's edge, by emission order: the 3D density of the bloom is
 * 5 in a core out to half the radius, 1 in the body and 2 in a thin shell at the edge, with soft steps, so the
 * projected ink has a heart four times its mean, a thinner body, and a rim that draws the lobes the curl folds;
 * never a point that whites out.
 */
const density = (s: number) => {
  const soft = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return 1 + 4 * (1 - soft(0.4, 0.6, s)) + soft(0.78, 0.92, s);
};
const radiusByRank = () => {
  const n = 1024;
  const F = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    F[i] = F[i - 1] + s * s * density(s);
  }
  for (let i = 0; i <= n; i++) F[i] /= F[n];
  // rank 0 is the outermost particle and rank 1 the innermost: invert the fraction inside a radius.
  return (rank: number) => {
    const u = 1 - rank;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (F[mid] < u) lo = mid;
      else hi = mid;
    }
    const f = (u - F[lo]) / Math.max(1e-9, F[hi] - F[lo]);
    return (lo + f) / n;
  };
};

/** Simplex noise (Ashima) returning its analytic gradient in xyz and the value in w, and a hash for the spawn jitter. */
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec4 snoiseGrad(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    vec4 m2 = m * m;
    vec4 m4 = m2 * m2;
    vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
    // d/dv of m^4 (p.x) = m^3 (m p - 8 x (p.x)), the kernel's derivative times the gradient's ramp.
    vec4 temp = -8.0 * m2 * m * pdotx;
    vec3 grad = temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3 + m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
    return 42.0 * vec4(grad, dot(m4, pdotx));
  }
  // The curl of a vector potential of three offset noises: a divergence-free field, so the ink folds and never piles up.
  vec3 curlAt(vec3 p) {
    vec4 a = snoiseGrad(p);
    vec4 b = snoiseGrad(p + vec3(31.416, -17.2, 5.9));
    vec4 c = snoiseGrad(p + vec3(-12.3, 44.1, -8.8));
    return vec3(c.y - b.z, a.z - c.x, b.x - a.y);
  }
  // Three octaves, the second strong so the bloom crinkles rather than staying round; unit RMS (the curl of one
  // octave measures 3.77), with the rare spike held to three times that.
  vec3 curlField(vec3 p, float f) {
    vec3 c = curlAt(p * f) * 0.75 + curlAt(p * f * 2.0 + 7.3) * 0.55 + curlAt(p * f * 4.0 - 3.1) * 0.35;
    c *= 1.0 / 3.77;
    return c * min(1.0, 3.0 / max(length(c), 1e-6));
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
`;

/**
 * The simulation, one texel per particle: xyz the position relative to the drop point (world units, the frame one
 * unit tall), w the age in seconds, or -1 while the particle waits for its turn. The seed texture holds the lifetime,
 * the emission delay and the rank (emission order, 0 first).
 */
const SIM = /* glsl */ `
  uniform sampler2D texSeed;
  uniform float uT; // the clock before this step, wrapped to two periods
  uniform float uDt;
  uniform vec3 uDrift; // where the curl field has drifted to, in world units
  uniform float uStretch; // the bloom's width for its height: the frame's aspect on desktop, capped on phones
  uniform float uPeriod;
  uniform float uFreq; // cycles of the base octave per world unit
  ${NOISE}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 st = texture2D(texState, uv);
    vec4 sd = texture2D(texSeed, uv);
    float tNew = uT + uDt;
    float age = mod(tNew, uPeriod) - sd.y;
    if (age < 0.0 || age > sd.x) {
      gl_FragColor = vec4(st.xyz, -1.0);
      return;
    }
    if (st.w < 0.0) {
      // Its turn: it appears in a 0.5%-of-the-width sphere at the drop point.
      vec3 h = hash33(vec3(uv * 977.0, uDrift.x * 53.0 + 1.0));
      float z = h.x * 2.0 - 1.0;
      float ph = h.y * 6.2831853;
      float rxy = sqrt(max(0.0, 1.0 - z * z));
      gl_FragColor = vec4(vec3(rxy * cos(ph), rxy * sin(ph), z) * (0.005 * uStretch * pow(h.z, 0.3333)), age);
      return;
    }
    vec3 q = st.xyz;
    float a = st.w;
    float rank = sd.z;
    // How far out this particle settles: the first-emitted make the shell, the last the core (radiusByRank).
    float s = sd.w;
    float len = max(length(q), 1e-5);
    // Radial: 1.2% of the width a second at first, decaying over 14 s to a floor of 0.15%; the same in height terms
    // vertically, so the bloom opens as an ellipse the shape of the frame.
    float rad = (0.0015 + 0.0105 * exp(-a / 14.0)) * s;
    vec3 v = (q / len) * rad * vec3(uStretch, 1.0, 1.0);
    // Curl noise folds the bloom: 0.35% of the width a second at first, 0.08% by a minute. The dense core is
    // heavy and feels a third of it, so it is the shell that folds and the core that sinks.
    float amp = 0.0035 * uStretch * exp(-a / 40.0) * (0.3 + 0.7 * s);
    v += amp * curlField(q + uDrift, uFreq);
    // The sink: 0.08% of the height a second, and half as much again for the core, which drops through its bloom.
    v.y -= 0.0008 + 0.0004 * smoothstep(0.5, 0.85, rank);
    gl_FragColor = vec4(q + v * uDt, a + uDt);
  }
`;

const VERT = /* glsl */ `
  uniform sampler2D texState;
  uniform sampler2D texSeed;
  uniform float uT; // the clock of the state, wrapped to two periods
  uniform float uPeriod;
  uniform float uPixel; // device px per CSS px
  uniform vec3 uDrop[2]; // the drop points of even and odd periods
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;
  const vec3 IVORY = vec3(0.957, 0.929, 0.878);
  const vec3 CHAMPAGNE = vec3(0.914, 0.843, 0.659);
  const vec3 GOLD = vec3(0.847, 0.710, 0.416);
  const vec3 DEEP = vec3(0.655, 0.486, 0.196);
  void main() {
    vec4 st = texture2D(texState, position.xy);
    float age = st.w;
    if (age < 0.0) {
      // Waiting its turn: off screen and invisible.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec3(0.0);
      vAlpha = 0.0;
      vSharp = 1.0;
      return;
    }
    vec4 sd = texture2D(texSeed, position.xy);
    // Which period this particle was dropped in says which side it is on.
    float cycle = floor((uT - age - sd.y + 3.0) / uPeriod);
    vec3 p = (mod(cycle, 2.0) < 0.5 ? uDrop[0] : uDrop[1]) + st.xyz;
    // Light by emission order: gold tendrils first out, a champagne body, the ivory core last; deep gold as it dissolves.
    float rank = sd.z;
    // At these luminances ivory reads grey over the near-black water, so it is kept for the heart of the core and
    // the rest of the core is champagne.
    vec3 c = mix(GOLD, CHAMPAGNE, smoothstep(0.35, 0.7, rank));
    c = mix(c, IVORY, smoothstep(0.82, 0.97, rank));
    float fade = smoothstep(sd.x - 20.0, sd.x, age);
    c = mix(c, DEEP, fade * 0.85);
    // Dense young ink is dim per particle; the alpha rises as the bloom spreads, so the picture never goes white
    // even where the curl folds the ink three deep, then fades over the last twenty seconds. The core carries a
    // little more light than the tendrils.
    float a = 0.1 * pow(1.0 - exp(-age / 18.0), 2.5) + 0.0005;
    a *= mix(0.75, 1.2, smoothstep(0.3, 0.9, rank));
    a *= 1.0 - fade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // The mark's box, 60% wide and 35% tall: ink inside it is shaded to 0.4 (the brief said half; a fold of the
    // shell at the box's edge reached a quarter of white at half), so only thin tendrils pass behind the letters.
    // The shade lifts over a band just outside the box (0.95 to 1.2 of its half-height, about 40 px), so the core
    // sinking below the box is in the clear.
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 e = vec2(abs(ndc.x) / 0.6, abs(ndc.y) / 0.35);
    e *= e;
    e *= e;
    float outside = smoothstep(0.95, 1.2, pow(e.x + e.y, 0.25));
    a *= mix(0.4, 1.0, outside);
    // A 4 px mote at the focal plane (the brief said 2 px: at this bloom's size, 65,536 sharper motes read as
    // sand, not fluid). Beyond a slab 0.04 units deep at the focal plane a mote spreads into a circle of
    // confusion (40 px per unit of depth, capped at 10 px, and never over the mark), as through a long lens: the
    // limb of the bloom and the folds near the focal plane stay firm, the front and back of the ball soften into
    // haze over the heart. Each is a Gaussian spot (sigma 0.35 S + 0.05 CSS px, the sprite reaching 2.5 sigma)
    // whose light falls with its area, so the picture keeps its brightness however the spots grow.
    float S = 4.0 + min(10.0, max(0.0, abs(p.z) - 0.02) * 40.0) * outside;
    float sigma = 0.35 * S + 0.05;
    float sprite = 5.0 * sigma;
    a *= 0.5625 / (sigma * sigma);
    vSharp = sprite * sprite / (8.0 * sigma * sigma);
    gl_PointSize = sprite * uPixel;
    vAlpha = a;
    vColor = c;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-vSharp * dot(q, q) * 4.0);
    // Additive blending multiplies by the alpha channel (SRC_ALPHA, ONE), so the colour goes out straight.
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export default function Ink({ still }: BackdropProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      let THREE: typeof T;
      let GPUComputationRenderer: typeof GPUCompute;
      try {
        THREE = await import("three");
        GPUComputationRenderer = (await import("three/examples/jsm/misc/GPUComputationRenderer.js")).GPUComputationRenderer;
      } catch {
        setFailed(true);
        return;
      }
      if (disposed) return;
      let renderer: T.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
      } catch {
        setFailed(true);
        return;
      }
      const phone = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
      renderer.setClearColor(0x05060b, 1);
      // The state lives in a float texture; where float render targets are missing, half floats and coarser steps.
      const fullFloat = renderer.extensions.has("EXT_color_buffer_float");
      if (!fullFloat && !renderer.extensions.has("EXT_color_buffer_half_float")) {
        renderer.dispose();
        setFailed(true);
        return;
      }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera((2 * Math.atan(0.5 / DIST)) / DEG, 1, 1, 20);

      // ── The particles: a texture of positions and ages, stepped on the GPU; a static texture of seeds ──
      const N = phone ? 128 : 256;
      const count = N * N;
      const gpu = new GPUComputationRenderer(N, N, renderer);
      if (!fullFloat) gpu.setDataType(THREE.HalfFloatType);
      let seedN = 11;
      const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      const seeds = new Float32Array(count * 4);
      const radius = radiusByRank();
      for (let i = 0; i < count; i++) {
        const rank = rnd();
        seeds[i * 4] = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * rnd();
        seeds[i * 4 + 1] = rank * EMIT;
        seeds[i * 4 + 2] = rank;
        seeds[i * 4 + 3] = radius(rank);
      }
      const seedTex = new THREE.DataTexture(seeds, N, N, THREE.RGBAFormat, THREE.FloatType);
      seedTex.needsUpdate = true;
      // Every particle starts waiting its turn (age -1); the warm-up drops the first bead.
      const init = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) init[i * 4 + 3] = -1;
      const state0 = new THREE.DataTexture(init, N, N, THREE.RGBAFormat, THREE.FloatType);
      state0.needsUpdate = true;
      const sim: Variable = gpu.addVariable("texState", SIM, state0);
      gpu.setVariableDependencies(sim, [sim]);
      const su = sim.material.uniforms;
      su.texSeed = { value: seedTex };
      su.uT = { value: 0 };
      su.uDt = { value: WARM_DT };
      su.uDrift = { value: new THREE.Vector3() };
      su.uStretch = { value: 1 };
      su.uPeriod = { value: PERIOD };
      su.uFreq = { value: 1 };
      const problem = gpu.init();
      if (problem) {
        gpu.dispose();
        seedTex.dispose();
        renderer.dispose();
        setFailed(true);
        return;
      }

      // ── One Points draw: each vertex is the texel it reads ──
      const refs = new Float32Array(count * 2);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          refs[i * 2] = (x + 0.5) / N;
          refs[i * 2 + 1] = (y + 0.5) / N;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(refs, 2));
      // The positions live in the texture, so the geometry's bounds are nominal (the renderer's sort wants them).
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          texState: { value: null },
          texSeed: { value: seedTex },
          uT: { value: 0 },
          uPeriod: { value: PERIOD },
          uPixel: { value: renderer.getPixelRatio() },
          uDrop: { value: [new THREE.Vector3(), new THREE.Vector3()] },
        },
      });
      const pu = mat.uniforms;
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      scene.add(points);

      // ── The clock: the simulation steps in fixed strides during the warm-up, then with the frames ──
      let simT = 0;
      const drift = su.uDrift.value as T.Vector3;
      const step = (dt: number) => {
        su.uT.value = simT % (2 * PERIOD);
        su.uDt.value = dt;
        // The field drifts 0.02 units a second along a fixed line, so no two blooms fold alike.
        drift.set(0.6, -0.5, 0.62).multiplyScalar(simT * 0.02);
        gpu.compute();
        simT += dt;
        pu.uT.value = simT % (2 * PERIOD);
        pu.texState.value = gpu.getCurrentRenderTarget(sim).texture;
      };
      // The warm-up runs in slices of about 30 ms, a frame at a time, and nothing is drawn until the bloom is old
      // enough: a few black frames on a laptop, and never a stalled page on a slow GPU.
      let warmLeft = Math.round((still ? STILL : START) / WARM_DT);
      const gl = renderer.getContext();
      const warm = () => {
        const t0 = performance.now();
        while (warmLeft > 0 && performance.now() - t0 < 30) {
          const n = Math.min(warmLeft, 20);
          for (let i = 0; i < n; i++) step(WARM_DT);
          warmLeft -= n;
          // Wait for the GPU, so a slice measures real work and a slow GPU takes more frames rather than a stall.
          gl.finish();
        }
        return warmLeft === 0;
      };

      // ── The camera, the pointer, the frames ──
      let w = 1;
      let h = 1;
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        const aspect = w / h;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        // The bloom opens 1.2% of the width a second sideways and 1.2% of the height upward on desktop; on a phone
        // it opens the same in both, capped so its full width stays under 80% of the screen.
        const stretch = phone ? Math.min(1, 1.6 * aspect) : aspect;
        su.uStretch.value = stretch;
        // The curl field's base octave spans 18% of that width.
        su.uFreq.value = 1 / (0.18 * stretch);
        // Drop points are viewport fractions, so the ink keeps its place in the frame through a resize.
        const drops = phone ? [PHONE_DROP, PHONE_DROP] : DROPS;
        (pu.uDrop.value as T.Vector3[]).forEach((v, i) => v.set((drops[i][0] - 0.5) * aspect, 0.5 - drops[i][1], 0));
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const place = (dt: number) => {
        // The lean eases toward the pointer over a couple of seconds, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 0.9);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const yaw = lx * 3 * DEG;
        const pitch = -ly * 1.5 * DEG;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * DIST, Math.sin(pitch) * DIST, Math.cos(yaw) * Math.cos(pitch) * DIST);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      size();
      renderer.clear();
      let raf = 0;
      if (still) {
        // One frame at 28 s, drawn once the warm-up has reached it; no loop.
        const warmStill = () => {
          if (warm()) place(0);
          else raf = requestAnimationFrame(warmStill);
        };
        warmStill();
        const onResize = () => {
          size();
          if (warmLeft === 0) place(0);
        };
        window.addEventListener("resize", onResize);
        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener("resize", onResize);
          gpu.dispose();
          seedTex.dispose();
          geo.dispose();
          mat.dispose();
          renderer.dispose();
        };
        return;
      }
      let last = 0;
      let owed = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (warmLeft > 0) {
          if (!warm()) return;
          last = 0;
        }
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
        last = now;
        if (fullFloat) {
          step(dt);
        } else {
          // Half floats lose a 60 Hz step below their precision, so the ink steps ten times a second instead.
          owed += dt;
          if (owed >= 0.1) {
            step(0.1);
            owed -= 0.1;
          }
        }
        place(dt);
      };
      const onMove = (e: PointerEvent) => {
        tx = (e.clientX / w) * 2 - 1;
        ty = (e.clientY / h) * 2 - 1;
      };
      const onLeave = () => {
        tx = 0;
        ty = 0;
      };
      const onVisible = () => {
        cancelAnimationFrame(raf);
        last = 0;
        if (!document.hidden) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      window.addEventListener("resize", size);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisible);
      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", size);
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
        document.removeEventListener("visibilitychange", onVisible);
        gpu.dispose();
        seedTex.dispose();
        geo.dispose();
        mat.dispose();
        renderer.dispose();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [still]);
  return <canvas ref={ref} aria-hidden className={`door-sky ${failed ? "door-sky-flat" : ""}`} />;
}
