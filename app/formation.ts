import { ownerPercent, ownersTotal } from "../lib/formation-owners.js";

export { emptyOwner, ownerFilingName, ownerName, ownerPercent, ownersTotal, parentOwnerId, personName } from "../lib/formation-owners.js";

/**
 * Forming a new entity through Palm: what the wizard collects (a Draft), and
 * what the entity's record keeps about the filing (FormationState). Shared
 * by the wizard, the entity page and the server.
 *
 * The draft mirrors Palm's formation request field for field (LLC and
 * corporation, the bundled EIN application with every follow-up the IRS asks,
 * your own registered agent), kept as strings the way a form holds them;
 * lib/palm-formation.ts turns it into the request.
 */

export const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

export const stateName = (jurisdiction: string) => US_STATES.find(([abbr]) => `US-${abbr}` === jurisdiction)?.[1] ?? "";

/** Community-property states: where spouses can hold an LLC as community property (Rev. Proc. 2002-69). */
export const COMMUNITY_PROPERTY = new Set(["AZ", "CA", "ID", "LA", "NM", "NV", "TX", "WA", "WI"]);

export type FormationEntityType = "llc" | "corporation";

export type FormationAddress = {
  street1: string;
  street2: string;
  city: string;
  /** Two-letter state code. */
  region: string;
  postal: string;
  /** Some states want it. */
  county?: string;
};

export type PersonName = { first: string; middle: string; last: string; suffix: string };

/** Who signs the articles: the LLC's organizers, a corporation's incorporators. */
export type FormationParty = {
  kind: "person" | "entity";
  name: PersonName;
  entityName: string;
  /** What kind of entity signs, where the state asks (its requirement schema lists the values). */
  entityType: string;
  title: string;
  /** Blank: the principal office. */
  address: FormationAddress | null;
  email: string;
  phone: string;
  /** A company signing: the individual who signs for it, and in what capacity ("Manager"). */
  signerName: string;
  signerCapacity: string;
};

/** Someone who owns part of the new entity: an entity (one already in BFO, or another) or a person. */
export type FormationOwner = {
  kind: "entity" | "person";
  /** An entity owner: a company, or a trust (which holds title through its trustee). */
  entityKind: "company" | "trust";
  /** An entity in BFO; blank for one that isn't. Picking one fills in entityName. */
  entityId: string;
  entityName: string;
  /** A trust: its trustee, and the date of the trust instrument (YYYY-MM-DD). */
  trustee: string;
  trustDate: string;
  /** A company: who signs for it (the operating agreement, consents), and in what capacity. */
  signer: string;
  signerTitle: string;
  name: PersonName;
  /** Percent owned, as typed: capital, profits and votes in the same proportion. */
  percent: string;
  /** The initial contribution: dollars as typed, cash or property, when, and what property. */
  contribution: string;
  contributionKind: "cash" | "property";
  contributionDate: string;
  contributionNote: string;
  title: string;
  address: FormationAddress | null;
  email: string;
  phone: string;
  /** Some states' portals want it (sent to Palm's vault, never kept in BFO). */
  ssn: string;
};

/** An LLC manager, a director: a person, with what some states ask about them. */
export type FormationOfficial = {
  name: PersonName;
  title: string;
  address: FormationAddress | null;
  email: string;
  phone: string;
  ssn: string;
};

export const OFFICER_ROLES: [string, string][] = [
  ["president", "President"],
  ["vice_president", "Vice president"],
  ["secretary", "Secretary"],
  ["treasurer", "Treasurer"],
  ["ceo", "CEO"],
  ["cfo", "CFO"],
  ["coo", "COO"],
  ["chair", "Chair"],
  ["assistant_secretary", "Assistant secretary"],
  ["assistant_treasurer", "Assistant treasurer"],
  ["clerk", "Clerk"],
  ["other", "Other"],
];

export type FormationOfficer = FormationOfficial & { role: string };

export type StockClass = { name: string; authorized: string; issued: string; par: string; consideration: string; rights: string };

export type FormationStock = {
  total: string;
  hasPar: boolean;
  par: string;
  consideration: string;
  rights: string;
  /** Several classes (common, preferred…) instead of one. */
  multiClass: boolean;
  classes: StockClass[];
};

export type FormationAgent =
  | { provider: "palm" }
  | {
      provider: "own";
      kind: "person" | "organization";
      name: PersonName;
      entityName: string;
      address: FormationAddress;
      mailing: FormationAddress | null;
      email: string;
      phone: string;
      /** The person filing confirms the agent agreed to serve and will sign the state's consent. */
      consent: boolean;
    };

/** One answer per follow-up question, keyed as Palm names them ("yes"/"no" for the yes-or-no ones). */
export type EinActivity = Record<string, string> & { category: string };

/** Palm applies for the EIN once the state has formed the entity. SSNs go straight to Palm; BFO never keeps them. */
export type FormationEin = {
  responsible: { first: string; middle: string; last: string; ssn: string };
  reason: string;
  reasonDetail: string;
  fiscalYearEndMonth: number;
  employees: { agricultural: string; other: string };
  wageDate: string;
  activity: EinActivity;
  /** SS-4 line 17: what it sells, makes or does. */
  activityDetail: string;
  hasPreviousEin: boolean;
  previousEin: string;
  tradeName: string;
  form944: boolean;
  ownsHighwayVehicle: boolean;
  involvesGambling: boolean;
  filesForm720: boolean;
  involvesAtf: boolean;
  phone: string;
  mailing: FormationAddress | null;
  /** Blank: counted from the owners. */
  memberCount: string;
  /** "" until asked; only for an LLC whose two members are people (spouses holding it as community property). */
  marriedCouple: "" | "yes" | "no";
  llcClassification: "" | "single_member" | "multi_member";
  /** A special kind of corporation (personal service, REIT…); blank for an ordinary one. C or S comes from the draft's taxElection. */
  corporationSubtype: string;
  /** When the responsible party isn't the person filing: the person filing confirms they agreed and gave their SSN for this. */
  responsibleConsent: boolean;
};

/** How it's taxed: the IRS default (an LLC: disregarded or a partnership; a corporation: C), or an election. */
export type TaxElection = "default" | "s_corp" | "c_corp";

/** Who pays the formation cost (Palm bills the office's account), and how the new entity books it. */
export type FormationPayer = {
  /** An entity in BFO; blank for none chosen. */
  entityId: string;
  name: string;
  /** contribution: the payer's capital contribution; advance: a loan the new entity repays (due to / due from). */
  treatment: "contribution" | "advance";
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
  /** Blank: the principal office. */
  mailing: FormationAddress | null;
  organizers: FormationParty[];
  owners: FormationOwner[];
  /** LLC: run by its owners, or by managers. */
  managed: "members" | "managers";
  managers: FormationOfficial[];
  stock: FormationStock;
  directors: FormationOfficial[];
  officers: FormationOfficer[];
  agent: FormationAgent;
  ein: FormationEin | null;
  taxElection: TaxElection;
  /** Whether it will do business in the principal office's state, when that isn't the state of formation. */
  hostBusiness: "" | "yes" | "no" | "unsure";
  payer: FormationPayer;
  /**
   * Whether the state's filing asks for the members (its requirement schema
   * requires initial_governing_persons). False keeps the owners out of the
   * request; undefined (an older draft) sends them as before.
   */
  membersRequired?: boolean;
  expeditedTier: string;
  /** For Palm's team to read before filing (a name reservation, say). */
  note: string;
  /** Jurisdiction-specific fields, keyed as Palm's requirement schema names them. */
  extra: Record<string, unknown>;
};

/** What a state's requirement schema says about a field Palm's common request already has. */
export type FieldRule = { required: boolean; options: string[]; description: string | null };
/** Keyed by dotted path, arrays without an index: "principal_address.county", "organizers.email". */
export type StateRules = Record<string, FieldRule>;

export const EMPTY_ADDRESS: FormationAddress = { street1: "", street2: "", city: "", region: "", postal: "", county: "" };
export const EMPTY_NAME: PersonName = { first: "", middle: "", last: "", suffix: "" };

export const DEFAULT_PURPOSE = "To engage in any lawful act or activity for which a limited liability company may be organized under the laws of this state.";
export const DEFAULT_PURPOSE_CORP = "To engage in any lawful act or activity for which corporations may be organized under the laws of this state.";

export const emptyParty = (title: string, name: Partial<PersonName> = {}): FormationParty => ({
  kind: "person",
  name: { ...EMPTY_NAME, ...name },
  entityName: "",
  entityType: "",
  title,
  address: null,
  email: "",
  phone: "",
  signerName: "",
  signerCapacity: "",
});

export const emptyOfficial = (title = ""): FormationOfficial => ({ name: { ...EMPTY_NAME }, title, address: null, email: "", phone: "", ssn: "" });
export const emptyOfficer = (role = "president"): FormationOfficer => ({ ...emptyOfficial(OFFICER_ROLES.find(([r]) => r === role)?.[1] ?? ""), role });
export const emptyStockClass = (name = ""): StockClass => ({ name, authorized: "", issued: "", par: "", consideration: "", rights: "" });

export function emptyEin(): FormationEin {
  return {
    responsible: { first: "", middle: "", last: "", ssn: "" },
    reason: "started_new_business",
    reasonDetail: "",
    fiscalYearEndMonth: 12,
    employees: { agricultural: "0", other: "0" },
    wageDate: "",
    activity: { category: "" },
    activityDetail: "",
    hasPreviousEin: false,
    previousEin: "",
    tradeName: "",
    form944: false,
    ownsHighwayVehicle: false,
    involvesGambling: false,
    filesForm720: false,
    involvesAtf: false,
    phone: "",
    mailing: null,
    memberCount: "",
    marriedCouple: "",
    llcClassification: "",
    corporationSubtype: "",
    responsibleConsent: false,
  };
}

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
    mailing: null,
    organizers: [emptyParty("Organizer")],
    owners: [],
    managed: "members",
    managers: [],
    stock: { total: "10000", hasPar: true, par: "0.0001", consideration: "", rights: "", multiClass: false, classes: [] },
    directors: [],
    officers: [],
    agent: { provider: "palm" },
    ein: null,
    taxElection: "default",
    hostBusiness: "",
    payer: { entityId: "", name: "", treatment: "contribution" },
    expeditedTier: "",
    note: "",
    extra: {},
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
  const [first, ...rest] = m[1]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!first) return null;
  return { street1: first, street2: rest.join(", "), city: m[2].trim(), region: m[3].toUpperCase(), postal: m[4], county: "" };
}

export const sameAddress = (a: FormationAddress, b: FormationAddress) =>
  (["street1", "street2", "city", "region", "postal"] as const).every((k) => a[k].trim().toLowerCase() === b[k].trim().toLowerCase());

/** One line: "1 Main St, Suite 2, Reno, NV 89501". */
export const addressLine = (a: FormationAddress) =>
  [
    [a.street1, a.street2]
      .map((x) => x.trim())
      .filter(Boolean)
      .join(", "),
    a.city.trim(),
    `${a.region.trim().toUpperCase()} ${a.postal.trim()}`.trim(),
  ]
    .filter(Boolean)
    .join(", ");

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
  /** What was filed, as sent, with every SSN removed (lib/palm-formation.ts redactDraft). Set once, at submission. */
  request?: FormationDraft;
  /** The statements the person filing made when they filed (FilingAttestation). */
  attestation?: FilingAttestation;
};

/** What the person filing affirmed on the review step, sent with the filing so the server can keep it. */
export type FilingAttestation = {
  version: string;
  /** The words of each statement, as shown. */
  articles: string;
  ss4: string | null;
  /** The responsible party agreed (when they aren't the person filing). */
  responsibleConsent: boolean | null;
  /** Your own registered agent agreed to serve. */
  agentConsent: boolean | null;
  /** The typed confirmation (the legal name). */
  typed: string | null;
  at: number;
};

export const isFormationDone = (s: FormationState | undefined | null) => !!s && (s.status === "completed" || s.status === "canceled");

// ── The EIN application's questions ───────────────────────────────────────

export const EIN_REASONS: [string, string][] = [
  ["started_new_business", "Started a new business"],
  ["hired_employees", "Hired employees"],
  ["banking_purposes", "Banking purposes"],
  ["changed_organization_type", "Changed type of organization"],
  ["purchased_business", "Purchased a going business"],
  ["created_trust", "Created a trust"],
  ["created_pension_plan", "Created a pension plan"],
  ["withholding_compliance", "Compliance with IRS withholding"],
  ["other", "Other"],
];

export const CORPORATION_SUBTYPES: [string, string][] = [
  ["corporation", "C corporation"],
  ["s_corporation", "S corporation"],
  ["personal_service_corporation", "Personal service corporation"],
  ["reit", "REIT"],
  ["ric", "Regulated investment company"],
  ["settlement_fund", "Settlement fund"],
];

/** A follow-up the IRS asks for an activity, shown while `when` holds; every shown one must be answered. */
export type ActivityQuestion = {
  key: string;
  label: string;
  kind: "choice" | "yesno" | "text";
  options?: [string, string][];
  placeholder?: string;
  when?: (a: EinActivity) => boolean;
};

const opts = (...pairs: string[]): [string, string][] =>
  pairs.map((p) => {
    const [v, l] = p.split("|");
    return [v, l ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())];
  });

/** The construction questions (asked for construction, and for real estate built with your own capital). */
export const CONSTRUCTION_QUESTIONS: ActivityQuestion[] = [
  { key: "single_trade", label: "Does it focus on a single construction trade?", kind: "yesno" },
  { key: "trade", label: "Which trade", kind: "text", placeholder: "Electrical", when: (a) => a.single_trade === "yes" },
  {
    key: "construction_type",
    label: "Type of construction",
    kind: "choice",
    options: opts("new_residential|New residential", "remodeling_residential|Residential remodeling", "non_residential|Non-residential", "other_structures|Other structures"),
    when: (a) => a.single_trade === "no",
  },
  { key: "construction_type_detail", label: "What it builds", kind: "text", placeholder: "Bridges and tunnels", when: (a) => a.single_trade === "no" && a.construction_type === "other_structures" },
];

const builds = (a: EinActivity) => a.type === "use_capital_to_build_property";

/** Palm's principal-activity categories, in the IRS's words, with each one's follow-ups. */
export const EIN_ACTIVITIES: { value: string; label: string; hint: string; questions: ActivityQuestion[] }[] = [
  {
    value: "finance",
    label: "Finance",
    hint: "Investing, holding, lending, advice",
    questions: [
      {
        key: "type",
        label: "Kind of finance",
        kind: "choice",
        options: opts(
          "investment_holding|Investment holding",
          "portfolio_management|Portfolio management",
          "investment_advice|Investment advice",
          "investment_club|Investment club",
          "venture_capital|Venture capital",
          "trust_administration|Trust administration",
          "securities_broker|Securities broker",
          "commodities_broker|Commodities broker",
          "mortgage_broker|Mortgage broker",
          "mortgage_company|Mortgage company",
          "sales_financing|Sales financing",
          "credit_card_issuing|Credit card issuing",
          "other|Other",
        ),
      },
    ],
  },
  {
    value: "real_estate",
    label: "Real estate",
    hint: "Renting, building, selling, managing property",
    questions: [
      {
        key: "type",
        label: "Kind of real estate",
        kind: "choice",
        options: opts(
          "rent_lease_owned_property|Rents or leases property it owns",
          "use_capital_to_build_property|Builds property with its own capital",
          "sell_property_for_others|Sells property for others",
          "manage_real_estate_for_others|Manages property for others",
          "other|Other",
        ),
      },
      {
        key: "rental_property_type",
        label: "What it rents",
        kind: "choice",
        options: opts("residential|Residential", "commercial_industrial|Commercial or industrial", "other|Other"),
        when: (a) => a.type === "rent_lease_owned_property",
      },
      ...CONSTRUCTION_QUESTIONS.map((q) => ({ ...q, when: (a: EinActivity) => builds(a) && (!q.when || q.when(a)) })),
    ],
  },
  {
    value: "rental_and_leasing",
    label: "Rental and leasing",
    hint: "Renting out real estate or goods",
    questions: [
      {
        key: "type",
        label: "What it rents or leases",
        kind: "choice",
        options: opts("rent_lease_sell_real_estate|Real estate", "rent_or_lease_goods|Goods", "manage_real_estate_for_others|Manages real estate for others"),
      },
      {
        key: "real_estate_activity",
        label: "Real estate activity",
        kind: "choice",
        options: opts("rent_residential|Rents residential", "rent_commercial_industrial|Rents commercial or industrial", "real_estate_agent|Real estate agent"),
        when: (a) => a.type === "rent_lease_sell_real_estate",
      },
      { key: "goods", label: "Goods rented or leased", kind: "text", placeholder: "Construction equipment", when: (a) => a.type === "rent_or_lease_goods" },
    ],
  },
  { value: "construction", label: "Construction", hint: "Contractors and trades", questions: CONSTRUCTION_QUESTIONS },
  {
    value: "retail",
    label: "Retail",
    hint: "Selling to consumers",
    questions: [
      {
        key: "type",
        label: "How it sells",
        kind: "choice",
        options: opts("selling_goods_online|Online", "storefront_sales|Storefront", "direct_sales|Direct sales", "auction_house|Auction house", "other|Other"),
      },
      {
        key: "direct_sales_method",
        label: "Direct-sales method",
        kind: "choice",
        options: opts("catalogue|Catalogue", "mail_order|Mail order", "door_to_door|Door to door"),
        when: (a) => a.type === "direct_sales",
      },
    ],
  },
  {
    value: "wholesale",
    label: "Wholesale",
    hint: "Selling to businesses for resale",
    questions: [
      { key: "owns_goods", label: "Does it own or take title to the goods?", kind: "yesno" },
      { key: "receives_commission", label: "Does it receive a commission or fee?", kind: "yesno" },
      { key: "goods", label: "Goods sold", kind: "text", placeholder: "Industrial cleaning supplies" },
    ],
  },
  {
    value: "manufacturing",
    label: "Manufacturing",
    hint: "Making goods from materials",
    questions: [{ key: "goods", label: "Goods made, and the main materials", kind: "text", placeholder: "Aluminum cans from sheet aluminum" }],
  },
  {
    value: "accommodations",
    label: "Accommodations",
    hint: "Hotels, motels",
    questions: [{ key: "type", label: "Kind of accommodation", kind: "choice", options: opts("hotel|Hotel", "motel|Motel", "casino_hotel|Casino hotel", "other|Other") }],
  },
  {
    value: "food_service",
    label: "Food service",
    hint: "Restaurants, bars, catering",
    questions: [
      {
        key: "type",
        label: "Kind of food service",
        kind: "choice",
        options: opts(
          "full_service_restaurant|Full-service restaurant",
          "fast_food_restaurant|Fast food",
          "bar|Bar",
          "bar_and_restaurant|Bar and restaurant",
          "coffee_shop|Coffee shop",
          "ice_cream_shop|Ice cream shop",
          "catering_service|Catering",
          "mobile_food_service|Mobile food",
          "other|Other",
        ),
      },
    ],
  },
  {
    value: "health_care",
    label: "Health care",
    hint: "Practices, clinics, hospitals",
    questions: [
      { key: "includes_md", label: "Does it include M.D. practitioners?", kind: "yesno" },
      {
        key: "md_role",
        label: "Practitioners",
        kind: "choice",
        options: opts("medical_doctor|Medical doctor", "psychiatrist|Psychiatrist", "other_mental_health_practitioner|Other mental health"),
        when: (a) => a.includes_md === "yes",
      },
      {
        key: "non_md_role",
        label: "Practice",
        kind: "choice",
        options: opts(
          "chiropractor|Chiropractor",
          "dentist|Dentist",
          "hmo_medical_center|HMO medical center",
          "hospital|Hospital",
          "kidney_dialysis_center|Kidney dialysis center",
          "optometrist|Optometrist",
          "outpatient_care_center|Outpatient care center",
          "podiatrist|Podiatrist",
          "psychologist|Psychologist",
          "other_mental_health_practitioner|Other mental health",
          "other|Other",
        ),
        when: (a) => a.includes_md === "no",
      },
    ],
  },
  {
    value: "insurance",
    label: "Insurance",
    hint: "Carriers, agents, brokers",
    questions: [
      { key: "type", label: "Kind of insurance", kind: "choice", options: opts("insurance_carrier|Carrier", "insurance_agent_or_broker|Agent or broker", "other|Other") },
      { key: "support_activity_detail", label: "The support activity", kind: "text", placeholder: "Claims adjusting", when: (a) => a.type === "other" },
    ],
  },
  {
    value: "social_assistance",
    label: "Social assistance",
    hint: "Nursing homes, shelters, youth",
    questions: [{ key: "type", label: "Kind of assistance", kind: "choice", options: opts("nursing_home|Nursing home", "shelter|Shelter", "youth_services|Youth services", "other|Other") }],
  },
  {
    value: "transportation",
    label: "Transportation",
    hint: "Moving cargo or passengers",
    questions: [
      { key: "type", label: "What it transports", kind: "choice", options: opts("cargo|Cargo", "passengers|Passengers", "support_activity|Support activity") },
      { key: "cargo_mode", label: "How", kind: "choice", options: opts("trucking|Trucking", "air|Air", "rail|Rail", "water|Water", "other|Other"), when: (a) => a.type === "cargo" },
      { key: "passenger_mode", label: "How", kind: "choice", options: opts("limousine|Limousine", "shuttle_bus|Shuttle bus", "taxi|Taxi", "other|Other"), when: (a) => a.type === "passengers" },
    ],
  },
  { value: "warehousing", label: "Warehousing", hint: "Storage", questions: [] },
  {
    value: "other",
    label: "Something else",
    hint: "Consulting, services, repair…",
    questions: [
      {
        key: "type",
        label: "Kind of activity",
        kind: "choice",
        options: opts(
          "consulting|Consulting",
          "service|Services",
          "organization|Organization",
          "rental|Rental",
          "repair|Repair",
          "sell_goods|Selling goods",
          "manufacturing|Manufacturing",
          "other|Other",
        ),
      },
    ],
  },
];

/** The follow-ups showing for this activity's answers so far. */
export const activityQuestions = (a: EinActivity) => (EIN_ACTIVITIES.find((x) => x.value === a.category)?.questions ?? []).filter((q) => !q.when || q.when(a));

// ── What's still missing ─────────────────────────────────────────────────

/** The wizard's steps, in order; problems name the one they belong to. */
export const STEP_KEYS = ["entity", "business", "ownership", "filers", "agent", "ein", "state", "review"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type DraftProblem = { step: StepKey; text: string };

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const POSTAL_RE = /^\d{5}(-\d{4})?$/;
const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;
const EIN_RE = /^\d{2}-?\d{7}$/;
const NUM_RE = /^\d+(\.\d+)?$/;

/** The number in a field as typed, or NaN. */
export const num = (s: string | undefined | null) => (NUM_RE.test((s ?? "").replace(/,/g, "").trim()) ? Number((s ?? "").replace(/,/g, "")) : Number.NaN);

/** How many members the EIN application reports: what was typed, or the owners. */
export const einMemberCount = (d: FormationDraft) => {
  const typed = num(d.ein?.memberCount);
  return typed >= 1 ? Math.floor(typed) : Math.max(1, d.owners.length);
};

/**
 * Whether to ask if the two members are spouses holding the LLC as community
 * property (Rev. Proc. 2002-69): an LLC with exactly two members, both people.
 * It turns on the spouses' home state's law, not the office's, so the office's
 * state doesn't decide it; two companies are never spouses.
 */
export const asksMarried = (d: FormationDraft) => d.entityType === "llc" && einMemberCount(d) === 2 && d.owners.length === 2 && d.owners.every((o) => o.kind === "person");

export const hasName = (n: PersonName) => !!n.first.trim() && !!n.last.trim();

// ── Tax ───────────────────────────────────────────────────────────────────

/** The federal classifications the entity record uses (app/entity-paperwork.ts TAX_CLASSES). */
export type FormationTaxClass = "Disregarded Entity" | "Partnership" | "S Corporation" | "C Corporation";

export type TaxOutcome = {
  value: FormationTaxClass;
  /** Chosen by election rather than the IRS default. */
  elected: boolean;
  /** The IRS form the election takes, if any. */
  form: "2553" | "8832" | null;
};

/**
 * What it will be for federal tax. An LLC by default: one member (or a
 * married couple who choose it) is disregarded; two or more file as a
 * partnership. An LLC electing S files Form 2553 (which also elects
 * corporate classification); electing C, Form 8832. A corporation is C unless
 * it elects S on Form 2553.
 */
export function taxOutcome(d: FormationDraft): TaxOutcome {
  if (d.entityType === "corporation") return d.taxElection === "s_corp" ? { value: "S Corporation", elected: true, form: "2553" } : { value: "C Corporation", elected: false, form: null };
  if (d.taxElection === "s_corp") return { value: "S Corporation", elected: true, form: "2553" };
  if (d.taxElection === "c_corp") return { value: "C Corporation", elected: true, form: "8832" };
  const couple = asksMarried(d) && d.ein?.marriedCouple === "yes" && d.ein.llcClassification === "single_member";
  return { value: einMemberCount(d) === 1 || couple ? "Disregarded Entity" : "Partnership", elected: false, form: null };
}

/** Calendar arithmetic on "YYYY-MM-DD", in UTC so a date never shifts. */
export function addToDate(iso: string, o: { months?: number; days?: number }): string {
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (o.months ?? 0), 1));
  // Keep the day within the target month (Jan 31 + 1 month is Feb 28).
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last) + (o.days ?? 0));
  return d.toISOString().slice(0, 10);
}

/** Today as "YYYY-MM-DD" in the viewer's calendar. */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/**
 * When an election must be filed to apply from the start: Form 2553 within 2
 * months and 15 days of the first tax year's start (a year starting Jan 7 is
 * due Mar 21); Form 8832 within 75 days, the furthest back it can reach.
 * Counted from the effective date, or from `today` when it takes effect on
 * acceptance (an estimate: the state's date can only be later).
 */
export function electionDeadline(d: FormationDraft, today = todayIso()): { form: "2553" | "8832"; dueBy: string; from: string; estimated: boolean } | null {
  const t = taxOutcome(d);
  if (!t.form) return null;
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate);
  const from = dated ? d.effectiveDate : today;
  const dueBy = t.form === "2553" ? addToDate(addToDate(from, { months: 2 }), { days: 14 }) : addToDate(from, { days: 75 });
  return { form: t.form, dueBy, from, estimated: !dated };
}

/** Pass-through classifications generally must use their owners' tax year (§706(b), §1378): December, unless §444 or an IRS ruling says otherwise. */
export const fiscalYearFollowsOwners = (d: FormationDraft) => taxOutcome(d).value !== "C Corporation";

/** How the formation cost is treated for tax, by classification (§248 corporations, §709 partnerships). */
export function organizationalCostNote(t: FormationTaxClass): string {
  if (t === "Disregarded Entity") return "For tax it's its owner's organizational cost.";
  const section = t === "Partnership" ? "§709" : "§248";
  return `An organizational cost under ${section}: up to $5,000 deductible in the first year, the rest over 180 months.`;
}

// ── Dates ─────────────────────────────────────────────────────────────────

/** How far ahead most states let articles take effect. */
export const MAX_DELAY_DAYS = 90;

/** What's wrong with a delayed effective date, or null: it can't be in the past or more than 90 days out. */
export function effectiveDateProblem(iso: string, today = todayIso()): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Check the effective date.";
  if (iso < today) return "The effective date can't be in the past.";
  if (iso > addToDate(today, { days: MAX_DELAY_DAYS })) return `The effective date can be at most ${MAX_DELAY_DAYS} days ahead.`;
  return null;
}

// ── Who signs ─────────────────────────────────────────────────────────────

const words = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Whether a name is the signed-in person's: the same first and last names (a middle name or suffix may differ). */
export function isPersonFiling(n: { first: string; last: string }, me: { name?: string | null } | null): boolean {
  const mine = words(me?.name);
  if (mine.length < 2) return false;
  const first = words(n.first)[0];
  const last = words(n.last).at(-1);
  return !!first && !!last && first === mine[0] && last === mine.at(-1);
}

/** The named organizers who aren't the person filing: they haven't authorized signing in their name, so they block filing. */
export function absentSigners(d: FormationDraft, me: { name?: string | null } | null): string[] {
  return d.organizers
    .filter((o) => (o.kind === "person" ? hasName(o.name) && !isPersonFiling(o.name, me) : !!o.signerName.trim() && !isPersonFiling(splitName(o.signerName), me)))
    .map((o) =>
      o.kind === "person"
        ? [o.name.first, o.name.middle, o.name.last, o.name.suffix]
            .map((x) => x.trim())
            .filter(Boolean)
            .join(" ")
        : o.signerName.trim(),
    );
}

/** "Sam A. Sample" → first and last. */
export function splitName(full: string): PersonName {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? "", middle: "", last: "", suffix: "" };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1], suffix: "" };
}

/** The responsible party isn't the person filing: they must agree to be named, and to their SSN being sent. */
export const responsibleIsSomeoneElse = (d: FormationDraft, me: { name?: string | null } | null) =>
  !!d.ein && !!d.ein.responsible.first.trim() && !!d.ein.responsible.last.trim() && !isPersonFiling(d.ein.responsible, me);

/** What stops the person filing from filing, beyond the draft's own gaps: signatures that aren't theirs to give. */
export function signerProblems(d: FormationDraft, me: { name?: string | null } | null): DraftProblem[] {
  const out: DraftProblem[] = [];
  const word = d.entityType === "llc" ? "organizer" : "incorporator";
  for (const name of absentSigners(d, me)) out.push({ step: "filers", text: `${name} must sign as ${word}. Name yourself, or have ${name} file it.` });
  if (responsibleIsSomeoneElse(d, me) && !d.ein?.responsibleConsent) out.push({ step: "ein", text: "Confirm the responsible party agreed to be named." });
  return out;
}

/** The statement the person filing makes about the articles (§11.4: the words they agree to are the words shown). */
export function articlesStatement(d: FormationDraft, signer: string): string {
  const doc = d.entityType === "llc" ? "articles of organization" : "articles of incorporation";
  const role = d.entityType === "llc" ? "organizer" : "incorporator";
  return `I am ${signer || `the ${role}`}, the ${role} named in these ${doc}. I authorize Palm to sign and file them in my name, and the information in them is true and correct.`;
}

/** The SS-4 declaration and the third-party designee authorization, when Palm applies for the EIN. */
export function ss4Statement(d: FormationDraft): string {
  const name = d.legalName.trim() || "the entity";
  return `I'm authorized to sign Form SS-4 for ${name}. Under penalties of perjury, I declare that the application is true, correct and complete to the best of my knowledge, and I authorize Palm, as third-party designee, to receive its EIN and answer questions about the application.`;
}

/** The version of the statements above; the server keeps it with the filing. */
export const ATTESTATION_VERSION = "2026-11-06";

// ── Addresses ─────────────────────────────────────────────────────────────

/** A mail-receiving address (a PMB, a P.O. box, a mailbox suite), which some states won't take as a principal office. */
export function looksLikeMailbox(a: FormationAddress | null | undefined): boolean {
  if (!a) return false;
  const line = `${a.street1} ${a.street2}`;
  return /\b(p\.?\s?o\.?\s?box|pmb|mailbox|private mailbox|box\s+\d+)\b/i.test(line) || /\b(ste|suite|unit|#)\s*#?\s*\d{5,}\b/i.test(line);
}

/** The state it's run from, when that isn't the state of formation ("AZ"), or null. */
export function hostState(d: FormationDraft): string | null {
  const host = d.principal.region.trim().toUpperCase();
  const home = d.jurisdiction.slice(3);
  return /^[A-Z]{2}$/.test(host) && /^[A-Z]{2}$/.test(home) && host !== home ? host : null;
}

// ── What it will cost beyond the filing ──────────────────────────────────

type CostRow = { llc: number | null; corp: number | null; what: string };

/**
 * The states the office forms in most often, as of late 2026: each state's
 * yearly filing, and what registering there as a foreign entity costs.
 * Estimates for planning; the state's own fee schedule governs.
 */
const YEARLY: Record<string, CostRow> = {
  WY: { llc: 60, corp: 60, what: "annual report and license tax (the minimum)" },
  DE: { llc: 300, corp: 225, what: "annual tax (an LLC) or franchise tax and report (a corporation, the minimum)" },
  NV: { llc: 350, corp: 650, what: "annual list and state business license" },
  AZ: { llc: 0, corp: 45, what: "annual report (corporations only)" },
};
const FOREIGN: Record<string, CostRow> = {
  AZ: { llc: 150, corp: 150, what: "foreign registration" },
  NV: { llc: 425, corp: 725, what: "foreign registration, first annual list and business license" },
  DE: { llc: 300, corp: 245, what: "foreign registration" },
  WY: { llc: 150, corp: 150, what: "foreign registration" },
};

export type ExpectedCost = { label: string; dollars: number | null; per: "once" | "year" };

/** What forming here commits it to, beyond the filing itself: the state's yearly filing, and a second state if it's run from one. */
export function expectedCosts(d: FormationDraft): ExpectedCost[] {
  const out: ExpectedCost[] = [];
  const corp = d.entityType === "corporation";
  const home = d.jurisdiction.slice(3);
  const pick = (r: CostRow | undefined) => (r ? (corp ? r.corp : r.llc) : null);
  if (/^[A-Z]{2}$/.test(home)) {
    const y = YEARLY[home];
    out.push({ label: `${stateName(d.jurisdiction)} ${y?.what ?? "yearly filing"}`, dollars: pick(y), per: "year" });
  }
  if (d.agent.provider === "palm") out.push({ label: "Registered agent (Palm's yearly fee)", dollars: null, per: "year" });
  const host = hostState(d);
  if (host && d.hostBusiness !== "no") {
    const name = stateName(`US-${host}`);
    out.push({ label: `${name} ${FOREIGN[host]?.what ?? "foreign registration"}, if it does business there`, dollars: pick(FOREIGN[host]), per: "once" });
    const y = YEARLY[host];
    if (pick(y) !== 0) out.push({ label: `${name} ${y?.what ?? "yearly filing"}, once registered`, dollars: pick(y), per: "year" });
    out.push({ label: `A registered agent in ${name}`, dollars: null, per: "year" });
  }
  return out;
}

// ── Palm's price lines ───────────────────────────────────────────────────

/**
 * A plain name for a line of Palm's price, from its component type: never
 * Palm's internal item name ("Default"). An unknown line says what share of
 * the state's fee it is, so nobody has to guess what it is for.
 */
export function feeLabel(item: { kind: string; name: string; amount: number }, items: { kind: string; name: string; amount: number }[]): string {
  const k = `${item.kind} ${item.name}`.toLowerCase();
  if (/expedit|rush|priority/.test(k)) return "Expedited processing";
  if (/agent/.test(k)) return "Registered agent";
  if (/card|payment|processing|transaction|merchant/.test(k)) return "Card processing";
  if (/service|platform|palm/.test(k)) return "Palm's service fee";
  if (/state|government|filing|base|statutory|articles/.test(k)) return "State filing fee";
  const base = items.find((i) => i !== item && /state|government|filing|base|statutory|articles/.test(`${i.kind} ${i.name}`.toLowerCase()));
  const name = item.name.trim();
  const plain = name && !/^default$/i.test(name) ? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Other charge";
  if (base && base.amount > 0) {
    const pct = Math.round((item.amount / base.amount) * 1000) / 10;
    return `${plain} (${pct}% of the state fee)`;
  }
  return plain;
}

/** Whether Palm's lines add up to its total, to the cent. */
export const feeFoots = (total: number, items: { amount: number }[]) => Math.abs(Math.round(items.reduce((n, i) => n + i.amount, 0) * 100) - Math.round(total * 100)) < 1;

// ── The state's own questions ────────────────────────────────────────────

export type StateQuestionCopy = { label: string; hint: string; long?: boolean; preset?: unknown };

/**
 * Plain words for state-specific questions Palm's schema asks in its own
 * terms. Matched on the schema's label and description, since the keys vary.
 * A known election starts at "No" (the state's default) and says so.
 */
export function stateQuestionCopy(f: { key: string; label: string; description: string | null; type: string }, state: string): StateQuestionCopy {
  const text = `${f.key} ${f.label} ${f.description ?? ""}`;
  if (/close\s+(limited liability )?compan|close_llc|close_company/i.test(text) && f.type === "boolean") {
    const statute = /W\.?\s?S\.?\s?17-25/i.test(text) ? " (W.S. 17-25-101 to 17-25-109)" : "";
    return {
      label: "Make it a close LLC?",
      hint: `A close LLC${statute} restricts transferring or withdrawing a membership interest. It's usually chosen with counsel for estate planning and must agree with the operating agreement. Leave it at No unless your lawyer says otherwise.`,
      preset: false,
    };
  }
  if (f.type === "string" && /additional|other provisions|optional provisions|free.?text|articles/i.test(text)) {
    return {
      label: "Anything else for the articles",
      hint: "Printed on the public articles. Have counsel draft anything here: where it conflicts with the operating agreement, the articles generally govern.",
      long: true,
    };
  }
  return { label: sentenceCase(f.label.replace(/\s*\((free text|optional|text)\)\s*/gi, " ")), hint: f.description ?? `${state} asks this on its filing.` };
}

const PROPER = new Set(US_STATES.flatMap(([, n]) => n.split(" ")));

/** "Close Limited Liability Company Election" → "Close limited liability company election"; state names and acronyms keep their capitals. */
export function sentenceCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z0-9.]{2,}$/.test(w) || PROPER.has(w) ? w : w.toLowerCase()))
    .join(" ");
}

/** Where the request puts the people who sign the articles. */
export const filersKey = (t: FormationEntityType) => (t === "llc" ? "organizers" : "incorporators");

/** What's still missing before Palm is asked, by the wizard's step. `rules` adds what the state requires. */
export function draftProblems(d: FormationDraft, rules: StateRules = {}, extras: { key: string; label: string; required: boolean }[] = [], today = todayIso()): DraftProblem[] {
  const out: DraftProblem[] = [];
  const add = (step: StepKey, text: string) => out.push({ step, text });
  const needs = (path: string) => !!rules[path]?.required;
  const blank = (s: string | undefined | null) => !(s ?? "").trim();
  const addressCheck = (step: StepKey, a: FormationAddress, what: string, path?: string) => {
    if (blank(a.street1)) add(step, `${what}: street`);
    if (blank(a.city)) add(step, `${what}: city`);
    if (!/^[A-Z]{2}$/.test(a.region.trim().toUpperCase())) add(step, `${what}: state`);
    if (!POSTAL_RE.test(a.postal.trim())) add(step, `${what}: ZIP code`);
    if (path && needs(`${path}.county`) && blank(a.county)) add(step, `${what}: county (${stateName(d.jurisdiction) || "the state"} asks for it)`);
  };
  const contactCheck = (step: StepKey, p: { email: string; phone: string }, what: string, path: string) => {
    if (needs(`${path}.email`) && !EMAIL_RE.test(p.email.trim())) add(step, `${what}: email (the state asks for it)`);
    else if (p.email.trim() && !EMAIL_RE.test(p.email.trim())) add(step, `${what}: check the email`);
    if (needs(`${path}.phone`) && blank(p.phone)) add(step, `${what}: phone (the state asks for it)`);
  };
  const officialCheck = (step: StepKey, p: FormationOfficial, what: string, path: string) => {
    if (!hasName(p.name)) add(step, `${what} needs a first and last name.`);
    if (needs(`${path}.title`) && blank(p.title)) add(step, `${what}: title (the state asks for it)`);
    if (p.address) addressCheck(step, p.address, what, `${path}.address`);
    contactCheck(step, p, what, path);
    if (needs(`${path}.ssn`) && !SSN_RE.test(p.ssn.trim())) add(step, `${what}: SSN (the state's portal asks for it)`);
    else if (p.ssn.trim() && !SSN_RE.test(p.ssn.trim())) add(step, `${what}: check the SSN`);
  };
  const llc = d.entityType === "llc";

  // Entity
  if (!/^US-[A-Z]{2}$/.test(d.jurisdiction)) add("entity", "Choose a state.");
  if (d.legalName.trim().length < 3) add("entity", "Give the entity a name.");
  const dateProblem = effectiveDateProblem(d.effectiveDate, today);
  if (dateProblem) add("entity", dateProblem);

  // Business
  if (blank(d.purpose)) add("business", "A purpose is required.");
  if (!EMAIL_RE.test(d.email.trim())) add("business", "A business email is required.");
  if (needs("phone") && blank(d.phone)) add("business", "A business phone (the state asks for it).");
  if (needs("website") && blank(d.website)) add("business", "A website (the state asks for it).");
  addressCheck("business", d.principal, "Principal office", "principal_address");
  if (d.mailing) addressCheck("business", d.mailing, "Mailing address", "mailing_address");
  if (blank(d.contact.name) || !EMAIL_RE.test(d.contact.email.trim())) add("business", "Palm needs a contact person with an email.");

  // Ownership
  d.owners.forEach((o, i) => {
    const n = d.owners.length > 1 ? `Owner ${i + 1}` : "The owner";
    if (o.kind === "person" ? !hasName(o.name) : blank(o.entityName)) add("ownership", `${n} needs a name.`);
    if (o.kind === "entity" && o.entityKind === "trust" && blank(o.trustee)) add("ownership", `${n}: name the trustee who holds it.`);
    const pct = ownerPercent(o);
    if (!(pct > 0 && pct <= 100)) add("ownership", `${n} needs a percentage.`);
    if (o.contribution?.trim() && Number.isNaN(num(o.contribution))) add("ownership", `${n}: check the contribution.`);
    if (o.contribution?.trim() && o.contributionKind === "property" && blank(o.contributionNote)) add("ownership", `${n}: say what property is contributed.`);
    if (o.contributionDate?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(o.contributionDate)) add("ownership", `${n}: check the contribution date.`);
    if (llc) {
      if (o.address) addressCheck("ownership", o.address, n, "initial_governing_persons.address");
      contactCheck("ownership", o, n, "initial_governing_persons");
      if (o.kind === "person" && o.ssn.trim() && !SSN_RE.test(o.ssn.trim())) add("ownership", `${n}: check the SSN`);
    }
  });
  if (d.owners.length && d.owners.every((o) => ownerPercent(o) > 0) && ownersTotal(d.owners) !== 100) add("ownership", `Ownership adds up to ${ownersTotal(d.owners)}%, not 100%.`);
  if (llc) {
    if (d.managed === "managers" && !d.managers.length) add("ownership", "A manager-managed LLC needs at least one manager.");
    if (d.managed === "managers") d.managers.forEach((m, i) => officialCheck("ownership", m, `Manager ${i + 1}`, "initial_governing_persons"));
  } else {
    const s = d.stock;
    if (!s.multiClass) {
      if (!(num(s.total) > 0)) add("ownership", "How many shares are authorized?");
      if (s.hasPar && !(num(s.par) > 0)) add("ownership", "Give the par value per share, or choose no par value.");
    } else {
      if (!s.classes.length) add("ownership", "Add at least one class of stock.");
      s.classes.forEach((c, i) => {
        if (blank(c.name)) add("ownership", `Stock class ${i + 1} needs a name.`);
        if (!(num(c.authorized) > 0)) add("ownership", `Stock class ${c.name.trim() || i + 1}: authorized shares`);
        if (c.issued.trim() && num(c.issued) > num(c.authorized)) add("ownership", `Stock class ${c.name.trim() || i + 1} issues more shares than it authorizes.`);
      });
    }
    if (s.consideration.trim() && Number.isNaN(num(s.consideration))) add("ownership", "Check the total consideration.");
    d.directors.forEach((p, i) => officialCheck("ownership", p, `Director ${i + 1}`, "initial_directors"));
    d.officers.forEach((p, i) => {
      officialCheck("ownership", p, `Officer ${i + 1}`, "initial_officers");
      if (p.role === "other" && blank(p.title)) add("ownership", `Officer ${i + 1}: name the office.`);
    });
    if (needs("initial_directors") && !d.directors.length) add("ownership", `${stateName(d.jurisdiction)} asks for the initial directors.`);
    if (needs("initial_officers") && !d.officers.length) add("ownership", `${stateName(d.jurisdiction)} asks for the initial officers.`);
  }

  // Filers
  const filers = filersKey(d.entityType);
  const filerWord = llc ? "Organizer" : "Incorporator";
  if (!d.organizers.length) add("filers", `At least one ${filerWord.toLowerCase()} is required.`);
  d.organizers.forEach((o, i) => {
    const n = d.organizers.length > 1 ? `${filerWord} ${i + 1}` : `The ${filerWord.toLowerCase()}`;
    if (o.kind === "person" ? !hasName(o.name) : blank(o.entityName)) add("filers", `${n} needs a name.`);
    if (o.kind === "entity" && blank(o.signerName)) add("filers", `${n}: who signs for the company?`);
    if (o.kind === "entity" && blank(o.signerCapacity)) add("filers", `${n}: in what capacity they sign (Manager, President…)`);
    if (o.kind === "entity" && needs(`${filers}.entity_type`) && blank(o.entityType)) add("filers", `${n}: what kind of entity (the state asks)`);
    if (needs(`${filers}.title`) && blank(o.title)) add("filers", `${n}: title (the state asks for it)`);
    if (o.address) addressCheck("filers", o.address, n, `${filers}.address`);
    contactCheck("filers", o, n, filers);
  });

  // Agent
  if (d.agent.provider === "own") {
    const a = d.agent;
    if (a.kind === "person" ? !hasName(a.name) : blank(a.entityName)) add("agent", "Name the registered agent.");
    addressCheck("agent", a.address, "Registered office", "registered_agent.address");
    if (a.address.region && `US-${a.address.region.toUpperCase()}` !== d.jurisdiction) add("agent", "The registered office must be in the state of formation.");
    if (a.mailing) addressCheck("agent", a.mailing, "Agent's mailing address", "registered_agent.mailing_address");
    contactCheck("agent", a, "Registered agent", "registered_agent");
    if (!a.consent) add("agent", "Confirm the agent has agreed to serve.");
  }

  // EIN
  const e = d.ein;
  if (e) {
    if (blank(e.responsible.first) || blank(e.responsible.last)) add("ein", "The responsible party needs a first and last name.");
    if (!SSN_RE.test(e.responsible.ssn.trim())) add("ein", "The responsible party's SSN or ITIN is needed.");
    if (e.reason === "other" && blank(e.reasonDetail)) add("ein", "Say why you're applying.");
    if (!(e.fiscalYearEndMonth >= 1 && e.fiscalYearEndMonth <= 12)) add("ein", "Choose the month the fiscal year ends.");
    const ag = num(e.employees.agricultural || "0");
    const other = num(e.employees.other || "0");
    if (Number.isNaN(ag) || Number.isNaN(other)) add("ein", "Check the expected employee counts.");
    else if (ag + other > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(e.wageDate)) add("ein", "When will wages first be paid?");
    if (!e.activity.category) add("ein", "Choose the principal activity.");
    else for (const q of activityQuestions(e.activity)) if (blank(e.activity[q.key])) add("ein", `Principal activity: ${q.label.replace(/\?$/, "").toLowerCase()}`);
    if (blank(e.activityDetail)) add("ein", "Describe what it sells, makes or does (line 17).");
    if (e.hasPreviousEin && !EIN_RE.test(e.previousEin.trim())) add("ein", "Give the previous EIN (12-3456789).");
    if (e.mailing) addressCheck("ein", e.mailing, "EIN mailing address");
    if (llc && e.memberCount.trim() && !(num(e.memberCount) >= 1)) add("ein", "Check the number of members.");
    if (asksMarried(d)) {
      if (!e.marriedCouple) add("ein", "Are the two members married to each other?");
      else if (e.marriedCouple === "yes" && !e.llcClassification) add("ein", "Choose how the married couple's LLC is taxed.");
    }
  }

  // State
  for (const f of extras) {
    const v = d.extra[f.key];
    if (f.required && (v === undefined || v === null || v === "")) add("state", `${f.label} is required in ${stateName(d.jurisdiction) || "this state"}.`);
  }

  return out;
}
