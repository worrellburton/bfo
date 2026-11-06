import { activeLocks, type PeriodLock } from "./ledger.js";

/**
 * Small database helpers the Books write paths share: writes that still work
 * before migration 20261107_books_ledger_controls.sql is applied (a new
 * column is sent when it exists and dropped when PostgREST says it doesn't),
 * and the period lock, read once per request.
 *
 * HTTP surface: none; a library for the Books endpoints and the bank sync.
 * Who may call it: server code, after the endpoint's own role check.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through the db fetcher passed in).
 */

type Db = (path: string, init?: RequestInit) => Promise<Response>;

/** PostgREST's answer when a body names a column the table doesn't have yet. */
export function isMissingColumn(text: string): boolean {
  return /PGRST204|42703|Could not find the '[^']+' column|column .* does not exist/i.test(text);
}

/** PostgREST's answer when the table isn't there yet. */
export function isMissingTable(text: string): boolean {
  return /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(text);
}

/** `body` (an object or rows) with the named keys left out. */
export function without<T>(body: T, keys: string[]): T {
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  return (Array.isArray(body) ? body.map((r) => strip(r as Record<string, unknown>)) : strip(body as Record<string, unknown>)) as T;
}

/**
 * A POST or PATCH that names columns added by the ledger migration. When the
 * database says a column isn't there, it is sent again without `optional`:
 * the change still lands, and the extra record arrives once the migration
 * is applied. Resolves to the final Response.
 */
export async function writeTolerant(db: Db, path: string, method: "POST" | "PATCH", body: unknown, optional: string[], headers: Record<string, string> = {}): Promise<Response> {
  const first = await db(path, { method, headers, body: JSON.stringify(body) });
  if (first.ok || !optional.length) return first;
  const text = await first
    .clone()
    .text()
    .catch(() => "");
  if (!isMissingColumn(text)) return first;
  return db(path, { method, headers, body: JSON.stringify(without(body, optional)) });
}

/**
 * The period locks in force. Before the migration (no books_periods table)
 * there are none. Any other failure throws: a write must not go through on
 * a lock it couldn't read.
 */
export async function readLocks(db: Db): Promise<PeriodLock[]> {
  const r = await db("books_periods?select=entity_id,closed_through,reopened_at&reopened_at=is.null&order=id.asc");
  if (r.ok) return activeLocks((await r.json()) as Array<PeriodLock & { reopened_at: string | null }>);
  const text = await r.text().catch(() => "");
  if (isMissingTable(text)) return [];
  throw new Error(`couldn't read the period locks: ${r.status} ${text.slice(0, 200)}`);
}

/** Account → its entity now (plaid_account_prefs), for the lock and rule scopes. */
export async function readEntityMap(db: Db): Promise<Map<string, { id: string | null; name: string | null }>> {
  const r = await db("plaid_account_prefs?select=account_id,entity_id,entity_name&archived_at=is.null");
  if (!r.ok) throw new Error(`couldn't read the account mappings: ${r.status}`);
  const rows = (await r.json()) as Array<{ account_id: string; entity_id: string | null; entity_name: string | null }>;
  return new Map(rows.map((p) => [p.account_id, { id: p.entity_id ?? null, name: p.entity_name ?? null }]));
}
