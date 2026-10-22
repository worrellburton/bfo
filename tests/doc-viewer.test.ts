import { describe, expect, it } from "vitest";
import { viewerKind } from "../app/doc-viewer";

describe("document reader", () => {
  it("knows what it can show from the type or the name", () => {
    expect(viewerKind("Operating Agreement - X.pdf", null)).toBe("pdf");
    expect(viewerKind("scan", "application/pdf")).toBe("pdf");
    expect(viewerKind("photo.JPG", null)).toBe("image");
    expect(viewerKind(null, "image/png")).toBe("image");
    expect(viewerKind("ledger.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("other");
    expect(viewerKind(null, null)).toBe("other");
  });
});
