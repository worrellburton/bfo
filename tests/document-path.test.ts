import { describe, expect, it } from "vitest";
import {
  assetPathSegment,
  documentAssetId,
  documentStoragePath,
  isDocumentPath,
  readableEntity,
  recordReferencesPath,
  storagePathOf,
} from "../lib/document-path";

const SB = "https://abc.supabase.co";
const P = "assets/-Nx1/1700000000000-Operating_Agreement.pdf";

describe("documentStoragePath", () => {
  it("reads the path out of every stored form", () => {
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/${P}`)).toBe(P);
    expect(documentStoragePath(`${SB}/storage/v1/object/sign/documents/${P}?token=eyJ.abc&download=x.pdf`)).toBe(P);
    expect(documentStoragePath(`${SB}/storage/v1/object/authenticated/documents/${P}`)).toBe(P);
    expect(documentStoragePath(`${SB}/storage/v1/object/documents/${P}`)).toBe(P);
    expect(documentStoragePath(P)).toBe(P);
    expect(documentStoragePath(`/${P}`)).toBe(P);
    expect(documentStoragePath(`documents/${P}`)).toBe(P);
    expect(documentStoragePath(`  ${P}  `)).toBe(P);
  });
  it("decodes percent-escapes once", () => {
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/assets/a/My%20File.pdf`)).toBe("assets/a/My File.pdf");
  });
  it("keeps a .. inside a file name", () => {
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/assets/a/1-Foo_Inc..pdf`)).toBe("assets/a/1-Foo_Inc..pdf");
  });
  it("refuses other buckets, other hosts' shapes and anything outside assets/", () => {
    expect(documentStoragePath(`${SB}/storage/v1/object/public/brand/logo/x.png`)).toBeNull();
    expect(documentStoragePath(`${SB}/storage/v1/object/sign/mail/in/x.pdf?token=t`)).toBeNull();
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/other/x.pdf`)).toBeNull();
    expect(documentStoragePath("https://firebasestorage.googleapis.com/v0/b/x/o/assets%2Fa%2Fb.pdf?alt=media")).toBeNull();
    expect(documentStoragePath("https://drive.google.com/file/d/abc")).toBeNull();
    expect(documentStoragePath("javascript:alert(1)")).toBeNull();
    expect(documentStoragePath("file:///etc/passwd")).toBeNull();
    expect(documentStoragePath("receipts/x.pdf")).toBeNull();
    expect(documentStoragePath("assets/a")).toBeNull();
    expect(documentStoragePath("")).toBeNull();
    expect(documentStoragePath(null)).toBeNull();
    expect(documentStoragePath(undefined)).toBeNull();
  });
  it("refuses traversal, however it is spelled", () => {
    expect(documentStoragePath("assets/a/../../receipts/x.pdf")).toBeNull();
    expect(documentStoragePath("assets/../mail/x.pdf")).toBeNull();
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/assets/a/%2E%2E/%2E%2E/mail/x`)).toBeNull();
    expect(documentStoragePath(`${SB}/storage/v1/object/public/documents/assets/a/%252E%252E/x`)).toBeNull();
    expect(documentStoragePath("assets/a/./x.pdf")).toBeNull();
    expect(documentStoragePath("assets//x.pdf")).toBeNull();
    expect(documentStoragePath("assets/a\\..\\x.pdf")).toBeNull();
    expect(documentStoragePath("assets/a/x.pdf?download=1")).toBeNull();
    expect(documentStoragePath("assets/a/x\u0000.pdf")).toBeNull();
  });
});

describe("isDocumentPath / documentAssetId", () => {
  it("names the entity folder", () => {
    expect(isDocumentPath(P)).toBe(true);
    expect(documentAssetId(P)).toBe("-Nx1");
    expect(documentAssetId("assets/a/b/c.pdf")).toBe("a");
    expect(documentAssetId("nope/a/b")).toBeNull();
  });
});

describe("storagePathOf", () => {
  it("prefers the URL, falls back to a Supabase storagePath", () => {
    expect(storagePathOf({ url: `${SB}/storage/v1/object/public/documents/${P}`, storagePath: "" })).toBe(P);
    expect(storagePathOf({ url: "", storagePath: P, storageProvider: "supabase" })).toBe(P);
    expect(storagePathOf({ storagePath: P })).toBe(P);
  });
  it("leaves external links and files still in Firebase alone", () => {
    expect(storagePathOf({ url: "https://example.com/a.pdf" })).toBeNull();
    expect(storagePathOf({ url: "https://firebasestorage.googleapis.com/v0/b/x/o/a?alt=media", storagePath: "assets/a/b.pdf" })).toBeNull();
    expect(storagePathOf(null)).toBeNull();
  });
});

describe("readableEntity (who may read a document)", () => {
  it("lets staff read any entity's documents", () => {
    for (const role of ["owner", "admin", "member", "viewer"]) expect(readableEntity(role, P, null)).toBe("-Nx1");
  });
  it("lets a partner read only entities they've been given", () => {
    expect(readableEntity("partner", P, ["-Nx1"])).toBe("-Nx1");
    expect(readableEntity("partner", P, ["-Other"])).toBeNull();
    expect(readableEntity("partner", P, [])).toBeNull();
    expect(readableEntity("partner", P, null)).toBeNull();
  });
  it("matches a partner's entity through the sanitised folder name", () => {
    expect(assetPathSegment("-Nabc_")).toBe("-Nabc");
    expect(readableEntity("partner", "assets/-Nabc/1-x.pdf", ["-Nabc_"])).toBe("-Nabc_");
  });
  it("refuses everyone else and bad paths", () => {
    expect(readableEntity("email", P, null)).toBeNull();
    expect(readableEntity("stranger", P, ["-Nx1"])).toBeNull();
    expect(readableEntity("owner", "assets/../x", null)).toBeNull();
  });
});

describe("recordReferencesPath", () => {
  const url = `${SB}/storage/v1/object/public/documents/${P}`;
  it("finds the path in Documents or a filing slot", () => {
    expect(recordReferencesPath({ documents: { d1: { name: "OA", url, storagePath: P, storageProvider: "supabase" } } }, P)).toBe(true);
    expect(recordReferencesPath({ operatingAgreement: { url, fileName: "OA.pdf", storagePath: "", docId: "d1" } }, P)).toBe(true);
    expect(recordReferencesPath({ einLetter: { url: "", fileName: "EIN.pdf", storagePath: P } }, P)).toBe(true);
  });
  it("ignores staff-only parts and unrelated files", () => {
    expect(recordReferencesPath({ notes: { n1: { url } } }, P)).toBe(false);
    expect(recordReferencesPath({ contracts: { c1: { url } } }, P)).toBe(false);
    expect(recordReferencesPath({ documents: { d1: { url: `${SB}/storage/v1/object/public/documents/assets/-Nx1/other.pdf` } } }, P)).toBe(false);
    expect(recordReferencesPath(null, P)).toBe(false);
  });
});
