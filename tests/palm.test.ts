import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isJurisdiction, palmMode, problemMessage, vaultAddress } from "../lib/palm";
import { normalizeName, palmJurisdiction, pickRegistryMatch, sortDocuments, stateFindings, toStateRecord } from "../app/palm";

describe("palm server helpers", () => {
  it("reads the mode from the key", () => {
    expect(palmMode("sk_test_abc")).toBe("test");
    expect(palmMode("sk_live_abc")).toBe("live");
    expect(palmMode("pk_abc")).toBeNull();
    expect(palmMode(undefined)).toBeNull();
  });

  it("splits an address into vault fields", () => {
    expect(vaultAddress("11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028")).toEqual({
      "business.address_line_1": "11201 N Tatum Blvd Ste 300",
      "business.address_line_2": "PMB 44879",
      "business.city": "Phoenix",
      "business.region": "AZ",
      "business.postal_code": "85028",
      "business.country": "US",
    });
    expect(vaultAddress("somewhere")).toEqual({});
  });

  it("explains Palm's problems in one line", () => {
    expect(problemMessage(400, { title: "Validation Error", detail: "formation_jurisdiction is required" })).toBe("formation_jurisdiction is required");
    expect(problemMessage(409, null)).toMatch(/already working/);
  });

  it("only accepts US-XX jurisdictions", () => {
    expect(isJurisdiction("US-NV")).toBe(true);
    expect(isJurisdiction("NV")).toBe(false);
    expect(isJurisdiction("US-NV/../x")).toBe(false);
  });
});

describe("palm browser helpers", () => {
  it("maps a state to Palm's jurisdiction", () => {
    expect(palmJurisdiction("Nevada")).toBe("US-NV");
    expect(palmJurisdiction("AZ")).toBe("US-AZ");
    expect(palmJurisdiction("")).toBeNull();
  });

  it("matches registry names the way states write them", () => {
    expect(normalizeName("Breezewood Ranch, L.L.C.")).toBe(normalizeName("BREEZEWOOD RANCH LLC"));
    const results = [
      { name: "LEDGER LOUISE, LLC", registration_jurisdiction: "US-NV", registration_number: "E1" },
      { name: "Ledger Louise LLC", registration_jurisdiction: "US-AZ", registration_number: "A1" },
      { name: "Ledger Louise Holdings LLC", registration_jurisdiction: "US-NV", registration_number: "E2" },
    ];
    expect(pickRegistryMatch(results, "Ledger Louise, LLC", "US-NV")?.registration_number).toBe("E1");
    expect(pickRegistryMatch(results, "Ledger Louise, LLC", null)).toBeNull();
  });

  it("reads what the state's record says against ours", () => {
    const rec = toStateRecord(
      {
        name: "LEDGER LOUISE, LLC",
        status: "inactive",
        formation_date: "2023-08-11",
        registration_number: "E34087392023-1",
        standing: { registration: "not_compliant", agent: "compliant" },
        associates: [
          { role: "agent", name: "NORTHWEST REGISTERED AGENT, LLC", address: { street_line_1: "401 Ryland St", city: "Reno", region: "NV", postal_code: "89502" } },
          { role: "manager", name: "ROBERT W BURTON" },
        ],
      },
      "live",
      0,
    );
    expect(rec.agent).toBe("NORTHWEST REGISTERED AGENT, LLC");
    expect(rec.agentAddress).toBe("401 Ryland St, Reno, NV 89502");
    expect(rec.managers).toEqual(["ROBERT W BURTON"]);
    const f = stateFindings(rec, { name: "Ledger Louise, LLC", registeredAgent: "Northwest Registered Agent, LLC.", formationDate: "2023-08-11" });
    expect(f.map((x) => x.tone)).toEqual(["bad", "bad"]);
    expect(stateFindings(rec, { registeredAgent: "Someone Else" }).some((x) => /Someone Else/.test(x.text))).toBe(true);
  });

  it("puts legal papers first", () => {
    const docs = sortDocuments([
      { id: "1", type: "mail", created_at: "2026-10-01" },
      { id: "2", type: "service_of_process", created_at: "2026-09-01" },
      { id: "3", type: "notice", created_at: "2026-10-02" },
    ]);
    expect(docs.map((d) => d.id)).toEqual(["2", "3", "1"]);
  });
});

// ── The endpoint ────────────────────────────────────────────────────────
let role = "owner";
vi.mock("../lib/auth.js", () => ({
  currentUser: vi.fn(async () => (role ? { id: "u1", role } : null)),
  canWrite: (u: { role: string }) => u.role !== "viewer",
  isAdmin: (u: { role: string }) => u.role === "owner" || u.role === "admin",
}));

import handler from "../api/palm";

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

const BID = "6f1c2c1e-1111-4222-8333-944445555666";

describe("/api/palm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    role = "owner";
    process.env.PALM_API_KEY = "sk_test_x";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PALM_API_KEY;
  });
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

  it("says when Palm isn't connected", async () => {
    delete process.env.PALM_API_KEY;
    expect((await call({ action: "status" })).json).toEqual({ configured: false, mode: null });
    expect((await call({ action: "ra", businessId: BID })).status).toBe(503);
  });

  it("reports no Palm service as null, not an error", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { title: "Not Found" }));
    const r = await call({ action: "ra", businessId: BID });
    expect(r.status).toBe(200);
    expect(r.json.service).toBeNull();
  });

  it("only lets an owner or admin move the agent", async () => {
    role = "member";
    expect((await call({ action: "ra-change", businessId: BID })).status).toBe(403);
    role = "owner";
    fetchMock.mockResolvedValueOnce(reply(200, { object: "registered_agent", status: "pending", provider: "palm" }));
    const r = await call({ action: "ra-change", businessId: BID, assetId: "a1" });
    expect(r.json.service.status).toBe("pending");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.getpalm.com/v1/business/${BID}/registered-agent`);
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(init.body);
    expect(sent.status).toBe("change_requested");
    expect(sent.registered_agent).toBeUndefined();
  });

  it("reuses the entity's Palm business instead of adding it twice", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: [{ id: BID, palm_id: "p1", display_name: "X", metadata: { bfo_asset_id: "a1" } }] }));
    const r = await call({ action: "link", assetId: "a1", entity: { name: "Ledger Louise, LLC", jurisdiction: "US-NV" } });
    expect(r.json).toMatchObject({ businessId: BID, created: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adds the business with its formation state", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { data: [] })).mockResolvedValueOnce(reply(201, { id: BID, palm_id: null }));
    const r = await call({
      action: "link",
      assetId: "a1",
      entity: { name: "Ledger Louise, LLC", type: "LLC", jurisdiction: "US-NV", formationDate: "2023-08-11", fileNumber: "E34087392023-1", address: "11201 N Tatum Blvd Ste 300, Phoenix, AZ 85028" },
    });
    expect(r.json).toMatchObject({ businessId: BID, created: true });
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.vault).toMatchObject({
      "business.formation_jurisdiction": "US-NV",
      "business.entity_type": "llc",
      "business.registration_number": "E34087392023-1",
      "business.city": "Phoenix",
    });
    expect(sent.vault["business.ein"]).toBeUndefined();
  });

  it("rejects malformed ids before calling Palm", async () => {
    expect((await call({ action: "ra", businessId: "../../v1/x" })).status).toBe(400);
    expect((await call({ action: "registry-detail", jurisdiction: "NV", number: "E1" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never passes Palm's 401 through as our own", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { title: "Unauthorized" }));
    const r = await call({ action: "registry-search", name: "X" });
    expect(r.status).toBe(502);
    expect(r.json.palmStatus).toBe(401);
  });
});
