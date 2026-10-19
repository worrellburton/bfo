/**
 * Forming a new entity through Palm: what the wizard collects (a Draft), and
 * what the entity's record keeps about the filing (FormationState). Shared
 * by the wizard, the entity page and — as types only — the server.
 */

export const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

export type FormationEntityType = "llc" | "corporation";

export type FormationAddress = {
  street1: string;
  street2: string;
  city: string;
  /** Two-letter state code. */
  region: string;
  postal: string;
};

export type FormationPerson = {
  first: string;
  last: string;
};

export type FormationOrganizer = FormationPerson & {
  /** Blank: the principal address is used. */
  address: FormationAddress | null;
  title: string;
};

export type FormationGovernor = FormationPerson & {
  role: "member" | "manager";
  title: string;
};

export type FormationAgent =
  | { provider: "palm" }
  | { provider: "own"; kind: "person" | "organization"; name: string; address: FormationAddress; email: string; phone: string };

/** Palm applies for the EIN once the state has formed the entity. The SSN goes straight to Palm; BFO never keeps it. */
export type FormationEin = {
  first: string;
  last: string;
  ssn: string;
  fiscalYearEndMonth: number;
  activity: string;
  activityDetail: string;
};

export type FormationDraft = {
  entityType: FormationEntityType;
  /** ISO 3166-2, e.g. "US-NV". */
  jurisdiction: string;
  legalName: string;
  purpose: string;
  email: string;
  phone: string;
  website: string;
  /** YYYY-MM-DD, or blank for "when Palm receives it". */
  effectiveDate: string;
  contact: { name: string; email: string; phone: string };
  principal: FormationAddress;
  mailingSame: boolean;
  mailing: FormationAddress;
  organizers: FormationOrganizer[];
  governors: FormationGovernor[];
  agent: FormationAgent;
  ein: FormationEin | null;
  expeditedTier: string;
  /** Jurisdiction-specific fields, keyed as Palm's requirement schema names them. */
  extra: Record<string, unknown>;
  /** BFO: which entity owns this one, and its Palm business once formed. */
  ownerId: string;
  note: string;
};

export const EMPTY_ADDRESS: FormationAddress = { street1: "", street2: "", city: "", region: "", postal: "" };

export const DEFAULT_PURPOSE = "To engage in any lawful act or activity for which a limited liability company may be organized under the laws of this state.";
export const DEFAULT_PURPOSE_CORP = "To engage in any lawful act or activity for which corporations may be organized under the laws of this state.";

export function emptyDraft(): FormationDraft {
  return {
    entityType: "llc",
    jurisdiction: "",
    legalName: "",
    purpose: DEFAULT_PURPOSE,
    email: "",
    phone: "",
    website: "",
    effectiveDate: "",
    contact: { name: "", email: "", phone: "" },
    principal: { ...EMPTY_ADDRESS },
    mailingSame: true,
    mailing: { ...EMPTY_ADDRESS },
    organizers: [{ first: "", last: "", address: null, title: "Organizer" }],
    governors: [],
    agent: { provider: "palm" },
    ein: null,
    expeditedTier: "",
    extra: {},
    ownerId: "",
    note: "",
  };
}

/**
 * An address as the entity records write it ("11201 N Tatum Blvd Ste 300,
 * PMB 44879, Phoenix, AZ 85028") as the wizard's fields: the first part is
 * the street, anything between it and the city is the suite / unit.
 */
export function parseAddress(line: string | null | undefined): FormationAddress | null {
  const m = /^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/.exec((line ?? "").trim());
  if (!m) return null;
  const [first, ...rest] = m[1].split(",").map((x) => x.trim()).filter(Boolean);
  if (!first) return null;
  return { street1: first, street2: rest.join(", "), city: m[2].trim(), region: m[3].toUpperCase(), postal: m[4] };
}

export const sameAddress = (a: FormationAddress, b: FormationAddress) =>
  (["street1", "street2", "city", "region", "postal"] as const).every((k) => a[k].trim().toLowerCase() === b[k].trim().toLowerCase());

/** The office the family's entities share: the address most of them have on record, if any. */
export function officeAddress(addresses: (string | null | undefined)[]): FormationAddress | null {
  const counts = new Map<string, { n: number; a: FormationAddress }>();
  for (const line of addresses) {
    const a = parseAddress(line);
    if (!a) continue;
    const key = [a.street1, a.street2, a.city, a.region, a.postal].join("|").toLowerCase();
    const hit = counts.get(key);
    counts.set(key, { n: (hit?.n ?? 0) + 1, a: hit?.a ?? a });
  }
  let best: { n: number; a: FormationAddress } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.a ?? null;
}

/** Palm's filing lifecycle, in order. */
export const FILING_STATUSES = ["queued", "ready_to_file", "processing", "filed", "completed"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number] | "canceled";

export const FILING_LABEL: Record<FilingStatus, string> = {
  queued: "Queued at Palm",
  ready_to_file: "Ready to file",
  processing: "Filing with the state",
  filed: "Filed, awaiting the state",
  completed: "Formed",
  canceled: "Canceled",
};

/** What the entity's record keeps about its formation (under palm.<mode>.formation). */
export type FormationState = {
  filingId: string;
  status: FilingStatus;
  statusReason?: string | null;
  entityType: FormationEntityType;
  jurisdiction: string;
  submittedAt: number;
  updatedAt: number;
  expeditedTier: string | null;
  /** The add-ons, as Palm tracks them. */
  ein: { filingId: string; status: string; number?: string | null } | null;
  registeredAgent: { status: string } | null;
  registrationNumber: string | null;
  formationDate: string | null;
  fee: { total: number; currency: string } | null;
  documents: number;
  /** Cases Palm opened that need an answer. */
  openCases: number;
};

export const isFormationDone = (s: FormationState | undefined | null) => !!s && (s.status === "completed" || s.status === "canceled");

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const POSTAL_RE = /^\d{5}(-\d{4})?$/;

function addressProblems(a: FormationAddress, what: string): string[] {
  const out: string[] = [];
  if (!a.street1.trim()) out.push(`${what}: street`);
  if (!a.city.trim()) out.push(`${what}: city`);
  if (!/^[A-Z]{2}$/.test(a.region.trim().toUpperCase())) out.push(`${what}: state`);
  if (!POSTAL_RE.test(a.postal.trim())) out.push(`${what}: ZIP code`);
  return out;
}

/** What's still missing before Palm is asked, grouped by the wizard's step. */
export function draftProblems(d: FormationDraft): { step: number; text: string }[] {
  const out: { step: number; text: string }[] = [];
  if (!/^US-[A-Z]{2}$/.test(d.jurisdiction)) out.push({ step: 0, text: "Choose a state." });
  if (d.legalName.trim().length < 3) out.push({ step: 0, text: "Give the entity a name." });
  if (!d.purpose.trim()) out.push({ step: 1, text: "A purpose is required." });
  if (!EMAIL_RE.test(d.email.trim())) out.push({ step: 1, text: "A business email is required." });
  for (const p of addressProblems(d.principal, "Principal address")) out.push({ step: 1, text: p });
  if (!d.mailingSame) for (const p of addressProblems(d.mailing, "Mailing address")) out.push({ step: 1, text: p });
  if (!d.contact.name.trim() || !EMAIL_RE.test(d.contact.email.trim())) out.push({ step: 1, text: "Palm needs a contact person with an email." });
  if (!d.organizers.length) out.push({ step: 2, text: "At least one organizer is required." });
  d.organizers.forEach((o, i) => {
    if (!o.first.trim() || !o.last.trim()) out.push({ step: 2, text: `Organizer ${i + 1} needs a first and last name.` });
    if (o.address) for (const p of addressProblems(o.address, `Organizer ${i + 1}`)) out.push({ step: 2, text: p });
  });
  d.governors.forEach((g, i) => {
    if (!g.first.trim() || !g.last.trim()) out.push({ step: 2, text: `${g.role === "manager" ? "Manager" : "Member"} ${i + 1} needs a first and last name.` });
  });
  if (d.agent.provider === "own") {
    if (!d.agent.name.trim()) out.push({ step: 3, text: "Name the registered agent." });
    for (const p of addressProblems(d.agent.address, "Registered agent")) out.push({ step: 3, text: p });
    if (d.agent.address.region && `US-${d.agent.address.region.toUpperCase()}` !== d.jurisdiction) out.push({ step: 3, text: "The registered agent must be in the state of formation." });
  }
  if (d.ein) {
    if (!d.ein.first.trim() || !d.ein.last.trim()) out.push({ step: 3, text: "The EIN responsible party needs a name." });
    if (!/^\d{3}-?\d{2}-?\d{4}$/.test(d.ein.ssn.trim())) out.push({ step: 3, text: "The responsible party's SSN is needed for the EIN application." });
    if (!d.ein.activity) out.push({ step: 3, text: "Choose the entity's principal activity for the EIN." });
  }
  return out;
}

/** Palm's EIN principal-activity categories, with the words the IRS form uses. */
export const EIN_ACTIVITIES: { value: string; label: string }[] = [
  { value: "real_estate", label: "Real estate" },
  { value: "finance", label: "Finance and insurance" },
  { value: "rental_leasing", label: "Rental and leasing" },
  { value: "construction", label: "Construction" },
  { value: "retail", label: "Retail" },
  { value: "wholesale", label: "Wholesale" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "transportation", label: "Transportation and warehousing" },
  { value: "accommodation_food", label: "Accommodation and food service" },
  { value: "health_care", label: "Health care and social assistance" },
  { value: "other", label: "Other" },
];
