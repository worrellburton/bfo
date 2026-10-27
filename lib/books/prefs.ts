import { fetchAll } from "../db-pages.js";
import type { BookTxn, Pref } from "./types.js";

/**
 * Account → entity mappings, and the two things every Books read does with
 * them: narrow a query to the selected entities, and stamp each row with the
 * entity its account belongs to right now.
 */

/**
 * Mappings are read live rather than trusted from the copy stamped onto each
 * transaction at sync time — remapping an account takes effect at once.
 */
export async function getPrefs(): Promise<Map<string, Pref>> {
  const rows = await fetchAll<Pref>(
    "plaid_account_prefs?select=account_id,entity_id,entity_name,hidden,nickname,account_name,mask,institution_name&archived_at=is.null"
  );
  return new Map(rows.map((p) => [p.account_id, p]));
}

const idList = (ids: string[]) => ids.map((id) => `"${id}"`).join(",");

/**
 * Turn an entity selection into account-level PostgREST filters, so paging
 * and counts stay server-side. Hidden accounts are always excluded.
 */
export function scopeFilter(prefs: Map<string, Pref>, selection: string[] | null | "unmapped"): string {
  const hidden = [...prefs.values()].filter((p) => p.hidden).map((p) => p.account_id);
  const base = hidden.length ? `&account_id=not.in.(${idList(hidden)})` : "";

  if (selection === null) return base;

  if (selection === "unmapped") {
    const mapped = [...prefs.values()].filter((p) => p.entity_id).map((p) => p.account_id);
    return base + (mapped.length ? `&account_id=not.in.(${idList(mapped)})` : "");
  }

  const wanted = [...prefs.values()]
    .filter((p) => p.entity_id && selection.includes(p.entity_id))
    .map((p) => p.account_id);
  return base + `&account_id=in.(${wanted.length ? idList(wanted) : '"none"'})`;
}

/** Overlay each row with the entity its account is mapped to right now. */
export function withLiveEntity(rows: BookTxn[], prefs: Map<string, Pref>): BookTxn[] {
  return rows.map((row) => {
    const pref = prefs.get(row.account_id);
    return { ...row, entity_id: pref?.entity_id ?? null, entity_name: pref?.entity_name ?? null };
  });
}
