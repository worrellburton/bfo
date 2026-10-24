import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchableImageUrl, proxiedImageUrl, proxyRemoteImages, signImageUrl, verifyImageUrl } from "../lib/mail-image";

describe("mail images through BFO", () => {
  beforeEach(() => {
    process.env.MAIL_IMAGE_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.MAIL_IMAGE_SECRET;
  });

  it("signs a picture's address and checks the signature", () => {
    const url = "https://claude.ai/images/email/claude_logo_chip.png";
    const s = signImageUrl(url);
    expect(s).toHaveLength(32);
    expect(verifyImageUrl(url, s)).toBe(true);
    expect(verifyImageUrl(url + "?x", s)).toBe(false);
    expect(verifyImageUrl(url, s.slice(0, 31) + (s.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(proxiedImageUrl(url)).toBe(`/api/mail-image?u=${encodeURIComponent(url)}&s=${s}`);
  });

  it("fetches only ordinary web addresses", () => {
    expect(fetchableImageUrl("https://cdn.example.com/a.png")?.hostname).toBe("cdn.example.com");
    expect(fetchableImageUrl("http://example.com/a.png")).not.toBeNull();
    expect(fetchableImageUrl("https://10.0.0.4/a.png")).toBeNull();
    expect(fetchableImageUrl("https://localhost/a.png")).toBeNull();
    expect(fetchableImageUrl("https://host.internal/a.png")).toBeNull();
    expect(fetchableImageUrl("https://user:pw@example.com/a.png")).toBeNull();
    expect(fetchableImageUrl("https://example.com:8443/a.png")).toBeNull();
    expect(fetchableImageUrl("ftp://example.com/a.png")).toBeNull();
    expect(fetchableImageUrl("cid:part1")).toBeNull();
  });

  it("points every remote picture in the HTML at the proxy, and leaves the rest alone", () => {
    const html = `<img alt="Claude" src="https://claude.ai/images/email/logo.png" width="112"><img src='//cdn.x.com/b.png' srcset="https://cdn.x.com/b.png 1x, https://cdn.x.com/b@2x.png 2x"><img src="data:image/png;base64,AAAA"><img src="cid:inline1"><table background="https://cdn.x.com/bg.jpg"><tr><td>hi</td></tr></table>`;
    const out = proxyRemoteImages(html);
    expect(out).toContain(`src="${proxiedImageUrl("https://claude.ai/images/email/logo.png")}"`);
    expect(out).toContain(`src="${proxiedImageUrl("https://cdn.x.com/b.png")}"`);
    expect(out).toContain(`${proxiedImageUrl("https://cdn.x.com/b@2x.png")} 2x`);
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain('src="cid:inline1"');
    expect(out).toContain(`background="${proxiedImageUrl("https://cdn.x.com/bg.jpg")}"`);
    expect(out).not.toContain('src="https://');
  });
});
