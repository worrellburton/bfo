import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The glitter path: moonlight on a black sea. Seen from seven metres up, the
 * water fills the lower two fifths of the frame, from twenty-four metres at
 * the bottom edge to five hundred at the horizon; above it, ink. The moon is
 * never drawn: it sits twelve degrees above the horizon and a little left of
 * centre, and all that shows is what reflects it, a path of glints running
 * from a thin gold sheen at the horizon, left of the mark, down to a broad
 * pool at the bottom. Nothing travels: a hundred and fifty thousand facets of
 * water ride six slow Gerstner waves (two swells, four kinds of chop that
 * breathe over forty-seven seconds), and each one lights up for a few seconds
 * as its normal passes the half-vector between the moon and the eye, then
 * goes dark again. The brightness is a specular lobe on the analytic wave
 * normal, the colour a ramp from deep gold through gold and champagne to
 * ivory by that lobe, the whole faded with distance like air. Each facet is
 * drawn as a soft ellipse, wider than it is tall, as a patch of sea is seen
 * from a low eye, and the strongest near glints spread sideways into short
 * dashes that keep their light: light on water is horizontal. Far away,
 * where a pixel covers many metres of sea, the chop is averaged out and the
 * alpha is normalised by how many facets share a pixel, so the far water is
 * a sheen that only shimmers and never twinkles, and the path converges to a
 * thin line where the glints stop.
 *
 * The same buffer is drawn twice: a glow pass adds each facet's light up to
 * a fourteenth of white, so the crowded path glows, and a glint pass lays the
 * brightest facets' excess over it as a maximum rather than a sum, so three
 * glints landing on one pixel are one glint and nothing ever reaches white.
 * Facets that are dark, edge-on or hidden behind a crest cost nothing: the
 * shader culls them.
 *
 * The sea is seeded once, over a field wider than any window of its
 * orientation, so a resize changes the camera and nothing else. The pointer
 * yaws the camera two degrees and raises the eye a hand's width. Phones get
 * fewer facets and a lower pixel ratio. Reduced motion draws one frame.
 * Without WebGL (or if three.js fails to load) the canvas stays a deep blue
 * and the page still reads.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** The eye's height above the water, in metres. */
const EYE = 7;
/** The frame's bottom edge meets the water here. */
const NEAR = 24;
/** The glints stop here: the horizon as seen. */
const FAR = 500;
/** Facets are seeded a little nearer than the frame, so a crest at the bottom edge, or a lowered eye, never shows the field's end. */
const DMIN = 20.5;
/**
 * Depth is drawn as pow(u, DEPTH): with 3.2, 46% of the facets lie within sixty metres (the pool) and 43% beyond a
 * hundred (the design's "40% beyond 100 m"), so the pool is dense enough to glow and the path still converges.
 */
const DEPTH = 3.2;
/**
 * The specular lobe's exponent at the eye, divided by (1 + d / 80 m) so sub-pixel far facets become a sheen. The design
 * says 600 and to lower it if the near glints pop; at 120 a good part of the pool is lit at once, at modest peaks, and
 * it reads as water rather than as sparks.
 */
const LOBE = 120;
/** The lens is focused on the pool, at the moon's mirror point; beyond it facets blur a little, in CSS px per (1/m). */
const FOCUS = 33;
const COC = 60;
/**
 * A facet's light up to GLOW is added (the glow); what it has beyond, up to CAP, is laid over as a maximum (the glint).
 * Facets are seeded at random, so a few sit five or seven to a cell of a hand's breadth, and when a swell lights such a
 * cell its sprites stack: the glow share is small enough that the deepest stack plus one glint stays well under white.
 */
const GLOW = 0.07;
const CAP = 0.36;
/** The clock is pre-rolled; the reduced-motion still is this frame too. */
const START = 30;

/**
 * The six waves. Direction is degrees from the view axis (positive to the right; within 90 degrees the wave comes toward
 * the eye). Wavelength, period, amplitude and horizontal displacement (Q times A) in metres and seconds. The swells are
 * slowed a third from the design's periods (the nearest crest then drifts under 4% of the frame height a second, and a
 * glint lives seven seconds or more), the chop five to seven times: at the design's chop a facet's slope swings seventeen
 * degrees a second and the path sparkles, and at four times slower one glint in fifty still comes up inside a second.
 * The swells' Q holds their orbital sway to 0.3 m; the chop's Q is 0.1 of its slope, a
 * slight sharpening of crests (at 0.2 the four chops' crests coinciding all but flatten the normal's rise, and the
 * facet's tilt swings fast enough to blink). The two cross-chops, whose crests run only twenty-odd degrees off the
 * view axis, are shorter than a metre: at 1.7 m their crests, forty to sixty px apart on screen in the pool, showed
 * as a diagonal rake across it; under a metre they fall within a few sprite widths and are texture, not rows. Their
 * slopes (six degrees) and slope rates (about two degrees a second) are what they were.
 */
const WAVES = [
  { dir: 15, len: 52, period: 24, amp: 0.6, q: 0.5 },
  { dir: -20, len: 30, period: 16, amp: 0.35, q: 0.857 },
  { dir: 38, len: 5.5, period: 25, amp: 0.08, q: 1.1 },
  { dir: -47, len: 3.2, period: 20, amp: 0.06, q: 0.85 },
  { dir: 112, len: 0.9, period: 20, amp: 0.015, q: 0.9 },
  { dir: -131, len: 0.6, period: 17.5, amp: 0.01, q: 0.875 },
];

const VERT = /* glsl */ `
  // position is not a position: x is the facet's place across the field (-1 to 1 of the trapezoid's half-width),
  // y its distance from the eye in metres, z a seed. The shader builds the sea from these every frame.
  uniform float uHalf; // the field's half-width per metre of distance (wider than the frustum; set once)
  uniform float uChop; // the chop's breathing: 0.2 to 1 of its amplitude
  uniform vec4 uWave[6]; // direction x, direction z, wavenumber k, amplitude A
  uniform vec2 uWave2[6]; // steepness Q, phase (omega t, wrapped)
  uniform vec3 uLight; // toward the moon
  uniform vec3 uEye; // the camera, in metres
  uniform float uPixel; // device px per CSS px
  uniform float uCover; // facets per CSS px squared at the horizon, before the depth weighting
  uniform float uAlpha;
  uniform float uPass; // 0: the glow, added; 1: the glints, a maximum
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch; // the sprite's width over its height
  const float DMIN = ${DMIN.toFixed(1)};
  const float DSPAN = ${(FAR - DMIN).toFixed(1)};
  const float GLOW = ${GLOW.toFixed(2)};
  const float CAP = ${CAP.toFixed(2)};
  const vec3 IVORY = vec3(0.957, 0.929, 0.878);
  const vec3 CHAMPAGNE = vec3(0.914, 0.843, 0.659);
  const vec3 GOLD = vec3(0.847, 0.710, 0.416);
  const vec3 DEEP = vec3(0.655, 0.486, 0.196);
  const vec3 INK = vec3(0.0196, 0.0235, 0.0431); // the clear colour, #05060b
  void main() {
    float d = position.y;
    float seed = position.z;
    float w = clamp((d - DMIN) / DSPAN, 0.0001, 1.0);
    vec2 rest = vec2(position.x * (d * uHalf + 1.0), -d);
    vec3 p = vec3(rest.x, 0.0, rest.y);
    vec3 n = vec3(0.0, 1.0, 0.0);
    // Facet averaging: a pixel at three hundred metres covers ten metres of water, many waves of chop, and the light
    // of all those facets sums to a smooth sheen. The chop's slope is damped with distance; the long swells later.
    float dampChop = 1.0 / (1.0 + (d / 120.0) * (d / 120.0));
    float dampSwell = 1.0 / (1.0 + (d / 350.0) * (d / 350.0));
    for (int i = 0; i < 6; i++) {
      vec4 wv = uWave[i];
      vec2 qp = uWave2[i];
      float A = wv.w * (i < 2 ? 1.0 : uChop);
      float damp = i < 2 ? dampSwell : dampChop;
      float ph = wv.z * dot(wv.xy, rest) - qp.y;
      float c = cos(ph);
      float s = sin(ph);
      float kA = wv.z * A;
      // Gerstner: the facet circles its rest position; the normal is the analytic derivative.
      p.xz += wv.xy * (qp.x * A * c);
      p.y += A * s;
      n.xz -= wv.xy * (kA * c * damp);
      n.y -= qp.x * kA * s * damp;
    }
    n = normalize(n);
    vec3 V = normalize(uEye - p);
    vec3 H = normalize(uLight + V);
    float nh = max(dot(n, H), 0.0001);
    // Two lobes: a narrow one that widens with distance (the sheen), and a broad dim one (the path's deep-gold fringe).
    // The widening stands for the facets a far pixel averages, and an average spreads light rather than making it:
    // the sheen is dimmed by the widening, which leaves the horizon a thin line and the pool the one bright thing.
    float widen = 1.0 + d / 80.0;
    float lobe = ${LOBE.toFixed(1)} / widen;
    float I = pow(nh, lobe) + 0.12 * pow(nh, 24.0);
    float amp = 1.0 / widen;
    // A facet's light reaches the eye in proportion to its area as seen from there. The crowding below assumes the
    // sea is flat; a swell's near flank, turned toward the eye, is seen fuller than that and its facets are spread
    // on screen, while beyond fifty metres the far flank, steeper than the view is low, is seen edge-on or from
    // behind, and its facets would pile onto one line of pixels. So each facet's light is scaled by its area as
    // seen against the flat sea's: the edge-on and hidden flanks go dark, as they are.
    float proj = clamp(dot(n, V) / max(V.y, 0.02), 0.0, 6.0);
    // Size: a mote of 3.5 CSS px near to 1.2 at the horizon, the full width at half maximum of a Gaussian (sigma a
    // 2.35th of it, never under 0.6 px, so a facet's light is spread the same wherever it lands on the pixel grid).
    // Beyond the pool, the lens's circle of confusion adds to every facet in quadrature, so the crowded mid water
    // fuses into a shimmer instead of grain.
    float s0 = mix(3.5, 1.2, sqrt(w)) * (0.85 + 0.3 * seed);
    float coc = ${COC.toFixed(1)} * abs(1.0 / ${FOCUS.toFixed(1)} - 1.0 / d);
    float f0 = max(0.6, s0 / 2.35);
    float sigma = min(1.7, sqrt(f0 * f0 + coc * coc));
    // A patch of sea is seen foreshortened from a low eye: as wide as it is, and only sin(dip) as tall (3.6 times
    // wider than tall at the bottom edge, 4.8 at the mirror point), so every sprite is an ellipse of the same area as
    // the disc above, wider than tall: 2.5 to 1 in the pool (capped there for the fragments it costs), easing to 1.5
    // beyond it, where the facets are sub-pixel and the lens's blur, which is round, is most of the sprite. Its
    // horizontal sigma is sigma sqrt(sx) and its vertical sigma / sqrt(sx): a 5.5 by 2.2 px dash at the bottom edge.
    float sx = mix(2.5, 1.5, smoothstep(40.0, 150.0, d));
    // The strongest near glints spread sideways, and only sideways, into dashes up to 1.65 times their width (a facet
    // lit at the lobe's centre mirrors the whole moon, which is not a point); their light is spread over that extra
    // width (alpha over growX, below), so a glint's centre never dims as it blooms: I / growX rises with I. Far
    // glints never grow.
    float near = 1.0 - smoothstep(60.0, 160.0, d);
    float growX = pow(max(I / 0.6, 1.0), 0.8 * near);
    // How many facets share this facet's pixel (the depth weighting is pow(u, 3.2), the projection d cubed). Each
    // facet's light is its share of the pixel's: where facets crowd, from the pool outward, a pixel sums to what the
    // shading says and no brighter, and where they are sparse each glint is a bright point on its own. The floor
    // (0.5, under the pool's crowding on a laptop) keeps the nearest glints from running away on a very tall window.
    float cover = uCover * pow(w, ${(1 / DEPTH - 1).toFixed(4)}) * d * d * 6.2832 * sigma * sigma;
    // The air takes some with distance; the field's far end fades out over its last seventy metres.
    float fade = exp(-d / 380.0) * (1.0 - smoothstep(DMIN + DSPAN - 70.0, DMIN + DSPAN, d));
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    // No single glint passes CAP. Inside the mark's box (60% wide, 35% tall, its edge softened over a few percent of
    // the frame just outside it) the cap is 0.03 and the added share 0.012: the far sheen, whose facets are dimmer
    // than that anyway, passes untouched, and the mid water's glints, which crowd several to a pixel under the box's
    // lower edge, can no longer stack past a sixth of white.
    vec2 e = abs(clip.xy / clip.w);
    float inBox = (1.0 - smoothstep(0.60, 0.66, e.x)) * (1.0 - smoothstep(0.35, 0.39, e.y));
    float cap = mix(CAP, 0.03, inBox);
    float share = mix(GLOW, 0.012, inBox);
    float a = min(cap, uAlpha * I * proj * amp * fade / (max(0.5, cover) * growX));
    // Colour by the lobe, as the design says: deep gold at 0.05, gold at 0.3, champagne at 0.7, and ivory only at the
    // lobe's own maximum (1.12: a mirror-exact facet), since ivory over the ink is grey unless it is the brightest
    // thing in the frame. Guarded by the light the facet actually puts on the screen: a far or soft facet is dim, and
    // dim light over ink is gold, never grey.
    float b = min(I, a / 0.15);
    vec3 col = mix(DEEP, GOLD, clamp((b - 0.05) / 0.25, 0.0, 1.0));
    col = mix(col, CHAMPAGNE, clamp((b - 0.3) / 0.4, 0.0, 1.0));
    col = mix(col, IVORY, clamp((b - 0.85) / 0.27, 0.0, 1.0));
    // The ink is a deep blue, and warm light added to it reads grey unless the blue is paid for: the sprite is warmed
    // so that what lands on the screen, light plus ink, lies on the ramp (exactly for a glint of 0.15 or more, in part
    // for a dimmer one), and never below black.
    vColor = max(col + (0.024 * col - INK) / max(a, 0.15), 0.0);
    // The glow pass adds a facet's light up to its share; the glint pass lays what it has beyond that over the glow as
    // a maximum. A facet with nothing to draw in this pass is put outside the clip volume and costs no fragments.
    vAlpha = uPass < 0.5 ? min(a, share) : max(a - share, 0.0);
    // The sprite is a square five horizontal sigma wide; the fragment shader shapes the ellipse inside it.
    vStretch = sx * growX;
    gl_PointSize = 5.0 * sigma * sqrt(sx) * growX * uPixel;
    gl_Position = vAlpha < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  }
`;
const FRAG = /* glsl */ `
  uniform float uPass;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStretch;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    // The sprite is five horizontal sigma wide, so across it the Gaussian is exp(-(q 5 sigma)^2 / 2 sigma^2) =
    // exp(-12.5 q^2); its vertical sigma is smaller by the stretch, so down it the exponent carries the stretch
    // squared: an ellipse, wider than tall.
    float a = exp(-12.5 * (q.x * q.x + q.y * q.y * vStretch * vStretch)) * vAlpha;
    // The glow is added (SRC_ALPHA, ONE), so the colour goes out straight; the glints are a maximum, which ignores the
    // blend factors, so their colour goes out multiplied.
    gl_FragColor = uPass < 0.5 ? vec4(vColor, a) : vec4(vColor * a, 1.0);
  }
`;

export default function GlitterPath({ still }: BackdropProps) {
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
      const camera = new THREE.PerspectiveCamera(37, 1, 1, 1500);
      // Pitch about the camera's own axis, then yaw about the world's: the horizon stays level under the pointer.
      camera.rotation.order = "YXZ";

      // ── The facets: one buffer, placed by the shader, drawn twice ──
      // Distance is stratified in u and drawn as pow(u, 3.2), so the field is dense near and converges at the horizon
      // without rows; the place across the field is random. No two facets share a line. The field is wider than the
      // window (see size), so a share of the facets is off-screen in a narrow one, and most of the rest are dark at
      // any moment and culled by the shader, so the count can be high.
      const count = phone ? 40000 : 150000;
      const pos = new Float32Array(count * 3);
      let seedN = 11;
      const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < count; i++) {
        const u = (i + rnd()) / count;
        pos[i * 3] = rnd() * 2 - 1;
        pos[i * 3 + 1] = DMIN + (FAR - DMIN) * Math.pow(u, DEPTH);
        pos[i * 3 + 2] = rnd();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      // Both passes share every uniform's value object, so the frame loop sets each once.
      const shared = {
        uHalf: { value: 1 },
        uChop: { value: 1 },
        uWave: { value: WAVES.map((W) => new THREE.Vector4(Math.sin(W.dir * DEG), Math.cos(W.dir * DEG), TAU / W.len, W.amp)) },
        uWave2: { value: WAVES.map((W) => new THREE.Vector2(W.q, 0)) },
        uLight: { value: new THREE.Vector3(0, 1, 0) },
        uEye: { value: new THREE.Vector3(0, EYE, 0) },
        uPixel: { value: renderer.getPixelRatio() },
        uCover: { value: 0 },
        // The path's light: a pixel in the pool sums to about a seventh of white where every facet is lit, the far
        // sheen to a tenth where the path meets the horizon; a single glint peaks at CAP.
        uAlpha: { value: 0.7 },
      };
      const glowMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { ...shared, uPass: { value: 0 } },
      });
      // The glints: a maximum, so what lands on a pixel is its brightest glint, not the sum of them.
      const glintMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        uniforms: { ...shared, uPass: { value: 1 } },
      });
      const glints = new THREE.Points(geo, glintMat);
      glints.frustumCulled = false;
      glints.renderOrder = 0;
      scene.add(glints);
      const glow = new THREE.Points(geo, glowMat);
      glow.frustumCulled = false;
      glow.renderOrder = 1;
      scene.add(glow);

      // ── The camera, the pointer, the frames ──
      let w = 1;
      let h = 1;
      let pitch = 0;
      // The field's half-width is set once per orientation, for the widest window of that orientation (a 2.1:1
      // landscape, a 3:4 portrait), and kept: a resize then moves the camera's edges over a sea that stays where it
      // was, and no facet's wave phase changes. Only a flip between portrait and landscape re-seeds the sea.
      let seededPortrait: boolean | null = null;
      let halfWidth = 1;
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        const portrait = w < h;
        // The horizon, as seen, is where the glints stop: the far edge of the field sits at this fraction of the height
        // and the near edge at the bottom. Two conditions, two unknowns: the pitch (up, a little) and the field of view.
        const horizon = portrait ? 0.55 : 0.58;
        const k = 2 * horizon - 1;
        const dipNear = Math.atan(EYE / NEAR);
        const dipFar = Math.atan(EYE / FAR);
        let lo = 0;
        let hi = 0.3;
        for (let i = 0; i < 40; i++) {
          const m = (lo + hi) / 2;
          if (Math.tan(dipFar + m) - k * Math.tan(dipNear + m) < 0) lo = m;
          else hi = m;
        }
        pitch = (lo + hi) / 2;
        const half = dipNear + pitch;
        camera.fov = (2 * half) / DEG;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const tanHalf = Math.tan(half);
        const focalPx = h / 2 / tanHalf;
        if (seededPortrait !== portrait) {
          seededPortrait = portrait;
          halfWidth = Math.max(camera.aspect, portrait ? 0.75 : 2.1) * tanHalf * 1.1;
          shared.uHalf.value = halfWidth;
        }
        shared.uCover.value = count / (2 * EYE * (FAR - DMIN) * DEPTH * halfWidth * focalPx * focalPx);
        // The moon: twelve degrees up, eight degrees left of centre (two and a half in portrait, where the frame is narrow).
        const az = (portrait ? 2.5 : 8) * DEG;
        const el = 12 * DEG;
        shared.uLight.value.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const phases = shared.uWave2.value;
      const place = (t: number, dt: number) => {
        // The lean eases toward the pointer (tau 1.5 s: 63% of the way at 1.5 s, 90% at 3.5 s), whatever the frame rate.
        const e = 1 - Math.exp(-dt / 1.5);
        lx += (tx - lx) * e;
        ly += (ty - ly) * e;
        camera.rotation.set(pitch, -lx * 2 * DEG, 0);
        camera.position.set(0, EYE - ly * 0.3, 0);
        shared.uEye.value.copy(camera.position);
        // The chop breathes over 47 s, a fifth to all of its amplitude; phased so the still, and the first frame, catch it
        // nearly full, the path at its widest.
        shared.uChop.value = 0.6 + 0.4 * Math.sin((TAU * (t - START)) / 47 + 1.0);
        // Each wave's phase is wrapped here, so the shader's sines stay precise however long the page is open.
        WAVES.forEach((W, i) => {
          phases[i].y = ((TAU / W.period) * t) % TAU;
        });
        renderer.render(scene, camera);
      };
      size();
      const dispose = () => {
        geo.dispose();
        glowMat.dispose();
        glintMat.dispose();
        renderer.dispose();
      };
      if (still) {
        place(START, 0);
        const onResize = () => {
          size();
          place(START, 0);
        };
        window.addEventListener("resize", onResize);
        cleanup = () => {
          window.removeEventListener("resize", onResize);
          dispose();
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
        dispose();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [still]);
  return <canvas ref={ref} aria-hidden className={`door-sky ${failed ? "door-sky-flat" : ""}`} />;
}
