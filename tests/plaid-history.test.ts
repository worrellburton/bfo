import { describe, expect, it } from "vitest";
import { bookSpans, headline, incomeAmount, incomeKind, keepPlan, priorClose, revocationOutcome, totalSpan } from "../lib/plaid-history";
import { pickAdoption, type SavedMapping } from "../lib/plaid-lineage";

const plaidError = (code: string) => Object.assign(new Error(code), { response: { data: { error_code: code } } });

describe("revocationOutcome", () => {
  it("lets a disconnect go ahead only when Plaid revoked or the link is gone", () => {
    expect(revocationOutcome(null)).toBe("revoked");
    expect(revocationOutcome(plaidError("ITEM_NOT_FOUND"))).toBe("already_gone");
    expect(revocationOutcome(plaidError("INVALID_ACCESS_TOKEN"))).toBe("already_gone");
    expect(revocationOutcome(plaidError("INTERNAL_SERVER_ERROR"))).toBe("failed");
    expect(revocationOutcome(new Error("network"))).toBe("failed");
  });
});

describe("bookSpans", () => {
  it("counts each account's rows and their date range", () => {
    const spans = bookSpans([
      { account_id: "a", date: "2026-03-01" },
      { account_id: "a", date: "2025-01-02" },
      { account_id: "b", date: "2026-11-01" },
    ]);
    expect(spans.get("a")).toEqual({ count: 2, from: "2025-01-02", to: "2026-03-01" });
    expect(totalSpan(spans.values())).toEqual({ count: 3, from: "2025-01-02", to: "2026-11-01" });
  });
});

describe("keepPlan", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("keeps every account on a disconnect, with its last balance and history end", () => {
    const { keep, archive } = keepPlan({
      accountIds: ["a", "b"],
      reason: "disconnected",
      states: new Map([["a", { balance: 10, seen_at: "2026-11-05T00:00:00Z" }]]),
      prefs: new Map(),
      spans: new Map([["a", { count: 4, from: "2025-01-01", to: "2026-10-01" }]]),
      now,
      keepEmpty: true,
    });
    expect(archive).toEqual([]);
    expect(keep.map((k) => k.account_id)).toEqual(["a", "b"]);
    expect(keep[0]).toMatchObject({ last_balance: 10, books_through: "2026-10-01", disconnected_reason: "disconnected", archived_at: null });
  });

  it("archives only accounts with nothing to keep when a bank stops sharing them", () => {
    const { keep, archive } = keepPlan({
      accountIds: ["mapped", "history", "empty"],
      reason: "not_shared",
      states: new Map(),
      prefs: new Map([["mapped", { entity_id: "e1" }]]),
      spans: new Map([["history", { count: 1, from: "2026-01-01", to: "2026-01-01" }]]),
      now,
      keepEmpty: false,
    });
    expect(keep.map((k) => k.account_id).sort()).toEqual(["history", "mapped"]);
    expect(archive).toEqual(["empty"]);
  });

  it("keeps the first stop date on a retry", () => {
    const { keep } = keepPlan({
      accountIds: ["a"],
      reason: "not_shared",
      states: new Map(),
      prefs: new Map([["a", { entity_id: "e", disconnected_at: "2026-10-01T00:00:00Z" }]]),
      spans: new Map(),
      now,
      keepEmpty: false,
    });
    expect(keep[0].disconnected_at).toBe("2026-10-01T00:00:00Z");
  });
});

describe("priorClose", () => {
  it("takes each account's latest balance before today", () => {
    const closes = priorClose(
      [
        { account_id: "a", day: "2026-11-04", balance: 100 },
        { account_id: "a", day: "2026-11-05", balance: "120.50" },
        { account_id: "a", day: "2026-11-06", balance: 999 },
        { account_id: "b", day: "2026-11-01", balance: null },
      ],
      "2026-11-06",
    );
    expect(closes.get("a")).toEqual({ day: "2026-11-05", balance: 120.5 });
    expect(closes.has("b")).toBe(false);
  });
});

describe("headline", () => {
  it("nets what is owed and counts hidden accounts apart", () => {
    const h = headline([
      { type: "depository", balance_current: 10_069.24 },
      { type: "credit", balance_current: 500 },
      { type: "investment", balance_current: 1_000 },
      { type: "other", balance_current: 50 },
      { type: "depository", balance_current: 75, hidden: true },
    ]);
    expect(h).toMatchObject({ cash: 10_069.24, invested: 1_000, owed: 500, other: 50, accounts: 4, hidden: { count: 1, net: 75 } });
    expect(h.net).toBeCloseTo(10_619.24, 2);
  });
});

describe("incomeKind", () => {
  it("matches exact subtypes and leaves flows out", () => {
    expect(incomeKind("cash", "qualified dividend")).toBe("dividend");
    expect(incomeKind("cash", "interest")).toBe("interest");
    expect(incomeKind("cash", "long-term capital gain")).toBe("capital_gain");
    expect(incomeKind("cash", "distribution")).toBeNull();
    expect(incomeKind("cash", "contribution")).toBeNull();
    expect(incomeKind("buy", "dividend reinvestment")).toBeNull();
    expect(incomeKind("cash", "dividend reinvestment")).toBeNull();
  });
  it("keeps the sign: cash credited is income, a reversal reduces it", () => {
    expect(incomeAmount(-42.1)).toBe(42.1);
    expect(incomeAmount(10)).toBe(-10);
  });
});

describe("pickAdoption", () => {
  const base: SavedMapping = { account_id: "old", institution_name: "Northwind Bank", mask: "4821", subtype: "checking", nickname: null, hidden: false, entity_id: null, entity_name: null };
  const live = { account_id: "new", institution_name: "Northwind Bank", mask: "4821", subtype: "checking" };
  it("continues an account that kept its Books history, even unmapped", () => {
    expect(pickAdoption(live, [{ ...base, books_through: "2026-10-01" }], new Set(["new"]))?.account_id).toBe("old");
  });
  it("leaves an ambiguous identity alone", () => {
    expect(
      pickAdoption(
        live,
        [
          { ...base, entity_id: "e1" },
          { ...base, account_id: "old2", entity_id: "e2" },
        ],
        new Set(["new"]),
      ),
    ).toBeNull();
  });
  it("doesn't take over a mapping another account already continues", () => {
    expect(pickAdoption(live, [{ ...base, entity_id: "e1", successor_account_id: "other" }], new Set(["new"]))).toBeNull();
  });
  it("doesn't touch an account mapped in its own right", () => {
    expect(
      pickAdoption(
        live,
        [
          { ...base, entity_id: "e1" },
          { ...base, account_id: "new", entity_id: "e2" },
        ],
        new Set(["new"]),
      ),
    ).toBeNull();
  });
});
