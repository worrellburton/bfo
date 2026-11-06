import { useEffect, useRef, useState } from "react";
import { Button, Segmented } from "../ui";

/**
 * Where a signer makes their mark: draw it with a finger or mouse, or type
 * it and have it set in a script face. Either way the result is a PNG with
 * a transparent background, trimmed to the ink, that the server stamps into
 * the PDF. The pad is paper in both themes (docs/DESIGN.md §2.5); the caller
 * is told which way the mark was made, for the record.
 */

const SCRIPT = "'Snell Roundhand', 'Savoye LET', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive";

export type SignMethod = "drawn" | "typed";

/** The ink a signature is drawn in: the brand's near-black, the same on paper in either theme. */
const INK = "rgb(10 10 12)";

export function SignaturePad({ name, onChange, label = "Your signature" }: { name: string; onChange: (png: string | null, method: SignMethod) => void; dark?: boolean; label?: string }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const method: SignMethod = mode === "type" ? "typed" : "drawn";
  const emit = (png: string | null) => onChange(png, method);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // The canvas draws at device resolution; the stroke follows the pointer in CSS pixels.
  // Its bitmap is sized again whenever its width changes (a phone or iPad
  // turned), keeping what's drawn where it was, so new ink still lands under
  // the finger.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || mode !== "draw") return;
    let shown: { w: number; h: number; ratio: number } | null = null;
    const size = () => {
      const rect = c.getBoundingClientRect();
      if (!rect.width || (shown && shown.w === rect.width && shown.h === rect.height)) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      let ink: HTMLCanvasElement | null = null;
      if (shown && inked.current) {
        ink = document.createElement("canvas");
        ink.width = c.width;
        ink.height = c.height;
        ink.getContext("2d")?.drawImage(c, 0, 0);
      }
      c.width = rect.width * ratio;
      c.height = rect.height * ratio;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = INK;
        if (ink && shown) {
          ctx.drawImage(ink, 0, 0, ink.width / shown.ratio, ink.height / shown.ratio);
          // A narrower pad can cut ink off; the PNG is what's left.
          emit(trimmed(c));
        }
      }
      shown = { w: rect.width, h: rect.height, ratio };
    };
    size();
    inked.current = false;
    setHasInk(false);
    emit(null);
    const ro = new ResizeObserver(size);
    ro.observe(c);
    return () => ro.disconnect();
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
    if (c && inked.current) emit(trimmed(c));
  }
  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    setHasInk(false);
    emit(null);
  }

  // Typed: rendered off-screen in the script face, once the page's fonts have loaded (else a fallback face is what's stamped).
  useEffect(() => {
    if (mode !== "type") return;
    const text = name.trim();
    if (!text) {
      emit(null);
      return;
    }
    let live = true;
    const draw = () => {
      if (!live) return;
      const c = document.createElement("canvas");
      const ratio = 2;
      const size = 44;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.font = `${size * ratio}px ${SCRIPT}`;
      c.width = Math.ceil(ctx.measureText(text).width) + 40 * ratio;
      c.height = size * ratio * 1.6;
      const ctx2 = c.getContext("2d");
      if (!ctx2) return;
      ctx2.font = `${size * ratio}px ${SCRIPT}`;
      ctx2.fillStyle = INK;
      ctx2.textBaseline = "middle";
      ctx2.fillText(text, 20 * ratio, c.height / 2);
      emit(trimmed(c));
    };
    void (document.fonts?.ready ?? Promise.resolve()).then(draw, draw);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, name]);

  return (
    <div className="ds" role="group" aria-label={label}>
      <div className="mb-2 flex items-center gap-2">
        <Segmented
          label="How to sign"
          value={mode}
          onChange={setMode}
          options={[
            { value: "draw", label: "Draw" },
            { value: "type", label: "Type" },
          ]}
        />
        {mode === "draw" && hasInk && (
          <Button variant="quiet" size="sm" className="ml-auto" onClick={clear}>
            Clear
          </Button>
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
            className="block h-[150px] w-full cursor-crosshair touch-none rounded-card border border-edge bg-paper"
            aria-label="Draw your signature with a finger or the mouse"
          />
          <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-edge" />
          {!hasInk && (
            <p aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-small text-brand-ink opacity-70">
              Sign here
            </p>
          )}
        </div>
      ) : (
        <div className="flex h-[150px] items-center justify-center rounded-card border border-edge bg-paper px-6">
          {name.trim() ? (
            <span className="text-brand-ink" style={{ fontFamily: SCRIPT, fontSize: 40, lineHeight: 1 }}>
              {name.trim()}
            </span>
          ) : (
            <span className="text-small text-brand-ink opacity-70">Type your name above</span>
          )}
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
