import { useEffect, useRef } from "react";

export type BackgroundId = "none" | "drift" | "aurora" | "mesh" | "waves";

export const BACKGROUNDS: { id: BackgroundId; label: string; description: string }[] = [
  { id: "none", label: "None", description: "Solid background, no animation" },
  { id: "drift", label: "Soft Drift", description: "Gentle floating particles" },
  { id: "aurora", label: "Aurora", description: "Slow gradient light bands" },
  { id: "mesh", label: "Mesh", description: "Subtle moving grid lines" },
  { id: "waves", label: "Waves", description: "Flowing sine wave motion" },
];

type Props = {
  backgroundId: BackgroundId;
  dark?: boolean;
  className?: string;
};

export function WebGLBackground({ backgroundId, dark = false, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (backgroundId === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas!.width = canvas!.clientWidth * dpr;
      canvas!.height = canvas!.clientHeight * dpr;
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
    }
    resize();
    window.addEventListener("resize", resize);

    const vertSrc = `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `;

    const fragSrc = getFragShader(backgroundId, dark);

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");

    const start = performance.now();
    function draw() {
      const t = (performance.now() - start) * 0.001;
      gl!.uniform1f(uTime, t);
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [backgroundId, dark]);

  if (backgroundId === "none") return null;

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ opacity: 0.35 }}
    />
  );
}

function getFragShader(id: BackgroundId, dark: boolean): string {
  const precision = "precision mediump float;\nuniform float u_time;\nuniform vec2 u_resolution;\n";

  if (id === "drift") {
    // Gentle floating particles/orbs
    const bg = dark ? "vec3(0.02, 0.02, 0.04)" : "vec3(0.97, 0.97, 0.98)";
    const col = dark ? "vec3(0.15, 0.25, 0.45)" : "vec3(0.7, 0.8, 0.95)";
    return `${precision}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        vec3 color = ${bg};
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          vec2 center = vec2(
            0.5 + 0.35 * sin(u_time * 0.12 + fi * 1.7),
            0.5 + 0.35 * cos(u_time * 0.09 + fi * 2.3)
          );
          float d = length(uv - center);
          float glow = 0.015 / (d * d + 0.01);
          color += ${col} * glow * 0.04;
        }
        gl_FragColor = vec4(color, 1.0);
      }`;
  }

  if (id === "aurora") {
    // Slow gradient bands
    const bg = dark ? "vec3(0.02, 0.02, 0.05)" : "vec3(0.96, 0.97, 1.0)";
    const c1 = dark ? "vec3(0.05, 0.15, 0.35)" : "vec3(0.85, 0.9, 1.0)";
    const c2 = dark ? "vec3(0.1, 0.05, 0.25)" : "vec3(0.9, 0.85, 0.95)";
    return `${precision}
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        float wave1 = sin(uv.x * 3.0 + u_time * 0.15) * 0.15 + sin(uv.x * 1.5 - u_time * 0.1) * 0.1;
        float wave2 = sin(uv.x * 2.0 - u_time * 0.12 + 1.5) * 0.12 + cos(uv.x * 4.0 + u_time * 0.08) * 0.08;
        float band1 = smoothstep(0.08, 0.0, abs(uv.y - 0.55 - wave1));
        float band2 = smoothstep(0.06, 0.0, abs(uv.y - 0.35 - wave2));
        vec3 color = ${bg};
        color += ${c1} * band1 * 0.6;
        color += ${c2} * band2 * 0.5;
        gl_FragColor = vec4(color, 1.0);
      }`;
  }

  if (id === "mesh") {
    // Subtle moving grid
    const bg = dark ? "vec3(0.02, 0.02, 0.03)" : "vec3(0.97, 0.97, 0.98)";
    const line = dark ? "vec3(0.08, 0.12, 0.2)" : "vec3(0.82, 0.85, 0.92)";
    return `${precision}
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        vec2 grid = uv * 12.0;
        grid.x += sin(uv.y * 6.0 + u_time * 0.2) * 0.15;
        grid.y += cos(uv.x * 6.0 + u_time * 0.15) * 0.15;
        float lx = smoothstep(0.04, 0.0, abs(fract(grid.x) - 0.5));
        float ly = smoothstep(0.04, 0.0, abs(fract(grid.y) - 0.5));
        float lines = max(lx, ly) * 0.5;
        vec3 color = ${bg} + ${line} * lines;
        gl_FragColor = vec4(color, 1.0);
      }`;
  }

  if (id === "waves") {
    // Flowing sine waves
    const bg = dark ? "vec3(0.02, 0.02, 0.04)" : "vec3(0.97, 0.97, 0.99)";
    const col = dark ? "vec3(0.08, 0.15, 0.3)" : "vec3(0.8, 0.87, 0.95)";
    return `${precision}
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        vec3 color = ${bg};
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          float y = 0.2 + fi * 0.15;
          float wave = sin(uv.x * (4.0 + fi) + u_time * (0.1 + fi * 0.03) + fi * 0.8) * 0.04;
          float d = abs(uv.y - y - wave);
          float line = smoothstep(0.012, 0.0, d);
          color += ${col} * line * (0.6 - fi * 0.08);
        }
        gl_FragColor = vec4(color, 1.0);
      }`;
  }

  // fallback
  return `${precision} void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); }`;
}

// Preview thumbnails (rendered at tiny size for the settings picker)
export function WebGLPreview({ backgroundId, dark = false }: { backgroundId: BackgroundId; dark?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (backgroundId === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;

    canvas.width = 160;
    canvas.height = 100;
    gl.viewport(0, 0, 160, 100);

    const vertSrc = `attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
    const fragSrc = getFragShader(backgroundId, dark);

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");

    let raf = 0;
    const start = performance.now();
    function draw() {
      gl!.uniform1f(uTime, (performance.now() - start) * 0.001);
      gl!.uniform2f(uRes, 160, 100);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [backgroundId, dark]);

  if (backgroundId === "none") {
    return (
      <div className={`w-full h-full rounded-lg ${dark ? "bg-gray-900" : "bg-gray-100"} flex items-center justify-center`}>
        <span className={`text-xs ${dark ? "text-gray-600" : "text-gray-400"}`}>None</span>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="w-full h-full rounded-lg" style={{ opacity: 0.7 }} />;
}
