import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftProblems, emptyDraft, officeAddress, parseAddress, sameAddress, type FormationDraft } from "../app/formation";
import { buildFormationRequest, einPatch, extraFields, formationPatch, redactDraft, summarizeFiling } from "../lib/palm-formation";

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
  d.principal = { street1: "1 Main St", street2: "Suite 2", city: "Reno", region: "NV", postal: "89501" };
  d.organizers = [{ first: "Robert", last: "Burton", address: null, title: "Organizer" }];
  d.governors = [{ first: "Robert", last: "Burton", role: "manager", title: "" }];
  return d;
}

describe("formation draft", () => {
  it("lists what's missing by step", () => {
    const problems = draftProblems(emptyDraft());
    expect(problems.map((p) => p.step)).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(problems.some((p) => p.step === 3)).toBe(false);
    expect(draftProblems(fullDraft())).toEqual([]);
  });

  it("asks for the agent and the EIN party when chosen", () => {
    const d = fullDraft();
    d.agent = { provider: "own", kind: "organization", name: "", address: { street1: "", street2: "", city: "", region: "AZ", postal: "" }, email: "", phone: "" };
    d.ein = { first: "", last: "", ssn: "123-45", fiscalYearEndMonth: 12, activity: "", activityDetail: "" };
    const texts = draftProblems(d).map((p) => p.text);
    expect(texts).toContain("Name the registered agent.");
    expect(texts).toContain("The registered agent must be in the state of formation.");
    expect(texts).toContain("The responsible party's SSN is needed for the EIN application.");
    expect(texts).toContain("Choose the entity's principal activity for the EIN.");
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
    expect(body.initial_governing_persons[0].role).toBe("manager");
    expect(body.registered_agent).toBeUndefined(); // Palm serves
    expect(body.ein).toBeUndefined();
    expect(body.metadata).toEqual({ bfo_asset_id: "asset1" });
  });

  it("sends the EIN application with the SSN unformatted and keeps nothing secret in the redacted draft", () => {
    const d = fullDraft();
    d.entityType = "corporation";
    d.ein = { first: "Robert", last: "Burton", ssn: "123-45-6789", fiscalYearEndMonth: 12, activity: "real_estate", activityDetail: "Holds property" };
    d.extra = { shares_authorized: 1000, blank: "", legal_name: "ignored" };
    const body = buildFormationRequest(d, "a") as any;
    expect(body.incorporators).toHaveLength(1);
    expect(body.organizers).toBeUndefined();
    expect(body.ein.responsible_party).toEqual({ first_name: "Robert", last_name: "Burton", ssn: "123456789" });
    expect(body.ein.llc_member_count).toBeUndefined();
    expect(body.shares_authorized).toBe(1000);
    expect(body.blank).toBeUndefined();
    expect(body.legal_name).toBe("Example Holdings, LLC");
    expect(redactDraft(d).ein?.ssn).toBe("");
    expect(d.ein.ssn).toBe("123-45-6789");
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
    });
    expect(parseAddress("540 Hudson #6, New York, ny 10014-1234")).toEqual({ street1: "540 Hudson #6", street2: "", city: "New York", region: "NY", postal: "10014-1234" });
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
