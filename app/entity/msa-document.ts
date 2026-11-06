/**
 * The management services agreement, from the record: its words
 * (msaSections, pure and tested in tests/msa-document.test.ts) and its PDF
 * (renderMsaPdf, jsPDF in the browser).
 *
 * Every party fact comes from the entity's record or the contract's own
 * fields: the Manager's legal name, form and state, its principal office and
 * notice address, its trade name (only when one is on record), the signer
 * and their title; the Client's name, form and state. Nothing about a
 * particular family entity is written here. What's missing is reported in
 * `gaps`, and the contract page won't send an agreement that has any.
 *
 * Money and dates are written the way a signed instrument writes them:
 * "$8,000.00 (eight thousand dollars) per month", "July 1, 2026". The page
 * is white, so it prints clean.
 */

import type { SignField } from "../sign/api";
import { ADVISORY_SERVICES, TERM_AUTO, billingPeriod, feeClause, feeShort, longDate, partyDescription, entityForm, type ContractTerms } from "./contract-terms";

export type MsaParty = {
  name: string;
  /** "limited liability company", "corporation"… */
  form?: string | null;
  state?: string | null;
};

export type MsaSigner = { name: string; title: string };

export type MsaInput = {
  manager: MsaParty & {
    /** The entity type on record ("LLC"), turned into its form when `form` isn't given. */
    type?: string | null;
    principalOffice?: string | null;
    noticeAddress?: string | null;
    /** The trade name on record ("doing business as"), printed only when there is one. */
    tradeName?: string | null;
  };
  client: MsaParty & { affiliate: boolean };
  contract: ContractTerms & {
    services: string[];
    referralCredit?: boolean;
    /** How the referral fee is worked out, in words ("10% of the referred client's first-year fees"). */
    referralTerms?: string | null;
    /** The masthead: the trade name, or the legal name alone. */
    masthead?: "trade" | "legal" | null;
  };
  /** The state whose law governs: the Manager's home state unless the contract says otherwise. */
  governingLaw: string;
  signers?: { manager?: MsaSigner | null; client?: MsaSigner | null };
};

export type MsaParagraph = { text: string; indent?: boolean };
export type MsaArticle = { heading: string; paragraphs: MsaParagraph[] };

export type MsaSections = {
  title: string;
  /** The masthead: the trade name when it's chosen and on record, else the Manager's legal name. */
  masthead: string;
  /** The parties, for the line under the title. */
  between: string;
  /** Effective date, price and term, for the strip under the title. */
  strip: string[];
  recital: string;
  articles: MsaArticle[];
  witness: string;
  /** What the record lacks for this agreement to go out; empty when it can. */
  gaps: string[];
};

// Older contracts stored two separate AI services that are now one line.
const SERVICE_ALIASES: Record<string, string> = {
  "AI & Technology Management": "AI, Automation & Technology Management",
  "AI Agent & Automation Development": "AI, Automation & Technology Management",
};

/** The services in order, old names folded into new and each once. */
export function serviceLines(services: string[]): string[] {
  const seen = new Set<string>();
  return (services ?? []).map((s) => SERVICE_ALIASES[s] || s).filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

/** The agreement's words, from the record. Pure. */
export function msaSections(input: MsaInput): MsaSections {
  const { manager, client, contract } = input;
  const gaps: string[] = [];
  const mForm = manager.form || entityForm(manager.type);
  const managerDesc = partyDescription(manager.name, manager.state, mForm);
  const trade = manager.tradeName?.trim() || "";
  const dba = trade ? `, doing business as ${trade}` : "";
  const clientDesc = partyDescription(client.name, client.state, client.form);
  const effective = longDate(contract.effectiveDate);
  const fee = feeClause(contract);
  const services = serviceLines(contract.services);
  const law = input.governingLaw.trim();

  if (!manager.principalOffice?.trim()) gaps.push("the Manager’s principal office");
  if (!effective) gaps.push("an effective date");
  if (!fee) gaps.push("a fee");
  if (!services.length) gaps.push("at least one service");
  if (!law) gaps.push("the governing law (the entity’s home state)");
  if (!input.signers?.manager?.name?.trim()) gaps.push("who signs for the Manager");
  if (contract.referralCredit && !contract.referralTerms?.trim()) gaps.push("how the referral fee is worked out");

  const notice = manager.noticeAddress?.trim() || manager.principalOffice?.trim() || "";
  const principal = manager.principalOffice?.trim() || "";

  const recital =
    `This Management Services Agreement (the “Agreement”) is made by and between ${managerDesc}${dba} (“Manager”), and ${clientDesc} (“Client”). ` +
    `It is entered into on the date it is last signed below and is effective as of ${effective || "the date it is last signed below"} (the “Effective Date”). ` +
    (client.affiliate
      ? "Manager provides management, administrative and advisory services to entities affiliated with it, and Client, an affiliate of Manager, wishes to retain Manager to provide the services described below. "
      : "Manager provides management and administrative services, and Client wishes to retain Manager to provide the services described below. ") +
    "In consideration of the mutual promises below, the parties agree as follows.";

  const articles: MsaArticle[] = [];
  const art = (heading: string, ...paragraphs: (MsaParagraph | string | null | false | undefined)[]) =>
    articles.push({ heading, paragraphs: paragraphs.filter((p): p is MsaParagraph | string => !!p).map((p) => (typeof p === "string" ? { text: p } : p)) });

  const advisory = services.some((s) => ADVISORY_SERVICES.has(s) || /tax|account|cfo|bank|financ/i.test(s));
  art(
    "Article I · Services",
    "1.1  Manager shall provide Client the following services (the “Services”):",
    ...services.map((s) => ({ text: `—   ${s}`, indent: true })),
    "1.2  Manager shall perform the Services in a professional and workmanlike manner consistent with generally accepted industry standards.",
    "1.3  Manager is an independent contractor. Nothing in this Agreement makes either party the partner, joint venturer, employee or agent of the other, and Manager has no authority to bind Client except as Client authorizes in writing.",
    advisory &&
      "1.4  The Services do not include legal advice, the preparation or signing of tax returns as a paid preparer, audit, review or other attest services, or advice about investing in securities. Where the Services touch legal or tax matters, Manager works with Client’s own licensed advisers, and Client relies on their advice.",
    `${advisory ? "1.5" : "1.4"}  Manager acts on Client’s bank and other accounts only as Client authorizes in writing and within the limits Client sets. Manager never holds Client’s funds or securities for its own account.`,
  );

  const n = (k: number) => `2.${k}`;
  let k = 1;
  art(
    "Article II · Compensation",
    `${n(k++)}  Client shall pay Manager ${fee ?? "the fee stated on the signature page"} (the “Management Fee”) for the Services.`,
    `${n(k++)}  Manager will invoice Client ${billingPeriod(contract.frequency)}, and Client shall pay each invoice within thirty (30) days of receiving it. Client reimburses reasonable out-of-pocket expenses only when it has approved them in advance in writing. Any sales or use tax on the Services is Client’s; each party is otherwise responsible for its own taxes.`,
    `${n(k++)}  Manager will give Client a completed IRS Form W-9 before Client’s first payment.`,
    contract.referralCredit &&
      `${n(k++)}  Referral credit. If Client refers a prospective client to Manager and the referral results in a signed engagement between Manager and that party, Manager will owe Client a referral fee of ${contract.referralTerms?.trim() || "the amount the parties agree in writing"} (the “Referral Fee”). Instead of paying it in cash, Manager will credit the Referral Fee against the Management Fee on Client’s next invoices until it is used up. Each party will still invoice and record the full Management Fee and the full Referral Fee; neither is netted against the other. Client represents that accepting a Referral Fee is permitted by any professional rules that apply to it, and that it has made any disclosure and obtained any consent those rules require.`,
  );

  const term = (contract.term ?? "").toLowerCase();
  art(
    "Article III · Term and termination",
    term.includes("month")
      ? "3.1  This Agreement begins on the Effective Date and continues month to month until either party ends it, for any reason, by thirty (30) days’ written notice to the other."
      : contract.term === TERM_AUTO || term.includes("auto-renew")
        ? "3.1  This Agreement begins on the Effective Date and continues for an initial term of one (1) year (the “Initial Term”). It renews automatically for successive one-year terms unless either party gives written notice of non-renewal at least thirty (30) days before the then-current term ends."
        : "3.1  This Agreement begins on the Effective Date and continues for one (1) year (the “Initial Term”). It does not renew automatically; any renewal requires both parties’ written agreement before the Initial Term ends.",
    "3.2  Either party may terminate this Agreement for cause by written notice describing the breach, if the other party has not cured the breach within thirty (30) days after receiving the notice.",
    "3.3  When this Agreement ends, Manager shall deliver to Client all of Client’s documents, records and materials within fifteen (15) business days, and Client shall pay the Management Fee earned through the end date.",
  );

  art(
    "Article IV · Confidentiality",
    "4.1  Each party may receive confidential information of the other in performing this Agreement. Each shall keep that information confidential, use it only for this Agreement, and not disclose it to any third party without the disclosing party’s prior written consent, except as the law requires.",
    "4.2  These obligations continue for three (3) years after this Agreement ends, and for as long as any trade secret remains one.",
  );

  art(
    "Article V · Indemnification and limits of liability",
    "5.1  Each party shall indemnify, defend and hold harmless the other from third-party claims, damages, losses and expenses arising from its breach of this Agreement, its negligence or its willful misconduct.",
    "5.2  Except for a party’s obligations under Section 5.1 or Article IV, or its gross negligence, fraud or willful misconduct: (a) neither party is liable to the other for indirect, incidental, consequential, special or punitive damages; and (b) each party’s total liability under this Agreement is limited to the Management Fees paid or payable in the twelve (12) months before the claim arose.",
  );

  art(
    "Article VI · Notices",
    "6.1  Notices under this Agreement must be in writing and are given when delivered by hand, by a national overnight courier, or by email with confirmation of receipt, to the addresses below. A party may change its address by notice to the other.",
    notice
      ? `6.2  Notices to Manager go to ${notice}.${principal && principal !== notice ? ` Manager’s principal office is ${principal}.` : ""} Notices to Client go to the address Client gives Manager in writing.`
      : "6.2  Notices go to the address each party gives the other in writing.",
  );

  art(
    "Article VII · Governing law",
    `7.1  This Agreement is governed by the laws of the State of ${law || "the Manager’s formation"}, without regard to its conflict-of-law rules.`,
    `7.2  Any dispute under this Agreement shall be resolved in the state or federal courts located in the State of ${law || "the Manager’s formation"}.`,
  );

  art(
    "Article VIII · General",
    "8.1  This Agreement is the parties’ entire agreement on its subject and replaces all earlier agreements and understandings, written or oral.",
    "8.2  This Agreement may be amended only in a writing signed by both parties.",
    "8.3  Neither party may assign this Agreement without the other’s prior written consent.",
    "8.4  If any provision is held unenforceable, the rest of this Agreement stays in effect, and the provision is enforced to the fullest extent the law allows.",
    "8.5  A party’s failure or delay in enforcing a provision is not a waiver of it.",
    "8.6  This Agreement may be signed in counterparts, each an original, together one agreement. Signatures and records in electronic form, including signatures made through an electronic signature service, have the same effect as handwritten signatures and paper records.",
    "8.7  Articles IV and V, Section 3.3 and any payment owed survive the end of this Agreement.",
  );

  const masthead = contract.masthead === "legal" || !trade ? manager.name : trade;
  return {
    title: "Management Services Agreement",
    masthead,
    between: `${manager.name}  &  ${client.name}`,
    strip: [effective && `Effective ${effective}`, feeShort(contract) && feeShort(contract).replace(/ a /, " per "), contract.term && `Term: ${contract.term}`].filter(Boolean) as string[],
    recital,
    articles,
    witness: "The parties have signed this Agreement on the dates below, effective as of the Effective Date.",
    gaps,
  };
}

/** Where the generated agreement's signature block sits (jsPDF points, y from the top). */
export type SigGeometry = {
  page: number;
  pw: number;
  ph: number;
  left: { x: number; line: number; date: number };
  right: { x: number; line: number; date: number };
  colW: number;
};

/** The fields a contract's signature block needs, from where the generator drew it. Names and titles are printed. */
export function contractFields(g: SigGeometry): SignField[] {
  const f = (party: "a" | "b", type: SignField["type"], x: number, yTop: number, w: number, h: number, id: string): SignField => ({
    id,
    party,
    type,
    page: g.page,
    x: x / g.pw,
    y: yTop / g.ph,
    w: w / g.pw,
    h: h / g.ph,
  });
  const sigH = 40;
  const lineW = g.colW - 20;
  return [
    f("a", "signature", g.left.x, g.left.line - sigH + 2, lineW, sigH, "a-sig"),
    f("b", "signature", g.right.x, g.right.line - sigH + 2, lineW, sigH, "b-sig"),
    f("a", "date", g.left.x + 34, g.left.date - 11, lineW - 34, 13, "a-date"),
    f("b", "date", g.right.x + 34, g.right.date - 11, lineW - 34, 13, "b-date"),
  ];
}

/** The agreement as a PDF: its bytes, page count and where the signature block landed. */
export async function renderMsaPdf(input: MsaInput, s: MsaSections = msaSections(input)): Promise<{ blob: Blob; pages: number; geometry: SigGeometry }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setProperties({ title: `${s.title} - ${input.client.name}`, subject: s.title, author: s.masthead });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 78;
  const mr = pw - 78;
  const tw = mr - ml;
  const ink: [number, number, number] = [24, 24, 27];
  const muted: [number, number, number] = [100, 100, 109];
  const topY = 116;
  const bottomLimit = ph - 84;
  let y = topY;
  let pageNum = 1;

  function header() {
    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(13);
    doc.text(s.masthead, ml, 60);
    const wmW = doc.getTextWidth(s.masthead);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setCharSpace(2);
    doc.setTextColor(...muted);
    if (wmW < tw - 230) doc.text("MANAGEMENT SERVICES AGREEMENT", ml + wmW + 10, 60);
    doc.text(String(pageNum), mr, 60, { align: "right" });
    doc.setCharSpace(0);
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.5);
    doc.line(ml, 74, mr, 74);
    doc.setTextColor(...ink);
  }

  function footer() {
    const fy = ph - 50;
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.5);
    doc.line(ml, fy, mr, fy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(1.2);
    doc.setTextColor(...muted);
    doc.text(`${input.manager.name}  ·  ${input.client.name}`.toUpperCase(), ml, fy + 14);
    doc.setCharSpace(0);
    doc.setTextColor(...ink);
  }

  function newPage() {
    doc.addPage();
    pageNum += 1;
    header();
    footer();
    y = topY;
  }

  const ensure = (space: number) => {
    if (y + space > bottomLimit) newPage();
  };

  function heading(text: string) {
    ensure(48);
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setCharSpace(1.4);
    doc.setTextColor(...ink);
    doc.text(text.toUpperCase(), ml, y);
    doc.setCharSpace(0);
    y += 9;
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.5);
    doc.line(ml, y, mr, y);
    y += 18;
  }

  function para(text: string, indent = 0) {
    const size = 10.5;
    const lead = size * 1.6;
    doc.setFont("times", "normal");
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, tw - indent) as string[]) {
      ensure(lead);
      // A page break runs the header and footer, which leave another font active.
      doc.setFont("times", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...ink);
      doc.text(line, ml + indent, y);
      y += lead;
    }
  }

  header();
  footer();

  // Title block
  doc.setFont("times", "bold");
  doc.setTextColor(...ink);
  let titleSize = 28;
  doc.setFontSize(titleSize);
  while (titleSize > 16 && doc.getTextWidth(s.title) > tw) doc.setFontSize(--titleSize);
  doc.text(s.title, ml, y);
  y += 26;
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(...muted);
  for (const line of doc.splitTextToSize(s.between, tw) as string[]) {
    doc.text(line, ml, y);
    y += 16;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setCharSpace(1.1);
  for (const line of doc.splitTextToSize(s.strip.join("     ").toUpperCase(), tw) as string[]) {
    doc.text(line, ml, y);
    y += 12;
  }
  doc.setCharSpace(0);
  y += 2;
  doc.setDrawColor(...ink);
  doc.setLineWidth(1.2);
  doc.line(ml, y, mr, y);
  doc.setLineWidth(0.5);
  y += 28;

  para(s.recital);
  y += 6;
  for (const a of s.articles) {
    heading(a.heading);
    a.paragraphs.forEach((p, i) => {
      para(p.text, p.indent ? 16 : 0);
      const next = a.paragraphs[i + 1];
      if (next && !(p.indent && next.indent)) y += 6;
    });
  }

  // The signature block, kept together at the foot of the last page.
  doc.setFont("times", "italic");
  doc.setFontSize(10.5);
  const witnessLines = doc.splitTextToSize(s.witness, tw) as string[];
  const witnessH = witnessLines.length * 10.5 * 1.6;
  const sigBlockH = witnessH + 26 + 138;
  // On the last page of text it sits at the foot; on a page of its own, at the top.
  if (y + sigBlockH > bottomLimit) {
    newPage();
    y += 12;
  } else y = bottomLimit - sigBlockH;
  doc.setFont("times", "italic");
  doc.setFontSize(10.5);
  doc.setTextColor(...ink);
  for (const line of witnessLines) {
    doc.text(line, ml, y);
    y += 10.5 * 1.6;
  }
  y += 26;

  const colW = 220;
  const leftX = ml;
  const rightX = mr - colW;
  const rowY = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setCharSpace(1.4);
  doc.setTextColor(...muted);
  doc.text("MANAGER", leftX, rowY);
  doc.text("CLIENT", rightX, rowY);
  doc.setCharSpace(0);
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(doc.splitTextToSize(input.manager.name, colW - 20)[0] as string, leftX, rowY + 18);
  doc.text(doc.splitTextToSize(input.client.name, colW - 20)[0] as string, rightX, rowY + 18);
  if (input.manager.tradeName?.trim()) {
    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(`d/b/a ${input.manager.tradeName.trim()}`, leftX, rowY + 32);
    doc.setTextColor(...ink);
  }
  const sigLineY = rowY + 68;
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.5);
  doc.line(leftX, sigLineY, leftX + colW - 20, sigLineY);
  doc.line(rightX, sigLineY, rightX + colW - 20, sigLineY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setCharSpace(1.4);
  doc.setTextColor(...muted);
  doc.text("AUTHORIZED SIGNATURE", leftX, sigLineY + 11);
  doc.text("AUTHORIZED SIGNATURE", rightX, sigLineY + 11);
  doc.setCharSpace(0);
  const mFill = [input.signers?.manager?.name ?? "", input.signers?.manager?.title ?? "", ""];
  const cFill = [input.signers?.client?.name ?? "", input.signers?.client?.title ?? "", ""];
  ["Name:", "Title:", "Date:"].forEach((f, i) => {
    const fyy = sigLineY + 30 + i * 16;
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...ink);
    doc.text(f, leftX, fyy);
    doc.text(f, rightX, fyy);
    doc.setDrawColor(...muted);
    doc.setLineWidth(0.4);
    doc.line(leftX + 30, fyy + 1, leftX + colW - 20, fyy + 1);
    doc.line(rightX + 30, fyy + 1, rightX + colW - 20, fyy + 1);
    if (mFill[i]) doc.text(doc.splitTextToSize(mFill[i], colW - 56)[0] as string, leftX + 34, fyy - 1);
    if (cFill[i]) doc.text(doc.splitTextToSize(cFill[i], colW - 56)[0] as string, rightX + 34, fyy - 1);
  });

  const geometry: SigGeometry = {
    page: pageNum,
    pw,
    ph,
    left: { x: leftX, line: sigLineY, date: sigLineY + 30 + 2 * 16 },
    right: { x: rightX, line: sigLineY, date: sigLineY + 30 + 2 * 16 },
    colW,
  };
  return { blob: doc.output("blob"), pages: doc.getNumberOfPages(), geometry };
}
