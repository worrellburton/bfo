import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWebhook } from "../lib/mail-webhook";
import {
  htmlFromText,
  ingestInbound,
  ourRecipients,
  parseSend,
  rawHeaderRecipients,
  replyHeaders,
  searchCondition,
  snippetOf,
  storable,
  syncInbound,
  toMessage,
  toSummary,
  type BirdInbound,
  type MailRow,
} from "../lib/mail";

// ── Mocks: Supabase REST (sb/sbFetch), Bird (birdPlatformFetch), the session, and Storage (global fetch) ──

type Call = { method: string; path: string; body?: any; prefer?: string; headers?: Record<string, string> };
type Route = [RegExp, (c: Call) => unknown];

const sbCalls: Call[] = [];
const birdCalls: Call[] = [];
const storageCalls: Call[] = [];
let sbRoutes: Route[] = [];
let birdRoutes: Route[] = [];
let storageRoutes: Route[] = [];
let unreadTotal = 0;
let me: Record<string, unknown> | null = null;

const sbMock = vi.fn(async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
  const c: Call = { method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body, prefer: init.prefer };
  sbCalls.push(c);
  const hit = sbRoutes.find(([re]) => re.test(`${c.method} ${c.path}`));
  return hit ? hit[1](c) : [];
});
const sbFetchMock = vi.fn(async (path: string) => {
  sbCalls.push({ method: "COUNT", path: decodeURIComponent(path) });
  return new Response("[]", { headers: { "content-range": `0-0/${unreadTotal}` } });
});
const birdMock = vi.fn(async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const c: Call = { method: init.method ?? "GET", path, body: init.body, headers: init.headers };
  birdCalls.push(c);
  const hit = birdRoutes.find(([re]) => re.test(`${c.method} ${c.path}`));
  return (hit ? hit[1](c) : new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 })) as Response;
});
const currentUserMock = vi.fn(async (_req: unknown, opts: { allowEmailOnly?: boolean } = {}) =>
  me && (me.role !== "email" || opts.allowEmailOnly) ? me : null
);

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    sb: (...a: unknown[]) => (sbMock as (...x: unknown[]) => unknown)(...a),
    sbFetch: (...a: unknown[]) => (sbFetchMock as (...x: unknown[]) => unknown)(...a),
    birdPlatformFetch: (...a: unknown[]) => (birdMock as (...x: unknown[]) => unknown)(...a),
    currentUser: (...a: unknown[]) => (currentUserMock as (...x: unknown[]) => unknown)(...a),
  };
});

import mailHandler from "../api/mail";
import webhookHandler from "../api/mail-webhook";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const SEND_ID = "44444444-4444-4444-8444-444444444444";
const ROBERT = "robert@burtonfamilyoffice.com";
const CLAIRE = "claire@burtonfamilyoffice.com";
const robert = { id: U1, name: "Robert Burton", role: "member", status: "approved", mail_address: ROBERT };
const owner = { ...robert, role: "owner" };

function row(over: Partial<MailRow> = {}): MailRow {
  return {
    id: MSG,
    user_id: U1,
    dedupe_key: `in:rem_1:${U1}`,
    folder: "inbox",
    direction: "in",
    bird_id: "rem_1",
    message_id: "<orig@example.com>",
    in_reply_to: null,
    references_ids: ["<root@example.com>"],
    from_email: "jane@example.com",
    from_name: "Jane",
    to_addrs: [{ email: ROBERT }],
    cc_addrs: [],
    bcc_addrs: [],
    delivered_to: ROBERT,
    subject: "Hello",
    text_body: "Hi Robert",
    html_body: null,
    snippet: "Hi Robert",
    attachments: [],
    spf_pass: true,
    dkim_pass: null,
    status: null,
    read_at: null,
    starred_at: null,
    occurred_at: "2026-10-14T12:00:00.000Z",
    created_at: "2026-10-14T12:00:01.000Z",
    ...over,
  };
}

function inbound(over: Partial<BirdInbound> = {}): BirdInbound {
  return {
    id: "rem_1",
    from: { email: "Jane@Example.com", name: "Jane" },
    to: [{ email: "Robert@BurtonFamilyOffice.com" }],
    cc: [],
    subject: "Hello",
    message_id: "<m1@example.com>",
    in_reply_to: null,
    references: ["<r0@example.com>"],
    spf_pass: true,
    dkim_pass: null,
    attachments: [],
    received_at: "2026-10-14T12:00:00Z",
    ...over,
  };
}

function call(method: string, opts: { query?: Record<string, string>; body?: unknown } = {}) {
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
    end() {
      return res;
    },
    setHeader() {},
  };
  return Promise.resolve(mailHandler({ method, query: opts.query ?? {}, body: opts.body, headers: {} } as any, res)).then(() => out);
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  sbCalls.length = 0;
  birdCalls.length = 0;
  storageCalls.length = 0;
  sbRoutes = [];
  birdRoutes = [];
  storageRoutes = [];
  unreadTotal = 0;
  me = robert;
  currentUserMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c: Call = { method: init.method ?? "GET", path: String(url).replace("https://sb.test/storage/v1", ""), body: init.body };
      storageCalls.push(c);
      const hit = storageRoutes.find(([re]) => re.test(`${c.method} ${c.path}`));
      return hit ? hit[1](c) : json({});
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Webhook signatures (Standard Webhooks) ─────────────────────────────

const SECRET = "whsec_" + Buffer.from("bird-signing-key").toString("base64");
const now = 1_790_000_000_000;
const ts = String(Math.floor(now / 1000));
const sign = (id: string, t: string, body: string, key = Buffer.from("bird-signing-key")) =>
  `v1,${createHmac("sha256", key).update(`${id}.${t}.${body}`).digest("base64")}`;

describe("mail webhook signature", () => {
  const body = JSON.stringify({ type: "email.received", data: { inbound_message_id: "rem_1" } });
  it("accepts a valid signature, also among several", () => {
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, SECRET, now)).toBe(true);
    const rotating = `v1,bm9wZQ== ${sign("msg_1", ts, body)}`;
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: rotating }, SECRET, now)).toBe(true);
  });
  it("rejects a wrong key, a changed body or id, other versions and missing headers", () => {
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body, Buffer.from("other")) }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body + " ", { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_2", timestamp: ts, signature: sign("msg_1", ts, body) }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body).replace("v1,", "v2,") }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, "", now)).toBe(false);
  });
  it("rejects a stale or future timestamp", () => {
    const old = String(Math.floor(now / 1000) - 6 * 60);
    const ahead = String(Math.floor(now / 1000) + 6 * 60);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, SECRET, now)).toBe(false);
    expect(verifyWebhook(body, { id: "msg_1", timestamp: ahead, signature: sign("msg_1", ahead, body) }, SECRET, now)).toBe(false);
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────

describe("routing", () => {
  it("takes To and Cc on our domain, lowercase, once", () => {
    expect(
      ourRecipients({
        to: [{ email: "Robert@BurtonFamilyOffice.com" }, { email: "jane@example.com" }],
        cc: [{ email: "robert@burtonfamilyoffice.com" }, { email: CLAIRE }, { email: "x@evil-burtonfamilyoffice.com" }],
      })
    ).toEqual([ROBERT, CLAIRE]);
  });

  it("reads envelope recipients from the headers only", () => {
    const raw = [
      "Received: from mail.example.com by rx1.us1.inbound.bird.com",
      "\twith ESMTPS for <Claire@BurtonFamilyOffice.com>; Tue, 14 Oct 2026 12:00:00 +0000",
      "X-Original-To: robert@burtonfamilyoffice.com",
      "Delivered-To: someone@example.com",
      "Delivered-To: <info@burtonfamilyoffice.com>",
      "To: list@lists.example.com",
      "",
      "Delivered-To: evil@burtonfamilyoffice.com",
    ].join("\r\n");
    expect(rawHeaderRecipients(raw)).toEqual(["info@burtonfamilyoffice.com", ROBERT, CLAIRE]);
  });
});

describe("bodies", () => {
  it("snips text, or HTML stripped to text", () => {
    expect(snippetOf("  Hello\n\n  there  ")).toBe("Hello there");
    expect(snippetOf(null, "<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;<b>Robert</b> &amp; co</p></body></html>")).toBe("Hi Robert & co");
    const long = snippetOf("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("snips the message's own words, not the quoted reply under it", () => {
    expect(snippetOf("hi!\n\nOn Sat, Oct 17, 2026 at 9:11 AM Robert Burton <robert@burtonfamilyoffice.com> wrote:\n> ttest")).toBe("hi!");
    // Gmail wraps a long attribution line.
    expect(snippetOf("Sounds good.\r\n\r\nOn Sat, Oct 17, 2026 at 9:11 AM Robert Burton <\r\nrobert@burtonfamilyoffice.com> wrote:\r\n> a\r\n> b")).toBe("Sounds good.");
    expect(snippetOf("Yes\n-----Original Message-----\nFrom: Jane\nSent: Monday\nhello")).toBe("Yes");
    expect(snippetOf("> only a quote\n> nothing new")).toBe("> only a quote > nothing new");
    expect(snippetOf(null, '<div dir="ltr">Thanks!<div class="gmail_quote">On Sat, Robert wrote:<br><blockquote class="gmail_quote"><div>ttest<blockquote>older</blockquote></div></blockquote></div></div>')).toBe("Thanks!");
    expect(snippetOf("Nothing quoted here")).toBe("Nothing quoted here");
  });

  it("keeps only text Postgres accepts: no NULs, no lone surrogates, no half emoji", () => {
    expect(storable("a\u0000b\ud83dc\ude00d😀")).toBe("abcd😀");
    // The emoji straddles the cut: it's dropped whole, not halved.
    expect(snippetOf("x".repeat(158) + "😀 more")).toBe("x".repeat(158) + "…");
    expect(snippetOf("x".repeat(157) + "😀 more")).toBe("x".repeat(157) + "😀…");
    // An entity for half a surrogate pair stays as text.
    expect(snippetOf(null, "<p>&#55357;ok &#xDE00; &#x1F600;</p>")).toBe("&#55357;ok &#xDE00; 😀");
  });

  it("builds simple HTML from text: escaped, line breaks, quotes", () => {
    const html = htmlFromText("Thanks <Jane> & co\nSee you\n\nOn Tue, Jane wrote:\n> first\n>> older\n> last");
    expect(html).toContain("Thanks &lt;Jane&gt; &amp; co<br>See you<br><br>On Tue, Jane wrote:<br><blockquote");
    expect(html).toMatch(/<blockquote[^>]*>first<br><blockquote[^>]*>older<\/blockquote>last<\/blockquote><\/div><\/body><\/html>$/);
    expect(html).not.toContain("<Jane>");
  });
});

describe("reply headers", () => {
  it("threads onto the original and trims References from the oldest", () => {
    expect(replyHeaders({ message_id: "<b@x>", references_ids: ["<a@x>"] })).toEqual({ inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] });
    const many = Array.from({ length: 60 }, (_, i) => `<message-${String(i).padStart(3, "0")}@mail.example.com>`);
    const r = replyHeaders({ message_id: "<last@x>", references_ids: many });
    expect(r.references.join(" ").length).toBeLessThanOrEqual(998);
    expect(r.references.at(-1)).toBe("<last@x>");
    expect(r.references).not.toContain(many[0]);
    expect(r.references).toContain(many[59]);
    expect(replyHeaders({ message_id: null, references_ids: null })).toEqual({ inReplyTo: null, references: [] });
  });
});

describe("send requests", () => {
  const base = { sendId: SEND_ID, to: ["jane@example.com"], subject: "Hi", text: "Hello" };
  it("accepts a good one and builds its HTML", () => {
    const r = parseSend({ ...base, to: ["Jane <Jane@Example.com>", "jane@example.com"], cc: ["jane@example.com", "bob@example.com"], bcc: ["bob@example.com"] });
    expect(r).toMatchObject({ to: ["jane@example.com"], cc: ["bob@example.com"], bcc: [], subject: "Hi", text: "Hello" });
    expect("html" in r && r.html).toContain("Hello");
  });
  it("refuses bad addresses, too many recipients, long subjects and bodies, big files", () => {
    expect(parseSend({ ...base, to: ["not an address"] })).toMatchObject({ error: "bad_address" });
    expect(parseSend({ ...base, to: ["a@b.com\r\nBcc: x@y.com"] })).toMatchObject({ error: "bad_address" });
    expect(parseSend({ ...base, to: [] })).toMatchObject({ error: "no_recipients" });
    expect(parseSend({ ...base, to: Array.from({ length: 51 }, (_, i) => `p${i}@example.com`) })).toMatchObject({ error: "too_many_recipients" });
    expect(parseSend({ ...base, subject: "x".repeat(301) })).toMatchObject({ error: "subject_too_long" });
    expect(parseSend({ ...base, text: "x".repeat(500 * 1024 + 1) })).toMatchObject({ error: "text_too_long" });
    expect(parseSend({ ...base, sendId: "nope" })).toMatchObject({ error: "bad_send_id" });
    expect(parseSend({ ...base, replyToId: "nope" })).toMatchObject({ error: "bad_reference" });
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64");
    expect(parseSend({ ...base, attachments: [{ filename: "a.bin", contentType: "application/pdf", data: big }] })).toMatchObject({ error: "attachments_too_large" });
    expect(parseSend({ ...base, attachments: [{ filename: "a.bin", data: "***" }] })).toMatchObject({ error: "bad_attachment" });
  });
  it("strips line breaks from the subject", () => {
    expect(parseSend({ ...base, subject: "Hi\r\nBcc: x@y.com" })).toMatchObject({ subject: "Hi Bcc: x@y.com" });
  });
});

describe("rows to the API", () => {
  it("maps a received row", () => {
    const r = row({ attachments: [{ id: "rea_1", filename: "a.pdf", contentType: "application/pdf", size: 3, path: "in/rem_1/rea_1" }, { id: "rea_2", filename: "", contentType: "", size: 1, path: null }] });
    expect(toSummary(r)).toEqual({
      id: MSG, folder: "inbox", direction: "in", from: { email: "jane@example.com", name: "Jane" }, to: [{ email: ROBERT }], cc: [],
      subject: "Hello", snippet: "Hi Robert", occurredAt: "2026-10-14T12:00:00.000Z", read: false, starred: false, attachmentCount: 2, status: null, other: false,
    });
    const m = toMessage(r);
    expect(m.attachments).toEqual([
      { id: "rea_1", filename: "a.pdf", contentType: "application/pdf", size: 3, available: true },
      { id: "rea_2", filename: "attachment", contentType: "application/octet-stream", size: 1, available: false },
    ]);
    expect(m).toMatchObject({ bcc: [], text: "Hi Robert", html: null, deliveredTo: ROBERT, messageId: "<orig@example.com>", unverifiedSender: false });
    expect(toMessage(row({ spf_pass: false, dkim_pass: null })).unverifiedSender).toBe(true);
    expect(toMessage(row({ direction: "out", folder: "sent", spf_pass: null })).unverifiedSender).toBe(false);
    expect(toSummary(row({ user_id: null, read_at: "2026-10-14T13:00:00Z", starred_at: "2026-10-14T13:00:00Z" }))).toMatchObject({ other: true, read: true, starred: true });
  });
});

// ── Receiving ─────────────────────────────────────────────────────────

describe("ingest", () => {
  const inserted = () => sbCalls.find((c) => c.method === "POST" && c.path.startsWith("mail_messages?on_conflict=dedupe_key"));

  it("delivers a copy to each user named in To/Cc, with attachments kept once", async () => {
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\/rem_1\/body$/, () => json({ html: "<p>Hi <b>Robert</b></p>", text: null })],
      [/GET \/v1\/email\/inbound-messages\/rem_1\/attachments\/rea_1$/, () => new Response(new Uint8Array([1, 2, 3]))],
    ];
    sbRoutes = [
      [/GET app_users\?status=eq\.approved&mail_address=in\.\("robert@burtonfamilyoffice\.com","claire@burtonfamilyoffice\.com"\)/, () => [{ id: U1, mail_address: ROBERT }, { id: U2, mail_address: CLAIRE }]],
      [/POST mail_messages\?on_conflict=dedupe_key/, (c) => c.body.map((_: unknown, i: number) => ({ id: `r${i}` }))],
    ];
    const n = await ingestInbound(inbound({ cc: [{ email: CLAIRE }], attachments: [{ id: "rea_1", filename: "a.pdf", content_type: "application/pdf", size: 3 }] }));
    expect(n).toBe(2);
    const ins = inserted()!;
    expect(ins.prefer).toContain("resolution=ignore-duplicates");
    expect(ins.body.map((r: any) => [r.user_id, r.dedupe_key, r.delivered_to])).toEqual([
      [U1, `in:rem_1:${U1}`, ROBERT],
      [U2, `in:rem_1:${U2}`, CLAIRE],
    ]);
    expect(ins.body[0]).toMatchObject({
      folder: "inbox", direction: "in", bird_id: "rem_1", from_email: "jane@example.com", from_name: "Jane", snippet: "Hi Robert",
      references_ids: ["<r0@example.com>"], attachments: [{ id: "rea_1", filename: "a.pdf", contentType: "application/pdf", size: 3, path: "in/rem_1/rea_1" }],
    });
    expect(storageCalls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/object/mail/in/rem_1/rea_1"]);
    expect(birdCalls.some((c) => c.path.endsWith("/raw"))).toBe(false);
  });

  it("delivers mail to an extra address to the account that has it, once per person", async () => {
    const ACCOUNTS = "accounting@burtonfamilyoffice.com";
    birdRoutes = [[/\/body$/, () => json({ html: null, text: "Invoice" })]];
    sbRoutes = [
      [/GET mail_aliases\?address=in\./, () => [{ address: ACCOUNTS, user_id: U1 }]],
      [/GET app_users\?status=eq\.approved&id=in\./, () => [{ id: U1 }]],
      [/GET app_users\?status=eq\.approved&mail_address=in\./, () => [{ id: U1, mail_address: ROBERT }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    // Addressed to both of Robert's addresses: one copy, delivered at the first one named.
    expect(await ingestInbound(inbound({ id: "rem_a", to: [{ email: ACCOUNTS }, { email: ROBERT }] }))).toBe(1);
    expect(inserted()!.body).toEqual([expect.objectContaining({ user_id: U1, dedupe_key: `in:rem_a:${U1}`, delivered_to: ACCOUNTS })]);
  });

  it("falls back to the envelope headers when To/Cc name nobody here", async () => {
    birdRoutes = [
      [/\/raw$/, () => new Response("Received: by rx1.us1.inbound.bird.com\r\n for <claire@burtonfamilyoffice.com>; Tue\r\nTo: list@lists.example.com\r\n\r\nbody")],
      [/\/body$/, () => json({ html: null, text: "Hi list" })],
    ];
    sbRoutes = [
      [/GET app_users.*claire@burtonfamilyoffice\.com/, () => [{ id: U2, mail_address: CLAIRE }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    expect(await ingestInbound(inbound({ id: "rem_2", to: [{ email: "list@lists.example.com" }] }))).toBe(1);
    expect(inserted()!.body).toEqual([expect.objectContaining({ user_id: U2, dedupe_key: `in:rem_2:${U2}`, delivered_to: CLAIRE })]);
  });

  it("keeps mail for an address nobody has as one catch-all copy", async () => {
    birdRoutes = [
      [/\/raw$/, () => new Response("Delivered-To: nobody@burtonfamilyoffice.com\r\n\r\n")],
      [/\/body$/, () => json({ html: null, text: "?" })],
    ];
    sbRoutes = [[/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))]];
    expect(await ingestInbound(inbound({ id: "rem_3", to: [{ email: "nobody@burtonfamilyoffice.com" }] }))).toBe(1);
    expect(inserted()!.body).toEqual([expect.objectContaining({ user_id: null, dedupe_key: "in:rem_3:other", delivered_to: "nobody@burtonfamilyoffice.com" })]);
  });

  it("does nothing for a copy already stored", async () => {
    sbRoutes = [
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/GET mail_messages\?bird_id=eq\.rem_1/, () => [{ dedupe_key: `in:rem_1:${U1}` }]],
    ];
    expect(await ingestInbound(inbound())).toBe(0);
    expect(birdCalls).toEqual([]);
    expect(inserted()).toBeUndefined();
  });

  it("doesn't bring back a copy the user deleted", async () => {
    sbRoutes = [
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/GET mail_deleted\?bird_id=eq\.rem_1&select=dedupe_key/, () => [{ dedupe_key: `in:rem_1:${U1}` }]],
    ];
    expect(await ingestInbound(inbound())).toBe(0);
    expect(birdCalls).toEqual([]);
    expect(inserted()).toBeUndefined();
  });

  it("shows mail from our own domain as unverified unless we sent it", async () => {
    // Bird's SPF/DKIM pass is for the sending server's own domain, not the From header.
    const forged = inbound({ id: "rem_5", from: { email: "Robert@BurtonFamilyOffice.com", name: "Robert Burton" }, to: [{ email: CLAIRE }], subject: "Wire today", spf_pass: true, dkim_pass: true });
    birdRoutes = [[/\/body$/, () => json({ html: null, text: "Please wire" })]];
    sbRoutes = [
      [/GET app_users/, () => [{ id: U2, mail_address: CLAIRE }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    await ingestInbound(forged);
    const lookup = () => sbCalls.find((c) => c.path.startsWith("mail_messages?direction=eq.out"));
    expect(lookup()!.path).toBe(
      `mail_messages?direction=eq.out&from_email=eq.${ROBERT}&subject=eq.Wire today` +
        "&occurred_at=gte.2026-10-14T11:45:00.000Z&occurred_at=lte.2026-10-14T12:05:00.000Z&select=id&limit=1"
    );
    expect(inserted()!.body[0]).toMatchObject({ from_email: ROBERT, spf_pass: null, dkim_pass: null });
    expect(toMessage({ ...row(), ...inserted()!.body[0] }).unverifiedSender).toBe(true);

    // No subject matches a sent copy with none.
    sbCalls.length = 0;
    await ingestInbound({ ...forged, id: "rem_6", subject: null });
    expect(lookup()!.path).toContain(`&or=(subject.is.null,subject.eq."")&`);

    // A message we did send (to a colleague here) keeps its pass.
    sbCalls.length = 0;
    sbRoutes.unshift([/GET mail_messages\?direction=eq\.out/, () => [{ id: "sent" }]]);
    await ingestInbound({ ...forged, id: "rem_7" });
    expect(inserted()!.body[0]).toMatchObject({ spf_pass: true, dkim_pass: true });

    // Outside senders aren't looked up.
    sbCalls.length = 0;
    await ingestInbound(inbound({ id: "rem_8", to: [{ email: CLAIRE }], spf_pass: true }));
    expect(lookup()).toBeUndefined();
    expect(inserted()!.body[0]).toMatchObject({ spf_pass: true });
  });

  it("stores only text Postgres accepts", async () => {
    birdRoutes = [
      [/\/body$/, () => json({ html: "<p>a\u0000b</p>", text: "x".repeat(158) + "😀 more\u0000" })],
      [/\/attachments\/rea_1$/, () => new Response(new Uint8Array([1]))],
    ];
    sbRoutes = [
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    await ingestInbound(
      inbound({
        subject: "Hi\u0000 \ude00there",
        from: { email: "jane@example.com", name: "Ja\ud83dne" },
        cc: [{ email: "bob@example.com", name: "B\u0000ob" }],
        attachments: [{ id: "rea_1", filename: "a\u0000.pdf", content_type: "application/pdf", size: 1 }],
      })
    );
    const r = inserted()!.body[0];
    expect(r).toMatchObject({ subject: "Hi there", from_name: "Jane", html_body: "<p>ab</p>", text_body: "x".repeat(158) + "😀 more", snippet: "x".repeat(158) + "…" });
    expect(r.cc_addrs).toEqual([{ email: "bob@example.com", name: "Bob" }]);
    expect(r.attachments[0].filename).toBe("a.pdf");
    // JSON keeps a whole emoji as is; only a NUL or a lone surrogate would be escaped.
    expect(JSON.stringify(inserted()!.body)).not.toMatch(/\\u0000|\\ud[89a-f]/i);
  });

  it("records a file Bird no longer has as unavailable, and retries other failures", async () => {
    sbRoutes = [
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    birdRoutes = [[/\/body$/, () => json({ html: null, text: "x" })]];
    await ingestInbound(inbound({ attachments: [{ id: "rea_9", filename: "gone.pdf", content_type: null, size: 5 }] }));
    expect(inserted()!.body[0].attachments).toEqual([{ id: "rea_9", filename: "gone.pdf", contentType: "application/octet-stream", size: 5, path: null }]);

    birdRoutes = [
      [/\/body$/, () => json({ html: null, text: "x" })],
      [/\/attachments\//, () => json({ error: { message: "boom" } }, 500)],
    ];
    await expect(ingestInbound(inbound({ attachments: [{ id: "rea_9", filename: "x", content_type: null, size: 5 }] }))).rejects.toThrow(/Bird refused \(500\)/);
  });
});

describe("sync", () => {
  const T0 = Date.parse("2026-10-15T12:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const DAY = 24 * 60 * 60_000;
  let lists: URLSearchParams[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    lists = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Bird's inbound list over these messages: received_after/before (inclusive), newest first, paged. */
  const birdList = (all: BirdInbound[]) => (c: Call) => {
    const q = new URL(`https://bird.test${c.path}`).searchParams;
    lists.push(q);
    const after = Date.parse(q.get("received_after")!);
    const before = q.get("received_before") ? Date.parse(q.get("received_before")!) : Infinity;
    const list = all
      .filter((m) => Date.parse(m.received_at) >= after && Date.parse(m.received_at) <= before)
      .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at) || (a.id < b.id ? 1 : -1));
    const start = q.get("starting_after") ? list.findIndex((m) => m.id === q.get("starting_after")) + 1 : 0;
    const data = list.slice(start, start + Number(q.get("limit")));
    return json({ data, next_cursor: start + data.length < list.length ? data.at(-1)!.id : null });
  };

  /** A mailbox in Supabase: the sync row, stored copies and tombstones. Every run gets the claim. */
  function mailbox(cursor: string | null) {
    const db = { cursor, stored: new Set<string>(), deleted: new Set<string>(), inserts: [] as string[] };
    const ids = (c: Call) => /bird_id=in\.\(([^)]*)\)/.exec(c.path)![1].split(",");
    sbRoutes = [
      [/PATCH mail_sync\?id=eq\.inbound&or=/, () => [{ id: "inbound", cursor: db.cursor, synced_at: null, error: null }]],
      [/PATCH mail_sync\?id=eq\.inbound$/, (c) => ((db.cursor = c.body.cursor), null)],
      [/GET mail_messages\?bird_id=in\./, (c) => ids(c).filter((id) => db.stored.has(id)).map((bird_id) => ({ bird_id }))],
      [/GET mail_deleted\?bird_id=in\./, (c) => ids(c).filter((id) => db.deleted.has(id)).map((bird_id) => ({ bird_id }))],
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/POST mail_messages/, (c) => c.body.map((r: any) => (db.stored.add(r.bird_id), db.inserts.push(r.bird_id), { id: r.bird_id }))],
    ];
    return db;
  }

  /** n messages, `stepMs` apart from `start`. */
  const burst = (prefix: string, n: number, start: string, stepMs: number) =>
    Array.from({ length: n }, (_, i) => inbound({ id: `${prefix}_${String(i).padStart(4, "0")}`, received_at: iso(Date.parse(start) + i * stepMs) }));

  it("skips when another run is recent", async () => {
    expect(await syncInbound()).toEqual({ ingested: 0, skipped: true });
    expect(sbCalls[0].path).toMatch(/^mail_sync\?id=eq\.inbound&or=\(synced_at\.is\.null,synced_at\.lt\."/);
    expect(birdCalls).toEqual([]);
  });

  it("walks forward a day at a time, stores what's new oldest-first, and moves the cursor to now", async () => {
    const db = mailbox("2026-10-14T00:00:00.000Z");
    db.stored.add("rem_new");
    const all = [inbound({ id: "rem_new", received_at: "2026-10-14T12:00:00Z" }), inbound({ id: "rem_old", received_at: "2026-10-14T11:00:00Z" }), inbound({ id: "rem_late", received_at: "2026-10-15T09:00:00Z" })];
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\?/, birdList(all)],
      [/\/body$/, () => json({ html: null, text: "x" })],
    ];
    expect(await syncInbound()).toEqual({ ingested: 2 });
    expect(lists.map((q) => [q.get("received_after"), q.get("received_before")])).toEqual([
      ["2026-10-13T23:50:00.000Z", "2026-10-14T23:50:00.000Z"],
      ["2026-10-14T23:50:00.000Z", "2026-10-15T12:00:00.000Z"],
    ]);
    expect(db.inserts).toEqual(["rem_old", "rem_late"]);
    expect(sbCalls.at(-1)).toMatchObject({ path: "mail_sync?id=eq.inbound", body: { cursor: "2026-10-15T12:00:00.000Z", error: null } });
  });

  it("keeps the cursor before a message it couldn't store, and saves the problem", async () => {
    const db = mailbox(null);
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\?/, birdList([inbound({ id: "rem_a", received_at: "2026-10-14T12:00:00Z" }), inbound({ id: "rem_b", received_at: "2026-10-15T11:00:00Z" })])],
      [/\/body$/, () => json({ error: { message: "nope" } }, 403)],
    ];
    const r = await syncInbound();
    expect(r).toEqual({ ingested: 0, error: "Bird refused (403): the API key can't read received mail" });
    expect(lists[0].get("received_after")).toBe(iso(T0 - 30 * DAY));
    expect(sbCalls.at(-1)!.body).toMatchObject({ cursor: "2026-10-14T11:59:59.000Z", error: r.error });
    expect(db.cursor).toBe("2026-10-14T11:59:59.000Z");
    // It stopped there: the later window wasn't listed.
    expect(lists.some((q) => Date.parse(q.get("received_before")!) > Date.parse("2026-10-15T00:00:00Z"))).toBe(false);
  });

  it("lists every page of a window, and stops mid-window when time runs out", async () => {
    const db = mailbox("2026-10-15T00:00:00.000Z");
    // 250 within half a second: halved down to the smallest window, which is then paged in full.
    const all = burst("rem", 250, "2026-10-15T00:00:00Z", 2);
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\?/, birdList(all)],
      [/\/body$/, () => (vi.setSystemTime(Date.now() + 100), json({ html: null, text: "x" }))],
    ];
    await syncInbound({ budgetMs: 10_000 });
    const smallest = lists.filter((q) => Date.parse(q.get("received_before")!) - Date.parse(q.get("received_after")!) <= 1000);
    const pages = smallest.map((q) => q.get("starting_after")).slice(-3);
    expect(pages[0]).toBeNull();
    expect(pages.slice(1).every((c) => c && /^rem_\d{4}$/.test(c))).toBe(true);
    const n = db.inserts.length;
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(250);
    expect(db.inserts).toEqual(all.slice(0, n).map((m) => m.id));
    expect(db.cursor).toBe(iso(Date.parse(all[n].received_at) - 1000));
  });

  it("never skips mail across runs: crowded days are halved, deleted mail stays deleted", async () => {
    // 1200 messages: 700 in one day, 500 over ten days, all in Bird's 30 days.
    const all = [...burst("rem_a", 500, "2026-09-20T00:00:00Z", 30 * 60_000), ...burst("rem_b", 700, "2026-10-10T00:00:00Z", 60_000)];
    const db = mailbox(null);
    db.deleted.add("rem_b_0005");
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\?/, birdList(all)],
      [/\/body$/, () => (vi.setSystemTime(Date.now() + 20), json({ html: null, text: "x" }))],
    ];
    let runs = 0;
    for (; runs < 60; runs++) {
      const r = await syncInbound({ budgetMs: 2_000 });
      expect(r.error).toBeUndefined();
      if (!r.ingested && db.cursor && Date.parse(db.cursor) >= Date.parse("2026-10-15T12:00:00Z")) break;
    }
    expect(runs).toBeGreaterThan(5); // it really took several budgets
    expect(db.inserts.length).toBe(1199);
    expect(new Set(db.inserts).size).toBe(1199);
    expect(db.stored.has("rem_b_0005")).toBe(false);
    for (const m of all) if (m.id !== "rem_b_0005") expect(db.stored.has(m.id)).toBe(true);
    // The crowded day was listed in halves, never more than 500 at once.
    expect(lists.some((q) => Date.parse(q.get("received_before")!) - Date.parse(q.get("received_after")!) <= DAY / 2)).toBe(true);
  });
});

// ── The webhook endpoint ──────────────────────────────────────────────

function hook(body: string, headers: Record<string, string> = {}) {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", headers });
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
  };
  return Promise.resolve(webhookHandler(req as any, res)).then(() => out);
}

describe("/api/mail-webhook", () => {
  const event = JSON.stringify({ type: "email.received", timestamp: "2026-10-14T12:00:00Z", data: { inbound_message_id: "rem_1", to: [ROBERT] } });
  const signed = (body: string) => {
    const t = String(Math.floor(Date.now() / 1000));
    return { "webhook-id": "msg_1", "webhook-timestamp": t, "webhook-signature": sign("msg_1", t, body) };
  };
  beforeEach(() => {
    process.env.BIRD_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.BIRD_WEBHOOK_SECRET;
  });

  it("is off without a secret", async () => {
    delete process.env.BIRD_WEBHOOK_SECRET;
    expect((await hook(event, signed(event))).status).toBe(503);
  });

  it("refuses an unsigned or badly signed call", async () => {
    expect((await hook(event)).status).toBe(401);
    expect((await hook(event, { ...signed(event), "webhook-signature": "v1,AAAA" })).status).toBe(401);
    expect(birdCalls).toEqual([]);
    expect(sbCalls).toEqual([]);
  });

  it("acknowledges other events without doing anything", async () => {
    const other = JSON.stringify({ type: "email.delivered", data: {} });
    expect(await hook(other, signed(other))).toEqual({ status: 200, json: { ok: true, ignored: true } });
    expect(birdCalls).toEqual([]);
  });

  it("fetches and files a received message", async () => {
    birdRoutes = [
      [/GET \/v1\/email\/inbound-messages\/rem_1$/, () => json(inbound())],
      [/\/body$/, () => json({ html: null, text: "Hi Robert" })],
    ];
    sbRoutes = [
      [/GET app_users/, () => [{ id: U1, mail_address: ROBERT }]],
      [/POST mail_messages/, (c) => c.body.map(() => ({ id: "r" }))],
    ];
    const r = await hook(event, signed(event));
    expect(r).toEqual({ status: 200, json: { ok: true, ingested: 1 } });
    const ins = sbCalls.find((c) => c.method === "POST")!;
    expect(ins.body[0]).toMatchObject({ user_id: U1, dedupe_key: `in:rem_1:${U1}`, text_body: "Hi Robert", occurred_at: "2026-10-14T12:00:00Z" });
  });

  it("answers 500 so Bird retries when storing fails", async () => {
    birdRoutes = [[/GET \/v1\/email\/inbound-messages\/rem_1$/, () => json({ error: { message: "down" } }, 503)]];
    expect((await hook(event, signed(event))).status).toBe(500);
  });
});

// ── The mail endpoint ─────────────────────────────────────────────────

describe("/api/mail", () => {
  it("needs a session", async () => {
    me = null;
    expect(await call("GET", { query: { view: "count" } })).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("lets an email-only user in", async () => {
    me = { id: U2, name: "Claire Burton", role: "email", status: "approved", mail_address: CLAIRE };
    unreadTotal = 4;
    const r = await call("GET", { query: { view: "count" } });
    expect(r).toEqual({ status: 200, json: { unread: 4, otherUnread: 0, address: CLAIRE, aliases: [], canSeeOther: false } });
    expect(currentUserMock).toHaveBeenCalledWith(expect.anything(), { allowEmailOnly: true });
    expect(sbCalls.filter((c) => c.method === "COUNT").map((c) => c.path)).toEqual([`mail_messages?user_id=eq.${U2}&folder=eq.inbox&read_at=is.null&select=created_at&limit=1`]);
  });

  it("never picks an address itself: none until an admin gives one, and no sending", async () => {
    // A name the user typed (complete-profile) must not claim robert@ or accounting@.
    me = { id: U2, name: "Accounting", role: "email", status: "approved", mail_address: null };
    const r = await call("GET", { query: { view: "count" } });
    expect(r).toEqual({ status: 200, json: { unread: 0, otherUnread: 0, address: null, aliases: [], canSeeOther: false } });
    const sent = await call("POST", { body: { action: "send", sendId: SEND_ID, to: ["jane@example.com"], subject: "Hi", text: "Hi" } });
    expect(sent).toEqual({ status: 400, json: { error: "no_address", message: "You don't have an address yet. Ask an admin." } });
    expect(sbCalls.some((c) => c.path.startsWith("app_users") || c.path.startsWith("mail_sends"))).toBe(false);
    expect(birdCalls).toEqual([]);
  });

  it("counts the catch-all for admins and passes on a sync problem", async () => {
    me = owner;
    unreadTotal = 2;
    sbRoutes = [[/GET mail_sync/, () => [{ synced_at: "2026-10-14T12:00:00Z", error: "Bird refused (403): the API key can't read received mail" }]]];
    const r = await call("GET", { query: { view: "count" } });
    expect(r.json).toEqual({ unread: 2, otherUnread: 2, address: ROBERT, aliases: [], canSeeOther: true, sync: { error: "Bird refused (403): the API key can't read received mail" } });
    expect(sbCalls.some((c) => c.method === "COUNT" && c.path.startsWith("mail_messages?user_id=is.null&folder=eq.inbox&read_at=is.null"))).toBe(true);
  });

  it("lists only the caller's mail, newest first, with paging", async () => {
    sbRoutes = [
      [/GET mail_messages\?.*starred_at=not\.is\.null/, () => []],
      [/GET mail_messages\?/, () => [row(), row({ id: "m2" }), row({ id: "m3" })]],
    ];
    const r = await call("GET", { query: { view: "list", folder: "inbox", limit: "2", before: "2026-10-15T00:00:00.123456+00:00" } });
    expect(r.status).toBe(200);
    expect(r.json.hasMore).toBe(true);
    expect(r.json.messages.map((m: any) => m.id)).toEqual([MSG, "m2"]);
    // The pinned (starred) ids are asked for first, so the dated list can leave them out; none here.
    expect(sbCalls[0].path).toContain("starred_at=not.is.null");
    // The time goes through exactly as given (microseconds kept), not re-parsed into milliseconds.
    const q = sbCalls[1].path;
    expect(q).toMatch(new RegExp(`^mail_messages\\?user_id=eq\\.${U1}&folder=eq\\.inbox&and=\\(occurred_at\\.lt\\."2026-10-15T00:00:00\\.123456\\+00:00"\\)&select=`));
    expect(q).toContain("order=occurred_at.desc,id.desc&limit=3");
    expect(q).not.toContain("html_body");
    for (const bad of <Record<string, string>[]>[{ before: "yesterday" }, { before: '2026-10-15T00:00:00Z",id.gt.(' }, { beforeId: MSG }, { before: "2026-10-15T00:00:00Z", beforeId: "x" }]) {
      expect(await call("GET", { query: { view: "list", ...bad } })).toEqual({ status: 400, json: { error: "bad_before" } });
    }
  });

  it("narrows a folder to unread or starred mail", async () => {
    sbRoutes = [[/GET mail_messages\?/, () => [row()]]];
    expect((await call("GET", { query: { view: "list", filter: "unread" } })).status).toBe(200);
    expect(sbCalls[0].path).toMatch(new RegExp(`^mail_messages\\?user_id=eq\\.${U1}&folder=eq\\.inbox&read_at=is\\.null&select=`));
    sbCalls.length = 0;
    expect((await call("GET", { query: { view: "list", folder: "archive", filter: "starred" } })).status).toBe(200);
    expect(sbCalls[0].path).toMatch(new RegExp(`^mail_messages\\?user_id=eq\\.${U1}&folder=eq\\.archive&starred_at=not\\.is\\.null&select=`));
    expect(sbCalls[0].path).toContain("starred_at");
    expect(await call("GET", { query: { view: "list", filter: "flagged" } })).toEqual({ status: 400, json: { error: "bad_filter" } });
  });

  it("searches subject, sender, summary and text across every folder", async () => {
    sbRoutes = [[/GET mail_messages\?/, () => [row()]]];
    expect((await call("GET", { query: { view: "list", folder: "archive", q: "Fourton, (SOW)" } })).status).toBe(200);
    const q = sbCalls[0].path;
    // Scope, not folder: the search covers everything the caller may see.
    expect(q).toMatch(new RegExp(`^mail_messages\\?user_id=eq\\.${U1}&and=\\(or\\(subject\\.ilike\\."\\*Fourton, \\(SOW\\)\\*"`));
    expect(q).toContain('text_body.ilike."*Fourton, (SOW)*")');
    expect(q).not.toContain("folder=eq.archive");
    // Paging and search share one and=(…).
    sbCalls.length = 0;
    await call("GET", { query: { view: "list", q: "sow", before: "2026-10-15T00:00:00Z", beforeId: MSG } });
    expect(sbCalls[0].path).toMatch(/&and=\(or\(occurred_at\.lt\."2026-10-15T00:00:00Z",and\(occurred_at\.eq\."2026-10-15T00:00:00Z",id\.lt\.[-0-9a-f]+\)\),or\(subject\.ilike\."\*sow\*"/);
    // Wildcards and quotes in the term can't change the query's shape.
    expect(searchCondition('a*b%c"d\\e')).toContain(encodeURIComponent('"*a b c\\"d\\\\e*"'));
    expect(searchCondition("   ")).toBe("");
  });

  it("stars and unstars within the caller's scope", async () => {
    const r = await call("POST", { body: { action: "star", ids: [MSG], starred: true } });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(sbCalls[0]).toMatchObject({ method: "PATCH", path: `mail_messages?id=in.(${MSG})&user_id=eq.${U1}` });
    expect(typeof sbCalls[0].body.starred_at).toBe("string");
    sbCalls.length = 0;
    await call("POST", { body: { action: "star", ids: [MSG], starred: false } });
    expect(sbCalls[0].body).toEqual({ starred_at: null });
    expect((await call("POST", { body: { action: "star", ids: [MSG], starred: "yes" } })).status).toBe(400);
  });

  it("pins starred mail above the rest, on the first page only", async () => {
    sbRoutes = [
      [/GET mail_messages\?.*starred_at=not\.is\.null/, () => [row({ id: "s1", starred_at: "2026-10-01T00:00:00Z" })]],
      [/GET mail_messages\?/, () => [row()]],
    ];
    const r = await call("GET", { query: { view: "list", folder: "inbox" } });
    expect(r.json.pinned.map((m: any) => m.id)).toEqual(["s1"]);
    expect(r.json.messages.map((m: any) => m.id)).toEqual([MSG]);
    // The dated list leaves out exactly the pinned ones (so a 101st starred message still shows, by date).
    expect(sbCalls[1].path).toContain("and=(id.not.in.(s1))");
    // A narrowed list or a search pins nothing.
    sbCalls.length = 0;
    const unread = await call("GET", { query: { view: "list", filter: "unread" } });
    expect(unread.json).not.toHaveProperty("pinned");
    expect(sbCalls).toHaveLength(1);
  });

  it("pins each Active conversation with a starred message, and keeps it out of the rest", async () => {
    sbRoutes = [
      [/GET mail_messages\?.*select=thread_key&/, () => [{ thread_key: "<a,b@x>" }]],
      [/GET mail_messages\?.*thread_key=in\./, () => [row({ id: "head", thread_key: "<a,b@x>", thread_at: "2026-10-20T00:00:00Z" }), row({ id: "older", thread_key: "<a,b@x>" })]],
      [/GET mail_messages\?/, () => [row({ id: "other", thread_key: "<c@x>", thread_at: "2026-10-19T00:00:00Z" })]],
    ];
    const r = await call("GET", { query: { view: "list", folder: "active" } });
    expect(r.json.pinned).toEqual([expect.objectContaining({ id: "head", starred: true })]);
    expect(r.json.messages.map((m: any) => m.id)).toEqual(["other"]);
    expect(sbCalls.some((c) => c.path.includes('and=(or(thread_key.is.null,thread_key.not.in.("<a,b@x>")))'))).toBe(true);
    // Archived conversations stay out of Active.
    expect(sbCalls.every((c) => c.path.includes("active_hidden=is.false"))).toBe(true);
  });

  it("shows an Active conversation unread while any message in it is", async () => {
    sbRoutes = [
      [/GET mail_messages\?.*select=thread_key&/, () => []],
      [/GET mail_messages\?.*read_at=is\.null/, () => [{ thread_key: "<c@x>" }]],
      [/GET mail_messages\?/, () => [row({ id: "newest", thread_key: "<c@x>", read_at: "2026-10-20T00:00:00Z" }), row({ id: "solo", thread_key: "<d@x>", read_at: "2026-10-20T00:00:00Z" })]],
    ];
    const r = await call("GET", { query: { view: "list", folder: "active" } });
    expect(r.json.messages.map((m: any) => [m.id, m.read])).toEqual([["newest", false], ["solo", true]]);
  });

  it("archives whole conversations from Active, and brings them back", async () => {
    sbRoutes = [
      [/GET mail_messages\?id=in\..*select=thread_key/, () => [{ thread_key: "<a@x>" }]],
      [/GET mail_messages\?thread_key=in\..*select=id/, () => [{ id: MSG }, { id: "22222222-2222-4222-8222-222222222222" }]],
    ];
    await call("POST", { body: { action: "move", ids: [MSG], folder: "archive", conversation: true } });
    const patches = sbCalls.filter((c) => c.method === "PATCH");
    expect(patches[0]).toMatchObject({ path: `mail_messages?thread_key=in.("<a@x>")&direction=eq.in&folder=eq.inbox&user_id=eq.${U1}`, body: { folder: "archive" } });
    expect(patches[1]).toMatchObject({ path: `mail_messages?thread_key=in.("<a@x>")&user_id=eq.${U1}`, body: { active_hidden: true } });
    // Back to the inbox: in Active again.
    sbCalls.length = 0;
    await call("POST", { body: { action: "move", ids: [MSG], folder: "inbox" } });
    expect(sbCalls.filter((c) => c.method === "PATCH").at(-1)).toMatchObject({ body: { active_hidden: false } });
  });

  it("unstars a whole conversation from Active", async () => {
    sbRoutes = [[/GET mail_messages\?id=in/, () => [{ thread_key: "<a@x>" }]]];
    await call("POST", { body: { action: "star", ids: [MSG], starred: false, conversation: true } });
    expect(sbCalls.at(-1)).toMatchObject({ method: "PATCH", path: `mail_messages?thread_key=in.("<a@x>")&starred_at=not.is.null&user_id=eq.${U1}`, body: { starred_at: null } });
  });

  it("keeps an admin's whole-conversation actions off the catch-all copy", async () => {
    me = owner;
    sbRoutes = [
      [/GET mail_messages\?id=in\..*select=thread_key/, () => [{ thread_key: "<a@x>" }]],
      [/GET mail_messages\?id=eq\./, () => [row({ thread_key: "<a@x>", read_at: "2026-10-14T13:00:00Z" })]],
      [/GET mail_messages\?thread_key=in\..*select=id/, () => [{ id: MSG }]],
    ];
    await call("POST", { body: { action: "move", ids: [MSG], folder: "archive", conversation: true } });
    await call("POST", { body: { action: "move", ids: [MSG], folder: "inbox", conversation: true } });
    await call("POST", { body: { action: "star", ids: [MSG], starred: false, conversation: true } });
    await call("POST", { body: { action: "delete", ids: [MSG], conversation: true } });
    await call("GET", { query: { view: "message", id: MSG, conversation: "1" } });
    const wide = sbCalls.filter((c) => c.path.includes("thread_key=in.") || /select=thread_key$/.test(c.path));
    expect(wide.length).toBeGreaterThanOrEqual(8);
    for (const c of wide) {
      expect(c.path).toContain(`user_id=eq.${U1}`);
      expect(c.path).not.toContain("user_id.is.null");
    }
  });

  it("keeps out of Active's dated list only the starred conversations it pins", async () => {
    sbRoutes = [
      [/GET mail_messages\?.*select=thread_key&/, () => [{ thread_key: "<a@x>" }, { thread_key: "<b@x>" }]],
      // The bounded read came back full of <a@x>: <b@x> isn't in it, so it stays in the dated list.
      [/GET mail_messages\?.*thread_key=in\./, () => [row({ id: "head", thread_key: "<a@x>" })]],
      [/GET mail_messages\?/, () => [row({ id: "b-head", thread_key: "<b@x>" })]],
    ];
    for (const query of <Record<string, string>[]>[{}, { before: "2026-10-21T09:00:00Z", beforeKey: "<z@x>" }]) {
      sbCalls.length = 0;
      const r = await call("GET", { query: { view: "list", folder: "active", ...query } });
      expect(r.json.messages.map((m: any) => m.id)).toEqual(["b-head"]);
      expect(sbCalls.some((c) => c.path.includes('or(thread_key.is.null,thread_key.not.in.("<a@x>"))'))).toBe(true);
    }
  });

  it("pages on (time, id), so mail sharing a timestamp isn't skipped", async () => {
    const at = "2026-10-14T12:00:00+00:00";
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    // A burst received in the same second, between an older and a newer message.
    const db = [row({ id: id(9), occurred_at: "2026-10-14T12:00:01+00:00" }), ...[1, 2, 3, 4, 5].map((n) => row({ id: id(n), occurred_at: at })), row({ id: id(7), occurred_at: "2026-10-14T11:59:59+00:00" })];
    sbRoutes = [
      [/GET mail_messages\?.*starred_at=not\.is\.null/, () => []],
      [
        /GET mail_messages\?/,
        (c) => {
          const page = /&and=\(or\(occurred_at\.lt\."([^"]+)",and\(occurred_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)\)\)/.exec(c.path);
          const t = (r: MailRow) => Date.parse(r.occurred_at!);
          return db
            .filter((r) => !page || t(r) < Date.parse(page[1]) || (t(r) === Date.parse(page[2]) && r.id < page[3]))
            .sort((a, b) => t(b) - t(a) || (a.id < b.id ? 1 : -1))
            .slice(0, Number(/limit=(\d+)/.exec(c.path)![1]));
        },
      ],
    ];
    const seen: string[] = [];
    let next: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      const r = await call("GET", { query: { view: "list", limit: "2", ...next } });
      seen.push(...r.json.messages.map((m: any) => m.id));
      if (!r.json.hasMore) break;
      const last = r.json.messages.at(-1);
      next = { before: last.occurredAt, beforeId: last.id };
    }
    expect(seen).toEqual([id(9), id(5), id(4), id(3), id(2), id(1), id(7)]);

    // An admin's archive already has an or=(…) scope: the page goes in and=(…), so the two don't clash.
    me = owner;
    sbCalls.length = 0;
    await call("GET", { query: { view: "list", folder: "archive", before: at, beforeId: id(3) } });
    const q = sbCalls[1].path;
    expect(q.match(/[?&]or=/g)).toHaveLength(1);
    expect(q).toContain(`or=(user_id.eq.${U1},user_id.is.null)&folder=eq.archive&and=(or(occurred_at.lt."${at}",and(occurred_at.eq."${at}",id.lt.${id(3)})))&`);
  });

  it("keeps the catch-all folder to owners and admins", async () => {
    expect(await call("GET", { query: { view: "list", folder: "other" } })).toEqual({ status: 403, json: { error: "forbidden" } });
    expect(sbCalls).toEqual([]);
    me = owner;
    expect((await call("GET", { query: { view: "list", folder: "other" } })).status).toBe(200);
    expect(sbCalls[0].path).toMatch(/^mail_messages\?user_id=is\.null&folder=eq\.inbox&/);
  });

  it("opens a message and marks it read, but not someone else's", async () => {
    sbRoutes = [[/GET mail_messages\?id=eq\./, () => [row({ user_id: U2 })]]];
    expect(await call("GET", { query: { view: "message", id: MSG } })).toEqual({ status: 404, json: { error: "not_found" } });
    expect(sbCalls[0].path).toContain(`user_id=eq.${U1}`);
    expect(sbCalls.some((c) => c.method === "PATCH")).toBe(false);

    sbRoutes = [[/GET mail_messages\?id=eq\./, () => [row()]]];
    const r = await call("GET", { query: { view: "message", id: MSG } });
    expect(r.status).toBe(200);
    expect(r.json.message).toMatchObject({ id: MSG, read: true, text: "Hi Robert", unverifiedSender: false });
    expect(sbCalls.find((c) => c.method === "PATCH")).toMatchObject({ path: `mail_messages?id=eq.${MSG}` });
  });

  it("signs a short-lived download link for an attachment", async () => {
    sbRoutes = [[/GET mail_messages\?id=eq\./, () => [row({ attachments: [{ id: "rea_1", filename: "a b.pdf", contentType: "application/pdf", size: 3, path: "in/rem_1/rea_1" }] })]]];
    storageRoutes = [[/POST \/object\/sign\/mail\/in\/rem_1\/rea_1$/, () => json({ signedURL: "/object/sign/mail/in/rem_1/rea_1?token=t" })]];
    const r = await call("GET", { query: { view: "attachment", id: MSG, att: "rea_1" } });
    expect(r.json).toEqual({ url: "https://sb.test/storage/v1/object/sign/mail/in/rem_1/rea_1?token=t&download=a%20b.pdf" });
    expect(JSON.parse(storageCalls[0].body as string)).toEqual({ expiresIn: 300 });
    expect((await call("GET", { query: { view: "attachment", id: MSG, att: "rea_x" } })).status).toBe(404);
  });

  it("moves only received mail, within the caller's scope", async () => {
    const r = await call("POST", { body: { action: "move", ids: [MSG], folder: "archive" } });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(sbCalls.find((c) => c.method === "PATCH")).toMatchObject({ method: "PATCH", path: `mail_messages?id=in.(${MSG})&direction=eq.in&user_id=eq.${U1}`, body: { folder: "archive" } });
    expect((await call("POST", { body: { action: "move", ids: [MSG], folder: "sent" } })).status).toBe(400);
    expect((await call("POST", { body: { action: "read", ids: ["x"], read: true } })).status).toBe(400);
  });

  it("deletes for good, and a shared file only when nothing else uses it", async () => {
    me = owner;
    const SENT = "55555555-5555-4555-8555-555555555555";
    sbRoutes = [
      [/GET mail_messages\?id=in\./, () => [
        row({ attachments: [{ id: "rea_1", filename: "a", contentType: "x/y", size: 1, path: "in/rem_1/rea_1" }] }),
        row({ id: SENT, direction: "out", folder: "sent", dedupe_key: "out:em_1", bird_id: "em_1", attachments: [{ id: "a0", filename: "b", contentType: "x/y", size: 1, path: "out/m/0-b" }] }),
      ]],
      [/GET mail_messages\?attachments=cs\.\[\{"path":"in\/rem_1\/rea_1"\}\]/, () => [{ id: "copy" }]],
    ];
    expect(await call("POST", { body: { action: "delete", ids: [MSG, SENT] } })).toEqual({ status: 200, json: { ok: true } });
    expect(sbCalls[0].path).toContain("&select=id,attachments,dedupe_key,bird_id,direction");
    const del = sbCalls.findIndex((c) => c.method === "DELETE");
    expect(sbCalls[del].path).toBe(`mail_messages?id=in.(${MSG},${SENT})&or=(user_id.eq.${U1},user_id.is.null)`);
    // A tombstone for the received copy only, written first, so the sync can't bring it back.
    const tomb = sbCalls.findIndex((c) => c.method === "POST" && c.path.startsWith("mail_deleted"));
    expect(sbCalls[tomb]).toMatchObject({ path: "mail_deleted?on_conflict=dedupe_key", body: [{ dedupe_key: `in:rem_1:${U1}`, bird_id: "rem_1" }] });
    expect(sbCalls[tomb].prefer).toContain("resolution=ignore-duplicates");
    expect(tomb).toBeLessThan(del);
    expect(storageCalls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/object/mail/out/m/0-b"]);
  });

  describe("extra addresses", () => {
    const ACCOUNTS = "accounting@burtonfamilyoffice.com";
    let aliases: { address: string; user_id: string }[] = [];
    beforeEach(() => {
      aliases = [];
      sbRoutes = [
        [/GET mail_aliases\?user_id=eq\./, () => aliases.map((a) => ({ address: a.address }))],
        [/GET app_users\?mail_address=eq\./, (c) => (c.path.includes("claire") ? [{ id: U2 }] : [])],
        [/POST mail_aliases$/, (c) => {
          aliases.push(...c.body);
          return null;
        }],
        [/DELETE mail_aliases\?/, (c) => {
          aliases = aliases.filter((a) => !decodeURIComponent(c.path).includes(a.address));
          return null;
        }],
      ];
    });

    it("lets an owner or admin add and remove addresses on their own account", async () => {
      me = owner;
      expect(await call("POST", { body: { action: "alias-add", address: "accounting" } })).toEqual({ status: 200, json: { aliases: [ACCOUNTS] } });
      expect(aliases).toEqual([{ address: ACCOUNTS, user_id: U1 }]);
      expect((await call("GET", { query: { view: "count" } })).json.aliases).toEqual([ACCOUNTS]);
      expect(await call("POST", { body: { action: "alias-remove", address: ACCOUNTS } })).toEqual({ status: 200, json: { aliases: [] } });
    });

    it("shows one mailbox at a time: mail to that address, or sent from it", async () => {
      me = owner;
      aliases = [{ address: ACCOUNTS, user_id: U1 }];
      sbRoutes.push([/GET mail_messages\?/, () => []]);
      expect((await call("GET", { query: { view: "list", to: "Accounting@BurtonFamilyOffice.com" } })).status).toBe(200);
      const inbox = sbCalls.filter((c) => c.method === "GET" && c.path.startsWith("mail_messages?")).pop()!.path;
      expect(decodeURIComponent(inbox)).toContain(`delivered_to.eq."${ACCOUNTS}"`);
      await call("GET", { query: { view: "list", folder: "sent", to: ACCOUNTS } });
      expect(decodeURIComponent(sbCalls.filter((c) => c.path.startsWith("mail_messages?")).pop()!.path)).toContain(`from_email.eq."${ACCOUNTS}"`);
      // The main address also takes older mail with no delivered-to.
      await call("GET", { query: { view: "list", to: ROBERT } });
      expect(decodeURIComponent(sbCalls.filter((c) => c.path.startsWith("mail_messages?")).pop()!.path)).toContain("delivered_to.is.null");
      // Someone else's address isn't a mailbox of mine.
      expect((await call("GET", { query: { view: "list", to: "claire@burtonfamilyoffice.com" } })).json).toEqual({ error: "bad_mailbox" });
    });

    it("refuses someone else's address, system addresses, other domains, and members", async () => {
      me = owner;
      expect(await call("POST", { body: { action: "alias-add", address: "claire" } })).toMatchObject({ status: 409, json: { error: "address_taken" } });
      expect(await call("POST", { body: { action: "alias-add", address: "postmaster" } })).toMatchObject({ status: 400, json: { error: "invalid_mail_address" } });
      expect(await call("POST", { body: { action: "alias-add", address: "me@gmail.com" } })).toMatchObject({ status: 400, json: { error: "invalid_mail_address" } });
      expect(await call("POST", { body: { action: "alias-add", address: ROBERT } })).toMatchObject({ status: 409, json: { error: "address_taken" } });
      me = robert;
      expect(await call("POST", { body: { action: "alias-add", address: "accounting" } })).toMatchObject({ status: 403 });
      expect(aliases).toEqual([]);
    });
  });

  describe("send", () => {
    const send = (over: Record<string, unknown> = {}) =>
      call("POST", { body: { action: "send", sendId: SEND_ID, to: ["Jane <Jane@Example.com>"], subject: "Re: Hello", text: "Thanks!\n\n> Hi Robert", ...over } });

    beforeEach(() => {
      sbRoutes = [
        [/GET mail_messages\?id=eq\./, () => [row({ attachments: [{ id: "rea_1", filename: "a.pdf", contentType: "application/pdf", size: 3, path: "in/rem_1/rea_1" }] })]],
        [/POST mail_messages\?on_conflict=dedupe_key/, (c) => [{ ...c.body, created_at: c.body.occurred_at }]],
        [/POST mail_sends\?/, (c) => [c.body]],
      ];
      birdRoutes = [[/POST \/v1\/email\/messages$/, () => json({ id: "em_1", status: "accepted" }, 202)]];
    });
    const storedCopy = () => sbCalls.find((c) => c.method === "POST" && c.path.startsWith("mail_messages"));
    const reservations = () => sbCalls.filter((c) => c.method === "POST" && c.path.startsWith("mail_sends"));

    it("sends from one of the caller's own addresses, and only theirs", async () => {
      const ACCOUNTS = "accounting@burtonfamilyoffice.com";
      sbRoutes.unshift([/GET mail_aliases\?user_id=eq\./, () => [{ address: ACCOUNTS }]]);
      expect(await send({ from: "claire@burtonfamilyoffice.com" })).toMatchObject({ status: 400, json: { error: "bad_from" } });
      expect(birdCalls).toEqual([]);
      expect((await send({ from: "Accounting@BurtonFamilyOffice.com" })).status).toBe(200);
      const sent = birdCalls.find((c) => c.path.endsWith("/v1/email/messages"))!.body;
      expect((typeof sent === "string" ? JSON.parse(sent) : sent).from).toEqual({ email: ACCOUNTS, name: "Robert Burton" });
      expect(storedCopy()!.body).toMatchObject({ from_email: ACCOUNTS });
    });

    it("refuses bad recipients and too many, before calling Bird", async () => {
      expect(await send({ to: ["jane@"] })).toMatchObject({ status: 400, json: { error: "bad_address", message: expect.stringContaining("jane@") } });
      const many = Array.from({ length: 30 }, (_, i) => `p${i}@example.com`);
      expect(await send({ to: many, cc: many.map((a) => a.replace("p", "q")) })).toMatchObject({ status: 400, json: { error: "too_many_recipients" } });
      expect(birdCalls).toEqual([]);
    });

    it("refuses past 200 sends a day, counted from a ledger deleting mail can't touch", async () => {
      unreadTotal = 201; // this send's own reservation included
      expect(await send()).toMatchObject({ status: 400, json: { error: "too_many_sends" } });
      const [held] = reservations();
      expect(held).toMatchObject({ path: "mail_sends?on_conflict=user_id,send_id", body: { user_id: U1, send_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) } });
      expect(held.prefer).toContain("resolution=ignore-duplicates");
      // Reserved before counting, so parallel sends can't all slip under the limit.
      expect(sbCalls.indexOf(held)).toBeLessThan(sbCalls.findIndex((c) => c.method === "COUNT"));
      expect(sbCalls.find((c) => c.method === "COUNT")!.path).toMatch(new RegExp(`^mail_sends\\?user_id=eq\\.${U1}&created_at=gte\\.`));
      // The refused send gives its place back.
      expect(sbCalls.find((c) => c.method === "DELETE")!.path).toBe(`mail_sends?user_id=eq.${U1}&send_id=eq.${held.body.send_id}`);
      expect(birdCalls).toEqual([]);

      sbCalls.length = 0;
      unreadTotal = 200;
      expect((await send()).status).toBe(200);
      expect(sbCalls.some((c) => c.method === "DELETE")).toBe(false);
    });

    it("a retried send is one Bird request and one place in the limit; an edited one is new", async () => {
      await send();
      await send();
      await send({ subject: "Re: Hello (fixed)" });
      const keys = birdCalls.map((c) => c.headers!["Idempotency-Key"]);
      const held = reservations().map((c) => c.body.send_id);
      expect(keys[0]).toBe(keys[1]);
      expect(held[0]).toBe(held[1]);
      expect(keys[2]).not.toBe(keys[0]);
      expect(held[2]).not.toBe(held[0]);
      expect(keys[2]).toMatch(new RegExp(`^mail-${U1}-${SEND_ID}-[0-9a-f]{16}$`));
    });

    it("replies in thread from the user's own address and keeps the sent copy", async () => {
      const r = await send({ replyToId: MSG });
      expect(r.status).toBe(200);
      const [sent] = birdCalls;
      expect(sent.headers!["Idempotency-Key"]).toMatch(new RegExp(`^mail-${U1}-${SEND_ID}-[0-9a-f]{16}$`));
      expect(sent.body).toMatchObject({
        from: { email: ROBERT, name: "Robert Burton" },
        to: ["jane@example.com"],
        subject: "Re: Hello",
        text: "Thanks!\n\n> Hi Robert",
        headers: { "In-Reply-To": "<orig@example.com>", References: "<root@example.com> <orig@example.com>" },
        category: "transactional",
        track_opens: false,
        track_clicks: false,
      });
      expect(sent.body.html).toMatch(/Thanks!<br><br><blockquote[^>]*>Hi Robert<\/blockquote>/);
      expect(sent.body.attachments).toBeUndefined();
      const stored = storedCopy()!;
      expect(stored.prefer).toContain("resolution=ignore-duplicates");
      expect(stored.body).toMatchObject({
        user_id: U1, dedupe_key: "out:em_1", folder: "sent", direction: "out", bird_id: "em_1", status: "accepted",
        in_reply_to: "<orig@example.com>", references_ids: ["<root@example.com>", "<orig@example.com>"], to_addrs: [{ email: "jane@example.com" }],
      });
      expect(stored.body.read_at).toBeTruthy();
      expect(r.json.message).toMatchObject({ folder: "sent", direction: "out", read: true, subject: "Re: Hello", to: [{ email: "jane@example.com" }] });
    });

    it("forwards the original's files and keeps copies of what was sent", async () => {
      storageRoutes = [[/GET \/object\/mail\/in\/rem_1\/rea_1$/, () => new Response(new Uint8Array([7, 8, 9]))]];
      const r = await send({ forwardId: MSG, subject: "Fwd: Hello", attachments: [{ filename: "note.txt", contentType: "text/plain", data: Buffer.from("hi").toString("base64") }] });
      expect(r.status).toBe(200);
      expect(birdCalls[0].body.headers).toBeUndefined();
      expect(birdCalls[0].body.attachments).toEqual([
        { filename: "a.pdf", content: Buffer.from([7, 8, 9]).toString("base64"), content_type: "application/pdf" },
        { filename: "note.txt", content: Buffer.from("hi").toString("base64"), content_type: "text/plain" },
      ]);
      const stored = storedCopy()!.body;
      expect(stored.attachments).toEqual([
        { id: "a0", filename: "a.pdf", contentType: "application/pdf", size: 3, path: `out/${stored.id}/0-a.pdf` },
        { id: "a1", filename: "note.txt", contentType: "text/plain", size: 2, path: `out/${stored.id}/1-note.txt` },
      ]);
      expect(storageCalls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([`/object/mail/out/${stored.id}/0-a.pdf`, `/object/mail/out/${stored.id}/1-note.txt`]);
    });

    it("won't reply to a message that isn't the caller's", async () => {
      sbRoutes = [[/GET mail_messages\?id=eq\./, () => [row({ user_id: U2 })]]];
      expect(await send({ replyToId: MSG })).toMatchObject({ status: 400, json: { error: "not_found" } });
      expect(birdCalls).toEqual([]);
    });

    it("returns the first copy when a send is retried", async () => {
      sbRoutes.unshift([/GET mail_messages\?dedupe_key=eq\.out:em_1&user_id=eq\./, () => [row({ id: "first", folder: "sent", direction: "out", read_at: "2026-10-14T12:00:00Z" })]]);
      const r = await send();
      expect(r.json.message).toMatchObject({ id: "first", folder: "sent" });
      expect(storedCopy()).toBeUndefined();
    });

    it("asks again under a fresh key when Bird replays an earlier refusal", async () => {
      const keys: string[] = [];
      let n = 0;
      birdRoutes = [
        [
          /POST \/v1\/email\/messages$/,
          (c: Call) => {
            keys.push(String((c as { headers?: Record<string, string> }).headers?.["Idempotency-Key"] ?? ""));
            return n++ === 0
              ? new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429, headers: { "idempotency-replay": "true" } })
              : json({ id: "em_retry", status: "accepted" }, 202);
          },
        ],
      ];
      const out = await send();
      expect(out.status).toBe(200);
      expect(keys).toHaveLength(2);
      expect(keys[1].startsWith(`${keys[0]}-`)).toBe(true);
    });

    it("reports Bird's refusal as send_failed", async () => {
      birdRoutes = [[/POST \/v1\/email\/messages$/, () => json({ error: { type: "validation", code: "E04006", message: "Domain not verified" } }, 422)]];
      expect(await send()).toEqual({ status: 502, json: { error: "send_failed", message: "Bird refused (422): Domain not verified" } });
      expect(storedCopy()).toBeUndefined();
      // The mail may have gone out, so its place in the limit is kept.
      expect(reservations()).toHaveLength(1);
      expect(sbCalls.some((c) => c.method === "DELETE")).toBe(false);
    });
  });
});
