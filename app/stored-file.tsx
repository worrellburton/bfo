/**
 * Opening an entity's stored documents. The tree keeps a URL on each file,
 * but for files in our "documents" bucket that URL is never used as-is: the
 * browser asks /api/documents/url for a short-lived signed link (which checks
 * the session and the entity), so a file can't be read by anyone holding an
 * old link, and the bucket can be private. External links and files not yet
 * moved out of Firebase open as they are.
 */

import { useState, type MouseEvent, type ReactNode } from "react";
import { SIGNED_URL_TTL_S, storagePathOf, type StoredFileRef } from "../lib/document-path";
import { authFetch } from "./auth";
import { alertDialog } from "./confirm-dialog";
import { viewerKind } from "./doc-viewer";

export type { StoredFileRef };
export { storagePathOf };

/** Signed links are reused until a couple of minutes before they lapse. */
const REUSE_MS = (SIGNED_URL_TTL_S - 120) * 1000;
const cache = new Map<string, { url: string; until: number }>();
const pending = new Map<string, Promise<string>>();

/** Minutes a signed link lasts, for labels. */
export const SIGNED_LINK_MINUTES = Math.round(SIGNED_URL_TTL_S / 60);

/** A signed link already in hand for this file (or its external URL), without asking the server. */
export function cachedFileUrl(file: StoredFileRef | null | undefined): string | null {
  const path = storagePathOf(file);
  if (!path) return file?.url || null;
  const hit = cache.get(path);
  return hit && hit.until > Date.now() ? hit.url : null;
}

/**
 * A URL that opens this file now: a fresh signed link for one of our stored
 * documents, or the URL itself for an external link. Throws when the server
 * refuses (signed out, no access) or the file is gone.
 */
export async function storedFileUrl(file: StoredFileRef): Promise<string> {
  const path = storagePathOf(file);
  if (!path) {
    if (!file.url) throw new Error("This file has no link.");
    return file.url;
  }
  const hit = cachedFileUrl(file);
  if (hit) return hit;
  const inflight = pending.get(path);
  if (inflight) return inflight;
  const ask = (async () => {
    const r = await authFetch(`/api/documents/url?path=${encodeURIComponent(path)}`);
    const data = await r.json().catch(() => null);
    if (!r.ok || typeof data?.url !== "string") {
      throw new Error(
        r.status === 403 ? "You don't have access to this document." : r.status === 404 ? "That file isn't in storage anymore." : data?.message || "Couldn't open that document."
      );
    }
    cache.set(path, { url: data.url, until: Date.now() + REUSE_MS });
    return data.url as string;
  })();
  pending.set(path, ask);
  try {
    return await ask;
  } finally {
    pending.delete(path);
  }
}

/** Warm the cache (on hover or focus) so a click, middle-click or copy has a link at once. */
export function prefetchStoredFile(file: StoredFileRef): void {
  if (storagePathOf(file) && !cachedFileUrl(file)) void storedFileUrl(file).catch(() => {});
}

/** The name and type on a stored file, whichever shape it has (a slot's upload or a Documents entry). */
function describe(file: StoredFileRef): { name: string | null; contentType: string | null } {
  const f = file as { fileName?: string; name?: string; contentType?: string };
  return { name: f.fileName || f.name || null, contentType: f.contentType || null };
}

/** True when the reader can show it: one of our stored PDFs or pictures. */
export function opensInReader(file: StoredFileRef): boolean {
  if (!storagePathOf(file)) return false;
  const { name, contentType } = describe(file);
  return viewerKind(name, contentType) !== "other";
}

/**
 * Open a stored file: a PDF or picture of ours in the app's reader; anything
 * else in a new tab, opened before the signed link is fetched so this stays
 * inside the click and isn't popup-blocked.
 */
export async function openStoredFile(file: StoredFileRef, opts: { newTab?: boolean; subtitle?: string | null } = {}): Promise<void> {
  if (!opts.newTab && opensInReader(file)) {
    const { name, contentType } = describe(file);
    const { openDocumentViewer } = await import("./doc-viewer");
    await openDocumentViewer(file, { name, contentType, subtitle: opts.subtitle });
    return;
  }
  const ready = cachedFileUrl(file);
  if (ready) {
    window.open(ready, "_blank", "noopener,noreferrer");
    return;
  }
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const url = await storedFileUrl(file);
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    win?.close();
    await alertDialog("Couldn't open the document", err instanceof Error ? err.message : undefined);
  }
}

/**
 * Copy a signed link to the clipboard. It expires (SIGNED_LINK_MINUTES), so
 * it can be pasted to someone now but never becomes a permanent way in.
 * ClipboardItem takes the link as a promise, so Safari still counts the copy
 * as part of the click.
 */
export async function copyStoredFileLink(file: StoredFileRef): Promise<void> {
  const link = storedFileUrl(file);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": link.then((u) => new Blob([u], { type: "text/plain" })) })]);
      return;
    }
  } catch {
    // fall through to writeText / the textarea
  }
  const url = await link;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/**
 * A link to a stored file: an ordinary anchor for an external link; for one
 * of our documents, a click fetches a signed link and opens it. The signed
 * link is fetched on hover/focus too, so middle-click and "copy link address"
 * get a working (expiring) URL rather than the old public one.
 */
export function StoredFileLink({
  file,
  className,
  title,
  ariaLabel,
  children,
}: {
  file: StoredFileRef;
  className?: string;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [, setTick] = useState(0);
  const ours = !!storagePathOf(file);
  const href = ours ? (cachedFileUrl(file) ?? "#") : file.url || undefined;
  const warm = () => {
    if (ours && !cachedFileUrl(file)) void storedFileUrl(file).then(() => setTick((n) => n + 1), () => {});
  };
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!ours) return;
    // A modifier or middle click keeps the browser's own "new tab" with the signed link.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    void openStoredFile(file);
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={ariaLabel} className={className} onMouseEnter={warm} onFocus={warm} onClick={onClick}>
      {children}
    </a>
  );
}
