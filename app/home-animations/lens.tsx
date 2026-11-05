import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The lens: a still room full of dust too fine to see, watched through a
 * lens wide open at f/1. Tens of thousands of motes hang in the dark from
 * arm's length to the far wall, but you only ever see the ones the light
 * finds: a dusk lamp just past the upper-left corner lays warm ivory on the
 * dust near it, in slow shafts a few hundred pixels across, and the dust
 * falls cool and sparse toward the lower right, where the room is nearly
 * empty. The lens is focused a few feet in, and someone is racking the focus
 * by hand, slowly, so the one thin plane that is ever sharp drifts back and
 * forth through the cloud: a mote resolves into a pin-sharp speck for a few
 * seconds and then softens again. The motes are tiny, and they stay tiny:
 * off the plane of focus a mote goes soft, never wide (a soft Gaussian whose
 * footprint never passes six pixels, four and a half on a phone), and it
 * dims with the square of its softness, so a mote just off the plane is a
 * soft dot nearly as bright as a speck and a far one a faint breath. The
 * motes are not all alike: most are faint and a few are bright, as stars
 * are, and the light has a temperature: ivory at the lamp, silver in the
 * shade. Everything is slow: the dust hangs on a current that moves the
 * plane of focus under a pixel a second, swells and relaxes over a minute
 * and a half, leans a little left and then right, and wanders by region,
 * so no two motes march in step; the exposure breathes once every forty
 * seconds; the camera leans a degree toward the pointer. When the door is
 * ready the lens finds its plane and its exposure over two and a half
 * seconds, on the same curve as the mark's bloom. One instanced draw of
 * quads (a point sprite has a size limit on some phones; a quad has none),
 * everything analytic in the vertex shader. Reduced motion draws one frame
 * at t = 29 s, already in focus.
 */

/** The focal plane at rest, and the frame there: 5.1 units tall at z = -6 → half-angle tan 0.425. */
const FOCUS = 6;
const TAN_HALF = 2.55 / FOCUS;
const FOV = (2 * Math.atan(TAN_HALF) * 180) / Math.PI;
/** The seed box: frame fractions (with a margin for the lean and the current) and depth. */
const MARGIN = 1.12;
const Z_NEAR = 3.2;
const Z_FAR = 13;
const STILL_T = 29;

/** The light: ivory where the lamp falls, silver in the shade, a touch of champagne in the near field. */
const LAMP = [1.0, 0.94, 0.84];
const SHADE = [0.78, 0.8, 0.86];
const CHAMPAGNE = [0.94, 0.86, 0.71];

/**
 * The current, the part the whole room shares: a drift up the frame, leaning
 * a little to the right, integrated on the CPU each frame from a rate that
 * swells and relaxes over 97 s (between 0.3 and 1 of DRIFT) and a lean that
 * swings through zero over 131 s, so the dust never moves on a conveyor. The
 * rate is in units a second at the plane of focus; the near field crosses the
 * frame faster than the far wall, the parallax that makes it a room.
 */
const DRIFT = 0.009;
const driftRate = (t: number) => DRIFT * (0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 97));
const driftLean = (t: number) => 0.3 * Math.sin((2 * Math.PI * t) / 131);

/**
 * The air: sinusoids in the seed position, [direction, wavelength, period,
 * amplitude, phase] per term. The first set are the swells: plane waves with
 * a wavelength of the frame or more (5 to 11 units), turning over two to four
 * minutes, so the room moves as one body. The second are the wander: waves a
 * few hundred pixels across turning over twenty to forty seconds, so each
 * region of the dust bends its course a little, pauses and changes its mind
 * while its neighbours do something else; the amplitudes are under a pixel,
 * so no mote ever wriggles, it only wanders.
 */
const FLOW: [number, number, number, number, number, number, number][] = [
  // x
  [0.71, 0.71, 0.0, 7.0, 173, 0.025, 1.3],
  [-0.3, 0.95, 0.0, 5.0, 127, 0.011, 4.0],
  [0.26, 0.53, 0.81, 11.0, 239, 0.03, 2.2],
  // y
  [0.95, 0.31, 0.0, 8.0, 197, 0.025, 0.7],
  [-0.6, 0.2, 0.77, 5.5, 113, 0.009, 5.1],
  [0.37, -0.93, 0.0, 6.5, 149, 0.018, 3.4],
  // z
  [0.5, 0.86, 0.0, 9.0, 181, 0.02, 0.2],
  [-0.85, 0.3, 0.43, 6.0, 139, 0.012, 2.9],
  [0.2, 0.6, -0.77, 5.0, 107, 0.009, 1.9],
];
const WANDER: [number, number, number, number, number, number, number][] = [
  // x
  [0.8, 0.6, 0.0, 2.3, 29, 0.0055, 0.4],
  [-0.5, 0.7, 0.5, 1.7, 41, 0.0065, 2.6],
  // y
  [0.3, 0.95, 0.0, 2.9, 23, 0.004, 1.1],
  [0.9, -0.2, 0.4, 1.9, 37, 0.0055, 3.9],
];
const flowTerm = ([dx, dy, dz, lambda, period, amp, phase]: (typeof FLOW)[number]) => {
  const k = (2 * Math.PI) / lambda;
  const f = (n: number) => n.toFixed(5);
  return `${f(amp)} * sin(dot(q, vec3(${f(dx * k)}, ${f(dy * k)}, ${f(dz * k)})) + t * ${f((2 * Math.PI) / period)} + ${f(phase)})`;
};
const FLOW_GLSL = `vec3 flow(vec3 q, float t) {
  return vec3(
    ${flowTerm(FLOW[0])} + ${flowTerm(FLOW[1])} + ${flowTerm(FLOW[2])} + ${flowTerm(WANDER[0])} + ${flowTerm(WANDER[1])},
    ${flowTerm(FLOW[3])} + ${flowTerm(FLOW[4])} + ${flowTerm(FLOW[5])} + ${flowTerm(WANDER[2])} + ${flowTerm(WANDER[3])},
    ${flowTerm(FLOW[6])} + ${flowTerm(FLOW[7])} + ${flowTerm(FLOW[8])});
}`;

/**
 * The lamp, shared by the dust and the room behind it, in screen space with
 * the x axis scaled by the aspect (so a unit is half the frame's height):
 * just past the upper-left corner, whichever way the screen is turned, so on
 * a phone the light still comes from one side and not from under the notch.
 * Its reach is a little more than the frame's diagonal; `light` is 1 at the
 * lamp and 0 by the far corner.
 */
const LAMP_GLSL = /* glsl */ `
  float lamp(vec2 s, float aspect) {
    vec2 L = vec2(-aspect - 0.6, 1.35);
    float R = 2.5 * length(vec2(aspect, 1.0));
    float d = clamp(distance(s, L) / R, 0.0, 1.0);
    return pow(1.0 - d, 1.5);
  }
`;

const VERT = /* glsl */ `
  attribute vec2 corner;   // the quad: -1..1
  attribute vec3 aSeed;    // sx, sy (frame fractions), z0
  attribute vec4 aRnd;     // brightness, twinkle phase, twinkle rate, the density draw
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uViewport;  // CSS px
  uniform float uDpr;
  uniform float uFocus;    // the plane of focus, units from the eye
  uniform float uK;        // the blur: CSS px of sigma per unit of |1/z - 1/zf|
  uniform float uCap;      // the widest a mote may draw, CSS px
  uniform float uBright;   // the brightest mote's light, in focus
  uniform float uExposure;
  uniform vec2 uDrift;     // the current so far, units at the plane of focus (x right, y up)
  uniform float uTopDim;   // how much the top fifth is dimmed (a phone's status bar)
  uniform vec2 uMark;      // the lockup's half-footprint in NDC, with a little air
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSigma;    // the dot's Gaussian sigma, CSS px
  varying float vReach;    // the quad's half-width, CSS px
  varying vec2 vUv;
  const float TAN_HALF = ${TAN_HALF.toFixed(5)};
  const float MARGIN = ${MARGIN.toFixed(2)};
  const vec3 LAMP = vec3(${LAMP.join(", ")});
  const vec3 SHADE = vec3(${SHADE.join(", ")});
  const vec3 CHAMPAGNE = vec3(${CHAMPAGNE.join(", ")});
  ${FLOW_GLSL}
  ${LAMP_GLSL}
  void main() {
    vUv = corner;
    // Seeded as frame fractions at a depth, so every screen is full. The current is one
    // displacement for the whole room (units), so the near field crosses the frame faster than
    // the far wall; a mote wraps at the margin.
    float z0 = aSeed.z;
    float hh = TAN_HALF * -z0;
    vec3 q0 = vec3(aSeed.x * hh * uAspect, aSeed.y * hh, z0);
    float sy = mod(aSeed.y + MARGIN + uDrift.y / hh, 2.0 * MARGIN) - MARGIN;
    float sx = mod(aSeed.x + MARGIN + uDrift.x / (hh * uAspect), 2.0 * MARGIN) - MARGIN;
    vec3 p = vec3(sx * hh * uAspect, sy * hh, z0) + flow(q0, uTime);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 ndc = clip.xy / clip.w;
    float zc = -mv.z;
    // The lens: a mote is a Gaussian point; in the plane of focus its sigma is a little over half
    // a pixel (never under 0.8 device px, so it does not blink as it crosses pixel centres), and
    // off the plane the lens adds uK px of sigma per unit of 1/z, in quadrature. The footprint
    // drawn is five sigma wide and never past uCap: a mote goes soft, not wide.
    float sigma0 = max(mix(0.55, 0.7, aRnd.x), 0.8 / uDpr);
    float blur = abs(1.0 / zc - 1.0 / uFocus) * uK;
    float sigmaFull = sqrt(sigma0 * sigma0 + blur * blur);
    float sigma = min(sigmaFull, uCap * 0.2);
    // A point keeps its light as the lens spreads it, so its peak falls with the square of its
    // sigma: a mote just off the plane is a soft dot nearly as bright as a speck. Past the cap
    // the light that would have spread wider is lost instead, so the peak keeps falling, more
    // gently (the far wall and the near field stay in the picture as a quiet second layer,
    // never a blob). The motes are not all alike: most are faint and a few are bright, as
    // stars are.
    float ratio = sigma / sigma0;
    float spread = mix(0.25, 1.0, pow(aRnd.x, 1.8));
    float lit = uBright * spread / (ratio * ratio * pow(sigmaFull / sigma, 0.7));
    // The lamp: where it falls the dust is lit in full and dense; in the shade it is dim and
    // sparse. Density is a draw per mote against the light, shaped into slow shafts a few
    // hundred pixels across that turn over minutes, so the dust drifts through fixed light and
    // a mote comes and goes as it crosses a shaft; it thins again in a wide ellipse around the
    // mark, so the field has air in it and the letters sit in their own quiet.
    vec2 s = vec2(ndc.x * uAspect, ndc.y);
    float light = lamp(s, uAspect);
    float wash = mix(0.45, 1.0, light);
    float lanes = 0.65 + 0.35 * (0.5 * sin(dot(s, vec2(6.2, 4.6)) + uTime * 0.016)
                               + 0.35 * sin(dot(s, vec2(-3.4, 5.9)) + uTime * 0.021 + 2.0)
                               + 0.15 * sin(dot(s, vec2(8.9, -2.3)) + uTime * 0.013 + 4.1));
    float e = length(ndc / uMark);
    float near = 1.0 - smoothstep(0.6, 2.0, e);
    float density = mix(0.35, 1.0, light) * lanes * (1.0 - 0.55 * near);
    float keep = 1.0 - smoothstep(density - 0.08, density + 0.08, aRnd.w);
    // Scintillation: a mote in the plane wavers a little in the air.
    float twinkle = mix(0.9, 1.0, 0.5 + 0.5 * sin(uTime * aRnd.z + aRnd.y));
    // Over the mark the dust is a third as bright, in an ellipse with no corners to resolve,
    // so the letters always read; on a phone the top fifth is quieter still, under the status
    // bar. The brightest speck draws at 0.82 of white, so nothing clips.
    float overMark = 1.0 - smoothstep(0.85, 1.5, e);
    float top = 1.0 - uTopDim * smoothstep(0.6, 1.0, ndc.y);
    float alpha = min(lit * wash * twinkle * uExposure * keep * (1.0 - 0.65 * overMark) * top, 0.82);
    float reach = sigma * 2.5 + 0.5;
    bool off = abs(ndc.x) > 1.0 + reach / uViewport.x * 2.0 || abs(ndc.y) > 1.0 + reach / uViewport.y * 2.0;
    if (alpha < 0.004 || off) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // The light has a temperature: ivory under the lamp, silver in the shade, and the near field
    // warms toward champagne, each mote its own shade.
    float depth = smoothstep(2.5, 12.0, zc);
    float tint = fract(aRnd.y * 0.31831);
    vec3 col = mix(SHADE, LAMP, pow(light, 0.7));
    col = mix(col, CHAMPAGNE, 0.3 * tint * (1.0 - depth));
    vColor = col;
    vAlpha = alpha;
    vSigma = sigma;
    vReach = reach;
    vec2 px = corner * reach * 2.0 / uViewport;
    gl_Position = vec4(ndc + px, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSigma;
  varying float vReach;
  varying vec2 vUv;
  void main() {
    // A round Gaussian point, taken to zero at two and a half sigma so the quad has no edge: a
    // speck is a pinhead with a half-pixel soft rim, a soft mote the same shape, wider and dimmer.
    float r = length(vUv) * vReach / vSigma;
    const float E = 0.04394;  // exp(-2.5 * 2.5 / 2)
    float a = max(exp(-0.5 * r * r) - E, 0.0) / (1.0 - E);
    // Additive blending multiplies by the alpha below (SRC_ALPHA, ONE): the colour is not premultiplied.
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/**
 * The room behind the dust: not black, a dusk with a little air in it, warm
 * where the lamp falls and gone to a deep slate everywhere else, with no edge
 * to it. The haze peaks near 20/255 under the lamp and the shade sits near
 * 10, so the mean stays dark and the mark always reads.
 */
const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAspect;
  uniform float uExposure;
  ${LAMP_GLSL}
  void main() {
    vec2 s = vec2(vUv.x * uAspect, vUv.y);
    float warm = lamp(s, uAspect);
    vec3 col = vec3(0.036, 0.038, 0.057);
    col += vec3(0.05, 0.04, 0.025) * warm * warm;
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`;
const SKY_VERT = /* glsl */ `
  attribute vec2 corner;
  varying vec2 vUv;
  void main() {
    vUv = corner;
    gl_Position = vec4(corner, 0.999, 1.0);
  }
`;

/** CSS cubic-bezier(x1, y1, x2, y2) as y of x, by bisection; the mark's entrance curve is (0.16, 1, 0.3, 1). */
const bezier = (x1: number, y1: number, x2: number, y2: number) => (x: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2;
    const u = 1 - t;
    const bx = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    if (bx < x) lo = t;
    else hi = t;
  }
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
};
const ENTRANCE = bezier(0.16, 1, 0.3, 1);
const ENTRANCE_S = 2.4;
const ENTRANCE_DELAY = 0.2;

export default function Lens({ still }: BackdropProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      let THREE: typeof T;
      try {
        THREE = await import("three");
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
      renderer.autoClear = false;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
      const pivot = new THREE.Vector3(0, 0, -FOCUS);

      // ── The dust: motes as frame fractions at a depth from arm's length to the far wall, even in
      // 1/z so the screen is as full of the far field as the near. 36,000 seeded on a desktop,
      // 11,000 on a phone; the lamp decides which of them show, about a third at a time. ──
      let w = window.innerWidth;
      let h = window.innerHeight;
      const count = phone ? 11000 : 36000;
      const seed = new Float32Array(count * 3);
      const rnd = new Float32Array(count * 4);
      let seedN = 11;
      const r = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < count; i++) {
        seed[i * 3] = (r() * 2 - 1) * MARGIN;
        seed[i * 3 + 1] = (r() * 2 - 1) * MARGIN;
        seed[i * 3 + 2] = -1 / (1 / Z_NEAR + r() * (1 / Z_FAR - 1 / Z_NEAR));
        rnd[i * 4] = r();
        rnd[i * 4 + 1] = r() * Math.PI * 2;
        rnd[i * 4 + 2] = (2 * Math.PI) / (6 + 10 * r());
        rnd[i * 4 + 3] = r();
      }
      const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
      const index = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.setAttribute("corner", new THREE.BufferAttribute(quad, 2));
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 3));
      geo.setAttribute("aRnd", new THREE.InstancedBufferAttribute(rnd, 4));
      geo.instanceCount = count;
      const uMark = new THREE.Vector2();
      const uViewport = new THREE.Vector2(w, h);
      const uDrift = new THREE.Vector2();
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: STILL_T },
          uAspect: { value: w / h },
          uViewport: { value: uViewport },
          uDpr: { value: renderer.getPixelRatio() },
          uFocus: { value: FOCUS },
          // f/1, but tiny: 24 px of sigma per unit of 1/z, so about one mote in seven is a
          // speck at any moment (the plane of focus is a fiftieth of the room deep: a mote is
          // sharp for a few seconds as the focus sweeps past it), a third are soft dots within
          // the cap, and the rest are at the cap, each fainter the further it is from the plane.
          // Nothing ever draws past six pixels (four and a half on a phone).
          uK: { value: 24 },
          uCap: { value: phone ? 4.5 : 6 },
          // The brightest motes in the plane would draw past white (the lens clips them at 0.82,
          // so the soft dust either side of the plane keeps up), the faintest at a quarter.
          uBright: { value: 1.4 },
          uExposure: { value: 1 },
          uDrift: { value: uDrift },
          uTopDim: { value: phone ? 0.25 : 0 },
          uMark: { value: uMark },
        },
      });
      const motes = new THREE.Mesh(geo, mat);
      motes.frustumCulled = false;
      scene.add(motes);

      // ── The room: a full-screen dusk behind everything. ──
      const skyGeo = new THREE.BufferGeometry();
      skyGeo.setIndex(new THREE.BufferAttribute(index, 1));
      skyGeo.setAttribute("corner", new THREE.BufferAttribute(quad, 2));
      skyGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, depthTest: false, uniforms: { uAspect: { value: w / h }, uExposure: { value: 1 } } });
      const sky = new THREE.Mesh(skyGeo, skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = -1;
      scene.add(sky);

      // ── The hand on the focus ring, the exposure, the current, the frames ──
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        uViewport.set(w, h);
        mat.uniforms.uAspect.value = w / h;
        skyMat.uniforms.uAspect.value = w / h;
        // The lockup's footprint, after its CSS (app.css ".door-mark .brand-lockup-mark": font-size
        // clamp(6rem, min(27vw, 34vh), 14rem) on an 11.9 px root; the lockup is about 2.06 em wide
        // and 1.25 em tall), with a little air; the shader's ellipse fades out over the next half.
        const em = Math.min(166.6, Math.max(71.4, Math.min(0.27 * w, 0.34 * h)));
        uMark.set((2.06 * em) / w + 0.02, (1.25 * em) / h + 0.03);
      };
      // The current is integrated, not multiplied out, so its rate and lean can change under it.
      const drift = (t: number, dt: number) => {
        const rate = driftRate(t) * dt;
        const lean = driftLean(t);
        uDrift.x += rate * Math.sin(lean);
        uDrift.y += rate * Math.cos(lean);
      };
      for (let t = 0; t < STILL_T; t += 0.05) drift(t, 0.05);
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const YAW = (1.2 * Math.PI) / 180;
      const PITCH = (0.8 * Math.PI) / 180;
      const place = (t: number, dt: number, entrance: number) => {
        // Eased with a one-and-a-half-second time constant, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 1.5);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const yaw = lx * YAW;
        const pitch = -ly * PITCH;
        camera.position.set(pivot.x + FOCUS * Math.sin(yaw) * Math.cos(pitch), pivot.y + FOCUS * Math.sin(pitch), pivot.z + FOCUS * Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(pivot);
        // The focus ring: two slow turns that never line up, so the plane of focus sweeps the room
        // from four and a half units to seven and a half and never repeats itself. The entrance
        // starts with the focus 1.4 units beyond rest (everything soft) and the exposure at 0.55,
        // and brings both to rest on the mark's own curve, so the lens finds its plane as the O
        // lands.
        const focus = FOCUS + 1.05 * Math.sin((2 * Math.PI * t) / 151) + 0.45 * Math.sin((2 * Math.PI * t) / 67 + 1.7);
        mat.uniforms.uFocus.value = focus + 1.4 * (1 - entrance);
        const exposure = (1 + 0.04 * Math.sin((2 * Math.PI * t) / 41)) * (0.55 + 0.45 * entrance);
        mat.uniforms.uExposure.value = exposure;
        skyMat.uniforms.uExposure.value = exposure;
        mat.uniforms.uTime.value = t;
        renderer.clear();
        renderer.render(scene, camera);
      };
      size();
      if (still) {
        place(STILL_T, 1, 1);
        const onResize = () => {
          size();
          place(STILL_T, 1, 1);
        };
        window.addEventListener("resize", onResize);
        cleanup = () => {
          window.removeEventListener("resize", onResize);
          geo.dispose();
          mat.dispose();
          skyGeo.dispose();
          skyMat.dispose();
          renderer.dispose();
        };
        return;
      }
      // The entrance waits for the door to be ready (the mark's typeface; landing.tsx puts
      // "door-ready" on the .door), and runs at once where there is no door, as in the gallery.
      const door = canvas.closest(".door");
      let readyAt = -1;
      let raf = 0;
      const t0 = performance.now();
      let last = t0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const t = STILL_T + (now - t0) / 1000;
        if (readyAt < 0 && (!door || door.classList.contains("door-ready"))) readyAt = now;
        const entrance = readyAt < 0 ? 0 : ENTRANCE(((now - readyAt) / 1000 - ENTRANCE_DELAY) / ENTRANCE_S);
        drift(t, dt);
        place(t, dt, entrance);
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
        if (!document.hidden) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
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
        geo.dispose();
        mat.dispose();
        skyGeo.dispose();
        skyMat.dispose();
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
