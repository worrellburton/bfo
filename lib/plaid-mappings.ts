import { sb } from "./auth.js";

/**
 * Plaid mints fresh account_ids for every connection, so the same real-world
 * account arrives with a different id after a reconnect — or when a duplicate
 * connection is removed and its twin survives. Mappings therefore also record
 * a stable identity (bank + last four + account kind), and any live account
 * without a mapping of its own adopts the matching saved one.
 *
 * An identity matching more than one saved mapping is left alone: an account
 * arriving unmapped is a visible amber prompt, whereas an account mapped to
 * the wrong entity quietly corrupts a P&L.
 */

export type LiveAccount = {
  account_id: string;
  institution_name: string;
  mask: string | null;
  subtype: string | null;
  name: string | null;
};

type PrefRow = {
  account_id: string;
  institution_name: string | null;
  mask: string | null;
  subtype: string | null;
  nickname: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
};

/** A mapping only carries meaning if it holds one of these. */
const carriesMeaning = (p: PrefRow) => !!(p.entity_id || p.nickname || p.hidden);

export async function adoptMappings(live: LiveAccount[]): Promise<number> {
  if (!live.length) return 0;

  const saved = await sb<PrefRow[]>("plaid_account_prefs?select=*");
  if (!saved?.length) return 0;

  const liveIds = new Set(live.map((a) => a.account_id));
  const byId = new Map(saved.map((p) => [p.account_id, p]));
  let adopted = 0;

  for (const account of live) {
    // Already mapped in its own right.
    if (carriesMeaning(byId.get(account.account_id) ?? ({} as PrefRow))) continue;

    const candidates = saved.filter(
      (p) =>
        p.account_id !== account.account_id &&
        p.institution_name === account.institution_name &&
        p.mask === account.mask &&
        p.subtype === account.subtype &&
        carriesMeaning(p) &&
        // Only take over a mapping whose own account is gone, or which is a
        // duplicate of this same account under another connection.
        !liveIds.has(p.account_id)
    );
    if (candidates.length !== 1) continue;

    const from = candidates[0];
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
      },
    });
    adopted += 1;
  }

  return adopted;
}

/** Record each account's identity so its mapping survives a future reconnect. */
export async function stampIdentity(live: LiveAccount[]): Promise<void> {
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
      },
    }).catch(() => {});
  }
}
