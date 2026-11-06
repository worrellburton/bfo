/**
 * Which saved mapping a newly reported account continues. Pure, so it is
 * tested without a network (tests/plaid-lineage.test.ts); the writes are in
 * lib/plaid-mappings.ts.
 *
 * HTTP surface: none; a library.
 * Who may call it: server code.
 * Env: none.
 */

export type SavedMapping = {
  account_id: string;
  institution_name: string | null;
  mask: string | null;
  subtype: string | null;
  nickname: string | null;
  hidden: boolean | null;
  entity_id: string | null;
  entity_name: string | null;
  archived_at?: string | null;
  disconnected_at?: string | null;
  books_through?: string | null;
  successor_account_id?: string | null;
  owner_kind?: string | null;
  owner_names?: string[] | null;
  tenancy?: string | null;
  tax_status?: string | null;
  beneficiary_entity_id?: string | null;
  beneficiary_name?: string | null;
};

type Identity = { account_id: string; institution_name: string; mask: string | null; subtype: string | null };

/** A mapping carries meaning when it holds a choice someone made, or a Books history to continue. */
export function carriesMeaning(p: Partial<SavedMapping> | undefined): boolean {
  return !!(p && (p.entity_id || p.nickname || p.hidden || p.owner_kind === "person" || p.owner_kind === "joint" || p.books_through));
}

/**
 * The one saved mapping this live account should take over, or null. Only a
 * mapping whose own account is no longer reported (or a duplicate of this
 * account under another connection) qualifies, one already continued by
 * another account doesn't, and more than one candidate means none: an
 * account arriving unmapped is a visible prompt, whereas one mapped to the
 * wrong entity quietly corrupts a P&L.
 */
export function pickAdoption(account: Identity, saved: SavedMapping[], liveIds: Set<string>): SavedMapping | null {
  const own = saved.find((p) => p.account_id === account.account_id);
  // Already mapped in its own right (a choice made on this account itself).
  if (own && (own.entity_id || own.nickname || own.hidden || own.owner_kind === "person" || own.owner_kind === "joint")) return null;
  const candidates = saved.filter(
    (p) =>
      p.account_id !== account.account_id &&
      p.institution_name === account.institution_name &&
      p.mask === account.mask &&
      p.subtype === account.subtype &&
      carriesMeaning(p) &&
      !liveIds.has(p.account_id) &&
      (!p.successor_account_id || p.successor_account_id === account.account_id),
  );
  return candidates.length === 1 ? candidates[0] : null;
}
