import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageSignedUrl } from "../lib/storage";

let answer: () => Response;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async () => answer()));
});
afterEach(() => vi.unstubAllGlobals());

describe("storageSignedUrl", () => {
  it("signs a link, with a download name", async () => {
    answer = () => new Response(JSON.stringify({ signedURL: "/object/sign/documents/a.pdf?token=t" }));
    expect(await storageSignedUrl("a.pdf", 60, "documents", "A b.pdf")).toBe("https://sb.test/storage/v1/object/sign/documents/a.pdf?token=t&download=A%20b.pdf");
  });

  it("is null only when the object isn't there", async () => {
    answer = () => new Response('{"error":"not_found"}', { status: 404 });
    expect(await storageSignedUrl("gone.pdf")).toBeNull();
    answer = () => new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
    expect(await storageSignedUrl("gone.pdf")).toBeNull();
  });

  it("throws when Storage fails, so it isn't read as a missing file", async () => {
    answer = () => new Response("upstream down", { status: 503 });
    await expect(storageSignedUrl("a.pdf")).rejects.toThrow(/storage sign failed: 503/);
    answer = () => new Response("{}");
    await expect(storageSignedUrl("a.pdf")).rejects.toThrow(/storage sign failed/);
  });
});
