import { useEffect, useRef, useState } from "react";

/**
 * Where a signer makes their mark: draw it with a finger or mouse, or type
 * it and have it set in a script face. Either way the result is a PNG with
 * a transparent background, trimmed to the ink, that the server stamps into
 * the PDF.
 */

const SCRIPT = "'Snell Roundhand', 'Savoye LET', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive";

export function SignaturePad({ name, onChange, dark }: { name: string; onChange: (png: string | null) => void; dark: boolean }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // The canvas draws at device resolution; the stroke follows the pointer in CSS pixels.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || mode !== "draw") return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0a0a0c";
    }
    inked.current = false;
    setHasInk(false);
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot for a tap.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    inked.current = true;
    setHasInk(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    const c = canvasRef.current;
    if (c && inked.current) onChange(trimmed(c));
  }
  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    setHasInk(false);
    onChange(null);
  }

  // Typed: rendered off-screen in the script face.
  useEffect(() => {
    if (mode !== "type") return;
    const text = name.trim();
    if (!text) {
      onChange(null);
      return;
    }
    const c = document.createElement("canvas");
    const ratio = 2;
    const size = 44;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.font = `${size * ratio}px ${SCRIPT}`;
    const w = Math.ceil(ctx.measureText(text).width) + 40 * ratio;
    c.width = w;
    c.height = size * ratio * 1.6;
    const ctx2 = c.getContext("2d");
    if (!ctx2) return;
    ctx2.font = `${size * ratio}px ${SCRIPT}`;
    ctx2.fillStyle = "#0a0a0c";
    ctx2.textBaseline = "middle";
    ctx2.fillText(text, 20 * ratio, c.height / 2);
    onChange(trimmed(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, name]);

  const tab = (m: "draw" | "type", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors ${mode === m ? (dark ? "bg-white text-black" : "bg-gray-900 text-white") : dark ? "bg-white/[0.06] text-gray-300 hover:bg-white/10" : "bg-black/[0.05] text-gray-600 hover:bg-black/[0.08]"}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {tab("draw", "Draw")}
        {tab("type", "Type")}
        {mode === "draw" && hasInk && (
          <button type="button" onClick={clear} className={`ml-auto text-[12px] ${dark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>
            Clear
          </button>
        )}
      </div>
      {mode === "draw" ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            className="h-[150px] w-full cursor-crosshair touch-none rounded-xl bg-[#faf8f2]"
            aria-label="Draw your signature"
          />
          <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-black/20" />
          {!hasInk && (
            <p aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-black/30">
              Sign here
            </p>
          )}
        </div>
      ) : (
        <div className="flex h-[150px] items-center justify-center rounded-xl bg-[#faf8f2] px-6">
          <span className="text-[40px] leading-none text-[#0a0a0c]" style={{ fontFamily: SCRIPT }}>
            {name.trim() || <span className="text-[13px] text-black/30" style={{ fontFamily: "inherit" }}>Type your name above</span>}
          </span>
        </div>
      )}
    </div>
  );
}

/** The canvas's ink as a PNG data URL, cropped to its bounds with a little margin. */
function trimmed(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { width, height } = c;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 8;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + pad * 2;
  out.height = maxY - minY + 1 + pad * 2;
  out.getContext("2d")?.drawImage(c, minX, minY, maxX - minX + 1, maxY - minY + 1, pad, pad, maxX - minX + 1, maxY - minY + 1);
  return out.toDataURL("image/png");
}
