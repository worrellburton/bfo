import { useEffect, useMemo, useRef, useState } from "react";
import createDOMPurify, { type DOMPurify } from "dompurify";
import { TextButton, useTone } from "./entity/ui";

/**
 * An HTML email, rendered safely: sanitized with DOMPurify, then shown in a
 * sandboxed iframe that cannot run scripts, under a CSP that blocks every
 * network load except https images (shown by default; "Hide images" holds them back). Links open in a new tab.
 * The frame grows to its content's height, so the reader scrolls as one page,
 * and mail laid out wider than the frame is scaled down to fit its width.
 */

let purifier: DOMPurify | null = null;

function getPurifier(): DOMPurify {
  // A private instance, so our hooks never touch anyone else's sanitizing.
  if (!purifier) purifier = createDOMPurify(window);
  return purifier;
}

// A remote picture: a web address, or one BFO fetches on the reader's behalf (/api/mail-image).
const REMOTE = /^\s*((https?:)?\/\/|\/api\/mail-image\b)/i;
const REMOTE_IN_SRCSET = /(^|,)\s*((https?:)?\/\/|\/api\/mail-image\b)/i;
const REMOTE_URL_IN_CSS = /url\(\s*['"]?\s*(https?:)?\/\//i;

/** Sanitizes mail HTML. Remote images are dropped unless `images` is true. */
export function sanitizeMail(html: string, images: boolean): { html: string; remoteImages: boolean } {
  const purify = getPurifier();
  let remoteImages = false;
  purify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    // Any link: HTML <a>, SVG <a> (href or xlink:href) and image-map <area>.
    if (el.hasAttribute("href") || el.hasAttribute("xlink:href")) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    for (const attr of ["src", "srcset", "background", "poster"]) {
      const v = el.getAttribute(attr);
      if (v && (attr === "srcset" ? REMOTE_IN_SRCSET : REMOTE).test(v)) {
        remoteImages = true;
        if (!images) el.removeAttribute(attr);
      }
    }
    const style = el.getAttribute("style");
    if (style && REMOTE_URL_IN_CSS.test(style)) remoteImages = true;
  });
  purify.addHook("uponSanitizeElement", (node, data) => {
    // <style> blocks stay (most mail depends on them); the CSP decides what they may load.
    if (data.tagName === "style" && REMOTE_URL_IN_CSS.test(node.textContent ?? "")) remoteImages = true;
  });
  try {
    const clean = purify.sanitize(html, {
      // Parse as body content so <style> from the mail's <head> survives.
      FORCE_BODY: true,
      FORBID_TAGS: ["form", "input", "button", "select", "textarea", "meta", "link", "base"],
    });
    return { html: String(clean), remoteImages };
  } finally {
    purify.removeAllHooks();
  }
}

/**
 * In dark mode the mail is shown inverted with its hues turned back round, the
 * way mail apps do it: white paper becomes near-black, dark text light, and
 * blue links stay blue. Pictures are inverted a second time so they look as
 * sent. Mail designed dark comes out light; "Original colors" undoes it.
 */
const DARK_CSS = `
html{background:#0f0f14;color-scheme:dark;}
body{background:#fff;color:#111;filter:invert(0.93) hue-rotate(180deg);}
img,picture,video,svg,canvas,[style*="background-image"],[background]{filter:invert(1) hue-rotate(180deg);}
`;

function frameDocument(body: string, images: boolean, dark: boolean): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? " 'self' https:" : ""}; font-src data:`;
  // The viewport meta and text-size-adjust keep iOS Safari from inflating the text of a wide (fixed-width) layout on its own.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
*{-webkit-text-size-adjust:100%;}
html,body{margin:0;padding:0;background:#fff;color:#111;}
body{padding:20px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere;}
img{max-width:100%;height:auto;}
a{color:#4f46e5;}
blockquote{margin:0 0 0 4px;padding-left:12px;border-left:2px solid #ddd;color:#555;}
pre{white-space:pre-wrap;}
${dark ? DARK_CSS : ""}</style></head><body>${body}</body></html>`;
}

/** The message body. Remote images show by default; "Hide images" holds them back for this message. */
export function MailFrame({ html, title = "Message" }: { html: string; title?: string }) {
  const t = useTone();
  const ref = useRef<HTMLIFrameElement>(null);
  const [images, setImages] = useState(true);
  /** Dark mode shows mail dark; this shows it as the sender designed it. */
  const [original, setOriginal] = useState(false);
  const dark = t.dark && !original;
  const { srcDoc, remoteImages } = useMemo(() => {
    const clean = sanitizeMail(html, images);
    return { srcDoc: frameDocument(clean.html, images, dark), remoteImages: clean.remoteImages };
  }, [html, images, dark]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    let frameObserver: ResizeObserver | null = null;
    let stuck = false;
    let scale = 1;
    let naturalHeight = 0;
    const zoomable = typeof CSS !== "undefined" && CSS.supports?.("zoom", "0.5");
    /** Mail laid out wider than the frame (a fixed 600px table, say) is scaled down to fit, the way a phone's mail app does. */
    const fitWidth = () => {
      const doc = frame.contentDocument;
      const body = doc?.body;
      if (!doc || !body) return;
      // Measure at natural size, then scale.
      if (zoomable) body.style.zoom = "";
      else {
        body.style.transform = "";
        body.style.width = "";
      }
      const want = frame.clientWidth;
      const have = Math.max(doc.documentElement.scrollWidth, body.scrollWidth);
      // The content's own height at natural size; the frame is that times the scale (browsers disagree on what a zoomed body reports).
      const cs = frame.contentWindow?.getComputedStyle(body);
      naturalHeight = body.scrollHeight + (cs ? parseFloat(cs.marginTop) + parseFloat(cs.marginBottom) || 0 : 0);
      scale = want > 0 && have > want + 1 ? Math.max(0.45, want / have) : 1;
      if (scale === 1) return;
      if (zoomable) body.style.zoom = String(scale);
      else {
        body.style.transformOrigin = "top left";
        body.style.transform = `scale(${scale})`;
        body.style.width = `${100 / scale}%`;
      }
    };
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return 0;
      if (scale !== 1) return Math.min(20000, Math.ceil(naturalHeight * scale));
      const cs = frame.contentWindow?.getComputedStyle(body);
      const margin = cs ? parseFloat(cs.marginTop) + parseFloat(cs.marginBottom) : 0;
      return Math.min(20000, Math.ceil(body.scrollHeight + (margin || 0)));
    };
    const fit = () => {
      if (stuck) return;
      fitWidth();
      const h = measure();
      if (!h || `${h}px` === frame.style.height) return;
      // The first size is set at once; later growth (pictures arriving) eases rather than jumps.
      if (frame.style.height) frame.style.transition = "height 280ms cubic-bezier(0.16, 1, 0.3, 1)";
      frame.style.height = `${h}px`;
      // Mail sized off the viewport (100vh, html,body{height:100%}) outgrows any height we give it: stop following it.
      if (measure() > h) stuck = true;
    };
    const onLoad = () => {
      fit();
      observer?.disconnect();
      frameObserver?.disconnect();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(fit);
        observer.observe(body);
        // The frame's own width changes too (a phone turning): fit again.
        frameObserver = new ResizeObserver(fit);
        frameObserver.observe(frame);
      }
    };
    frame.addEventListener("load", onLoad);
    // srcdoc may have finished loading before this effect ran.
    if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body?.childNodes.length) onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
      frameObserver?.disconnect();
    };
  }, [srcDoc]);

  return (
    <div>
      {(remoteImages || t.dark) && (
        <div className={`mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] ${t.muted}`}>
          {remoteImages &&
            (images ? (
              <TextButton onClick={() => setImages(false)}>Hide images</TextButton>
            ) : (
              <>
                Images hidden
                <span aria-hidden="true">·</span>
                <TextButton onClick={() => setImages(true)}>Show images</TextButton>
              </>
            ))}
          {remoteImages && t.dark && <span aria-hidden="true">·</span>}
          {t.dark && <TextButton onClick={() => setOriginal((o) => !o)}>{original ? "Dark colors" : "Original colors"}</TextButton>}
        </div>
      )}
      <div className={`overflow-hidden rounded-xl border ${t.dark ? "border-white/[0.07]" : "border-gray-200"}`}>
        <iframe
          ref={ref}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          referrerPolicy="no-referrer"
          className={`block h-[120px] w-full border-0 ${dark ? "bg-[#0f0f14]" : "bg-white"}`}
        />
      </div>
    </div>
  );
}

/** HTML → plain text, for quoting a message that has no text part. */
export function htmlToText(html: string): string {
  const marked = sanitizeMail(html, false)
    .html.replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "$&\n");
  const doc = new DOMParser().parseFromString(marked, "text/html");
  doc.querySelectorAll("style").forEach((s) => s.remove());
  return (doc.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
