import { sbFetch } from "./auth.js";

/**
 * Reading whole result sets from PostgREST. It serves at most 1,000 rows per
 * request no matter what `limit=` asks for, and silently: a query that needs
 * more gets a truncated answer that looks complete. Anything that must see
 * every row pages through here, and a failed page throws — an empty or partial
 * list read as "nothing there" is how hand edits got overwritten and history
 * double-imported.
 */

/** The shape of sbFetch, so tests can hand in a fake. */
export type DbFetch = (path: string, init?: RequestInit) => Promise<Response>;

const PAGE = 1000;

async function rowsOf<T>(r: Response): Promise<T[]> {
  if (!r.ok) throw new Error(`DB error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

/**
 * Every row of a query, paged with Range headers. Give any query that can run
 * past one page an `order=` ending on a unique column (book_transactions:
 * `transaction_id.asc`): without it Postgres may order each page differently,
 * so pages overlap or skip rows.
 */
export async function fetchAll<T>(pathWithFilters: string, db: DbFetch = sbFetch): Promise<T[]> {
  // The first page carries the exact row count, so the remaining pages can
  // fetch concurrently instead of one round trip per 1,000 rows.
  const first = await db(pathWithFilters, { headers: { Range: `0-${PAGE - 1}`, Prefer: "count=exact" } });
  const out = await rowsOf<T>(first);
  const total = Number(first.headers.get("content-range")?.split("/")[1]);
  if (Number.isFinite(total)) {
    const pages: Array<Promise<Response>> = [];
    for (let from = out.length; from < total; from += PAGE) {
      pages.push(db(pathWithFilters, { headers: { Range: `${from}-${from + PAGE - 1}` } }));
    }
    for (const r of await Promise.all(pages)) out.push(...(await rowsOf<T>(r)));
    return out;
  }
  // No usable count header — fall back to sequential paging until a short page.
  let last = out.length;
  while (last === PAGE) {
    const rows = await rowsOf<T>(
      await db(pathWithFilters, { headers: { Range: `${out.length}-${out.length + PAGE - 1}` } })
    );
    out.push(...rows);
    last = rows.length;
  }
  return out;
}

/**
 * Rows matching a PostgREST filter, counted without reading them. Throws when
 * the server gives no total: the counts guard rate limits (sign-in codes, mail
 * sent), and an unknown count read as 0 would let everything through.
 */
export async function countRows(table: string, filter: string, db: DbFetch = sbFetch): Promise<number> {
  const res = await db(`${table}?${filter}&select=created_at&limit=1`, { headers: { Prefer: "count=exact" } });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  if (!Number.isFinite(total)) throw new Error(`supabase: no row count for ${table}`);
  return total;
}
