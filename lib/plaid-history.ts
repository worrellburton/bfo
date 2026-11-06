/**
 * What Treasury keeps when a bank stops syncing, and how it measures change.
 * Pure functions for api/plaid/disconnect.ts, api/plaid/prune-accounts.ts and
 * api/plaid/data.ts, tested in tests/plaid-history.test.ts without a network.
 *
 * HTTP surface: none; a library.
 * Who may call it: server code, after the endpoint's own role check.
 * Env: none.
 *
 * The rule this file holds: an account that stops syncing keeps its Books
 * ledger (Plaid rows and CSV imports alike), its mapping and its last known
 * balance. Nothing here deletes a transaction. Treasury marks the account
 * instead (plaid_account_prefs.disconnected_at), and a reconnect links the new
 * account to the old one (lib/plaid-mappings.ts).
 */

/** Plaid error codes that mean the connection is already gone at Plaid, so it is as good as revoked. */
const ALREADY_GONE = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

/**
 * How a Plaid /item/remove call ended. Only "revoked" or "already_gone" let a
 * disconnect go ahead; on "failed" the connection is left exactly as it was,
 * so BFO never forgets a token for a link that is still live at the bank.
 */
export function revocationOutcome(err: unknown): "revoked" | "already_gone" | "failed" {
  if (!err) return "revoked";
  const code = (err as { response?: { data?: { error_code?: unknown } } })?.response?.data?.error_code;
  return typeof code === "string" && ALREADY_GONE.has(code) ? "already_gone" : "failed";
}

export type BookSpan = { count: number; from: string | null; to: string | null };

/** Per account, how many Books transactions it holds and the dates they span. */
export function bookSpans(rows: Array<{ account_id: string; date: string | null }>): Map<string, BookSpan> {
  const out = new Map<string, BookSpan>();
  for (const r of rows) {
    if (!r.account_id) continue;
    const s = out.get(r.account_id) ?? { count: 0, from: null, to: null };
    s.count += 1;
    const d = r.date ? r.date.slice(0, 10) : null;
    if (d) {
      if (!s.from || d < s.from) s.from = d;
      if (!s.to || d > s.to) s.to = d;
    }
    out.set(r.account_id, s);
  }
  return out;
}

/** Several spans as one (a connection's accounts together). */
export function totalSpan(spans: Iterable<BookSpan>): BookSpan {
  const t: BookSpan = { count: 0, from: null, to: null };
  for (const s of spans) {
    t.count += s.count;
    if (s.from && (!t.from || s.from < t.from)) t.from = s.from;
    if (s.to && (!t.to || s.to > t.to)) t.to = s.to;
  }
  return t;
}

export type KeptState = { balance: number | null; seen_at: string | null };
export type KeptPref = { entity_id?: string | null; nickname?: string | null; hidden?: boolean | null; disconnected_at?: string | null } | undefined;

export type KeepRow = {
  account_id: string;
  disconnected_at: string;
  disconnected_reason: "disconnected" | "not_shared";
  last_balance: number | null;
  last_balance_at: string | null;
  books_through: string | null;
  archived_at: null;
  updated_at: string;
};

/**
 * The prefs rows that mark accounts as no longer syncing, keeping their
 * history. `archive` lists the accounts with nothing to keep (no Books rows,
 * no mapping, no nickname): those may be archived as before, since there is
 * no ledger behind them.
 *
 * An account already marked keeps its first stop date: a second run (a retry,
 * or prune after a disconnect) doesn't move it.
 */
export function keepPlan(input: {
  accountIds: Iterable<string>;
  reason: "disconnected" | "not_shared";
  states: Map<string, KeptState>;
  prefs: Map<string, KeptPref>;
  spans: Map<string, BookSpan>;
  now: Date;
  /** Disconnect keeps every account; prune may archive the empty ones. */
  keepEmpty: boolean;
}): { keep: KeepRow[]; archive: string[] } {
  const keep: KeepRow[] = [];
  const archive: string[] = [];
  const nowIso = input.now.toISOString();
  for (const id of new Set(input.accountIds)) {
    const pref = input.prefs.get(id);
    const span = input.spans.get(id);
    const meaningful = !!(pref && (pref.entity_id || pref.nickname || pref.hidden));
    if (!input.keepEmpty && !meaningful && !(span && span.count > 0)) {
      archive.push(id);
      continue;
    }
    const state = input.states.get(id);
    keep.push({
      account_id: id,
      disconnected_at: pref?.disconnected_at ?? nowIso,
      disconnected_reason: input.reason,
      last_balance: state?.balance ?? null,
      last_balance_at: state?.seen_at ?? null,
      books_through: span?.to ?? null,
      archived_at: null,
      updated_at: nowIso,
    });
  }
  return { keep, archive };
}

/**
 * Each account's prior close: its balance on the latest recorded day before
 * `today` (YYYY-MM-DD). A change is measured against this fixed point, the
 * same for every viewer, never "since someone last looked".
 */
export function priorClose(rows: Array<{ account_id: string; day: string; balance: number | string | null }>, today: string): Map<string, { day: string; balance: number }> {
  const out = new Map<string, { day: string; balance: number }>();
  for (const r of rows) {
    if (r.balance === null || r.balance === undefined || r.day >= today) continue;
    const prev = out.get(r.account_id);
    if (!prev || r.day > prev.day) out.set(r.account_id, { day: r.day, balance: Number(r.balance) });
  }
  return out;
}

export type HeadlineAccount = { type: string | null; balance_current: number | null; hidden?: boolean };

/**
 * Treasury's headline from the accounts it is shown: cash (deposits),
 * invested (brokerage market value), owed (cards and loans, as owed), other,
 * and net = cash + invested + other − owed. Hidden accounts are counted apart,
 * so the headline never moves with a display toggle and the page can say what
 * it leaves out.
 */
export function headline(accounts: HeadlineAccount[]) {
  const t = { cash: 0, invested: 0, owed: 0, other: 0, net: 0, accounts: 0, hidden: { count: 0, net: 0 } };
  for (const a of accounts) {
    const v = a.balance_current ?? 0;
    const debt = a.type === "credit" || a.type === "loan";
    const signedValue = debt ? -v : v;
    if (a.hidden) {
      t.hidden.count += 1;
      t.hidden.net += signedValue;
      continue;
    }
    t.accounts += 1;
    if (a.type === "depository") t.cash += v;
    else if (a.type === "investment" || a.type === "brokerage") t.invested += v;
    else if (debt) t.owed += v;
    else t.other += v;
  }
  t.net = t.cash + t.invested + t.other - t.owed;
  return t;
}

/**
 * Investment income by Plaid's transaction subtype, matched exactly. A
 * `distribution` (money leaving an IRA) and contributions, deposits and
 * withdrawals are flows, not income. Reinvestments are the same money bought
 * back, so they are skipped to count income once.
 */
export function incomeKind(type: string | null | undefined, subtype: string | null | undefined): "dividend" | "interest" | "capital_gain" | null {
  const t = (type ?? "").toLowerCase().trim();
  const s = (subtype ?? "").toLowerCase().trim();
  if (t === "buy" || t === "sell" || /reinvest/.test(s)) return null;
  if (s === "dividend" || s === "qualified dividend" || s === "non-qualified dividend") return "dividend";
  if (s === "interest" || s === "interest receivable") return "interest";
  if (s === "long-term capital gain" || s === "short-term capital gain") return "capital_gain";
  return null;
}

/**
 * Income from one investment transaction, with its sign kept: Plaid reports
 * cash credited as a negative amount, so income is −amount, and a reversal
 * (cash debited back) reduces income instead of adding to it.
 */
export function incomeAmount(amount: number): number {
  return -amount;
}
