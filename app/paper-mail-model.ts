import { useCallback, useEffect, useState } from "react";
import { authFetch } from "./auth";
import { format, type Tone } from "./ui";

/**
 * Paper mail's data and rules, shared by the Paper mail page, a piece's page
 * and each entity's Documents tab (app/paper-mail.tsx draws them): the shapes
 * api/stable.ts answers with, the office's mailbox address, names tidied
 * from Stable's capitals, which states a row mentions, the loaders, and the
 * scan's PDF drawn as page images.
 *
 * The mailbox is in Phoenix, so arrival times read in Arizona time with the
 * zone; a receipt date can decide a response deadline.
 */

export type PaperMail = {
  id: string;
  assetId: string | null;
  assigned: "auto" | "hand";
  from: string | null;
  recipient: string | null;
  recipient2: string | null;
  receivedAt: string | null;
  envelopeUrl: string | null;
  scanUrl: string | null;
  scanStatus: string | null;
  summary: string | null;
  checks: number;
  /** The checks' total in cents, when Stable gave every amount (newer servers). */
  checkCents?: number | null;
  checkPayer?: string | null;
  forwardStatus: string | null;
  shredStatus: string | null;
  returnedToSender: boolean;
  archivedAt: string | null;
  readAt: string | null;
  /** From BFO's reading (newer servers): bill, tax, legal… and whether it needs action. */
  kind?: string | null;
  urgency?: "action" | "fyi" | "junk" | null;
  /** Who filed it by hand, and when (newer servers; staff only). */
  filedBy?: string | null;
  filedAt?: string | null;
};

/** What BFO read off a piece (lib/paper-read.ts). */
export type PaperReading = {
  headline: string;
  kind: string;
  urgency: "action" | "fyi" | "junk";
  sender: { name: string | null; address: string | null };
  recipient: { name: string | null; address: string | null };
  postage: string | null;
  mailClass: string | null;
  action: string | null;
  dueDate: string | null;
  taxForm?: string | null;
  taxYear?: string | null;
  amounts: { label: string; amount: string }[];
  dates: { label: string; date: string }[];
  references: { label: string; value: string }[];
  contents: string | null;
  envelopeText: string[];
  fromScan: boolean;
};

export type PaperCheck = {
  amountCents: number | null;
  payer: string | null;
  payee: string | null;
  number: string | null;
  date: string | null;
  status: string | null;
  depositedAt: string | null;
  account: string | null;
};

export type FilingEntry = { from: string | null; to: string | null; by: string; at: string; confirmed?: boolean };

/** One piece in full (GET /api/stable?id=). */
export type PaperMailFull = PaperMail & {
  scanIsPdf: boolean;
  barcode: string | null;
  receivedAddress: string | null;
  clearAt: string | null;
  stableReadAt: string | null;
  forwardTracking: string | null;
  depositStatus: string | null;
  checkList?: PaperCheck[];
  filing?: FilingEntry[];
  tags: string[];
  stableBusiness: string | null;
  reading: PaperReading | null;
  readingAt: string | null;
  readingStale: boolean;
  /** The last reading of these copies failed; it's tried again only when asked. */
  readingFailed: boolean;
};

/**
 * The office's mailbox at Stable. A commercial mail receiving agency box: the
 * number is written with "#", as USPS asks and as Stable and the envelopes
 * have it, not as a suite.
 */
export const STABLE_ADDRESS_LINES = ["5227 N 7th St #48575", "Phoenix, AZ 85014"] as const;
export const STABLE_ADDRESS = STABLE_ADDRESS_LINES.join(", ");
export const STABLE_DASHBOARD = "https://dashboard.usestable.com/dashboard";
/** Where the mailbox is: arrival times read in this zone. */
export const MAILBOX_ZONE = "America/Phoenix";

/** Two addresses that are the same place, compared without punctuation, "Suite", "STE" or "#". */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\b(suite|ste|unit|pmb)\b\.?|#/g, " ")
      .replace(/\b(\d{5})-\d{4}\b/g, "$1")
      .replace(/\bnorth\b/g, "n")
      .replace(/\bstreet\b/g, "st")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!norm(a) && norm(a) === norm(b);
}

/** When a piece arrived, in Arizona time with the zone: "Oct 29, 2026, 11:06 AM MST". */
export const arrived = (iso: string | null | undefined) => (iso ? format.dateTime(iso, { zone: true, timeZone: MAILBOX_ZONE }) : "");
/** A row's date: "Oct 29" this year, "Oct 29, 2025" before. */
export const rowDate = (iso: string | null) => (iso ? format.date(iso, "short", { timeZone: MAILBOX_ZONE }) : "");

/** "STABLE" → "Stable", "NEVADA SECRETARY OF STATE" → "Nevada Secretary of State": shouting names in title case. */
export function tidyName(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!t || /[a-z]/.test(t) || t.length <= 3) return t;
  const small = new Set(["of", "and", "the", "for", "to", "in", "at", "by", "on", "c/o"]);
  const keep = new Set(["LLC", "LLP", "LP", "PLLC", "INC", "IRS", "USA", "US", "PO", "NA", "N.A.", "FBO", "II", "III", "IV", "AZ", "NV", "WY", "DE", "TX", "CA", "NY", "FL"]);
  return t
    .split(/(\s+)/)
    .map((w, i) => {
      if (/^\s+$/.test(w)) return w;
      const bare = w.replace(/[^A-Z.]/g, "");
      if (keep.has(bare)) return bare === "INC" ? w.replace("INC", "Inc") : w;
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.replace(/(^|[-/'(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
    })
    .join("");
}

/** Who a piece is to, as one line. */
export const recipientsOf = (m: Pick<PaperMail, "recipient" | "recipient2">) => [m.recipient, m.recipient2].filter(Boolean).map(tidyName).join(" · ");

export const KIND_LABEL: Record<string, string> = {
  bill: "Bill",
  statement: "Statement",
  check: "Check",
  tax: "Tax",
  government: "Government",
  legal: "Legal",
  bank: "Bank",
  insurance: "Insurance",
  notice: "Notice",
  personal: "Personal",
  marketing: "Marketing",
  other: "Mail",
};
/** Mail that can carry a deadline with legal weight: set apart, and never called junk. */
export const SERIOUS = new Set(["legal", "government", "tax"]);

// ── Loading ─────────────────────────────────────────────────────────────

/** The pieces for one entity (its Documents tab). */
export function usePaperMail(assetId?: string) {
  const [mail, setMail] = useState<PaperMail[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await authFetch(assetId ? `/api/stable?assetId=${encodeURIComponent(assetId)}` : "/api/stable?view=all");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load paper mail.");
      setMail(j.mail ?? []);
      if (typeof j.configured === "boolean") setConfigured(j.configured);
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setMail((m) => m ?? []);
    }
  }, [assetId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { mail, setMail, configured, error, reload: load };
}

export type ListFilter = "all" | "unread" | "unfiled" | "checks";
export type Counts = { all: number | null; unread: number | null; unfiled: number | null; checks: number | null };
export type CheckSummary = { pieces: number; checks: number; cents: number; unknown: number; since: string | null };
export type LastSync = { at: string | null; failedAt: string | null };

/** Whether a piece belongs under a filter: the server filters too, and older servers don't, so the page always checks. */
export function inFilter(m: PaperMail, f: ListFilter, entity: string | null, kinds: string[]): boolean {
  if (f === "unread" && m.readAt) return false;
  if (f === "unfiled" && m.assetId) return false;
  if (f === "checks" && !m.checks) return false;
  if (entity && m.assetId !== entity) return false;
  if (kinds.length && !(m.kind && kinds.includes(m.kind))) return false;
  return true;
}

/** Every piece (the Paper mail page): newest first, 100 at a time, with the counts and when Stable was last checked. */
export function usePaperMailPage(filter: ListFilter, entity: string | null, kinds: string[]) {
  const [mail, setMail] = useState<PaperMail[] | null>(null);
  const [more, setMore] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [checks, setChecks] = useState<CheckSummary | null>(null);
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const kindKey = kinds.join(",");
  const query = useCallback(
    (before?: string | null) => {
      const q = new URLSearchParams({ view: "all" });
      if (filter !== "all") q.set("filter", filter);
      if (entity) q.set("asset", entity);
      if (kindKey) q.set("kind", kindKey);
      if (before) q.set("before", before);
      return `/api/stable?${q}`;
    },
    [filter, entity, kindKey],
  );
  const load = useCallback(async () => {
    try {
      const r = await authFetch(query());
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load paper mail.");
      setMail(j.mail ?? []);
      setMore(!!j.more);
      setCounts(j.counts ?? null);
      setChecks(j.checks ?? null);
      setLastSync(j.lastSync ?? null);
      if (typeof j.configured === "boolean") setConfigured(j.configured);
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setMail((m) => m ?? []);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  const loadMore = useCallback(async () => {
    const last = mail?.[mail.length - 1]?.receivedAt;
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await authFetch(query(last));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load older mail.");
      setMail((list) => [...(list ?? []), ...((j.mail ?? []) as PaperMail[]).filter((m) => !list?.some((x) => x.id === m.id))]);
      setMore(!!j.more);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [mail, query]);
  return { mail, setMail, more, counts, checks, lastSync, setLastSync, configured, error, reload: load, loadMore, loadingMore };
}

export async function paperAction(body: Record<string, unknown>) {
  const r = await authFetch("/api/stable", { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Something went wrong. Try again.");
  return j;
}

/**
 * Opens the original envelope or scan in a new tab through a fresh
 * five-minute link, after the server checks access again. The tab opens
 * first (so no pop-up blocker stops it) and goes to the link when it comes.
 */
export async function openOriginal(id: string, which: "envelope" | "scan", fallback: string | null): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = (await paperAction({ action: "link", id, which })) as { url?: string };
    const to = url || fallback;
    if (!to) throw new Error("no link");
    if (tab) {
      tab.opener = null;
      tab.location.href = to;
    } else window.location.assign(to);
  } catch {
    tab?.close();
    if (fallback) window.open(fallback, "_blank", "noopener");
  }
}

/** The states worth a word on a row: exceptions only (a scanned piece is the normal case). */
export function statusesOf(m: PaperMail): { text: string; tone: Tone }[] {
  const out: { text: string; tone: Tone }[] = [];
  if (m.kind && SERIOUS.has(m.kind)) out.push({ text: KIND_LABEL[m.kind], tone: "warning" });
  if (m.returnedToSender) out.push({ text: "Returned to sender", tone: "warning" });
  if (m.checks) {
    const what = m.checks === 1 ? "Check inside" : `${m.checks} checks inside`;
    const amount = typeof m.checkCents === "number" ? ` · ${format.money(m.checkCents / 100)}` : "";
    const payer = m.checkPayer ? ` from ${tidyName(m.checkPayer)}` : "";
    out.push({ text: `${what}${amount}${payer}`, tone: "positive" });
  }
  if (!m.scanUrl) out.push(m.scanStatus === "processing" ? { text: "Scanning…", tone: "neutral" } : { text: "Not scanned", tone: "neutral" });
  if (m.forwardStatus) out.push({ text: m.forwardStatus === "completed" ? "Forwarded" : "Forwarding…", tone: "neutral" });
  if (m.shredStatus) out.push({ text: m.shredStatus === "completed" ? "Shredded" : "Shredding…", tone: "neutral" });
  return out;
}

/** The line under the entity picker: how the piece came to be filed there. */
export function filedNote(m: Pick<PaperMail, "assetId" | "assigned" | "filedBy" | "filedAt">): string | null {
  if (!m.assetId) return null;
  if (m.assigned === "auto") return "Matched from the envelope";
  if (m.filedBy) return `Filed by ${m.filedBy}${m.filedAt ? `, ${format.date(m.filedAt, "short")}` : ""}`;
  return null;
}

// ── The scan, as page images ────────────────────────────────────────────

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/** A page drawn from the PDF: an image (object URL) and its size. */
export type PageImage = { src: string; w: number; h: number };

/**
 * A PDF's pages as images, drawn once at a width good for the page and for
 * zooming in (1600px), so the scan sits on the page as paper rather than in
 * the browser's own viewer. Null while drawing; an error sentence if it can't.
 */
export function usePdfPages(url: string | null): { pages: PageImage[] | null; error: string } {
  const [pages, setPages] = useState<PageImage[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const made: string[] = [];
    let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
    setPages(null);
    setError("");
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        doc = await pdfjs.getDocument({ url }).promise;
        const out: PageImage[] = [];
        for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(4, 1600 / base.width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no canvas");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
          if (!blob) throw new Error("no image");
          const src = URL.createObjectURL(blob);
          made.push(src);
          out.push({ src, w: canvas.width, h: canvas.height });
          if (!alive) return;
          setPages([...out]);
        }
        if (alive && !out.length) setError("The scan has no pages.");
      } catch {
        if (alive) setError("The scan couldn’t be drawn here. Open the original to see it.");
      }
    })();
    return () => {
      alive = false;
      void doc?.destroy();
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [url]);
  return { pages, error };
}
