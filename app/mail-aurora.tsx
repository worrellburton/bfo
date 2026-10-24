import { useEffect, useRef } from "react";

/**
 * The living backdrop behind Mail: a WebGL aurora of layered noise that
 * drifts on its own, breathes, brightens as you scroll (velocity feeds its
 * energy) and blooms where you touch. Its hue is the mailbox's, so each
 * address has its own weather. Drawn at reduced resolution for the battery,
 * paused when the tab is hidden, and a single still frame when the person
 * asks for reduced motion.
 */

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float u_time;
uniform vec2 u_res;
uniform float u_hue;
uniform float u_energy;
uniform vec2 u_touch;
uniform float u_touchAge;
uniform float u_dark;
uniform float u_sat;

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * (u_res.x / u_res.y), uv.y);
  float t = u_time * (0.045 + u_energy * 0.25);
  // Two sheets of aurora flowing past each other.
  float n1 = fbm(p * 1.6 + vec2(t * 0.7, -t * 0.35));
  float n2 = fbm(p * 2.4 - vec2(t * 0.5, t * 0.6) + n1 * 1.2);
  float band = smoothstep(0.35, 0.95, n2) * (0.55 + 0.45 * sin(u_time * 0.35 + n1 * 6.0));
  // The sky brightens toward the top and falls away toward the list.
  float sky = smoothstep(-0.1, 0.9, uv.y);
  // Where the thumb landed: a bloom that fades over a couple of seconds.
  vec2 tp = vec2(u_touch.x * (u_res.x / u_res.y), u_touch.y);
  float bloom = exp(-length(p - tp) * (3.0 + u_touchAge * 1.5)) * max(0.0, 1.0 - u_touchAge * 0.45);
  float breath = 0.9 + 0.1 * sin(u_time * 0.6);
  float light = (band * (0.55 + 0.45 * sky) + bloom * 0.9) * breath * (0.75 + u_energy * 0.6);
  vec3 c1 = hsl2rgb(vec3(u_hue, u_sat, u_dark > 0.5 ? 0.55 : 0.62));
  vec3 c2 = hsl2rgb(vec3(fract(u_hue + 0.12), u_sat * 0.93, u_dark > 0.5 ? 0.6 : 0.7));
  vec3 col = mix(c1, c2, n1);
  float alpha = clamp(light, 0.0, 1.0) * (u_dark > 0.5 ? 0.42 : 0.28);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export function MailAurora({ hue, dark, saturation = 0.75, className = "" }: { hue: number; dark: boolean; /** 0 for a black-and-white sky. */ saturation?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef(hue);
  hueRef.current = hue;
  const satRef = useRef(saturation);
  satRef.current = saturation;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = {
      time: gl.getUniformLocation(prog, "u_time"),
      res: gl.getUniformLocation(prog, "u_res"),
      hue: gl.getUniformLocation(prog, "u_hue"),
      energy: gl.getUniformLocation(prog, "u_energy"),
      touch: gl.getUniformLocation(prog, "u_touch"),
      touchAge: gl.getUniformLocation(prog, "u_touchAge"),
      dark: gl.getUniformLocation(prog, "u_dark"),
      sat: gl.getUniformLocation(prog, "u_sat"),
    };

    // Drawn at a fraction of the screen's pixels: an aurora has no edges to keep sharp.
    // Resized only when the size really changed: a phone's toolbar sliding away must not blank it.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      const w = Math.max(2, Math.floor(canvas.clientWidth * scale));
      const h = Math.max(2, Math.floor(canvas.clientHeight * scale));
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    // Scrolling anywhere feeds the energy; it settles again within a second or two.
    let energy = 0;
    let lastY = new Map<EventTarget, number>();
    let lastScrollAt = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | Document;
      // A rubber-band past the top reports negative positions: not scrolling, so no energy from it.
      const y = Math.max(0, el instanceof Document ? window.scrollY : el.scrollTop);
      const prev = lastY.get(el);
      if (prev !== undefined && pullTarget === 0) energy = Math.min(1, energy + Math.min(Math.abs(y - prev), 120) / 400);
      lastY.set(el, y);
      lastScrollAt = performance.now();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    // Pulling the list down (mail-pull.tsx): the sky brightens with the pull and blooms under the thumb.
    let pullTarget = 0;
    let pullNow = 0;
    const onPull = (e: Event) => {
      pullTarget = Math.max(0, Math.min(1, Number((e as CustomEvent).detail) || 0));
    };
    window.addEventListener("mail-pull", onPull);

    // A touch blooms where it lands.
    let touch: [number, number] = [0.5, 1.3];
    let touchAt = -1e9;
    const onDown = (e: PointerEvent) => {
      touch = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight];
      touchAt = performance.now();
    };
    window.addEventListener("pointerdown", onDown, { passive: true });

    let hueNow = hueRef.current;
    let satNow = satRef.current;
    const start = performance.now();
    let raf = 0;
    let running = true;
    const draw = () => {
      const now = performance.now();
      const t = (now - start) / 1000;
      // The hue eases toward the mailbox's over a second or so, the short way round the wheel.
      let d = hueRef.current - hueNow;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      hueNow = (hueNow + d * 0.04 + 1) % 1;
      satNow += (satRef.current - satNow) * 0.05;
      if (now - lastScrollAt > 120) energy *= 0.94;
      pullNow += (pullTarget - pullNow) * 0.12;
      gl.uniform1f(u.time, t);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.hue, hueNow);
      gl.uniform1f(u.energy, Math.min(1, energy + pullNow * 0.5));
      gl.uniform2f(u.touch, touch[0], touch[1]);
      // While pulled, the bloom under the thumb holds instead of fading.
      gl.uniform1f(u.touchAge, pullNow > 0.02 ? Math.min((now - touchAt) / 1000, 0.3 + (1 - pullNow) * 1.2) : (now - touchAt) / 1000);
      gl.uniform1f(u.dark, dark ? 1 : 0);
      gl.uniform1f(u.sat, satNow);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (running && !still) raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        draw();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    draw();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("mail-pull", onPull);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [dark]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none fixed inset-x-0 top-0 h-[100lvh] w-full ${className}`} />;
}

/** A mailbox's hue on the colour wheel (0–1): "All" is indigo; each address gets its own, spread around the wheel. */
export function mailboxHue(address: string): number {
  if (!address) return 0.68;
  let h = 0;
  for (const ch of address.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // Keep to the blue–violet–teal–rose half of the wheel, where the glass reads well.
  return 0.45 + ((h % 1000) / 1000) * 0.5;
}
