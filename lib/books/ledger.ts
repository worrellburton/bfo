/**
 * The ledger's controls, as pure functions: how a taught rule matches a row
 * and which rule wins, whether a row sits in a closed period, what a bulk
 * change will touch before it runs, and the history rows a change writes.
 * The write paths (lib/books/writes.ts, lib/books-rules.ts patchMatching,
 * api/books/import-csv.ts, api/cron/books-sync.ts) do the I/O around these,
 * so the rules themselves are tested without a database.
 *
 * HTTP surface: none; a library for the Books endpoints and the bank sync.
 * Who may call it: server code (it has no I/O).
 * Env: none.
 */

// ── Taught rules: matching and precedence ───────────────────────────────────

/**
 * How a rule's text is compared with a row.
 *   vendor   — the payee is exactly this name (case and spacing aside). What
 *              "apply to all" and a vendor's default make, so "Revenu" never
 *              reaches "Internal Revenue Service".
 *   contains — these words appear in the payee, on word boundaries, so "Pilot"
 *              doesn't reach "Pilotage" and "Revenu" doesn't reach "Revenue".
 * Rules saved before match_kind existed read as "contains".
 */
export type MatchKind = "vendor" | "contains";

export type TaughtRule = {
  id?: string;
  match: string;
  match_kind?: MatchKind | string | null;
  book_category?: string | null;
  vendor_name?: string | null;
  type_override?: string | null;
  loan_id?: string | null;
  scope_entity_id?: string | null;
  effective_from?: string | null;
  created_at?: string | null;
};

export type RuleRow = { name: string | null; merchant_name: string | null; date?: string | null; entity_id?: string | null };

const MERCURY_PAYEE = /via mercury\.com;\s*merchant name:\s*(.+)$/i;

/**
 * The other party to a row: for a Mercury row only the payee segment (its
 * description leads with the family's own entity, which names the payer, not
 * who was paid); otherwise the merchant and the description together.
 */
export function payeeText(name: string | null, merchant: string | null): string {
  const m = (name ?? "").match(MERCURY_PAYEE);
  if (m) return m[1].trim();
  return `${merchant ?? ""} ${name ?? ""}`.trim();
}

/** Lower case, punctuation-insensitive spacing: the form names are compared in. */
export function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

const WORD = /[a-z0-9]/i;

/**
 * `needle` appears in `hay` starting and ending on word boundaries. A side
 * of the needle that is itself punctuation ("gc<>revenu", "ref #") needs no
 * boundary there.
 */
export function containsWords(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  const startWord = WORD.test(n[0]);
  const endWord = WORD.test(n[n.length - 1]);
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + 1)) {
    const before = i === 0 ? "" : h[i - 1];
    const after = i + n.length >= h.length ? "" : h[i + n.length];
    const okStart = !startWord || !before || !WORD.test(before);
    const okEnd = !endWord || !after || !WORD.test(after);
    if (okStart && okEnd) return true;
  }
  return false;
}

export function kindOf(rule: Pick<TaughtRule, "match_kind">): MatchKind {
  return rule.match_kind === "vendor" ? "vendor" : "contains";
}

/** Whether a taught rule applies to a row (its text, its entity scope and its start date). */
export function ruleMatches(rule: TaughtRule, row: RuleRow): boolean {
  const needle = normName(rule.match);
  if (needle.length < 2) return false;
  if (rule.scope_entity_id && row.entity_id !== undefined && row.entity_id !== rule.scope_entity_id) return false;
  if (rule.effective_from && row.date && row.date < rule.effective_from) return false;
  const payee = payeeText(row.name, row.merchant_name);
  if (kindOf(rule) === "vendor") {
    return needle === normName(row.merchant_name) || needle === normName(payee);
  }
  return containsWords(payee, needle);
}

/**
 * The order rules are tried in, and the order the Rules page shows: an exact
 * payee before words in a payee, then the longer (more specific) text first,
 * then the older rule, then the id, so two runs never disagree.
 */
export function orderRules<T extends TaughtRule>(rules: T[]): T[] {
  return [...rules].sort((a, b) => {
    const ka = kindOf(a) === "vendor" ? 0 : 1;
    const kb = kindOf(b) === "vendor" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    const la = normName(a.match).length;
    const lb = normName(b.match).length;
    if (la !== lb) return lb - la;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id ?? a.match).localeCompare(String(b.id ?? b.match));
  });
}

/** The first rule (in `orderRules` order) that sets `field` and matches the row. */
export function firstRule<T extends TaughtRule>(ordered: T[], row: RuleRow, field: "book_category" | "vendor_name" | "type_override" | "loan_id"): T | null {
  for (const r of ordered) if (r[field] && ruleMatches(r, row)) return r;
  return null;
}

/**
 * For each rule, the other rules that match at least one of the same rows:
 * the overlaps the Rules page warns about, with the winner first.
 */
export function overlaps<T extends TaughtRule & { id: string }>(rules: T[], rows: RuleRow[]): Map<string, string[]> {
  const ordered = orderRules(rules);
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const hits = ordered.filter((r) => ruleMatches(r, row));
    if (hits.length < 2) continue;
    for (const r of hits) {
      const set = out.get(r.id) ?? out.set(r.id, new Set()).get(r.id)!;
      for (const o of hits) if (o.id !== r.id) set.add(o.id);
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

// ── The period lock ────────────────────────────────────────────────────────

/** One active close: `entity_id` null closes every entity's books. */
export type PeriodLock = { entity_id: string | null; closed_through: string };

/** The date a row's books are closed through: the later of its entity's close and the office-wide one. */
export function closedThrough(locks: PeriodLock[], entityId: string | null | undefined): string | null {
  let best: string | null = null;
  for (const l of locks) {
    if (l.entity_id !== null && l.entity_id !== (entityId ?? null)) continue;
    if (!best || l.closed_through > best) best = l.closed_through;
  }
  return best;
}

/** Whether a row (dated, with its entity) falls on or before its closed-through date. */
export function isLocked(row: { date: string; entity_id?: string | null }, locks: PeriodLock[]): boolean {
  const through = closedThrough(locks, row.entity_id);
  return !!through && row.date <= through;
}

/** The current active locks: per entity, the latest close that hasn't been reopened. */
export function activeLocks(rows: Array<PeriodLock & { reopened_at?: string | null }>): PeriodLock[] {
  const best = new Map<string, PeriodLock>();
  for (const r of rows) {
    if (r.reopened_at) continue;
    const key = r.entity_id ?? "*";
    const cur = best.get(key);
    if (!cur || r.closed_through > cur.closed_through) best.set(key, { entity_id: r.entity_id ?? null, closed_through: r.closed_through });
  }
  return [...best.values()];
}

// ── What a bulk change will touch ──────────────────────────────────────────

export type PreviewRow = {
  transaction_id: string;
  date: string;
  amount: number;
  name?: string | null;
  merchant_name?: string | null;
  entity_name?: string | null;
  book_category?: string | null;
};

export type Preview = {
  /** Rows that will change. */
  count: number;
  /** Their net, money in positive (Plaid signs money out positive). */
  net: number;
  money_in: number;
  money_out: number;
  first: string | null;
  last: string | null;
  entities: string[];
  /** Rows a person changed by hand (left alone when asked). */
  edited: number;
  /** Rows in a closed period (always left alone). */
  locked: number;
  /** Rows dated before this calendar year. */
  prior_years: number;
  /** Up to five rows, newest first, for the dialog. */
  sample: PreviewRow[];
};

export function previewOf(rows: PreviewRow[], opts: { edited?: Set<string>; locked?: Set<string>; skipEdited?: boolean; year?: number } = {}): Preview {
  const edited = opts.edited ?? new Set<string>();
  const locked = opts.locked ?? new Set<string>();
  const year = String(opts.year ?? new Date().getUTCFullYear());
  const live = rows.filter((r) => !locked.has(r.transaction_id) && !(opts.skipEdited && edited.has(r.transaction_id)));
  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of live) {
    if (r.amount < 0) moneyIn += -r.amount;
    else moneyOut += r.amount;
  }
  const dates = live.map((r) => r.date).sort();
  const entities = [...new Set(live.map((r) => r.entity_name).filter((e): e is string => !!e))].sort();
  return {
    count: live.length,
    net: round2(moneyIn - moneyOut),
    money_in: round2(moneyIn),
    money_out: round2(moneyOut),
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    entities,
    edited: rows.filter((r) => edited.has(r.transaction_id) && !locked.has(r.transaction_id)).length,
    locked: rows.filter((r) => locked.has(r.transaction_id)).length,
    prior_years: live.filter((r) => r.date.slice(0, 4) < year).length,
    sample: [...live].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 5),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── History rows ───────────────────────────────────────────────────────────

/** The fields a person sets on a row. A history entry for one of them (not from the sync) protects the row from the next bank sync. */
export const GUARDED_FIELDS = new Set(["book_category", "type_override", "merchant_name", "loan_id", "memo"]);

/** Whether a history entry marks a hand edit the sync must keep. */
export function isHandEdit(entry: { field: string; source?: string | null }): boolean {
  return GUARDED_FIELDS.has(entry.field) && entry.source !== "sync";
}

export type Actor = { id: string; name: string | null } | null;

export type LogRow = {
  transaction_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  actor: string | null;
  actor_name: string | null;
};

const asText = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/**
 * One history row per field that really changed on each row. `before` holds
 * each row's values before the change; a row missing from it logs the new
 * value with no old one (never invented).
 */
export function logRowsFor(ids: string[], before: Map<string, Record<string, unknown>> | null, patch: Record<string, unknown>, source: string, actor: Actor): LogRow[] {
  const out: LogRow[] = [];
  for (const id of ids) {
    const prior = before?.get(id) ?? null;
    for (const [field, next] of Object.entries(patch)) {
      const prev = prior ? prior[field] : undefined;
      if (prior && String(prev ?? "") === String(next ?? "")) continue;
      out.push({
        transaction_id: id,
        field,
        old_value: asText(prev),
        new_value: asText(next),
        source,
        actor: actor?.id ?? null,
        actor_name: actor?.name ?? null,
      });
    }
  }
  return out;
}

/**
 * The values an Undo puts back: for each row, every changed field's value
 * before the change. Only fields a person can set are restorable.
 */
export function undoOf(ids: string[], before: Map<string, Record<string, unknown>>, patch: Record<string, unknown>): Array<{ transaction_id: string; values: Record<string, unknown> }> {
  const fields = Object.keys(patch).filter((f) => RESTORABLE.has(f));
  const out: Array<{ transaction_id: string; values: Record<string, unknown> }> = [];
  for (const id of ids) {
    const prior = before.get(id);
    if (!prior) continue;
    const values: Record<string, unknown> = {};
    for (const f of fields) if (String(prior[f] ?? "") !== String(patch[f] ?? "")) values[f] = prior[f] ?? null;
    if (Object.keys(values).length) out.push({ transaction_id: id, values });
  }
  return out;
}

/** Fields an Undo may set back (the mechanical type flags ride with the account). */
export const RESTORABLE = new Set(["book_category", "type_override", "merchant_name", "loan_id", "memo", "txn_type", "intercompany"]);

// ── Signs and sections ─────────────────────────────────────────────────────

/**
 * A word on the sign when it contradicts the account's section: money out
 * filed to a revenue account, or money in to an expense. Null when they
 * agree (or the account isn't income or expense).
 */
export function signWarning(category: string | null | undefined, moneyIn: boolean): string | null {
  const code = String(category ?? "").trim()[0];
  if (code === "4" && !moneyIn) return "Money out filed to an income account. If this is a refund of income, that’s right; otherwise choose an expense.";
  if ((code === "6" || code === "7") && moneyIn) return "Money in filed to an expense account. If this is a refund, that’s right; otherwise choose an income account.";
  return null;
}
