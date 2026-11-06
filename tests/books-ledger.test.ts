import { describe, expect, it } from "vitest";
import { activeLocks, closedThrough, containsWords, firstRule, isHandEdit, isLocked, logRowsFor, orderRules, overlaps, previewOf, ruleMatches, signWarning, undoOf } from "../lib/books/ledger";
import { descriptionSimilarity, nearDuplicates } from "../lib/books-csv";
import { categorize } from "../lib/books-rules";
import { namesBorrower } from "../lib/books-loans";
import { streamOf } from "../lib/books/review";

const row = (name: string | null, merchant: string | null, extra: Record<string, unknown> = {}) => ({ name, merchant_name: merchant, date: "2026-03-01", entity_id: "e1", ...extra });

describe("taught rules", () => {
  it("contains: words in the payee, on word boundaries", () => {
    expect(containsWords("Canada Revenu Agency", "revenu")).toBe(true);
    expect(containsWords("Internal Revenue Service", "revenu")).toBe(false);
    expect(containsWords("GC<>REVENU 123", "gc<>revenu")).toBe(true);
    expect(containsWords("Pilotage Inc", "pilot")).toBe(false);
  });

  it("reads only the payee of a Mercury row, so the paying entity never matches", () => {
    const payroll = row("From Example Holdings, LLC via mercury.com; Merchant name: Jordan Doe", "Jordan Doe");
    expect(ruleMatches({ match: "Example Holdings, LLC" }, payroll)).toBe(false);
    expect(ruleMatches({ match: "Jordan Doe", match_kind: "vendor" }, payroll)).toBe(true);
  });

  it("vendor rules need the payee exactly", () => {
    expect(ruleMatches({ match: "Revenu", match_kind: "vendor" }, row("REVENU PAYMENT", "Revenu"))).toBe(true);
    expect(ruleMatches({ match: "Revenu", match_kind: "vendor" }, row("IRS", "Internal Revenue Service"))).toBe(false);
  });

  it("honours an entity scope and a start date", () => {
    expect(ruleMatches({ match: "acme", scope_entity_id: "e2" }, row("ACME", null))).toBe(false);
    expect(ruleMatches({ match: "acme", effective_from: "2026-04-01" }, row("ACME", null))).toBe(false);
    expect(ruleMatches({ match: "acme", effective_from: "2026-01-01" }, row("ACME", null))).toBe(true);
  });

  it("tries an exact payee first, then the more specific text, then the older rule", () => {
    const rules = [
      { id: "a", match: "online transfer", created_at: "2025-01-01" },
      { id: "b", match: "online transfer to savings", created_at: "2026-01-01" },
      { id: "c", match: "Acme", match_kind: "vendor", created_at: "2026-02-01" },
      { id: "d", match: "zeta", created_at: "2024-01-01" },
      { id: "e", match: "alfa", created_at: "2023-01-01" },
    ];
    expect(orderRules(rules).map((r) => r.id)).toEqual(["c", "b", "a", "e", "d"]);
    const ordered = orderRules(rules.map((r) => ({ ...r, book_category: r.id })));
    expect(firstRule(ordered, row("ONLINE TRANSFER TO SAVINGS 1234", null), "book_category")?.id).toBe("b");
  });

  it("lists overlapping rules for each rule", () => {
    const rules = [
      { id: "a", match: "online transfer" },
      { id: "b", match: "online transfer to savings" },
      { id: "c", match: "acme" },
    ];
    const o = overlaps(rules, [row("ONLINE TRANSFER TO SAVINGS", null), row("ACME", null)]);
    expect(o.get("a")).toEqual(["b"]);
    expect(o.get("c")).toBeUndefined();
  });
});

describe("the period lock", () => {
  const locks = activeLocks([
    { entity_id: "e1", closed_through: "2025-12-31", reopened_at: null },
    { entity_id: "e1", closed_through: "2026-03-31", reopened_at: "2026-04-10" },
    { entity_id: null, closed_through: "2024-12-31", reopened_at: null },
  ]);
  it("keeps the latest open close per entity, and the office-wide one", () => {
    expect(closedThrough(locks, "e1")).toBe("2025-12-31");
    expect(closedThrough(locks, "e2")).toBe("2024-12-31");
    expect(closedThrough([], "e1")).toBeNull();
  });
  it("locks rows on or before the date", () => {
    expect(isLocked({ date: "2025-12-31", entity_id: "e1" }, locks)).toBe(true);
    expect(isLocked({ date: "2026-01-01", entity_id: "e1" }, locks)).toBe(false);
    expect(isLocked({ date: "2025-06-01", entity_id: "e2" }, locks)).toBe(false);
  });
});

describe("previews, history and undo", () => {
  const rows = [
    { transaction_id: "t1", date: "2025-11-02", amount: 100, entity_name: "B" },
    { transaction_id: "t2", date: "2026-02-01", amount: -40, entity_name: "A" },
    { transaction_id: "t3", date: "2026-03-01", amount: 10, entity_name: "A" },
  ];
  it("counts, spans and nets what will change, leaving closed rows out", () => {
    const p = previewOf(rows, { locked: new Set(["t3"]), edited: new Set(["t2"]), year: 2026 });
    expect(p).toMatchObject({ count: 2, net: -60, money_in: 40, money_out: 100, first: "2025-11-02", last: "2026-02-01", entities: ["A", "B"], edited: 1, locked: 1, prior_years: 1 });
    expect(previewOf(rows, { edited: new Set(["t2"]), skipEdited: true }).count).toBe(2);
  });

  it("writes one row per changed field with the old value and the person", () => {
    const before = new Map([["t1", { book_category: "6900 Other", merchant_name: "Acme" }]]);
    const out = logRowsFor(["t1"], before, { book_category: "6100 Fees", merchant_name: "Acme" }, "rule:r1", { id: "u1", name: "Pat" });
    expect(out).toEqual([{ transaction_id: "t1", field: "book_category", old_value: "6900 Other", new_value: "6100 Fees", source: "rule:r1", actor: "u1", actor_name: "Pat" }]);
  });

  it("undo puts back each row's own values", () => {
    const before = new Map([
      ["t1", { book_category: "A", type_override: "transfer" }],
      ["t2", { book_category: "B", type_override: null }],
    ]);
    expect(undoOf(["t1", "t2"], before, { book_category: "C", type_override: null, name: "x" })).toEqual([
      { transaction_id: "t1", values: { book_category: "A", type_override: "transfer" } },
      { transaction_id: "t2", values: { book_category: "B" } },
    ]);
  });

  it("only a person's change to a decided field guards a row from the sync", () => {
    expect(isHandEdit({ field: "book_category", source: "edit" })).toBe(true);
    expect(isHandEdit({ field: "book_category", source: "sync" })).toBe(false);
    expect(isHandEdit({ field: "receipt", source: "receipt" })).toBe(false);
  });

  it("warns when the sign contradicts the account", () => {
    expect(signWarning("4000 Rental Income", false)).toMatch(/income account/);
    expect(signWarning("6100 Fees", true)).toMatch(/expense account/);
    expect(signWarning("6100 Fees", false)).toBeNull();
  });
});

describe("built-in rules", () => {
  it("leaves a bare check for a person", () => {
    expect(categorize("CHECK", null, "GENERAL_SERVICES")).toEqual({ category: null, type: null });
    expect(categorize("Check 1042", null, null).category).toBeNull();
  });
  it("never files a payment to an outside person as an internal transfer", () => {
    expect(categorize("Send Money via mercury.com; Merchant name: Jordan Doe", "Jordan Doe", "TRANSFER_OUT").category).toBeNull();
    expect(categorize("ONLINE TRANSFER", null, "TRANSFER_OUT").category).toBe("9100 Internal Transfers");
  });
});

describe("CSV near duplicates", () => {
  it("matches a stored row a day or two off with a similar description", () => {
    const rows = [
      { date: "2026-01-05", amount: 25, description: "ACME HARDWARE 123" },
      { date: "2026-01-05", amount: 40, description: "OTHER" },
    ];
    const stored = [{ date: "2026-01-06", amount: "25.00", name: "Acme Hardware #9", transaction_id: "x" }];
    expect(nearDuplicates(rows, stored)).toEqual([{ index: 0, existing: { date: "2026-01-06", name: "Acme Hardware #9", transaction_id: "x" } }]);
    expect(descriptionSimilarity("Toll road", "Parking lot")).toBe(0);
  });
});

describe("loans and regular payments", () => {
  it("finds rows that name a loan's borrower", () => {
    expect(namesBorrower({ name: "Northwind Lending, LTD", counterparty: null }, { name: "NORTHWIND PAYMENT", merchant_name: null })).toBe(true);
    expect(namesBorrower({ name: "Northwind Lending, LTD", counterparty: null }, { name: "OTHER", merchant_name: "Acme" })).toBe(false);
  });

  it("projects a stream from the typical payment and marks one that stopped", () => {
    const monthly = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03"].map((date, i) => ({ date, amount: i === 1 ? -5 : 100 }));
    const s = streamOf(monthly, "2026-08-20")!;
    expect(s).toMatchObject({ cadence: "monthly", typical_amount: 100, direction: "out", stale: false });
    expect(streamOf(monthly, "2026-11-01")!.stale).toBe(true);
    expect(streamOf(monthly.slice(0, 2), "2026-08-20")).toBeNull();
  });
});
