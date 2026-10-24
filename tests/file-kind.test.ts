import { describe, expect, it } from "vitest";
import { fileKind, fileKinds } from "../lib/file-kind";

describe("fileKind", () => {
  it("reads the kind from the name first", () => {
    expect(fileKind("Statement of work.pdf", "application/octet-stream")).toBe("pdf");
    expect(fileKind("IMG_0412.HEIC", null)).toBe("image");
    expect(fileKind("ledger.xlsx", "application/octet-stream")).toBe("sheet");
    expect(fileKind("deck.key", "")).toBe("slides");
    expect(fileKind("photos.zip", "application/zip")).toBe("archive");
    expect(fileKind("invite.ics", "text/calendar")).toBe("calendar");
  });

  it("falls back to the content type", () => {
    expect(fileKind("attachment", "application/pdf")).toBe("pdf");
    expect(fileKind(null, "image/png")).toBe("image");
    expect(fileKind("", "audio/mpeg")).toBe("audio");
    expect(fileKind("", "video/mp4")).toBe("video");
    expect(fileKind("", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("doc");
    expect(fileKind("", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("sheet");
    expect(fileKind("", "application/vnd.ms-powerpoint")).toBe("slides");
    expect(fileKind("", "text/plain")).toBe("text");
    expect(fileKind("", "application/json")).toBe("code");
  });

  it("is a plain file when nothing says otherwise", () => {
    expect(fileKind("thing", "application/octet-stream")).toBe("file");
    expect(fileKind(undefined, undefined)).toBe("file");
  });

  it("lists distinct kinds in first-seen order", () => {
    expect(fileKinds([{ filename: "a.pdf" }, { filename: "b.png", contentType: "image/png" }, { filename: "c.pdf" }, { contentType: "image/jpeg" }])).toEqual(["pdf", "image"]);
    expect(fileKinds([])).toEqual([]);
  });
});
