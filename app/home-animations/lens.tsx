import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The lens: a still room full of dust too fine to see, watched through a
 * lens wide open at f/1. Forty-eight thousand motes hang in the dark from arm's
 * length to the far wall, drifting on one slow current; a couple of hundred
 * of them are glints, flecks that catch the light. The lens is focused a few
 * feet in, and someone is racking the focus by hand, slowly, so the one thin
 * plane that is ever sharp drifts back and forth through the cloud: a mote
 * resolves into a pin-sharp speck for a few seconds and then blooms back
 * into a soft circle. Out of focus, a point becomes a disc that keeps its
 * light (so it dims with the square of its width), with the faint bright
 * rim of a fast lens, a cat's-eye squash toward the corners of the frame, and
 * a hair of warm fringe in front of focus and cool behind it. So the dust
 * is only ever seen near the plane of focus, a slice of sharp specks that
 * sweeps the room, and the glints are seen everywhere: sharp points in the
 * plane, wide quiet circles far from it. The light has a direction: a dusk
 * wash, warm from the upper left, cooling into the lower right. Everything
 * is slow: the current moves a mote a fifth of a percent of the frame a
 * second, the exposure breathes once every forty seconds, the camera leans
 * a degree toward the pointer. One instanced draw of quads (a point sprite
 * has a size limit on some phones; a quad has none), everything analytic in
 * the vertex shader. Reduced motion draws one frame at t = 29 s.
 */

/** The focal plane at rest, and the frame there: 5.1 units tall at z = -6 → half-angle tan 0.425. */
const FOCUS = 6;
const TAN_HALF = 2.55 / FOCUS;
const FOV = (2 * Math.atan(TAN_HALF) * 180) / Math.PI;
/** The seed box: frame fractions (with a margin for the lean and the flow) and depth. */
const MARGIN = 1.14;
const Z_NEAR = 2.6;
const Z_FAR = 13;
const STILL_T = 29;

/** The light. The far field is silver, the near field champagne, a glint is a little more gold. */
const SILVER = [0.78, 0.82, 0.9];
const IVORY = [0.957, 0.929, 0.878];
const CHAMPAGNE = [0.93, 0.86, 0.72];
const GOLD = [0.9, 0.78, 0.55];

/**
 * The current: three sinusoids per axis, each a plane wave in the seed
 * position (wavelengths 1.9 to 4.6 units) that turns in time (periods 47 to
 * 131 s). [direction, wavelength, period, amplitude, phase] per term.
 */
const FLOW: [number, number, number, number, number, number, number][] = [
  // x
  [0.71, 0.71, 0.0, 3.2, 97, 0.06, 1.3],
  [-0.3, 0.95, 0.0, 2.0, 59, 0.025, 4.0],
  [0.26, 0.53, 0.81, 4.6, 131, 0.07, 2.2],
  // y
  [0.95, 0.31, 0.0, 3.8, 113, 0.06, 0.7],
  [-0.6, 0.2, 0.77, 1.9, 47, 0.02, 5.1],
  [0.37, -0.93, 0.0, 2.8, 73, 0.04, 3.4],
  // z
  [0.5, 0.86, 0.0, 4.4, 101, 0.05, 0.2],
  [-0.85, 0.3, 0.43, 2.4, 67, 0.03, 2.9],
  [0.2, 0.6, -0.77, 1.9, 53, 0.02, 1.9],
];
const flowTerm = ([dx, dy, dz, lambda, period, amp, phase]: (typeof FLOW)[number]) => {
  const k = (2 * Math.PI) / lambda;
  const f = (n: number) => n.toFixed(4);
  return `${f(amp)} * sin(dot(q, vec3(${f(dx * k)}, ${f(dy * k)}, ${f(dz * k)})) + t * ${f((2 * Math.PI) / period)} + ${f(phase)})`;
};
const FLOW_GLSL = `vec3 flow(vec3 q, float t) {
  return vec3(
    ${flowTerm(FLOW[0])} + ${flowTerm(FLOW[1])} + ${flowTerm(FLOW[2])},
    ${flowTerm(FLOW[3])} + ${flowTerm(FLOW[4])} + ${flowTerm(FLOW[5])},
    ${flowTerm(FLOW[6])} + ${flowTerm(FLOW[7])} + ${flowTerm(FLOW[8])});
}`;

const VERT = /* glsl */ `
  attribute vec2 corner;   // the quad: -1..1
  attribute vec4 aSeed;    // sx, sy (frame fractions), z0, kind (0 dust, 1 glint)
  attribute vec4 aRnd;     // size and light variance, twinkle phase, twinkle rate, tint
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uViewport;  // CSS px
  uniform float uFocus;    // the plane of focus, units from the eye
  uniform float uK;        // bokeh: CSS px per unit of |1/z - 1/zf|
  uniform float uCap;      // the widest disc, CSS px
  uniform float uDust;     // a dust mote's light, in focus
  uniform float uGlint;    // a glint's
  uniform float uExposure;
  uniform float uRise;     // the current, up, units a second
  uniform float uSide;     // and to the right
  uniform vec4 uMark;      // the lockup's footprint in NDC: inside |x| < .x, |y| < .z; clear beyond .y, .w
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSize;     // the disc, CSS px
  varying vec2 vCat;       // the cat's-eye: the second aperture's offset, in disc radii
  varying float vSide;     // -1 in front of focus, +1 behind
  varying vec2 vUv;
  const float TAN_HALF = ${TAN_HALF.toFixed(5)};
  const float MARGIN = ${MARGIN.toFixed(2)};
  const vec3 SILVER = vec3(${SILVER.join(", ")});
  const vec3 IVORY = vec3(${IVORY.join(", ")});
  const vec3 CHAMPAGNE = vec3(${CHAMPAGNE.join(", ")});
  const vec3 GOLD = vec3(${GOLD.join(", ")});
  ${FLOW_GLSL}
  void main() {
    vUv = corner;
    float glint = aSeed.w;
    // Seeded as frame fractions at a depth, so every screen is full; the current carries each mote
    // up and a little to the right, wrapping at the margin, and the flow turns it.
    float z0 = aSeed.z;
    float hh = TAN_HALF * -z0;
    vec3 q0 = vec3(aSeed.x * hh * uAspect, aSeed.y * hh, z0);
    // The current is one speed for the whole room (units a second), so the near field crosses the
    // frame faster than the far wall: the parallax that makes it a room.
    float sy = mod(aSeed.y + MARGIN + uRise * uTime / hh, 2.0 * MARGIN) - MARGIN;
    float sx = mod(aSeed.x + MARGIN + uSide * uTime / (hh * uAspect), 2.0 * MARGIN) - MARGIN;
    vec3 p = vec3(sx * hh * uAspect, sy * hh, z0) + flow(q0, uTime);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 ndc = clip.xy / clip.w;
    float zc = -mv.z;
    // The lens: a point off the plane of focus spreads into a disc, uK px per unit of 1/z,
    // added in quadrature to its own width, so a speck in the plane is a speck.
    float c = abs(1.0 / zc - 1.0 / uFocus) * uK;
    float base = mix(1.3, 1.9, aRnd.x) * (1.0 + 0.4 * glint);
    float size = min(sqrt(base * base + c * c), uCap);
    float ratio = size / base;
    // A point keeps its light however wide the lens spreads it, so a disc's surface dims with its
    // area: a dust mote is a speck in the plane of focus, a small soft dot just off it, and gone a
    // few pixels wide, which leaves the air black; a glint, far brighter, is still a faint wide
    // circle at its widest. The motes are not all alike: most are faint and a few are bright, as
    // stars are. A speck past white is clipped by the lens, more gently as the disc widens, so
    // nothing ever draws as a hard blob.
    float spread = mix(0.12, 1.0, pow(aRnd.x, 2.4));
    float energy = mix(uDust * spread, uGlint * mix(0.6, 1.4, aRnd.x), glint);
    float cap = mix(0.92, 0.36, smoothstep(2.5, 9.0, size));
    float lit = min(energy / (ratio * ratio), cap);
    // Dusk light: warm and full from the upper left, half as much in the lower right.
    float wash = mix(0.3, 1.0, smoothstep(-1.5, 1.2, -ndc.x * 0.6 + ndc.y * 0.8 + 0.15));
    // Scintillation: a mote in the plane of focus wavers a little in the air, a glint more.
    float tw = 0.5 + 0.5 * sin(uTime * aRnd.z + aRnd.y);
    float twinkle = mix(1.0 - 0.12 * (1.0 + glint), 1.0, tw);
    // A wide disc crossing the mark dims to a third, so the letters always read; a speck is left alone.
    float overMark = (1.0 - smoothstep(uMark.x, uMark.y, abs(ndc.x))) * (1.0 - smoothstep(uMark.z, uMark.w, abs(ndc.y)));
    float wide = smoothstep(3.0, 10.0, size);
    float alpha = lit * wash * twinkle * uExposure * (1.0 - 0.5 * overMark * wide);
    bool off = abs(ndc.x) > 1.0 + size / uViewport.x * 2.0 || abs(ndc.y) > 1.0 + size / uViewport.y * 2.0;
    if (alpha < 0.004 || off) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // The near field is champagne, the far field silver; a glint a little gold; each mote its own shade.
    float depth = smoothstep(2.5, 12.0, zc);
    vec3 col = mix(CHAMPAGNE, SILVER, depth);
    col = mix(col, GOLD, 0.5 * glint);
    col = mix(col, IVORY, 0.35 * aRnd.w);
    vColor = col;
    vAlpha = alpha;
    vSize = size;
    vSide = sign(zc - uFocus);
    // Mechanical vignetting: toward the corners, the barrel cuts the aperture, and a disc becomes a
    // cat's eye pointing at the centre of the frame (the second circle sits off along the radius).
    vec2 radial = ndc * vec2(uAspect, 1.0);
    float edge = smoothstep(0.7, 1.5, length(radial));
    vCat = normalize(radial + vec2(1e-5, 0.0)) * (0.5 * edge) * smoothstep(4.0, 9.0, size);
    // The quad holds the disc with a pixel of air for the soft edge.
    float reach = size * 0.5 + 1.0;
    vec2 px = corner * reach * 2.0 / uViewport;
    gl_Position = vec4(ndc + px, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSize;
  varying vec2 vCat;
  varying float vSide;
  varying vec2 vUv;
  void main() {
    // The disc fills the quad to a radius just inside it; its edge is a pixel and a half soft.
    float R = vSize * 0.5 / (vSize * 0.5 + 1.0);
    float e = clamp(1.5 / (vSize * 0.5 + 1.0), 0.04, 0.6);
    float r = length(vUv);
    float disc = 1.0 - smoothstep(R - e, R + e, r);
    // The cat's eye: the disc is what two circles share.
    float r2 = length(vUv - vCat);
    disc *= 1.0 - smoothstep(R - e, R + e, r2);
    // A fast lens draws a bright rim and a slightly hollow centre on a wide disc; a speck is flat.
    float wide = smoothstep(6.0, 18.0, vSize);
    float ring = smoothstep(0.6, 0.94, r / R);
    float shade = 1.0 + 0.32 * wide * ring;
    // Longitudinal colour: a hair of warmth on the rim in front of focus, cool behind it.
    vec3 fringe = vSide < 0.0 ? vec3(1.07, 0.98, 0.95) : vec3(0.94, 1.0, 1.07);
    vec3 col = mix(vColor, vColor * fringe, 0.4 * wide * ring);
    // Additive blending multiplies by the alpha below (SRC_ALPHA, ONE): the colour is not premultiplied.
    gl_FragColor = vec4(col, disc * shade * vAlpha);
  }
`;

/** The room behind the dust: not black, a dusk, faintly warm where the light comes from and faintly blue where it has gone. */
const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAspect;
  uniform float uExposure;
  void main() {
    vec2 p = vec2(vUv.x * uAspect, vUv.y);
    float warm = 1.0 - smoothstep(0.0, 2.3, length(p - vec2(-1.1 * uAspect, 1.05)));
    float cool = 1.0 - smoothstep(0.0, 2.1, length(p - vec2(0.9 * uAspect, -1.1)));
    vec3 col = vec3(0.02, 0.0235, 0.043);
    col += vec3(0.075, 0.056, 0.04) * warm * warm;
    col += vec3(0.012, 0.022, 0.05) * cool * cool;
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

      // ── The dust: motes as frame fractions at a depth from arm's length to the far wall, so every
      // screen is full at every depth; one in three hundred a glint. 48,000 and 140 on a desktop;
      // 14,000 and 50 on a phone. ──
      let w = window.innerWidth;
      let h = window.innerHeight;
      const dust = phone ? 14000 : 48000;
      const glints = phone ? 50 : 140;
      const count = dust + glints;
      const seed = new Float32Array(count * 4);
      const rnd = new Float32Array(count * 4);
      let seedN = 11;
      const r = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      const aspect0 = w / h;
      for (let i = 0; i < count; i++) {
        const glint = i >= dust;
        let sx = 0;
        let sy = 0;
        let z = 0;
        do {
          sx = (r() * 2 - 1) * MARGIN;
          sy = (r() * 2 - 1) * MARGIN;
          // Depth even in 1/z, so the screen is as full of the far field as the near.
          const inv = 1 / Z_NEAR + r() * (1 / Z_FAR - 1 / Z_NEAR);
          z = -1 / inv;
          // No glint near the lens is seeded over the centre: no wide bright disc ever sits on the mark.
        } while (glint && z > -5 && (sx * aspect0) ** 2 + sy ** 2 < 0.2);
        seed[i * 4] = sx;
        seed[i * 4 + 1] = sy;
        seed[i * 4 + 2] = z;
        seed[i * 4 + 3] = glint ? 1 : 0;
        rnd[i * 4] = r();
        rnd[i * 4 + 1] = r() * Math.PI * 2;
        rnd[i * 4 + 2] = (2 * Math.PI) / (5 + 9 * r());
        rnd[i * 4 + 3] = r();
      }
      const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
      const index = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.setAttribute("corner", new THREE.BufferAttribute(quad, 2));
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
      geo.setAttribute("aRnd", new THREE.InstancedBufferAttribute(rnd, 4));
      geo.instanceCount = count;
      const uMark = new THREE.Vector4();
      const uViewport = new THREE.Vector2(w, h);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: STILL_T },
          uAspect: { value: aspect0 },
          uViewport: { value: uViewport },
          uFocus: { value: FOCUS },
          // f/1: 420 px per unit of 1/z, so a glint at arm's length (z 2.6) is a 90 px circle (capped
          // at 56, 40 on a phone), one on the far wall 42 px, and the plane of focus is a hundredth
          // of the room deep: a mote is sharp for a few seconds as the focus sweeps past it.
          uK: { value: 420 },
          uCap: { value: phone ? 40 : 56 },
          // The brightest dust mote in the plane draws at 0.9 of white, the faintest at a tenth, and
          // any of them is gone four pixels wide; a glint is ten times brighter, clipped as a speck
          // and a faint circle at its widest.
          uDust: { value: 0.9 },
          uGlint: { value: 9 },
          uExposure: { value: 1 },
          // The current: a fifth of a percent of the frame's height a second in the plane of focus
          // (the frame is 5.1 units tall there), and a third of that to the right.
          uRise: { value: 0.002 * 5.1 },
          uSide: { value: 0.0007 * 5.1 },
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
      const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, depthTest: false, uniforms: { uAspect: { value: aspect0 }, uExposure: { value: 1 } } });
      const sky = new THREE.Mesh(skyGeo, skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = -1;
      scene.add(sky);

      // ── The hand on the focus ring, the exposure, the frames ──
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
        // and 1.25 em tall), with a little air, and a soft edge over the next few percent.
        const em = Math.min(166.6, Math.max(71.4, Math.min(0.27 * w, 0.34 * h)));
        const mx = (2.06 * em) / w;
        const my = (1.25 * em) / h;
        uMark.set(mx + 0.02, mx + 0.1, my + 0.03, my + 0.12);
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const YAW = (1.2 * Math.PI) / 180;
      const PITCH = (0.8 * Math.PI) / 180;
      const place = (t: number, dt: number) => {
        // Eased with a one-and-a-half-second time constant, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 1.5);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const yaw = lx * YAW;
        const pitch = -ly * PITCH;
        camera.position.set(pivot.x + FOCUS * Math.sin(yaw) * Math.cos(pitch), pivot.y + FOCUS * Math.sin(pitch), pivot.z + FOCUS * Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(pivot);
        // The focus ring: two slow turns that never line up, so the plane of focus sweeps the room
        // from four and a half units to seven and a half and never repeats itself.
        mat.uniforms.uFocus.value = FOCUS + 1.05 * Math.sin((2 * Math.PI * t) / 131) + 0.45 * Math.sin((2 * Math.PI * t) / 59 + 1.7);
        const exposure = 1 + 0.04 * Math.sin((2 * Math.PI * t) / 41);
        mat.uniforms.uExposure.value = exposure;
        skyMat.uniforms.uExposure.value = exposure;
        mat.uniforms.uTime.value = t;
        renderer.clear();
        renderer.render(scene, camera);
      };
      size();
      if (still) {
        place(STILL_T, 1);
        const onResize = () => {
          size();
          place(STILL_T, 1);
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
      let raf = 0;
      const t0 = performance.now();
      let last = t0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        place(STILL_T + (now - t0) / 1000, dt);
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
