import { describe, expect, it } from "vitest";
import { countRows, fetchAll, type DbFetch } from "../lib/db-pages";

/** A fake PostgREST: serves `total` numbered rows by Range, 1,000 at most per request. */
function fakeDb(total: number, opts: { failFrom?: number; noCount?: boolean } = {}) {
  const ranges: string[] = [];
  const db: DbFetch = async (_path, init) => {
    const range = String((init?.headers as Record<string, string>)?.Range ?? "0-999");
    ranges.push(range);
    const [from, to] = range.split("-").map(Number);
    if (opts.failFrom !== undefined && from >= opts.failFrom) {
      return new Response("boom", { status: 500 });
    }
    const end = Math.min(to, from + 999, total - 1);
    const rows = Array.from({ length: Math.max(end - from + 1, 0) }, (_, i) => ({ n: from + i }));
    const counted = (init?.headers as Record<string, string>)?.Prefer?.includes("count=exact") && !opts.noCount;
    return new Response(JSON.stringify(rows), {
      status: 206,
      headers: { "content-range": `${from}-${end}/${counted ? total : "*"}` },
    });
  };
  return { db, ranges };
}

describe("fetchAll", () => {
  it("reads past PostgREST's 1,000-row page", async () => {
    const { db, ranges } = fakeDb(1005);
    const rows = await fetchAll<{ n: number }>("book_txn_log?select=transaction_id", db);
    expect(rows).toHaveLength(1005);
    expect(rows[1004]).toEqual({ n: 1004 });
    expect(new Set(rows.map((r) => r.n)).size).toBe(1005);
    expect(ranges).toEqual(["0-999", "1000-1999"]);
  });

  it("pages sequentially when the server gives no count", async () => {
    const { db, ranges } = fakeDb(2005, { noCount: true });
    const rows = await fetchAll<{ n: number }>("t?select=n", db);
    expect(rows).toHaveLength(2005);
    expect(ranges).toEqual(["0-999", "1000-1999", "2000-2999"]);
  });

  it("returns a short first page without asking again", async () => {
    const { db, ranges } = fakeDb(3);
    expect(await fetchAll("t?select=n", db)).toHaveLength(3);
    expect(ranges).toHaveLength(1);
  });

  it("throws when a later page fails, rather than returning a partial list", async () => {
    const { db } = fakeDb(1005, { failFrom: 1000 });
    await expect(fetchAll("t?select=n", db)).rejects.toThrow(/DB error 500/);
  });

  it("throws when a later page fails without a count, too", async () => {
    const { db } = fakeDb(1005, { failFrom: 1000, noCount: true });
    await expect(fetchAll("t?select=n", db)).rejects.toThrow(/DB error 500/);
  });

  it("throws when the first read fails, rather than returning nothing", async () => {
    const { db } = fakeDb(10, { failFrom: 0 });
    await expect(fetchAll("t?select=n", db)).rejects.toThrow(/DB error 500/);
  });
});

describe("countRows", () => {
  it("reads the total from the content-range header", async () => {
    const db: DbFetch = async () => new Response("[]", { headers: { "content-range": "0-0/42" } });
    expect(await countRows("login_codes", "created_at=gte.x", db)).toBe(42);
  });

  it("throws on a failed count", async () => {
    const db: DbFetch = async () => new Response("nope", { status: 500 });
    await expect(countRows("login_codes", "created_at=gte.x", db)).rejects.toThrow(/supabase 500/);
  });
});
