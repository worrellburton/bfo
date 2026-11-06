/**
 * A management services agreement: the document as it reads from the
 * record, its terms at a glance, and its signing.
 *
 * The agreement is drawn from the entity's record and the contract's own
 * fields (app/entity/msa-document.ts): parties, addresses, trade name,
 * governing law and the Manager's signer all come from there, never from
 * constants. What the record lacks is listed, and the agreement can't be
 * sent until it's filled in. The pages are drawn in the app (pdf.js), on
 * phones too. Once it's out for signature or signed, the request's own copy
 * is what binds; a banner says so if the record has changed since.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { authFetch, getUser, isAdmin } from "../auth";
import { Badge, Banner, Button, Card, Empty, Page, PageHeader, Row, Rows, Skeleton, Status, format, useDocumentTitle, type MenuItem } from "../ui";
import type { Contract, TradeName } from "../entity/agreements";
import { listRequests } from "../entity/contract-requests";
import { STAGE, familyEntityNamed, feeShort, periodsElapsed, signedDate, stageOf, todayLocal } from "../entity/contract-terms";
import type { Asset, CorpData } from "../entity/model";
import { msaSections, renderMsaPdf, type MsaInput } from "../entity/msa-document";
import { managersOnRecord, trustPeopleOf } from "../entity/people-model";
import { ContractSignature, type RecordSigner, type SignerPair } from "../sign/contract-signature";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import type { SignatureRequest } from "../sign/api";

export function meta() {
  return [{ title: "Agreement · BFO" }];
}

type Rec = Asset & { tradeName?: TradeName | null; corp?: CorpData & { officers?: Record<string, { name: string; title: string; until?: string }> }; trustPeople?: unknown };

/** Who may sign for the entity, read from its record (used when the server's list, with emails, isn't available). */
function signersFrom(a: Rec): RecordSigner[] {
  if (a.type === "Trust")
    return trustPeopleOf(a as Parameters<typeof trustPeopleOf>[0])
      .people.filter((p) => p.role === "trustee")
      .map((p) => ({ name: p.name, title: "Trustee", email: null, source: "The trust’s people" }));
  if (a.type === "C-Corp")
    return Object.values(a.corp?.officers ?? {})
      .filter((o) => !o.until)
      .map((o) => ({ name: o.name, title: o.title, email: null, source: "Officers" }));
  const m = managersOnRecord(a);
  return m.list.map((x) => ({ name: x.name, title: /managing member/i.test(x.role) ? "Managing member" : "Manager", email: null, source: m.source ?? undefined }));
}

export default function ContractPDF() {
  const { id, contractId } = useParams();
  const preview = contractId === "preview";
  const admin = isAdmin();
  const [asset, setAsset] = useState<Rec | null>(null);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; url: string; pages: number } | null>(null);
  const [drawError, setDrawError] = useState("");
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [signers, setSigners] = useState<RecordSigner[] | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(getUser()?.email ?? null);
  const [fitRef, width] = useFitWidth(760, 0);
  const formRef = useRef<HTMLDivElement | null>(null);

  // The entity and the contract, live from the store.
  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let alive = true;
    (async () => {
      const { db, onValue, ref } = await import("../store");
      unsub1 = onValue(ref(db, "assets"), (snap) => {
        const all = (snap.val() ?? {}) as Record<string, Rec>;
        if (!alive) return;
        setAsset(all[id ?? ""] ?? null);
        setEntities(
          Object.entries(all)
            .filter(([k, a]) => k !== id && a?.name)
            .map(([k, a]) => ({ id: k, name: a.name })),
        );
        if (preview) setLoaded(true);
      });
      if (preview) {
        try {
          const draft = JSON.parse(sessionStorage.getItem("bfo.contract.preview") ?? "null") as Contract | null;
          if (draft) setContract({ ...draft, id: "preview" });
        } catch {
          /* nothing to preview */
        }
        return;
      }
      unsub2 = onValue(ref(db, `assets/${id}/contracts/${contractId}`), (snap) => {
        if (!alive) return;
        const data = snap.val();
        setContract(data ? ({ ...data, id: contractId } as Contract) : null);
        setLoaded(true);
      });
    })();
    return () => {
      alive = false;
      unsub1?.();
      unsub2?.();
    };
  }, [id, contractId, preview]);

  // The contract's signature request: the newest that wasn't voided or declined.
  useEffect(() => {
    if (!id || !contractId || preview) return;
    let alive = true;
    listRequests()
      .then((all) => {
        const mine = all
          .filter((r) => r.asset_id === id && r.contract_id === contractId && r.status !== "voided" && r.status !== "declined")
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        if (alive) setRequest(mine[0] ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, contractId, preview]);

  // Who may sign for the entity, with their own emails (owners and admins).
  useEffect(() => {
    if (!id || !admin || preview) return;
    let alive = true;
    authFetch(`/api/members?assetId=${encodeURIComponent(id)}&view=signers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        if (Array.isArray(j.signers)) setSigners(j.signers);
        if (j.me?.email) setMeEmail(j.me.email);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, admin, preview]);

  const input: MsaInput | null = useMemo(() => {
    if (!asset || !contract) return null;
    const legal = contract.masthead === "legal" || (!contract.masthead && !!contract.entityNameOnly);
    const trade = !legal && asset.tradeName?.name ? asset.tradeName.name : null;
    const affiliate = contract.counterpartyType ? contract.counterpartyType === "affiliate" : !!familyEntityNamed(contract.counterparty, entities);
    return {
      manager: { name: asset.name, type: asset.type, state: asset.state, principalOffice: asset.address ?? null, noticeAddress: asset.mailingAddress || asset.address || null, tradeName: trade },
      client: { name: contract.counterparty, state: contract.counterpartyState ?? null, form: contract.counterpartyForm ?? null, affiliate },
      contract: { ...contract, services: contract.services ?? [], masthead: trade ? "trade" : "legal" },
      governingLaw: asset.state ?? "",
      signers: { manager: (signers ?? signersFrom(asset))[0] ?? null, client: null },
    };
  }, [asset, contract, entities, signers]);
  const sections = useMemo(() => (input ? msaSections(input) : null), [input]);

  // Draw the agreement as it reads now: once per change of its words, not per store update.
  const drawKey = useMemo(() => (input ? JSON.stringify(input) : ""), [input]);
  const latest = useRef<{ input: MsaInput | null; sections: typeof sections }>({ input: null, sections: null });
  latest.current = { input, sections };
  useEffect(() => {
    const { input: now, sections: words } = latest.current;
    if (!drawKey || !now || !words) return;
    let alive = true;
    renderMsaPdf(now, words)
      .then(async ({ blob, pages }) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        setPdf({ bytes, url: URL.createObjectURL(blob), pages });
        setDrawError("");
      })
      .catch(() => alive && setDrawError("The agreement couldn’t be drawn. Reload the page to try again."));
    return () => {
      alive = false;
    };
  }, [drawKey]);
  useEffect(() => () => void (pdf && URL.revokeObjectURL(pdf.url)), [pdf]);

  // A request that completed: the contract is signed, as of then.
  useEffect(() => {
    if (!admin || preview || !contract || !request || request.status !== "completed" || contract.signedOn) return;
    const on = signedDate(contract, request);
    if (!on) return;
    void import("../store").then(({ db, ref, update }) => update(ref(db, `assets/${id}/contracts/${contractId}`), { signedOn: on, status: "active", signatureRequestId: request.id }).catch(() => {}));
  }, [admin, preview, contract, request, id, contractId]);

  const counterparty = contract?.counterparty ?? "";
  useDocumentTitle(counterparty ? `MSA with ${counterparty}` : "Agreement", asset?.name, "Entities");

  const back = { to: `/assets/${encodeURIComponent(id ?? "")}/agreements`, label: asset?.name ?? "Contracts" };
  if (!loaded) {
    return (
      <Page header={<PageHeader title="Management services agreement" back={back} />}>
        <Skeleton kind="card" />
      </Page>
    );
  }
  if (!asset || !contract || !input || !sections) {
    return (
      <Page width="reading" header={<PageHeader title="Management services agreement" back={back} />}>
        <Empty size="page" title={preview ? "Nothing to preview" : "We couldn’t find that agreement"}>
          {preview ? "Open the preview from the contract form, with a counterparty filled in." : "It may have been deleted, or the link is from another entity."}
        </Empty>
      </Page>
    );
  }

  const stage = preview ? "draft" : stageOf(contract, request);
  const signed = signedDate(contract, request);
  const elapsed = !signed ? periodsElapsed(contract, todayLocal()) : null;
  const trade = asset.tradeName;
  const tradeUnfiled = input.manager.tradeName && !trade?.filedOn;
  const sentTerms = (contract as Contract & { sentTerms?: Record<string, unknown> }).sentTerms;
  const changedSinceSent = !!request && !!sentTerms && JSON.stringify(sentTerms) !== JSON.stringify(termsOf(contract));
  const allSigners = signers ?? signersFrom(asset);
  const canSend = admin && !preview && !request && (stage === "draft" || stage === "unsigned-active");
  const filename = `Management Services Agreement - ${counterparty}.pdf`.replace(/[^a-zA-Z0-9 .\-&]/g, "").replace(/\s+/g, " ");
  const download = () => {
    if (!pdf) return;
    const a = document.createElement("a");
    a.href = pdf.url;
    a.download = filename;
    a.click();
  };
  const menu: MenuItem[] = pdf ? [{ label: "Open the PDF in a new tab", icon: "external", onSelect: () => window.open(pdf.url, "_blank", "noopener") }] : [];
  const openForm = () => {
    setShowForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const build = async (pair: SignerPair) => renderMsaPdf({ ...input, signers: { manager: pair.manager, client: pair.client } });
  const afterSend = (r: SignatureRequest) => {
    void import("../store").then(({ db, ref, update }) =>
      update(ref(db, `assets/${id}/contracts/${contractId}`), { sentAt: Date.now(), sentTerms: termsOf(contract), signatureRequestId: r.id }).catch(() => {}),
    );
  };

  return (
    <Page
      header={
        <PageHeader
          title="Management services agreement"
          back={back}
          context={[`${asset.name} and ${counterparty}`, feeShort(contract) || "No fee yet", preview ? "Preview of an unsaved draft" : STAGE[stage].label].join(" · ")}
          primary={
            canSend && !showForm ? (
              <Button variant="primary" onClick={openForm}>
                Send for signature
              </Button>
            ) : undefined
          }
          secondary={
            <Button icon="download" onClick={download} disabled={!pdf}>
              Download PDF
            </Button>
          }
          menu={menu}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {sections.gaps.length > 0 && !preview && (
          <Banner tone="warning">
            The record is missing {format.list(sections.gaps)}.{" "}
            {sections.gaps.some((g) => g.includes("principal office") || g.includes("governing law")) ? "Add it on the entity’s Overview" : "Add it in the contract’s terms"}; the agreement can’t go
            out until it’s there.
          </Banner>
        )}
        {changedSinceSent && (
          <Banner tone="warning">
            The terms on record changed after this was sent for signature. The pages below are drawn from today’s record; the copy that was sent (and signed) is the one that binds.
          </Banner>
        )}
        {tradeUnfiled && <Banner tone="info">The trade name {trade?.name} has no filing date on record. Confirm it’s filed with the state before the agreement says “doing business as”.</Banner>}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 min-w-0 lg:order-1">
          <div ref={fitRef} className="rounded-card bg-sunken p-4 touch:p-2">
            {drawError ? <Banner tone="negative">{drawError}</Banner> : pdf && width ? <PdfPages src={pdf.bytes} width={width} /> : <Skeleton kind="card" />}
          </div>
          {pdf && <p className="mt-2 text-small text-ink-2">{format.count(pdf.pages, "page")}, as it reads from the record today.</p>}
        </div>
        <aside className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <Card title="Terms">
            <Rows>
              <Row label="Manager">
                {asset.name}
                {input.manager.tradeName ? <span className="block text-small text-ink-2">d/b/a {input.manager.tradeName}</span> : null}
              </Row>
              <Row label="Client">
                <span className="inline-flex flex-wrap items-center gap-2">
                  {counterparty}
                  {input.client.affiliate && <Badge>Related party</Badge>}
                </span>
              </Row>
              <Row label="Fee">{feeShort(contract) || undefined}</Row>
              <Row label="Effective">{contract.effectiveDate ? format.date(contract.effectiveDate, "medium") : undefined}</Row>
              <Row label="Term">{contract.term || undefined}</Row>
              <Row label="Governing law">{asset.state || undefined}</Row>
              <Row label="Status">
                <Status tone={STAGE[stage].tone}>{preview ? "Preview" : STAGE[stage].label}</Status>
                {signed && <span className="block text-small text-ink-2">Signed {format.date(signed, "medium")}</span>}
              </Row>
            </Rows>
          </Card>
          {!preview && (
            <div ref={formRef}>
              <ContractSignature
                request={request}
                open={showForm}
                onClose={() => setShowForm(false)}
                onChange={setRequest}
                title={`Management Services Agreement - ${counterparty}`}
                assetId={id ?? ""}
                contractId={contractId ?? ""}
                managerEntity={asset.name}
                client={{ name: counterparty }}
                signers={allSigners}
                me={{ name: getUser()?.name ?? null, email: meEmail }}
                build={build}
                brand={input.manager.tradeName ? null : asset.name}
                blockers={sections.gaps.filter((g) => !g.includes("signs for"))}
                note={
                  elapsed && elapsed.periods > 0 && contract.effectiveDate
                    ? `Effective ${format.date(contract.effectiveDate, "medium")}: signing now makes ${format.count(elapsed.periods, elapsed.unit)} of fees due${elapsed.amount !== null ? ` (${format.money(elapsed.amount)})` : ""}.`
                    : null
                }
                onSent={afterSend}
              />
            </div>
          )}
        </aside>
      </div>
    </Page>
  );
}

/** The terms as sent, to tell later whether the record moved away from the copy that went out. */
function termsOf(c: Contract) {
  return {
    counterparty: c.counterparty,
    amount: c.amount ?? null,
    fee: c.fee ?? null,
    frequency: c.frequency ?? null,
    effectiveDate: c.effectiveDate ?? null,
    term: c.term ?? null,
    services: c.services ?? [],
    referralCredit: !!c.referralCredit,
    referralTerms: c.referralTerms ?? null,
    masthead: c.masthead ?? null,
  };
}
