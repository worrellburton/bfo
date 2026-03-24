import { useEffect, useRef } from "react";

interface ParticleConfig {
  count?: number;
  speed?: number;
  maxRadius?: number;
  connectionDistance?: number;
  color?: string;        // e.g. "255, 255, 255"
  dotOpacity?: number;
  lineOpacity?: number;
  themeAware?: boolean;  // if true, adapts color to light/dark mode
}

export function ParticleCanvas({
  count = 40,
  speed = 0.2,
  maxRadius = 1.2,
  connectionDistance = 150,
  color,
  dotOpacity = 0.08,
  lineOpacity = 0.02,
  themeAware = false,
  className = "",
}: ParticleConfig & { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; o: number }[] = [];

    function resize() {
      canvas!.width = canvas!.offsetWidth || window.innerWidth;
      canvas!.height = canvas!.offsetHeight || window.innerHeight;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        r: Math.random() * maxRadius + 0.3,
        o: dotOpacity,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const c = themeAware
        ? (document.documentElement.classList.contains("light") ? "0, 0, 0" : "255, 255, 255")
        : (color || "255, 255, 255");

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas!.width;
        if (p.x > canvas!.width) p.x = 0;
        if (p.y < 0) p.y = canvas!.height;
        if (p.y > canvas!.height) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${c}, ${p.o})`;
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connectionDistance) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(${c}, ${lineOpacity * (1 - dist / connectionDistance)})`;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [count, speed, maxRadius, connectionDistance, color, dotOpacity, lineOpacity, themeAware]);

  return <canvas ref={canvasRef} className={className} />;
}
