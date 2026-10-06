import { describe, expect, it } from "vitest";
import { fetchDocument, isStorageUrl } from "../lib/fetch-document";

const HOSTS = ["firebasestorage.googleapis.com", "abc.supabase.co"];

describe("isStorageUrl", () => {
  it("accepts our storage hosts over https", () => {
    expect(isStorageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/a.pdf?alt=media", HOSTS)).toBe(true);
    expect(isStorageUrl("https://abc.supabase.co/storage/v1/object/public/documents/assets/a/b.pdf", HOSTS)).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isStorageUrl("http://firebasestorage.googleapis.com/a.pdf", HOSTS)).toBe(false);
    expect(isStorageUrl("https://169.254.169.254/latest/meta-data", HOSTS)).toBe(false);
    expect(isStorageUrl("https://evil.example/abc.supabase.co", HOSTS)).toBe(false);
    expect(isStorageUrl("https://abc.supabase.co.evil.example/x", HOSTS)).toBe(false);
    expect(isStorageUrl("https://user:pw@abc.supabase.co/x", HOSTS)).toBe(false);
    expect(isStorageUrl("file:///etc/passwd", HOSTS)).toBe(false);
    expect(isStorageUrl("not a url", HOSTS)).toBe(false);
  });
});

describe("fetchDocument", () => {
  it("never fetches a foreign URL", async () => {
    expect(await fetchDocument("http://localhost:3000/secret", 1024)).toBeNull();
  });
});
