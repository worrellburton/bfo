import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * Champagne silk: a single length of silk hangs behind the mark, and you only
 * see it where the light catches a fold. The sheet is a quarter of a million
 * motes on a laptop, one for every eight pixels of cloth, close enough to fuse
 * into a surface, each lit as if it sat on one: a height field of folds,
 * tight at the top where the cloth is held and wide and soft at the hem,
 * calmer in the centre third so the silk frames the mark instead of crossing
 * it. Each fold is a pleat: a steep flank toward the lamp, a gentle shaded
 * one. One lamp, to the right and a little above, in front of the cloth,
 * skims the folds: deep gold in the half-light, gold on the lit flanks,
 * champagne where the sheen peaks, and a hairline of near-ivory along each
 * crest, dying to ink in the troughs. The weave runs across the sheet, so the
 * sheen is sharp in a fold's slope and tolerant along it: the hairline is
 * thin and runs the height of the frame. The lamp's pool sits inside the
 * right third and falls away quickly toward the frame's edge (a shutter),
 * slowly toward the left, so the brightest fold is never cut by the border.
 * Its whole motion is a breath: every half minute a puff of air leaves the
 * hem somewhere across the cloth and climbs it, bending the sheen as it
 * passes each fold; the hem sways a little over 45 s and the folds drift over
 * two minutes. Everything is one draw call: the vertex shader evaluates the
 * cloth at each mote and at four neighbours for a finite-difference normal,
 * then lights it. The pointer leans the lamp by six degrees and the camera by
 * one, so the sheen slides. The mote count follows the window's area at
 * mount and the light per mote follows it after, so the cloth is the same
 * brightness in any window; phones get a lower pixel ratio and four folds.
 * Reduced motion draws one frame, mid-breath. Without WebGL (or if three.js
 * fails to load) the canvas stays a deep blue and the page still reads.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** The camera's distance from the sheet. The world unit is the frame height there: the frame is one unit tall and `aspect` wide. */
const DIST = 2.5;
const FOV = (2 * Math.atan(0.5 / DIST)) / DEG;
/** The sheet: 1.3 frame widths wide and 1.25 frame heights tall, so no edge is ever in the frame, however the camera leans. */
const SHEET_W = 1.3;
const SHEET_H = 1.25;
/**
 * One mote for every eight CSS pixels of the sheet: close enough that neighbours fuse into a surface rather than a
 * stipple, and that a crest's motes sum to a hairline brighter than any one of them. The count is taken from the window
 * at mount, between these bounds; after that `uGain` keeps the light per pixel constant, up to a limit.
 */
const PX_PER_MOTE = 8;
const MOTES_MIN = 60000;
const MOTES_MAX = 260000;
const MOTES_MAX_COARSE = 200000;
const MOTES_MAX_PHONE = 100000;
const GAIN_MAX = 1.5;
/**
 * The folds' depth at the hem, in frame heights, for folds a sixth of a 16:9 frame wide; it scales with the folds'
 * width, so a pleat is the same shape on a phone. Deep enough that a pleat's steep flank always crosses the sheen's
 * angle (about 0.6 of slope under the lamp), whatever the drift of the folds against each other.
 */
const DEPTH = 0.07;
/** The fold width DEPTH is quoted for: a sixth of a 1.6:1 frame, in frame heights. */
const FOLD_W0 = 1.6 / 6;
/**
 * The folds, summed: how many per frame width, how deep at the top and at the hem (fractions of the depth), a phase, and
 * the period of its drift. The first two are the body of the cloth, the second weaker so it modulates the first rather
 * than cancelling it: each has its spacing slowly modulated across the sheet (`fm` radians at `fmc` cycles per frame
 * width, from phase `fmp`), so no two folds are the same width and nothing beats to a flat patch, and a second harmonic
 * (`h2`, negative) that makes each fold a pleat: a steep flank toward the lamp, which the sheen catches as a thin line,
 * and a gentle shaded one. The third is the tight gathering at the top, gone by the hem; the fourth the broad swell of
 * the hem, turned so its lit flank leaves the frame on the right.
 */
const FOLDS = [
  { n: 6, top: 0.55, hem: 0.9, phase: 2.356, drift: 120, fm: 1.0, fmc: 1.3, fmp: 0.4, h2: -0.18 },
  { n: 4.3, top: 0.3, hem: 0.6, phase: 4.712, drift: 137, fm: 0.8, fmc: 0.9, fmp: 2.2, h2: -0.18 },
  { n: 11.5, top: 0.3, hem: 0.05, phase: 4.4, drift: 151, fm: 1.2, fmc: 2.3, fmp: 1.1, h2: 0 },
  { n: 2.3, top: 0.05, hem: 0.5, phase: 0.15, drift: 173, fm: 0, fmc: 0, fmp: 0, h2: 0 },
];
/** Where the fold pattern sits across the sheet, in frame widths: slid so the brightest crest hangs under the lamp's pool. */
const SHIFT = { desktop: 0.05, phone: 0.3 };
/** The lamp: 1.05 frame widths to the right of centre, a tenth above the middle, three quarters of a unit in front of the cloth: low, skimming the folds. */
const LAMP = { x: 1.05, y: 0.1, z: 0.75 };
/**
 * The lamp's footprint on the cloth, the one pool of light: a Gaussian centred 0.30 frame widths right of centre (80%
 * of the way across) and 0.08 frame heights above the middle, just outside the mark's box; 0.5 heights tall, 0.24
 * widths wide on its left side and 0.08 on its right, a shutter, so the light is down to a quarter at the right edge of
 * the frame before a crest can be cut by the border, and to a third at the far left, where the folds still frame the
 * mark. On phones the floors and the left side are lower, so the one pool stands clear of the rest.
 */
const POOL = { x: 0.3, y: 0.08, sxL: 0.24, sxR: 0.08, sy: 0.5, lo: 0.33, loR: 0.25 };
const POOL_PHONE = { sxL: 0.16, lo: 0.25, loR: 0.2 };
/** The breath: a puff of air leaves the hem every thirty seconds and climbs at 2.5% of the frame height a second. */
const BREATH_EVERY = 30;
const BREATH_SPEED = 0.025;
/** Narrow enough that the puffs, 0.75 frame heights apart, are each a breath with calm between: 5.4 sigma apart. */
const BREATH_SIGMA = 0.11 * SHEET_H;
const BREATH_FROM = -SHEET_H / 2 - 2 * BREATH_SIGMA;
/** Each puff is local: 0.35 frame widths wide (sigma), centred somewhere across the middle 80% of the frame, a different place each time. */
const BREATH_SX = 0.35;
/** When the puffs leave, so that at the still frame one is a little above the middle of the frame: mid-breath. */
const BREATH_OFFSET = 1.2;
const SWAY_PERIOD = 45;
/** The clock is pre-rolled to twelve seconds; the reduced-motion still is this frame too. */
const START = 12;

/** A fixed fraction in [0, 1) for each breath, so no two are the same depth, width or place and the cloth never repeats. */
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
  uniform vec2 uPoolC; // the lamp's footprint on the cloth: centre, and
  uniform vec3 uPoolS; // sigma to the left of the centre, to its right, and vertically, in frame heights
  uniform vec2 uPoolLo; // the footprint's floors, left and right of the centre: the lamp's light far from it, as fractions
  uniform vec4 uFold[4]; // wavenumber, depth at the top, depth at the hem, phase (drifting)
  uniform vec4 uFoldFM[4]; // spacing modulation: depth (radians), wavenumber, phase; and the second harmonic's weight
  uniform float uWander; // the crests' wander, as a fraction of the frame width per frame height, scaled to the folds' width
  uniform float uShift; // where the folds sit across the sheet, in frame heights: slid so the brightest crest hangs under the pool
  uniform vec4 uBulge[3]; // the breaths in flight: height, depth, sigma (vertical), centre across
  uniform float uPuff; // a breath's sigma across, in frame heights
  uniform float uSway; // the hem's sideways offset
  uniform float uSoft; // the motes' softness: the base of their Gaussian sigma, CSS px
  uniform float uGain; // light per mote, relative to one mote per eight pixels: holds the picture when the window changes
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
      // or the same as its neighbour: a slight wander that grows toward the hem (the crests hang near vertical, as
      // held cloth does), a slow swell along each, a slow swell across the sheet, and the spacing modulated across
      // the sheet.
      float k = F.x * (1.0 - 0.04 * hem);
      float x = p.x + uShift + (0.004 + 0.015 * hem) * uWander * sin(p.y * (2.2 + fi * 1.3) + F.w * 2.3 + fi);
      float A = mix(F.y, F.z, hem) * (0.88 + 0.12 * sin(p.y * (4.0 + fi * 2.1) + fi * 2.0)) * (0.85 + 0.15 * sin(p.x * (2.0 + fi * 1.1) + fi * 1.3));
      float th = k * x + F.w + M.x * sin(M.y * x + M.z);
      z += A * (sin(th) + M.w * sin(2.0 * th));
    }
    // Calmer in the centre third, so the silk frames the mark rather than crossing it: a quarter of the depth, which
    // keeps every flank there below the sheen's angle, so no crest runs through the mark's box.
    z *= mix(0.25, 1.0, smoothstep(0.18, 0.34, abs(p.x) * 1.3 / uSheet.x));
    // The breath: puffs of air climbing the cloth, each a Gaussian in height and, more broadly, across, so a breath
    // lifts one part of the cloth and not a whole row of it.
    for (int j = 0; j < 3; j++) {
      vec4 B = uBulge[j];
      vec2 d = vec2((p.x - B.w) / uPuff, (p.y - B.x) / B.z);
      z += B.y * exp(-0.5 * dot(d, d));
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
    // The weave runs across the sheet: its direction on the surface, and the direction up the cloth, for the sheen.
    vec3 tg = normalize(vec3(1.0, 0.0, fx));
    // The sheet hangs turned eight degrees about its vertical axis, right edge nearer.
    vec3 P = vec3(p.x * C8 - z * S8, p.y, p.x * S8 + z * C8);
    n = vec3(n.x * C8 - n.z * S8, n.y, n.x * S8 + n.z * C8);
    tg = vec3(tg.x * C8 - tg.z * S8, tg.y, tg.x * S8 + tg.z * C8);
    vec3 bt = cross(n, tg);
    // The lamp's footprint: the one pool of light, in the right third, a shutter on its right side so the brightest
    // crest hangs inside the frame, gentle on its left so the folds there still frame the mark.
    bool left = P.x < uPoolC.x;
    vec2 e = vec2((P.x - uPoolC.x) / (left ? uPoolS.x : uPoolS.y), (P.y - uPoolC.y) / uPoolS.z);
    float g = mix(left ? uPoolLo.x : uPoolLo.y, 1.0, exp(-0.5 * dot(e, e)));
    // A quarter of wrapped diffuse, held hard so shaded flanks and troughs die to ink; then the sheen where the normal
    // bisects the lamp and the eye: a soft lobe over the lit flank and, carrying most of the light, the hairline: a
    // lobe shaped by the weave, ten degrees wide across the fibres (in the fold's slope) and thirty along them (up the
    // cloth), so a crest's line is thin and is not broken by the swells, the wander or a passing breath.
    vec3 l = normalize(uLamp - P);
    vec3 h = normalize(l + normalize(cameraPosition - P));
    float diffuse = 0.25 * max(0.0, (dot(n, l) + 0.3) / 1.3);
    float d = max(dot(n, h), 0.0);
    float ht = dot(tg, h);
    float hb = dot(bt, h);
    float hairline = exp(-(ht * ht / 0.0324 + hb * hb / 0.25) / max(d * d, 1e-4));
    float sheen = 0.15 * pow(d, 6.0) + hairline;
    float b = g * (diffuse + sheen);
    vec4 mv = modelViewMatrix * vec4(P, 1.0);
    vec4 clip = projectionMatrix * mv;
    // The mark's box, 60% wide and 35% tall: inside it, light above a fifth is held down to a tenth of what it would
    // be, feathered over 7% of the frame height beyond its rounded edge. The cloth's faint body passes untouched, so no
    // edge shows; only flanks and hairlines dim as they enter, as into shade.
    vec2 ndc = abs(clip.xy / clip.w);
    vec2 out_ = vec2(max(ndc.x - 0.6, 0.0) * uAspect, max(ndc.y - 0.35, 0.0));
    float shade = smoothstep(0.0, 0.15, length(out_));
    b -= 0.9 * max(b - 0.2, 0.0) * (1.0 - shade);
    // Brightness to light: alpha 0.015 in the troughs to 0.275 on the hairline, at one mote per eight pixels; the
    // colour deep gold in the half-light, gold on the lit flank, champagne where the sheen peaks, toward ivory only
    // where the hairline does.
    float q = clamp((b - 0.03) / 1.15, 0.0, 1.0);
    vec3 col = mix(DEEP, GOLD, clamp(q / 0.35, 0.0, 1.0));
    col = mix(col, CHAMPAGNE, clamp((q - 0.7) / 0.22, 0.0, 1.0));
    col = mix(col, IVORY, clamp((q - 0.92) / 0.08, 0.0, 1.0));
    float a = (0.015 + 0.26 * q) * uGain;
    // Size by depth, 1.2 to 1.8 CSS px across the sheet's turn. Each mote is a soft Gaussian spot, sigma about 1.4 px,
    // so its light is spread the same whatever its position on the pixel grid and whatever the pixel ratio, and with
    // a mote every eight pixels, neighbours fuse into a surface rather than a stipple. The sprite reaches two sigma,
    // where the fragment shader has brought the spot to zero.
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

/** How many motes cover the sheet at one per `PX_PER_MOTE` CSS pixels, for a frame of w by h. */
const cover = (w: number, h: number) => (SHEET_W * SHEET_H * w * h) / PX_PER_MOTE;

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
      // A phone (or any touch screen) renders at a lower pixel ratio and takes fewer motes; a narrow screen, fewer still
      // and the phone's composition: four folds, a tighter pool, the pattern slid so a crest hangs inside the right edge.
      const coarse = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
      const phone = window.matchMedia("(max-width: 640px)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      renderer.setClearColor(0x05060b, 1);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 10);

      // ── The sheet: motes stratified over it (a jittered grid, so no lattice and no clumps), in one buffer ──
      // As many as cover the window at mount, one per eight CSS pixels of the sheet, within the device's budget.
      const w0 = window.innerWidth;
      const h0 = window.innerHeight;
      const cap = phone ? MOTES_MAX_PHONE : coarse ? MOTES_MAX_COARSE : MOTES_MAX;
      const want = Math.min(cap, Math.max(MOTES_MIN, Math.round(cover(w0, h0))));
      const aspect0 = w0 / Math.max(1, h0);
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
      const uBulge = [0, 1, 2].map(() => new THREE.Vector4());
      const uLamp = new THREE.Vector3();
      const uSheet = new THREE.Vector2(SHEET_W, SHEET_H);
      const uPoolC = new THREE.Vector2();
      const uPoolS = new THREE.Vector3();
      const pool = phone ? { ...POOL, ...POOL_PHONE } : POOL;
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
          uPoolLo: { value: new THREE.Vector2(pool.lo, pool.loR) },
          uFold: { value: uFold },
          uFoldFM: { value: uFoldFM },
          uWander: { value: 1 },
          uShift: { value: 0 },
          uBulge: { value: uBulge },
          uPuff: { value: 1 },
          uSway: { value: 0 },
          uSoft: { value: 1.0 },
          uGain: { value: 1 },
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
        // The motes were counted for the window at mount; as the window changes, the light each carries follows the
        // area it now covers, so the cloth is neither twice as bright in a half-size window nor a sprinkle in a big one.
        mat.uniforms.uGain.value = Math.min(GAIN_MAX, Math.max(0.5, cover(w, h) / count));
        // The sheet is always 1.3 frames wide, and the folds keep their count per frame width (two thirds on phones,
        // so their crests wander half as much again, as the folds are wider); their depth follows their width, so a
        // pleat keeps its shape, and the pattern is slid so the brightest crest hangs under the pool.
        uSheet.set(SHEET_W * aspect, SHEET_H);
        const perWidth = (TAU * (phone ? 2 / 3 : 1)) / aspect;
        const depth = (DEPTH * (TAU / perWidth)) / 6 / FOLD_W0;
        mat.uniforms.uWander.value = aspect * (phone ? 1.5 : 1);
        mat.uniforms.uShift.value = (phone ? SHIFT.phone : SHIFT.desktop) * aspect;
        FOLDS.forEach((F, i) => {
          uFold[i].x = F.n * perWidth;
          uFold[i].y = F.top * depth;
          uFold[i].z = F.hem * depth;
          uFoldFM[i].set(F.fm, F.fmc * perWidth, F.fmp, F.h2);
        });
        uPoolC.set(pool.x * aspect, pool.y);
        uPoolS.set(pool.sxL * aspect, pool.sxR * aspect, pool.sy);
        mat.uniforms.uPuff.value = BREATH_SX * aspect;
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
        // The breaths in flight: the three most recent to leave the hem, each its own depth, width and place across.
        const j0 = Math.floor((t - BREATH_OFFSET) / BREATH_EVERY);
        for (let b = 0; b < 3; b++) {
          const j = j0 - b;
          const age = t - (j * BREATH_EVERY + BREATH_OFFSET);
          uBulge[b].set(BREATH_FROM + BREATH_SPEED * age, 0.03 * aspect * (0.65 + 0.35 * hash(j)), BREATH_SIGMA * (0.9 + 0.2 * hash(j + 0.5)), (hash(j + 0.25) - 0.5) * 0.8 * aspect);
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
