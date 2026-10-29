import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import {
  appendCertificate,
  certificateFooter,
  certificateLines,
  cleanField,
  cleanParty,
  deriveStatus,
  fieldRect,
  fitInside,
  fontSafe,
  hashToken,
  isUploadPath,
  newToken,
  pdfKey,
  placeField,
  sendBlocker,
  signedCopyEmail,
  signRequestEmail,
  stampPdf,
  TOKEN_RE,
  toView,
  versionPath,
  type Party,
  type SignatureRequestRow,
} from "../lib/sign";

const party = (key: "a" | "b", status: Party["status"] = "pending", extra: Partial<Party> = {}): Party => ({ key, role: key === "a" ? "Manager" : "Client", name: key === "a" ? "Robert Burton" : "Ada Client", email: `${key}@example.com`, status, ...extra });

const row = (over: Partial<SignatureRequestRow> = {}): SignatureRequestRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Management Services Agreement - Ada",
  status: "sent",
  source: "contract",
  asset_id: "-E2",
  contract_id: "c1",
  created_by: "u1",
  created_by_name: "Robert Burton",
  original_path: "signatures/x/original.pdf",
  current_path: "signatures/x/current.pdf",
  signed_path: null,
  pages: [{ w: 612, h: 792 }],
  fields: [
    { id: "a-sig", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
    { id: "b-sig", party: "b", type: "signature", page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.05 },
  ],
  parties: [party("a", "sent", { tokenHash: "h1" }), party("b", "sent", { tokenHash: "h2" })],
  events: [],
  created_at: "2026-10-28T10:00:00Z",
  sent_at: "2026-10-28T10:00:00Z",
  completed_at: null,
  copy_sent_at: null,
  brand: null,
  version: 0,
  ...over,
});

describe("tokens", () => {
  it("makes url-safe tokens that hash deterministically", () => {
    const t = newToken();
    expect(TOKEN_RE.test(t)).toBe(true);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(newToken()));
  });
  it("strips token hashes from what the office sees", () => {
    const v = toView(row());
    expect(JSON.stringify(v)).not.toContain("tokenHash");
    expect(v.parties[0].email).toBe("a@example.com");
  });
});

describe("status", () => {
  it("follows the parties", () => {
    expect(deriveStatus([party("a", "sent"), party("b", "sent")], "sent")).toBe("sent");
    expect(deriveStatus([party("a", "signed"), party("b", "viewed")], "sent")).toBe("partial");
    expect(deriveStatus([party("a", "signed"), party("b", "signed")], "partial")).toBe("completed");
    expect(deriveStatus([party("a", "signed"), party("b", "declined")], "partial")).toBe("declined");
  });
  it("leaves a draft or a void alone", () => {
    expect(deriveStatus([party("a", "signed")], "draft")).toBe("draft");
    expect(deriveStatus([party("a", "signed")], "voided")).toBe("voided");
  });
});

describe("sendBlocker", () => {
  it("passes a complete request", () => {
    expect(sendBlocker(row())).toBeNull();
  });
  it("names what's missing", () => {
    expect(sendBlocker(row({ original_path: null }))).toMatch(/document/);
    expect(sendBlocker(row({ parties: [] }))).toMatch(/party/);
    expect(sendBlocker(row({ parties: [party("a"), party("b", "pending", { email: "nope" })] }))).toMatch(/email/);
    expect(sendBlocker(row({ fields: [row().fields[0]] }))).toMatch(/signature field for Ada/);
  });
});

describe("cleaning", () => {
  it("keeps a field on the page and inside sane sizes", () => {
    expect(cleanField({ id: "f", party: "a", type: "signature", page: 1, x: 0.9, y: 0.95, w: 0.3, h: 0.1 }, 1)).toEqual({ id: "f", party: "a", type: "signature", page: 1, x: 0.7, y: 0.9, w: 0.3, h: 0.1 });
    expect(cleanField({ party: "a", type: "signature", page: 3, x: 0, y: 0, w: 0.3, h: 0.1 }, 2)).toBeNull();
    expect(cleanField({ party: "c", type: "signature", page: 1, x: 0, y: 0, w: 0.3, h: 0.1 }, 2)).toBeNull();
    expect(cleanField({ party: "a", type: "stamp", page: 1, x: 0, y: 0, w: 0.3, h: 0.1 }, 2)).toBeNull();
  });
  it("keeps a party's signing state through an edit", () => {
    const prior = party("a", "signed", { tokenHash: "h", signedAt: "2026-10-28T11:00:00Z" });
    const next = cleanParty({ role: "Manager", name: " Robert ", email: "R@Example.com" }, "a", prior);
    expect(next).toMatchObject({ key: "a", name: "Robert", email: "r@example.com", status: "signed", tokenHash: "h" });
  });
});

describe("geometry", () => {
  it("converts a field to PDF points from the bottom-left", () => {
    const r = fieldRect({ id: "f", party: "a", type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 }, 612, 792);
    expect(r.x).toBeCloseTo(61.2);
    expect(r.y).toBeCloseTo(118.8);
    expect(r.w).toBeCloseTo(183.6);
    expect(r.h).toBeCloseTo(39.6);
  });
  it("fits an image inside a box without stretching", () => {
    expect(fitInside(200, 100, 100, 100)).toEqual({ w: 100, h: 50 });
    expect(fitInside(100, 200, 100, 100)).toEqual({ w: 50, h: 100 });
  });
});

describe("stamping", () => {
  // A 1×1 transparent PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  it("stamps a signature image and text, then adds a certificate page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const base = await doc.save();
    const r = row();
    const stamped = await stampPdf(base, [
      { field: r.fields[0], png: new Uint8Array(png) },
      { field: { ...r.fields[1], type: "date" }, text: "October 28, 2026" },
    ]);
    const after = await PDFDocument.load(stamped);
    expect(after.getPageCount()).toBe(1);
    const done = await appendCertificate(stamped, { ...r, parties: [party("a", "signed", { signedAt: "2026-10-28T11:00:00Z", ip: "1.2.3.4" }), party("b", "signed", { signedAt: "2026-10-28T12:00:00Z" })], completed_at: "2026-10-28T12:00:00Z" });
    expect((await PDFDocument.load(done)).getPageCount()).toBe(2);
  });

  it("writes the certificate's lines from the parties", () => {
    const lines = certificateLines({ ...row(), parties: [party("a", "signed", { signedAt: "2026-10-28T11:00:00Z", ip: "1.2.3.4", signedAs: "Robert W. Burton" }), party("b", "sent")] });
    expect(lines).toContain("## Manager: Robert Burton");
    expect(lines).toContain("Signed as Robert W. Burton");
    expect(lines.some((l) => l.startsWith("Signed Oct 28, 2026") && l.endsWith("from 1.2.3.4"))).toBe(true);
    expect(lines).toContain("Not signed");
  });
});

describe("emails", () => {
  it("names the sender, the document and the signer", () => {
    const m = signRequestEmail({ title: "MSA", created_by_name: "Robert", brand: null }, party("b"), "https://www.burtonfamilyoffice.com/sign/abc");
    expect(m.subject).toBe("Robert sent you MSA to sign");
    expect(m.text).toContain("https://www.burtonfamilyoffice.com/sign/abc");
    expect(m.html).toContain("Ada Client");
    expect(signRequestEmail({ title: "MSA", created_by_name: null, brand: null }, party("b"), "x", true).subject).toMatch(/^Reminder/);
  });
  it("never mentions BFO when sent under an entity's own name", () => {
    const m = signRequestEmail({ title: "MSA", created_by_name: "Robert", brand: "Ledger Louise, LLC" }, party("b"), "https://www.burtonfamilyoffice.com/sign/abc");
    expect(m.subject).toBe("Ledger Louise, LLC sent you MSA to sign");
    expect(m.html).not.toMatch(/Burton Family Office|>BFO</);
    const copy = signedCopyEmail({ title: "MSA", brand: "Ledger Louise, LLC" }, party("b"), "x");
    expect(copy.html).not.toMatch(/Burton Family Office|>BFO</);
    expect(certificateFooter("Ledger Louise, LLC").join(" ")).not.toMatch(/BFO|Burton/);
    expect(certificateFooter(null).join(" ")).toMatch(/Burton Family Office/);
  });
});

describe("pdfKey", () => {
  it("changes when a signature is stamped, though the path stays the same", () => {
    const before = pdfKey(row());
    const after = pdfKey(row({ parties: [party("a", "signed"), party("b", "sent")] }));
    expect(before).toBe("signatures/x/current.pdf#0");
    expect(after).toBe("signatures/x/current.pdf#1");
    expect(pdfKey(row({ signed_path: "signatures/x/signed.pdf", parties: [party("a", "signed"), party("b", "signed")] }))).toBe("signatures/x/signed.pdf#2");
  });
});

describe("placing on turned and cropped pages", () => {
  const field = { id: "f", party: "a" as const, type: "signature" as const, page: 1, x: 0.1, y: 0.7, w: 0.3, h: 0.1 };

  it("maps an upright page, honouring the crop box's origin", () => {
    const r = placeField(field, { x: 10, y: 20, w: 600, h: 800, rotate: 0 });
    expect(r.x).toBeCloseTo(10 + 60);
    expect(r.y).toBeCloseTo(20 + (1 - 0.8) * 800);
    expect(r.w).toBeCloseTo(180);
    expect(r.h).toBeCloseTo(80);
    expect(r.rotate).toBe(0);
  });

  it("maps a page turned 90°: shown width is the page's height", () => {
    // Shown 800 wide × 600 tall. The shown bottom-left of the box is (u=0.1, v=0.8).
    const r = placeField(field, { x: 0, y: 0, w: 600, h: 800, rotate: 90 });
    expect(r.x).toBeCloseTo(0.8 * 600);
    expect(r.y).toBeCloseTo(0.1 * 800);
    expect(r.w).toBeCloseTo(0.3 * 800);
    expect(r.h).toBeCloseTo(0.1 * 600);
    expect(r.rotate).toBe(90);
  });

  it("maps 180° and 270°", () => {
    const f = { x: 0, y: 0, w: 600, h: 800 };
    const r180 = placeField(field, { ...f, rotate: 180 });
    expect([r180.x, r180.y]).toEqual([expect.closeTo(0.9 * 600), expect.closeTo(0.8 * 800)]);
    const r270 = placeField(field, { ...f, rotate: 270 });
    expect([r270.x, r270.y]).toEqual([expect.closeTo(0.2 * 600), expect.closeTo(0.9 * 800)]);
  });

  it("stamps a page with /Rotate without throwing", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(90));
    const out = await stampPdf(await doc.save(), [{ field: { ...field, type: "name" }, text: "Łukasz Ğül 王" }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe("text the PDF fonts can draw", () => {
  it("folds accents and replaces what's left", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(fontSafe("Łukasz Ğül", font)).toBe("Lukasz Gül");
    expect(fontSafe("José Müller", font)).toBe("José Müller");
    expect(fontSafe("王 ✓", font)).toBe("? ?");
  });
  it("lets the certificate carry any name", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = { ...row(), title: "Agreement — 契約 🖋", brand: "Ünïcödé, LLC", parties: [party("a", "signed", { name: "Łukasz", signedAt: "2026-10-28T11:00:00Z" }), party("b", "signed", { signedAt: "2026-10-28T12:00:00Z" })] };
    const out = await appendCertificate(await doc.save(), r);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});

describe("upload paths", () => {
  it("only accepts this request's own fresh upload paths", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const p = versionPath(id, "upload");
    expect(isUploadPath(id, p)).toBe(true);
    expect(isUploadPath(id, `signatures/${id}/current.pdf`)).toBe(false);
    expect(isUploadPath(id, `signatures/22222222-2222-4222-8222-222222222222/upload-abc-0011aabb.pdf`)).toBe(false);
    expect(isUploadPath(id, `signatures/${id}/upload-abc-0011aabb.pdf/../x`)).toBe(false);
    expect(versionPath(id, "current")).not.toBe(versionPath(id, "current"));
  });
});
