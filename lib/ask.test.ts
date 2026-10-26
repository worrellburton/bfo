import { describe, expect, it } from "vitest";
import { clampInt, entitySummary, looseName, matchEntity, summarize, systemPrompt, titleFrom, toolLabel, toolsFor, transcript, txnKind, type Scope } from "./ask";

const staff: Scope = { user: { id: "u1", name: "Robert Burton", role: "owner", email: null, mail_address: null }, admin: true, staff: true, assetIds: null };
const partner: Scope = { user: { id: "u2", name: "Sam", role: "partner", email: null, mail_address: null }, admin: false, staff: false, assetIds: new Set(["a1"]) };

describe("tools by role", () => {
  it("gives staff the finances and admins the office's texts and people", () => {
    const names = toolsFor(staff).map((t) => t.name);
    expect(names).toContain("treasury");
    expect(names).toContain("books_summary");
    expect(names).toContain("people");
  });
  it("keeps a partner to entities and their own mail", () => {
    const names = toolsFor(partner).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_entities", "get_entity", "search_mail"]));
    expect(names).not.toContain("treasury");
    expect(names).not.toContain("people");
    expect(systemPrompt(partner)).toMatch(/invited owner/);
  });
});

describe("names", () => {
  const list = [
    { id: "a1", a: { name: "Ledger Louise, LLC" } },
    { id: "a2", a: { name: "Sundown Investments LLC" } },
  ];
  it("matches loosely", () => {
    expect(looseName("Ledger Louise, LLC")).toBe("ledger louise");
    expect(matchEntity(list, { name: "ledger louise llc" })?.id).toBe("a1");
    expect(matchEntity(list, { name: "Sundown" })?.id).toBe("a2");
    expect(matchEntity(list, { id: "a2" })?.id).toBe("a2");
    expect(matchEntity(list, { name: "Nothing" })).toBeNull();
  });
  it("titles a conversation from its first line", () => {
    expect(titleFrom("What's due soon?")).toBe("What's due soon?");
    expect(titleFrom("Which of our Arizona entities still have the old principal office address on file with the state?")).toMatch(/…$/);
    expect(titleFrom("")).toBe("New chat");
  });
  it("labels what's being looked up", () => {
    expect(toolLabel("get_entity", { name: "Ledger Louise" })).toBe("Looking up Ledger Louise");
    expect(toolLabel("search_mail", {})).toBe("Reading the latest mail");
  });
});

describe("entity summary", () => {
  it("reads the status from closing, forming and the record", () => {
    expect(entitySummary("a", { name: "X", type: "LLC", closing: { startedAt: "2026-01-01" } }, null).status).toBe("closing");
    expect(entitySummary("a", { name: "X", type: "LLC", palm: { live: { formation: { status: "pending" } } } }, null).status).toBe("forming");
    expect(entitySummary("a", { name: "X", type: "LLC", stateRecord: { status: "active", standing: { registration: "compliant" }, checkedAt: 1 } }, "Trust").goodStanding).toBe("compliant");
  });
});

describe("books", () => {
  it("keeps the person's type, else the rules'", () => {
    expect(txnKind({ type_override: "transfer", txn_type: "normal", intercompany: false })).toBe("transfer");
    expect(txnKind({ type_override: null, txn_type: "normal", intercompany: true })).toBe("intercompany");
    expect(txnKind({ type_override: null, txn_type: "transfer", intercompany: false })).toBe("transfer");
    expect(txnKind({ type_override: null, txn_type: null, intercompany: null })).toBe("normal");
  });
  it("adds up money in and out, transfers set aside", () => {
    const s = summarize([
      { amount: 100, book_category: "6100 Legal", entity_name: "A", type_override: null, txn_type: "normal", intercompany: false },
      { amount: "250.5", book_category: "6100 Legal", entity_name: "B", type_override: null, txn_type: "normal", intercompany: false },
      { amount: -1000, book_category: "4000 Rent", entity_name: "A", type_override: null, txn_type: "normal", intercompany: false },
      { amount: 5000, book_category: null, entity_name: "A", type_override: null, txn_type: "transfer", intercompany: false },
    ]);
    expect(s.moneyOut).toBe(350.5);
    expect(s.moneyIn).toBe(1000);
    expect(s.transfersSetAside).toBe(5000);
    expect(s.byCategory[0]).toEqual({ name: "4000 Rent", out: 0, in: 1000, count: 1 });
    expect(s.byEntity.find((e) => e.name === "A")?.out).toBe(100);
  });
  it("clamps counts", () => {
    expect(clampInt("500", 1, 100, 10)).toBe(100);
    expect(clampInt(undefined, 1, 100, 10)).toBe(10);
  });
});

describe("transcript", () => {
  it("alternates turns, starting with the person, and caps from the oldest end", () => {
    const rows = [
      { role: "assistant" as const, content: { text: "stray" } },
      { role: "user" as const, content: { text: "one" } },
      { role: "user" as const, content: { text: "two" } },
      { role: "assistant" as const, content: { text: "answer" } },
    ];
    const t = transcript(rows);
    expect(t.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t[0].content).toBe("one\n\ntwo");
    const capped = transcript([{ role: "user", content: { text: "x".repeat(50) } }, { role: "assistant", content: { text: "y".repeat(50) } }, { role: "user", content: { text: "z" } }], 60);
    expect(capped.length).toBe(1);
    expect(capped[0].content).toBe("z");
  });
});
