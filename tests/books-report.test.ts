import { describe, expect, it } from "vitest";
import { effType, eliminated, flowMonths, flowSummary, label, prettyCategory, type ReportTxn } from "../lib/books-report";

const txn = (over: Partial<ReportTxn>): ReportTxn => ({
  transaction_id: "t",
  account_id: "acct-a",
  date: "2026-10-20",
  amount: 100,
  plaid_category: null,
  book_category: "6100 Legal & professional",
  txn_type: "normal",
  intercompany: false,
  type_override: null,
  loan_id: null,
  ...over,
});

describe("effType", () => {
  it("a loan attachment wins over everything", () => {
    expect(effType(txn({ loan_id: "L", type_override: "normal", intercompany: true }))).toBe("loan");
  });
  it("the person's override beats the sync's reading", () => {
    expect(effType(txn({ type_override: "transfer", intercompany: true }))).toBe("transfer");
    expect(effType(txn({ type_override: "normal", intercompany: true, txn_type: "transfer" }))).toBe("normal");
  });
  it("otherwise intercompany, then the sync's transfer flag", () => {
    expect(effType(txn({ intercompany: true }))).toBe("intercompany");
    expect(effType(txn({ txn_type: "transfer" }))).toBe("transfer");
    expect(effType(txn({}))).toBe("normal");
  });
  it("an unknown override is ignored", () => {
    expect(effType(txn({ type_override: "weird" }))).toBe("normal");
  });
});

describe("eliminated", () => {
  const entityOf = (id: string) => ({ "acct-a": "E1", "acct-b": "E2" } as Record<string, string>)[id];
  it("all entities: every intercompany row vanishes", () => {
    expect(eliminated(txn({ counterparty_account_id: null }), null, entityOf)).toBe(true);
  });
  it("partial selection: only when the other leg's entity is selected too", () => {
    expect(eliminated(txn({ counterparty_account_id: "acct-b" }), ["E1", "E2"], entityOf)).toBe(true);
    expect(eliminated(txn({ counterparty_account_id: "acct-b" }), ["E1"], entityOf)).toBe(false);
  });
  it("an unpaired row stays visible under a partial selection", () => {
    expect(eliminated(txn({ counterparty_account_id: null }), ["E1"], entityOf)).toBe(false);
    expect(eliminated(txn({ counterparty_account_id: "acct-unknown" }), ["E1"], entityOf)).toBe(false);
  });
});

describe("label and prettyCategory", () => {
  it("prefers the books account, else Plaid's label tidied", () => {
    expect(label(txn({ book_category: null, plaid_category: "FOOD_AND_DRINK" }))).toBe("Food and drink");
    expect(label(txn({ book_category: null, plaid_category: null }))).toBe("Uncategorized");
    expect(prettyCategory("GENERAL_SERVICES")).toBe("General services");
  });
});

describe("flowSummary", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("names six calendar months ending now", () => {
    expect(flowMonths(now)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });
  it("splits the last 30 days from the 30 before, money in negative", () => {
    const rows = [
      txn({ transaction_id: "1", date: "2026-10-20", amount: -1000, book_category: "4100 Rent income", merchant_name: "Tenant" }),
      txn({ transaction_id: "2", date: "2026-10-15", amount: 250, merchant_name: "Keyt Law" }),
      txn({ transaction_id: "3", date: "2026-09-10", amount: -400, book_category: "4100 Rent income" }),
      txn({ transaction_id: "4", date: "2026-09-05", amount: 100 }),
    ];
    const f = flowSummary(rows, now, () => "Ledger Louise, LLC");
    expect(f.current).toEqual({ in: 1000, out: 250, net: 750 });
    expect(f.prior).toEqual({ in: 400, out: 100, net: 300 });
    expect(f.recentIn[0]).toMatchObject({ id: "1", who: "Tenant", amount: 1000, entity: "Ledger Louise, LLC", account: "Rent income" });
    expect(f.recentOut[0]).toMatchObject({ id: "2", who: "Keyt Law", amount: 250, account: "Legal & professional" });
    expect(f.countIn).toBe(1);
    expect(f.topIn).toEqual([{ name: "4100 Rent income", amount: 1000 }]);
    expect(f.months.find((m) => m.month === "2026-09")).toEqual({ month: "2026-09", in: 400, out: 100 });
  });
  it("leaves out transfers, intercompany, loans and flow accounts", () => {
    const rows = [
      txn({ transaction_id: "1", date: "2026-10-20", amount: 500, txn_type: "transfer" }),
      txn({ transaction_id: "2", date: "2026-10-20", amount: 500, intercompany: true }),
      txn({ transaction_id: "3", date: "2026-10-20", amount: 500, loan_id: "L" }),
      txn({ transaction_id: "4", date: "2026-10-20", amount: 500 }),
    ];
    const f = flowSummary(rows, now, () => null);
    expect(f.current.out).toBe(500);
    expect(f.countOut).toBe(1);
  });
  it("lists the newest first and caps the list but not the count", () => {
    const rows = Array.from({ length: 5 }, (_, i) => txn({ transaction_id: String(i), date: `2026-10-${10 + i}`, amount: 10 + i }));
    const f = flowSummary(rows, now, () => null, 3);
    expect(f.recentOut.map((r) => r.id)).toEqual(["4", "3", "2"]);
    expect(f.countOut).toBe(5);
  });
});
