import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The orrery: a family's holdings as a system. One small point of light, the
 * heart, low in the frame; seven rings of motes in slow orbit around it (the
 * inner ring takes a minute, the outer ten), seen low and close so they read
 * as nested ellipses: near sides sweeping the lower frame, far sides passing
 * small and dim behind the mark. Ivory at the centre deepening to gold at the
 * edge; on every ring a body or two trailing gold; a hairline of motes marks
 * each orbit; dust far out. Everything is one draw call: a vertex shader puts
 * each mote on its orbit from a phase, a radius and the time, softens what is
 * nearer than the heart like a lens, dims what is beyond it like air, and holds
 * band and body light down inside the mark's box. Additive blending makes the
 * light add up where the rings cross.
 *
 * The camera drifts slowly, breathes, and leans a little toward the pointer.
 * Phones get fewer motes and a lower pixel ratio. Reduced motion draws one
 * frame. Without WebGL (or if three.js fails to load) the canvas stays a deep
 * blue and the page still reads.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Radius, band width, tilt and roll of each ring. The inner three lie within 3 degrees of one plane; the rest lean further out. */
const RINGS = [
  { radius: 1.7, width: 0.22, tilt: 0, roll: 0, bodies: 1 },
  { radius: 2.5, width: 0.28, tilt: -2 * DEG, roll: 0.3, bodies: 2 },
  { radius: 3.4, width: 0.34, tilt: 2.5 * DEG, roll: -0.5, bodies: 1 },
  { radius: 4.4, width: 0.42, tilt: 6 * DEG, roll: 0.3, bodies: 2 },
  { radius: 5.5, width: 0.5, tilt: 10 * DEG, roll: -1.4, bodies: 1 },
  { radius: 6.7, width: 0.58, tilt: 14 * DEG, roll: 0.8, bodies: 2 },
  { radius: 8.1, width: 0.7, tilt: 18 * DEG, roll: -0.2, bodies: 1 },
];
/** Angular speed by radius, as orbits go: the inner ring in 60 s, the outer in 10.4 min. */
const omega = (r: number) => (TAU / 60) * Math.pow(RINGS[0].radius / r, 1.5);
/** The brand's warm stops, ivory to deep gold; a ring's colour is read off this gradient by its index. */
const STOPS = ["f4ede0", "e9d7a8", "d8b56a", "a77c32"].map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
const ringColor = (u: number) => {
  const x = Math.min(2.999, u * 3);
  const i = Math.floor(x);
  const f = x - i;
  return STOPS[i].map((v, c) => v + (STOPS[i + 1][c] - v) * f);
};

const TRAIL = 28;
const ELEVATION = 22 * DEG;
/** The whole system is rolled about the view axis, so it is never a bullseye. */
const ROLL = 7 * DEG;
/** The clock is pre-rolled; the reduced-motion still is this frame too. */
const START = 52;

/** What a vertex is: a band mote, a mote of an orbit's hairline, a body, a point of its trail, far dust, or the heart. */
const BAND = 0;
const SPINE = 1;
const CORE = 2;
const TAIL = 3;
const DUST = 4;
const HEART = 5;

const VERT = /* glsl */ `
  attribute float ring;
  attribute float phase;
  attribute float dr;
  attribute float dy;
  attribute float seed;
  attribute float alpha;
  attribute float kind;
  uniform float uTime;
  uniform float uPixel; // device px per CSS px
  uniform float uFocal; // the camera's distance from the heart: the focal plane
  uniform float uUnit; // CSS px per world unit at the focal plane
  uniform vec3 uColor[7];
  uniform vec4 uRing[7]; // radius, width, tilt, roll
  uniform float uSpeed[7];
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;
  const vec3 IVORY = vec3(0.957, 0.929, 0.878);
  const vec3 CHAMPAGNE = vec3(0.914, 0.843, 0.659);
  const vec3 GOLD = vec3(0.847, 0.710, 0.416);
  // A ring's tilt (about x), then its roll (about y), so no two rings lie in one plane.
  vec3 orient(vec3 v, vec4 R) {
    float ct = cos(R.z), st = sin(R.z);
    v = vec3(v.x, v.y * ct - v.z * st, v.y * st + v.z * ct);
    float cr = cos(R.w), sr = sin(R.w);
    return vec3(v.x * cr - v.z * sr, v.y, v.x * sr + v.z * cr);
  }
  void main() {
    int i = int(ring + 0.5);
    int k = int(kind + 0.5);
    vec3 p = position;
    vec3 tangent = vec3(0.0); // the orbit's direction, for a hairline mote's or trail point's spacing on screen
    float size = 1.8; // CSS px at the focal plane
    float a = alpha;
    vColor = IVORY;
    if (k == 5) {
      // The heart: a small Gaussian point of ivory, breathing a little over eleven seconds.
      p = vec3(0.0);
      size = 0.28 * uUnit;
      a = 0.8 + 0.06 * sin(uTime * 0.5712);
    } else if (k != 4) {
      vec4 R = uRing[i];
      float rad = R.x + dr * R.y;
      float ang = phase + uTime * uSpeed[i];
      p = orient(vec3(cos(ang) * rad, dy * R.y * 0.3, sin(ang) * rad), R);
      if (k == 0) {
        size = 1.2 + 1.4 * seed;
        // A slow twinkle, six to fourteen seconds a cycle, a quarter deep.
        a *= 0.75 + 0.25 * sin(uTime * (0.45 + 0.6 * seed) + 50.0 * seed);
        vColor = uColor[i];
      } else if (k == 1) {
        size = 1.6;
        vColor = uColor[i];
      } else if (k == 2) {
        size = 9.0;
        vColor = CHAMPAGNE;
      } else {
        size = 3.0 + seed;
        vColor = GOLD;
      }
      if (k == 1 || k == 3) tangent = orient(vec3(-sin(ang) * rad, 0.0, cos(ang) * rad), R);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    // S: how big the point looks, in CSS px. Each point is a Gaussian spot of sigma a fifth of S, never under about
    // 0.7 CSS px, so a mote's light is spread the same whatever its position on the pixel grid (nothing sparkles) and
    // whatever the pixel ratio. Dust keeps its size; everything else shrinks with distance.
    float S = size;
    float sigma = max(0.55 + 0.1 * S, 0.2 * S);
    if (k == 5) {
      S = size * uFocal / depth;
      sigma = S / 6.9;
    } else if (k != 4) {
      S = size * uFocal / depth;
      // Nearer than the focal plane, a mote spreads into a circle of confusion, as through a lens: the same light over
      // a larger spot, so its peak falls with the ratio of the two spots' areas. It only ever falls: the cap of 18 px
      // keeps a body's bokeh from swelling further on the near side, and the light that would have spread is lost.
      float c = clamp((uFocal - depth) * 0.9, 0.0, 14.0);
      float s0 = sigma;
      S = min(S + c, 18.0);
      sigma = max(0.55 + 0.1 * S, 0.2 * S);
      a *= min(1.0, (s0 * s0) / (sigma * sigma));
      // Beyond it, the air takes some. Hairlines keep 0.6 of their light so the orbits stay legible behind the mark;
      // band motes, bodies and trails thin with distance (0.55 a unit beyond, 0.3 two units beyond), so the far sides
      // of the inner rings pass dim under the letters and the outer rings' far bodies vanish behind them.
      if (k == 1) a *= mix(1.0, 0.6, smoothstep(uFocal - 1.0, uFocal + 2.0, depth));
      else a *= exp(-0.6 * max(depth - uFocal, 0.0));
      if (k == 1 || k == 3) {
        // Hairline motes and trail points sit at fixed steps along the orbit. Where the orbit runs toward the camera
        // (a flank, a shoulder) they crowd on screen, so each one's light is scaled by its screen spacing against what
        // it has seen square on at the focal plane (a hairline's own step; a trail's 2.1 px): the line keeps one weight
        // around the whole orbit, a tail at a flank is a short streak, and nothing piles up under the mark.
        vec3 tv = (modelViewMatrix * vec4(tangent, 0.0)).xyz;
        vec2 ds = (uUnit * uFocal / depth) * (tv.xy + mv.xy * tv.z / depth); // screen px per radian of orbit
        float arcPx = length(ds) / uRing[i].x; // screen px per unit of arc
        a *= min(1.0, arcPx / (k == 1 ? uUnit : 84.0));
      }
    }
    vec4 clip = projectionMatrix * mv;
    if (k <= 3) {
      // The mark's box, 60% wide and 35% tall at the centre of the frame: band light inside it is halved and a body's
      // (with its trail) cut to a fifth, the edge softened over a few percent of the frame, so no world rounding a
      // shoulder and no twinkling mote outshines the mark. Hairlines pass unshaded: the orbits stay legible behind it.
      vec2 e = abs(clip.xy / clip.w);
      if (k == 0) a *= 1.0 - 0.5 * (1.0 - smoothstep(0.56, 0.64, e.x)) * (1.0 - smoothstep(0.33, 0.37, e.y));
      if (k >= 2) a *= 1.0 - 0.8 * (1.0 - smoothstep(0.60, 0.68, e.x)) * (1.0 - smoothstep(0.35, 0.39, e.y));
    }
    // The sprite reaches 2.5 sigma, where the Gaussian is already under 5%. The heart is a sharper point.
    float sprite = k == 5 ? S : 5.0 * sigma;
    vSharp = sprite * sprite / (8.0 * sigma * sigma);
    gl_PointSize = sprite * uPixel;
    vAlpha = a;
    gl_Position = clip;
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

export default function Orrery({ still }: BackdropProps) {
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
      const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);

      // ── Every point of light, in one buffer: bands, hairlines, bodies and trails, dust, and the heart ──
      const perRing = phone ? 2600 : 5600;
      const perUnit = phone ? 150 : 400;
      const dustN = phone ? 500 : 1400;
      const spineN = RINGS.map((R) => Math.round(R.radius * perUnit));
      const count = RINGS.length * perRing + spineN.reduce((n, s) => n + s, 0) + RINGS.reduce((n, R) => n + R.bodies * (1 + TRAIL), 0) + dustN + 1;
      const pos = new Float32Array(count * 3);
      const ring = new Float32Array(count);
      const phase = new Float32Array(count);
      const dr = new Float32Array(count);
      const dy = new Float32Array(count);
      const seed = new Float32Array(count);
      const alpha = new Float32Array(count);
      const kind = new Float32Array(count);
      let seedN = 3;
      const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      // Roughly bell-shaped, so the bands are dense in the middle and thin at the edges.
      const bell = () => (rnd() + rnd() + rnd()) / 1.5 - 1;
      let k = 0;
      const put = (what: number, i: number, ph: number, r: number, y: number, s: number, a: number) => {
        kind[k] = what;
        ring[k] = i;
        phase[k] = ph;
        dr[k] = r;
        dy[k] = y;
        seed[k] = s;
        alpha[k] = a;
        k++;
      };
      const area0 = RINGS[0].radius * RINGS[0].width;
      RINGS.forEach((R, i) => {
        // Band motes carry 0.18 to 0.35 of light, scaled by 0.2: drawn as Gaussian spots that keep all their light,
        // five thousand of them sum past white at the inner ring's sides otherwise, and the band must peak under 0.75.
        // Every ring has the same count, so the outer ones spread theirs over up to fifteen times the area; their motes
        // are raised half-way back (by the square root of the area ratio, up to 3.9 at the outer ring), so all seven
        // read as rings of light and not six hairlines around one.
        const gain = 0.2 * Math.sqrt((R.radius * R.width) / area0);
        for (let j = 0; j < perRing; j++) put(BAND, i, rnd() * TAU, bell(), bell(), rnd(), (0.18 + 0.17 * rnd()) * gain);
        // The orbit's hairline: motes spaced evenly (with a little jitter) along the ring's centre, no twinkle. At 0.08
        // each the line is a tenth of white seen square on, half that on the far side, and two crossing under the mark
        // stay well under a quarter.
        const n = spineN[i];
        for (let j = 0; j < n; j++) put(SPINE, i, ((j + rnd()) / n) * TAU, 0, 0, rnd(), 0.08);
        for (let b = 0; b < R.bodies; b++) {
          const p0 = rnd() * TAU;
          // A body is a soft champagne bead, 0.35 so it reads as a world at the flanks; the air thins it and its trail
          // beyond the focal plane and the mark's box cuts them to a fifth, so one passing behind the mark is a few
          // percent of white.
          put(CORE, i, p0, 0, 0, 0.5, 0.35);
          // The trail follows at a fixed spacing along the arc, fading as 0.3 (1 - k/28)^1.6.
          for (let t = 1; t <= TRAIL; t++) put(TAIL, i, p0 - (t * 0.025) / R.radius, 0, 0, rnd(), 0.3 * Math.pow(1 - t / TRAIL, 1.6));
        }
      });
      for (let j = 0; j < dustN; j++) {
        const r = 12 + rnd() * 26;
        const th = rnd() * TAU;
        const ph = Math.acos(rnd() * 2 - 1);
        pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], k * 3);
        put(DUST, 0, 0, 0, 0, rnd(), 0.03);
      }
      put(HEART, 0, 0, 0, 0, 0, 0.8);

      const geo = new THREE.BufferGeometry();
      // Only the dust reads its position from here; everything else is placed by the shader.
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("ring", new THREE.BufferAttribute(ring, 1));
      geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
      geo.setAttribute("dr", new THREE.BufferAttribute(dr, 1));
      geo.setAttribute("dy", new THREE.BufferAttribute(dy, 1));
      geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
      geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
      geo.setAttribute("kind", new THREE.BufferAttribute(kind, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: START },
          uPixel: { value: renderer.getPixelRatio() },
          uFocal: { value: 12.5 },
          uUnit: { value: 85 },
          uColor: { value: RINGS.map((_, i) => new THREE.Vector3(...ringColor(i / 6))) },
          uRing: { value: RINGS.map((R) => new THREE.Vector4(R.radius, R.width, R.tilt, R.roll)) },
          uSpeed: { value: RINGS.map((R) => omega(R.radius)) },
        },
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      scene.add(points);

      // ── The camera, the pointer, the frames ──
      let w = 1;
      let h = 1;
      let dist = 12.5;
      let aimY = 2.6;
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w < h ? 60 : 46;
        dist = w < h ? 15.5 : 12.5;
        camera.updateProjectionMatrix();
        const halfH = dist * Math.tan((camera.fov * DEG) / 2);
        // Aim above the heart so it sits at about three quarters of the frame height (2.6 units up in landscape).
        aimY = 0.49 * halfH;
        mat.uniforms.uFocal.value = dist;
        mat.uniforms.uUnit.value = h / (2 * halfH);
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const target = new THREE.Vector3();
      const right = new THREE.Vector3();
      const place = (t: number, dt: number) => {
        // The lean eases toward the pointer over a couple of seconds (tau 0.8 s), whatever the frame rate.
        const e = 1 - Math.exp(-dt / 0.8);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        const az = t * 0.009 + lx * 0.052;
        const el = ELEVATION + 1.5 * DEG * Math.sin((t * TAU) / 90) + ly * 0.026;
        camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
        // Look above the heart, roll the view, then slide the aim sideways so the heart still sits on the centreline.
        target.set(0, aimY, 0);
        camera.lookAt(target);
        camera.rotateZ(ROLL);
        right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        target.addScaledVector(right, -aimY * right.y);
        camera.lookAt(target);
        camera.rotateZ(ROLL);
        mat.uniforms.uTime.value = t;
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
