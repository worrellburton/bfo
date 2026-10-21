import { describe, expect, it } from "vitest";
import { cleanCompose, composeDocument, composeText, htmlFromPlain } from "../lib/mail-compose";

describe("formatted mail", () => {
  it("keeps paragraphs, lists, bold and links from a paste, and nothing unsafe", () => {
    const pasted =
      '<meta charset="utf-8"><style>p{color:red}</style><div><span style="font-weight:700">Hello,</span></div><div><br></div>' +
      '<p class="x" onclick="evil()">Could you please:</p><ol><li>Forward <i>all</i> mail</li><li>Close it</li></ol>' +
      '<script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://earthclassmail.com">ECM</a><img src="x" onerror="y">';
    expect(cleanCompose(pasted)).toBe(
      '<p><strong>Hello,</strong></p><p>Could you please:</p><ol><li>Forward <em>all</em> mail</li><li>Close it</li></ol>bad <a href="https://earthclassmail.com">ECM</a>'
    );
  });

  it("writes the plain-text part from the same message", () => {
    const html = '<p>Hello,</p><p>Old box:<br>11201 N Tatum Blvd</p><ol><li>Forward mail</li><li>Close it</li></ol><blockquote><p>On Oct 20 they wrote:</p></blockquote><p>See <a href="https://x.com/a">this</a></p>';
    expect(composeText(html)).toBe("Hello,\n\nOld box:\n11201 N Tatum Blvd\n\n1. Forward mail\n2. Close it\n\n> On Oct 20 they wrote:\n\nSee this (https://x.com/a)");
  });

  it("styles what's sent inline, for mail clients", () => {
    const doc = composeDocument("<p>Hi</p><ul><li>One</li></ul>");
    expect(doc).toContain('<p style="margin:0 0 14px">Hi</p><ul style="margin:0 0 14px;padding-left:24px"><li style="margin:0 0 6px">One</li></ul>');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  it("reads plain text as paragraphs, lists and quotes", () => {
    expect(htmlFromPlain("Hello,\n\nCould you please:\n1. Forward mail\n2. Close it\n\n> quoted & <b>\n> more")).toBe(
      "<p>Hello,</p><p>Could you please:</p><ol><li>Forward mail</li><li>Close it</li></ol><blockquote><p>quoted &amp; &lt;b&gt;<br>more</p></blockquote>"
    );
  });
});

describe("sending formatted mail", () => {
  it("cleans the editor's HTML again on the server and writes the text part from it", async () => {
    const { parseSend } = await import("../lib/mail");
    const r = parseSend({ sendId: "123e4567-e89b-42d3-a456-426614174000", to: ["support@earthclassmail.com"], subject: "Hi", text: "ignored", html: '<p>Please:</p><ol><li>Forward</li></ol><script>x</script>' });
    if ("error" in r) throw new Error(r.message);
    expect(r.text).toBe("Please:\n\n1. Forward");
    expect(r.html).toContain('<ol style="margin:0 0 14px;padding-left:24px"><li style="margin:0 0 6px">Forward</li></ol>');
    expect(r.html).not.toContain("script");
  });
});

describe("a conversation", () => {
  it("names every message it's linked by, and asks for any message linked to them", async () => {
    const { threadCondition, threadIds } = await import("../lib/mail");
    const ids = threadIds({ message_id: "<b@x>", in_reply_to: "<a@x>", references_ids: ["<a@x>", "bad id"] });
    expect(ids).toEqual(["<b@x>", "<a@x>"]);
    expect(decodeURIComponent(threadCondition(ids)!)).toBe(
      'and=(or(message_id.in.("<b@x>","<a@x>"),in_reply_to.in.("<b@x>","<a@x>"),references_ids.ov.{"<b@x>","<a@x>"}))'
    );
    expect(threadCondition([])).toBeNull();
  });
});
