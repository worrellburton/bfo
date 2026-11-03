import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The sunbeam: one shaft of four-o'clock sun crosses a dark room, and all
 * you ever see is the dust it touches. Nothing is drawn but the motes: a
 * slab of light runs from the top-left of the frame to the bottom-centre,
 * Gaussian across, cut into three panes by two mullion shadows, dim beside
 * the mark and brightest in the lower third. Twenty thousand motes, few
 * enough that each one resolves: most seeded in the shaft itself (the dust
 * you can see is the dust in the light), the rest in the dark room. Each
 * rises in the warm air and wanders on one shared, frozen flow field, so
 * neighbours move together; nine in ten are specks that shine steadily, one
 * in ten is a flake that turns and catches the sun for a second or two every
 * ten seconds or so, never dimmer than a speck. The light is gold, champagne
 * at the core, ivory only in a flake's glint. A lens: the axis lies nearly
 * in the focal plane, so the whole shaft is resolvable motes, the pool at
 * the bottom sharpest. Everything is analytic in one vertex shader, one
 * draw call. The camera leans a degree toward the pointer. Reduced motion
 * draws one frame at t = 37 s.
 */

const IVORY = [0.957, 0.929, 0.878];
const CHAMPAGNE = [0.914, 0.843, 0.659];
const GOLD = [0.847, 0.71, 0.416];
const DEEP_GOLD = [0.655, 0.486, 0.196];

/** The focal plane and the frame there: 5.1 units tall at z = -6 → half-angle tan 0.425. */
const FOCUS = 6;
const TAN_HALF = 2.55 / FOCUS;
const FOV = (2 * Math.atan(TAN_HALF) * 180) / Math.PI;
/** The seed box: frame fractions (with a margin for the lean and the flow) and depth. */
const MARGIN = 1.15;
const Z_NEAR = 2;
const Z_FAR = 12;
const STILL_T = 37;

/**
 * The frozen-flow field: three sinusoids per axis, each a plane wave in the
 * seed position (wavelengths 1.5 to 4 units) that turns in time (periods 23
 * to 61 s). [direction, wavelength, period, amplitude, phase] per term.
 */
const FLOW: [number, number, number, number, number, number, number][] = [
  // x
  [0.71, 0.71, 0.0, 2.6, 41, 0.16, 1.3],
  [-0.3, 0.95, 0.0, 1.7, 23, 0.09, 4.0],
  [0.26, 0.53, 0.81, 3.8, 61, 0.2, 2.2],
  // y
  [0.95, 0.31, 0.0, 3.2, 53, 0.18, 0.7],
  [-0.6, 0.2, 0.77, 1.5, 29, 0.08, 5.1],
  [0.37, -0.93, 0.0, 2.3, 37, 0.12, 3.4],
  // z
  [0.5, 0.86, 0.0, 4.0, 47, 0.15, 0.2],
  [-0.85, 0.3, 0.43, 2.0, 31, 0.1, 2.9],
  [0.2, 0.6, -0.77, 1.5, 26, 0.08, 1.9],
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
  attribute vec4 aPos;  // beam dust: along (of the length), across, through (sigmas), 1; room dust: sx, sy (frame fractions), z0, 0
  attribute vec3 aRnd;  // seed, flash phase, flash rate
  uniform float uTime;
  uniform float uAspect;
  uniform float uPixel;
  uniform float uBeam;     // beam intensity, breathing
  uniform float uLen;      // the beam's length across the frame
  uniform float uK;        // bokeh: px per unit of |1/z - 1/zf|
  uniform float uCap;      // largest disc, CSS px
  uniform float uRiseIn;   // units per second, in the beam
  uniform float uRiseOut;  // and in the dark
  uniform float uRiseAxis; // the beam's dust, up the shaft
  uniform float uEnergy;   // a mote's in-focus brightness at full sun
  uniform float uPeak;     // the brightest any mote may draw
  uniform vec3 uB0;        // a point on the beam's axis
  uniform vec3 uBhat;      // the axis, unit, pointing down the beam
  uniform vec3 uU;         // across the beam, unit, in the screen plane
  uniform vec3 uV;         // through the beam, unit, in depth
  uniform vec2 uSigma;     // Gaussian widths across and through
  uniform vec4 uGaps;      // the two mullion shadows: centres, half width, penumbra
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRim;
  const float TAN_HALF = ${TAN_HALF.toFixed(5)};
  const float FOCUS = ${FOCUS.toFixed(1)};
  const float MARGIN = ${MARGIN.toFixed(2)};
  const vec3 IVORY = vec3(${IVORY.join(", ")});
  const vec3 CHAMPAGNE = vec3(${CHAMPAGNE.join(", ")});
  const vec3 GOLD = vec3(${GOLD.join(", ")});
  const vec3 DEEP_GOLD = vec3(${DEEP_GOLD.join(", ")});
  ${FLOW_GLSL}
  float beamWeight(vec3 p, out float lat) {
    vec3 r = p - uB0;
    lat = dot(r, uU);
    float ln = lat / uSigma.x;
    float dn = dot(r, uV) / uSigma.y;
    return exp(-0.5 * (ln * ln + dn * dn));
  }
  void main() {
    vec3 q0;
    vec3 p;
    if (aPos.w > 0.5) {
      // Dust of the beam: seeded along the shaft, and across and through it as Gaussians (in
      // sigmas). The warm air rises up the shaft, wrapping along it, and the flow turns the dust
      // in and out of the light, so the shaft never drains and never flattens.
      float s0 = aPos.x * uLen;
      float lat0 = aPos.y * uSigma.x;
      float dep0 = aPos.z * uSigma.y;
      q0 = uB0 + s0 * uBhat + lat0 * uU + dep0 * uV;
      vec3 D = flow(q0, uTime);
      float sl = 0.65 * uLen;
      float s = mod(s0 - uRiseAxis * uTime + dot(D, uBhat) + sl, 2.0 * sl) - sl;
      float lat = lat0 + dot(D, uU);
      float dep = dep0 + dot(D, uV);
      p = uB0 + s * uBhat + lat * uU + dep * uV;
    } else {
      // Dust of the room: seeded as frame fractions at a depth, so every screen is full.
      float z0 = aPos.z;
      float hh = TAN_HALF * -z0;
      q0 = vec3(aPos.x * hh * uAspect, aPos.y * hh, z0);
      float lat0;
      float w0 = beamWeight(q0, lat0);
      float rate = mix(uRiseOut, uRiseIn, smoothstep(0.0, 0.6, w0)) / hh;
      float sy = mod(aPos.y + MARGIN + rate * uTime, 2.0 * MARGIN) - MARGIN;
      p = vec3(q0.x, sy * hh, z0) + flow(q0, uTime);
    }
    // How much sun reaches this point: the Gaussian slab, minus the mullions.
    float lat;
    float w = beamWeight(p, lat);
    float g1 = 1.0 - smoothstep(uGaps.z, uGaps.z + uGaps.w, abs(lat - uGaps.x));
    float g2 = 1.0 - smoothstep(uGaps.z, uGaps.z + uGaps.w, abs(lat - uGaps.y));
    float pane = (1.0 - 0.9 * g1) * (1.0 - 0.9 * g2);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    float ndcY = clip.y / clip.w;
    // Three tenths of the light beside and above the mark (a mote draws at most 0.3 × uPeak
    // there, so even two that coincide stay under a quarter of white), full in the lower fifth:
    // the one pool of light. Half the motes go dark as they rise out of the pool (a 25 s fade at
    // the rise's pace): the dust is thickest near the floor, the far end of the shaft (denser on
    // screen) never out-reads the pool, and coincidences beside the mark are rarer still.
    float lower = 1.0 - smoothstep(-0.56, -0.36, ndcY);
    float gain = (0.3 + 0.7 * lower) * (1.0 - (1.0 - lower) * step(fract(aRnd.y * 3.0), 0.5));
    // Nine in ten motes are specks that shine steadily; one in ten is a flake that turns in the
    // air and catches the sun for a second or two each cycle, over a second to rise, and never
    // dims below a speck.
    float f = 0.5 + 0.5 * sin(uTime * aRnd.z + aRnd.y);
    f *= f; f *= f; f *= f; f *= f;
    float flaky = smoothstep(0.88, 0.92, aRnd.x);
    float flash = mix(0.5, 0.5 + 0.5 * f, flaky);
    float sun = w * pane * uBeam * flash;
    // The body of the light is gold, champagne at the core, deep gold in the fringe; ivory only
    // where a flake glints (ivory at a small alpha over ink reads grey; gold stays gold).
    vec3 col = mix(DEEP_GOLD, GOLD, smoothstep(0.0, 0.3, w));
    col = mix(col, CHAMPAGNE, smoothstep(0.5, 1.0, w));
    col = mix(col, IVORY, flaky * smoothstep(0.7, 1.0, f));
    // The lens: a mote off the focal plane spreads into a disc and keeps its energy; a mote is
    // below the lens's resolution, so its sharp image is the same 2 to 3.6 px at any depth,
    // and the light it sends back falls off gently with its distance.
    float zc = -mv.z;
    float c = abs(1.0 / zc - 1.0 / FOCUS);
    float base = 2.0 + 1.6 * aRnd.x;
    float size = min(base + c * uK, uCap);
    float ratio = size / base;
    float r2 = ratio * ratio;
    float reach = clamp(FOCUS / zc, 0.5, 1.3);
    // A speck in direct sun is far brighter than white in focus; the lens clips it at the peak,
    // and the room's gain (dim beside the mark) comes after the clip. Unlit dust keeps 4%.
    float lit = min((sun * uEnergy * reach) / r2, uPeak) * gain;
    float alpha = max(lit, 0.04 / r2);
    if (alpha < 0.003) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vColor = col;
    vAlpha = alpha;
    // A speck is soft to its centre; a lens disc is flat with a soft rim.
    vRim = mix(0.35, 0.65, smoothstep(4.0, 18.0, size));
    gl_PointSize = max(size * uPixel, 1.0);
    gl_Position = clip;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRim;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(vRim, 1.0, d);
    // Additive blending multiplies by the alpha below (SRC_ALPHA, ONE): the colour is not premultiplied.
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

export default function Sunbeam({ still }: BackdropProps) {
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
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
      const pivot = new THREE.Vector3(0, 0, -FOCUS);

      // ── The dust: 14,000 motes seeded in the shaft (along, across and through it, in sigmas),
      // five pixels apart on the axis in the pool so each resolves, half that above it; 6,000 in
      // the room as frame fractions at a depth, so every screen is full. 4,200 and 1,800 on
      // phones. ──
      let w = window.innerWidth;
      let h = window.innerHeight;
      const inBeam = phone ? 4200 : 14000;
      const count = inBeam + (phone ? 1800 : 6000);
      const pos = new Float32Array(count * 4);
      const rnd = new Float32Array(count * 3);
      let seedN = 7;
      const r = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      const aspect0 = w / h;
      // A normal deviate (Box-Muller): the dust you can see sits where the light is.
      const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
      for (let i = 0; i < count; i++) {
        if (i < inBeam) {
          pos[i * 4] = (r() * 2 - 1) * 0.65;
          pos[i * 4 + 1] = gauss() * 1.15;
          pos[i * 4 + 2] = gauss();
          pos[i * 4 + 3] = 1;
        } else {
          let sx = 0;
          let sy = 0;
          let z = 0;
          do {
            sx = (r() * 2 - 1) * MARGIN;
            sy = (r() * 2 - 1) * MARGIN;
            z = -(Z_NEAR + r() * (Z_FAR - Z_NEAR));
            // Nothing near the lens is seeded over the centre: no big soft disc ever crosses the mark.
          } while (z > -4 && (sx * aspect0) ** 2 + sy ** 2 < 0.25);
          pos[i * 4] = sx;
          pos[i * 4 + 1] = sy;
          pos[i * 4 + 2] = z;
          pos[i * 4 + 3] = 0;
        }
        rnd[i * 3] = r();
        rnd[i * 3 + 1] = r() * Math.PI * 2;
        rnd[i * 3 + 2] = (2 * Math.PI) / (9 + 7 * r());
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute("aPos", new THREE.BufferAttribute(pos, 4));
      geo.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 3));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -7), 20);
      const uB0 = new THREE.Vector3();
      const uBhat = new THREE.Vector3();
      const uU = new THREE.Vector3();
      const uV = new THREE.Vector3();
      const uSigma = new THREE.Vector2();
      const uGaps = new THREE.Vector4();
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
          uPixel: { value: renderer.getPixelRatio() },
          uBeam: { value: 1 },
          uLen: { value: 7.5 },
          uK: { value: 30 },
          uCap: { value: phone ? 36 : 60 },
          // Rise: 0.004 frame heights a second in the sun, 0.0015 in the dark (the frame is 5.1 units tall at focus).
          uRiseIn: { value: 0.004 * 2 * 2.55 },
          uRiseOut: { value: 0.0015 * 2 * 2.55 },
          uRiseAxis: { value: 0.004 * 2 * 2.55 },
          // A speck in the pool reaches the peak over most of the lit width; a flake's glint clips there too.
          uEnergy: { value: 1.4 },
          uPeak: { value: 0.3 },
          uB0: { value: uB0 },
          uBhat: { value: uBhat },
          uU: { value: uU },
          uV: { value: uV },
          uSigma: { value: uSigma },
          uGaps: { value: uGaps },
        },
      });
      scene.add(new THREE.Points(geo, mat));

      // ── The beam: where it crosses the frame, as fractions of the width, at its own depth. The
      // axis lies nearly in the focal plane (z -7.4 at the top to -5.8 at the pool), so the far
      // end is resolvable motes a pixel softer than the pool, not a haze. ──
      const top = new THREE.Vector3();
      const bottom = new THREE.Vector3();
      const Z_TOP = 7.4;
      const Z_BOTTOM = 5.8;
      const beam = (t: number) => {
        const aspect = w / h;
        // Landscape enters at 0.22 W and leaves at 0.52 W; portrait 0.12 W to 0.55 W.
        const k = smooth((aspect - 0.75) / 0.5);
        const fxTop = 0.12 + 0.1 * k;
        // The sun moves: the shaft swings a couple of degrees about the window over eleven minutes.
        const fxBottom = 0.55 - 0.03 * k + 0.027 * Math.sin((2 * Math.PI * t) / 660);
        const hhTop = TAN_HALF * Z_TOP;
        const hhBottom = TAN_HALF * Z_BOTTOM;
        top.set((2 * fxTop - 1) * hhTop * aspect, hhTop, -Z_TOP);
        bottom.set((2 * fxBottom - 1) * hhBottom * aspect, -hhBottom, -Z_BOTTOM);
        uBhat.subVectors(bottom, top);
        mat.uniforms.uLen.value = uBhat.length();
        uBhat.normalize();
        uU.set(uBhat.y, -uBhat.x, 0).normalize();
        uV.crossVectors(uBhat, uU);
        uB0.addVectors(top, bottom).multiplyScalar(0.5);
        // About a fifth of the frame wide at mid-height on any screen (the seeds' Gaussian narrows
        // the lit band to about 1.2 sigma each side); 0.45 through, so the slab is 1.2 units deep.
        const wu = 2 * TAN_HALF * ((Z_TOP + Z_BOTTOM) / 2) * aspect;
        const across = Math.min(0.9, Math.max(0.2, 0.075 * wu));
        uSigma.set(across, 0.45);
        // The dust of the beam rises up the shaft at the spec's vertical rate.
        mat.uniforms.uRiseAxis.value = mat.uniforms.uRiseIn.value / Math.max(0.5, -uBhat.y);
        // Two mullion shadows, 2.5% of the width each, cut the lit width (1.4 sigma each side, so
        // all three panes sit in the light) into panes of 3 : 5 : 4.
        const gap = 0.025 * wu;
        const half = 1.4 * across;
        const part = (2 * half - 2 * gap) / 12;
        const c1 = half - 3 * part - gap / 2;
        uGaps.set(c1, c1 - gap - 5 * part, gap / 2, gap * 0.25);
        mat.uniforms.uBeam.value = 0.96 + 0.04 * Math.sin((2 * Math.PI * t) / 40);
        mat.uniforms.uTime.value = t;
        mat.uniforms.uAspect.value = aspect;
      };

      // ── The camera, the pointer, the frames ──
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const YAW = (1.5 * Math.PI) / 180;
      const PITCH = (1.0 * Math.PI) / 180;
      const place = (t: number, dt: number) => {
        // Eased over about two seconds, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 0.7);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const yaw = lx * YAW;
        const pitch = -ly * PITCH;
        camera.position.set(pivot.x + FOCUS * Math.sin(yaw) * Math.cos(pitch), pivot.y + FOCUS * Math.sin(pitch), pivot.z + FOCUS * Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(pivot);
        beam(t);
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
