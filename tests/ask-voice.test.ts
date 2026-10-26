import { describe, expect, it } from "vitest";
import { revealWords } from "../app/ask-voice";

describe("revealWords", () => {
  it("shows whole words up to the fraction spoken", () => {
    const text = "Two filings are due in the next sixty days.";
    expect(revealWords(text, 0)).toBe("");
    expect(revealWords(text, 0.5)).toBe("Two filings are due in ");
    expect(revealWords(text, 1)).toBe(text);
    expect(revealWords("one\ntwo", 0.5)).toBe("one\n");
  });
});
