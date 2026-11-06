import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { authFetch, canWrite, isPartner } from "../auth";
import {
  AiNote,
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  Disclosure,
  Empty,
  format,
  Page,
  PageHeader,
  Row,
  Rows,
  Skeleton,
  Spinner,
  Status,
  TextLink,
  toast,
  useDocumentTitle,
  useMedia,
  type Tone,
} from "../ui";
import { EntityPicker, MediaViewer, type MediaItem } from "../paper-mail";
import {
  arrived,
  KIND_LABEL,
  openOriginal,
  paperAction,
  recipientsOf,
  sameAddress,
  SERIOUS,
  STABLE_ADDRESS,
  STABLE_DASHBOARD,
  tidyName,
  usePdfPages,
  type PaperCheck,
  type PaperMailFull,
  type PaperReading,
} from "../paper-mail-model";

export function meta() {
  return [{ title: "Paper mail · BFO" }];
}

const changed = () => window.dispatchEvent(new Event("bfo-paper-mail-changed"));

/** Stable's words for what's happening to a piece, made plain. */
const stage = (s: string | null | undefined, doing: string, done: string) =>
  !s ? null : s === "completed" ? done : s === "processing" || s === "pending" ? doing : `${s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}`;

/**
 * One piece of paper mail: which entity it's filed under (staff), what BFO's
 * AI read off it (a proposal to check against the scan), any checks inside,
 * the envelope and the scan as paper on the page, and Stable's details. The
 * envelope and the scan's pages enlarge in the media viewer.
 */
export default function PaperMailPiece() {
  const { id = "" } = useParams();
  // Filing a piece and reading it again are for those who can change records (api/stable.ts).
  const writer = canWrite();
  const partner = isPartner();
  const wide = useMedia("(min-width: 1024px)");
  const [piece, setPiece] = useState<PaperMailFull | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const asked = useRef(false);
  const sender = tidyName(piece?.reading?.sender.name || piece?.from) || "an unknown sender";
  useDocumentTitle(piece ? `From ${sender}` : "Paper mail", piece ? "Paper mail" : undefined);

  /** `force` reads it again even when the reading is current, or the last try failed. */
  const read = useCallback(
    async (force = false) => {
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
    },
    [id],
  );

  useEffect(() => {
    asked.current = false;
    setPiece(null);
    setError("");
    setSaveError("");
    void (async () => {
      try {
        const r = await authFetch(`/api/stable?id=${encodeURIComponent(id)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 404 ? "This piece of mail isn’t here. It may have been removed." : j.message || "Couldn’t load this piece of mail.");
        const m = j.mail as PaperMailFull;
        setPiece(m);
        if (!m.readAt)
          void paperAction({ action: "read", id })
            .then(changed)
            .catch(() => {});
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
      setEntities(
        Object.entries(all)
          .map(([key, a]) => ({ id: key, name: a?.name ?? key }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })().catch(() => {});
  }, [writer]);

  const nameOf = (assetId: string | null) => (assetId ? (entities.find((e) => e.id === assetId)?.name ?? "another entity") : "No entity");

  async function assign(assetId: string | null, undoable = true) {
    if (!piece) return;
    const prev = piece;
    setPiece({ ...piece, assetId, assigned: "hand", filedBy: "you", filedAt: new Date().toISOString() });
    setSaveError("");
    try {
      const r = await paperAction({ action: "assign", id: piece.id, assetId });
      if (r.mail) setPiece((p) => (p ? { ...p, ...r.mail, filing: [{ from: prev.assetId, to: assetId, by: "you", at: new Date().toISOString() }, ...(p.filing ?? [])] } : p));
      changed();
      if (undoable) toast({ message: assetId ? `Filed under ${nameOf(assetId)}` : "Moved to No entity", action: { label: "Undo", run: () => void assign(prev.assetId, false) } });
    } catch (err) {
      // Back to what's saved, and say why.
      setPiece((p) => (p ? { ...p, assetId: prev.assetId, assigned: prev.assigned, filedBy: prev.filedBy, filedAt: prev.filedAt } : p));
      setSaveError(`Couldn’t file it. ${(err as Error).message}`);
    }
  }

  async function confirmMatch() {
    if (!piece) return;
    const prev = piece;
    setPiece({ ...piece, assigned: "hand", filedBy: "you", filedAt: new Date().toISOString() });
    try {
      await paperAction({ action: "confirm", id: piece.id });
      toast({ message: `Confirmed. Partners on ${nameOf(piece.assetId)} can see it now.` });
    } catch (err) {
      setPiece(prev);
      setSaveError(`Couldn’t confirm it. ${(err as Error).message}`);
    }
  }

  const scanPdf = piece?.scanIsPdf ? piece.scanUrl : null;
  const { pages, error: pageError } = usePdfPages(scanPdf);
  const items = useMemo<MediaItem[]>(() => {
    if (!piece) return [];
    const to = recipientsOf(piece) || "an unknown recipient";
    const out: MediaItem[] = [];
    if (piece.envelopeUrl)
      out.push({ src: piece.envelopeUrl, alt: `Envelope from ${sender} to ${to}`, label: "Envelope", onOpenOriginal: () => void openOriginal(piece.id, "envelope", piece.envelopeUrl) });
    if (piece.scanUrl && !piece.scanIsPdf)
      out.push({ src: piece.scanUrl, alt: `Scanned contents of the mail from ${sender}`, label: "Scan", onOpenOriginal: () => void openOriginal(piece.id, "scan", piece.scanUrl) });
    (pages ?? []).forEach((p, i, all) =>
      out.push({
        src: p.src,
        alt: `Scanned contents of the mail from ${sender}, page ${i + 1} of ${all.length}`,
        label: `Scan, page ${i + 1}`,
        onOpenOriginal: () => void openOriginal(piece.id, "scan", piece.scanUrl),
      }),
    );
    return out;
  }, [piece, pages, sender]);

  const back = !partner
    ? { to: "/mailbox", label: "Paper mail" }
    : piece?.assetId
      ? { to: `/assets/${encodeURIComponent(piece.assetId)}/documents`, label: "Documents" }
      : { to: "/assets", label: "Entities" };

  if (!piece) {
    return <Page header={<PageHeader title="Paper mail" back={back} />}>{error ? <Banner tone="negative">{error}</Banner> : <Skeleton kind="card" rows={3} />}</Page>;
  }

  const r = piece.reading;
  const to = recipientsOf(piece);
  const serious = !!r && SERIOUS.has(r.kind);
  const urgency: { text: string; tone: Tone } | null = !r
    ? null
    : r.urgency === "action" || serious
      ? { text: "Needs action", tone: "warning" }
      : r.urgency === "junk"
        ? { text: "Junk mail", tone: "neutral" }
        : null;
  const checkList = piece.checkList ?? [];
  const happenings: { text: string; tone: Tone }[] = [
    piece.returnedToSender ? { text: "Returned to sender", tone: "warning" as Tone } : null,
    piece.checks && !piece.depositStatus ? { text: piece.checks === 1 ? "A check inside" : `${piece.checks} checks inside`, tone: "positive" as Tone } : null,
    piece.depositStatus ? { text: stage(piece.depositStatus, "Depositing the check", "Check deposited") ?? "", tone: "positive" as Tone } : null,
    piece.forwardStatus ? { text: stage(piece.forwardStatus, "Forwarding", "Forwarded") ?? "", tone: "neutral" as Tone } : null,
    piece.shredStatus ? { text: stage(piece.shredStatus, "Shredding", "Shredded") ?? "", tone: "neutral" as Tone } : null,
    piece.archivedAt ? { text: "Archived in Stable", tone: "neutral" as Tone } : null,
  ].filter((x): x is { text: string; tone: Tone } => !!x && !!x.text);
  const hasStates = !!urgency || !!r || happenings.length > 0;
  const scanIndex = items.findIndex((x) => x.label.startsWith("Scan"));

  const states = hasStates && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {r && <Badge>{KIND_LABEL[r.kind] ?? "Mail"}</Badge>}
      {urgency && <Status tone={urgency.tone}>{urgency.text}</Status>}
      {happenings.map((h) => (
        <Status key={h.text} tone={h.tone}>
          {h.text}
        </Status>
      ))}
    </div>
  );

  const busyLine = reading && (
    <p role="status" className="flex items-center gap-2 text-small text-ink-2">
      <Spinner />
      {piece.scanUrl ? "Reading the envelope and the scan…" : "Reading the envelope…"}
    </p>
  );

  const legal = serious && (r?.kind === "legal" || r?.kind === "government") && (
    <Banner tone="warning">If this is an original legal or government document, ask Stable to forward it. Don’t have it shredded.</Banner>
  );

  const filed = writer && !partner && (
    <Card>
      <Rows className="-my-3">
        <Row label="Filed under">
          <EntityPicker piece={piece} entities={entities} onAssign={(v) => void assign(v)} onConfirm={() => void confirmMatch()} full={!wide} />
          {saveError && (
            <p role="alert" className="mt-1 text-small text-negative">
              {saveError}
            </p>
          )}
          {(piece.filing?.length ?? 0) > 0 && (
            <Disclosure label="Filing history" count={piece.filing!.length} className="mt-2">
              <ul className="mt-1 flex flex-col gap-1 text-small text-ink-2">
                {piece.filing!.map((f, i) => (
                  <li key={`${f.at}${i}`}>
                    {f.confirmed ? `Confirmed under ${nameOf(f.to)}` : f.to ? `Filed under ${nameOf(f.to)}${f.from ? `, from ${nameOf(f.from)}` : ""}` : `Unfiled from ${nameOf(f.from)}`} by {f.by},{" "}
                    {format.dateTime(f.at, { zone: true })}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Row>
      </Rows>
    </Card>
  );

  const says =
    r || readError || piece.readingFailed ? (
      <Card
        title="What it says"
        action={
          r && !reading && writer ? (
            <Button variant="quiet" size="sm" icon="sync" onClick={() => void read(true)}>
              Read again
            </Button>
          ) : undefined
        }
      >
        {!r ? (
          <Empty
            action={
              writer && !reading ? (
                <Button variant="quiet" size="sm" onClick={() => void read(true)}>
                  Try again
                </Button>
              ) : undefined
            }
          >
            {readError || "BFO couldn’t read this piece. Open the scan to see what’s inside."}
          </Empty>
        ) : (
          <>
            {(readError || piece.readingFailed) && <p className="mb-3 text-small text-ink-2">Couldn’t read it again. {readError} The reading below is from before.</p>}
            <Reading r={r} scanned={!!piece.scanUrl} />
          </>
        )}
      </Card>
    ) : null;

  const checks = piece.checks > 0 && (
    <Card title="Checks" count={piece.checks}>
      {checkList.length ? (
        <div className="flex flex-col gap-4">
          {checkList.map((c, i) => (
            <CheckRows key={i} c={c} n={checkList.length > 1 ? i + 1 : null} />
          ))}
        </div>
      ) : (
        <p className="text-body text-ink-2">
          Stable’s record has {format.count(piece.checks, "check")} in this piece. Its amount, payer and deposit show in Stable{writer ? "" : "."}
          {writer && (
            <>
              {" "}
              <TextLink to={STABLE_DASHBOARD} inline>
                Open Stable
              </TextLink>
              .
            </>
          )}
        </p>
      )}
    </Card>
  );

  const envelope = (
    <Card title="Envelope">
      {piece.envelopeUrl ? (
        <button type="button" onClick={() => setViewing(0)} className="block w-full cursor-zoom-in rounded-control bg-sunken p-2" aria-label="Enlarge the envelope">
          <img src={piece.envelopeUrl} alt={`Envelope from ${sender}${to ? ` to ${to}` : ""}`} className="mx-auto max-h-[480px] w-full rounded-mark bg-paper object-contain" />
        </button>
      ) : (
        <p className="text-body text-ink-2">Stable hasn’t sent a photo of the envelope.</p>
      )}
    </Card>
  );

  const contents = (
    <Card
      title="Contents"
      action={
        piece.scanUrl ? (
          <Button variant="quiet" size="sm" icon="external" onClick={() => void openOriginal(piece.id, "scan", piece.scanUrl)}>
            Open original
          </Button>
        ) : undefined
      }
    >
      {piece.scanUrl ? (
        piece.scanIsPdf ? (
          pageError ? (
            <p className="text-body text-ink-2">{pageError}</p>
          ) : !pages ? (
            <Skeleton kind="card" rows={2} />
          ) : (
            <div className="flex flex-col gap-3 rounded-control bg-sunken p-2">
              {pages.map((p, i) => (
                <button
                  key={p.src}
                  type="button"
                  onClick={() => setViewing(scanIndex + i)}
                  className="block w-full cursor-zoom-in"
                  aria-label={pages.length > 1 ? `Enlarge the scan, page ${i + 1} of ${pages.length}` : "Enlarge the scan"}
                >
                  <img src={p.src} alt={`Page ${i + 1}`} width={p.w} height={p.h} className="h-auto w-full rounded-mark bg-paper" />
                </button>
              ))}
            </div>
          )
        ) : (
          <button type="button" onClick={() => setViewing(scanIndex)} className="block w-full cursor-zoom-in rounded-control bg-sunken p-2" aria-label="Enlarge the scan">
            <img src={piece.scanUrl} alt={`Scanned contents of the mail from ${sender}`} className="mx-auto w-full rounded-mark bg-paper object-contain" />
          </button>
        )
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-body text-ink-2">
          {piece.scanStatus === "processing" ? (
            <span className="flex items-center gap-2">
              <Spinner /> Stable is scanning it. The contents show here, and are read, once the scan is done.
            </span>
          ) : (
            <span>Not scanned. Ask Stable to open and scan it to read what’s inside.</span>
          )}
          {piece.scanStatus !== "processing" && writer && <TextLink to={STABLE_DASHBOARD}>Scan in Stable</TextLink>}
        </div>
      )}
    </Card>
  );

  const showAt = piece.receivedAddress && !sameAddress(piece.receivedAddress, STABLE_ADDRESS);
  const details = (
    <Card title="From Stable">
      <Rows className="-my-3">
        {piece.barcode && (
          <Row label="Stable’s label" hint="Quote it when you ask Stable about this piece.">
            <span className="font-mono text-small">{piece.barcode}</span>
          </Row>
        )}
        {showAt && <Row label="Arrived at">{piece.receivedAddress}</Row>}
        {piece.forwardStatus && (
          <Row label="Forwarding" hint={piece.forwardTracking ? <span className="font-mono">{piece.forwardTracking}</span> : undefined}>
            {stage(piece.forwardStatus, "On its way", "Forwarded")}
          </Row>
        )}
        {piece.tags.length > 0 && <Row label="Tags">{format.list(piece.tags)}</Row>}
        {piece.clearAt && (
          <Row label="Leaves Stable" hint="Stable clears it from its dashboard then, unless it’s archived. BFO keeps its copies.">
            {format.date(piece.clearAt, "medium")}
          </Row>
        )}
      </Rows>
      {writer && <p className="mt-4 text-small text-ink-2">Forward originals of legal documents, deeds, certificates and signed agreements; don’t have them shredded.</p>}
    </Card>
  );

  const name = viewing !== null && items[viewing]?.label.startsWith("Scan") ? "Scan, enlarged" : "Envelope, enlarged";
  const caption = [`from ${sender}`, piece.receivedAt ? format.date(piece.receivedAt, "short") : ""].filter(Boolean).join(" · ");

  return (
    <Page
      header={
        <PageHeader
          title={`From ${sender}`}
          back={back}
          context={[to ? `To ${to}` : null, arrived(piece.receivedAt) || null].filter(Boolean).join(" · ")}
          secondary={
            writer ? (
              <Button icon="external" onClick={() => window.open(STABLE_DASHBOARD, "_blank", "noopener")}>
                Act in Stable
              </Button>
            ) : undefined
          }
        />
      }
    >
      {(states || busyLine) && (
        <div className="-mt-4 flex flex-col gap-3">
          {states}
          {busyLine}
        </div>
      )}
      {legal}
      {filed}
      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {says}
            {checks}
            {contents}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {envelope}
            {details}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {says}
          {checks}
          {envelope}
          {contents}
          {details}
        </div>
      )}
      <p className="text-caption text-ink-2">
        <TextLink to="/legal/privacy#paper-mail" inline>
          How paper mail is handled
        </TextLink>
      </p>
      <MediaViewer items={items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} name={name} caption={caption} />
    </Page>
  );
}

function Party({ name, address }: { name: string | null; address: string | null }) {
  return (
    <span>
      <span className="font-medium">{tidyName(name) || "Not on the envelope"}</span>
      {address && <span className="block text-small text-ink-2">{address}</span>}
    </span>
  );
}

/** Label-and-value pairs read off the piece, one per line. */
function Pairs({ items }: { items: { a: string; b: string }[] }): ReactNode {
  return (
    <span className="flex flex-col gap-1">
      {items.map((x) => (
        <span key={`${x.a}${x.b}`} className="flex justify-between gap-4">
          <span className="text-ink-2">{x.a}</span>
          <span className="text-right font-medium tabular-nums">{x.b}</span>
        </span>
      ))}
    </span>
  );
}

/** What BFO's AI read: a proposal, labelled as such, to check against the scan. */
function Reading({ r, scanned }: { r: PaperReading; scanned: boolean }) {
  const source = r.fromScan ? "the envelope and the scan" : "the envelope";
  return (
    <div className="flex flex-col gap-3">
      <AiNote kind="read" source={source} />
      <p className="text-body font-medium text-ink">{r.headline}</p>
      <p className="text-small text-ink-2">Check dates and amounts against the scan before acting on them.</p>
      <Rows>
        {r.action && <Row label="To do">{r.action}</Row>}
        {r.dueDate && (
          <Row label="Due" hint="From the scan; check it.">
            {format.date(r.dueDate, "medium")}
          </Row>
        )}
        {(r.taxForm || r.taxYear) && <Row label="Tax">{[r.taxForm, r.taxYear ? `tax year ${r.taxYear}` : null].filter(Boolean).join(" · ")}</Row>}
        {r.amounts.length > 0 && (
          <Row label="Amounts">
            <Pairs items={r.amounts.map((x) => ({ a: x.label, b: x.amount }))} />
          </Row>
        )}
        {r.contents && <Row label="Inside">{r.contents}</Row>}
        {r.dates.length > 0 && (
          <Row label="Dates">
            <Pairs items={r.dates.map((x) => ({ a: x.label, b: x.date }))} />
          </Row>
        )}
        {r.references.length > 0 && (
          <Row label="Numbers">
            <Pairs items={r.references.map((x) => ({ a: x.label, b: x.value }))} />
          </Row>
        )}
      </Rows>
      {!r.fromScan && (
        <p className="text-small text-ink-2">
          {scanned ? "Read from the envelope only: BFO couldn’t read the scan. Open it to see what’s inside." : "Read from the envelope only. Once Stable scans it, what’s inside is read too."}
        </p>
      )}
      <CardSection title="On the envelope">
        <Rows>
          <Row label="From">
            <Party name={r.sender.name} address={r.sender.address} />
          </Row>
          <Row label="To">
            <Party name={r.recipient.name} address={r.recipient.address} />
          </Row>
          {r.postage && <Row label="Postage">{r.postage}</Row>}
          {r.mailClass && <Row label="Class">{r.mailClass}</Row>}
          {r.envelopeText.length > 0 && (
            <Row label="Printed on it">
              <span className="text-small whitespace-pre-wrap text-ink-2">{r.envelopeText.join("\n")}</span>
            </Row>
          )}
        </Rows>
      </CardSection>
    </div>
  );
}

/** One check: what Stable says about it, and where it went. Amounts Stable didn't give plainly aren't guessed. */
function CheckRows({ c, n }: { c: PaperCheck; n: number | null }) {
  const deposit = [c.status ? stage(c.status, "Depositing", "Deposited") : null, c.depositedAt ? format.date(c.depositedAt, "medium") : null].filter(Boolean).join(", ");
  return (
    <div>
      {n && <h3 className="mb-1 text-small font-semibold text-ink">Check {n}</h3>}
      <Rows>
        <Row label="Amount">
          {c.amountCents !== null ? <span className="font-medium tabular-nums">{format.money(c.amountCents / 100)}</span> : <span className="text-ink-3">Not given by Stable</span>}
        </Row>
        {c.payer && <Row label="From">{tidyName(c.payer)}</Row>}
        {c.payee && <Row label="Pay to">{tidyName(c.payee)}</Row>}
        {c.number && <Row label="Check number">{c.number}</Row>}
        {c.date && <Row label="Dated">{/^\d{4}-\d{2}-\d{2}/.test(c.date) ? format.date(c.date.slice(0, 10), "medium") : c.date}</Row>}
        <Row label="Deposit">{deposit || <span className="text-ink-3">Not deposited</span>}</Row>
        {c.account && <Row label="Into">{c.account}</Row>}
      </Rows>
    </div>
  );
}
