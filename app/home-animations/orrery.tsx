import { useEffect, useRef, useState } from "react";
import type * as T from "three";
import type { BackdropProps } from "./types";

/**
 * The orrery: a family's holdings as a system. One small point of light at
 * the centre; seven rings around it, each a different tilt, ivory at the centre deepening to gold at the edge, each a
 * band of thousands of motes in orbit (the inner rings faster, as orbits
 * are); on every ring a few bright bodies trailing light; a thin gold line
 * for each orbit; dust far out. Everything moves on the GPU: a vertex
 * shader puts each mote on its orbit from a phase, a radius and the time,
 * so forty thousand of them cost one draw call. Additive blending makes the
 * light add up where the rings cross.
 *
 * The camera circles slowly and leans toward the pointer. Phones get
 * fewer motes and a lower pixel ratio. Reduced motion draws one frame.
 * Without WebGL (or if three.js fails to load) the canvas stays a deep
 * blue and the page still reads.
 */

const RINGS = [
  { radius: 1.7, width: 0.22, tilt: 0.1, roll: 0.0, color: [1.0, 0.97, 0.9], bodies: 1 },
  { radius: 2.5, width: 0.28, tilt: -0.14, roll: 0.3, color: [0.98, 0.93, 0.8], bodies: 2 },
  { radius: 3.4, width: 0.34, tilt: 0.18, roll: -0.5, color: [0.95, 0.88, 0.68], bodies: 1 },
  { radius: 4.4, width: 0.42, tilt: -0.08, roll: 1.1, color: [0.9, 0.8, 0.56], bodies: 2 },
  { radius: 5.5, width: 0.5, tilt: 0.22, roll: -1.4, color: [0.85, 0.72, 0.42], bodies: 1 },
  { radius: 6.7, width: 0.58, tilt: -0.2, roll: 0.8, color: [0.78, 0.64, 0.36], bodies: 2 },
  { radius: 8.1, width: 0.7, tilt: 0.12, roll: -0.2, color: [0.7, 0.56, 0.3], bodies: 1 },
];
/** Angular speed by radius, as orbits go: inner fast, outer slow. */
const speedOf = (r: number) => 0.42 / Math.pow(r / RINGS[0].radius, 1.35);

const VERT = /* glsl */ `
  attribute float ring;
  attribute float phase;
  attribute float dr;
  attribute float dy;
  attribute float seed;
  attribute float glow;
  uniform float uTime;
  uniform float uPixel;
  uniform vec3 uColor[7];
  uniform vec4 uRing[7]; // radius, width, tilt, roll
  uniform float uSpeed[7];
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    int i = int(ring + 0.5);
    vec4 R = uRing[i];
    float rad = R.x + dr * R.y;
    float a = phase + uTime * uSpeed[i];
    vec3 p = vec3(cos(a) * rad, dy * R.y * 0.3, sin(a) * rad);
    // The ring's tilt, then its roll, so no two rings lie in one plane.
    float ct = cos(R.z), st = sin(R.z);
    p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
    float cr = cos(R.w), sr = sin(R.w);
    p = vec3(p.x * cr - p.z * sr, p.y, p.x * sr + p.z * cr);
    float tw = 0.65 + 0.35 * sin(uTime * (1.2 + seed * 2.5) + seed * 50.0);
    vColor = mix(uColor[i], vec3(1.0, 0.86, 0.5), glow * 0.7);
    vAlpha = tw * mix(0.85, 1.7, glow);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = mix(1.9 + seed * 2.3, 12.0, glow) * uPixel;
    gl_PointSize = size * (26.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor * a * vAlpha, a * vAlpha);
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

      // ── The motes on their rings, and the bodies with their trails ──
      const perRing = phone ? 2600 : 5600;
      const trail = 28;
      const count = RINGS.length * perRing + RINGS.reduce((n, r) => n + r.bodies * (1 + trail), 0);
      const ring = new Float32Array(count);
      const phase = new Float32Array(count);
      const dr = new Float32Array(count);
      const dy = new Float32Array(count);
      const seed = new Float32Array(count);
      const glow = new Float32Array(count);
      let seedN = 3;
      const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
      // Roughly bell-shaped, so the bands are dense in the middle and thin at the edges.
      const bell = () => (rnd() + rnd() + rnd()) / 1.5 - 1;
      let k = 0;
      RINGS.forEach((R, i) => {
        for (let j = 0; j < perRing; j++, k++) {
          ring[k] = i;
          phase[k] = rnd() * Math.PI * 2;
          dr[k] = bell();
          dy[k] = bell();
          seed[k] = rnd();
          glow[k] = 0;
        }
        for (let b = 0; b < R.bodies; b++) {
          const p0 = rnd() * Math.PI * 2;
          for (let t = 0; t <= trail; t++, k++) {
            ring[k] = i;
            phase[k] = p0 - t * 0.02;
            dr[k] = 0;
            dy[k] = 0;
            seed[k] = 0.5;
            glow[k] = t === 0 ? 1 : Math.max(0.08, 0.55 * (1 - t / trail));
          }
        }
      });
      const geo = new THREE.BufferGeometry();
      // Positions come from the shader; this attribute only sets the count.
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute("ring", new THREE.BufferAttribute(ring, 1));
      geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
      geo.setAttribute("dr", new THREE.BufferAttribute(dr, 1));
      geo.setAttribute("dy", new THREE.BufferAttribute(dy, 1));
      geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
      geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPixel: { value: renderer.getPixelRatio() },
          uColor: { value: RINGS.map((r) => new THREE.Vector3(...r.color)) },
          uRing: { value: RINGS.map((r) => new THREE.Vector4(r.radius, r.width, r.tilt, r.roll)) },
          uSpeed: { value: RINGS.map((r) => speedOf(r.radius)) },
        },
      });
      scene.add(new THREE.Points(geo, mat));

      // ── The orbit lines: thin gold, barely there ──
      RINGS.forEach((R) => {
        const n = 240;
        const pts = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2;
          let x = Math.cos(a) * R.radius;
          let y = 0;
          let z = Math.sin(a) * R.radius;
          const ct = Math.cos(R.tilt);
          const st = Math.sin(R.tilt);
          [y, z] = [y * ct - z * st, y * st + z * ct];
          const cr = Math.cos(R.roll);
          const sr = Math.sin(R.roll);
          [x, z] = [x * cr - z * sr, x * sr + z * cr];
          pts.set([x, y, z], j * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
        scene.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xd8b56a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })));
      });

      // ── The light at the centre ──
      const glowTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, "rgba(255,250,236,1)");
        grad.addColorStop(0.18, "rgba(255,240,205,0.65)");
        grad.addColorStop(0.5, "rgba(233,215,168,0.14)");
        grad.addColorStop(1, "rgba(233,215,168,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 256);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      // Just a small, sharp point of light at the centre: a focus for the rings, not a sun.
      const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
      heart.scale.setScalar(0.32);
      scene.add(heart);

      // ── Dust far out ──
      {
        const n = phone ? 500 : 1400;
        const pts = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) {
          const r = 12 + rnd() * 26;
          const th = rnd() * Math.PI * 2;
          const ph = Math.acos(rnd() * 2 - 1);
          pts.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], j * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
        scene.add(
          new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf4ede0, size: 0.05, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })),
        );
      }

      // ── The camera, the pointer, the frames ──
      let w = 1;
      let h = 1;
      const size = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w < h ? 60 : 46;
        camera.updateProjectionMatrix();
      };
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      const place = (t: number) => {
        lx += (tx - lx) * 0.04;
        ly += (ty - ly) * 0.04;
        const a = t * 0.035 + lx * 0.35;
        const el = 0.62 + ly * 0.12 + 0.05 * Math.sin(t * 0.11);
        const d = w < h ? 15.5 : 12.5;
        camera.position.set(Math.sin(a) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(a) * Math.cos(el) * d);
        // The system sits a little below the mark: its light shows under the letters, not through them.
        camera.lookAt(0, 1.9, 0);
        mat.uniforms.uTime.value = t;
        heart.material.opacity = 0.75 + 0.2 * Math.sin(t * 1.7);
        renderer.render(scene, camera);
      };
      size();
      if (still) {
        place(40);
        const onResize = () => {
          size();
          place(40);
        };
        window.addEventListener("resize", onResize);
        cleanup = () => {
          window.removeEventListener("resize", onResize);
          renderer.dispose();
        };
        return;
      }
      let raf = 0;
      const t0 = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        place((now - t0) / 1000 + 20);
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
        glowTex.dispose();
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
