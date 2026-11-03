import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * Champagne silk: a single length of silk hangs behind the mark, and you only
 * see it where the light catches a fold. The sheet is a hundred and thirty
 * thousand motes, close enough to fuse into a surface, each lit as if it sat
 * on one: a height field of folds, tight at the top where the cloth is held
 * and wide and soft at the hem, calmer in the centre third so the silk frames
 * the mark instead of crossing it. One lamp, to the right and a little above,
 * close in front of the cloth, skims the folds: deep gold in the half-light,
 * gold on the lit flanks, champagne where the sheen peaks, and a hairline of
 * near-ivory along the sharpest crests, dying to ink in the troughs. Its
 * whole motion is a breath: every half minute a bulge of air leaves the hem
 * and climbs the cloth, bending the sheen as it passes each fold; the hem
 * sways a little over 45 s and the folds drift over two minutes. Everything
 * is one draw call: the vertex shader evaluates the cloth at each mote and at
 * four neighbours for a finite-difference normal, then lights it. The pointer
 * leans the lamp by six degrees and the camera by one, so the sheen slides.
 * Phones get fewer motes and four folds. Reduced motion draws one frame,
 * mid-breath. Without WebGL (or if three.js fails to load) the canvas stays a
 * deep blue and the page still reads.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** The camera's distance from the sheet. The world unit is the frame height there: the frame is one unit tall and `aspect` wide. */
const DIST = 2.5;
const FOV = (2 * Math.atan(0.5 / DIST)) / DEG;
/** The sheet: 1.3 frame widths wide and 1.25 frame heights tall, so no edge is ever in the frame, however the camera leans. */
const SHEET_W = 1.3;
const SHEET_H = 1.25;
/** The folds' depth at the hem, in frame heights: with six folds across the frame, a slope near 1 where the sheen sits. */
const DEPTH = 0.045;
/**
 * The folds, summed: how many per frame width, how deep at the top and at the hem (fractions of DEPTH), a phase, and the
 * period of its drift. The first two are the body of the cloth, close in depth so neither rules: each has its spacing
 * slowly modulated across the sheet (`fm` radians at `fmc` cycles per frame width, from phase `fmp`), so no two folds are
 * the same width and nothing beats to a flat patch, and a touch of second harmonic (`h2`) so a fold's two flanks differ:
 * a gentle lit side, a steeper shaded one. The third is the tight gathering at the top, gone by the hem; the fourth the
 * broad swell of the hem. The phases are chosen so the deepest lit flank hangs a little inside the right edge.
 */
const FOLDS = [
  { n: 6, top: 0.45, hem: 0.9, phase: 2.356, drift: 120, fm: 1.0, fmc: 1.3, fmp: 0.4, h2: 0.18 },
  { n: 4.3, top: 0.3, hem: 0.75, phase: 4.712, drift: 137, fm: 0.8, fmc: 0.9, fmp: 2.2, h2: 0.18 },
  { n: 11.5, top: 0.55, hem: 0.05, phase: 4.4, drift: 151, fm: 1.2, fmc: 2.3, fmp: 1.1, h2: 0 },
  { n: 2.3, top: 0.05, hem: 0.5, phase: 1.6, drift: 173, fm: 0, fmc: 0, fmp: 0, h2: 0 },
];
/** The lamp: 1.05 frame widths to the right of centre, a tenth above the middle, half a unit in front of the cloth: low, skimming the folds. */
const LAMP = { x: 1.05, y: 0.1, z: 0.5 };
/**
 * The lamp's footprint on the cloth, the one pool of light: a Gaussian centred 0.34 frame widths right of centre and
 * 0.15 frame heights above it (just outside the mark's box), 0.22 widths by 0.55 heights wide, falling to half the lamp's
 * light at the far left so the folds there still frame the mark.
 */
const POOL = { x: 0.34, y: 0.15, sx: 0.22, sy: 0.55 };
/** The breath: a bulge of air leaves the hem every thirty seconds and climbs at 2.5% of the frame height a second. */
const BREATH_EVERY = 30;
const BREATH_SPEED = 0.025;
/** Narrow enough that the bulges, 0.75 frame heights apart, are each a breath with calm between: 5.4 sigma apart. */
const BREATH_SIGMA = 0.11 * SHEET_H;
const BREATH_FROM = -SHEET_H / 2 - 2 * BREATH_SIGMA;
/** When the bulges leave, so that at the still frame one is a little above the middle of the frame: mid-breath. */
const BREATH_OFFSET = 1.2;
const SWAY_PERIOD = 45;
/** The clock is pre-rolled to twelve seconds; the reduced-motion still is this frame too. */
const START = 12;

/** A fixed fraction in [0, 1) for each breath, so no two are the same depth and the cloth never repeats. */
const hash = (j: number) => {
  const s = Math.sin(j * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const VERT = /* glsl */ `
  // position holds (u, v, seed): where the mote sits on the sheet, 0..1 across and 0..1 up, and a fixed random number.
  uniform float uPixel; // device px per CSS px
  uniform float uDist; // the camera's distance from the sheet
  uniform float uAspect; // the frame's width over its height
  uniform vec2 uSheet; // the sheet's width and height, in frame heights
  uniform vec3 uLamp;
  uniform vec2 uPoolC; // the lamp's footprint on the cloth: centre and
  uniform vec2 uPoolS; // sigma, in frame heights
  uniform vec4 uFold[4]; // wavenumber, depth at the top, depth at the hem, phase (drifting)
  uniform vec4 uFoldFM[4]; // spacing modulation: depth (radians), wavenumber, phase; and the second harmonic's weight
  uniform float uWander; // the crests' wander, as a fraction of the frame width per frame height, scaled to the folds' width
  uniform vec3 uBulge[3]; // the breaths in flight: height, depth, sigma
  uniform float uSway; // the hem's sideways offset
  uniform float uSoft; // the motes' softness: the base of their Gaussian sigma, CSS px
  varying vec3 vColor;
  varying float vAlpha;
  const float S8 = 0.139173; // sin and cos of the sheet's eight-degree turn
  const float C8 = 0.990268;
  const vec3 DEEP = vec3(0.655, 0.486, 0.196);
  const vec3 GOLD = vec3(0.847, 0.710, 0.416);
  const vec3 CHAMPAGNE = vec3(0.914, 0.843, 0.659);
  // Half-way from champagne to ivory: a lone ivory mote at a third of its light reads grey over the ink, so the
  // hairline's motes carry this and only where they stack does a pixel reach ivory.
  const vec3 IVORY = vec3(0.936, 0.886, 0.769);

  // The cloth's depth at a point of the sheet (x across, y up, in frame heights, the centre at the origin).
  float cloth(vec2 p) {
    float hem = 0.5 - p.y / uSheet.y; // 0 at the top, where the cloth is held; 1 at the hem
    // The sway: the hem swings sideways, the top is held.
    p.x += uSway * hem;
    float z = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 F = uFold[i];
      vec4 M = uFoldFM[i];
      float fi = float(i);
      // Each fold opens a little toward the hem. No crest is a ruled line and no fold is one depth all the way down
      // or the same as its neighbour: a wander that grows toward the hem, a slow swell along each, a slow swell
      // across the sheet, and the spacing modulated across the sheet.
      float k = F.x * (1.0 - 0.12 * hem);
      float x = p.x + (0.016 + 0.031 * hem) * uWander * sin(p.y * (2.2 + fi * 1.3) + F.w * 2.3 + fi);
      float A = mix(F.y, F.z, hem) * (0.8 + 0.2 * sin(p.y * (4.0 + fi * 2.1) + fi * 2.0)) * (0.75 + 0.25 * sin(p.x * (2.0 + fi * 1.1) + fi * 1.3));
      float th = k * x + F.w + M.x * sin(M.y * x + M.z);
      z += A * (sin(th) + M.w * sin(2.0 * th));
    }
    // Calmer in the centre third, so the silk frames the mark rather than crossing it.
    z *= mix(0.4, 1.0, smoothstep(0.15, 0.32, abs(p.x) * 1.3 / uSheet.x));
    // The breath: bulges of air climbing the cloth, each a Gaussian in height.
    for (int j = 0; j < 3; j++) {
      float d = (p.y - uBulge[j].x) / uBulge[j].z;
      z += uBulge[j].y * exp(-0.5 * d * d);
    }
    return z;
  }

  void main() {
    vec2 p = vec2((position.x - 0.5) * uSheet.x, (position.y - 0.5) * uSheet.y);
    float z = cloth(p);
    // The surface normal from finite differences, so it stays right however the cloth is tuned.
    const float E = 0.004;
    float fx = (cloth(p + vec2(E, 0.0)) - cloth(p - vec2(E, 0.0))) / (2.0 * E);
    float fy = (cloth(p + vec2(0.0, E)) - cloth(p - vec2(0.0, E))) / (2.0 * E);
    vec3 n = normalize(vec3(-fx, -fy, 1.0));
    // The sheet hangs turned eight degrees about its vertical axis, right edge nearer.
    vec3 P = vec3(p.x * C8 - z * S8, p.y, p.x * S8 + z * C8);
    n = vec3(n.x * C8 - n.z * S8, n.y, n.x * S8 + n.z * C8);
    // The lamp's footprint: the one pool of light, to the right, holding half its light at the far left. Then half of
    // wrapped diffuse, and a sheen where the normal bisects the lamp and the eye: a soft lobe over the lit flank and a
    // narrow one, the hairline along the crest, ten degrees wide.
    vec2 e = (P.xy - uPoolC) / uPoolS;
    float g = mix(0.5, 1.0, exp(-0.5 * dot(e, e)));
    vec3 l = normalize(uLamp - P);
    vec3 h = normalize(l + normalize(cameraPosition - P));
    float diffuse = 0.5 * max(0.0, (dot(n, l) + 0.7) / 1.7);
    float d = max(dot(n, h), 0.0);
    float sheen = 0.45 * pow(d, 6.0) + 0.55 * pow(d, 48.0);
    float b = g * (diffuse + sheen);
    vec4 mv = modelViewMatrix * vec4(P, 1.0);
    vec4 clip = projectionMatrix * mv;
    // The mark's box, 60% wide and 35% tall: inside it, light above a quarter is held down to an eighth of what it would
    // be, feathered over 7% of the frame height beyond its rounded edge. The cloth's faint body passes untouched, so no
    // edge shows; only flanks and hairlines dim as they enter, as into shade.
    vec2 ndc = abs(clip.xy / clip.w);
    vec2 out_ = vec2(max(ndc.x - 0.6, 0.0) * uAspect, max(ndc.y - 0.35, 0.0));
    float shade = smoothstep(0.0, 0.15, length(out_));
    b -= 0.88 * max(b - 0.25, 0.0) * (1.0 - shade);
    // Brightness to light: alpha 0.03 in the troughs to 0.39 on the hairline; the colour deep gold in the half-light,
    // gold on the lit flank, champagne where the sheen peaks, toward ivory only where the hairline does.
    float q = clamp((b - 0.04) / 1.3, 0.0, 1.0);
    vec3 col = mix(DEEP, GOLD, clamp(q / 0.35, 0.0, 1.0));
    col = mix(col, CHAMPAGNE, clamp((q - 0.7) / 0.22, 0.0, 1.0));
    col = mix(col, IVORY, clamp((q - 0.92) / 0.08, 0.0, 1.0));
    float a = 0.03 + 0.36 * q;
    // Size by depth, 1.2 to 1.8 CSS px across the sheet's turn. Each mote is a soft Gaussian spot, sigma about 1.4 px,
    // so its light is spread the same whatever its position on the pixel grid and whatever the pixel ratio, and with
    // one mote per four pixels either way, neighbours fuse into a surface rather than a stipple. The sprite reaches two
    // sigma, where the fragment shader has brought the spot to zero.
    float S = (1.4 + 0.2 * position.z) * pow(uDist / -mv.z, 3.0);
    float sigma = uSoft + 0.25 * S;
    gl_PointSize = 4.0 * sigma * uPixel;
    vColor = col;
    vAlpha = a;
    gl_Position = clip;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // A Gaussian of sigma a quarter of the sprite, lowered so it reaches zero at the sprite's inscribed circle (two
    // sigma, where it would be 13.5%): no square shows, however bright the mote.
    vec2 q = gl_PointCoord - 0.5;
    float a = max(exp(-8.0 * dot(q, q)) - 0.1353, 0.0) / 0.8647;
    // Additive blending multiplies by the alpha channel (SRC_ALPHA, ONE), so the colour goes out straight.
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export default function Silk({ still }: BackdropProps) {
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
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 10);

      // ── The sheet: motes stratified over it (a jittered grid, so no lattice and no clumps), in one buffer ──
      // One mote per sixteen or so CSS pixels of the sheet on either device: close enough to fuse under the lamp.
      const want = phone ? 30000 : 130000;
      const aspect0 = window.innerWidth / Math.max(1, window.innerHeight);
      const nx = Math.max(1, Math.round(Math.sqrt((want * SHEET_W * aspect0) / SHEET_H)));
      const ny = Math.ceil(want / nx);
      const count = nx * ny;
      const pos = new Float32Array(count * 3);
      let seedN = 7;
      const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      let k = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          pos[k++] = (i + rnd()) / nx;
          pos[k++] = (j + rnd()) / ny;
          pos[k++] = rnd();
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const uFold = FOLDS.map(() => new THREE.Vector4());
      const uFoldFM = FOLDS.map(() => new THREE.Vector4());
      const uBulge = [0, 1, 2].map(() => new THREE.Vector3());
      const uLamp = new THREE.Vector3();
      const uSheet = new THREE.Vector2(SHEET_W, SHEET_H);
      const uPoolC = new THREE.Vector2();
      const uPoolS = new THREE.Vector2();
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPixel: { value: renderer.getPixelRatio() },
          uDist: { value: DIST },
          uAspect: { value: 1 },
          uSheet: { value: uSheet },
          uLamp: { value: uLamp },
          uPoolC: { value: uPoolC },
          uPoolS: { value: uPoolS },
          uFold: { value: uFold },
          uFoldFM: { value: uFoldFM },
          uWander: { value: 1 },
          uBulge: { value: uBulge },
          uSway: { value: 0 },
          uSoft: { value: 1.0 },
        },
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      scene.add(points);

      // ── The frame, the pointer, the clock ──
      let w = 1;
      let h = 1;
      let aspect = 1;
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        aspect = w / Math.max(1, h);
        renderer.setSize(w, h, false);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        mat.uniforms.uAspect.value = aspect;
        // The sheet is always 1.3 frames wide, and the folds keep their count per frame width (two thirds on phones,
        // so their crests wander half as much again, as the folds are wider).
        uSheet.set(SHEET_W * aspect, SHEET_H);
        const perWidth = (TAU * (phone ? 2 / 3 : 1)) / aspect;
        mat.uniforms.uWander.value = aspect * (phone ? 1.5 : 1);
        FOLDS.forEach((F, i) => {
          uFold[i].x = F.n * perWidth;
          uFold[i].y = F.top * DEPTH;
          uFold[i].z = F.hem * DEPTH;
          uFoldFM[i].set(F.fm, F.fmc * perWidth, F.fmp, F.h2);
        });
        uPoolC.set(POOL.x * aspect, POOL.y);
        uPoolS.set(POOL.sx * aspect, POOL.sy);
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const place = (t: number, dt: number) => {
        // The lean eases toward the pointer over a couple of seconds, whatever the frame rate.
        const e = 1 - Math.exp(-dt / 0.75);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        // The camera leans a degree toward the pointer, the lamp six: the sheen slides.
        const yaw = lx * DEG;
        const pitch = -ly * DEG;
        camera.position.set(DIST * Math.sin(yaw) * Math.cos(pitch), DIST * Math.sin(pitch), DIST * Math.cos(yaw) * Math.cos(pitch));
        camera.lookAt(0, 0, 0);
        const ay = lx * 6 * DEG;
        const Lx = LAMP.x * aspect;
        uLamp.set(Lx * Math.cos(ay) + LAMP.z * Math.sin(ay), LAMP.y - ly * 6 * DEG * Lx, LAMP.z * Math.cos(ay) - Lx * Math.sin(ay));
        // The folds drift, each at its own period of two minutes or so, so the cloth never repeats.
        FOLDS.forEach((F, i) => {
          uFold[i].w = F.phase + 0.45 * Math.sin((TAU * t) / F.drift + i * 1.9);
        });
        // The breaths in flight: the three most recent to leave the hem, each its own depth and width.
        const j0 = Math.floor((t - BREATH_OFFSET) / BREATH_EVERY);
        for (let b = 0; b < 3; b++) {
          const j = j0 - b;
          const age = t - (j * BREATH_EVERY + BREATH_OFFSET);
          uBulge[b].set(BREATH_FROM + BREATH_SPEED * age, 0.03 * aspect * (0.65 + 0.35 * hash(j)), BREATH_SIGMA * (0.9 + 0.2 * hash(j + 0.5)));
        }
        // The hem swings sideways 1.5% of the frame width, peak to peak, over 45 s.
        mat.uniforms.uSway.value = 0.0075 * aspect * Math.sin((TAU * t) / SWAY_PERIOD);
        renderer.render(scene, camera);
      };
      size();
      if (still) {
        place(START, 0);
        const onResize = () => {
          size();
          place(START, 0);
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
      let last = 0;
      const t0 = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
        last = now;
        place(START + (now - t0) / 1000, dt);
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
