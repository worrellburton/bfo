import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { storedFileUrl, type StoredFileRef } from "./stored-file";
import { Button, Icon, IconButton, Spinner, buttonClasses, cx, format, useMedia, useOverlay, usePresence } from "./ui";
import { overlayRoot } from "./ui/portal";
import { modalAria } from "./shell-overlay";

const { count, percent } = format;

/**
 * The app's own document reader, in place of sending a PDF to a new tab
 * where the browser's viewer shows a storage hostname and, on a phone, a
 * loose stack of pages. A PDF is drawn page by page (pdf.js, loaded from its
 * CDN the first time), continuous, fitted to the width, with the page count
 * as you scroll; a picture is shown as it is; anything else offers the file.
 * Documents are paper on a sunken well in either theme (docs/DESIGN.md
 * §2.5); the reader is a full-screen sheet registered with the overlay
 * manager, so focus, Escape and the page behind behave as every overlay's.
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

function Viewer({ file, opts, onGone }: { file: StoredFileRef; opts: ViewerOptions; onGone: () => void }) {
  const kind = viewerKind(opts.name, opts.contentType);
  const scroller = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const phone = useMedia("(width < 48rem)");
  const { mounted, leaving } = usePresence(open, 200);
  const handle = useOverlay({ open, onClose: () => setOpen(false), kind: "sheet", initialFocus: back });
  useEffect(() => {
    if (!mounted) onGone();
  }, [mounted, onGone]);

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
            if (!r.ok) throw new Error(`fetch ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        const d = await lib.getDocument({ data: bytes }).promise;
        if (live) setDoc(d);
        else d.destroy();
      })
      .catch(() => live && setError("This document couldn’t be opened here. Download it, or open it in a new tab."));
    return () => {
      live = false;
    };
  }, [file, kind]);
  useEffect(() => () => doc?.destroy(), [doc]);

  // Pages fit the width of the reader (less a gutter), up to a page's natural size and a bit.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.min(el.clientWidth - (el.clientWidth < 640 ? 32 : 96), 980));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Which page is in the middle of the view.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !doc) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let best = 1;
    for (const p of el.querySelectorAll<HTMLElement>("[data-page]")) if (p.offsetTop <= mid) best = Number(p.dataset.page);
    setPage(best);
  };

  if (!mounted) return null;
  const name = opts.name || "Document";
  const title = name.replace(/\.pdf$/i, "");
  const meta = [opts.subtitle, doc ? count(doc.numPages, "page") : null].filter(Boolean).join(" · ");
  return createPortal(
    <div className="ds fixed inset-0">
      <div
        ref={handle.panelRef}
        {...modalAria(title)}
        className={cx("absolute inset-0 flex flex-col bg-sunken text-body text-ink outline-none", leaving ? "pointer-events-none ds-dialog-out" : "ds-full-in")}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-page px-2 pt-[env(safe-area-inset-top)] md:px-4">
          <div className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2">
            {phone ? (
              <IconButton ref={back} icon="chevronLeft" label="Back" noTooltip onClick={() => handle.requestClose("close")} />
            ) : (
              <Button ref={back} variant="quiet" icon="chevronLeft" onClick={() => handle.requestClose("close")}>
                Back
              </Button>
            )}
            <div className="min-w-0 flex-1 py-2">
              <p className="truncate text-body font-medium text-ink">{title}</p>
              {meta && <p className="truncate text-small text-ink-2">{meta}</p>}
            </div>
          </div>
          {kind === "pdf" && doc && !phone && (
            <div className="flex items-center" role="group" aria-label="Zoom">
              <IconButton icon="minus" label="Smaller" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))} disabled={zoom <= 0.5} />
              <span className="w-12 text-center text-small text-ink-2 tabular-nums">{percent(zoom * 100)}</span>
              <IconButton icon="plus" label="Larger" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))} disabled={zoom >= 2.5} />
            </div>
          )}
          {url && (
            <div className="flex items-center gap-1">
              <a href={url} download={name} aria-label="Download" title="Download" className={iconLink}>
                <Icon name="download" />
              </a>
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab" className={iconLink}>
                <Icon name="external" />
              </a>
            </div>
          )}
        </header>

        <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          {error || kind === "other" ? (
            <Note title={error ? "Couldn’t open it here" : "This kind of file doesn’t open here"} text={error || "Download it, or open it in a new tab."} url={url} name={name} />
          ) : kind === "pdf" ? (
            doc && fitWidth > 0 ? (
              <div className="mx-auto flex flex-col items-center gap-4 px-4 py-4 md:gap-6 md:py-8" style={{ paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}>
                {Array.from({ length: doc.numPages }, (_, i) => (
                  <PdfPage key={i + 1} doc={doc} n={i + 1} width={fitWidth * zoom} />
                ))}
              </div>
            ) : (
              <Waiting />
            )
          ) : url ? (
            <div className="flex min-h-full items-center justify-center p-4 md:p-8">
              <img src={url} alt={name} className="max-h-full max-w-full rounded-control border border-line bg-paper object-contain" />
            </div>
          ) : (
            <Waiting />
          )}
          {kind === "pdf" && doc && doc.numPages > 1 && (
            <div className="pointer-events-none sticky bottom-0 flex justify-center" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
              <span className="rounded-full border border-line-strong bg-overlay px-3 py-1 text-caption font-medium text-ink tabular-nums shadow-(--elevation-2)">
                {page} of {doc.numPages}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    overlayRoot(),
  );
}

const iconLink = "ds inline-flex size-(--control-sm) items-center justify-center rounded-control text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink";

/** One page, as paper on the well: drawn when it comes near the view and again when the width changes. */
function PdfPage({ doc, n, width }: { doc: PdfDoc; n: number; width: number }) {
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
      const vp = pg.getViewport({ scale: (width / base.width) * dpr });
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
    <div ref={holder} data-page={n} className="relative shrink-0 overflow-hidden rounded-mark border border-line bg-paper" style={{ width, height: Math.round(width * ratio) }}>
      <canvas ref={ref} className="block h-full w-full" aria-label={`Page ${n}`} />
    </div>
  );
}

function Waiting() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-body text-ink-2" role="status">
      <Spinner />
      Opening…
    </div>
  );
}

function Note({ title, text, url, name }: { title: string; text: string; url: string | null; name: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-[400px] flex-col items-center gap-1 rounded-card border border-line bg-raised p-6 text-center">
        <p className="text-section text-ink">{title}</p>
        <p className="text-body text-pretty text-ink-2">{text}</p>
        {url && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>
              Open in a new tab
            </a>
            <a href={url} download={name} className={buttonClasses({ variant: "primary" })}>
              Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/** Show a stored document in the reader. Resolves when it's closed; focus goes back where it was. */
export function openDocumentViewer(file: StoredFileRef, opts: ViewerOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <Viewer
        file={file}
        opts={opts}
        onGone={() => {
          window.setTimeout(() => {
            root.unmount();
            host.remove();
            resolve();
          }, 0);
        }}
      />,
    );
  });
}
