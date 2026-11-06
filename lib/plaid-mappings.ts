/**
 * Account identity and mappings that survive a reconnect.
 *
 * HTTP surface: none; a library for api/plaid/exchange-token.ts and
 * api/plaid/prune-accounts.ts.
 * Who may call it: server code, after the endpoint's own role check.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb() in lib/auth.ts).
 *
 * Plaid mints fresh account_ids for every connection, so the same real-world
 * account arrives with a different id after a reconnect — or when a duplicate
 * connection is removed and its twin survives. Mappings therefore also record
 * a stable identity (bank + last four + account kind), and any live account
 * without a mapping of its own adopts the matching saved one.
 *
 * An identity matching more than one saved mapping is left alone: an account
 * arriving unmapped is a visible amber prompt, whereas an account mapped to
 * the wrong entity quietly corrupts a P&L.
 *
 * When the earlier account kept its Books history (a disconnect or a bank that
 * stopped sharing it keeps the ledger: lib/plaid-history.ts), the new account
 * records which account it continues and the last day that history covers
 * (predecessor_account_id, predecessor_through), and the earlier one records
 * its successor. Books uses that to skip what it already holds.
 */
import { sb } from "./auth.js";
import { fetchAll } from "./db-pages.js";
import { pickAdoption, type SavedMapping } from "./plaid-lineage.js";

export type LiveAccount = {
  account_id: string;
  institution_name: string;
  mask: string | null;
  subtype: string | null;
  name: string | null;
  /** Plaid's account type, when the caller has it. */
  type?: string | null;
};

/**
 * Whether the columns that keep an account's history after it stops syncing
 * exist yet (migration 20261107_treasury_keep_history.sql). Until they do,
 * nothing is marked, and nothing is deleted either.
 */
export async function keepColumnsReady(): Promise<boolean> {
  try {
    await sb("plaid_account_prefs?select=disconnected_at,predecessor_account_id,owner_kind&limit=1");
    return true;
  } catch {
    return false;
  }
}

export async function adoptMappings(live: LiveAccount[], ready?: boolean): Promise<number> {
  if (!live.length) return 0;

  const saved = await fetchAll<SavedMapping>("plaid_account_prefs?select=*&order=account_id.asc");
  if (!saved?.length) return 0;
  const lineage = ready ?? (await keepColumnsReady());

  const liveIds = new Set(live.map((a) => a.account_id));
  let adopted = 0;

  for (const account of live) {
    const from = pickAdoption(account, saved, liveIds);
    if (!from) continue;

    await sb("plaid_account_prefs", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: {
        account_id: account.account_id,
        nickname: from.nickname,
        hidden: from.hidden,
        entity_id: from.entity_id,
        entity_name: from.entity_name,
        institution_name: account.institution_name,
        mask: account.mask,
        subtype: account.subtype,
        account_name: account.name,
        archived_at: null,
        updated_at: new Date().toISOString(),
        ...(lineage
          ? {
              owner_kind: from.owner_kind ?? null,
              owner_names: from.owner_names ?? null,
              tenancy: from.tenancy ?? null,
              tax_status: from.tax_status ?? null,
              beneficiary_entity_id: from.beneficiary_entity_id ?? null,
              beneficiary_name: from.beneficiary_name ?? null,
              // Books already holds the earlier account's rows up to this day.
              predecessor_account_id: from.books_through ? from.account_id : null,
              predecessor_through: from.books_through ?? null,
            }
          : {}),
      },
    });
    if (lineage && from.books_through) {
      await sb(`plaid_account_prefs?account_id=eq.${encodeURIComponent(from.account_id)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { successor_account_id: account.account_id, updated_at: new Date().toISOString() },
      }).catch((err) => console.error("plaid-mappings: couldn't record the successor", err));
    }
    adopted += 1;
  }

  return adopted;
}

/**
 * Record each account's identity so its mapping survives a future reconnect.
 * An account Plaid reports is syncing, so any "stopped syncing" mark it
 * carried (a deselected account chosen again) is cleared.
 */
export async function stampIdentity(live: LiveAccount[], ready?: boolean): Promise<void> {
  const keep = ready ?? (await keepColumnsReady());
  for (const account of live) {
    await sb("plaid_account_prefs", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        account_id: account.account_id,
        institution_name: account.institution_name,
        mask: account.mask,
        subtype: account.subtype,
        account_name: account.name,
        ...(keep ? { disconnected_at: null, disconnected_reason: null, ...(account.type ? { account_type: account.type } : {}) } : {}),
      },
    }).catch((err) => console.error(`plaid-mappings: couldn't stamp identity on ${account.account_id}`, err));
  }
}
