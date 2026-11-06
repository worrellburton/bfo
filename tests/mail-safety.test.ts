import { describe, expect, it } from "vitest";
import { figuresChanged, figuresOf, impersonates, isNoReply, mentionsAttachment, paymentRisk, splitQuoted } from "../lib/mail-safety";
import { decodeEntities, tidySnippet } from "../lib/mail-snippet";
import { isHeld, purgeAfter, replyToFrom, actionSummary } from "../lib/mail";

describe("previews", () => {
  it("decodes entities and drops Markdown pictures, keeping a link's words", () => {
    expect(tidySnippet("[Northwind logo with a geometric icon and the text &quot;TECH TALK&quot;.](https://example.com/x?utm=1) This week: rates")).toBe("This week: rates");
    expect(tidySnippet("Read [the agenda](https://example.com/a) before Friday")).toBe("Read the agenda before Friday");
    expect(tidySnippet("![](https://example.com/p.png)Hello &amp; welcome")).toBe("Hello & welcome");
    // A link cut short by the snippet's end.
    expect(tidySnippet("News [Northwind logo with a geo…")).toBe("News");
    expect(decodeEntities("It&#8217;s &lt;b&gt;")).toBe("It’s <b>");
  });

  it("drops invisible preheader padding, bare addresses and a help desk's wrapping", () => {
    expect(tidySnippet("‌ ͏ ‌ ͏ …")).toBe("");
    expect(tidySnippet("Your code is ready ​​­ see https://example.com/long/path")).toBe("Your code is ready see");
    expect(tidySnippet("##- Please type your reply above this line -## Thanks, it's fixed. Delivered by Zendesk")).toBe("Thanks, it's fixed.");
    expect(tidySnippet(tidySnippet("Plain words stay"))).toBe("Plain words stay");
  });
});

describe("payment instructions", () => {
  it("flags wire and bank-change requests in the subject, words or file names", () => {
    expect(paymentRisk({ subject: "Updated wire instructions", text: "" })).toBe(true);
    expect(paymentRisk({ subject: "Invoice", text: "Please note our new bank details below." })).toBe(true);
    expect(paymentRisk({ subject: "Invoice", text: "Routing number 000000000" })).toBe(true);
    expect(paymentRisk({ subject: "Hi", text: "", attachmentNames: ["ACH_form.pdf"] })).toBe(true);
    expect(paymentRisk({ subject: "Lunch on Friday?", text: "The account was a pleasure to work on." })).toBe(false);
  });
});

describe("senders", () => {
  it("spots a display name copied from the office, from outside its domain", () => {
    const office = ["Alex Rivera", "Sam Lee", null];
    expect(impersonates({ name: "Alex Rivera", email: "alex.rivera.office@gmail.com" }, office, "example.com")).toBe(true);
    expect(impersonates({ name: "alex  rivera", email: "x@lookalike.co" }, office, "example.com")).toBe(true);
    expect(impersonates({ name: "Alex Rivera", email: "alex@example.com" }, office, "example.com")).toBe(false);
    expect(impersonates({ name: "Alex", email: "a@gmail.com" }, office, "example.com")).toBe(false);
    expect(impersonates({ name: "Jordan Park", email: "j@gmail.com" }, office, "example.com")).toBe(false);
  });

  it("knows addresses that accept no replies", () => {
    for (const a of ["no-reply@example.com", "noreply-abc123@mail.example.com", "do-not-reply@x.co", "donotreply@x.co", "mailer-daemon@x.co"]) expect(isNoReply(a)).toBe(true);
    for (const a of ["support@example.com", "nora@example.com", "replies@example.com"]) expect(isNoReply(a)).toBe(false);
  });

  it("reads Reply-To from Bird's field or the header block", () => {
    expect(replyToFrom({ reply_to: [{ email: "Help@Example.com", name: "Help" }] }, null)).toEqual([{ email: "help@example.com", name: "Help" }]);
    expect(replyToFrom({ reply_to: "Desk <desk@example.com>" }, null)).toEqual([{ email: "desk@example.com", name: "Desk" }]);
    expect(replyToFrom({}, "From: a@x.com\r\nReply-To: \"Billing, Team\" <billing@example.com>, other@example.com\r\nSubject: hi\r\n\r\nbody")).toEqual([
      { email: "billing@example.com", name: "Billing, Team" },
      { email: "other@example.com" },
    ]);
    expect(replyToFrom({}, "From: a@x.com\r\n\r\nReply-To: not-a-header@x.com")).toEqual([]);
  });
});

describe("figures in a layout pass", () => {
  it("treats a figure written differently as the same figure", () => {
    expect(figuresOf("Pay $1,250.00 by Nov 6, 2026 (invoice 0042)")).toEqual(figuresOf("Pay **$1250** by Nov 6, 2026 — invoice 42"));
    expect(figuresChanged("Wire 12,480.50 to account 4821", "Wire **12,480.50** to account **4821**")).toEqual([]);
  });

  it("names a figure that changed, appeared or went missing", () => {
    expect(figuresChanged("Pay $1,250 by the 6th", "Pay $1,520 by the 6th").sort()).toEqual(["1250", "1520"]);
    expect(figuresChanged("Two payments of 500", "Payments of 500")).toEqual([]);
    expect(figuresChanged("Payments of 500 and 500", "Payments of 500")).toEqual(["500"]);
  });
});

describe("composing", () => {
  it("splits a reply's own words from the quoted thread", () => {
    const html = "<p>Thanks, see below.</p><p>On Fri, Nov 6, 2026 at 9:00 AM, Sam wrote:</p><blockquote><p>Can you send it?</p></blockquote>";
    expect(splitQuoted(html)).toEqual({ own: "<p>Thanks, see below.</p>", quote: "<p>On Fri, Nov 6, 2026 at 9:00 AM, Sam wrote:</p><blockquote><p>Can you send it?</p></blockquote>" });
    expect(splitQuoted("<p>Just words</p>")).toEqual({ own: "<p>Just words</p>", quote: "" });
  });

  it("notices a message that says something is attached", () => {
    expect(mentionsAttachment("", "The statements are attached.")).toBe(true);
    expect(mentionsAttachment("Enclosed: Q3", "")).toBe(true);
    expect(mentionsAttachment("Lunch", "See you then.")).toBe(false);
  });
});

describe("Trash and holds", () => {
  it("goes for good 30 days after it was deleted", () => {
    expect(purgeAfter("2026-11-06T15:00:00.000Z")).toBe("2026-12-06T15:00:00.000Z");
  });

  it("keeps held mail: one message, its mailbox, or all mail (which covers Other)", () => {
    const U = "u1";
    expect(isHeld({ user_id: U, held_at: "2026-11-01T00:00:00Z" }, [])).toBe(true);
    expect(isHeld({ user_id: U, held_at: null }, [{ user_id: U }])).toBe(true);
    expect(isHeld({ user_id: U, held_at: null }, [{ user_id: "u2" }])).toBe(false);
    expect(isHeld({ user_id: null, held_at: null }, [{ user_id: "u2" }])).toBe(false);
    expect(isHeld({ user_id: null, held_at: null }, [{ user_id: null }])).toBe(true);
  });

  it("says what happened in one plain line", () => {
    expect(actionSummary("Moved", [{ subject: "Q3" }], " to Trash")).toBe("Moved “Q3” to Trash");
    expect(actionSummary("Moved", [{ subject: "a" }, { subject: "b" }], " to Trash")).toBe("Moved 2 messages to Trash");
    expect(actionSummary("Restored", [{ subject: "" }])).toBe("Restored “(no subject)”");
  });
});
