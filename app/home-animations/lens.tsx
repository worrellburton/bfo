import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The lens: a still room full of dust too fine to see, watched through a
 * lens wide open at f/1. Tens of thousands of motes hang in the dark from
 * arm's length to the far wall, but you only ever see the ones the light
 * finds: a dusk lamp just past the upper-left corner lays warm ivory on the
 * dust near it, in slow shafts a few hundred pixels across, and the dust
 * thins toward the lower right and the floor, where the room is nearly
 * empty and what is left is silver. The lens is focused a few feet in, and
 * someone is racking the focus by hand, slowly, so the one thin plane that
 * is ever sharp drifts back and forth through the cloud: a mote resolves
 * into a pin-sharp speck for a few seconds and then softens again. The
 * motes are tiny, and they stay tiny: off the plane of focus a mote goes
 * soft, never wide. Its softness is a continuum, from a speck in the plane
 * to a breath at the near and far ends, and because a point keeps its light
 * as the lens spreads it, the peak falls with the square of the softness: a
 * mote just off the plane is a soft dot nearly as bright as a speck, a far
 * one a faint smear, and nothing ever draws past six pixels (four and a half
 * on a phone), however soft it is. Light falls off with distance, so the
 * near field is the brighter soft layer and the far wall the fainter one,
 * and the same perspective makes the near field glide past at half again
 * the pace of the plane and the far wall at half of it: brightness and
 * speed tell the same depth. Most motes are faint and a few are bright, as
 * stars are, and the light has a temperature: ivory under the lamp, neutral
 * by the middle of the frame, cool silver in the far corner. No two motes
 * crowd each other: they are placed a pinhead apart on screen unless they
 * are far apart in depth. Everything is slow, and the air is still: there
 * is no current to speak of (a rise of a tenth of a pixel a second), only
 * eddies a few hundred pixels across that turn over half a minute to a
 * minute, so the plane of focus wanders about a pixel and a half a second
 * in a direction that differs from one region to the next and bends over
 * the time it takes to look, each mote with a little of its own mind; the
 * exposure breathes once every forty seconds; the camera leans a degree
 * toward the pointer. When the door is ready the dust fades up out of the
 * dark and the lens finds its plane as the mark lands. One instanced draw
 * of quads (a point sprite has a size limit on some phones; a quad has
 * none), everything analytic in the vertex shader. Reduced motion draws one
 * frame at t = 29 s, already in focus.
 */

/** The focal plane at rest, and the frame there: 5.1 units tall at z = -6 → half-angle tan 0.425. */
const FOCUS = 6;
const TAN_HALF = 2.55 / FOCUS;
const FOV = (2 * Math.atan(TAN_HALF) * 180) / Math.PI;
/**
 * The seed box: frame fractions (with a margin for the lean and the eddies)
 * and depth. The room is as deep behind the plane of focus as in front of
 * it, in 1/z (the measure the lens cares about), so the near field and the
 * far wall are equally soft at rest and the focus ring can reach either.
 */
const MARGIN = 1.12;
const Z_NEAR = 4.2;
const Z_FAR = 11;
const STILL_T = 29;

/**
 * The light: ivory (255, 240, 204) where the lamp falls, a cool silver
 * (186, 199, 232) in the far shade, a touch of champagne in the near field.
 * The tint is multiplied into the mote's light, so a bright speck under the
 * lamp carries the full warmth and a dim one stays near neutral.
 */
const LAMP = [1.0, 0.94, 0.8];
const SHADE = [0.73, 0.78, 0.91];
const CHAMPAGNE = [0.94, 0.86, 0.71];

/**
 * The current, the part the whole room shares, is nearly nothing: dust in
 * still air does not flow toward a light. A rise up the frame, integrated on
 * the CPU each frame from a rate that swells and relaxes over 97 s and a
 * lean that swings through zero over 131 s, at a tenth of a pixel a second
 * on average at the plane of focus (0.0009 units a second at full swell),
 * so that over minutes the dust does slowly circulate through the shafts of
 * light without ever reading as a conveyor.
 */
const DRIFT = 0.0009;
const driftRate = (t: number) => DRIFT * (0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 97));
const driftLean = (t: number) => 0.3 * Math.sin((2 * Math.PI * t) / 131);

/**
 * The air: sinusoids in the seed position, [direction, wavelength (units),
 * period (s), amplitude (units), phase] per term. The first set are the
 * swells: plane waves with a wavelength of the frame or more (5 to 11 units),
 * turning over two to four minutes, at well under a pixel a second, so the
 * room moves as one body only on the scale of minutes. The second set are
 * the eddies, where the motion lives: waves 260 to 700 px across at the
 * plane of focus, turning over 17 to 47 s, with the amplitudes set so that
 * a mote at the plane moves about a pixel and a third a second (the near
 * field half again that, the far wall half of it, by the perspective) in a
 * direction that differs from one region to the next, bends over ten
 * seconds, and now and then pauses when the terms cancel. The two smallest
 * terms take a phase of the mote's own (`ph` below, a full turn) and all of
 * them a gain of its own (within an eighth), so two neighbours drift
 * together but never trace the same hook: dust, not wallpaper. The own
 * terms are kept small on purpose (a pixel and a half) so neighbours do not
 * wander into each other's footprint.
 */
const FLOW: [number, number, number, number, number, number, number][] = [
  // x
  [0.71, 0.71, 0.0, 7.0, 173, 0.019, 1.3],
  [-0.3, 0.95, 0.0, 5.0, 127, 0.008, 4.0],
  [0.26, 0.53, 0.81, 11.0, 239, 0.022, 2.2],
  // y
  [0.95, 0.31, 0.0, 8.0, 197, 0.019, 0.7],
  [-0.6, 0.2, 0.77, 5.5, 113, 0.007, 5.1],
  [0.37, -0.93, 0.0, 6.5, 149, 0.014, 3.4],
  // z
  [0.5, 0.86, 0.0, 9.0, 181, 0.015, 0.2],
  [-0.85, 0.3, 0.43, 6.0, 139, 0.009, 2.9],
  [0.2, 0.6, -0.77, 5.0, 107, 0.007, 1.9],
];
const EDDIES: [number, number, number, number, number, number, number][] = [
  // x
  [0.6, 0.8, 0.0, 4.0, 47, 0.051, 0.4],
  [-0.5, 0.7, 0.5, 2.4, 29, 0.025, 2.6],
  [0.8, -0.3, 0.52, 1.7, 19, 0.0086, 1.1],
  // y
  [0.9, 0.3, 0.3, 3.6, 41, 0.044, 3.9],
  [-0.3, 0.9, 0.3, 2.1, 26, 0.022, 0.9],
  [0.5, 0.5, -0.7, 1.5, 17, 0.0077, 2.3],
];
const flowTerm = ([dx, dy, dz, lambda, period, amp, phase]: (typeof FLOW)[number], own = 0) => {
  const k = (2 * Math.PI) / lambda;
  const f = (n: number) => n.toFixed(5);
  const ownPhase = own ? ` + ph * ${f(own)}` : "";
  return `${f(amp)} * sin(dot(q, vec3(${f(dx * k)}, ${f(dy * k)}, ${f(dz * k)})) + t * ${f((2 * Math.PI) / period)} + ${f(phase)}${ownPhase})`;
};
const FLOW_GLSL = `vec3 flow(vec3 q, float t, float ph, float g) {
  return vec3(
    ${flowTerm(FLOW[0])} + ${flowTerm(FLOW[1])} + ${flowTerm(FLOW[2])}
      + g * (${flowTerm(EDDIES[0])} + ${flowTerm(EDDIES[1])} + ${flowTerm(EDDIES[2], 1.0)}),
    ${flowTerm(FLOW[3])} + ${flowTerm(FLOW[4])} + ${flowTerm(FLOW[5])}
      + g * (${flowTerm(EDDIES[3])} + ${flowTerm(EDDIES[4])} + ${flowTerm(EDDIES[5], 1.0)}),
    ${flowTerm(FLOW[6])} + ${flowTerm(FLOW[7])} + ${flowTerm(FLOW[8])});
}`;

/**
 * The lamp, shared by the dust and the room behind it, in screen space with
 * the x axis scaled by the aspect (so a unit is half the frame's height).
 * On a desktop it sits just past the upper-left corner; on a phone it is
 * past the left edge just under the top fifth, so the light has an obvious
 * side of its own and does not pour in from under the status bar. Its reach
 * (uReach, set on the CPU) is a little more than the distance to the far
 * corner, so `light` is 1 at the lamp and 0 by the far corner on any screen.
 */
const LAMP_GLSL = /* glsl */ `
  uniform vec2 uLamp;
  uniform float uReach;
  float lamp(vec2 s) {
    float d = clamp(distance(s, uLamp) / uReach, 0.0, 1.0);
    return pow(1.0 - d, 1.5);
  }
`;

const VERT = /* glsl */ `
  attribute vec2 corner;   // the quad: -1..1
  attribute vec3 aSeed;    // sx, sy (frame fractions), z0
  attribute vec4 aRnd;     // brightness, phase (twinkle and wander), twinkle rate (and the gain), the density draw
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uViewport;  // CSS px
  uniform float uDpr;
  uniform float uFocus;    // the plane of focus, units from the eye
  uniform float uK;        // the blur: CSS px of sigma per unit of |1/z - 1/zf|
  uniform float uCap;      // the widest a mote may draw, CSS px
  uniform float uBright;   // the brightest mote's light, in focus at the plane
  uniform float uExposure;
  uniform vec2 uDrift;     // the current so far, units at the plane of focus (x right, y up)
  uniform float uTopDim;   // how much the top fifth is dimmed (a phone's status bar)
  uniform float uLane;     // a phone's one shaft across the lower third
  uniform vec2 uMark;      // the lockup's half-footprint in NDC, with a little air
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSigma;    // the dot's Gaussian sigma, CSS px
  varying float vReach;    // the quad's half-width, CSS px
  varying float vEdge;     // the Gaussian's value where the dot is cut to nothing
  varying vec2 vUv;
  const float TAN_HALF = ${TAN_HALF.toFixed(5)};
  const float MARGIN = ${MARGIN.toFixed(2)};
  const float FOCUS = ${FOCUS.toFixed(1)};
  const vec3 LAMP = vec3(${LAMP.join(", ")});
  const vec3 SHADE = vec3(${SHADE.join(", ")});
  const vec3 CHAMPAGNE = vec3(${CHAMPAGNE.join(", ")});
  ${FLOW_GLSL}
  ${LAMP_GLSL}
  void main() {
    vUv = corner;
    // Seeded as frame fractions at a depth, so every screen is full. The current and the air are
    // one displacement for the whole room (units), so the near field crosses the frame faster
    // than the far wall, by the perspective; a mote wraps at the margin.
    float z0 = aSeed.z;
    float hh = TAN_HALF * -z0;
    vec3 q0 = vec3(aSeed.x * hh * uAspect, aSeed.y * hh, z0);
    float sy = mod(aSeed.y + MARGIN + uDrift.y / hh, 2.0 * MARGIN) - MARGIN;
    float sx = mod(aSeed.x + MARGIN + uDrift.x / (hh * uAspect), 2.0 * MARGIN) - MARGIN;
    float gain = mix(0.88, 1.12, (6.28318 / aRnd.z - 6.0) * 0.1);
    vec3 p = vec3(sx * hh * uAspect, sy * hh, z0) + flow(q0, uTime, aRnd.y, gain);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 ndc = clip.xy / clip.w;
    float zc = -mv.z;
    // The lens: a mote is a Gaussian point; in the plane of focus its sigma is a little over half
    // a pixel (never under 0.8 device px, so it does not blink as it crosses pixel centres), and
    // off the plane the lens adds uK px of sigma per unit of 1/z, in quadrature. The room is
    // seeded evenly in 1/z, so the softness is a continuum weighted toward the plane: a quarter
    // of the motes a speck, most a soft dot, the ends a breath. The sigma drawn stops at two
    // fifths of the cap and the dot is cut to nothing at half the cap, so the footprint never
    // passes uCap: a mote goes soft, not wide, and the softest is a round bump three pixels across.
    float sigma0 = max(mix(0.55, 0.7, aRnd.x), 0.8 / uDpr);
    float blur = abs(1.0 / zc - 1.0 / uFocus) * uK;
    float sigmaFull = sqrt(sigma0 * sigma0 + blur * blur);
    float sigma = min(sigmaFull, uCap * 0.4);
    float cut = min(sigma * 2.5, uCap * 0.5);
    // A point keeps its light as the lens spreads it, so its peak falls with the square of its
    // sigma, the full one: a mote just off the plane is a soft dot nearly as bright as a speck,
    // one at twice the speck's sigma a quarter as bright, one at four times a sixteenth (the light
    // that would have spread past the cap is lost, not piled up: nothing brightens as it softens).
    // Light falls off with distance too, so at the same softness a near mote is brighter than a
    // far one (half again at the near end, half at the far wall): the far wall is the faint soft
    // layer and the near field the bright one, which is also the order of their speeds. The motes
    // are not all alike: most are faint and a few are bright, as stars are.
    float ratio = sigmaFull / sigma0;
    float spread = mix(0.4, 1.0, pow(aRnd.x, 2.2));
    float lit = uBright * spread * (FOCUS / zc) / (ratio * ratio);
    // The lamp: where it falls the dust is lit in full and dense; in the shade it is dim and
    // sparse. Density is a draw per mote against a beam that is 1 under the lamp, about half at
    // the middle of the frame and a fifth in the far corner, a third thinner again at the floor
    // (the lamp is high), shaped into slow shafts a few hundred pixels across, three to one
    // between a shaft and the void beside it, that turn over minutes, so the dust drifts through
    // fixed light and a mote comes and goes as it crosses a shaft; on a phone one more shaft
    // crosses the lower third from the left edge, so the floor is not dead. It thins once more in
    // a wide ellipse around the mark, set a little above the mark's centre because the lamp lights
    // the band above the letters more than the band below, so the letters sit in their own quiet
    // with as much dust over them as under. On a phone the top fifth holds half as many, under
    // the status bar.
    vec2 s = vec2(ndc.x * uAspect, ndc.y);
    float light = lamp(s);
    float lane = uLane * exp(-pow((s.y + 0.5 + 0.54 * s.x) / 0.09, 2.0));
    float wash = mix(0.45, 1.0, light) + 0.25 * lane;
    float beam = 0.18 + 0.82 * smoothstep(0.0, 0.65, light);
    float floorward = mix(0.65, 1.0, smoothstep(-1.0, 0.5, s.y));
    float lanes = 0.65 + 0.35 * (0.5 * sin(dot(s, vec2(6.2, 4.6)) + uTime * 0.016)
                               + 0.35 * sin(dot(s, vec2(-3.4, 5.9)) + uTime * 0.021 + 2.0)
                               + 0.15 * sin(dot(s, vec2(8.9, -2.3)) + uTime * 0.013 + 4.1));
    float eMark = length(ndc / uMark);
    float ePool = length((ndc - vec2(0.0, 0.08)) / uMark);
    float near = 1.0 - smoothstep(0.6, 2.0, ePool);
    float topBand = smoothstep(0.6, 1.0, ndc.y);
    float density = beam * floorward * lanes * (1.0 + 1.2 * lane) * (1.0 - 0.6 * near) * (1.0 - 2.0 * uTopDim * topBand);
    float keep = 1.0 - smoothstep(density - 0.08, density + 0.08, aRnd.w);
    // Scintillation: a mote in the plane wavers a little in the air.
    float twinkle = mix(0.9, 1.0, 0.5 + 0.5 * sin(uTime * aRnd.z + aRnd.y));
    // Over the mark the dust is a third as bright, in an ellipse with no corners to resolve, so
    // the letters always read, and within about ninety pixels of the lockup nothing draws past
    // 0.3 of white, so no speck sits at the letters' shoulder; on a phone the top fifth is a
    // quarter dimmer still, under the status bar. The brightest speck anywhere draws at 0.52 of
    // white (133/255): bright enough to be a pinhead of light, far enough under the ivory mark
    // that the mark is always the brightest thing on the page.
    float overMark = 1.0 - smoothstep(0.85, 1.5, eMark);
    float top = 1.0 - uTopDim * topBand;
    float ceiling = mix(0.3, 0.52, smoothstep(1.6, 2.4, eMark));
    float alpha = min(lit * wash * twinkle * uExposure * keep * (1.0 - 0.65 * overMark) * top, ceiling);
    float reach = cut + 0.5;
    bool off = abs(ndc.x) > 1.0 + reach / uViewport.x * 2.0 || abs(ndc.y) > 1.0 + reach / uViewport.y * 2.0;
    if (alpha < 0.004 || off) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // The light has a temperature: ivory under the lamp, neutral by the middle of the frame,
    // silver in the far corner, and the near field warms toward champagne, each mote its own
    // shade.
    float depth = smoothstep(2.5, 12.0, zc);
    float tint = fract(aRnd.y * 0.31831);
    vec3 col = mix(SHADE, LAMP, smoothstep(0.0, 0.55, light));
    col = mix(col, CHAMPAGNE, 0.3 * tint * (1.0 - depth));
    vColor = col;
    vAlpha = alpha;
    vSigma = sigma;
    vReach = reach;
    float c = cut / sigma;
    vEdge = exp(-0.5 * c * c);
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
  varying float vEdge;
  varying vec2 vUv;
  void main() {
    // A round Gaussian point, taken to zero at the cut (two and a half sigma for a speck or a
    // soft dot, closer in for the softest, which is a round bump within the cap) so the quad
    // has no edge: a speck is a pinhead with a half-pixel soft rim, a soft mote the same shape,
    // wider and dimmer.
    float r = length(vUv) * vReach / vSigma;
    float a = max(exp(-0.5 * r * r) - vEdge, 0.0) / (1.0 - vEdge);
    // Additive blending multiplies by the alpha below (SRC_ALPHA, ONE): the colour is not premultiplied.
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

/**
 * The room behind the dust: not black, a dusk with a trace of blue in it,
 * (9, 9, 12) in the shade. Under the lamp the air is warmed, barely: the
 * blue is taken out and a little red put in, so the corner under the lamp
 * sits near 12/255 with red over blue (about (12, 11, 10) in the corner,
 * (14, 12, 10) at the lamp itself), lit by the same light as the dust, and
 * the beam reads as lit motes in faintly warm air, not a wash. The mean
 * stays dark and the mark always reads.
 */
const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAspect;
  uniform float uExposure;
  ${LAMP_GLSL}
  void main() {
    vec2 s = vec2(vUv.x * uAspect, vUv.y);
    float warm = lamp(s);
    vec3 col = vec3(0.034, 0.036, 0.048) * mix(vec3(1.0), vec3(1.6, 1.32, 0.8), warm);
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

/**
 * The entrance: the mark's bloom (app.css "door-bloom") starts 0.4 s after
 * door-ready and lands at about 1.9 s. The dust fades up out of the dark on
 * the same clock, a smooth step over 1.6 s from the same 0.4 s, slower to
 * start than the mark's curve, so the first thing seen is darkness that fills
 * with dust, half there at 1.4 s and home as the O lands; the lens pulls its
 * plane in from 1.4 units beyond rest over the same step, and the room
 * behind rises from half its dusk to the whole of it.
 */
const ENTRANCE = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const ENTRANCE_S = 1.6;
const ENTRANCE_DELAY = 0.4;

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
      // 11,000 on a phone; the lamp and the lens decide which of them show. They are placed by dart
      // throwing on a hash grid so that no two motes land within seven CSS px of each other on
      // screen (five on a phone) unless they are far apart in depth (more than two fifths of the
      // room in 1/z, where one of the pair is a breath and the other a speck, and they move at
      // different speeds anyway): a Poisson disc in x, y and 1/z. Dust lands where it falls, but
      // two motes a pinhead apart draw as one blob with a waist, and that reads as a flaw. Each
      // mote gets eight tries and takes the best; once at start, about 20 ms. ──
      let w = window.innerWidth;
      let h = window.innerHeight;
      const count = phone ? 11000 : 36000;
      const seed = new Float32Array(count * 3);
      const rnd = new Float32Array(count * 4);
      let seedN = 11;
      const r = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      const SPACING = phone ? 5 : 7;
      const DEPTH_BAND = 0.42;
      const TRIES = 8;
      const rx = SPACING / (w / 2);
      const ry = SPACING / (h / 2);
      const nx = Math.ceil((2 * MARGIN) / rx);
      const ny = Math.ceil((2 * MARGIN) / ry);
      const nz = Math.ceil(1 / DEPTH_BAND);
      const head = new Int32Array(nx * ny * nz).fill(-1);
      const next = new Int32Array(count);
      const px = new Float32Array(count);
      const py = new Float32Array(count);
      const pu = new Float32Array(count);
      const cellOf = (x: number, y: number, u: number) => {
        const cx = Math.min(nx - 1, Math.floor((x + MARGIN) / rx));
        const cy = Math.min(ny - 1, Math.floor((y + MARGIN) / ry));
        const cz = Math.min(nz - 1, Math.floor(u / DEPTH_BAND));
        return [cx, cy, cz];
      };
      for (let i = 0; i < count; i++) {
        let bx = 0;
        let by = 0;
        let bu = 0;
        let best = -1;
        for (let k = 0; k < TRIES && best < 1; k++) {
          const x = (r() * 2 - 1) * MARGIN;
          const y = (r() * 2 - 1) * MARGIN;
          const u = r();
          const [cx, cy, cz] = cellOf(x, y, u);
          let d = Infinity;
          for (let az = Math.max(0, cz - 1); az <= Math.min(nz - 1, cz + 1); az++) {
            for (let ay = Math.max(0, cy - 1); ay <= Math.min(ny - 1, cy + 1); ay++) {
              for (let ax = Math.max(0, cx - 1); ax <= Math.min(nx - 1, cx + 1); ax++) {
                for (let j = head[(az * ny + ay) * nx + ax]; j >= 0; j = next[j]) {
                  const dx = (px[j] - x) / rx;
                  const dy = (py[j] - y) / ry;
                  const du = (pu[j] - u) / DEPTH_BAND;
                  const dd = dx * dx + dy * dy + du * du;
                  if (dd < d) d = dd;
                }
              }
            }
          }
          if (d > best) {
            best = d;
            bx = x;
            by = y;
            bu = u;
          }
        }
        px[i] = bx;
        py[i] = by;
        pu[i] = bu;
        const [cx, cy, cz] = cellOf(bx, by, bu);
        const cell = (cz * ny + cy) * nx + cx;
        next[i] = head[cell];
        head[cell] = i;
        seed[i * 3] = bx;
        seed[i * 3 + 1] = by;
        seed[i * 3 + 2] = -1 / (1 / Z_NEAR + bu * (1 / Z_FAR - 1 / Z_NEAR));
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
      const uLamp = new THREE.Vector2();
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
          // f/1, but tiny: 28 px of sigma per unit of 1/z. With the room even in 1/z that puts
          // about a quarter of the motes within a sigma of a speck (the plane of focus is a
          // fortieth of the room deep: a mote is sharp for a few seconds as the focus sweeps
          // past it), a fifth as soft dots at two to three pixels, and more than half softer
          // than that, out to a breath near the cap at the ends of the room, each fainter the
          // further it is from the plane. Nothing ever draws past six pixels (four and a half
          // on a phone).
          uK: { value: 28 },
          uCap: { value: phone ? 4.5 : 6 },
          // The brightest motes in the plane draw at half of white (the lens clips them at
          // 0.52, so the soft dust either side of the plane keeps up): a speck under the lamp
          // peaks near 50/255 as a rule and a few pass 110; a soft dot at twice the speck's
          // sigma peaks at a quarter of that, and only a speck ever passes 100.
          uBright: { value: 0.55 },
          uExposure: { value: 1 },
          uDrift: { value: uDrift },
          uTopDim: { value: phone ? 0.25 : 0 },
          uLane: { value: phone ? 1 : 0 },
          uMark: { value: uMark },
          uLamp: { value: uLamp },
          uReach: { value: 1 },
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
      const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, depthTest: false, uniforms: { uAspect: { value: w / h }, uExposure: { value: 1 }, uLamp: { value: uLamp }, uReach: { value: 1 } } });
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
        // The lamp, in screen units (x scaled by the aspect): past the upper-left corner on a
        // desktop, past the left edge just under the top fifth on a phone, so the band just
        // above the mark is the brightest and the status bar is not. Its reach is the distance
        // to the far corner and a little more (a sixth more on a phone, whose far corner is
        // close), so the far corner is in the shade on any screen.
        if (phone) uLamp.set(-w / h - 0.45, 0.56);
        else uLamp.set(-w / h - 0.6, 1.35);
        const reach = Math.hypot(w / h - uLamp.x, -1 - uLamp.y) * (phone ? 1.15 : 1.05);
        mat.uniforms.uReach.value = reach;
        skyMat.uniforms.uReach.value = reach;
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
        // from four and a half units to seven and a half (nearly to the near end, a third of the
        // way to the far wall in 1/z) and never repeats itself. The entrance starts with the focus
        // 1.4 units beyond rest (everything soft) and the dust dark, and brings both home on the
        // step above, so the lens finds its plane as the O lands.
        const focus = FOCUS + 1.05 * Math.sin((2 * Math.PI * t) / 151) + 0.45 * Math.sin((2 * Math.PI * t) / 67 + 1.7);
        mat.uniforms.uFocus.value = focus + 1.4 * (1 - entrance);
        const breath = 1 + 0.04 * Math.sin((2 * Math.PI * t) / 41);
        mat.uniforms.uExposure.value = breath * entrance;
        skyMat.uniforms.uExposure.value = breath * (0.5 + 0.5 * entrance);
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
        // The current keeps wall-clock time through a slow frame or a stall, up to half a second
        // (which moves the near field a pixel: nothing jumps); past that it waits.
        const dt = Math.min(0.5, (now - last) / 1000);
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
