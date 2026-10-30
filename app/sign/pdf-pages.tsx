import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Every page of a PDF drawn to a canvas at the width it's given, each with a
 * layer on top for whatever the caller wants to place (signature fields).
 * pdf.js loads on first use and stays off every other page's bundle.
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

export type PageSize = { w: number; h: number };

export function PdfPages({
  src,
  width,
  overlay,
  onPages,
  className = "",
}: {
  /** A URL (signed, blob or data) or the PDF's bytes. */
  src: string | Uint8Array | null;
  /** The width each page is drawn at, in CSS pixels. */
  width: number;
  /** What to draw over a page: fields, markers. Receives the page number (1-based) and its drawn size. */
  overlay?: (page: number, size: { w: number; h: number }) => ReactNode;
  onPages?: (sizes: PageSize[]) => void;
  className?: string;
}) {
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState("");
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        doc = await pdfjs.getDocument(typeof src === "string" ? { url: src } : { data: src.slice() }).promise;
        if (!alive) return;
        const pages: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const v = p.getViewport({ scale: 1 });
          pages.push({ w: v.width, h: v.height });
        }
        if (!alive) return;
        setSizes(pages);
        onPages?.(pages);
        // Draw once the canvases exist.
        await new Promise((r) => requestAnimationFrame(r));
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= doc.numPages; i++) {
          if (!alive) return;
          const canvas = canvases.current[i - 1];
          if (!canvas) continue;
          const page = await doc.getPage(i);
          const scale = width / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: scale * ratio });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${viewport.height / ratio}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "The PDF couldn't be drawn.");
      }
    })();
    return () => {
      alive = false;
      void doc?.destroy();
    };
    // onPages is a callback the caller may recreate each render; the document is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, width]);

  if (error) return <p className="px-4 py-6 text-center text-[13px] text-red-400">{error}</p>;
  if (!src || !sizes.length) {
    return (
      <div className={`flex flex-col gap-4 ${className}`} aria-busy>
        <div className="mx-auto animate-pulse rounded-sm bg-white/[0.06]" style={{ width, height: width * 1.294 }} />
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {sizes.map((s, i) => {
        const h = (width * s.h) / s.w;
        return (
          <div key={i} className="relative mx-auto shadow-[0_8px_30px_rgba(0,0,0,0.35)]" style={{ width, height: h }}>
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }} className="block rounded-sm bg-white" aria-label={`Page ${i + 1}`} />
            <div className="absolute inset-0">{overlay?.(i + 1, { w: width, h })}</div>
          </div>
        );
      })}
    </div>
  );
}

/** The width pages can be drawn at inside an element, tracking resizes. The ref is a callback, so an element that mounts later (after data arrives) is measured too. */
export function useFitWidth(max = 820, pad = 0): [(el: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const measure = () => {
      // clientWidth counts the element's padding; the pages go inside it.
      const cs = getComputedStyle(node);
      const inner = node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setWidth(Math.max(280, Math.min(max, Math.floor(inner - pad))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, max, pad]);
  return [setNode, width];
}
