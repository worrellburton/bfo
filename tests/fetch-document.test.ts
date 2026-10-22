import { afterEach, describe, expect, it, vi } from "vitest";
import { documentPathFor, fetchDocument, isStorageUrl } from "../lib/fetch-document";

const HOSTS = ["abc.supabase.co"];

describe("isStorageUrl", () => {
  it("accepts our storage hosts over https", () => {
    expect(isStorageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/a.pdf?alt=media", HOSTS)).toBe(false);
    expect(isStorageUrl("https://abc.supabase.co/storage/v1/object/public/documents/assets/a/b.pdf", HOSTS)).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isStorageUrl("http://abc.supabase.co/a.pdf", HOSTS)).toBe(false);
    expect(isStorageUrl("https://169.254.169.254/latest/meta-data", HOSTS)).toBe(false);
    expect(isStorageUrl("https://evil.example/abc.supabase.co", HOSTS)).toBe(false);
    expect(isStorageUrl("https://abc.supabase.co.evil.example/x", HOSTS)).toBe(false);
    expect(isStorageUrl("https://user:pw@abc.supabase.co/x", HOSTS)).toBe(false);
    expect(isStorageUrl("file:///etc/passwd", HOSTS)).toBe(false);
    expect(isStorageUrl("not a url", HOSTS)).toBe(false);
  });
});

describe("documentPathFor", () => {
  it("takes the path from our URLs or a bare path, never a foreign URL", () => {
    expect(documentPathFor("https://abc.supabase.co/storage/v1/object/public/documents/assets/a/b.pdf", HOSTS)).toBe("assets/a/b.pdf");
    expect(documentPathFor("https://abc.supabase.co/storage/v1/object/sign/documents/assets/a/b.pdf?token=t", HOSTS)).toBe("assets/a/b.pdf");
    expect(documentPathFor("assets/a/b.pdf", HOSTS)).toBe("assets/a/b.pdf");
    expect(documentPathFor("https://evil.example/storage/v1/object/public/documents/assets/a/b.pdf", HOSTS)).toBeNull();
    expect(documentPathFor("https://abc.supabase.co/storage/v1/object/public/mail/in/x.pdf", HOSTS)).toBeNull();
    expect(documentPathFor("assets/a/../../mail/x", HOSTS)).toBeNull();
    expect(documentPathFor(42, HOSTS)).toBeNull();
  });
});

describe("fetchDocument", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("never fetches a foreign URL", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchDocument("http://localhost:3000/secret", 1024)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads from the documents bucket with the service key, not the stored URL", async () => {
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf; charset=binary" } });
    });
    const file = await fetchDocument("https://abc.supabase.co/storage/v1/object/public/documents/assets/a/b.pdf", 1024);
    expect(seen).toEqual([{ url: "https://abc.supabase.co/storage/v1/object/documents/assets/a/b.pdf", auth: "Bearer service-key" }]);
    expect(file?.contentType).toBe("application/pdf");
    expect([...file!.buf]).toEqual([37, 80, 68, 70]);
  });

  it("gives up past the size cap or on a missing file", async () => {
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(10), { status: 200 }));
    expect(await fetchDocument("assets/a/b.pdf", 5)).toBeNull();
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 400 }));
    expect(await fetchDocument("assets/a/b.pdf", 1024)).toBeNull();
  });
});
