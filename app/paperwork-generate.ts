import { parseAddress } from "./formation";
import { entityType, stateCode, stateName, taxClassOf, type PaperworkInput } from "./entity-paperwork";

/**
 * Paperwork BFO writes itself, from what the entity's record already says:
 *
 * - Form W-9 — the IRS's own fillable PDF (public/forms/fw9.pdf), filled in.
 *   A disregarded LLC's W-9 goes in the name and TIN of the owner that files
 *   (followed up the chain), with the LLC on line 2.
 * - The LLC operating agreement — drafted from the members and percentages on
 *   record, the state's LLC statute and how the LLC is taxed.
 *
 * The content is built as plain data first (tested), then laid out as a PDF.
 * The state's certificate and the IRS's EIN letter are issued, not written:
 * those arrive from Palm.
 */

export type Rec = PaperworkInput & { ownerId?: string; members?: { name: string; percent: number | null; role: string | null }[]; profile?: { purpose?: string | null; management?: string | null; managers?: string[] } | null };

// ── Form W-9 ─────────────────────────────────────────────────────────────

/** The W-9's federal tax classification boxes (line 3a), as the form numbers them. */
export const W9_BOX = { individual: 1, cCorp: 2, sCorp: 3, partnership: 4, trust: 5, llc: 6, other: 7 } as const;

export type W9Data = {
  /** Line 1: whose TIN this is. */
  name: string;
  /** Line 2: the business or disregarded entity's name, when different. */
  business: string;
  box: number;
  /** The LLC box's letter: C, S or P. */
  llcLetter: string;
  street: string;
  cityStateZip: string;
  tin: { kind: "ssn" | "ein"; digits: string } | null;
  /** What couldn't be filled in, and why — said to the person before they sign. */
  notes: string[];
};

const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

/** How an entity that files its own return is classified on the W-9. */
function boxFor(r: Rec): { box: number; llcLetter: string } | null {
  const t = entityType(r);
  const tax = taxClassOf(r).value;
  if (t === "Trust") return tax === "Non-grantor trust" ? { box: W9_BOX.trust, llcLetter: "" } : null;
  if (t === "C-Corp") return { box: tax === "S Corporation" ? W9_BOX.sCorp : W9_BOX.cCorp, llcLetter: "" };
  if (t === "LP") return { box: W9_BOX.partnership, llcLetter: "" };
  if (tax === "Partnership") return { box: W9_BOX.llc, llcLetter: "P" };
  if (tax === "S Corporation") return { box: W9_BOX.llc, llcLetter: "S" };
  if (tax === "C Corporation") return { box: W9_BOX.llc, llcLetter: "C" };
  return null;
}

/** With an owner on record and no count, an LLC is read as single-owner (the IRS default). */
const withOwner = (r: Rec, lookup: (id: string) => Rec | undefined): Rec => {
  const owner = r.ownerId ? lookup(r.ownerId) : undefined;
  return { ...r, ownerCount: r.ownerCount ?? (r.members?.length || undefined), owner: owner ? { name: owner.name, type: owner.type, llcType: owner.llcType } : r.owner };
};

/** What goes on the entity's W-9. `lookup` resolves an owner id to its record. */
export function w9Data(entity: Rec, lookup: (id: string) => Rec | undefined): W9Data {
  const notes: string[] = [];
  const a = withOwner(entity, lookup);
  const addr = parseAddress(entity.address);
  const base = {
    street: addr ? [addr.street1, addr.street2].filter(Boolean).join(", ") : (entity.address ?? "").trim(),
    cityStateZip: addr ? `${addr.city}, ${addr.region} ${addr.postal}` : "",
  };
  if (!addr) notes.push(entity.address ? "The address isn't in a form the W-9 can split; check lines 5 and 6." : "No address on record: fill in lines 5 and 6.");

  if (taxClassOf(a).value !== "Disregarded Entity") {
    const cls = boxFor(a);
    if (!cls) notes.push("The tax classification isn't on record: tick the line 3a box by hand.");
    const ein = digits(entity.ein);
    if (ein.length !== 9) notes.push(entity.ein ? "The EIN on record isn't nine digits." : "No EIN on record yet: it goes in Part I once the IRS issues it.");
    return { name: (entity.name ?? "").trim(), business: "", ...(cls ?? { box: 0, llcLetter: "" }), ...base, tin: ein.length === 9 ? { kind: "ein", digits: ein } : null, notes };
  }

  // Disregarded: the W-9 is the owner's that files, with this LLC on line 2.
  const seen = new Set<string>();
  let cur = entity.ownerId ? lookup(entity.ownerId) : undefined;
  while (cur) {
    const t = entityType(cur);
    const tax = taxClassOf(withOwner(cur, lookup)).value;
    if (t === "Trust" && tax !== "Non-grantor trust") {
      const grantor = (cur.grantors ?? "").split(/,|&|\band\b/)[0].trim();
      notes.push(`A grantor trust owns it, so the W-9 is the grantor's: ${grantor ? `${grantor}'s` : "their"} SSN goes in Part I. BFO doesn't keep SSNs; fill it in before signing.`);
      if (!grantor) notes.push("The grantor's name isn't on the trust's record: fill in line 1.");
      return { name: grantor, business: (entity.name ?? "").trim(), box: W9_BOX.individual, llcLetter: "", ...base, tin: null, notes };
    }
    if (tax !== "Disregarded Entity" || !cur.ownerId || seen.has(cur.ownerId)) {
      const cls = boxFor(withOwner(cur, lookup));
      if (!cls) notes.push(`${cur.name}'s tax classification isn't on record: tick the line 3a box by hand.`);
      const ein = digits(cur.ein);
      if (ein.length !== 9) notes.push(`${cur.name}'s EIN isn't on record: it goes in Part I.`);
      return { name: (cur.name ?? "").trim(), business: (entity.name ?? "").trim(), ...(cls ?? { box: 0, llcLetter: "" }), ...base, tin: ein.length === 9 ? { kind: "ein", digits: ein } : null, notes };
    }
    seen.add(cur.ownerId);
    cur = lookup(cur.ownerId);
  }
  notes.push("Who owns it isn't on record, and a disregarded LLC's W-9 is its owner's: fill in line 1 and Part I.");
  return { name: "", business: (entity.name ?? "").trim(), box: 0, llcLetter: "", ...base, tin: null, notes };
}

/** The IRS's W-9 (Rev. March 2024), filled in. Left editable so it can be checked and signed. */
export async function fillW9(data: W9Data, formBytes: ArrayBuffer): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(formBytes);
  const form = pdf.getForm();
  const P = "topmostSubform[0].Page1[0].";
  const text = (name: string, value: string) => value && form.getTextField(P + name).setText(value);
  text("f1_01[0]", data.name);
  text("f1_02[0]", data.business);
  if (data.box >= 1 && data.box <= 7) form.getCheckBox(`${P}Boxes3a-b_ReadOrder[0].c1_1[${data.box - 1}]`).check();
  text("Boxes3a-b_ReadOrder[0].f1_03[0]", data.llcLetter);
  text("Address_ReadOrder[0].f1_07[0]", data.street);
  text("Address_ReadOrder[0].f1_08[0]", data.cityStateZip);
  if (data.tin?.kind === "ein") {
    text("f1_14[0]", data.tin.digits.slice(0, 2));
    text("f1_15[0]", data.tin.digits.slice(2));
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

// ── LLC operating agreement ──────────────────────────────────────────────

/** Each state's LLC statute, as an agreement cites it. */
const LLC_ACTS: Record<string, string> = {
  AZ: "the Arizona Limited Liability Company Act, A.R.S. § 29-3101 et seq.",
  CA: "the California Revised Uniform Limited Liability Company Act, Cal. Corp. Code § 17701.01 et seq.",
  CO: "the Colorado Limited Liability Company Act, C.R.S. § 7-80-101 et seq.",
  DE: "the Delaware Limited Liability Company Act, 6 Del. C. § 18-101 et seq.",
  FL: "the Florida Revised Limited Liability Company Act, Chapter 605, Florida Statutes",
  IL: "the Illinois Limited Liability Company Act, 805 ILCS 180",
  NV: "Chapter 86 of the Nevada Revised Statutes",
  NY: "the New York Limited Liability Company Law",
  TX: "the Texas Business Organizations Code",
  UT: "the Utah Uniform Limited Liability Company Act, Utah Code § 48-3a-101 et seq.",
  WA: "the Washington Limited Liability Company Act, RCW 25.15",
  WY: "the Wyoming Limited Liability Company Act, W.S. § 17-29-101 et seq.",
};

/** What each state requires an LLC to keep, where the agreement should say so. */
const RECORDS_RULE: Record<string, string> = {
  AZ: " The Company shall keep at its principal office a current list of the full name and last known address of each Member and Manager, as A.R.S. § 29-3410 requires.",
  DE: " Each Member may obtain the information described in 6 Del. C. § 18-305 on reasonable demand.",
};

export type OAMember = { name: string; percent: number; address: string };

export type OAInput = {
  name: string;
  /** Two-letter code. */
  state: string;
  /** YYYY-MM-DD: the agreement's effective date. */
  effective: string;
  address: string;
  registeredAgent: string;
  purpose: string;
  members: OAMember[];
  managed: "members" | "managers";
  managers: string[];
  /** "Disregarded Entity", "Partnership", "S Corporation" or "C Corporation". */
  taxClass: string;
};

export type OADoc = {
  title: string;
  subtitle: string;
  preamble: string;
  sections: { heading: string; paragraphs: string[] }[];
  exhibit: { heading: string; rows: [string, string, string][] };
  signers: { name: string; capacity: string }[];
};

const longDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** What's missing before an operating agreement can be drafted. */
export function oaProblems(i: OAInput): string[] {
  const out: string[] = [];
  if (!i.name.trim()) out.push("The entity needs a name.");
  if (!stateName(i.state)) out.push("Set the state of formation.");
  if (!i.members.length) out.push("Add its owners: the agreement lists each member and their share.");
  const total = Math.round(i.members.reduce((n, m) => n + m.percent, 0) * 100) / 100;
  if (i.members.length && total !== 100) out.push(`The members' shares add up to ${total}%, not 100%.`);
  if (i.members.some((m) => !m.name.trim())) out.push("Every member needs a name.");
  if (i.managed === "managers" && !i.managers.length) out.push("A manager-managed LLC needs its managers named.");
  return out;
}

/** The agreement, as words. */
export function operatingAgreement(i: OAInput): OADoc {
  const st = stateName(i.state);
  const act = LLC_ACTS[i.state] ?? `the limited liability company act of the State of ${st}`;
  const single = i.members.length === 1;
  const sole = i.members[0]?.name ?? "the Member";
  const memberWord = single ? "the Member" : "the Members";
  const managers = i.managed === "managers";
  const majority = single ? "the Member" : "Members holding more than fifty percent (50%) of the Percentage Interests";
  const s = (heading: string, ...paragraphs: string[]) => ({ heading, paragraphs });

  const tax =
    i.taxClass === "Partnership" || (!single && !i.taxClass)
      ? [
          "The Members intend that the Company be classified as a partnership for federal and state income tax purposes, and no Member shall take any action inconsistent with that classification.",
          `Profits and losses shall be allocated among the Members in proportion to their Percentage Interests, subject to Section 704(b) of the Internal Revenue Code and the regulations under it. A capital account shall be maintained for each Member in accordance with those regulations.`,
          `${i.members[0]?.name ?? "The Member holding the largest Percentage Interest"} (or a designated individual acting for it) shall serve as the "partnership representative" under Section 6223 of the Internal Revenue Code until replaced by ${majority}.`,
        ]
      : i.taxClass === "S Corporation" || i.taxClass === "C Corporation"
        ? [`The Company has elected, or shall elect, to be classified as an association taxable as a corporation${i.taxClass === "S Corporation" ? " and to be treated as an S corporation" : ""} for federal income tax purposes, and ${memberWord} shall take no action inconsistent with that election.`]
        : [
            `So long as the Company has a single Member, it is intended to be disregarded as an entity separate from its owner for federal and applicable state income tax purposes, and all items of income, gain, loss, deduction and credit shall be reported by ${sole}.`,
          ];

  const sections = [
    s(
      "Formation",
      `The Company was formed as a limited liability company under ${act} (the "Act") by the filing of its ${i.state === "DE" ? "certificate of formation" : "articles of organization"} with the ${i.state === "DE" ? "Delaware Secretary of State" : `${st} Secretary of State`}. The rights and obligations of ${memberWord} and the administration of the Company are governed by this Agreement and the Act. Where this Agreement and a provision of the Act that may be varied by agreement differ, this Agreement controls.`
    ),
    s("Name", `The name of the Company is ${i.name}. The Company may conduct business under that name or any other name ${managers ? "the Managers determine" : single ? "the Member determines" : "the Members determine"}, after any filing the law requires.`),
    s(
      "Purpose and Powers",
      `${i.purpose.trim() || "The purpose of the Company is to engage in any lawful act or activity for which a limited liability company may be formed under the Act."} The Company has every power the Act grants that is necessary or convenient to that purpose.`
    ),
    s(
      "Offices and Registered Agent",
      `The principal office of the Company is ${i.address || "at such place as " + (single ? "the Member" : "the Members") + " designate"}, or another place ${managers ? "the Managers" : single ? "the Member" : "the Members"} may designate. The Company's registered agent in ${st} is ${i.registeredAgent || "the agent named in its filing with the Secretary of State"}, or any successor appointed in accordance with the Act.`
    ),
    s("Term", "The Company began on the date its formation filing became effective and shall continue until dissolved under this Agreement or the Act."),
    s(
      single ? "Member and Percentage Interest" : "Members and Percentage Interests",
      single
        ? `${sole} is the sole Member of the Company and holds one hundred percent (100%) of the limited liability company interests in the Company (its "Percentage Interest"), as shown on Exhibit A.`
        : `The Members of the Company, and each Member's percentage of the limited liability company interests in the Company (its "Percentage Interest"), are shown on Exhibit A, which ${managers ? "the Managers" : "the Members"} shall update to reflect any admission, transfer or change permitted by this Agreement.`
    ),
    s(
      "Capital Contributions",
      `${single ? "The Member has" : "Each Member has"} made, or shall make, the initial capital contribution reflected in the Company's records. No Member is required to make any additional capital contribution or loan to the Company${single ? "" : ", and no Member shall be paid interest on its contributions"}. A Member may make additional contributions ${single ? "at any time" : `only with the consent of ${majority}`}.`
    ),
    s(
      "Distributions",
      single
        ? `Distributions shall be made to the Member at the times and in the amounts the ${managers ? "Managers determine" : "Member determines"}.`
        : `Distributions shall be made to the Members in proportion to their Percentage Interests, at the times and in the amounts ${managers ? "the Managers determine" : `${majority} determine`}.`,
      "No distribution shall be made if, after giving it effect, the Company could not pay its debts as they become due in the ordinary course of business or its liabilities would exceed its assets, or if the distribution would otherwise violate the Act."
    ),
    s("Tax Classification and Allocations", ...tax),
    s(
      "Management",
      managers
        ? `The Company is manager-managed. Its business and affairs shall be managed by ${i.managers.length === 1 ? `its Manager, ${i.managers[0]}` : `its Managers, ${i.managers.join(", ")}`}, who shall have full authority to act for and bind the Company, except that the consent of ${majority} is required to sell all or substantially all of the Company's assets, merge or convert the Company, amend this Agreement, admit a Member or dissolve the Company. A Manager may be removed or replaced, and additional Managers appointed, by ${majority}. ${i.managers.length > 1 ? "Where there is more than one Manager, decisions shall be made by a majority of them, and each Manager may sign documents for the Company within the authority so given." : ""}`.trim()
        : single
          ? "The Company is member-managed. The Member has full and exclusive authority to manage the business and affairs of the Company and to act for and bind it, and may sign any document on its behalf. The Member may appoint officers and agents with such titles and authority as the Member delegates in writing."
          : `The Company is member-managed. Its business and affairs shall be managed by the Members, acting by the consent of ${majority}, except that the unanimous consent of the Members is required to sell all or substantially all of the Company's assets, merge or convert the Company, amend this Agreement, admit a Member or dissolve the Company. The Members may appoint officers and agents with such titles and authority as they delegate in writing.`
    ),
    s(
      "Limited Liability",
      `Except as the Act otherwise provides, the debts, obligations and liabilities of the Company are solely those of the Company, and no Member${managers ? " or Manager" : ""} is obligated for any of them solely by reason of being a Member${managers ? " or Manager" : ""}. The failure of the Company to observe formalities relating to the exercise of its powers or the management of its business is not a ground for imposing personal liability on any Member${managers ? " or Manager" : ""}.`
    ),
    s(
      "Exculpation and Indemnification",
      `To the fullest extent the Act permits, no Member${managers ? ", Manager" : ""} or officer shall be liable to the Company or any Member for any act or omission in good faith on behalf of the Company, except for fraud, willful misconduct, a knowing violation of law or a breach of this Agreement. The Company shall indemnify and hold harmless each such person against losses, claims and expenses (including reasonable attorneys' fees) arising from the Company's business, and may advance expenses, on the same terms and to the same extent.`
    ),
    s(
      "Transfers and Admission of Members",
      single
        ? "The Member may transfer all or any part of its interest in the Company. A transferee of the Member's entire interest shall be admitted as a Member, and additional Members may be admitted, upon the written consent of the Member and the transferee's agreement to be bound by this Agreement."
        : "No Member may sell, assign, pledge or otherwise transfer all or any part of its interest in the Company without the written consent of the other Members. A transferee shall be admitted as a Member only upon that consent and its written agreement to be bound by this Agreement; until then it holds only the right to receive the distributions to which its transferor would have been entitled. Any transfer in violation of this Section is void."
    ),
    s(
      "Books, Records and Accounts",
      `The Company shall keep complete and accurate books and records of its business at its principal office, on the cash or accrual method its accountants recommend, on a fiscal year ending December 31. The Company's funds shall be kept in its own accounts and shall not be commingled with the funds of any Member.${RECORDS_RULE[i.state] ?? ""}`
    ),
    s(
      "Dissolution",
      `The Company shall be dissolved upon (a) the written election of ${single ? "the Member" : "all of the Members"}, (b) the entry of a decree of judicial dissolution under the Act, or (c) any other event that requires dissolution under the Act${single ? ", except that the death, incapacity or bankruptcy of the Member shall not dissolve the Company if the Member's successor in interest agrees in writing, within ninety days, to continue it" : ""}. On dissolution, the Company's affairs shall be wound up, its debts paid or provided for, and the remaining assets distributed ${single ? "to the Member" : "to the Members in accordance with their positive capital account balances, then in proportion to their Percentage Interests"}.`
    ),
    s(
      "General Provisions",
      `This Agreement shall be governed by the laws of the State of ${st}, without regard to its conflict-of-laws rules. It is the entire agreement of ${memberWord} regarding its subject and may be amended only in a writing signed by ${single ? "the Member" : "all of the Members"}. If any provision is held invalid, the remainder shall continue in effect. This Agreement may be signed in counterparts and by electronic signature, each of which is an original and all of which together are one instrument. It binds and benefits ${memberWord} and their permitted successors and assigns; no creditor of the Company or of any Member may enforce any of its provisions.`
    ),
  ];

  return {
    title: single ? "Single-Member Operating Agreement" : "Operating Agreement",
    subtitle: `of ${i.name}, a ${st} limited liability company`,
    preamble: `This ${single ? "Single-Member " : ""}Operating Agreement (this "Agreement") of ${i.name} (the "Company") is made and entered into effective as of ${longDate(i.effective)} by ${single ? `${sole}, as the sole member of the Company (the "Member")` : `the persons listed on Exhibit A as members of the Company (each a "Member" and together the "Members")`}.`,
    sections,
    exhibit: {
      heading: single ? "Exhibit A: Member" : "Exhibit A: Members and Percentage Interests",
      rows: i.members.map((m) => [m.name, m.address || "—", pct(m.percent)]),
    },
    signers: [
      ...i.members.map((m) => ({ name: m.name, capacity: single ? "Sole Member" : "Member" })),
      ...(managers ? i.managers.filter((n) => !i.members.some((m) => m.name === n)).map((n) => ({ name: n, capacity: "Manager" })) : []),
    ],
  };
}

/** The operating agreement's inputs, from the entity's record and the records of its owners. */
export function oaInput(entity: Rec & { name: string }, lookup: (id: string) => Rec | undefined, today = new Date()): OAInput {
  const owner = entity.ownerId ? lookup(entity.ownerId) : undefined;
  const listed = (entity.members ?? []).filter((m) => !/manager/i.test(m.role ?? "") || m.percent != null);
  const members: OAMember[] = listed.length
    ? listed.map((m) => ({ name: m.name, percent: m.percent ?? (listed.length === 1 ? 100 : 0), address: "" }))
    : owner?.name
      ? [{ name: owner.name, percent: 100, address: "" }]
      : [];
  // An owner that's an entity here gives its own address.
  for (const m of members) {
    if (owner?.name === m.name && owner.address) m.address = owner.address;
  }
  const managers = (entity.members ?? []).filter((m) => /manager/i.test(m.role ?? "") && m.percent == null).map((m) => m.name);
  const profileManagers = entity.profile?.managers ?? [];
  const managed = managers.length || /manager-managed|managed by (its )?manager/i.test(entity.profile?.management ?? "") ? "managers" : "members";
  const withCount = { ...entity, ownerCount: members.length || undefined, owner: owner ? { name: owner.name, type: owner.type, llcType: owner.llcType } : null };
  return {
    name: entity.name,
    state: stateCode(entity.state) ?? "",
    effective: entity.formationDate || today.toISOString().slice(0, 10),
    address: (entity.address ?? "").trim(),
    registeredAgent: (entity.registeredAgent ?? "").trim(),
    purpose: entity.profile?.purpose?.trim() ?? "",
    members,
    managed,
    managers: managers.length ? managers : profileManagers,
    taxClass: taxClassOf(withCount).value ?? "",
  };
}

/** The agreement as a PDF: Letter, serif, numbered sections, Exhibit A and a signature page. */
export async function operatingAgreementPdf(d: OADoc, entityName: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 72;
  const width = W - M * 2;
  let y = M;

  const room = (h: number) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const para = (text: string, opts: { size?: number; style?: "normal" | "bold" | "italic"; gap?: number; indent?: number; align?: "left" | "center" | "justify" } = {}) => {
    const size = opts.size ?? 11;
    pdf.setFont("times", opts.style ?? "normal");
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(text, width - (opts.indent ?? 0));
    const lh = size * 1.42;
    for (let k = 0; k < lines.length; k++) {
      room(lh);
      const x = opts.align === "center" ? W / 2 : M + (opts.indent ?? 0);
      const justify = opts.align === "justify" && k < lines.length - 1;
      pdf.text(lines[k], x, y, { align: opts.align === "center" ? "center" : justify ? "justify" : "left", maxWidth: justify ? width - (opts.indent ?? 0) : undefined });
      y += lh;
    }
    y += opts.gap ?? 8;
  };

  // Title
  y += 24;
  para(d.title.toUpperCase(), { size: 16, style: "bold", align: "center", gap: 2 });
  para(d.subtitle, { size: 12, style: "italic", align: "center", gap: 26 });
  para(d.preamble, { align: "justify", gap: 14 });

  d.sections.forEach((sec, i) => {
    room(40);
    para(`${i + 1}.  ${sec.heading}`, { size: 11.5, style: "bold", gap: 4 });
    sec.paragraphs.forEach((p, j) => para(sec.paragraphs.length > 1 ? `(${String.fromCharCode(97 + j)})  ${p}` : p, { align: "justify", gap: 8 }));
    y += 4;
  });

  // Signatures
  room(60 + d.signers.length * 90);
  para(`IN WITNESS WHEREOF, the undersigned ${d.signers.length === 1 ? "has" : "have"} executed this Agreement as of the date first written above.`, { align: "justify", gap: 26 });
  for (const sg of d.signers) {
    room(90);
    pdf.setFont("times", "bold");
    pdf.setFontSize(11);
    pdf.text(sg.name.toUpperCase(), M, y);
    y += 30;
    pdf.setLineWidth(0.6);
    pdf.line(M, y, M + 260, y);
    y += 14;
    pdf.setFont("times", "normal");
    pdf.setFontSize(10);
    const entity = /\b(llc|l\.l\.c\.|inc\.?|corp|trust|lp|ltd|company)\b/i.test(sg.name);
    pdf.text(entity ? `By: ____________________   Its: ____________________   (${sg.capacity})` : `${sg.name}, ${sg.capacity}`, M, y);
    y += 14;
    pdf.text("Date: ____________________", M, y);
    y += 30;
  }

  // Exhibit A
  pdf.addPage();
  y = M;
  para(d.exhibit.heading.toUpperCase(), { size: 13, style: "bold", align: "center", gap: 20 });
  const cols = [M, M + width * 0.42, M + width * 0.84];
  pdf.setFont("times", "bold");
  pdf.setFontSize(10.5);
  pdf.text("Member", cols[0], y);
  pdf.text("Address", cols[1], y);
  pdf.text("Percentage Interest", W - M, y, { align: "right" });
  y += 8;
  pdf.setLineWidth(0.8);
  pdf.line(M, y, W - M, y);
  y += 16;
  pdf.setFont("times", "normal");
  for (const [name, address, share] of d.exhibit.rows) {
    const nameLines: string[] = pdf.splitTextToSize(name, width * 0.4);
    const addrLines: string[] = pdf.splitTextToSize(address, width * 0.4);
    const h = Math.max(nameLines.length, addrLines.length) * 14;
    room(h + 10);
    pdf.text(nameLines, cols[0], y);
    pdf.text(addrLines, cols[1], y);
    pdf.text(share, W - M, y, { align: "right" });
    y += h + 6;
    pdf.setLineWidth(0.3);
    pdf.line(M, y - 8, W - M, y - 8);
    y += 6;
  }
  const total = d.exhibit.rows.reduce((n, r) => n + (Number.parseFloat(r[2]) || 0), 0);
  pdf.setFont("times", "bold");
  pdf.text("Total", cols[0], y);
  pdf.text(`${Math.round(total * 100) / 100}%`, W - M, y, { align: "right" });

  // Footers
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont("times", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(110);
    pdf.text(`${d.title} of ${entityName}`, M, H - 40);
    pdf.text(`Page ${p} of ${pages}`, W - M, H - 40, { align: "right" });
    pdf.setTextColor(0);
  }
  return pdf.output("blob");
}

/** Palm's document types → the paperwork slot each one fills. */
export const PALM_SLOT: Record<string, "articles" | "einLetter" | "operatingAgreement" | "goodStanding" | "foreignRegistration"> = {
  certificate_of_formation: "articles",
  articles_of_incorporation: "articles",
  ein_letter: "einLetter",
  ein_letter_alternate: "einLetter",
  operating_agreement: "operatingAgreement",
  certificate_of_good_standing: "goodStanding",
  certificate_of_authority: "foreignRegistration",
};

/** Which entity type the generator can write an operating agreement for. */
export const canDraftAgreement = (r: { name?: string; type?: string }) => entityType(r) === "LLC";

// ── Change of address ────────────────────────────────────────────────────

export type AddressChangeStep = {
  /** Whether the state keeps the address, so something must be filed. */
  needed: boolean;
  agency: string;
  how: string;
  url?: string;
  linkLabel?: string;
};

/** What telling the state takes, by where the entity was formed. */
export function stateAddressStep(state: string | undefined | null, type: string | undefined | null): AddressChangeStep {
  const st = stateCode(state);
  const corp = type === "C-Corp";
  if (st === "AZ")
    return {
      needed: true,
      agency: "Arizona Corporation Commission",
      how: `Sign in to eCorp, open the ${corp ? "corporation" : "entity"}, and file the change of its ${corp ? "known place of business" : "principal / known place of business"} address. The new address shows on the public record once the ACC processes it.`,
      url: "https://ecorp.azcc.gov/",
      linkLabel: "Open eCorp",
    };
  if (st === "NV")
    return {
      needed: true,
      agency: "Nevada Secretary of State",
      how: `File an amended list of ${corp ? "officers and directors" : "managers or members"} with the new address in SilverFlume, or put it on the next annual list.`,
      url: "https://www.nvsilverflume.gov/",
      linkLabel: "Open SilverFlume",
    };
  if (st === "DE")
    return {
      needed: false,
      agency: "Delaware Division of Corporations",
      how: corp
        ? "Delaware keeps the registered agent, not the business address, until the annual franchise tax report. Use the new address on the next report."
        : "Delaware keeps only the registered agent on file, not the business address. Nothing to file.",
      url: "https://corp.delaware.gov/",
      linkLabel: "Delaware Division of Corporations",
    };
  return { needed: true, agency: st ? `${stateName(st)} Secretary of State` : "The state", how: "Update the address on file with the state the entity was formed in, and anywhere it's registered to do business." };
}

/** Where Form 8822-B is mailed: by the state of the old address (Rev. December 2019). */
export function f8822bMailTo(oldAddress: string | null | undefined): string {
  const st = parseAddress(oldAddress)?.region ?? "";
  const kansasCity = new Set(["CT", "DE", "DC", "GA", "IL", "IN", "KY", "ME", "MD", "MA", "MI", "NH", "NJ", "NY", "NC", "OH", "PA", "RI", "SC", "TN", "VT", "VA", "WV", "WI"]);
  return kansasCity.has(st) ? "Internal Revenue Service, Kansas City, MO 64999" : "Internal Revenue Service, Ogden, UT 84201-0023";
}

export type F8822BData = { name: string; ein: string | null; oldAddress: string; newAddress: string; mailTo: string; notes: string[] };

/** What goes on the entity's 8822-B, or why it doesn't need one. */
export function f8822bData(entity: { name?: string; ein?: string | null; address?: string | null; previousAddress?: string | null }): F8822BData {
  const d = digits(entity.ein);
  const notes: string[] = [];
  const ein = d.length === 9 && !/^0+$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
  if (!ein) notes.push("No EIN on record. An entity without its own EIN doesn't file one; its owner does, if the owner's address changed.");
  if (!entity.previousAddress) notes.push("The old address isn't on record: fill in line 5 by hand.");
  return { name: (entity.name ?? "").trim(), ein, oldAddress: (entity.previousAddress ?? "").trim(), newAddress: (entity.address ?? "").trim(), mailTo: f8822bMailTo(entity.previousAddress), notes };
}

/** The IRS's Form 8822-B (Rev. December 2019), filled in: line 1 (its returns), 4a, 4b, 5 and 6. Left unsigned. */
export async function fill8822B(data: F8822BData, formBytes: ArrayBuffer): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(formBytes);
  const form = pdf.getForm();
  const P = "topmostSubform[0].Page1[0].";
  const text = (name: string, value: string) => value && form.getTextField(P + name).setText(value);
  form.getCheckBox(P + "c1_2[0]").check();
  text("Line4aReadOrder[0].f1_1[0]", data.name);
  text("Line4bReadOrder[0].f1_2[0]", data.ein ?? "");
  text("f1_3[0]", data.oldAddress);
  text("f1_7[0]", data.newAddress);
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
