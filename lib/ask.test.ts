import { describe, expect, it } from "vitest";
import {
  clampInt,
  einLastFour,
  entityDetail,
  entitySummary,
  looseName,
  maskDigits,
  matchEntity,
  provenance,
  systemPrompt,
  thirtyDaysBefore,
  titleFrom,
  toolLabel,
  toolsFor,
  transcript,
  txnKind,
  type Scope,
} from "./ask";

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
  it("reads a row's kind the way the P&L does: a loan wins, then the person's type, then the rules'", () => {
    const t = { loan_id: null, type_override: null, txn_type: "normal", intercompany: false };
    expect(txnKind({ ...t, type_override: "transfer" })).toBe("transfer");
    expect(txnKind({ ...t, intercompany: true })).toBe("intercompany");
    expect(txnKind({ ...t, txn_type: "transfer" })).toBe("transfer");
    expect(txnKind({ ...t, loan_id: "l1", type_override: "normal" })).toBe("loan");
    expect(txnKind(t)).toBe("normal");
  });
  it("compares treasury with the closest day 30 or more calendar days back, not the 31st row", () => {
    const rows = [{ day: "2026-11-06" }, { day: "2026-10-20" }, { day: "2026-10-08" }, { day: "2026-10-01" }, { day: "2026-09-01" }];
    expect(thirtyDaysBefore(rows)?.day).toBe("2026-10-01");
    expect(thirtyDaysBefore([{ day: "2026-11-06" }, { day: "2026-11-01" }])).toBeNull();
  });
  it("clamps counts", () => {
    expect(clampInt("500", 1, 100, 10)).toBe(100);
    expect(clampInt(undefined, 1, 100, 10)).toBe(10);
  });
});

describe("what the model never sees", () => {
  it("an EIN beyond its last four", () => {
    expect(einLastFour("12-3456789")).toBe("••-•••6789");
    expect(einLastFour("")).toBeNull();
    expect(entityDetail("a", { name: "X", ein: "12-3456789" }, null, new Map()).ein).toBe("••-•••6789");
  });
  it("a code inside a text", () => {
    expect(maskDigits("Your code is 482913. Don't share it.")).toBe("Your code is ••••••. Don't share it.");
    expect(maskDigits("Code: 123 456")).toBe("Code: ••• •••");
    expect(maskDigits("Call me at 5")).toBe("Call me at 5");
  });
  it("staff notes, when a partner asks", () => {
    expect(entityDetail("a", { name: "X", notes: "staff only" }, null, new Map(), new Date(), false)).not.toHaveProperty("notes");
    expect(entityDetail("a", { name: "X", notes: "staff only" }, null, new Map(), new Date(), true).notes).toBe("staff only");
  });
  it("is told not to give legal or tax advice, and to cite period, basis and as-of", () => {
    const p = systemPrompt(staff);
    expect(p).toMatch(/aren't a lawyer or an accountant/);
    expect(p).toMatch(/cash basis/);
    expect(p).toMatch(/Never repeat a verification code/);
  });
});

describe("provenance", () => {
  it("names the books' period, basis and row count", () => {
    const out = JSON.stringify({ from: "2026-07-01", to: "2026-09-30", entity: "All entities", transactions: 214, uncategorized: { count: 3 } });
    expect(provenance("books_summary", { from: "2026-07-01", to: "2026-09-30" }, out)).toEqual({
      tool: "books_summary",
      label: "Adding up the books",
      detail: "Books, Jul 1, 2026 – Sep 30, 2026 · cash basis, posted · 214 transactions · 3 uncategorized",
    });
  });
  it("names the treasury's as-of", () => {
    expect(provenance("treasury", {}, JSON.stringify({ asOf: "2026-11-06" })).detail).toBe("Treasury as of Nov 6, 2026");
  });
  it("survives a cut-off result", () => {
    expect(provenance("search_mail", { query: "lease" }, "{not json").label).toBe("Searching mail for “lease”");
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
    const capped = transcript(
      [
        { role: "user", content: { text: "x".repeat(50) } },
        { role: "assistant", content: { text: "y".repeat(50) } },
        { role: "user", content: { text: "z" } },
      ],
      60,
    );
    expect(capped.length).toBe(1);
    expect(capped[0].content).toBe("z");
  });
});
