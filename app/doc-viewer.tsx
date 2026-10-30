import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { storedFileUrl, type StoredFileRef } from "./stored-file";

/**
 * The app's own document reader, in place of sending a PDF to a new tab
 * where the browser's viewer shows a storage hostname and, on a phone, a
 * loose stack of pages. A PDF is drawn page by page (pdf.js, loaded from its
 * CDN the first time), continuous, fitted to the width, with the page count
 * as you scroll; a picture is shown as it is; anything else offers the file.
 * Opened imperatively so a click handler reads as one line:
 *
 *   openDocumentViewer(file, { name: "Operating Agreement.pdf" });
 */

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";

type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): void };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDoc> } };

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS).then((m: PdfJs) => {
      m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return m;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

type ViewerOptions = { name?: string | null; contentType?: string | null; subtitle?: string | null };

type Kind = "pdf" | "image" | "other";

/** What the reader can show, from the file's type or its name. */
export function viewerKind(name?: string | null, contentType?: string | null): Kind {
  const ct = (contentType ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (ct === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|svg)$/.test(n)) return "image";
  return "other";
}

function isDarkNow(): boolean {
  const html = document.documentElement;
  if (html.classList.contains("light") || html.dataset.theme === "light") return false;
  if (html.classList.contains("dark") || html.dataset.theme === "dark") return true;
  try {
    const saved = localStorage.getItem("bfo-theme");
    if (saved) return saved !== "light";
  } catch {
    // system setting
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

function Viewer({ file, opts, onClose }: { file: StoredFileRef; opts: ViewerOptions; onClose: () => void }) {
  const dark = isDarkNow();
  const kind = viewerKind(opts.name, opts.contentType);
  const scroller = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [closing, setClosing] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 140);
  };

  // The signed link, then (for a PDF) the document itself.
  useEffect(() => {
    let live = true;
    storedFileUrl(file)
      .then(async (u) => {
        if (!live) return;
        setUrl(u);
        if (kind !== "pdf") return;
        const [lib, bytes] = await Promise.all([
          loadPdfJs(),
          fetch(u).then((r) => {
            if (!r.ok) throw new Error(`Couldn't fetch the file (${r.status}).`);
            return r.arrayBuffer();
          }),
        ]);
        const d = await lib.getDocument({ data: bytes }).promise;
        if (live) setDoc(d);
        else d.destroy();
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Couldn't open that document."));
    return () => {
      live = false;
    };
  }, [file, kind]);
  useEffect(() => () => doc?.destroy(), [doc]);

  // Pages fit the width of the reader (minus a gutter), up to a page's natural size and a bit.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.min(el.clientWidth - (el.clientWidth < 640 ? 24 : 80), 980));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc closes; the page behind stays put.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which page is in the middle of the view.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !doc) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    const pages = Array.from(el.querySelectorAll<HTMLElement>("[data-page]"));
    let best = 1;
    for (const p of pages) {
      if (p.offsetTop <= mid) best = Number(p.dataset.page);
    }
    setPage(best);
  };

  const name = opts.name || "Document";
  const bar = dark ? "border-white/10 bg-[#0b0b10]/90 text-gray-200" : "border-gray-200 bg-white/90 text-gray-800";
  const btn = `inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-40 ${
    dark ? "text-gray-300 hover:bg-white/[0.08] hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

  return (
    <div
      className={`fixed inset-0 z-[70] flex flex-col ${dark ? "bg-[#111116]" : "bg-[#e9e9ec]"} ${closing ? "doc-viewer-out" : "doc-viewer-in"}`}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <header className={`flex shrink-0 items-center gap-1.5 border-b px-2 backdrop-blur-xl sm:px-3 ${bar}`} style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <button type="button" onClick={close} className={btn} aria-label="Close">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="max-sm:hidden">Back</span>
        </button>
        <div className="min-w-0 flex-1 py-2.5 text-center sm:text-left">
          <div className="truncate text-[13.5px] font-semibold">{name.replace(/\.pdf$/i, "")}</div>
          {(opts.subtitle || (doc && kind === "pdf")) && (
            <div className={`truncate text-[11.5px] ${dark ? "text-gray-500" : "text-gray-500"}`}>{[opts.subtitle, doc ? `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        {kind === "pdf" && doc && (
          <div className="flex items-center max-sm:hidden">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))} className={btn} aria-label="Smaller" disabled={zoom <= 0.5}>
              −
            </button>
            <span className={`w-11 text-center text-[12px] tabular-nums ${dark ? "text-gray-400" : "text-gray-500"}`}>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))} className={btn} aria-label="Larger" disabled={zoom >= 2.5}>
              +
            </button>
          </div>
        )}
        {url && (
          <a href={url} download={name} className={btn} title="Download">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
            </svg>
            <span className="max-sm:hidden">Download</span>
          </a>
        )}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={btn} title="Open in a new tab">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6m0-6L10 14M20 14v6H4V4h6" />
            </svg>
            <span className="max-sm:hidden">New tab</span>
          </a>
        )}
      </header>

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {error ? (
          <Note dark={dark} title="Couldn't open it here" text={error} url={url} name={name} />
        ) : kind === "pdf" ? (
          doc && fitWidth > 0 ? (
            <div className="mx-auto flex flex-col items-center gap-3 px-3 py-4 sm:gap-5 sm:py-8" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
              {Array.from({ length: doc.numPages }, (_, i) => (
                <Page key={i + 1} doc={doc} n={i + 1} width={fitWidth * zoom} dark={dark} />
              ))}
            </div>
          ) : (
            <Spinner dark={dark} text={url ? "Opening…" : "Fetching the file…"} />
          )
        ) : kind === "image" ? (
          url ? (
            <div className="flex min-h-full items-center justify-center p-3 sm:p-8">
              <img src={url} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
            </div>
          ) : (
            <Spinner dark={dark} text="Fetching the file…" />
          )
        ) : (
          <Note dark={dark} title="This kind of file doesn't open here" text="Download it, or open it in a new tab." url={url} name={name} />
        )}
        {kind === "pdf" && doc && doc.numPages > 1 && (
          <div className="pointer-events-none sticky bottom-0 flex justify-center pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <span className={`rounded-full px-3 py-1 text-[12px] font-medium tabular-nums shadow-lg backdrop-blur-md ${dark ? "bg-black/70 text-gray-200" : "bg-white/90 text-gray-800"}`}>
              {page} of {doc.numPages}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** One page, drawn when it comes near the view and again when the width changes. */
function Page({ doc, n, width, dark }: { doc: PdfDoc; n: number; width: number; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(11 / 8.5);
  const [near, setNear] = useState(n <= 3);

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    void doc.getPage(n).then(async (pg) => {
      const base = pg.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const scale = width / base.width;
      const vp = pg.getViewport({ scale: scale * dpr });
      const canvas = ref.current;
      if (!canvas || !live) return;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    });
    return () => {
      live = false;
    };
  }, [doc, n, width, near]);

  return (
    <div ref={holder} data-page={n} className={`relative shrink-0 overflow-hidden rounded-[3px] bg-white ${dark ? "shadow-[0_2px_24px_rgba(0,0,0,0.55)]" : "shadow-[0_2px_18px_rgba(0,0,0,0.14)]"}`} style={{ width, height: Math.round(width * ratio) }}>
      <canvas ref={ref} className="block h-full w-full" aria-label={`Page ${n}`} />
    </div>
  );
}

function Spinner({ dark, text }: { dark: boolean; text: string }) {
  return (
    <div className={`flex h-full items-center justify-center gap-2 text-[13px] ${dark ? "text-gray-400" : "text-gray-500"}`}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {text}
    </div>
  );
}

function Note({ dark, title, text, url, name }: { dark: boolean; title: string; text: string; url: string | null; name: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className={`max-w-sm rounded-2xl border p-5 text-center ${dark ? "border-white/10 bg-white/[0.03] text-gray-200" : "border-gray-200 bg-white text-gray-800"}`}>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className={`mt-1 text-[12.5px] ${dark ? "text-gray-400" : "text-gray-500"}`}>{text}</p>
        {url && (
          <div className="mt-4 flex justify-center gap-2">
            <a href={url} download={name} className={`rounded-lg px-3 py-2 text-[12.5px] font-medium ${dark ? "bg-white text-gray-900" : "bg-gray-900 text-white"}`}>
              Download
            </a>
            <a href={url} target="_blank" rel="noopener noreferrer" className={`rounded-lg border px-3 py-2 text-[12.5px] font-medium ${dark ? "border-white/15" : "border-gray-300"}`}>
              Open in a new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/** Show a stored document in the reader. Resolves when it's closed. */
export function openDocumentViewer(file: StoredFileRef, opts: ViewerOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const returnFocus = document.activeElement as HTMLElement | null;
    root.render(
      <Viewer
        file={file}
        opts={opts}
        onClose={() => {
          root.unmount();
          host.remove();
          returnFocus?.focus?.();
          resolve();
        }}
      />
    );
  });
}
