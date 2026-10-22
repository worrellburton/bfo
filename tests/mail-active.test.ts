import { describe, expect, it } from "vitest";
import { activeAfter, conversationHeads, folderFilter, toSummary, type SummaryRow } from "../lib/mail";
import { parsePhoto, PHOTO_MAX_BYTES } from "../lib/mail-photo";

const row = (id: string, thread_key: string | null, over: Partial<SummaryRow> = {}): SummaryRow => ({
  id,
  user_id: "u1",
  folder: "inbox",
  direction: "in",
  from_email: "jane@example.com",
  from_name: "Jane",
  to_addrs: [],
  cc_addrs: [],
  subject: "Hi",
  snippet: "",
  occurred_at: "2026-10-20T12:00:00Z",
  created_at: "2026-10-20T12:00:00Z",
  read_at: null,
  starred_at: null,
  attachments: null,
  status: null,
  thread_key,
  thread_at: "2026-10-21T09:00:00+00:00",
  ...over,
});

describe("Active", () => {
  it("is inbox and sent together, for the caller only", () => {
    expect(folderFilter("active", "u1", true)).toBe("user_id=eq.u1&folder=in.(inbox,sent)");
  });

  it("keeps each conversation's newest message, in order", () => {
    // ACTIVE_ORDER brings a conversation's rows together, newest first.
    const rows = [row("reply", "<a@x>", { direction: "out", folder: "sent" }), row("first", "<a@x>"), row("b", "<b@x>"), row("c", null)];
    const { heads, more } = conversationHeads(rows, 10, 40);
    expect(heads.map((r) => r.id)).toEqual(["reply", "b", "c"]);
    expect(more).toBe(false);
  });

  it("stops at the page size, and says there's more", () => {
    const rows = [row("a", "1"), row("b", "2"), row("c", "3")];
    expect(conversationHeads(rows, 2, 40)).toEqual({ heads: [rows[0], rows[1]], more: true });
    // A read that came back full may have stopped partway through.
    expect(conversationHeads(rows, 5, 3).more).toBe(true);
  });

  it("pages after the last conversation, with its key quoted", () => {
    const c = decodeURIComponent(activeAfter("2026-10-21T09:00:00+00:00", '<a,b"c@x>'));
    expect(c).toBe('or(thread_at.lt."2026-10-21T09:00:00+00:00",and(thread_at.eq."2026-10-21T09:00:00+00:00",thread_key.gt."<a,b\\"c@x>"))');
  });

  it("hands the conversation to the browser", () => {
    expect(toSummary(row("a", "<a@x>"))).toMatchObject({ threadKey: "<a@x>", threadAt: "2026-10-21T09:00:00+00:00" });
    expect(toSummary(row("a", null))).not.toHaveProperty("threadKey");
  });
});

describe("mail photo", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64");

  it("takes a small JPEG, PNG or WebP", () => {
    expect(parsePhoto(`data:image/jpeg;base64,${jpeg}`)).toMatchObject({ contentType: "image/jpeg", ext: "jpg" });
    expect(parsePhoto(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"))).toMatchObject({ ext: "png" });
    expect(parsePhoto(Buffer.from("RIFF\0\0\0\0WEBPVP8 ").toString("base64"))).toMatchObject({ ext: "webp" });
  });

  it("refuses anything else", () => {
    expect(parsePhoto(undefined)).toMatchObject({ error: "bad_photo" });
    expect(parsePhoto("not base64!")).toMatchObject({ error: "bad_photo" });
    expect(parsePhoto(Buffer.from("<svg onload=alert(1)>").toString("base64"))).toMatchObject({ error: "bad_photo" });
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PHOTO_MAX_BYTES)]).toString("base64");
    expect(parsePhoto(big)).toMatchObject({ error: "photo_too_large" });
  });
});
