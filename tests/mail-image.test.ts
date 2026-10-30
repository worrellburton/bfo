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

  it("also proxies CSS url() pictures, <picture> sources, posters and background on any element", () => {
    const css = (u: string) => `url(${proxiedImageUrl(u).replace(/['()"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)})`;
    const html =
      `<style>.hero{background:url("https://cdn.x.com/style.png") no-repeat}</style>` +
      `<div style="background-image:url(https://tracker.x.net/bg.png);height:20px">bg</div>` +
      `<td style="background:url(&quot;https://cdn.x.com/q.png&quot;)">q</td>` +
      `<p style='font-family:"Arial";background:url(https://cdn.x.com/s.png)'>s</p>` +
      `<picture><source srcset="https://cdn.x.com/a.webp 1x"><img src="https://cdn.x.com/a.png"></picture>` +
      `<video poster="https://cdn.x.com/p.jpg"></video><table><tr><th background="https://cdn.x.com/th.png">h</th></tr></table>`;
    const out = proxyRemoteImages(html);
    expect(out).toContain(`.hero{background:${css("https://cdn.x.com/style.png")} no-repeat}`);
    expect(out).toContain(`style="background-image:${css("https://tracker.x.net/bg.png")};height:20px"`);
    expect(out).toContain(`style="background:${css("https://cdn.x.com/q.png")}"`);
    expect(out).toContain(`style="font-family:&quot;Arial&quot;;background:${css("https://cdn.x.com/s.png")}"`);
    expect(out).toContain(`<source srcset="${proxiedImageUrl("https://cdn.x.com/a.webp")} 1x">`);
    expect(out).toContain(`poster="${proxiedImageUrl("https://cdn.x.com/p.jpg")}"`);
    expect(out).toContain(`<th background="${proxiedImageUrl("https://cdn.x.com/th.png")}">`);
    expect(out).not.toMatch(/(src|srcset|poster|background)="https?:|url\((&quot;|["'])?https?:/);
  });

  it("keeps a CSS address with quotes or brackets in it whole, and leaves what the proxy won't fetch for the frame's CSP to block", () => {
    const odd = "https://cdn.x.com/a(1)'s.png";
    const out = proxyRemoteImages(`<div style="background:url(https://cdn.x.com/a(1)'s.png)">x</div>`);
    // The regex stops at the first bracket: an address with brackets in it isn't one CSS reads unquoted either, so it stays.
    expect(out).not.toContain(proxiedImageUrl(odd));
    const quoted = proxyRemoteImages(`<style>i{background:url("https://cdn.x.com/it's.png")}</style>`);
    expect(quoted).toContain("url(/api/mail-image?u=https%3A%2F%2Fcdn.x.com%2Fit%27s.png&s=");
    const bare = `<img src="https://203.0.113.9/pixel.gif"><div style="background:url(https://img.x.com:8443/p.gif)">x</div>`;
    expect(proxyRemoteImages(bare)).toBe(bare);
  });

  it("leaves url() in text and non-image places alone", () => {
    const html = `<p>See url(https://example.com/x) in the docs</p><a href="https://example.com/style=url(https://x.com/a.png)">link</a>`;
    expect(proxyRemoteImages(html)).toBe(html);
  });
});
