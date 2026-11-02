import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, hashToken, pruneSessions, sessionFilter } from "../lib/auth";
import { signImageUrl, verifyImageUrl } from "../lib/mail-image";

/**
 * Sessions are kept as the SHA-256 of the bearer token, and the mail image
 * proxy signs with a key that has to exist.
 */

describe("session tokens", () => {
  const TOKEN = "3f1c2a4e-0000-4000-8000-000000000000";

  it("hashes a token the way the migration did (SHA-256, hex)", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(TOKEN)).not.toBe(hashToken(TOKEN.replace("3f", "4f")));
  });

  it("finds a session by its hash, or by the plaintext column for a row from before", () => {
    const f = sessionFilter(TOKEN);
    expect(f).toBe(`or=(token_hash.eq.${hashToken(TOKEN)},and(token_hash.is.null,token.eq.${encodeURIComponent(TOKEN)}))`);
    expect(f).not.toContain(`token_hash.eq.${TOKEN}`); // never the token itself where the hash goes
  });

  describe("pruneSessions", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      vi.stubEnv("SUPABASE_URL", "https://sb.test");
      vi.stubEnv("SUPABASE_SERVICE_KEY", "service-key");
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      fetchMock.mockReset();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("deletes the sessions past their expiry and says how many", async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ user_id: "a" }, { user_id: "b" }]), { status: 200 }));
      expect(await pruneSessions()).toBe(2);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("DELETE");
      expect(url).toMatch(/app_sessions\?expires_at=lt\.\d{4}-\d{2}-\d{2}T/);
      expect((init.headers as Record<string, string>).Prefer).toBe("return=representation");
    });
  });
});

describe("mail image signing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs with MAIL_IMAGE_SECRET, else AUTH_SECRET, and verifies the same link", () => {
    vi.stubEnv("MAIL_IMAGE_SECRET", "image-key");
    vi.stubEnv("AUTH_SECRET", "pepper");
    const sig = signImageUrl("https://example.com/a.png");
    expect(sig).toHaveLength(32);
    expect(verifyImageUrl("https://example.com/a.png", sig)).toBe(true);
    expect(verifyImageUrl("https://example.com/b.png", sig)).toBe(false);
    vi.stubEnv("MAIL_IMAGE_SECRET", "");
    expect(signImageUrl("https://example.com/a.png")).not.toBe(sig); // the fallback key gives a different signature
  });

  it("refuses to sign when no key is set, instead of signing with an empty one", () => {
    vi.stubEnv("MAIL_IMAGE_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => signImageUrl("https://example.com/a.png")).toThrow(ConfigError);
  });
});
