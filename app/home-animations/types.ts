/**
 * The contract for a home-page backdrop (one file per backdrop in this folder).
 *
 * A backdrop is a React component, the default export of its file:
 *
 *   export default function Name({ still }: BackdropProps) { … }
 *
 * It renders exactly one <canvas className="door-sky"> (fixed, full screen;
 * app.css ".door-sky") and draws into it. Rules every backdrop keeps:
 *
 * - three.js is loaded with `await import("three")` inside an effect, never
 *   imported at the top (it's a lazy chunk; the front door must stay light).
 *   If the import or the WebGLRenderer fails, add the class "door-sky-flat"
 *   to the canvas and draw nothing: the page still reads.
 * - `still` true (reduced motion): draw one good frame and stop; no loop.
 * - Size to window.innerWidth × innerHeight, re-size on "resize"; pixel ratio
 *   capped at 2 on desktop and 1.5 on phones; fewer particles on phones
 *   (matchMedia "(max-width: 640px), (pointer: coarse)").
 * - Pause the loop when document.hidden; resume on visibilitychange.
 * - The pointer may lean the camera or the field a little; nothing more.
 * - Dispose everything (renderer, geometries, materials, textures, listeners)
 *   in the effect's cleanup: the gallery mounts and unmounts these freely.
 * - Clear colour #05060b. The mark sits in the centre of the screen, in a
 *   box about 60% wide and 35% tall: keep the brightest light out of it.
 */
export type BackdropProps = { still: boolean };
