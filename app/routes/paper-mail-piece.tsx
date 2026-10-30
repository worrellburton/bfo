import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router";
import { authFetch, canWrite, isPartner } from "../auth";
import { useFocusTrap } from "../books-shared";
import { Button, Icon, Row, Rows, Section, Select, useTone } from "../entity/ui";
import { Orbit } from "../mail-loaders";
import { paperAction, STABLE_DASHBOARD, type PaperMailFull, type PaperReading } from "../paper-mail";

export function meta() {
  return [{ title: "BFO - Paper mail" }];
}

const changed = () => window.dispatchEvent(new Event("bfo-paper-mail-changed"));

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;
const day = (iso: string | null) => (iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);

const KIND: Record<string, string> = {
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

/** Stable's words for what's happening to a piece, made plain. */
const stage = (s: string | null, doing: string, done: string) => (!s ? null : s === "completed" ? done : s === "processing" || s === "pending" ? doing : s.replace(/_/g, " "));

/**
 * One piece of paper mail: the envelope and the scan, everything Stable says
 * about it, and what BFO read off it (lib/paper-read.ts), read the first time
 * the piece is opened and again once a scan arrives.
 */
export default function PaperMailPiece() {
  const { id = "" } = useParams();
  const t = useTone();
  // Filing a piece and reading it again are for those who can change records (api/stable.ts).
  const writer = canWrite();
  const [piece, setPiece] = useState<PaperMailFull | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  useFocusTrap(zoomRef, !!zoom);

  /** `force` reads it again even when the reading is current, or the last try failed. */
  const read = useCallback(async (force = false) => {
    setReading(true);
    setReadError("");
    try {
      const r = await paperAction({ action: "read-piece", id, ...(force ? { force: true } : {}) });
      setPiece(r.mail);
    } catch (err) {
      setReadError((err as Error).message);
    } finally {
      setReading(false);
    }
  }, [id]);

  useEffect(() => {
    asked.current = false;
    setPiece(null);
    setError("");
    setSaveError("");
    void (async () => {
      try {
        const r = await authFetch(`/api/stable?id=${encodeURIComponent(id)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 404 ? "This piece of mail isn't here." : j.message || "Couldn't load this piece of mail.");
        const m = j.mail as PaperMailFull;
        setPiece(m);
        if (!m.readAt) void paperAction({ action: "read", id }).then(changed).catch(() => {});
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [id]);

  // Read it the first time it's opened, and again when a scan has arrived since.
  useEffect(() => {
    if (!piece || asked.current || !piece.readingStale) return;
    asked.current = true;
    void read();
  }, [piece, read]);

  useEffect(() => {
    if (!writer) return;
    void (async () => {
      const { db, ref, get, authReady } = await import("../store");
      await authReady;
      const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string }>;
      setEntities(Object.entries(all).map(([key, a]) => ({ id: key, name: a?.name ?? key })).sort((a, b) => a.name.localeCompare(b.name)));
    })().catch(() => {});
  }, [writer]);

  useEffect(() => {
    if (!zoom) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", key);
    // The focus trap locks <body>, but <html> clips sideways (app.css), so it's the page that scrolls: lock that too.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      root.style.overflow = prev;
    };
  }, [zoom]);

  async function assign(assetId: string | null) {
    if (!piece) return;
    const prev = piece;
    setPiece({ ...piece, assetId, assigned: "hand" });
    setSaveError("");
    try {
      await paperAction({ action: "assign", id: piece.id, assetId });
      changed();
    } catch (err) {
      // Back to what's saved, and say why.
      setPiece((p) => (p ? { ...p, assetId: prev.assetId, assigned: prev.assigned } : p));
      setSaveError(`Couldn't file it: ${(err as Error).message}`);
    }
  }

  if (error && !piece) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Back />
        <p className={`text-[13px] ${t.muted}`}>{error}</p>
      </div>
    );
  }
  if (!piece) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Back />
        <p className={`inline-flex items-center gap-2 text-[13px] ${t.muted}`}>
          <Orbit /> Opening the envelope…
        </p>
      </div>
    );
  }

  const r = piece.reading;
  const to = [piece.recipient, piece.recipient2].filter(Boolean).join(" · ");
  const urgency = r?.urgency === "action" ? { text: "Needs action", cls: t.dark ? "bg-amber-400/15 text-amber-200" : "bg-amber-100 text-amber-800" } : r?.urgency === "junk" ? { text: "Junk mail", cls: t.dark ? "bg-white/[0.06] text-gray-400" : "bg-gray-100 text-gray-500" } : r ? { text: "For your information", cls: t.dark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-600" } : null;
  const happenings = [
    piece.returnedToSender ? "Returned to sender" : null,
    piece.checks ? (piece.checks === 1 ? "A check inside" : `${piece.checks} checks inside`) : null,
    stage(piece.depositStatus, "Depositing the check", "Check deposited"),
    stage(piece.forwardStatus, "Forwarding", "Forwarded"),
    stage(piece.shredStatus, "Shredding", "Shredded"),
    piece.archivedAt ? "Archived in Stable" : null,
  ].filter((x): x is string => !!x);

  const says = (
    <Section
      title="What it says"
      info="Read from the envelope photo and, once Stable scans it, the contents. Account numbers show only their last four digits."
      actions={
        r && !reading && writer ? (
          <Button icon="refresh" onClick={() => void read(true)}>
            Read again
          </Button>
        ) : undefined
      }
    >
      {reading ? (
        <p className={`flex items-center gap-2 px-5 py-5 text-[12.5px] ${t.muted}`}>
          <Orbit /> {piece.scanUrl ? "Reading the envelope and the contents…" : "Reading the envelope…"}
        </p>
      ) : (readError || piece.readingFailed) && !r ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[12.5px] ${t.muted}`}>
          <span>{readError || "BFO couldn't read this piece."}</span>
          {writer && (
            <Button icon="refresh" onClick={() => void read(true)}>
              Try again
            </Button>
          )}
        </div>
      ) : r ? (
        <>
          {(readError || piece.readingFailed) && (
            <p role="status" className={`px-5 pt-4 text-[12.5px] ${t.muted}`}>
              Couldn't read it again. {readError} The reading below is from before.
            </p>
          )}
          <Reading r={r} scanned={!!piece.scanUrl} />
        </>
      ) : (
        <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Nothing to read yet.</p>
      )}
    </Section>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <Back assetId={piece.assetId} />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {urgency && <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${urgency.cls}`}>{urgency.text}</span>}
          {r && <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${t.line} ${t.soft}`}>{KIND[r.kind] ?? "Mail"}</span>}
          {happenings.map((h) => (
            <span key={h} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${t.line} ${t.soft}`}>
              {h}
            </span>
          ))}
        </div>
        <h1 className={`text-[20px] font-semibold leading-snug tracking-[-0.015em] sm:text-[24px] ${t.text}`}>{r?.headline ?? `From ${piece.from || "an unknown sender"}`}</h1>
        <p className={`text-[13px] ${t.muted}`}>
          From <span className={t.soft}>{r?.sender.name || piece.from || "an unknown sender"}</span> to <span className={t.soft}>{to || "—"}</span>
          {piece.receivedAt && <> · arrived {dateTime(piece.receivedAt)}</>}
        </p>
      </header>

      {/* Phones: what it says comes before the paper. */}
      <div className="lg:hidden">{says}</div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* The paper itself */}
        <div className="space-y-4">
          <Section title="Envelope" actions={piece.envelopeUrl ? <Button icon="external" onClick={() => window.open(piece.envelopeUrl!, "_blank", "noopener")}>Full size</Button> : undefined}>
            {piece.envelopeUrl ? (
              <button type="button" onClick={() => setZoom(piece.envelopeUrl)} className="block w-full cursor-zoom-in bg-white" aria-label="Enlarge the envelope">
                <img src={piece.envelopeUrl} alt={`Envelope from ${piece.from || "an unknown sender"}`} className="mx-auto max-h-[520px] w-full object-contain" />
              </button>
            ) : (
              <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Stable hasn't sent a photo of the envelope.</p>
            )}
          </Section>

          <Section
            title="Contents"
            actions={piece.scanUrl ? <Button icon="external" onClick={() => window.open(piece.scanUrl!, "_blank", "noopener")}>Open</Button> : undefined}
          >
            {piece.scanUrl ? (
              piece.scanIsPdf ? (
                <iframe src={piece.scanUrl} title="Scanned contents" className="h-[720px] w-full bg-white" />
              ) : (
                <button type="button" onClick={() => setZoom(piece.scanUrl)} className="block w-full cursor-zoom-in bg-white" aria-label="Enlarge the scan">
                  <img src={piece.scanUrl} alt="Scanned contents" className="mx-auto w-full object-contain" />
                </button>
              )
            ) : (
              <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[12.5px] ${t.muted}`}>
                <span className="inline-flex items-center gap-2">
                  {piece.scanStatus === "processing" ? (
                    <>
                      <Orbit /> Stable is scanning it. The contents show here, and get read, once the scan is done.
                    </>
                  ) : (
                    "Not scanned. Ask Stable to open and scan it to read what's inside."
                  )}
                </span>
                {piece.scanStatus !== "processing" && writer && (
                  <a href={STABLE_DASHBOARD} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 font-medium hover:underline ${t.accent}`}>
                    Scan in Stable <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* What it says */}
        <div className="space-y-4">
          <div className="max-lg:hidden">{says}</div>

          {r && (
            <Section title="On the envelope">
              <Rows>
                <Row label="From">
                  <Party name={r.sender.name ?? piece.from} address={r.sender.address} />
                </Row>
                <Row label="To">
                  <Party name={r.recipient.name ?? (to || null)} address={r.recipient.address} />
                </Row>
                {r.postage && <Row label="Postage">{r.postage}</Row>}
                {r.mailClass && <Row label="Class">{r.mailClass}</Row>}
                {r.envelopeText.length > 0 && (
                  <Row label="Everything printed" stacked>
                    <pre className={`mt-1 whitespace-pre-wrap font-mono text-[12px] leading-relaxed ${t.soft}`}>{r.envelopeText.join("\n")}</pre>
                  </Row>
                )}
              </Rows>
            </Section>
          )}

          <Section title="From Stable">
            <Rows>
              {writer && (
                <Row label="Filed under">
                  <Select value={piece.assetId ?? ""} onChange={(e) => void assign(e.target.value || null)} aria-label="Entity" className={!piece.assetId ? (t.dark ? "!border-amber-400/40" : "!border-amber-300") : ""}>
                    <option value="">Which entity?</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                  {piece.assetId && piece.assigned === "auto" && <p className={`mt-1 text-[11px] ${t.faint}`}>Matched from the envelope</p>}
                  {saveError && (
                    <p role="alert" className={`mt-1 text-[12px] ${t.dark ? "text-red-400" : "text-red-600"}`}>
                      {saveError}
                    </p>
                  )}
                </Row>
              )}
              <Row label="Arrived">{dateTime(piece.receivedAt)}</Row>
              {piece.receivedAddress && <Row label="At">{piece.receivedAddress}</Row>}
              {piece.barcode && (
                <Row label="Stable's label" info="The sticker Stable puts on the envelope. Quote it when you ask Stable about this piece.">
                  <span className="font-mono text-[12.5px]">{piece.barcode}</span>
                </Row>
              )}
              <Row label="Scan">{piece.scanUrl ? "Scanned" : piece.scanStatus === "processing" ? "Scanning…" : "Not scanned"}</Row>
              {piece.forwardStatus && (
                <Row label="Forwarding">
                  {stage(piece.forwardStatus, "On its way", "Forwarded")}
                  {piece.forwardTracking && <span className={`ml-2 font-mono text-[12px] ${t.muted}`}>{piece.forwardTracking}</span>}
                </Row>
              )}
              {piece.tags.length > 0 && <Row label="Tags">{piece.tags.join(", ")}</Row>}
              {piece.clearAt && (
                <Row label="Clears" info="Stable removes a piece from its dashboard on this date unless it's archived. BFO keeps its copies.">
                  {day(piece.clearAt)}
                </Row>
              )}
              {/* The office's own Stable account: staff only. */}
              {writer && (
                <Row label="">
                  <a href={STABLE_DASHBOARD} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline ${t.accent}`}>
                    Scan, forward, shred or deposit in Stable <Icon name="external" className="h-3 w-3" />
                  </a>
                </Row>
              )}
            </Rows>
          </Section>
        </div>
      </div>

      {/* Portalled: <main> is its own stacking context, under the mobile header. */}
      {zoom &&
        createPortal(
        <div ref={zoomRef} role="dialog" aria-modal="true" aria-label={zoom === piece.scanUrl ? "Scan, enlarged" : "Envelope, enlarged"} className="fixed inset-0 z-[90] flex cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-2xl" />
          <button type="button" data-autofocus aria-label="Close" onClick={() => setZoom(null)} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white/10 text-white">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>,
          document.body
        )}
    </div>
  );
}

/** Back to the Mailbox; a partner, who has none, back to the entity's Documents tab. */
function Back({ assetId }: { assetId?: string | null }) {
  const t = useTone();
  const partner = isPartner();
  return (
    <Link to={!partner ? "/mailbox" : assetId ? `/assets/${encodeURIComponent(assetId)}/documents` : "/assets"} className={`inline-flex h-[36px] items-center gap-1 text-[13px] font-medium ${t.muted} hover:underline`}>
      <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2.2} />
      {!partner ? "Mailbox" : assetId ? "Documents" : "Entities"}
    </Link>
  );
}

function Party({ name, address }: { name: string | null; address: string | null }) {
  const t = useTone();
  return (
    <span>
      <span className="font-medium">{name || "—"}</span>
      {address && <span className={`block text-[12.5px] ${t.soft}`}>{address}</span>}
    </span>
  );
}

/** `scanned`: Stable has a scan, so an envelope-only reading means the scan couldn't be read. */
function Reading({ r, scanned }: { r: PaperReading; scanned: boolean }) {
  const t = useTone();
  const list = (items: { a: string; b: string }[]): ReactNode =>
    items.map((x) => (
      <span key={`${x.a}${x.b}`} className="flex justify-between gap-3">
        <span className={t.soft}>{x.a}</span>
        <span className="text-right font-medium tabular-nums">{x.b}</span>
      </span>
    ));
  return (
    <Rows>
      {r.action && (
        <Row label="To do">
          <span className="font-medium">{r.action}</span>
        </Row>
      )}
      {r.dueDate && <Row label="Due">{day(r.dueDate)}</Row>}
      {r.amounts.length > 0 && <Row label="Amounts">{list(r.amounts.map((x) => ({ a: x.label, b: x.amount })))}</Row>}
      {r.contents && (
        <Row label="Inside">
          <span className={`leading-relaxed ${t.soft}`}>{r.contents}</span>
        </Row>
      )}
      {r.dates.length > 0 && <Row label="Dates">{list(r.dates.map((x) => ({ a: x.label, b: x.date })))}</Row>}
      {r.references.length > 0 && <Row label="Numbers">{list(r.references.map((x) => ({ a: x.label, b: x.value })))}</Row>}
      {!r.fromScan && (
        <Row>
          <span className={`text-[12px] ${t.muted}`}>
            {scanned ? "Read from the envelope only: BFO couldn't read the scan. Open it to see what's inside." : "Read from the envelope only. Once Stable scans it, what's inside is read too."}
          </span>
        </Row>
      )}
    </Rows>
  );
}
