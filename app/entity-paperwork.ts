/**
 * The paperwork rule book: what each entity needs on file, what it must file
 * and when, and where its records disagree with each other or with the law.
 *
 * Every rule here is keyed on entity type, state of formation, the state it
 * operates in (from its principal address) and its federal tax class. The
 * facts were checked against official sources in October 2026 — statute and
 * agency links sit next to the rules that rely on them. Pure functions only:
 * the entity page, the Entities list, Home and the Estate Map all read this.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type EntityType = "LLC" | "C-Corp" | "LP" | "Trust";

export type TaxClass =
  | "Disregarded Entity"
  | "Partnership"
  | "S Corporation"
  | "C Corporation"
  | "Grantor trust"
  | "Non-grantor trust";

/** Tax classifications that fit each type. */
export const TAX_CLASSES: Record<EntityType, TaxClass[]> = {
  LLC: ["Disregarded Entity", "Partnership", "S Corporation", "C Corporation"],
  "C-Corp": ["C Corporation", "S Corporation"],
  LP: ["Partnership", "C Corporation"],
  Trust: ["Grantor trust", "Non-grantor trust"],
};

/** Every document slot an entity can have. Slots are fields on the record. */
export type DocKey =
  | "articles"
  | "einLetter"
  | "w9"
  | "operatingAgreement"
  | "trustAgreement"
  | "trustCertificate"
  | "trustSchedule"
  | "sElection"
  | "sElectionAccepted"
  | "classElection"
  | "annualReport"
  | "foreignRegistration"
  | "goodStanding"
  | "ownershipLedger"
  | "minutes";

export const DOC_KEYS: DocKey[] = [
  "articles",
  "einLetter",
  "w9",
  "operatingAgreement",
  "trustAgreement",
  "trustCertificate",
  "trustSchedule",
  "sElection",
  "sElectionAccepted",
  "classElection",
  "annualReport",
  "foreignRegistration",
  "goodStanding",
  "ownershipLedger",
  "minutes",
];

export type DocCategory = "Formation" | "IRS" | "Governance" | "Elections" | "State" | "Trust";

/**
 * required    — the law or the IRS requires it; counts toward the score.
 * expected    — not a legal requirement, but banks, title companies, lenders
 *               or courts expect it; counts toward the score.
 * recommended — good practice; listed, never scored.
 */
export type NeedLevel = "required" | "expected" | "recommended";

export type DocRule = {
  key: DocKey;
  title: string;
  category: DocCategory;
  level: NeedLevel;
  weight: number;
  /** Why this entity needs it — specific to its type, state and tax class. */
  why: string;
  /** Where to get it. */
  howTo?: { label: string; url: string };
};

/** What the rule book reads. Every field is optional; missing facts narrow the rules. */
export type PaperworkInput = {
  name?: string;
  type?: string;
  /** State of formation (full name or two-letter code). */
  state?: string;
  ein?: string;
  formationDate?: string;
  address?: string;
  registeredAgent?: string;
  /** Federal tax class. */
  llcType?: string;
  trustees?: string;
  grantors?: string;
  beneficiaries?: string;
  /** Owners on record, when known (e.g. from the document check). */
  ownerCount?: number;
  /** The owning entity on record, if any. */
  owner?: { name?: string; type?: string; llcType?: string } | null;
} & Partial<Record<DocKey, unknown>>;

// ── States ────────────────────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const CODE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([n, c]) => [c, n.replace(/\b\w/g, (m) => m.toUpperCase())])
);

/** "Arizona" / "AZ" / "az" → "AZ"; anything else → null. */
export function stateCode(raw?: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s) && CODE_NAMES[s.toUpperCase()]) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? null;
}

export function stateName(code: string | null): string {
  return (code && CODE_NAMES[code]) || code || "";
}

/** The state in a US address ("…, Phoenix, AZ 85028" → "AZ"). */
export function addressState(address?: string | null): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  const m = a.match(/,\s*([A-Za-z]{2})\.?\s+\d{5}(?:-\d{4})?\s*$/) ?? a.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (m && CODE_NAMES[m[1].toUpperCase()]) return m[1].toUpperCase();
  const named = Object.keys(STATE_CODES).find((n) => new RegExp(`\\b${n}\\b`, "i").test(a));
  return named ? STATE_CODES[named] : null;
}

/** Arizona counties over 800,000 people, where the ACC publishes notices itself. */
const AZ_PUBLICATION_EXEMPT_CITIES =
  /\b(phoenix|scottsdale|mesa|tempe|chandler|gilbert|glendale|peoria|surprise|goodyear|avondale|buckeye|paradise valley|fountain hills|cave creek|carefree|queen creek|tolleson|litchfield park|el mirage|sun city|tucson|oro valley|marana|sahuarita|south tucson)\b/i;

// ── Entity type and tax class ─────────────────────────────────────────────

/**
 * The entity's real type. Older records stored every non-corporation as
 * "LLC" — the trust and the limited partnership among them — so a name that
 * says "Trust" or "Limited Partnership" wins over a stored "LLC".
 */
export function entityType(a: { name?: string; type?: string }): EntityType {
  const name = a.name ?? "";
  if (a.type === "Trust") return "Trust";
  if (a.type === "C-Corp") return "C-Corp";
  if (a.type === "LP") return "LP";
  if (/\btrust\b/i.test(name)) return "Trust";
  if (/\b(limited partnership|ltd\.? partnership|l\.p\.|lp|lllp)\b/i.test(name) && !/\bllc\b/i.test(name)) return "LP";
  return "LLC";
}

/** The tax class on record, or the IRS default when none is recorded. */
export function taxClassOf(a: PaperworkInput): { value: TaxClass | null; isDefault: boolean } {
  const type = entityType(a);
  const recorded = (a.llcType ?? "").trim() as TaxClass;
  if (recorded && TAX_CLASSES[type].includes(recorded)) return { value: recorded, isDefault: false };
  // Form 8832 defaults: one owner → disregarded, two or more → partnership.
  if (type === "LLC") {
    if (a.ownerCount === 1 || (a.ownerCount == null && a.owner)) return { value: "Disregarded Entity", isDefault: true };
    if ((a.ownerCount ?? 0) >= 2) return { value: "Partnership", isDefault: true };
    return { value: null, isDefault: true };
  }
  if (type === "LP") return { value: "Partnership", isDefault: true };
  if (type === "C-Corp") return { value: "C Corporation", isDefault: true };
  return { value: null, isDefault: true };
}

// ── Labels by state ───────────────────────────────────────────────────────

const LINKS = {
  azForms: { label: "Arizona Corporation Commission — forms", url: "https://azcc.gov/corporations/forms/llc-forms" },
  azBusiness: { label: "Arizona Business Center (ACC)", url: "https://azcc.gov/corporations" },
  azSos: { label: "Arizona Secretary of State — business services", url: "https://azsos.gov/business" },
  azL025: {
    label: "ACC Form L025 instructions",
    url: "https://azcc.gov/docs/default-source/corps-files/instructions/l025i-instructions-application-for-registration.pdf",
  },
  nvSilverflume: { label: "Nevada SilverFlume", url: "https://www.nvsilverflume.gov/" },
  deCorp: { label: "Delaware Division of Corporations", url: "https://corp.delaware.gov/" },
  deTax: { label: "Delaware — pay annual taxes", url: "https://corp.delaware.gov/paytaxes/" },
  nyAuthority: { label: "NY Department of State — Application for Authority", url: "https://dos.ny.gov/application-authority-foreign-business-corporation" },
  irsEin: { label: "IRS — Employer ID numbers (147C: 800-829-4933)", url: "https://www.irs.gov/businesses/employer-identification-number" },
  irsW9: { label: "IRS — Form W-9", url: "https://www.irs.gov/forms-pubs/about-form-w-9" },
  irs2553: { label: "IRS — Form 2553 instructions", url: "https://www.irs.gov/instructions/i2553" },
  irsCp261: { label: "IRS — Understanding your CP261", url: "https://www.irs.gov/individuals/understanding-your-cp261-notice" },
  irs8832: { label: "IRS — Form 8832", url: "https://www.irs.gov/forms-pubs/about-form-8832" },
  azTrustCert: { label: "A.R.S. 14-11013 (certification of trust)", url: "https://www.azleg.gov/ars/14/11013.htm" },
};

function formationTitle(type: EntityType, st: string | null): string {
  if (type === "LP") return "Certificate of Limited Partnership";
  if (type === "C-Corp") return st === "DE" ? "Certificate of Incorporation" : st ? "Articles of Incorporation" : "Articles / Certificate of Incorporation";
  return st === "DE" ? "Certificate of Formation" : st ? "Articles of Organization" : "Articles of Organization / Certificate of Formation";
}

function formationLink(type: EntityType, st: string | null) {
  if (st === "AZ") return type === "LP" ? LINKS.azSos : LINKS.azBusiness;
  if (st === "NV") return LINKS.nvSilverflume;
  if (st === "DE") return LINKS.deCorp;
  return undefined;
}

export function agentTerm(st: string | null): string {
  return st === "AZ" ? "Statutory agent" : "Registered agent";
}

function goodStandingTitle(st: string | null): string {
  return st === "NV" ? "Certificate of Existence (good standing)" : "Certificate of Good Standing";
}

function governingTitle(type: EntityType): string {
  return type === "C-Corp" ? "Bylaws" : type === "LP" ? "Partnership Agreement" : "Operating Agreement";
}

/** The state's recurring filing for this type, or null when there is none. */
export function annualFiling(type: EntityType, st: string | null): { title: string; fee: string; due: string } | null {
  if (type === "Trust" || !st) return null;
  if (st === "AZ") {
    if (type === "C-Corp") return { title: "Arizona Annual Report (with Certificate of Disclosure)", fee: "$45", due: "on the incorporation anniversary date" };
    return null; // AZ LLCs and plain LPs file no annual report.
  }
  if (st === "NV") {
    return {
      title: type === "C-Corp" ? "Nevada Annual List of Officers and Directors + State Business License" : "Nevada Annual List + State Business License",
      fee: type === "C-Corp" ? "$150+ list (by authorized shares) + $500 license" : "$150 list + $200 license",
      due: "by the last day of the anniversary month",
    };
  }
  if (st === "DE") {
    if (type === "C-Corp") return { title: "Delaware Annual Franchise Tax Report", fee: "$50 filing + franchise tax (minimum $175)", due: "March 1" };
    return { title: "Delaware Annual Tax", fee: "$300 for 2025; $400 from June 1, 2027", due: "June 1" };
  }
  return null;
}

function annualLink(st: string | null) {
  return st === "AZ" ? LINKS.azBusiness : st === "NV" ? LINKS.nvSilverflume : st === "DE" ? LINKS.deTax : undefined;
}

function foreignTitle(type: EntityType, host: string): string {
  if (host === "AZ") return type === "C-Corp" ? "Application for Authority to Transact Business in Arizona" : "Arizona Foreign Registration Statement (Form L025)";
  if (host === "NY") return type === "C-Corp" ? "New York Application for Authority" : "New York Application for Authority (foreign LLC)";
  return `Foreign registration in ${stateName(host)}`;
}

// ── The document catalog ──────────────────────────────────────────────────

function monthsSince(iso: string | undefined, today: Date): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(iso + "T00:00:00Z");
  return (today.getUTCFullYear() - d.getUTCFullYear()) * 12 + (today.getUTCMonth() - d.getUTCMonth());
}

/**
 * Every document this entity should have, with how badly and why. Ordered
 * for display: formation, IRS, governance, elections, state, trust.
 */
export function documentRules(a: PaperworkInput, today = new Date()): DocRule[] {
  const type = entityType(a);
  const st = stateCode(a.state);
  const host = addressState(a.address);
  const tax = taxClassOf(a).value;
  const rules: DocRule[] = [];

  if (type === "Trust") {
    const grantor = tax !== "Non-grantor trust";
    rules.push(
      {
        key: "trustAgreement",
        title: "Trust Agreement",
        category: "Trust",
        level: "required",
        weight: 26,
        why: "The signed trust instrument, with every amendment or restatement. It is the trust — everything else points back to it.",
      },
      {
        key: "trustCertificate",
        title: "Certification of Trust",
        category: "Trust",
        level: "expected",
        weight: 16,
        why:
          "The short certificate banks, brokers and title companies accept instead of the full agreement: the trust's existence and date, the settlors, current trustees and their powers, and whether it is revocable" +
          (st === "AZ" || !st ? " (A.R.S. 14-11013)." : "."),
        howTo: st === "AZ" || !st ? LINKS.azTrustCert : undefined,
      },
      {
        key: "trustSchedule",
        title: "Schedule A & assignments",
        category: "Trust",
        level: "recommended",
        weight: 0,
        why: "The list of assets in the trust, with the assignments or deeds that retitled each one (e.g. LLC interests assigned to the trustee). Without them, assets can fall outside the trust.",
      }
    );
    if (!grantor) {
      rules.push({
        key: "einLetter",
        title: "EIN Letter",
        category: "IRS",
        level: "required",
        weight: 10,
        why: "A non-grantor (irrevocable) trust is its own taxpayer: it needs its own EIN and files Form 1041.",
        howTo: LINKS.irsEin,
      });
      rules.push({
        key: "w9",
        title: "Form W-9",
        category: "IRS",
        level: "expected",
        weight: 6,
        why: "Banks and payers ask the trust for a W-9 in its own name and EIN.",
        howTo: LINKS.irsW9,
      });
    }
    return rules;
  }

  // Formation
  rules.push({
    key: "articles",
    title: formationTitle(type, st),
    category: "Formation",
    level: "required",
    weight: 18,
    why:
      type === "LP"
        ? `The state filing that created the partnership, naming each general partner${st === "AZ" ? " — filed with the Arizona Secretary of State" : ""}.`
        : type === "C-Corp"
          ? `The state filing that created the corporation${st === "AZ" ? " (filed with a Certificate of Disclosure)" : ""}.`
          : `The state filing that created the LLC${st === "AZ" ? "; Arizona's lists its members (or its managers and every 20%+ member)" : ""}.`,
    howTo: formationLink(type, st),
  });

  // IRS
  rules.push({
    key: "einLetter",
    title: "EIN Letter",
    category: "IRS",
    level: "required",
    weight: 14,
    why:
      tax === "Disregarded Entity"
        ? "The IRS notice assigning the EIN (CP 575 — the single-member “G” version lists no return, because income goes on the owner's return). Needed for banks and payroll even when disregarded. Lost it? Ask the IRS for a 147C, or download a digital CP 575 from the Business Tax Account."
        : "The IRS notice assigning the EIN (CP 575). Its line “you must file the following form(s)” confirms the tax class — 1065 partnership, 1120 corporation. Lost it? Ask for a 147C or download a digital CP 575.",
    howTo: LINKS.irsEin,
  });
  rules.push({
    key: "w9",
    title: "Form W-9",
    category: "IRS",
    level: "expected",
    weight: 8,
    why:
      tax === "Disregarded Entity"
        ? "Banks and payers ask for it. A disregarded LLC's W-9 goes in its owner's name and TIN (line 1), with the LLC on line 2 — not the LLC's own EIN."
        : `Banks and payers ask for it. Line 3a: the LLC box with ${tax === "Partnership" ? "“P”" : tax === "S Corporation" ? "“S”" : tax === "C Corporation" ? "“C”" : "its tax letter"}${type === "C-Corp" ? " — or the corporation box" : ""}.`,
    howTo: LINKS.irsW9,
  });

  // Governance
  rules.push({
    key: "operatingAgreement",
    title: governingTitle(type),
    category: "Governance",
    level: type === "C-Corp" ? "required" : "expected",
    weight: 16,
    why:
      type === "C-Corp"
        ? st === "AZ"
          ? "Arizona requires the board to adopt initial bylaws (A.R.S. 10-206)."
          : st === "DE"
            ? "Delaware requires bylaws adopted at the organizational meeting (DGCL 108–109)."
            : "Corporations adopt bylaws at organization."
        : type === "LP"
          ? "Sets the partners' rights, capital and distributions. Not filed with the state, but every lender and buyer asks for it."
          : `Not filed with the state and not legally required in ${st ? stateName(st) : "most states"}, but banks, lenders and courts expect one — it is what keeps the liability shield and sets each member's share.`,
  });
  rules.push({
    key: "ownershipLedger",
    title: type === "C-Corp" ? "Stock ledger" : type === "LP" ? "Partner register" : "Membership ledger",
    category: "Governance",
    level: type === "C-Corp" ? "expected" : "recommended",
    weight: type === "C-Corp" ? 6 : 0,
    why:
      type === "C-Corp"
        ? "Who holds which shares. Delaware, Arizona and Nevada all require corporations to keep a stock ledger or shareholder list."
        : st === "AZ" && type === "LLC"
          ? "Arizona requires the LLC to keep a current list of members and managers with their addresses (A.R.S. 29-3410)."
          : "Who owns what percentage, and when it changed — the record every transfer and K-1 depends on.",
  });
  if (type === "C-Corp") {
    rules.push({
      key: "minutes",
      title: "Organizational minutes / consents",
      category: "Governance",
      level: "expected",
      weight: 6,
      why: "The organizational action that adopted the bylaws and elected directors and officers, then annual shareholder meeting minutes or written consents.",
    });
  }

  // Elections
  if (tax === "S Corporation") {
    rules.push(
      {
        key: "sElection",
        title: "Form 2553 (S election)",
        category: "Elections",
        level: "required",
        weight: 12,
        why: "The S election as filed — due within 2 months and 15 days of the start of the tax year it takes effect.",
        howTo: LINKS.irs2553,
      },
      {
        key: "sElectionAccepted",
        title: "CP261 (S election accepted)",
        category: "Elections",
        level: "required",
        weight: 8,
        why: "The IRS notice accepting the election — the proof the entity files 1120-S. No CP261 means the election may never have taken.",
        howTo: LINKS.irsCp261,
      }
    );
  }
  if (type === "LLC" && tax === "C Corporation") {
    rules.push({
      key: "classElection",
      title: "Form 8832 + IRS acceptance",
      category: "Elections",
      level: "required",
      weight: 10,
      why: "An LLC is only taxed as a corporation if it elected to be. Keep the filed 8832 and the IRS acceptance letter.",
      howTo: LINKS.irs8832,
    });
  }

  // State
  const annual = annualFiling(type, st);
  const age = monthsSince(a.formationDate, today);
  if (annual) {
    const firstDueYet = age == null || age >= 11;
    rules.push({
      key: "annualReport",
      title: st === "DE" && type !== "C-Corp" ? "Delaware annual tax receipt" : `Latest ${annual.title}`,
      category: "State",
      level: firstDueYet ? (st === "DE" && type !== "C-Corp" ? "recommended" : "required") : "recommended",
      weight: firstDueYet && !(st === "DE" && type !== "C-Corp") ? 8 : 0,
      why: `${annual.title}, due ${annual.due} (${annual.fee}). ${
        st === "NV"
          ? "Late: $75 + $100 penalties, then the charter is revoked."
          : st === "DE"
            ? type === "C-Corp"
              ? "Late: $200 + 1.5%/month; a year unpaid voids the charter."
              : "No report is filed — only the tax. Late: $200 + 1.5%/month; 3 years unpaid cancels the LLC."
            : "Late: $9/month, then administrative dissolution."
      }`,
      howTo: annualLink(st),
    });
  }
  if (st && host && st !== host) {
    rules.push({
      key: "foreignRegistration",
      title: foreignTitle(type, host),
      category: "State",
      level: "required",
      weight: 8,
      why: `Formed in ${stateName(st)} but run from ${stateName(host)}. Doing business there (leasing or operating property, an office) requires registering; until it does, it can't sue in ${stateName(host)} courts. Simply owning property, with nothing more, doesn't count.`,
      howTo: host === "AZ" ? LINKS.azL025 : host === "NY" ? LINKS.nyAuthority : undefined,
    });
  }
  rules.push({
    key: "goodStanding",
    title: goodStandingTitle(st),
    category: "State",
    level: "recommended",
    weight: 0,
    why: "Banks, lenders and foreign registrations ask for one dated within the last 30–90 days — keep the latest.",
    howTo: formationLink(type, st),
  });

  return rules;
}

// ── Recurring obligations ─────────────────────────────────────────────────

export type Obligation = {
  key: string;
  title: string;
  agency: string;
  /** Next due date (ISO), when it can be computed. */
  due: string | null;
  /** How the due date is set, in words. */
  rule: string;
  fee?: string;
  note?: string;
  url?: string;
  urlLabel?: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Weekend due dates roll to Monday (IRS and most states). */
function businessDay(d: Date): Date {
  const out = new Date(d);
  while (out.getUTCDay() === 0 || out.getUTCDay() === 6) out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

/** The next date ≥ today with this month/day. */
function nextOn(month: number, day: number, today: Date, roll = true): Date {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, month - 1, Math.min(day, lastDay)));
    const due = roll ? businessDay(d) : d;
    if (due.getTime() >= t) return due;
  }
  return new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
}

/**
 * What this entity must file, and when next — state filings and federal
 * returns. Ordered by due date; undated items last.
 */
export function obligations(a: PaperworkInput, today = new Date(), taxHomeName?: string | null): Obligation[] {
  const type = entityType(a);
  const st = stateCode(a.state);
  const tax = taxClassOf(a).value;
  const out: Obligation[] = [];
  const formed = a.formationDate && /^\d{4}-\d{2}-\d{2}/.test(a.formationDate) ? new Date(a.formationDate + "T00:00:00Z") : null;

  // State
  const annual = annualFiling(type, st);
  if (annual && st === "AZ") {
    out.push({
      key: "state-annual",
      title: annual.title,
      agency: "Arizona Corporation Commission",
      due: formed ? iso(nextOn(formed.getUTCMonth() + 1, formed.getUTCDate(), today, false)) : null,
      rule: "Every year on the incorporation anniversary date",
      fee: annual.fee,
      url: LINKS.azBusiness.url,
    });
  } else if (annual && st === "NV") {
    out.push({
      key: "state-annual",
      title: annual.title,
      agency: "Nevada Secretary of State",
      due: formed ? iso(nextOn(formed.getUTCMonth() + 1, 31, today, false)) : null,
      rule: "By the last day of the anniversary month",
      fee: annual.fee,
      url: LINKS.nvSilverflume.url,
    });
  } else if (annual && st === "DE") {
    out.push({
      key: "state-annual",
      title: annual.title,
      agency: "Delaware Division of Corporations",
      due: iso(type === "C-Corp" ? nextOn(3, 1, today, false) : nextOn(6, 1, today, false)),
      rule: type === "C-Corp" ? "Every March 1, for the prior year" : "Every June 1, for the prior year",
      fee: annual.fee,
      url: LINKS.deTax.url,
    });
  }
  if (st === "AZ" && type === "LLC") {
    out.push({
      key: "az-dormancy",
      title: "Arizona dormancy check-in",
      agency: "Arizona Corporation Commission",
      due: null,
      rule: "Each January, if nothing was filed with the ACC in the last 2 years",
      note: "Arizona LLCs file no annual report. Since 2026 the ACC emails LLCs with no filing in 2 years to confirm they still exist — no reply in 60 days starts administrative dissolution. Keep the statutory agent's email current.",
      url: LINKS.azBusiness.url,
      urlLabel: "Arizona Business Center",
    });
  }
  const host = addressState(a.address);
  if (type === "C-Corp" && st && host === "NY" && st !== "NY") {
    out.push({
      key: "ny-biennial",
      title: "New York Biennial Statement",
      agency: "New York Department of State",
      due: null,
      rule: "Every 2 years, in the month the Application for Authority was filed",
      fee: "$9",
      url: "https://dos.ny.gov/biennial-statements-business-corporations-and-limited-liability-companies",
    });
  }

  // Federal
  const irs = "IRS";
  if (type === "Trust") {
    if (tax === "Non-grantor trust") {
      out.push({ key: "fed", title: "Form 1041", agency: irs, due: iso(nextOn(4, 15, today)), rule: "April 15 (extension to Sept 30)", note: "Plus K-1s to beneficiaries who receive distributions." });
    } else {
      out.push({ key: "fed", title: "No separate return", agency: irs, due: null, rule: "While the grantor is alive", note: "A revocable (grantor) trust reports on the grantor's Form 1040 under their SSN. At the grantor's death it becomes irrevocable: it then needs a new EIN and files Form 1041." });
    }
  } else if (tax === "Disregarded Entity") {
    out.push({
      key: "fed",
      title: "No separate return",
      agency: irs,
      due: null,
      rule: "Disregarded for income tax",
      note: `Its income and expenses go on ${taxHomeName ? taxHomeName : "its owner's"} return. It still keeps its own EIN for banking and payroll.`,
    });
  } else if (tax === "Partnership") {
    out.push({ key: "fed", title: "Form 1065 + Schedule K-1s", agency: irs, due: iso(nextOn(3, 15, today)), rule: "15th day of the 3rd month (Form 7004 extends 6 months)", note: "K-1s go to every partner by the same date." });
  } else if (tax === "S Corporation") {
    out.push({ key: "fed", title: "Form 1120-S + Schedule K-1s", agency: irs, due: iso(nextOn(3, 15, today)), rule: "15th day of the 3rd month (Form 7004 extends 6 months)", note: "K-1s go to every shareholder by the same date." });
  } else if (tax === "C Corporation") {
    out.push({ key: "fed", title: "Form 1120", agency: irs, due: iso(nextOn(4, 15, today)), rule: "15th day of the 4th month (Form 7004 extends 6 months)" });
  }

  return out.sort((x, y) => (x.due && y.due ? x.due.localeCompare(y.due) : x.due ? -1 : y.due ? 1 : 0));
}

// ── Consistency checks ────────────────────────────────────────────────────

export type PaperworkIssue = {
  key: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
};

/** Where the records disagree with each other or with the rules. */
export function paperworkChecks(a: PaperworkInput): PaperworkIssue[] {
  const type = entityType(a);
  const st = stateCode(a.state);
  const host = addressState(a.address);
  const recorded = (a.llcType ?? "").trim();
  const tax = taxClassOf(a);
  const owner = a.owner ?? null;
  const ownerType = owner ? entityType(owner) : null;
  const ownerTax = owner ? taxClassOf(owner).value : null;
  const out: PaperworkIssue[] = [];

  if (!st && type !== "Trust") {
    out.push({ key: "no-state", severity: "medium", title: "State of formation is missing", detail: "Every state rule — annual filings, agent, foreign registration — depends on it. It's on the formation filing." });
  } else if (a.state && !stateCode(a.state)) {
    out.push({ key: "bad-state", severity: "low", title: `“${a.state}” isn't a recognised state`, detail: "Use the full state name, e.g. Arizona." });
  }

  if (recorded && !TAX_CLASSES[type].includes(recorded as TaxClass)) {
    out.push({ key: "class-type", severity: "high", title: `“${recorded}” doesn't apply to a${type === "LLC" || type === "LP" ? "n" : ""} ${type === "C-Corp" ? "corporation" : type}`, detail: `Valid: ${TAX_CLASSES[type].join(", ")}.` });
  }

  if (type === "LLC") {
    if (recorded === "Partnership" && (a.ownerCount === 1 || (a.ownerCount == null && owner))) {
      out.push({
        key: "partnership-one-owner",
        severity: "medium",
        title: "Classified as a partnership, but one owner is on record",
        detail: `A partnership needs two or more members. Either add the other members (the operating agreement or the CP 575's Form 1065 line shows them), or it's disregarded into ${owner?.name ?? "its owner"}.`,
      });
    }
    if (recorded === "Disregarded Entity" && (a.ownerCount ?? 0) >= 2) {
      out.push({
        key: "disregarded-many-owners",
        severity: "high",
        title: "Classified as disregarded, but it has several owners",
        detail:
          "An LLC with two or more members is a partnership by default and files Form 1065 — unless the members are spouses holding it as Arizona community property (Rev. Proc. 2002-69) or all are disregarded into the same person.",
      });
    }
  }

  if (tax.value === "S Corporation" && owner && ownerType) {
    const okOwner = ownerType === "Trust" ? ownerTax !== "Non-grantor trust" : ownerType === "LLC" && ownerTax === "Disregarded Entity";
    if (!okOwner) {
      out.push({
        key: "s-corp-owner",
        severity: "high",
        title: `${owner.name ?? "Its owner"} can't hold S corporation shares`,
        detail: "S corporation shareholders must be individuals, certain trusts (grantor trusts count) or entities disregarded into one. A partnership, C corporation or multi-member LLC owner breaks the election.",
      });
    }
  }

  if (st && host && st !== host) {
    out.push({
      key: "foreign",
      severity: "medium",
      title: `Formed in ${stateName(st)}, run from ${stateName(host)}`,
      detail: `If it does business in ${stateName(host)} beyond simply owning property, it must register there as a foreign ${type === "C-Corp" ? "corporation" : "entity"} (${foreignTitle(type, host)}).`,
    });
  }

  if (st === "AZ" && (type === "LLC" || type === "C-Corp")) {
    const agentAz = a.address && AZ_PUBLICATION_EXEMPT_CITIES.test(a.address);
    out.push({
      key: "az-publication",
      severity: "info",
      title: agentAz ? "Publication: handled by the ACC" : "Publication may have been required",
      detail: agentAz
        ? "Arizona requires the formation notice to be published, but in Maricopa and Pima counties the ACC posts it online itself — no newspaper notice was needed."
        : `Arizona ${type === "LLC" ? "LLCs" : "corporations"} outside Maricopa and Pima counties must publish their formation notice in a local newspaper within 60 days (3 consecutive issues). Keep the affidavit of publication.`,
    });
  }

  if (type === "Trust") {
    if (tax.value === "Non-grantor trust" && !a.ein?.trim()) {
      out.push({ key: "trust-ein", severity: "high", title: "Non-grantor trust without an EIN", detail: "An irrevocable or non-grantor trust is its own taxpayer — it needs an EIN and files Form 1041." });
    }
    if (tax.value === "Grantor trust" && a.ein?.trim()) {
      out.push({
        key: "grantor-ein",
        severity: "low",
        title: "A revocable trust with its own EIN",
        detail: "While the grantor is alive a revocable trust normally uses the grantor's SSN. An EIN is fine if it was obtained deliberately — but if the grantor has died, the trust is now irrevocable and should be classed as non-grantor.",
      });
    }
    if (!a.trustees?.trim()) {
      out.push({ key: "trustees", severity: "medium", title: "No trustees on record", detail: "The trustees act for the trust — banks and title companies ask for them. They're named in the trust agreement and the certification of trust." });
    }
  } else if (!a.registeredAgent?.trim()) {
    out.push({
      key: "agent",
      severity: "medium",
      title: `No ${agentTerm(st).toLowerCase()} on record`,
      detail: `Every ${st ? stateName(st) + " " : ""}${type === "C-Corp" ? "corporation" : "entity"} must keep one at all times; losing it can lead to administrative dissolution. It's on the formation filing${st === "AZ" ? " and changed with a Statement of Change" : ""}.`,
    });
  }

  if (!a.formationDate && type !== "Trust") {
    out.push({ key: "formation-date", severity: "low", title: "Formation date missing", detail: "Annual-report deadlines are set from it. It's the filing date on the formation document." });
  }

  return out;
}

/**
 * Whose return a disregarded entity's income lands on: follow disregarded
 * owners up the chain to the first one that files. `lookup` resolves an
 * owner id to its record.
 */
export function taxHome<T extends PaperworkInput & { ownerId?: string }>(
  a: T,
  lookup: (id: string) => T | undefined
): { name: string; form: string } | null {
  if (taxClassOf(a).value !== "Disregarded Entity") return null;
  const seen = new Set<string>();
  let cur: T | undefined = a.ownerId ? lookup(a.ownerId) : undefined;
  while (cur) {
    const t = entityType(cur);
    const tax = taxClassOf(cur).value;
    if (t === "Trust") {
      return tax === "Non-grantor trust"
        ? { name: cur.name ?? "the trust", form: "Form 1041" }
        : { name: `the grantor${cur.grantors ? ` (${cur.grantors})` : ""}, through ${cur.name ?? "the trust"}`, form: "Form 1040" };
    }
    if (tax === "Partnership") return { name: cur.name ?? "its owner", form: "Form 1065" };
    if (tax === "S Corporation") return { name: cur.name ?? "its owner", form: "Form 1120-S" };
    if (tax === "C Corporation") return { name: cur.name ?? "its owner", form: "Form 1120" };
    if (!cur.ownerId || seen.has(cur.ownerId)) return { name: cur.name ?? "its owner", form: "return" };
    seen.add(cur.ownerId);
    cur = lookup(cur.ownerId);
  }
  return null;
}

/** Federal BOI reporting — kept here so the app can answer the question. */
export const BOI_NOTE =
  "Not required: FinCEN's final rule (Aug 2026) permanently exempts every US-formed company from beneficial-ownership reporting, and earlier filings on US persons are being deleted.";
