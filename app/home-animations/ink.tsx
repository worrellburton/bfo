import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { GPUComputationRenderer as GPUCompute, Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import type { BackdropProps } from "./types";

/**
 * Ink in water: black water through a long lens, and nothing drawn but the
 * ink. A bead of gold ink appears low in the frame, beside the mark, and
 * opens over a minute and a half: a bloom that mushrooms below its point of
 * entry and folds into lobes, tendrils and filaments as it thins and sinks,
 * until it is the water again. Ten seconds of empty water, then the next
 * bead, on the other side.
 *
 * The ink is 65,536 particles (16,384 on phones) whose positions and ages
 * live in a float texture, stepped on the GPU each frame (three's
 * GPUComputationRenderer, one ping-pong variable). The velocity is analytic:
 * a radial push from the drop point that decays with age and is held back
 * upward (a sinking drop opens below itself, with a thin stem above), four
 * octaves of curl noise that fold the bloom, and a slow sink. The
 * first-emitted particles make a thin skin at the rim, the last the heart,
 * which sinks a little faster than its bloom.
 *
 * Light is density. One Points draw accumulates every particle's 4 px
 * Gaussian sprite (spreading into dimmer circles of confusion away from the
 * focal plane, as through a long lens) into a half-float target, which is an
 * exposure: it keeps a running average of the last 0.15 s of frames, so the
 * thousandth-of-a-level contributions of a young bead, a defocused mote or a
 * fading one all count and the grain of a single frame settles. A second
 * pass puts that density through a knee that can never reach 85% of white
 * and colours it by how much ink is there: deep gold in the thinnest haze,
 * gold, champagne, ivory only at the heart. Inside the mark's box the ink is
 * shaded to half, so only thinned tendrils pass behind the letters.
 *
 * The clock is pre-rolled 22 s at load, so the first frame is a bloom; the
 * reduced-motion still is the frame at 28 s. The camera only leans toward
 * the pointer; the ink ignores the hand. Phones get a smaller texture and a
 * lower pixel ratio, and a machine that drops frames in its first four
 * seconds gets a smaller accumulation target. Without WebGL, float render
 * targets, or three.js, the canvas stays a deep blue and the page still
 * reads.
 */

const DEG = Math.PI / 180;
/**
 * One bead per period: six seconds of emission, lives of 78 to 96 s (the brief said 60 to 95: the bloom is a thin
 * haze by 85 s and this keeps it readable to about 90), then ten seconds of empty water until the next drop.
 */
const PERIOD = 100;
const EMIT = 6;
const LIFE_MIN = 78;
const LIFE_MAX = 96;
/** The clock at the first frame, and the frame the reduced-motion still shows. */
const START = 22;
const STILL = 28;
/** The warm-up steps the clock in fixed strides. */
const WARM_DT = 0.05;
/** The camera's distance; the lens is set so the frame is one unit tall at the ink. */
const DIST = 6;
/**
 * The exposure, in seconds: the accumulated ink is a running average of the frames of the last 0.15 s (a 1/7 s
 * shutter). Nothing in the ink moves more than 1.5 px in that time, so there is no trail, but the sand of one
 * frame's random motes settles into a surface.
 */
const EXPOSURE = 0.15;
/**
 * Drop points as viewport fractions; desktop beads alternate sides, phones drop on the centreline. The drops sit at
 * 71% of the height (the brief said 62%): the bead is a bright point for its first seconds, and here it is already
 * under the mark's box (whose bottom edge is at 67.5%); the heart, the frame's brightest point, then sinks further,
 * the crown of the skin stays at the box's edge, and the bloom's fall and sink are paced so its body stays above
 * the bottom edge until it has dissolved.
 */
const DROPS = [
  [0.38, 0.71],
  [0.62, 0.71],
];
const PHONE_DROP = [0.5, 0.71];
/** The knee: ink of accumulated luminance l shows as KNEE l / (KNEE + l), so with the water added the peak stays under 85%. */
const KNEE = 0.82;
/** The alpha law is tuned on this frame: a 1440 x 900 desktop with 65,536 motes; other sizes and counts are scaled to it. */
const REF = { count: 65536, stretch: 1.6, height: 900 };
/**
 * How far out a particle settles relative to the bloom's edge, by emission order: the 3D density of the bloom is
 * 3.5 in a core out to half the radius, 0.15 in the body and 5 in a thin skin at the edge (3% of the radius, with
 * soft steps): a third of the ink is the heart, 60% the skin, 7% the water between. Ink in water is sheets around
 * clear water, and the sheet is what the eye reads: its limb (seen edge-on, a chord through the skin forty times
 * its thickness) projects as a line several times brighter than the faint glow of its front and back, and the
 * folds the curl crumples into it as sheets and tendrils. A body of 0.7 would fill the interior to within a
 * factor of 1.4 of the limb and the line would be lost in a cloud; never a point that whites out.
 */
const density = (s: number) => {
  const soft = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return 0.15 + 3.35 * (1 - soft(0.4, 0.6, s)) + 4.85 * soft(0.955, 0.98, s);
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
  // Four octaves, the base one light and the rest strong: the base octave (18% of the width) is nearly uniform
  // across a bloom and only shears it; the 9% and 4.5% octaves crinkle its rim into cauliflower folds, and the
  // 2.25% octave puts the small folds on the skin that read as tendrils. Unit RMS (the curl of one octave measures
  // 3.77, and the weights' norm is 1.13), with the rare spike held to two and a half times that, so no tongue on
  // the rim is straight-sided.
  vec3 curlField(vec3 p, float f) {
    vec3 c = curlAt(p * f) * 0.4 + curlAt(p * f * 2.0 + 7.3) * 0.8 + curlAt(p * f * 4.0 - 3.1) * 0.6 + curlAt(p * f * 8.0 + 11.7) * 0.35;
    c *= 1.0 / 4.27;
    return c * min(1.0, 2.5 / max(length(c), 1e-6));
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
    float tb = mod(tNew, uPeriod);
    float age = tb - sd.y;
    if (age < 0.0 || age > sd.x) {
      gl_FragColor = vec4(st.xyz, -1.0);
      return;
    }
    // The bead keeps falling as it opens: 0.375% of the height a second at first, gone by a minute, so the bloom
    // hangs 4.5% of the height below its point of entry, and its heart, the brightest thing in the frame, is
    // clear of the mark's box by the time it is bright. Its centre is where every particle of this period's bead
    // expands from, and where the ones still waiting their turn appear.
    vec3 centre = vec3(0.0, -0.045 * (1.0 - exp(-tb / 12.0)), 0.0);
    if (st.w < 0.0) {
      // Its turn: it appears on a 0.5%-of-the-width sphere at the bead's centre (its outer fifth, not its volume:
      // the spread in radius would be the skin's thickness).
      vec3 h = hash33(vec3(uv * 977.0, uDrift.x * 53.0 + 1.0));
      float z = h.x * 2.0 - 1.0;
      float ph = h.y * 6.2831853;
      float rxy = sqrt(max(0.0, 1.0 - z * z));
      gl_FragColor = vec4(centre + vec3(rxy * cos(ph), rxy * sin(ph), z) * (0.005 * uStretch * (0.8 + 0.2 * h.z)), age);
      return;
    }
    vec3 q = st.xyz;
    float a = st.w;
    float rank = sd.z;
    // How far out this particle settles: the first-emitted make the skin, the last the core (radiusByRank).
    float s = sd.w;
    vec3 qc = q - centre;
    float len = max(length(qc), 1e-5);
    // Radial: 1.2% of the width a second at first, decaying over 14 s to 0.15% by 40 s and a floor of 0.09%; the
    // same in height terms vertically, so the bloom opens as an ellipse the shape of the frame.
    float rad = (0.0009 + 0.0111 * exp(-a / 14.0)) * s;
    vec3 v = (qc / len) * rad * vec3(uStretch, 1.0, 1.0);
    // A mushroom, not a ball: the expansion is slower toward the crown of the bloom than its underside (0.6 at
    // the top, 0.82 below, 1.0 sideways), easing over the whole sphere, so the cap is flat above and round below,
    // no row of ink piles up into a lid, the heart, which opens the same way, keeps its top under the mark's box,
    // and the bloom's foot stays above the bottom of the frame.
    v.y *= mix(0.82, 0.6, smoothstep(-0.7, 0.7, qc.y / len));
    // Curl noise folds the bloom: 0.35% of the width a second at first, a third of that by a minute (the lobes keep
    // folding into the second minute). The dense core is heavy and feels a fifth of it, the skin all of it, so it
    // is the skin that folds and the core that sinks.
    float amp = 0.0035 * uStretch * exp(-a / 55.0) * (0.2 + 0.8 * s * s);
    v += amp * curlField(q + uDrift, uFreq);
    // The fall of the bead, then the sink: 0.04% of the height a second for good (the brief said 0.08: the bloom
    // opens below its drop, and at that pace its body ran off the bottom of the frame), and three quarters as much
    // again for the core, which drops through its bloom.
    v.y -= 0.00375 * exp(-tb / 12.0) + 0.0004 + 0.0003 * smoothstep(0.6, 0.85, rank);
    // The age stored is the clock's, not the sum of steps: in half floats a sum drifts.
    gl_FragColor = vec4(q + v * uDt, age);
  }
`;

/**
 * The Points draw: every live particle's sprite accumulates (light, light x rank) into the half-float target; the
 * composite pass turns that density into colour.
 */
const VERT = /* glsl */ `
  uniform sampler2D texState;
  uniform sampler2D texSeed;
  uniform float uT; // the clock of the state, wrapped to two periods
  uniform float uPeriod;
  uniform float uPixel; // accumulation px per CSS px
  uniform float uGain; // scales the light so the picture is the same at any frame size or particle count
  uniform float uWeight; // this frame's share of the exposure
  uniform vec3 uDrop[2]; // the drop points of even and odd periods
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;
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
    float rank = sd.z;
    // Energy only decays: a mote's light rises over its first four seconds as the bead opens (the bead goes from a
    // tenth of its peak to its peak over about ten seconds, never under one), then only the thinning of the bloom
    // dims the picture, until the fade over the last fifteen seconds of a life. The 0.07 puts the bead's heart
    // near 50% of white and the limb of the skin at 28 s near 30%. The heart carries seven tenths more light per
    // mote than the skin, which packs its ink into a line.
    float fade = smoothstep(sd.x - 15.0, sd.x, age);
    float a = 0.07 * pow(1.0 - exp(-age / 4.0), 2.0) * uGain * uWeight;
    a *= mix(0.7, 1.2, smoothstep(0.55, 0.75, rank));
    a *= 1.0 - fade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // The mark's box, 60% wide and 35% tall: ink inside it is shaded to half, so only thin tendrils pass behind the
    // letters. The shade lifts over a wide band around the box's edge (0.8 to 1.35 of its half-size, about 85 px
    // on a 900 px frame), too gradual to draw an edge across the ink.
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 e = vec2(abs(ndc.x) / 0.6, abs(ndc.y) / 0.35);
    e *= e;
    e *= e;
    float outside = smoothstep(0.8, 1.35, pow(e.x + e.y, 0.25));
    a *= mix(0.5, 1.0, outside);
    // A 4 px mote at the focal plane (the brief said 2 px: at this bloom's size, 65,536 sharper motes read as
    // sand, not fluid). The lens is long and its focus a slab 0.012 units deep: beyond it a mote spreads into a
    // circle of confusion (80 px per unit of depth, capped at 6 px, and never over the mark), so the limb of the
    // skin and the folds at the focal plane stay firm, and the heart and the front and back of the skin, which
    // are volumes, are smooth. Each is a Gaussian spot (sigma 0.4 S + 0.1 CSS px, so a focused mote is 4 px
    // across at half its peak; the sprite reaches 2.5 sigma, 2.2 for the largest, 17 px) whose light falls with
    // its area, so the picture keeps its brightness however the spots grow.
    float S = 4.0 + min(6.0, max(0.0, abs(p.z) - 0.012) * 80.0) * outside;
    float sigma = 0.4 * S + 0.1;
    float sprite = mix(5.0, 4.2, smoothstep(5.0, 10.5, S)) * sigma;
    a *= 0.5625 / (sigma * sigma);
    vSharp = sprite * sprite / (8.0 * sigma * sigma);
    gl_PointSize = sprite * uPixel;
    vAlpha = a;
    // Red accumulates the light, green the light weighted by rank, so the composite knows how much ink is at a
    // pixel and whether it is skin or heart.
    vColor = vec3(1.0, rank, 0.0);
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

/** One triangle over the frame, for the exposure's decay and the composite. */
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
/** The exposure: the previous frames' ink, faded by exp(-dt / 0.15 s), is the floor this frame's sprites add to. */
const DECAY_FRAG = /* glsl */ `
  uniform sampler2D tPrev;
  uniform float uDecay;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tPrev, vUv) * uDecay;
  }
`;
/** The composite: reading the accumulated ink. */
const COMP_FRAG = /* glsl */ `
  uniform sampler2D tInk;
  uniform float uKnee;
  varying vec2 vUv;
  const vec3 WATER = vec3(5.0, 6.0, 11.0) / 255.0;
  const vec3 IVORY = vec3(0.957, 0.929, 0.878);
  const vec3 CHAMPAGNE = vec3(0.914, 0.843, 0.659);
  const vec3 GOLD = vec3(0.847, 0.710, 0.416);
  const vec3 DEEP = vec3(0.655, 0.486, 0.196);
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // The brand's warm stops by how much ink there is, each chosen at the luminance it is shown at: deep gold holds
  // to 30% of white (a 50%-luminance colour keeps its chroma when dimmed; champagne dimmed is khaki), gold at 50%,
  // champagne at 70%, ivory only at the knee: thin veils dark and amber, the dense heart pale gold.
  vec3 ramp(float u) {
    vec3 c = mix(DEEP, GOLD, clamp((u - 0.30) / 0.20, 0.0, 1.0));
    c = mix(c, CHAMPAGNE, clamp((u - 0.50) / 0.20, 0.0, 1.0));
    return mix(c, IVORY, clamp((u - 0.70) / 0.12, 0.0, 1.0));
  }
  void main() {
    vec2 ink = texture2D(tInk, vUv).rg;
    float l = ink.x;
    // The knee: more ink always shows as more light, but never past uKnee of white.
    float k = uKnee * l / (uKnee + l);
    // Which of the ink here is heart and which is skin tints the ramp by a tenth either way.
    float rank = ink.y / max(l, 1e-6);
    vec3 c = ramp(k * (0.9 + 0.2 * rank));
    gl_FragColor = vec4(WATER + c * (k / lum(c)), 1.0);
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
      renderer.clear();
      // The state and the accumulated ink live in float textures; where float render targets are missing, half
      // floats and coarser steps for the state (the ink is always accumulated in half floats).
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
        // The skin (the first 57% emitted) goes out in the first 1.2 s and the heart over the rest of the six:
        // what makes the skin thin is that its particles share one expansion, and a second's difference in age is
        // seven pixels of radius at 30 s.
        seeds[i * 4 + 1] = rank * rank * rank * EMIT;
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

      // ── One Points draw into the accumulation target: each vertex is the texel it reads ──
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
      // The ink is accumulated at CSS resolution (one accumulation px per CSS px, fewer where the pixel ratio is
      // under one, and three quarters of that on a machine that drops frames): a 4 px Gaussian mote is well
      // sampled there, the composite's bilinear upsample is invisible on a soft fluid, and at 2x it is a quarter
      // of the blended fragments, which are what this backdrop costs. The light per pixel does not depend on it.
      let accPx = Math.min(1, renderer.getPixelRatio());
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
          uPixel: { value: accPx },
          uGain: { value: 1 },
          uWeight: { value: 1 },
          uDrop: { value: [new THREE.Vector3(), new THREE.Vector3()] },
        },
      });
      const pu = mat.uniforms;
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      scene.add(points);

      // ── The exposure's two targets, the decay that ping-pongs them, and the composite that reads the latest ──
      const target = () =>
        new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        });
      const acc = [target(), target()];
      let cur = 0;
      // A fresh target (sized, or re-sized) holds nothing: the next frame is drawn whole, with no decay pass.
      let fresh = true;
      const quadGeo = new THREE.BufferGeometry();
      quadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
      quadGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
      const decayMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: DECAY_FRAG,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NoBlending,
        uniforms: { tPrev: { value: null }, uDecay: { value: 1 } },
      });
      const decayScene = new THREE.Scene();
      const decay = new THREE.Mesh(quadGeo, decayMat);
      decay.frustumCulled = false;
      decayScene.add(decay);
      const compMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: COMP_FRAG,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NoBlending,
        uniforms: { tInk: { value: null }, uKnee: { value: KNEE } },
      });
      const compScene = new THREE.Scene();
      const comp = new THREE.Mesh(quadGeo, compMat);
      comp.frustumCulled = false;
      compScene.add(comp);
      // Nothing is cleared but a fresh accumulation target: the decay covers every pixel of the target and the
      // composite every pixel of the frame.
      renderer.autoClear = false;
      const gl = renderer.getContext();
      const disposeAll = () => {
        gpu.dispose();
        seedTex.dispose();
        geo.dispose();
        mat.dispose();
        acc[0].dispose();
        acc[1].dispose();
        quadGeo.dispose();
        decayMat.dispose();
        compMat.dispose();
        renderer.dispose();
      };
      // A half-float target that cannot be drawn into (the extension is there but the format is not renderable)
      // would leave the water empty: check it once, and fall back to the flat canvas.
      renderer.setRenderTarget(acc[0]);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      renderer.setRenderTarget(null);
      if (!complete) {
        disposeAll();
        setFailed(true);
        return;
      }
      /** Draws a frame: the last frames' ink faded, this one's sprites added, and the composite of the sum. */
      const draw = (dt: number) => {
        const next = acc[1 - cur];
        renderer.setRenderTarget(next);
        if (fresh || dt <= 0) {
          renderer.setClearColor(0x000000, 0);
          renderer.clear(true, false, false);
          pu.uWeight.value = 1;
          fresh = false;
        } else {
          const keep = Math.exp(-dt / EXPOSURE);
          decayMat.uniforms.tPrev.value = acc[cur].texture;
          decayMat.uniforms.uDecay.value = keep;
          renderer.render(decayScene, camera);
          pu.uWeight.value = 1 - keep;
        }
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        compMat.uniforms.tInk.value = next.texture;
        renderer.render(compScene, camera);
        cur = 1 - cur;
      };

      // ── The clock: the simulation steps in fixed strides during the warm-up, then with the frames ──
      let simT = 0;
      const drift = su.uDrift.value as T.Vector3;
      const step = (dt: number) => {
        su.uT.value = simT % (2 * PERIOD);
        su.uDt.value = dt;
        // The field drifts 0.004 units a second along a fixed line (the brief said 0.02: that is faster than the ink
        // itself moves, so a fold lasted three seconds and the rim diffused; at this pace the lobes persist and
        // grow), and it has moved a bloom's width by the next bead on the same side, so no two blooms fold alike.
        drift.set(0.6, -0.5, 0.62).multiplyScalar(simT * 0.004);
        gpu.compute();
        simT += dt;
        pu.uT.value = simT % (2 * PERIOD);
        pu.texState.value = gpu.getCurrentRenderTarget(sim).texture;
      };
      // The warm-up runs in slices of about 30 ms, a frame at a time, and nothing is drawn until the bloom is old
      // enough: a few black frames on a laptop, and never a stalled page on a slow GPU.
      let warmLeft = Math.round((still ? STILL : START) / WARM_DT);
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
      const sizeTargets = () => {
        const tw = Math.max(1, Math.round(w * accPx));
        const th = Math.max(1, Math.round(h * accPx));
        acc[0].setSize(tw, th);
        acc[1].setSize(tw, th);
        pu.uPixel.value = accPx;
        fresh = true;
      };
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        sizeTargets();
        const aspect = w / h;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        // The bloom opens 1.2% of the width a second sideways and 1.2% of the height upward on desktop; on a phone
        // it opens the same in both, capped so its full width stays under 80% of the screen.
        const stretch = phone ? Math.min(1, 1.6 * aspect) : aspect;
        su.uStretch.value = stretch;
        // The curl field's base octave spans 18% of that width.
        su.uFreq.value = 1 / (0.18 * stretch);
        // The light per pixel goes as the particle count over the bloom's area in pixels (stretch x height squared):
        // held to the reference frame's, so a phone's 16k motes and a big display's wide bloom draw the same ink.
        // A phone's narrow bloom is stirred less by the curl (which scales with the stretch), so its heart would
        // peak brighter than the desktop's; it gets 0.85 of the light.
        const gain = ((REF.count / count) * (stretch * h * h)) / (REF.stretch * REF.height * REF.height);
        pu.uGain.value = Math.min(8, Math.max(0.5, gain)) * (phone ? 0.85 : 1);
        // Drop points are viewport fractions, so the ink keeps its place in the frame through a resize.
        const drops = phone ? [PHONE_DROP, PHONE_DROP] : DROPS;
        (pu.uDrop.value as T.Vector3[]).forEach((v, i) => v.set((drops[i][0] - 0.5) * aspect, 0.5 - drops[i][1], 0));
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const place = (dt: number) => {
        // The lean eases toward the pointer with a time constant of 1.5 s, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 1.5);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const yaw = lx * 3 * DEG;
        const pitch = -ly * 1.5 * DEG;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * DIST, Math.sin(pitch) * DIST, Math.cos(yaw) * Math.cos(pitch) * DIST);
        camera.lookAt(0, 0, 0);
        draw(dt);
      };
      size();
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
          disposeAll();
        };
        return;
      }
      // The governor: over the first 240 drawn frames, the frame deltas more than 1.6 times the running median are
      // the dropped frames (at 60 Hz or 120); more than a tenth of them, and the accumulation target is cut to three
      // quarters of its width and height, once. A machine that keeps up never notices.
      const deltas: number[] = [];
      let dropped = 0;
      let governed = false;
      const govern = (delta: number) => {
        deltas.push(delta);
        if (deltas.length >= 12) {
          const sorted = deltas.slice().sort((a, b) => a - b);
          if (delta > 1.6 * sorted[sorted.length >> 1]) dropped++;
        }
        if (deltas.length >= 240) {
          governed = true;
          deltas.length = 0;
          if (dropped > 24) {
            accPx *= 0.75;
            sizeTargets();
          }
        }
      };
      let last = 0;
      let owed = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (warmLeft > 0) {
          if (!warm()) return;
          last = 0;
        }
        const delta = last ? (now - last) / 1000 : 1 / 60;
        if (last && !governed) govern(delta);
        const dt = Math.min(0.1, delta);
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
        disposeAll();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [still]);
  return <canvas ref={ref} aria-hidden className={`door-sky ${failed ? "door-sky-flat" : ""}`} />;
}
