import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityQuestions,
  asksMarried,
  draftProblems,
  EMPTY_ADDRESS,
  emptyDraft,
  emptyEin,
  emptyOfficer,
  emptyOfficial,
  emptyOwner,
  emptyParty,
  emptyStockClass,
  officeAddress,
  ownerName,
  parentOwnerId,
  parseAddress,
  sameAddress,
  type FormationDraft,
  type FormationEin,
} from "../app/formation";
import { buildFormationRequest, einPatch, extraFields, formationPatch, principalActivity, redactDraft, stateRules, summarizeFiling } from "../lib/palm-formation";

const { state, sbMock } = vi.hoisted(() => ({ state: { role: "owner" as string | null }, sbMock: vi.fn() }));

vi.mock("../lib/auth.js", () => ({
  currentUser: vi.fn(async () => (state.role ? { id: "u1", role: state.role } : null)),
  canWrite: (u: { role: string }) => u.role !== "viewer",
  isAdmin: (u: { role: string }) => u.role === "owner" || u.role === "admin",
  sb: sbMock,
}));

import handler from "../api/palm";

function fullDraft(): FormationDraft {
  const d = emptyDraft();
  d.jurisdiction = "US-NV";
  d.legalName = "Example Holdings, LLC";
  d.email = "ops@example.com";
  d.contact = { name: "Robert Burton", email: "robert@example.com", phone: "" };
  d.principal = { street1: "1 Main St", street2: "Suite 2", city: "Reno", region: "NV", postal: "89501", county: "" };
  d.organizers = [emptyParty("Organizer", { first: "Robert", last: "Burton" })];
  return d;
}

const person = (first: string, last: string) => ({ first, middle: "", last, suffix: "" });

function fullEin(over: Partial<FormationEin> = {}): FormationEin {
  return {
    ...emptyEin(),
    responsible: { first: "Robert", middle: "", last: "Burton", ssn: "123-45-6789" },
    activity: { category: "finance", type: "investment_holding" },
    activityDetail: "Holds family investments",
    ...over,
  };
}

describe("formation draft", () => {
  it("lists what's missing by step", () => {
    const problems = draftProblems(emptyDraft());
    expect(new Set(problems.map((p) => p.step))).toEqual(new Set(["entity", "business", "filers"]));
    expect(draftProblems(fullDraft())).toEqual([]);
  });

  it("asks for the agent and every EIN answer when chosen", () => {
    const d = fullDraft();
    d.agent = { provider: "own", kind: "organization", name: person("", ""), entityName: "", address: { ...EMPTY_ADDRESS, region: "AZ" }, mailing: null, email: "", phone: "" };
    d.ein = { ...emptyEin(), responsible: { first: "", middle: "", last: "", ssn: "123-45" }, employees: { agricultural: "0", other: "3" }, activity: { category: "real_estate", type: "rent_lease_owned_property" } };
    const texts = draftProblems(d).map((p) => p.text);
    expect(texts).toContain("Name the registered agent.");
    expect(texts).toContain("The registered office must be in the state of formation.");
    expect(texts).toContain("The responsible party's SSN or ITIN is needed.");
    expect(texts).toContain("When will wages first be paid?");
    expect(texts).toContain("Principal activity: what it rents");
    expect(texts).toContain("Describe what it sells, makes or does (line 17).");
  });

  it("asks what the state requires: a county, an organizer's email, its own fields", () => {
    const d = fullDraft();
    const rules = { "principal_address.county": { required: true, options: [], description: null }, "organizers.email": { required: true, options: [], description: null } };
    const texts = draftProblems(d, rules, [{ key: "management_type", label: "Management", required: true }]).map((p) => p.text);
    expect(texts).toEqual(["Principal office: county (Nevada asks for it)", "The organizer: email (the state asks for it)", "Management is required in Nevada."]);
  });

  it("asks a two-member LLC in a community-property state whether the members are married", () => {
    const d = fullDraft();
    d.owners = [
      { ...emptyOwner("person", "50"), name: person("Robert", "Burton") },
      { ...emptyOwner("person", "50"), name: person("Jane", "Burton") },
    ];
    d.ein = fullEin();
    expect(asksMarried(d)).toBe(true);
    expect(draftProblems(d).map((p) => p.text)).toEqual(["Are the two members married to each other?"]);
    d.ein.marriedCouple = "yes";
    expect(draftProblems(d).map((p) => p.text)).toEqual(["Choose how the married couple's LLC is taxed."]);
    d.ein.llcClassification = "single_member";
    expect(draftProblems(d)).toEqual([]);
    const body = buildFormationRequest(d, "a") as any;
    expect(body.ein).toMatchObject({ llc_member_count: 2, members_are_married_couple: true, llc_classification: "single_member" });
    d.principal.region = "NY";
    expect(asksMarried(d)).toBe(false);
    expect((buildFormationRequest(d, "a") as any).ein.members_are_married_couple).toBeUndefined();
  });
});

describe("owners", () => {
  const owners = (): FormationDraft["owners"] => [
    { ...emptyOwner("entity", "60"), entityId: "louise", entityName: "Ledger Louise, LLC" },
    { ...emptyOwner("person", "40"), name: person("Jane", "Doe"), email: "jane@example.com", address: { street1: "2 Elm St", street2: "", city: "Reno", region: "NV", postal: "89502", county: "" } },
  ];

  it("must name everyone and add up to 100", () => {
    const d = fullDraft();
    d.owners = owners();
    expect(draftProblems(d)).toEqual([]);
    d.owners[1].percent = "30";
    expect(draftProblems(d).map((p) => p.text)).toEqual(["Ownership adds up to 90%, not 100%."]);
    d.owners[1] = { ...emptyOwner("person", ""), name: person("Jane", "") };
    expect(draftProblems(d).map((p) => p.text)).toEqual(["Owner 2 needs a name.", "Owner 2 needs a percentage."]);
  });

  it("go to Palm as the LLC's members, managers after them, and the largest one in BFO is the parent", () => {
    const d = fullDraft();
    d.owners = owners();
    d.managed = "managers";
    d.managers = [{ ...emptyOfficial("Manager"), name: person("Robert", "Burton") }];
    d.ein = fullEin();
    const body = buildFormationRequest(d, "a") as any;
    expect(body.initial_governing_persons).toEqual([
      { name: { type: "entity", entity_name: "Ledger Louise, LLC" }, address: body.principal_address, role: "member", title: "Member" },
      { name: { type: "person", first: "Jane", last: "Doe" }, address: { street_line_1: "2 Elm St", city: "Reno", region: "NV", postal_code: "89502", country: "US" }, role: "member", title: "Member", email: "jane@example.com" },
      { name: { type: "person", first: "Robert", last: "Burton" }, role: "manager", title: "Manager", address: body.principal_address },
    ]);
    expect(body.ein.llc_member_count).toBe(2);
    expect(parentOwnerId(d.owners)).toBe("louise");
    expect(ownerName(d.owners[1])).toBe("Jane Doe");
    // Member-managed: the managers listed are left out.
    d.managed = "members";
    expect((buildFormationRequest(d, "a") as any).initial_governing_persons).toHaveLength(2);
  });
});

describe("formation request", () => {
  it("becomes Palm's body, with the entity id in metadata", () => {
    const body = buildFormationRequest(fullDraft(), "asset1") as any;
    expect(body.jurisdiction).toBe("US-NV");
    expect(body.legal_name).toBe("Example Holdings, LLC");
    expect(body.principal_address).toEqual({ street_line_1: "1 Main St", street_line_2: "Suite 2", city: "Reno", region: "NV", postal_code: "89501", country: "US" });
    expect(body.mailing_address).toBeUndefined();
    expect(body.organizers[0]).toEqual({ name: { type: "person", first: "Robert", last: "Burton" }, address: body.principal_address, title: "Organizer" });
    expect(body.initial_governing_persons).toBeUndefined();
    expect(body.registered_agent).toBeUndefined(); // Palm serves
    expect(body.ein).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.metadata).toEqual({ bfo_asset_id: "asset1" });
  });

  it("sends a corporation's stock, board and officers, and its EIN with every answer", () => {
    const d = fullDraft();
    d.entityType = "corporation";
    d.organizers = [{ ...emptyParty("Incorporator"), kind: "entity", entityName: "Ledger Louise, LLC", entityType: "limited_liability_company", email: "ops@example.com" }];
    d.stock = { total: "1,000,000", hasPar: true, par: "0.0001", consideration: "100", rights: "", multiClass: false, classes: [] };
    d.directors = [{ ...emptyOfficial("Chair"), name: { first: "Robert", middle: "A", last: "Burton", suffix: "Jr." } }];
    d.officers = [{ ...emptyOfficer("president"), name: person("Robert", "Burton") }, { ...emptyOfficer("other"), title: "Chief investment officer", name: person("Jane", "Doe") }];
    d.mailing = { street1: "PO Box 9", street2: "", city: "Reno", region: "NV", postal: "89501", county: "Washoe" };
    d.ein = fullEin({
      reason: "other",
      reasonDetail: "Banking",
      employees: { agricultural: "0", other: "2" },
      wageDate: "2027-01-01",
      activity: { category: "real_estate", type: "use_capital_to_build_property", single_trade: "no", construction_type: "other_structures", construction_type_detail: "Bridges" },
      hasPreviousEin: true,
      previousEin: "12-3456789",
      tradeName: "Example",
      form944: true,
      involvesAtf: true,
      corporationSubtype: "s_corporation",
      memberCount: "3",
    });
    d.extra = { shares_authorized: 1000, blank: "", legal_name: "ignored" };
    const body = buildFormationRequest(d, "a") as any;
    expect(body.incorporators).toEqual([{ name: { type: "entity", entity_name: "Ledger Louise, LLC" }, address: body.principal_address, title: "Incorporator", email: "ops@example.com", entity_type: "limited_liability_company" }]);
    expect(body.organizers).toBeUndefined();
    expect(body.mailing_address).toEqual({ street_line_1: "PO Box 9", city: "Reno", region: "NV", postal_code: "89501", county: "Washoe", country: "US" });
    expect(body.stock_structure).toEqual({ total_authorized_shares: 1000000, has_par_value: true, par_value_per_share: 0.0001, total_consideration: 100 });
    expect(body.initial_directors).toEqual([{ name: { first: "Robert", middle: "A", last: "Burton", suffix: "Jr." }, title: "Chair", address: body.principal_address }]);
    expect(body.initial_officers.map((o: any) => [o.role, o.title])).toEqual([["president", "President"], ["other", "Chief investment officer"]]);
    expect(body.initial_governing_persons).toBeUndefined();
    expect(body.ein).toEqual({
      responsible_party: { first_name: "Robert", last_name: "Burton", ssn: "123456789" },
      reason: "other",
      reason_detail: "Banking",
      fiscal_year_end_month: 12,
      expected_employee_count: { agricultural: 0, other: 2 },
      wage_date: "2027-01-01",
      principal_activity: { category: "real_estate", type: "use_capital_to_build_property", construction: { single_trade: false, construction_type: "other_structures", construction_type_detail: "Bridges" } },
      principal_activity_detail: "Holds family investments",
      has_previous_ein: true,
      previous_ein: "12-3456789",
      trade_name: "Example",
      form_944_election: true,
      owns_highway_vehicle: false,
      involves_gambling: false,
      files_form_720: false,
      involves_alcohol_tobacco_firearms: true,
      corporation_subtype: "s_corporation",
    });
    expect(body.shares_authorized).toBe(1000);
    expect(body.blank).toBeUndefined();
    expect(body.legal_name).toBe("Example Holdings, LLC");
  });

  it("sends several classes of stock with their total", () => {
    const d = fullDraft();
    d.entityType = "corporation";
    d.stock = { ...d.stock, multiClass: true, classes: [{ ...emptyStockClass("Common"), authorized: "9000", issued: "1000", par: "0.001" }, { ...emptyStockClass("Preferred"), authorized: "1000", rights: "Liquidation preference" }] };
    expect((buildFormationRequest(d, "a") as any).stock_structure).toEqual({
      total_authorized_shares: 10000,
      classes: [
        { class_name: "Common", authorized_shares: 9000, issued_shares: 1000, par_value_per_share: 0.001 },
        { class_name: "Preferred", authorized_shares: 1000, rights_and_restrictions: "Liquidation preference" },
      ],
    });
  });

  it("asks each activity's own follow-ups, and only those that apply", () => {
    expect(principalActivity({ category: "construction", single_trade: "yes", trade: "Electrical", construction_type: "new_residential" })).toEqual({ category: "construction", detail: { single_trade: true, trade: "Electrical" } });
    expect(principalActivity({ category: "health_care", includes_md: "no", non_md_role: "dentist", md_role: "psychiatrist" })).toEqual({ category: "health_care", includes_md: false, non_md_role: "dentist" });
    expect(principalActivity({ category: "wholesale", owns_goods: "yes", receives_commission: "no", goods: "Soap" })).toEqual({ category: "wholesale", owns_goods: true, receives_commission: false, goods: "Soap" });
    expect(principalActivity({ category: "warehousing" })).toEqual({ category: "warehousing" });
    expect(activityQuestions({ category: "transportation", type: "cargo" }).map((q) => q.key)).toEqual(["type", "cargo_mode"]);
  });

  it("sends your own agent, and never keeps an SSN in the redacted draft", () => {
    const d = fullDraft();
    d.agent = { provider: "own", kind: "person", name: person("Ann", "Agent"), entityName: "", address: { street1: "9 Court St", street2: "", city: "Carson City", region: "NV", postal: "89701", county: "" }, mailing: null, email: "ann@example.com", phone: "" };
    d.owners = [{ ...emptyOwner("person", "100"), name: person("Jane", "Doe"), ssn: "111-22-3333" }];
    d.ein = fullEin();
    const body = buildFormationRequest(d, "a") as any;
    expect(body.registered_agent).toEqual({ type: "person", name: { type: "person", first: "Ann", last: "Agent" }, address: { street_line_1: "9 Court St", city: "Carson City", region: "NV", postal_code: "89701", country: "US" }, email: "ann@example.com" });
    expect(body.initial_governing_persons[0].ssn).toBe("111-22-3333");
    const safe = redactDraft(d);
    expect(JSON.stringify(safe)).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(d.ein.responsible.ssn).toBe("123-45-6789");
  });

  it("reads the state's rules for fields Palm already has", () => {
    const schema = {
      properties: {
        principal_address: { $ref: "#/$defs/Address" },
        organizers: { type: "array", items: { type: "object", required: ["name", "email"], properties: { email: { type: "string" }, title: { type: "string", enum: ["Organizer", "Member"] } } } },
      },
      $defs: { Address: { type: "object", required: ["county"], properties: { county: { type: "string" }, city: { type: "string" } } } },
    };
    const rules = stateRules(schema);
    expect(rules["principal_address.county"]).toEqual({ required: true, options: [], description: null });
    expect(rules["principal_address.city"].required).toBe(false);
    expect(rules["organizers.email"].required).toBe(true);
    expect(rules["organizers.title"].options).toEqual(["Organizer", "Member"]);
  });

  it("finds the state's extra fields in a requirement schema", () => {
    const schema = {
      required: ["jurisdiction", "legal_name", "management_type"],
      properties: {
        jurisdiction: { type: "string" },
        legal_name: { type: "string" },
        management_type: { type: "string", enum: ["member_managed", "manager_managed"], title: "Management" },
        member_count: { type: ["integer", "null"], description: "How many members" },
        professional: { type: "boolean" },
        officers: { type: "array" },
      },
    };
    expect(extraFields(schema)).toEqual([
      { key: "management_type", label: "Management", description: null, type: "enum", options: ["member_managed", "manager_managed"], required: true },
      { key: "member_count", label: "Member Count", description: "How many members", type: "number", options: [], required: false },
      { key: "professional", label: "Professional", description: null, type: "boolean", options: [], required: false },
    ]);
  });
});

describe("filing → entity record", () => {
  const FID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  it("summarizes a queued filing and then the completed one", () => {
    const first = summarizeFiling({ id: FID, status: "queued", type: "formation", entity_type: "llc", jurisdiction: "US-NV", business_id: "b1", created_at: "2026-10-18T10:00:00Z", related_items: [{ object: "filing", id: "ein1", type: "ein", status: "queued" }, { object: "registered_agent", id: "ra1", status: "pending" }], fee: { total: { amount: 425, currency: "USD" } } });
    expect(first.status).toBe("queued");
    expect(first.ein).toEqual({ filingId: "ein1", status: "queued", number: null });
    expect(first.registeredAgent).toEqual({ status: "pending" });
    expect(first.fee).toEqual({ total: 425, currency: "USD" });
    const patch = formationPatch(first, "test", "b1");
    expect(patch.status).toBe("Forming");
    expect(patch["palm/test/businessId"]).toBe("b1");

    const done = summarizeFiling({ id: FID, status: "completed", result: { registration_number: "E123", formation_date: "2026-10-20" } }, first);
    expect(done.submittedAt).toBe(first.submittedAt);
    expect(done.jurisdiction).toBe("US-NV");
    expect(done.fee).toEqual(first.fee);
    const donePatch = formationPatch(done, "live");
    expect(donePatch.status).toBe("Active");
    expect(donePatch.fileNumber).toBe("E123");
    expect(donePatch.formationDate).toBe("2026-10-20");
    expect(donePatch.registeredAgent).toBe("Palm");

    const ein = einPatch({ id: "ein1", status: "completed", result: { ein_number: "93-1234567" } }, "live", done);
    expect(ein.ein).toBe("93-1234567");
    expect((ein["palm/live/formation"] as any).ein.number).toBe("93-1234567");
  });

  it("marks a canceled filing", () => {
    const s = summarizeFiling({ id: FID, status: "canceled", status_reason: "Name rejected" });
    expect(formationPatch(s, "test").status).toBe("Formation canceled");
  });
});

describe("/api/palm formation actions", () => {
  const fetchMock = vi.fn();
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const FID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  function call(body: Record<string, unknown>) {
    const out: { status: number; json?: any } = { status: 0 };
    const res: any = {
      status(c: number) {
        out.status = c;
        return res;
      },
      json(j: unknown) {
        out.json = j;
        return res;
      },
      setHeader() {},
      send() {
        return res;
      },
      end() {
        return res;
      },
    };
    return Promise.resolve(handler({ method: "POST", body, headers: {} } as any, res)).then(() => out);
  }
  beforeEach(() => {
    state.role = "owner";
    process.env.PALM_API_KEY = "sk_test_x";
    fetchMock.mockReset();
    sbMock.mockReset();
    sbMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PALM_API_KEY;
  });

  it("reads the state's requirements, or says the state isn't supported", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { expedited_tiers: ["expedited"], schema: { properties: { legal_name: {}, management_type: { enum: ["member_managed"] } } } }));
    const r = await call({ action: "form-requirements", jurisdiction: "US-NV", entityType: "llc" });
    expect(r.json.supported).toBe(true);
    expect(r.json.extra.map((f: any) => f.key)).toEqual(["management_type"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.getpalm.com/v1/filing/formation/requirement?entity_type=llc&jurisdiction=US-NV");
    fetchMock.mockResolvedValueOnce(reply(404, { title: "Not Found" }));
    expect((await call({ action: "form-requirements", jurisdiction: "US-NV", entityType: "corporation" })).json.supported).toBe(false);
    expect((await call({ action: "form-requirements", jurisdiction: "NV", entityType: "llc" })).status).toBe(400);
  });

  it("checks a name with alternatives", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { eligible: false, compliant: true, available: false, violations: [{ severity: "error", message: "Taken.", fix: { message: "Try another." } }], alternatives: ["Example Holdings II, LLC"] }));
    const r = await call({ action: "form-name", jurisdiction: "US-NV", entityType: "llc", name: "Example Holdings, LLC" });
    expect(r.json).toEqual({ eligible: false, compliant: true, available: false, violations: [{ severity: "error", message: "Taken. Try another." }], alternatives: ["Example Holdings II, LLC"] });
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/business/registry/US-NV/name-eligibility?name=Example+Holdings%2C+LLC&entity_type=llc&suggest=true");
  });

  it("prices the filing", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { fee: { total: { amount: 425, currency: "USD" }, items: [{ component_type: "state_fee", name: "articles", amount: 425, currency: "USD" }] }, expedited_tiers: [{ tier: "expedited", fee: { amount: 125, currency: "USD" } }] }));
    const r = await call({ action: "form-fee", jurisdiction: "US-NV", entityType: "llc", expeditedTier: "expedited", extra: { member_count: 2, "bad key": 1 } });
    expect(r.json.total).toBe(425);
    expect(r.json.expeditedTiers).toEqual([{ tier: "expedited", amount: 125 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.getpalm.com/v1/filing/formation/fee?jurisdiction=US-NV&entity_type=llc&expedited_tier=expedited&member_count=2");
  });

  it("validates without filing and returns Palm's problems", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { title: "Validation Error", detail: "Invalid", errors: [{ field: "principal_address.postal_code", message: "Not a Nevada ZIP" }] }));
    const r = await call({ action: "form-validate", draft: fullDraft() });
    expect(r.json).toEqual({ ok: false, errors: [{ field: "principal_address.postal_code", message: "Not a Nevada ZIP" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.getpalm.com/v1/filing/formation/llc/validate");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).legal_name).toBe("Example Holdings, LLC");
    // Palm's usual answer: 200, with errors and warnings listed.
    fetchMock.mockResolvedValueOnce(reply(200, { valid: false, errors: [{ source: "rules", code: "X", path: "organizers.0.email", message: "Email required" }], warnings: [{ source: "payload", code: "UNKNOWN_FIELD", path: "website", message: "Not accepted" }] }));
    expect((await call({ action: "form-validate", draft: fullDraft() })).json).toEqual({ ok: false, errors: [{ field: "organizers.0.email", message: "Email required" }], warnings: [{ field: "website", message: "Not accepted" }] });
    fetchMock.mockResolvedValueOnce(reply(200, { valid: true, errors: [], warnings: [] }));
    expect((await call({ action: "form-validate", draft: fullDraft() })).json.ok).toBe(true);
  });

  it("only an owner files, in the mode the wizard saw, with an idempotency key, and writes the entity", async () => {
    const args = { action: "form-submit", draft: fullDraft(), assetId: "-Oabcdefghijklmnopqr", stateName: "Nevada", mode: "test", idempotencyKey: "11111111-2222-4333-8444-555555555555" };
    state.role = "member";
    expect((await call(args)).status).toBe(403);
    state.role = "owner";
    expect((await call({ ...args, mode: "live" })).json.error).toBe("mode_changed");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(reply(200, { id: FID, status: "queued", type: "formation", entity_type: "llc", jurisdiction: "US-NV", business_id: "b1", created_at: "2026-10-18T10:00:00Z" }))
      .mockResolvedValueOnce(reply(200, { id: "b1" }));
    const r = await call(args);
    expect(r.status).toBe(200);
    expect(r.json.formation.status).toBe("queued");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.getpalm.com/v1/filing/formation/llc");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBe(args.idempotencyKey);
    expect(JSON.parse(init.body).metadata.bfo_asset_id).toBe(args.assetId);
    // the business is stamped, and the entity row written through the tree
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.getpalm.com/v1/business/b1");
    const write = sbMock.mock.calls.find(([path]) => path === "rpc/tree_apply");
    expect(write).toBeTruthy();
    const op = write![1].body.ops[0];
    expect(op).toMatchObject({ op: "set", path: ["assets", args.assetId] });
    expect(op.value.name).toBe("Example Holdings, LLC");
    expect(op.value.type).toBe("LLC");
    expect(op.value.state).toBe("Nevada");
    expect(op.value.status).toBe("Forming");
    expect(op.value.address).toBe("1 Main St, Suite 2, Reno, NV 89501");
    expect(op.value.palm.test.businessId).toBe("b1");
    expect(op.value.palm.test.formation.filingId).toBe(FID);
    expect(JSON.stringify(op.value)).not.toContain("ssn");
    expect(op.value.members).toBeUndefined();
  });

  it("refuses to file over an existing entity", async () => {
    sbMock.mockResolvedValueOnce([{ collection: "assets", id: "-Oabcdefghijklmnopqr", data: { name: "x" } }]);
    const r = await call({ action: "form-submit", draft: fullDraft(), assetId: "-Oabcdefghijklmnopqr", stateName: "Nevada", mode: "test", idempotencyKey: "11111111-2222-4333-8444-555555555555" });
    expect(r.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a filing's status onto the record", async () => {
    const prev = summarizeFiling({ id: FID, status: "processing", entity_type: "llc", jurisdiction: "US-NV", created_at: "2026-10-18T10:00:00Z" });
    sbMock.mockImplementation(async (path: string) => (path.startsWith("tree_nodes?") ? [{ collection: "assets", id: "-Oabcdefghijklmnopqr", data: { palm: { test: { formation: prev } } } }] : []));
    fetchMock.mockResolvedValueOnce(reply(200, { id: FID, status: "completed", business_id: "b1", result: { registration_number: "E9", formation_date: "2026-10-20" } }));
    const r = await call({ action: "form-status", assetId: "-Oabcdefghijklmnopqr", filingId: FID, mode: "test" });
    expect(r.status).toBe(200);
    expect(r.json.formation.status).toBe("completed");
    expect(r.json.patch.status).toBe("Active");
    expect(r.json.patch.fileNumber).toBe("E9");
    const write = sbMock.mock.calls.find(([path]) => path === "rpc/tree_apply");
    expect(write![1].body.ops[0]).toMatchObject({ op: "update", path: ["assets", "-Oabcdefghijklmnopqr"] });
    // a filing the record doesn't know is refused
    expect((await call({ action: "form-status", assetId: "-Oabcdefghijklmnopqr", filingId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", mode: "test" })).status).toBe(404);
  });
});

describe("the family's office address", () => {
  it("reads an address line into the wizard's fields, suite and PMB included", () => {
    expect(parseAddress("11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028")).toEqual({
      street1: "11201 N Tatum Blvd Ste 300",
      street2: "PMB 44879",
      city: "Phoenix",
      region: "AZ",
      postal: "85028",
      county: "",
    });
    expect(parseAddress("540 Hudson #6, New York, ny 10014-1234")).toEqual({ street1: "540 Hudson #6", street2: "", city: "New York", region: "NY", postal: "10014-1234", county: "" });
    expect(parseAddress("Somewhere in Phoenix")).toBeNull();
    expect(parseAddress(undefined)).toBeNull();
  });

  it("picks the address most entities share", () => {
    const shared = "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028";
    const office = officeAddress([shared, "540 Hudson #6, New York, NY 10014", shared, "", undefined, shared.toUpperCase()]);
    expect(office?.street2).toBe("PMB 44879");
    expect(office?.city).toBe("Phoenix");
    expect(officeAddress(["nowhere", undefined])).toBeNull();
    expect(sameAddress(office!, { ...office!, city: " phoenix " })).toBe(true);
    expect(sameAddress(office!, { ...office!, postal: "85016" })).toBe(false);
  });
});
