import { describe, expect, it } from "vitest";
import { parseBlocks } from "../app/ask-markdown";

describe("ask markdown", () => {
  it("splits paragraphs, lists, headings and tables", () => {
    const blocks = parseBlocks(
      ["Two things are due.", "", "## Soon", "- Ledger Louise annual list", "  by Aug 31", "- Sundown report", "", "1. First", "2. Second", "", "| Entity | Cash |", "|---|---|", "| A | $1,000 |", "", "Done."].join("\n")
    );
    expect(blocks.map((b) => b.kind)).toEqual(["p", "h", "ul", "ol", "table", "p"]);
    expect((blocks[2] as { items: string[] }).items).toEqual(["Ledger Louise annual list by Aug 31", "Sundown report"]);
    expect((blocks[4] as { rows: string[][] }).rows).toEqual([
      ["Entity", "Cash"],
      ["A", "$1,000"],
    ]);
  });
  it("keeps code fences whole", () => {
    const blocks = parseBlocks("```\na | b\n- not a list\n```");
    expect(blocks).toEqual([{ kind: "code", text: "a | b\n- not a list" }]);
  });
});
