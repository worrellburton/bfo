/**
 * The papers BFO drafts for closing an entity (app/entity-closing.ts): the
 * owners' written consent to dissolve, and the letter asking the IRS to close
 * the EIN account. Laid out like the operating agreement: Times, navy
 * headings, captioned signature lines.
 */

import { entityType, stateCode, stateName } from "./entity-paperwork";
import { withdrawalStates } from "./entity-closing";
import { oaInput, type Rec } from "./paperwork-generate";

const NAVY: [number, number, number] = [27, 42, 74];
const MUTED: [number, number, number] = [110, 110, 110];
const RULE: [number, number, number] = [190, 190, 190];

/** The Act that governs dissolving it, where BFO knows it. */
const ACT: Record<string, string> = {
  DE: "the Delaware Limited Liability Company Act, 6 Del. C. § 18-801 et seq.",
  AZ: "the Arizona Limited Liability Company Act, A.R.S. § 29-3701 et seq.",
  NV: "Chapter 86 of the Nevada Revised Statutes, NRS 86.491 et seq.",
};
const FILING: Record<string, { llc: string; corp: string }> = {
  DE: { llc: "Certificate of Cancellation", corp: "Certificate of Dissolution" },
  AZ: { llc: "Articles of Termination", corp: "Articles of Dissolution" },
  NV: { llc: "Certificate of Dissolution", corp: "Certificate of Dissolution" },
};

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** A person who puts pen to paper for a signer, with the capacity they sign in. */
export type Signatory = { name: string; title: string };

/**
 * One party's signature block. A company signs through whoever runs it:
 * `through` is that chain, top down ("Ledger Louise, LLC, its Manager"),
 * and `signatories` the people at the end of it, one line each. A company
 * BFO knows nothing about gets a blank "authorized signature" line instead.
 */
export type ConsentSigner = { name: string; capacity: string; through: string[]; signatories: Signatory[] };

type ConsentDoc = {
  title: string;
  subtitle: string;
  intro: string;
  resolutions: { heading: string; text: string }[];
  signers: ConsentSigner[];
  schedule: [string, string][];
};

/** A record by its name, as the entity page keeps them (app/entity/use-entity.tsx). */
export type ByName = (name: string) => Rec | undefined;

/** "Robert W. Burton (Robert Worrell Burton)" → "Robert W. Burton"; "X, LLC (Manager; signs through …)" → "X, LLC". */
const bareName = (s: string) =>
  s
    .replace(/\s*\(.*$/s, "")
    .replace(/[;,]\s*$/, "")
    .trim();

/** Who runs a record: its managers on the Owners tab, else the managers its documents name, else (member-managed) its members. */
function runBy(rec: Rec): { names: string[]; title: string } {
  const listed = (rec.members ?? []).filter((m) => /manager/i.test(m.role ?? "") && m.percent == null).map((m) => bareName(m.name));
  if (listed.length) return { names: listed, title: "Manager" };
  const profiled = (rec.profile?.managers ?? []).map(bareName).filter(Boolean);
  if (profiled.length) return { names: profiled, title: /trustee/i.test(rec.profile?.management ?? "") ? "Trustee" : "Manager" };
  const members = (rec.members ?? []).filter((m) => m.percent != null).map((m) => bareName(m.name));
  return { names: members, title: "Member" };
}

/**
 * Who actually signs for a named party, following the records up through
 * every company that runs it until people are reached. Each company along
 * the way is a "By:" line; each person a signature line. A company whose
 * managers all act together (Ledger Louise's four) gets a line for each,
 * because its agreement needs all of them unless one has been delegated.
 */
export function signingChain(name: string, byName: ByName, depth = 0): { through: string[]; signatories: Signatory[] } {
  const rec = byName(name);
  if (!rec?.name || depth > 4) return { through: [], signatories: [] };
  // Signers set on the record win over whoever its documents say runs it.
  const set = (rec.authorizedSigners ?? []).filter((s) => s?.name?.trim());
  if (set.length) return { through: [], signatories: set.map((s) => ({ name: s.name.trim(), title: `${s.title?.trim() || "Authorized Representative"}, ${rec.name}` })) };
  const { names, title } = runBy(rec);
  const out = { through: [] as string[], signatories: [] as Signatory[] };
  for (const n of names) {
    if (isCompany(n)) {
      const sub = signingChain(n, byName, depth + 1);
      out.through.push(`${n}, its ${title}`, ...sub.through);
      // A company BFO can't follow further still needs a hand: one blank line for its representative.
      out.signatories.push(...(sub.signatories.length ? sub.signatories : [{ name: "", title: `Authorized Representative, ${n}` }]));
    } else {
      out.signatories.push({ name: n, title: `${title}, ${rec.name}` });
    }
  }
  return out;
}

/** The written consent to dissolve, from the owners on record; `byName` lets it follow an owner that's a company here up to the people who sign for it. */
export function dissolutionConsent(entity: Rec & { name: string }, lookup: (id: string) => Rec | undefined, byName: ByName = () => undefined): ConsentDoc {
  const corp = entityType(entity) === "C-Corp";
  const st = stateCode(entity.state) ?? "";
  const stName = stateName(st) || entity.state || "its state";
  const input = oaInput(entity, lookup);
  const members = input.members;
  const holders = corp ? "Shareholders" : "Members";
  const holder = corp ? "Shareholder" : "Member";
  const filing = FILING[st] ? (corp ? FILING[st].corp : FILING[st].llc) : corp ? "articles of dissolution" : "certificate of cancellation";
  const withdraw = withdrawalStates(entity as never).map((c) => stateName(c));
  const acting = corp ? "the Board of Directors and the Shareholders" : input.managed === "managers" && input.managers.length ? `the Manager${input.managers.length > 1 ? "s" : ""}` : `the ${holders}`;
  const act = corp ? `the corporation law of ${stName}` : (ACT[st] ?? `the limited liability company act of ${stName}`);
  return {
    title: corp ? "Joint Written Consent of the Board and Shareholders" : `Written Consent of the ${holders}`,
    subtitle: `of ${entity.name}, a ${stName} ${corp ? "corporation" : "limited liability company"}, to dissolve the ${corp ? "Corporation" : "Company"}`,
    intro: `The undersigned, being ${corp ? "all of the directors and all of the shareholders" : `all of the ${holders.toLowerCase()}`} of ${entity.name} (the "${corp ? "Corporation" : "Company"}"), acting by written consent without a meeting as permitted by ${act} and the ${corp ? "Corporation's bylaws" : "Company's operating agreement"}, adopt the following resolutions, effective as of the date of the last signature below.`,
    resolutions: [
      {
        heading: "Dissolution",
        text: `RESOLVED, that the ${corp ? "Corporation" : "Company"} be dissolved and its affairs wound up in accordance with ${act}${corp ? "" : " and the Company's operating agreement"}.`,
      },
      {
        heading: "Winding up",
        text: `RESOLVED, that ${acting} shall wind up the ${corp ? "Corporation's" : "Company's"} affairs: collect what is owed to it, pay or make reasonable provision for its debts and obligations, and distribute its remaining assets to the ${holders} in proportion to their interests set out in Schedule A.`,
      },
      {
        heading: "Filings and accounts",
        text: `RESOLVED, that ${acting} shall file the ${filing} with the ${stName} Secretary of State${withdraw.length ? `, a withdrawal of its registration in ${withdraw.join(" and ")}` : ""}, and its final federal and state tax returns, and shall close its bank and other accounts once its affairs are wound up.`,
      },
      {
        heading: "Authority",
        text: `RESOLVED, that each ${corp ? "director and officer" : holder} is authorized to sign and deliver any document, and to take any action, needed to carry out these resolutions, and that any such action already taken is ratified and approved.`,
      },
    ],
    signers: members.map((m) => ({
      name: m.name,
      capacity: corp ? "Shareholder" : members.length === 1 ? "Sole Member" : "Member",
      ...(isCompany(m.name) ? signingChain(m.name, byName) : { through: [], signatories: [] }),
    })),
    schedule: members.map((m) => [m.name, pct(m.percent)]),
  };
}

/** Shared page furniture: margins, a paragraph writer, page breaks, footers. */
async function sheet() {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 72;
  const width = W - M * 2;
  const st = { y: M };
  const color = (c: [number, number, number]) => pdf.setTextColor(c[0], c[1], c[2]);
  const font = (style: "normal" | "bold" | "italic", size: number, c: [number, number, number] = [26, 26, 26]) => {
    pdf.setFont("times", style);
    pdf.setFontSize(size);
    color(c);
  };
  const room = (h: number) => {
    if (st.y + h > H - 76) {
      pdf.addPage();
      st.y = 86;
    }
  };
  const para = (text: string, opts: { size?: number; style?: "normal" | "bold" | "italic"; gap?: number; align?: "left" | "justify" | "center" } = {}) => {
    const size = opts.size ?? 11;
    font(opts.style ?? "normal", size);
    const lines: string[] = pdf.splitTextToSize(text, width);
    const lh = size * 1.45;
    lines.forEach((line, k) => {
      room(lh);
      const justify = opts.align === "justify" && k < lines.length - 1;
      pdf.text(line, opts.align === "center" ? W / 2 : M, st.y, { align: opts.align === "center" ? "center" : justify ? "justify" : "left", maxWidth: justify ? width : undefined });
      st.y += lh;
    });
    st.y += opts.gap ?? 8;
  };
  const caps = (text: string, x: number, y: number, size: number, c: [number, number, number], align: "left" | "center" = "left", bold = true) => {
    font(bold ? "bold" : "normal", size, c);
    const t = text.toUpperCase();
    const sp = size * 0.12;
    const w = pdf.getTextWidth(t) + sp * (t.length - 1);
    pdf.text(t, align === "center" ? x - w / 2 : x, y, { charSpace: sp });
  };
  const line = (x: number, y: number, w: number, caption: string, prefix?: string) => {
    let lx = x;
    if (prefix) {
      font("normal", 10.5);
      pdf.text(prefix, x, y - 3);
      lx = x + pdf.getTextWidth(prefix) + 6;
    }
    pdf.setDrawColor(60, 60, 60);
    pdf.setLineWidth(0.6);
    pdf.line(lx, y, x + w, y);
    caps(caption, lx, y + 11, 6.8, MUTED, "left", false);
  };
  const footers = (left: string) => {
    const n = pdf.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      pdf.setPage(p);
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.4);
      pdf.line(M, H - 54, W - M, H - 54);
      font("normal", 8.5, MUTED);
      pdf.text(left, M, H - 40);
      pdf.text(`Page ${p} of ${n}`, W - M, H - 40, { align: "right" });
    }
  };
  return { pdf, W, H, M, width, st, font, para, caps, line, room, footers };
}

export const isCompany = (name: string) => /\b(llc|l\.l\.c\.|inc\.?|corp\.?|corporation|trust|lp|l\.p\.|ltd\.?|company|partners(hip)?)\b/i.test(name);

export async function dissolutionConsentPdf(d: ConsentDoc, entityName: string): Promise<Blob> {
  const s = await sheet();
  const { pdf, W, M, width, st } = s;
  st.y = 112;
  s.caps("Action by written consent", W / 2, st.y, 9, MUTED, "center");
  st.y += 28;
  s.font("bold", 18, NAVY);
  for (const l of pdf.splitTextToSize(d.title.toUpperCase(), width) as string[]) {
    pdf.text(l, W / 2, st.y, { align: "center", charSpace: 0.8 });
    st.y += 22;
  }
  s.font("italic", 12, [26, 26, 26]);
  for (const l of pdf.splitTextToSize(d.subtitle, width) as string[]) {
    pdf.text(l, W / 2, st.y, { align: "center" });
    st.y += 16;
  }
  st.y += 6;
  pdf.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.setLineWidth(1.2);
  pdf.line(W / 2 - 36, st.y, W / 2 + 36, st.y);
  st.y += 34;
  s.para(d.intro, { align: "justify", gap: 18 });
  d.resolutions.forEach((r, i) => {
    s.room(70);
    s.caps(`Resolution ${i + 1}`, M, st.y, 8.5, MUTED);
    st.y += 15;
    s.font("bold", 12, NAVY);
    pdf.text(r.heading, M, st.y);
    st.y += 7;
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.5);
    pdf.line(M, st.y, M + width, st.y);
    st.y += 16;
    s.para(r.text, { align: "justify", gap: 12 });
  });

  // Signatures: a block per signer, two across; a company that signs through
  // people gets the full width and a line for each of them.
  st.y += 10;
  s.room(60);
  const several = d.signers.some((sg) => sg.signatories.length > 1);
  s.para(
    `IN WITNESS WHEREOF, the undersigned ${d.signers.length === 1 ? "has" : "have"} signed this consent${
      several ? ", each company by the person or persons who act for it under its own operating agreement" : ""
    }. It may be signed in counterparts and by electronic signature.`,
    { align: "justify", gap: 18 },
  );
  const wide = d.signers.length === 1 || d.signers.some((sg) => sg.signatories.length > 0);
  const colW = wide ? (d.signers.length === 1 && !d.signers[0].signatories.length ? width * 0.62 : width) : (width - 24) / 2;
  const per = wide ? 1 : 2;
  const blockH = (sg: ConsentSigner) => {
    if (!isCompany(sg.name)) return 150;
    if (!sg.signatories.length) return 196;
    return 68 + sg.through.length * 15 + 26 + sg.signatories.length * 46;
  };
  for (let k = 0; k < d.signers.length; k += per) {
    const row = d.signers.slice(k, k + per);
    const h = Math.max(...row.map(blockH));
    s.room(h + 20);
    row.forEach((sg, j) => {
      const x = M + j * (colW + 24);
      const top = st.y;
      const pad = 16;
      const inner = colW - pad * 2;
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.6);
      pdf.roundedRect(x, top, colW, blockH(sg), 3, 3);
      pdf.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
      pdf.rect(x, top, 3, blockH(sg), "F");
      let y = top + pad + 8;
      s.caps(sg.capacity, x + pad, y, 7.5, MUTED);
      y += 17;
      s.font("bold", 12.5);
      pdf.text((pdf.splitTextToSize(sg.name, inner) as string[])[0], x + pad, y);
      const half = (inner - 14) / 2;
      if (isCompany(sg.name) && sg.signatories.length) {
        // The chain it signs through, then a line per person at the end of it.
        y += 16;
        s.font("normal", 10.5);
        for (const t of sg.through) {
          pdf.text(`By: ${t}`, x + pad, y);
          y += 15;
        }
        y += 28;
        const sigW = Math.round(inner * 0.62);
        for (const p of sg.signatories) {
          s.line(x + pad, y, sigW, p.name ? `${p.name}, ${p.title}` : p.title, "By:");
          s.line(x + pad + sigW + 14, y, inner - sigW - 14, "Date");
          y += 46;
        }
      } else if (isCompany(sg.name)) {
        y += 44;
        s.line(x + pad, y, inner, "Authorized signature", "By:");
        y += 40;
        s.line(x + pad, y, half, "Printed name");
        s.line(x + pad + half + 14, y, half, "Title");
        y += 40;
        s.line(x + pad, y, half, "Date");
      } else {
        y += 44;
        s.line(x + pad, y, inner, "Signature");
        y += 40;
        s.line(x + pad, y, half, "Date");
      }
    });
    st.y += h + 20;
  }

  // Schedule A
  if (d.schedule.length) {
    s.room(80 + d.schedule.length * 26);
    st.y += 6;
    s.caps("Schedule A", M, st.y, 8.5, MUTED);
    st.y += 15;
    s.font("bold", 12, NAVY);
    pdf.text("Interests", M, st.y);
    st.y += 14;
    pdf.setFillColor(242, 244, 248);
    pdf.rect(M, st.y, width, 22, "F");
    s.caps("Name", M + 10, st.y + 14, 7.5, NAVY);
    s.caps("Interest", W - M - 10 - 40, st.y + 14, 7.5, NAVY);
    st.y += 38;
    for (const [n, p] of d.schedule) {
      s.font("normal", 10.5);
      pdf.text(n, M + 10, st.y);
      pdf.text(p, W - M - 10, st.y, { align: "right" });
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.4);
      pdf.line(M, st.y + 8, W - M, st.y + 8);
      st.y += 24;
    }
  }
  s.footers(`Consent to dissolve ${entityName}`);
  return pdf.output("blob");
}

type EinLetter = { name: string; ein: string; address: string; reason: string; type: string; mailTo: string[] };

/** The IRS's address for closing a business account, as its "Closing a business" page gives it. */
const IRS_CLOSE_ACCOUNT = ["Internal Revenue Service", "MS 6055", "Kansas City, MO 64108"];

export function einLetter(entity: Rec & { name: string }, dissolvedOn?: string | null): EinLetter {
  const type = entityType(entity);
  const kind = type === "C-Corp" ? "corporation" : type === "LP" ? "partnership" : type === "Trust" ? "trust" : "limited liability company";
  const when = dissolvedOn ? ` on ${longDate(new Date(`${dissolvedOn}T12:00:00`))}` : "";
  return {
    name: entity.name,
    ein: (entity.ein ?? "").trim(),
    address: (entity.mailingAddress || entity.address || "").trim(),
    type: kind,
    reason: `The ${kind} has been dissolved${when} and has ceased doing business.`,
    mailTo: IRS_CLOSE_ACCOUNT,
  };
}

export async function einLetterPdf(l: EinLetter): Promise<Blob> {
  const s = await sheet();
  const { pdf, M, st } = s;
  st.y = 96;
  s.font("bold", 12, NAVY);
  pdf.text(l.name, M, st.y);
  st.y += 15;
  s.font("normal", 10.5);
  for (const part of l.address.split(/,\s*(?=[^,]+,\s*[A-Z]{2}\s+\d{5})/)) {
    pdf.text(part, M, st.y);
    st.y += 13;
  }
  st.y += 22;
  pdf.text(longDate(new Date()), M, st.y);
  st.y += 30;
  for (const part of l.mailTo) {
    pdf.text(part, M, st.y);
    st.y += 13;
  }
  st.y += 22;
  s.font("bold", 11);
  pdf.text(`Re: Request to close business account: ${l.name}, EIN ${l.ein}`, M, st.y);
  st.y += 28;
  s.para("To whom it may concern:", { gap: 10 });
  s.para(`Please close the business account of ${l.name}, Employer Identification Number ${l.ein}. ${l.reason} It has filed its final return and has no further federal filing requirements.`, {
    align: "justify",
    gap: 10,
  });
  s.para("A copy of the EIN assignment notice is enclosed. Please send any correspondence about this request to the address above.", { align: "justify", gap: 10 });
  s.para("Thank you.", { gap: 30 });
  s.para("Sincerely,", { gap: 46 });
  const w = (pdf.internal.pageSize.getWidth() - M * 2) * 0.5;
  s.line(M, st.y, w, "Signature");
  st.y += 40;
  s.line(M, st.y, (w - 14) / 2, "Printed name");
  s.line(M + (w - 14) / 2 + 14, st.y, (w - 14) / 2, "Title");
  st.y += 48;
  s.font("italic", 9.5, MUTED);
  pdf.text(`Enclosure: EIN assignment notice (CP 575 or 147C) for ${l.name}`, M, st.y);
  return pdf.output("blob");
}
