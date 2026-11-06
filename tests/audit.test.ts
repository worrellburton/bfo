import { beforeEach, describe, expect, it, vi } from "vitest";

const writes: unknown[] = [];
let failWith: Error | null = null;
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sb: async (path: string, init: { method?: string; body?: unknown } = {}) => {
      if (failWith) throw failWith;
      writes.push({ path, ...init });
      return null;
    },
  };
});
const warns: unknown[][] = [];
vi.mock("../lib/log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/log")>();
  return { ...actual, log: { ...actual.log, warn: (...a: unknown[]) => warns.push(a) } };
});

import { audit, auditRow, isMissingTable, scrubDetail } from "../lib/audit";

const person = { id: "00000000-0000-4000-8000-000000000001", name: "Alex Rivera", role: "admin" as const };

beforeEach(() => {
  writes.length = 0;
  warns.length = 0;
  failWith = null;
});

describe("auditRow", () => {
  it("keeps who, what, to what and how many", () => {
    const row = auditRow({ actor: person, action: "entity.archive", target: { type: "entity", id: "e1", label: "Northwind Holdings, LLC" }, summary: "Archived Northwind Holdings, LLC" });
    expect(row).toEqual({
      actor_id: person.id,
      actor_name: "Alex Rivera",
      actor_role: "admin",
      actor_kind: "user",
      action: "entity.archive",
      area: "entity",
      target_type: "entity",
      target_id: "e1",
      target_label: "Northwind Holdings, LLC",
      count: null,
      summary: "Archived Northwind Holdings, LLC",
      detail: null,
    });
  });

  it("records the system as the actor when no person acted", () => {
    expect(auditRow({ actor: "cron", action: "books.bulk_update", count: 48.2, summary: "Refiled 48 transactions" })).toMatchObject({ actor_id: null, actor_kind: "cron", area: "books", count: 48 });
    expect(auditRow({ actor: null, action: "mail.delete", summary: "Deleted a message" })).toMatchObject({ actor_kind: "system" });
  });

  it("refuses an entry with no action or summary", () => {
    expect(auditRow({ actor: person, action: "archive", summary: "Archived" })).toBeNull();
    expect(auditRow({ actor: person, action: "Entity.Archive", summary: "Archived" })).toBeNull();
    expect(auditRow({ actor: person, action: "entity.archive", summary: "   " })).toBeNull();
  });

  it("keeps secrets, codes, bodies and SSNs out", () => {
    const row = auditRow({
      actor: person,
      action: "mail.delete",
      summary: "Deleted a message about 123-45-6789",
      target: { type: "mail_message", id: "m1", label: "Re: 123-45-6789" },
      detail: { subject: "Invoice", body: "the whole message", token: "t", nested: { code: "123456", ssn: "123-45-6789", note: "SSN 123-45-6789 on file", keep: 3 } },
    })!;
    expect(row.summary).not.toContain("6789");
    expect(row.target_label).not.toContain("6789");
    expect(row.detail).toEqual({ subject: "Invoice", nested: { note: "SSN •••-••-•••• on file", keep: 3 } });
  });

  it("clips long text and oversized detail", () => {
    const row = auditRow({ actor: person, action: "books.bulk_update", summary: "x".repeat(900), detail: { ids: Array.from({ length: 50 }, (_, i) => `id-${"0".repeat(300)}-${i}`) } })!;
    expect(row.summary.length).toBe(500);
    expect(row.detail).toEqual({ truncated: true, keys: ["ids"] });
  });
});

describe("scrubDetail", () => {
  it("passes ordinary values through and limits depth", () => {
    expect(scrubDetail({ a: 1, b: true, c: "x", d: null, e: [1, 2] })).toEqual({ a: 1, b: true, c: "x", d: null, e: [1, 2] });
    expect(scrubDetail(new Date("2026-11-06T12:00:00Z"))).toBe("2026-11-06T12:00:00.000Z");
    expect(scrubDetail({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: "[nested]" } } } });
  });
});

describe("isMissingTable", () => {
  it("knows PostgREST's missing-table answers", () => {
    expect(isMissingTable(new Error('supabase 404: {"code":"PGRST205","message":"Could not find the table \'public.audit_log\'"}'))).toBe(true);
    expect(isMissingTable(new Error('relation "public.audit_log" does not exist'))).toBe(true);
    expect(isMissingTable(new Error("supabase 500: timeout"))).toBe(false);
  });
});

describe("audit", () => {
  it("writes one row and resolves true", async () => {
    await expect(audit({ actor: person, action: "user.role_change", target: { type: "user", id: "u2", label: "Sam Lee" }, summary: "Changed Sam Lee from Viewer to Member" })).resolves.toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: "audit_log", method: "POST", body: { action: "user.role_change", area: "user" } });
  });

  it("never throws into the request when the table isn't there yet", async () => {
    failWith = new Error('supabase 404: {"code":"PGRST205"}');
    await expect(audit({ actor: person, action: "signature.delete", summary: "Deleted a draft request" })).resolves.toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0][2]).toEqual({ written: false, valid: true, tableMissing: true, action: "signature.delete" });
  });

  it("logs booleans, not values, when the database fails", async () => {
    failWith = new Error("supabase 500: Alex Rivera something secret");
    await expect(audit({ actor: person, action: "entity.archive", summary: "Archived Northwind" })).resolves.toBe(false);
    expect(JSON.stringify(warns)).not.toContain("Alex");
    expect(JSON.stringify(warns)).not.toContain("Northwind");
  });

  it("refuses a malformed entry without writing", async () => {
    await expect(audit({ actor: person, action: "", summary: "" })).resolves.toBe(false);
    expect(writes).toHaveLength(0);
    expect(warns[0][2]).toEqual({ written: false, valid: false });
  });
});
