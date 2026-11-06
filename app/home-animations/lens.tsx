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
 * as the lens spreads it, the peak falls with the square of the softness,
 * with nothing clipped to hide the law: the speck in the plane is the one
 * bright thing (0.95 of white at most, under the ivory mark), a dot at
 * twice its width a quarter as bright, and nothing ever draws past six
 * pixels (four and a half on a phone), however soft it is. The lamp is by
 * the camera, so its light
 * falls off with the square of the distance: the near field is the bright
 * soft layer and the far wall the faint one (a soft dot on the near side
 * is three times as bright as the same dot on the far side). The dust is
 * thinner at the middle distances the focus sweeps and thicker at arm's
 * length and along the far wall, so at any moment most of what shows is a
 * soft dot and only a sprinkle is a speck, as it is through a wide-open
 * lens. Most motes are faint and a few are bright, as stars are, and the
 * light has a temperature: ivory under the lamp, neutral by the middle of
 * the frame, cool silver in the far corner. No two motes crowd each other:
 * they are placed seven pixels apart on screen whatever their depth, with
 * no exception, and further apart when they are close in depth, because
 * two soft dots closer than that join into one oblong, and an oblong is a
 * big particle. Everything is slow, and the air is still: there is no
 * current to speak of (a rise of a tenth of a pixel a second), but the air
 * does carry the dust somewhere: slow swells, each a shear a few hundred
 * pixels across that turns over two to four minutes, running in six
 * directions so that no moment has a heading, carry a mote fifteen to
 * twenty pixels in half a minute in a direction that differs from one
 * region to the next, so an open curl, not a closed loop, is what a patient
 * eye sees; smaller eddies turning over half a minute to a minute bend the
 * path, a ripple over a quarter of a minute bends it within a glance, and
 * each mote has a little of its own mind (two wobbles of its own, under
 * half a pixel, over ten and twenty seconds), so neighbours drift together
 * but never trace the same curve. The air is a field over the screen, not
 * over the room: the dust at one spot moves together whatever its depth
 * (the far wall a hair behind the near field, and the near field a trace
 * faster), because the motes are placed seven pixels apart and only a field
 * that carries neighbours together keeps them apart; dust that moved by its
 * depth would reshuffle into touching pairs within a minute, and a touching
 * pair is a big particle. The one real depth cue is the camera, which leans
 * a degree toward the pointer about the plane of focus, so the near field
 * slides one way and the far wall the other. The exposure breathes once
 * every forty seconds. When the door is ready the dust fades up out of the
 * dark over four seconds, half there as the letters land and home a second
 * after the mark's bloom has settled, so the room fills behind the mark.
 * One instanced draw of quads (a point sprite has a size limit on some
 * phones; a quad has none), everything analytic in the vertex shader; the
 * room behind is a dithered gradient so the dusk never bands. Reduced
 * motion draws one frame at t = 29 s, already in focus.
 */

/** The focal plane at rest, and the frame there: 5.1 units tall at z = -6 → half-angle tan 0.425. */
const FOCUS = 6;
const TAN_HALF = 2.55 / FOCUS;
const FOV = (2 * Math.atan(TAN_HALF) * 180) / Math.PI;
/**
 * The seed box: frame fractions (with a margin for the lean, the swells and
 * the eddies: the air moves a mote a tenth of the frame's half-height at
 * most) and depth. The room runs from arm's length to the far wall, a
 * little deeper in front of the plane of focus than behind it in 1/z (the
 * measure the lens cares about), so both ends are a breath at rest and the
 * focus ring can reach either. The dust is seeded evenly in 1/z but thinned
 * to about half across the middle distances the focus ring sweeps
 * (DEPTH_DIP, a bell over the sweep), so the plane of focus, wherever it
 * is, has fewer motes to make specks of than the soft field either side of
 * it has to make dots: through an f/1 lens most of what shows should be
 * soft.
 */
const MARGIN = 1.18;
const Z_NEAR = 3.8;
const Z_FAR = 11;
const DEPTH_DIP = 0.45;
const depthWeight = (u: number) => 1 - DEPTH_DIP * Math.exp(-(((u - 0.5) / 0.3) * ((u - 0.5) / 0.3)));
/**
 * Parallax: the air's displacement is in screen units, the same for every
 * depth, scaled by (plane at rest / z) to this small power, so the near
 * field glides a trace faster than the plane and the far wall a trace
 * slower (arm's length at about 1.023 times the plane's pace, the far wall
 * at 0.97): a trace of depth, not a layering. A real layering (half again
 * at the near side, half at the far) was tried and measured: with twenty
 * pixels of travel it reshuffles the motes that show into touching pairs
 * within a minute, whatever the seeding, because two motes a pinhead apart
 * at different depths cannot be kept apart by placing them if they do not
 * move together; even a quarter power cost a third more touching pairs, and
 * a tenth, with the swells' depth phase, was still a pixel of the budget
 * that keeps seven-pixel neighbours from closing to five. Even spacing won;
 * depth is told by the lean, not the air.
 */
const PARALLAX = 0.05;
/** The focus ring: two slow turns that never line up (see `place`). */
const ringFocus = (t: number) => FOCUS + 1.05 * Math.sin((2 * Math.PI * t) / 151) + 0.45 * Math.sin((2 * Math.PI * t) / 67 + 1.7);
const STILL_T = 29;

/**
 * The light: ivory (255, 240, 204) where the lamp falls, a cool silver in
 * the far shade ((173, 194, 242) on a desktop; a step cooler, (168, 191,
 * 245), on a phone, whose far corner is close to the lamp and would
 * otherwise come out merely less warm), a touch of champagne in the near
 * field. The tint is multiplied into the mote's light, so a bright speck
 * under the lamp carries the full warmth and a dim one stays near neutral;
 * the shade holds until the lamp's light is an eighth (a seventh on a
 * phone), so the far side of the frame is cool, not merely less warm.
 */
const LAMP = [1.0, 0.94, 0.8];
const SHADE = [0.68, 0.76, 0.95];
const SHADE_PHONE = [0.66, 0.75, 0.96];
const CHAMPAGNE = [0.94, 0.86, 0.71];

/**
 * The current, the part the whole room shares, is nearly nothing: dust in
 * still air does not flow toward a light. A rise up the frame, integrated on
 * the CPU each frame from a rate that swells and relaxes over 97 s and a
 * lean that swings through zero over 131 s, at a tenth of a pixel a second
 * on average (0.0003 of the frame's half-height a second at full swell),
 * so that over minutes the dust does slowly
 * circulate through the shafts of light without ever reading as a conveyor,
 * and the open curls the swells draw lean a little one way.
 */
const DRIFT = 0.0003;
const driftRate = (t: number) => DRIFT * (0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 97));
const driftLean = (t: number) => 0.3 * Math.sin((2 * Math.PI * t) / 131);

/**
 * The air: sinusoids over the screen, the wavelength and amplitude in
 * halves of the frame's height (450 px on a desktop). The swells are where
 * the travel lives: each is a shear, a wave that runs across the direction
 * it moves the dust in ([heading of the motion in degrees, phase per unit
 * of depth, wavelength, period (s), amplitude, phase]), so the air is
 * divergence-free and the dust is carried without ever bunching, however
 * far it goes. There are six, headed thirty degrees apart round the
 * compass (not three along x and three along y: with two axes there are
 * moments when one axis's swells peak as the other's cross zero and the
 * whole lit corner, six hundred pixels wide inside one wave, moves as one;
 * with six headings every moment mixes directions and no two neighbouring
 * headings ever hold more than a third of the dust). They are 360 to 585
 * px across, turn over two to four minutes, and move a mote about half a
 * pixel a second on average, in a direction that differs from one region
 * to the next: over half a minute a mote crosses fifteen to twenty pixels
 * and does not come back, and its curl is open. Their phase turns by a
 * twentieth of a radian or so from arm's length to the far wall, so the far
 * wall trails the near field by a hair and the motes that show together
 * move as one: any more, and the near and far dust at one spot would slide
 * across each other into touching pairs. The eddies ([direction of the
 * wave, phase per unit of depth, wavelength, period, amplitude, phase] per
 * term, each moving the dust along one axis) come in three kinds. Two per
 * axis are waves 260 to 700 px across turning over 34 to 47 s, as strong
 * as the swells over the eight seconds of a glance (so no region's heading
 * is the swell's alone) and weaker over a minute, which bend the travel
 * into arcs and now and then stop a mote when the terms cancel; they carry
 * a gain of the mote's own (within a sixteenth). One per axis is a ripple,
 * under a pixel over 13 to 15 s, shared by the dust at one spot, which
 * bends a stroke within a glance without moving a mote against its
 * neighbours. The last two per axis are the mote's own: a wobble over 17
 * to 19 s and a smaller one over 11 to 12.5 s, each with a phase of the
 * mote's own (`ph` below, a full turn, taken once, twice and three times
 * over so the four do not line up), so two neighbours drift together but
 * never trace the same curve: dust, not wallpaper. The own terms and the
 * gain are the one thing that moves a mote against its neighbours, and
 * they are kept to half a pixel on purpose: measured on the field, they
 * are what closes seven-pixel neighbours to five (at a pixel they did it to
 * one pair in five over a minute and a half, at half a pixel to one in
 * twenty), and nothing in the glance misses the half pixel they lost.
 */
type Term = [number, number, number, number, number, number, number];
type Swell = [number, number, number, number, number, number];
const SWELLS: Swell[] = [
  [0, 0.06, 0.95, 163, 0.0235, 1.3],
  [60, -0.075, 0.8, 211, 0.0258, 4.0],
  [120, 0.05, 1.2, 131, 0.0184, 2.2],
  [90, 0.05, 1.05, 181, 0.0239, 0.7],
  [150, 0.07, 0.88, 239, 0.0281, 5.1],
  [30, -0.06, 1.3, 149, 0.0198, 3.4],
];
const EDDIES: Term[] = [
  // x: two eddies, the ripple, two own wobbles
  [0.6, 0.8, 0.05, 1.57, 47, 0.011, 0.4],
  [-0.58, 0.81, 0.05, 0.94, 37, 0.0069, 2.6],
  [0.3, 0.95, 0.05, 0.5, 15, 0.0019, 0.8],
  [0.94, -0.35, 0.05, 0.67, 19, 0.001, 1.1],
  [0.35, -0.94, 0.05, 0.78, 11, 0.0005, 0.6],
  // y
  [0.95, 0.32, 0.05, 1.41, 41, 0.0092, 3.9],
  [-0.32, 0.95, 0.05, 0.82, 34, 0.006, 0.9],
  [0.9, -0.4, 0.05, 0.55, 13.5, 0.0018, 2.9],
  [0.71, 0.71, 0.05, 0.59, 17, 0.0009, 2.3],
  [-0.87, 0.5, 0.05, 0.7, 12.5, 0.00048, 3.0],
];
const f5 = (n: number) => n.toFixed(5);
const flowTerm = ([dx, dy, kz, lambda, period, amp, phase]: Term, own = 0) => {
  const k = (2 * Math.PI) / lambda;
  const ownPhase = own ? ` + ph * ${f5(own)}` : "";
  return `${f5(amp)} * sin(dot(q, vec3(${f5(dx * k)}, ${f5(dy * k)}, ${f5(kz)})) + t * ${f5((2 * Math.PI) / period)} + ${f5(phase)}${ownPhase})`;
};
/** A swell: a shear wave across its heading, moving the dust along it. */
const swellTerm = ([heading, kz, lambda, period, amp, phase]: Swell) => {
  const a = (heading * Math.PI) / 180;
  return `vec2(${f5(Math.cos(a))}, ${f5(Math.sin(a))}) * (${flowTerm([-Math.sin(a), Math.cos(a), kz, lambda, period, amp, phase])})`;
};
/** q: the mote's screen position in half-heights (x scaled by the aspect) and its depth as a fraction of the room. */
const FLOW_GLSL = `vec2 flow(vec3 q, float t, float ph, float g) {
  return ${SWELLS.map(swellTerm).join("\n    + ")}
    + vec2(
      g * (${flowTerm(EDDIES[0])} + ${flowTerm(EDDIES[1])}) + ${flowTerm(EDDIES[2])} + ${flowTerm(EDDIES[3], 1.0)} + ${flowTerm(EDDIES[4], 2.0)},
      g * (${flowTerm(EDDIES[5])} + ${flowTerm(EDDIES[6])}) + ${flowTerm(EDDIES[7])} + ${flowTerm(EDDIES[8], 1.0)} + ${flowTerm(EDDIES[9], 3.0)});
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
  uniform vec2 uDrift;     // the current so far, in half-heights of the frame (x right, y up)
  uniform float uTopDim;   // how much the top tenth is dimmed (a phone's status bar)
  uniform float uLane;     // a phone's one shaft across the lower third
  uniform vec2 uMark;      // the lockup's half-footprint in NDC, with a little air
  uniform vec3 uShade;     // the tint in the far shade
  uniform float uShadeEdge; // the lamp's light below which the shade holds
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSigma;    // the dot's Gaussian sigma, CSS px
  varying float vReach;    // the quad's half-width, CSS px
  varying float vEdge;     // the Gaussian's value where the dot is cut to nothing
  varying vec2 vUv;
  const float TAN_HALF = ${TAN_HALF.toFixed(5)};
  const float MARGIN = ${MARGIN.toFixed(2)};
  const float FOCUS = ${FOCUS.toFixed(1)};
  const float PARALLAX = ${PARALLAX.toFixed(2)};
  const float INV_NEAR = ${(1 / Z_NEAR).toFixed(5)};
  const float INV_SPAN = ${(1 / Z_FAR - 1 / Z_NEAR).toFixed(5)};
  const vec3 LAMP = vec3(${LAMP.join(", ")});
  const vec3 CHAMPAGNE = vec3(${CHAMPAGNE.join(", ")});
  ${FLOW_GLSL}
  ${LAMP_GLSL}
  void main() {
    vUv = corner;
    // Seeded as frame fractions at a depth, so every screen is full. The current and the air are
    // one displacement over the screen (in half-heights of the frame), the same at every depth
    // but for the whisper of parallax, so the dust that shows together moves together; a mote
    // wraps at the margin.
    float z0 = aSeed.z;
    float hh = TAN_HALF * -z0;
    float u = (1.0 / -z0 - INV_NEAR) / INV_SPAN;
    float par = pow(FOCUS / -z0, PARALLAX);
    float sy = mod(aSeed.y + MARGIN + par * uDrift.y, 2.0 * MARGIN) - MARGIN;
    float sx = mod(aSeed.x + MARGIN + par * uDrift.x / uAspect, 2.0 * MARGIN) - MARGIN;
    float gain = mix(0.94, 1.06, (6.28318 / aRnd.z - 6.0) * 0.1);
    vec2 air = par * flow(vec3(sx * uAspect, sy, u), uTime, aRnd.y, gain);
    vec3 p = vec3((sx * uAspect + air.x) * hh, (sy + air.y) * hh, z0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 ndc = clip.xy / clip.w;
    float zc = -mv.z;
    // The lens: a mote is a Gaussian point; in the plane of focus its sigma is a little over half
    // a pixel (never under 0.8 device px, so it does not blink as it crosses pixel centres), and
    // off the plane the lens adds uK px of sigma per unit of 1/z, in quadrature. The room is
    // seeded in 1/z, thinned where the focus sweeps, so the softness is a continuum: a sprinkle
    // of the motes a speck, most a soft dot, the ends a breath. The sigma drawn stops at two
    // fifths of the cap and the dot is cut to nothing at half the cap, so the footprint never
    // passes uCap: a mote goes soft, not wide, and the softest is a round bump three pixels
    // across. The cut is as tight as the law allows: taken in to 0.45 of the cap it trims the
    // skirts of the mid-soft dots, which then fit narrower than they are and read as if their
    // light fell faster than the square of their softness.
    float sigma0 = max(mix(0.55, 0.7, aRnd.x), 0.8 / uDpr);
    float blur = abs(1.0 / zc - 1.0 / uFocus) * uK;
    float sigmaFull = sqrt(sigma0 * sigma0 + blur * blur);
    float sigma = min(sigmaFull, uCap * 0.4);
    float cut = min(sigma * 2.5, uCap * 0.5);
    // A point keeps its light as the lens spreads it, so its peak falls with the square of its
    // sigma, the full one: a mote just off the plane is a soft dot nearly as bright as a speck,
    // one at twice the speck's sigma a quarter as bright, one at four times a sixteenth (the light
    // that would have spread past the cap is lost, not piled up: nothing brightens as it softens).
    // The light is set so that a speck in the plane of the moment lands exactly at uBright and
    // the ceiling below never clips it: if it did, the soft dots just off the plane would draw as
    // bright as the specks, and a soft dot as bright as a speck is a big particle. The lamp is by
    // the camera, so its light falls off with the square of the distance too, and at the same
    // softness a near mote is about three times as bright as a far one: the far wall is the
    // faint soft layer and the near field the bright one. The motes are not all alike: most are
    // faint and a few are bright, as stars are.
    float ratio = sigmaFull / sigma0;
    float spread = mix(0.5, 1.0, pow(aRnd.x, 2.2));
    float dist = uFocus / zc;
    float lit = uBright * spread * dist * dist / (ratio * ratio);
    // The lamp: where it falls the dust is lit in full and dense; in the shade it is dim and
    // sparse. Density is a draw per mote against a beam that is 1 under the lamp (every mote
    // seeded there shows: the seeding, seven pixels apart, is what sets how full a shaft can
    // be), a little over half at the middle of the frame and a fifth in the far corner, a third
    // thinner again at the floor (the lamp is high), shaped into slow shafts a few hundred
    // pixels across, five to two between a shaft and the void beside it, that turn over minutes, so the dust drifts through
    // fixed light and a mote comes and goes as it crosses a shaft; on a phone one more shaft
    // crosses the lower third from the left edge and spills down to the bottom edge (its lower
    // side is three times as wide as its upper), so the floor is not dead. It thins once more in
    // a wide ellipse around the mark, set a little above the mark's centre and reaching a third
    // further up than down, because the lamp lights the band above the letters more than the
    // band below, so the letters sit in their own quiet with no more dust over them than under.
    // On a phone the field tapers from the lockup's row up to a quarter as many at the top edge,
    // so the densest band sits just above the lockup, not under the status bar.
    vec2 s = vec2(ndc.x * uAspect, ndc.y);
    float light = lamp(s);
    float dl = s.y + 0.5 + 0.54 * s.x;
    float lw = mix(0.09, 0.3, step(dl, 0.0));
    float lane = uLane * exp(-dl * dl / (lw * lw));
    float wash = mix(0.45, 1.0, light) + 0.25 * lane;
    float beam = 0.22 + 0.78 * smoothstep(0.0, 0.65, light);
    float floorward = mix(0.65, 1.0, smoothstep(-1.0, 0.5, s.y));
    float lanes = 0.68 + 0.32 * (0.5 * sin(dot(s, vec2(6.2, 4.6)) + uTime * 0.016)
                               + 0.35 * sin(dot(s, vec2(-3.4, 5.9)) + uTime * 0.021 + 2.0)
                               + 0.15 * sin(dot(s, vec2(8.9, -2.3)) + uTime * 0.013 + 4.1));
    float eMark = length(ndc / uMark);
    vec2 pv = ndc - vec2(0.0, 0.1);
    pv.y /= pv.y > 0.0 ? 1.35 : 1.0;
    float ePool = length(pv / uMark);
    float near = 1.0 - smoothstep(0.6, 2.0, ePool);
    float topBand = smoothstep(0.5, 1.0, ndc.y);
    float density = beam * floorward * lanes * (1.0 + 1.2 * lane) * (1.0 - 0.6 * near) * (1.0 - 3.0 * uTopDim * topBand);
    float keep = 1.0 - smoothstep(density - 0.08, density + 0.08, aRnd.w);
    // Scintillation: a mote in the plane wavers a little in the air.
    float twinkle = mix(0.9, 1.0, 0.5 + 0.5 * sin(uTime * aRnd.z + aRnd.y));
    // Over the mark the dust is a third as bright, in an ellipse with no corners to resolve, so
    // the letters always read, and within about ninety pixels of the lockup nothing draws past
    // 0.22 of white (68/255 over the dusk), so no speck sits at the letters' shoulder; on a
    // phone the top fifth is up to
    // a quarter dimmer, under the status bar. The brightest speck anywhere draws at 0.95 of
    // white (242/255 at a pixel's centre, and a speck is narrower than a pixel, so what lands
    // on the screen is 150 to 185 at best): bright enough to be a pinhead of light, still under
    // the ivory mark (245), which stays the brightest thing on the page. The ceiling is a
    // safety, not a tool: at uBright 0.95 the brightest speck lands on it and nothing is
    // clipped.
    float overMark = 1.0 - smoothstep(0.85, 1.5, eMark);
    float top = 1.0 - uTopDim * topBand;
    float ceiling = mix(0.22, 0.95, smoothstep(1.6, 2.4, eMark));
    float alpha = min(lit * wash * twinkle * uExposure * keep * (1.0 - 0.65 * overMark) * top, ceiling);
    float reach = cut + 0.5;
    bool off = abs(ndc.x) > 1.0 + reach / uViewport.x * 2.0 || abs(ndc.y) > 1.0 + reach / uViewport.y * 2.0;
    if (alpha < 0.004 || off) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // The light has a temperature: ivory under the lamp, neutral by the middle of the frame,
    // silver in the far corner (the shade holds until the lamp's light is uShadeEdge, so the far
    // side of any screen is cool), and the near field warms toward champagne, each mote its own
    // shade.
    float depth = smoothstep(2.5, 12.0, zc);
    float tint = fract(aRnd.y * 0.31831);
    vec3 col = mix(uShade, LAMP, smoothstep(uShadeEdge, 0.65, light));
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
 * stays dark and the mark always reads. The gradient spans only four or
 * five levels of 255 across the frame, which on an OLED in a dark room
 * would show as four or five contours, so each pixel is dithered (a
 * triangular dither a level and a half either way, from two fixed hashes of
 * its position, so nothing crawls) before the display rounds it: the steps
 * become a fine mix of neighbouring levels, well under the film grain, and
 * the mix survives the CSS vignette (app.css ".door-vignette") that
 * multiplies the corners down by up to 0.4, which a half-level dither would
 * not.
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
    float h1 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float h2 = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(37.0, 17.0), vec2(0.00583715, 0.06711056))));
    float dither = (h1 + h2 - 1.0) * 1.5;
    gl_FragColor = vec4(col * uExposure + dither / 255.0, 1.0);
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
 * door-ready on an expo-out curve and settles by about 2.8 s. The dust
 * fades up out of the dark on the same kind of curve, a cubic ease-out over
 * 3.2 s from 0.6 s whose first 0.64 s is eased in (a cubic ease-out alone
 * is steep at the start, and the first frames must be dark), so the first
 * thing seen is darkness with the B landing in it, then the room filling
 * behind the mark, a beat behind the letters: the dust is a quarter there
 * at 1.0 s, half at 1.3 s, three quarters at 1.8 s, nine tenths at 2.3 s
 * and home by 4 s, so the room is still settling as the O's bloom finishes.
 * The arrival is told in brightness only: the lens is at its plane from the
 * first frame (a focus pull was tried and measured to show nothing, because
 * a mote's width is capped and its light follows the law, so pushing the
 * plane out only moves the specks to the far wall). The room behind rises
 * from half its dusk to the whole of it with the dust.
 */
const ENTRANCE = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  const u = 1 - c;
  const start = Math.min(1, c / 0.2);
  return (1 - u * u * u) * start * start * (3 - 2 * start);
};
const ENTRANCE_S = 3.2;
const ENTRANCE_DELAY = 0.6;

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

      // ── The dust: motes as frame fractions at a depth from arm's length to the far wall, in 1/z
      // so the screen is as full of the far field as the near, thinned across the middle distances
      // the focus sweeps (depthWeight, by rejection). 18,000 seeded on a desktop, 7,500 on a
      // phone; the lamp and the lens decide which of them show. They are placed by dart throwing
      // on a hash grid under two rules. The hard one: no two motes land within seven CSS px of
      // each other on screen (five on a phone), whatever their depths, because any two can be
      // soft dots at once as the focus sweeps, and two soft dots (three and a half px wide at
      // half their light) closer than five px join above half their peak into one oblong, which
      // is a big particle; seven leaves the two px the air moves neighbours against each other.
      // Seven px is about as far as 18,000 motes can be kept apart on a 1440x900 frame (seven
      // tenths of the way to saturation, which is why there are not more of them: a field this
      // sparse is what a seven-px rule allows, and the beam shows every one of them in the
      // shafts), and every subset of a field with that rule keeps it, so the motes that show at
      // any moment are at least that far apart too (the air then carries them together, see
      // PARALLAX above). The soft one, which decides among the candidates that pass the hard
      // rule: prefer the one furthest from its neighbours in x, y and 1/z together, with nine
      // CSS px on screen (six and a half on a phone) and two fifths of the room in depth as the
      // unit, so motes close in depth are pushed further apart than the hard rule asks where
      // there is room, and a pair seven px apart is a speck and a breath, not two dots. Each
      // mote gets sixty-four tries and takes the best (at seven tenths of saturation most tries
      // fail the hard rule, and with thirty-two one mote in forty was placed breaking it; with
      // sixty-four, one in two hundred); once at start, about an eighth of a second. ──
      let w = window.innerWidth;
      let h = window.innerHeight;
      const count = phone ? 7500 : 18000;
      const seed = new Float32Array(count * 3);
      const rnd = new Float32Array(count * 4);
      let seedN = 11;
      const r = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      const SPACING = phone ? 6.5 : 9;
      const HARD = (phone ? 5 : 7) / SPACING;
      const DEPTH_BAND = 0.42;
      const TRIES = 64;
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
          let u = r();
          while (r() > depthWeight(u)) u = r();
          const [cx, cy] = cellOf(x, y, u);
          // d: the nearest neighbour's distance in the soft metric (1 = a full spacing), or, for
          // a candidate that breaks the hard rule, its screen distance minus one (negative), so
          // any candidate that keeps the rule beats any that breaks it.
          let d = Infinity;
          let d2 = Infinity;
          for (let az = 0; az < nz; az++) {
            for (let ay = Math.max(0, cy - 1); ay <= Math.min(ny - 1, cy + 1); ay++) {
              for (let ax = Math.max(0, cx - 1); ax <= Math.min(nx - 1, cx + 1); ax++) {
                for (let j = head[(az * ny + ay) * nx + ax]; j >= 0; j = next[j]) {
                  const dx = (px[j] - x) / rx;
                  const dy = (py[j] - y) / ry;
                  const du = (pu[j] - u) / DEPTH_BAND;
                  const ds = dx * dx + dy * dy;
                  const dd = ds + du * du;
                  if (dd < d) d = dd;
                  if (ds < d2) d2 = ds;
                }
              }
            }
          }
          if (d2 < HARD * HARD) d = Math.sqrt(d2) - 1;
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
      const shade = phone ? SHADE_PHONE : SHADE;
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
          // f/1, but tiny: 28 px of sigma per unit of 1/z. With the room seeded in 1/z and
          // thinned where the focus sweeps, that puts about a tenth of the motes that show
          // within a sigma of a speck (the plane of focus is a fortieth of the room deep: a
          // mote is sharp for a few seconds as the focus sweeps past it), a third as soft dots
          // at two to three pixels, and the rest softer than that, out to a breath near the cap
          // at the ends of the room, each fainter the further it is from the plane. Nothing
          // ever draws past six pixels (four and a half on a phone).
          uK: { value: 28 },
          uCap: { value: phone ? 4.5 : 6 },
          // The brightest mote in the plane draws at 0.95 of white, exactly at the ceiling, so
          // nothing is clipped and the law holds all the way down: a speck under the lamp peaks
          // near 90/255 as a rule (a speck is a little over half a pixel wide, so between pixel
          // centres it loses up to half its peak to the sampling), one in ten passes 120 and
          // the brightest pixels on the page land at 150 to 185, under the mark; a soft dot at
          // twice the speck's sigma peaks at a quarter of that, at three times a ninth, and
          // the far ends at a few levels over the dusk.
          uBright: { value: 0.95 },
          uExposure: { value: 1 },
          uDrift: { value: uDrift },
          uTopDim: { value: phone ? 0.25 : 0 },
          uLane: { value: phone ? 1 : 0 },
          uMark: { value: uMark },
          uLamp: { value: uLamp },
          uReach: { value: 1 },
          uShade: { value: new THREE.Vector3(shade[0], shade[1], shade[2]) },
          uShadeEdge: { value: phone ? 0.15 : 0.1 },
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
      const skyMat = new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        depthWrite: false,
        depthTest: false,
        uniforms: { uAspect: { value: w / h }, uExposure: { value: 1 }, uLamp: { value: uLamp }, uReach: { value: 1 } },
      });
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
        // desktop, past the left edge a fifth of the way down on a phone, so the light is a
        // corner lamp with an obvious side of its own while the status bar (the top tenth,
        // thinned and dimmed in the shader) stays quiet. Its reach is the distance to the far
        // corner and a little more (a sixth more on a phone, whose far corner is close), so the
        // far corner is in the shade on any screen.
        if (phone) uLamp.set(-w / h - 0.45, 0.62);
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
        // The focus ring (ringFocus, above): two slow turns that never line up, so the plane of
        // focus sweeps the room from four and a half units to seven and a half (nearly to the
        // near end, a third of the way to the far wall in 1/z) and never repeats itself. The
        // entrance only brings the dust up on its curve (ENTRANCE above).
        mat.uniforms.uFocus.value = ringFocus(t);
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
        const since = readyAt < 0 ? -1 : (now - readyAt) / 1000 - ENTRANCE_DELAY;
        const entrance = ENTRANCE(since / ENTRANCE_S);
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
