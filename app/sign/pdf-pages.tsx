import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Every page of a PDF drawn to a canvas at the width it's given, each with a
 * layer on top for whatever the caller wants to place (signature fields).
 * Pages are paper in both themes (docs/DESIGN.md §2.5). Each page holds its
 * final size from the start (from `pages` when the caller knows them), with a
 * quiet page-shaped placeholder until it's drawn, so nothing jumps.
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

type PageSize = { w: number; h: number };

export function PdfPages({
  src,
  width,
  overlay,
  onPages,
  onDrawn,
  pages: known,
  className = "",
}: {
  /** A URL (signed, blob or data) or the PDF's bytes. */
  src: string | Uint8Array | null;
  /** The width each page is drawn at, in CSS pixels. */
  width: number;
  /** What to draw over a page: fields, markers. Receives the page number (1-based) and its drawn size. */
  overlay?: (page: number, size: { w: number; h: number }) => ReactNode;
  onPages?: (sizes: PageSize[]) => void;
  /** Called once the first page is on screen. */
  onDrawn?: () => void;
  /** The page sizes when already known (a request stores them): placeholders hold their size before the PDF loads. */
  pages?: PageSize[];
  className?: string;
}) {
  const [loaded, setSizes] = useState<PageSize[]>([]);
  const [drawn, setDrawn] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    setDrawn(new Set());
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
          if (!alive) return;
          setDrawn((d) => new Set(d).add(i));
          if (i === 1) onDrawn?.();
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

  const sizes = loaded.length ? loaded : (known ?? []);
  if (error)
    return (
      <p role="alert" className="ds px-4 py-6 text-center text-body text-negative">
        This document couldn’t be shown here. Use Download to open it.
      </p>
    );
  if (!sizes.length) {
    return (
      <div className={`ds flex flex-col gap-4 ${className}`} aria-busy>
        <div className="mx-auto rounded-mark bg-paper" style={{ width, height: width * 1.294 }} />
      </div>
    );
  }
  return (
    <div
      className={`ds flex flex-col gap-4 ${className}`}
      role="group"
      aria-label={`Document preview, ${sizes.length} page${sizes.length === 1 ? "" : "s"}. Download it as a PDF for an accessible copy.`}
    >
      {sizes.map((s, i) => {
        const h = (width * s.h) / s.w;
        return (
          <div key={i} data-page={i + 1} className="relative mx-auto bg-paper shadow-(--elevation-1)" style={{ width, height: h }}>
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              className="block"
              style={{ width, height: h, opacity: drawn.has(i + 1) ? 1 : 0 }}
              aria-label={`Page ${i + 1} of ${sizes.length}`}
            />
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
