import { beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in codes to the office's number (lib/sms-compose.ts, lib/sms-inbound.ts,
// api/texts.ts): shown for ten minutes then masked, never repeated in the
// body, never on a lock screen or to the assistant, and every copy or later
// Show recorded with who and when. Also the opt-out keywords and the line a
// first text ends with. Nothing here reaches the network.

const db: { path: string; init?: any }[] = [];
let me: any = null;
let rows: any[] = [];
let audits: any[] = [];

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    currentUser: async () => me,
    sb: async (path: string, init?: any) => {
      db.push({ path, init });
      if ((path.startsWith("sms_messages?id=eq.") || path.startsWith("sms_messages?select=")) && !init?.method) return rows;
      if (path.startsWith("audit_log?") && !init?.method) return audits;
      if (path === "audit_log" && init?.method === "POST") {
        audits = [{ target_id: "sms_1", action: init.body.action, actor_name: init.body.actor_name, actor_id: init.body.actor_id, at: "2026-11-06T15:05:00Z" }, ...audits];
        return null;
      }
      return null;
    },
    birdPlatformFetch: async () => {
      throw new Error("no network in tests");
    },
  };
});

import { codeShown, keywordOf, maskCode, maskDigitRuns, optedOutAt, withStopLine, CODE_SHOWN_MS } from "../lib/sms-compose";
import { textForAssistant, textNotice } from "../lib/sms-inbound";
import texts, { presentText } from "../api/texts";

function call(method: string, body?: unknown, query: Record<string, string> = {}) {
  const out: { status: number; json?: any } = { status: 0 };
  const res: any = { status: (c: number) => ((out.status = c), res), json: (j: unknown) => ((out.json = j), res) };
  return Promise.resolve(texts({ method, query, body, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  db.length = 0;
  rows = [];
  audits = [];
  me = { id: "11111111-1111-1111-1111-111111111111", name: "Alex Rivera", role: "admin", status: "approved", email: "alex@example.com" };
});

describe("masking a code", () => {
  it("masks the code wherever the body has it, in any form it was written", () => {
    expect(maskCode("Your code is 482913. Don't share it.", "482913")).toBe("Your code is ••••••. Don't share it.");
    expect(maskCode("Use verification code 123-456 to sign in", "123456")).toBe("Use verification code •••••• to sign in");
    expect(maskCode("G-583021 is your Google verification code.", "583021")).toBe("G-•••••• is your Google verification code.");
    expect(maskCode("Your login code\n\n551 902", "551902")).toBe("Your login code\n\n••••••");
    // A longer number that happens to contain the code is left alone.
    expect(maskCode("Order 14829135 and code 482913", "482913")).toBe("Order 14829135 and code ••••••");
    expect(maskCode("no code here", null)).toBe("no code here");
  });

  it("masks every run of 4 to 8 digits for places a code must never reach, keeping phone numbers", () => {
    expect(maskDigitRuns("Your PIN: 4821, code 551 902")).toBe("Your PIN: ••••, code ••••••");
    expect(maskDigitRuns("Call (844) 519-2725 or 8445192725")).toBe("Call (844) 519-2725 or 8445192725");
  });

  it("shows a code for ten minutes after it arrives", () => {
    const at = "2026-11-06T15:00:00Z";
    expect(codeShown(at, Date.parse(at) + CODE_SHOWN_MS - 1)).toBe(true);
    expect(codeShown(at, Date.parse(at) + CODE_SHOWN_MS)).toBe(false);
  });
});

describe("outside the Phone page", () => {
  it("never puts a code on a lock screen", () => {
    const n = textNotice({ from_number: "+18005550100", body: "Your code is 482913", code: "482913" });
    expect(n).toEqual({ title: "Sign-in code", subtitle: "(800) 555-0100", body: "A code from (800) 555-0100 arrived. Open BFO to see it." });
    expect(JSON.stringify(n)).not.toMatch(/482913/);
    // A code the reader missed still doesn't show.
    expect(textNotice({ from_number: "+18005550100", body: "Login 7741", code: null }).body).toBe("Login ••••");
  });

  it("gives the assistant the text with no code in it", () => {
    const a = textForAssistant({ body: "Your Chase code is 71920453. Ref 4410.", code: "71920453" });
    expect(a).toEqual({ body: "Your Chase code is ••••••••. Ref ••••.", hasCode: true, keyword: null });
  });
});

describe("the list", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "sms_1",
    from_number: "+18005550100",
    to_number: "+18445192725",
    body: "Your code is 482913",
    code: "482913",
    received_at: "2026-11-06T15:00:00Z",
    read_at: null,
    direction: "in" as const,
    status: null,
    error: null,
    sent_by: null,
    ...over,
  });

  it("shows a fresh code once, masked in the body, and masks it after ten minutes", () => {
    const at = Date.parse("2026-11-06T15:00:00Z");
    const fresh = presentText(row(), at + 60_000, new Map(), new Map());
    expect(fresh).toMatchObject({ code: "482913", codeMasked: false, body: "Your code is ••••••", codeUntil: "2026-11-06T15:10:00.000Z" });
    const old = presentText(row(), at + CODE_SHOWN_MS + 1, new Map(), new Map());
    expect(old).toMatchObject({ code: null, codeMasked: true, body: "Your code is ••••••" });
  });

  it("names who sent a text, and leaves the rest alone", () => {
    const names = new Map([["u2", "Sam Lee"]]);
    expect(presentText(row({ direction: "out", code: null, body: "On my way", sent_by: "u2" }), 0, names, new Map())).toMatchObject({ sentBy: "Sam Lee", sentById: "u2", body: "On my way" });
    expect(presentText(row({ direction: "out", code: null, body: "Help text", sent_by: null }), 0, names, new Map()).sentBy).toBe("BFO");
  });

  it("returns an old code masked from GET, with who has copied it", async () => {
    rows = [row({ received_at: "2020-01-01T00:00:00Z" })];
    audits = [{ target_id: "sms_1", action: "phone.code_copy", actor_name: "Sam Lee", actor_id: "u2", at: "2020-01-01T00:02:00Z" }];
    const out = await call("GET");
    expect(out.status).toBe(200);
    expect(out.json.texts[0]).toMatchObject({ code: null, codeMasked: true, body: "Your code is ••••••", codeAccess: [{ action: "copy", by: "Sam Lee", at: "2020-01-01T00:02:00Z" }] });
    expect(JSON.stringify(out.json)).not.toMatch(/482913/);
    expect(out.json.more).toBe(false);
  });
});

describe("the record of a code", () => {
  it("records each copy, without the code, and answers with who has copied it", async () => {
    rows = [{ id: "sms_1", from_number: "+18005550100", code: "482913", received_at: "2026-11-06T15:00:00Z" }];
    const out = await call("POST", { action: "code-copied", id: "sms_1" });
    expect(out.status).toBe(200);
    const write = db.find((c) => c.path === "audit_log" && c.init?.method === "POST")?.init.body;
    expect(write).toMatchObject({ action: "phone.code_copy", actor_name: "Alex Rivera", target_type: "sms_message", target_id: "sms_1", summary: "Copied a code from (800) 555-0100" });
    expect(JSON.stringify(write)).not.toMatch(/482913/);
    expect(out.json.access[0]).toMatchObject({ action: "copy", by: "Alex Rivera" });
  });

  it("shows a masked code again for a minute, and records that too", async () => {
    rows = [{ id: "sms_1", from_number: "+18005550100", code: "482913", received_at: "2020-01-01T00:00:00Z" }];
    const out = await call("POST", { action: "show-code", id: "sms_1" });
    expect(out).toMatchObject({ status: 200, json: { code: "482913" } });
    expect(Date.parse(out.json.until) - Date.now()).toBeLessThanOrEqual(60_000);
    expect(db.find((c) => c.path === "audit_log" && c.init?.method === "POST")?.init.body).toMatchObject({ action: "phone.code_show" });
  });

  it("is for owners and admins only", async () => {
    me = { ...me, role: "member" };
    expect((await call("POST", { action: "show-code", id: "sms_1" })).status).toBe(403);
    me = { ...me, role: "partner" };
    expect((await call("POST", { action: "show-code", id: "sms_1" })).status).toBe(403);
  });

  it("refuses a text with no code", async () => {
    rows = [{ id: "sms_1", from_number: "+18005550100", code: null, received_at: "2026-11-06T15:00:00Z" }];
    expect((await call("POST", { action: "code-copied", id: "sms_1" })).status).toBe(404);
    expect(db.some((c) => c.path === "audit_log")).toBe(false);
  });
});

describe("opting out", () => {
  it("knows the keywords only when the whole text is one", () => {
    for (const w of ["STOP", "Stop.", " unsubscribe ", "CANCEL", "end", "Quit", "STOP ALL", "opt out"]) expect(keywordOf(w)).toBe("stop");
    for (const w of ["START", "unstop"]) expect(keywordOf(w)).toBe("start");
    expect(keywordOf("HELP")).toBe("help");
    expect(keywordOf("please don't stop")).toBeNull();
    expect(keywordOf("")).toBeNull();
  });

  it("takes the newest STOP or START the number sent", () => {
    const t = (body: string, receivedAt: string, direction: "in" | "out" = "in") => ({ body, receivedAt, direction });
    expect(optedOutAt([t("hi", "2026-10-29T00:00:00Z"), t("STOP", "2026-10-30T00:00:00Z")])).toBe("2026-10-30T00:00:00Z");
    expect(optedOutAt([t("STOP", "2026-10-30T00:00:00Z"), t("START", "2026-10-31T00:00:00Z")])).toBeNull();
    // The office writing "stop" doesn't opt anyone out.
    expect(optedOutAt([t("STOP", "2026-10-30T00:00:00Z", "out")])).toBeNull();
  });

  it("ends a first text with the STOP line once", () => {
    expect(withStopLine("Hello")).toBe("Hello\nReply STOP to opt out.");
    expect(withStopLine("Hello. Reply STOP to opt out.")).toBe("Hello. Reply STOP to opt out.");
  });
});
