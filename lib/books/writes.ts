import { audit } from "../audit.js";
import { sbFetch as db, isAdmin, type AppUser } from "../auth.js";
import { fetchAll } from "../db-pages.js";
import { findMatching, patchRows, typeForCategory, type MatchedRow } from "../books-rules.js";
import { HISTORY_FAILED, editedAmong, hasHistory, logChanges, writeLog } from "./audit.js";
import { isMissingColumn, isMissingTable, readEntityMap, readLocks, writeTolerant } from "./db.js";
import { RESTORABLE, closedThrough, isLocked, logRowsFor, normName, previewOf, ruleMatches, undoOf, type Actor, type MatchKind, type PeriodLock, type TaughtRule } from "./ledger.js";
import { fail, ok, type BookTxn, type Query, type Reply, type WriteCtx } from "./types.js";

/**
 * Books edits: a person reclassifying transactions, teaching the books a
 * rule, keeping the loan registry, and closing a period. Every change that
 * touches transactions:
 *   - refuses rows dated on or before their entity's closed-through date
 *     (books_periods; an admin reopens a period with a reason);
 *   - writes one history row per field per transaction, with the old value,
 *     the new one, the source ("edit", "batch", "rule:<id>", "vendor",
 *     "undo", "loan") and the person (lib/books/audit.ts);
 *   - writes one line to the shared audit trail for anything that touches
 *     more than one row or a rule (lib/audit.ts);
 *   - hands back what an Undo needs (the values before).
 *
 * HTTP surface: POST /api/books/data {action, …} (the plain
 * {transaction_id, …} edit is the default) and POST /api/books/ledger for
 * the actions added with the ledger controls; GET /api/books/ledger for the
 * previews and the period list. The routers only dispatch here.
 * Who may call it: anyone who can write (canWrite); closing and reopening a
 * period is for admins.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sbFetch).
 */

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const TYPES = ["normal", "transfer", "intercompany"];
const isoDay = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const actorOf = (user: AppUser): Actor => ({ id: user.id, name: user.name ?? null });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const shortAccount = (c: string) => c.replace(/^\d{4}\s+/, "");

/** The columns a change reads first: what it may set, plus the date and account for the lock. */
const ROW_COLUMNS = "transaction_id,account_id,date,amount,name,merchant_name,book_category,type_override,loan_id,txn_type,intercompany";

/**
 * Booking rows to an account also settles their mechanical type: a P&L
 * account means income or expense, 9000 means intercompany, the other 9000s
 * a transfer. Without this a row refiled from Internal Transfers to
 * Salaries & Wages stayed a transfer and never reached the P&L.
 */
export function categoryPatch(category: string | null): Record<string, unknown> {
  const implied = typeForCategory(category);
  if (!category || !implied) return { book_category: category };
  return {
    book_category: category,
    intercompany: implied === "intercompany",
    txn_type: implied === "normal" ? "normal" : "transfer",
    // An earlier type override would otherwise keep a refiled transfer off
    // the P&L; a type chosen in the same change is applied after this.
    type_override: null,
  };
}

// ── Shared: the lock, the rows, the history ────────────────────────────────

type Ledger = { locks: PeriodLock[]; entities: Map<string, { id: string | null; name: string | null }> };

async function ledger(): Promise<Ledger> {
  const [locks, entities] = await Promise.all([readLocks(db), readEntityMap(db)]);
  return { locks, entities };
}

const entityOf = (l: Ledger) => (accountId: string) => l.entities.get(accountId) ?? null;
const lockedRow = (l: Ledger) => (row: { date: string; account_id: string }) => isLocked({ date: row.date, entity_id: l.entities.get(row.account_id)?.id ?? null }, l.locks);

/** The answer when a change reaches into a closed period. */
function closedReply(l: Ledger, rows: Array<{ date: string; account_id: string }>, total: number): Reply {
  const through = rows.map((r) => closedThrough(l.locks, l.entities.get(r.account_id)?.id ?? null)).filter((d): d is string => !!d).sort();
  const last = through[through.length - 1] ?? null;
  return fail(409, {
    error: "period_closed",
    locked: rows.length,
    closed_through: last,
    message:
      total === 1
        ? `That transaction is in a closed period${last ? ` (closed through ${last})` : ""}. An admin can reopen the period.`
        : `${plural(rows.length, "of these is", "of these are")} in a closed period${last ? ` (closed through ${last})` : ""}. An admin can reopen the period, or leave those out.`,
  });
}

/** Rows by id, every page, with the columns a change reads first. */
async function rowsById(ids: string[]): Promise<MatchedRow[]> {
  const out: MatchedRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const list = ids
      .slice(i, i + 200)
      .map((id) => `"${id.replace(/"/g, "")}"`)
      .join(",");
    out.push(...(await fetchAll<MatchedRow>(`book_transactions?transaction_id=in.(${list})&select=${ROW_COLUMNS}&order=transaction_id.asc`, db)));
  }
  return out.map((r) => ({ ...r, amount: Number(r.amount) }));
}

// ── Rules: read, write, find ───────────────────────────────────────────────

type StoredRule = TaughtRule & { id: string; created_by?: string | null; created_by_name?: string | null; reason?: string | null };

/** The current non-loan rule whose text equals `match`, ignoring case. */
async function findRule(match: string): Promise<StoredRule | undefined> {
  // By exact (case-insensitive) text rather than an ilike, which would
  // mis-handle _ % and other metacharacters.
  const existing = await db("book_rules?select=*&loan_id=is.null");
  if (!existing.ok) return undefined;
  return ((await existing.json()) as StoredRule[]).find((x) => normName(x.match) === normName(match));
}

/** Columns the ledger migration added to book_rules (dropped on write until it's applied). */
const RULE_EXTRAS = ["created_by", "created_by_name", "reason", "match_kind", "scope_entity_id", "effective_from", "updated_at"];

async function insertRule(row: Record<string, unknown>): Promise<StoredRule | null> {
  const r = await writeTolerant(db, "book_rules", "POST", row, RULE_EXTRAS, { Prefer: "return=representation" });
  if (!r.ok) {
    console.error("books: rule save failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return null;
  }
  return (((await r.json()) as StoredRule[])[0] ?? null) as StoredRule | null;
}

const matchKindOf = (v: unknown, fallback: MatchKind): MatchKind => (v === "vendor" || v === "contains" ? v : fallback);

/** What a rule does, in words, for summaries. */
function ruleEffect(r: { book_category?: string | null; vendor_name?: string | null; type_override?: string | null; loan_id?: string | null }): string {
  const bits: string[] = [];
  if (r.book_category) bits.push(`file under ${shortAccount(r.book_category)}`);
  if (r.vendor_name) bits.push(`rename to ${r.vendor_name}`);
  if (r.type_override) bits.push(`mark as ${r.type_override === "intercompany" ? "intercompany" : r.type_override === "transfer" ? "a transfer" : "income or expense"}`);
  if (r.loan_id) bits.push("attach to a loan");
  return bits.join(", ") || "nothing";
}

// ── Preview: what a bulk change will touch, before it runs ─────────────────

/**
 * GET preview: the rows a rule text would reach, counted and spanned, with
 * how many are hand-edited or in a closed period, a sample, and the other
 * rules that already reach the same rows. The categorize, vendor-default
 * and merge dialogs show this before anything changes.
 */
export async function previewMatch(query: Query): Promise<Reply> {
  const match = String(query.match ?? "")
    .trim()
    .slice(0, 200);
  if (normName(match).length < 2) return fail(400, { error: "missing_match" });
  const kind = matchKindOf(query.match_kind, "contains");
  const l = await ledger();
  const rows = await findMatching(db, { match, match_kind: kind }, "", entityOf(l));
  const ids = rows.map((r) => r.transaction_id);
  const [edited, rules] = await Promise.all([editedAmong(ids), fetchAll<StoredRule>("book_rules?select=*&order=id.asc")]);
  const locked = new Set(rows.filter(lockedRow(l)).map((r) => r.transaction_id));
  const preview = previewOf(rows, { edited, locked });
  const others = rules
    .filter((r) => normName(r.match) !== normName(match) && rows.some((t) => ruleMatches(r, { name: t.name, merchant_name: t.merchant_name, date: t.date, entity_id: t.entity_id ?? null })))
    .slice(0, 8)
    .map((r) => ({ id: r.id, match: r.match, effect: ruleEffect(r) }));
  const existing = rules.find((r) => !r.loan_id && normName(r.match) === normName(match)) ?? null;
  return ok({ match, match_kind: kind, preview, overlaps: others, rule: existing ? { id: existing.id, match: existing.match, effect: ruleEffect(existing), book_category: existing.book_category ?? null } : null });
}

/**
 * Apply a patch to the rows a rule reaches, leaving out closed periods (and
 * hand-edited rows when asked), then log each row and return the Undo.
 */
async function applyRule(
  user: AppUser,
  rule: TaughtRule,
  patch: Record<string, unknown>,
  source: string,
  opts: { skipEdited?: boolean; baseFilter?: string } = {},
): Promise<{ applied: number; skipped_locked: number; skipped_edited: number; failed: number; ids: string[]; undo: ReturnType<typeof undoOf>; logged: boolean }> {
  const l = await ledger();
  const rows = await findMatching(db, rule, opts.baseFilter ?? "", entityOf(l));
  const locked = new Set(rows.filter(lockedRow(l)).map((r) => r.transaction_id));
  const edited = opts.skipEdited ? await editedAmong(rows.map((r) => r.transaction_id)) : new Set<string>();
  const todo = rows.filter((r) => !locked.has(r.transaction_id) && !(opts.skipEdited && edited.has(r.transaction_id)));
  const done = await patchRows(db, todo, patch);
  const logged = await writeLog(logRowsFor(done.ids, done.before, patch, source, actorOf(user)));
  return {
    applied: done.applied,
    skipped_locked: locked.size,
    skipped_edited: opts.skipEdited ? rows.filter((r) => edited.has(r.transaction_id) && !locked.has(r.transaction_id)).length : 0,
    failed: done.failed,
    ids: done.ids,
    undo: undoOf(done.ids, done.before, patch),
    logged,
  };
}

// ── Loan registry ──────────────────────────────────────────────────────────

/** Loan fields the ledger migration added (dropped on write until it's applied). */
const LOAN_EXTRAS = ["direction", "holder_entity_id", "holder_entity_name", "counterparty", "rate", "start_date", "maturity_date", "starting_balance_as_of", "hidden_reason", "created_by", "created_by_name"];

/** The loan fields a body may set, validated. Returns an error Reply instead when one is wrong. */
function loanFields(body: Record<string, unknown>): Record<string, unknown> | Reply {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) return fail(400, { error: "missing_name", message: "Give the loan a name." });
    out.name = name;
  }
  if (body.starting_balance !== undefined) {
    const n = Number(body.starting_balance);
    if (!Number.isFinite(n)) return fail(400, { error: "invalid_balance", message: "Enter the starting balance as a number." });
    out.starting_balance = Math.round(n * 100) / 100;
  }
  for (const k of ["starting_balance_as_of", "start_date", "maturity_date"] as const) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === "") out[k] = null;
    else if (isoDay(body[k])) out[k] = body[k];
    else return fail(400, { error: "invalid_date", message: "Use a date like 2026-01-31." });
  }
  if (body.rate !== undefined) {
    if (body.rate === null || body.rate === "") out.rate = null;
    else {
      const r = Number(body.rate);
      if (!Number.isFinite(r) || r < 0 || r > 100) return fail(400, { error: "invalid_rate", message: "Enter the interest rate as a percentage between 0 and 100." });
      out.rate = r;
    }
  }
  if (body.direction !== undefined) {
    if (body.direction !== "receivable" && body.direction !== "payable") return fail(400, { error: "invalid_direction" });
    out.direction = body.direction;
  }
  for (const k of ["holder_entity_id", "holder_entity_name", "counterparty", "notes"] as const) {
    if (body[k] !== undefined) out[k] = body[k] === null ? null : String(body[k]).trim().slice(0, k === "notes" ? 1000 : 120) || null;
  }
  return out;
}

const isReply = (v: unknown): v is Reply => !!v && typeof v === "object" && "status" in v && "body" in v;

export async function createLoan({ body, user }: WriteCtx): Promise<Reply> {
  const fields = loanFields(body ?? {});
  if (isReply(fields)) return fields;
  if (!fields.name) return fail(400, { error: "missing_name", message: "Give the loan a name." });
  const row = { starting_balance: 0, ...fields, created_by: user.id, created_by_name: user.name ?? null };
  const r = await writeTolerant(db, "book_loans", "POST", row, LOAN_EXTRAS, { Prefer: "return=representation" });
  if (!r.ok) {
    console.error("create loan failed:", (await r.text()).slice(0, 300));
    return fail(500, { error: "create_failed", message: "Couldn't create that loan." });
  }
  const loan = ((await r.json()) as Array<Record<string, unknown>>)[0];
  await audit({
    actor: user,
    action: "books.loan_create",
    target: { type: "book_loan", id: String(loan?.id ?? ""), label: String(fields.name) },
    summary: `Added the loan ${String(fields.name)} with a starting balance of $${Number(row.starting_balance).toFixed(2)}`,
    detail: { after: fields },
  });
  return ok({ loan });
}

export async function updateLoan({ body, user }: WriteCtx): Promise<Reply> {
  const loanId = String(body?.loan_id ?? "");
  if (!isUuid(loanId)) return fail(400, { error: "missing_loan_id" });
  const fields = loanFields(body ?? {});
  if (isReply(fields)) return fields;
  const patch: Record<string, unknown> = { ...fields };
  if (body.show_on_report !== undefined) {
    patch.show_on_report = !!body.show_on_report;
    if (!body.show_on_report) {
      // Hiding a receivable from the Treasury report needs a reason on record.
      const reason = String(body.hidden_reason ?? "")
        .trim()
        .slice(0, 300);
      if (reason.length < 3) return fail(400, { error: "missing_reason", message: "Say why this loan is left off the Treasury report." });
      patch.hidden_reason = reason;
    } else patch.hidden_reason = null;
  }
  if (body.archived !== undefined) patch.archived_at = body.archived ? new Date().toISOString() : null;
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });
  const beforeRes = await db(`book_loans?id=eq.${loanId}&select=*&limit=1`);
  const before = beforeRes.ok ? ((((await beforeRes.json()) as Array<Record<string, unknown>>)[0] ?? null) as Record<string, unknown> | null) : null;
  const r = await writeTolerant(db, `book_loans?id=eq.${loanId}`, "PATCH", patch, LOAN_EXTRAS, { Prefer: "return=representation" });
  if (!r.ok) return fail(500, { error: "update_failed", message: "Couldn't save that loan." });
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return fail(404, { error: "not_found" });
  const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, { from: before?.[k] ?? null, to: patch[k] }]));
  await audit({
    actor: user,
    action: "books.loan_update",
    target: { type: "book_loan", id: loanId, label: String(rows[0].name ?? "") },
    summary: `Changed the loan ${String(rows[0].name ?? "")}: ${Object.keys(patch)
      .map((k) => k.replace(/_/g, " "))
      .join(", ")}`,
    detail: { changed, reason: patch.hidden_reason ?? null },
  });
  return ok({ loan: rows[0] });
}

// ── Auto-attach rule: descriptions containing X belong to this loan ───────

export async function loanRule({ body, user }: WriteCtx): Promise<Reply> {
  const match = String(body?.match ?? "")
    .trim()
    .slice(0, 120);
  const loanId = String(body?.loan_id ?? "");
  if (!match || match.length < 3) return fail(400, { error: "match_too_short", message: "Use at least 3 characters." });
  if (!isUuid(loanId)) return fail(400, { error: "missing_loan_id" });

  const rule = await insertRule({ match, loan_id: loanId, match_kind: "contains", created_by: user.id, created_by_name: user.name ?? null, reason: body.reason ? String(body.reason).slice(0, 300) : null });
  if (!rule) return fail(500, { error: "rule_failed", message: "Couldn't save that rule." });

  // Attach every synced row not on a loan yet that the rule reaches, outside closed periods.
  const out = await applyRule(user, rule, { loan_id: loanId }, `rule:${rule.id}`, { baseFilter: "loan_id=is.null" });
  await audit({
    actor: user,
    action: "books.loan_rule",
    target: { type: "book_rule", id: rule.id, label: match },
    count: out.applied,
    summary: `Attached ${plural(out.applied, "transaction")} containing “${match}” to a loan, and will attach new ones`,
    detail: { loan_id: loanId, ids: out.ids.slice(0, 50), skipped_locked: out.skipped_locked },
  });
  return ok({ rule, attached: out.applied, skipped_locked: out.skipped_locked, undo: out.undo });
}

/**
 * Delete a rule. Rows it already filed keep their account (they carry its
 * history, so the sync keeps them). The whole rule goes into the audit
 * trail, so it can be restored (restoreRule) and the record stays.
 */
export async function deleteRule({ body, user }: WriteCtx): Promise<Reply> {
  const ruleId = String(body?.rule_id ?? "");
  if (!isUuid(ruleId)) return fail(400, { error: "missing_rule_id" });
  const read = await db(`book_rules?id=eq.${ruleId}&select=*&limit=1`);
  const rule = read.ok ? ((((await read.json()) as StoredRule[])[0] ?? null) as StoredRule | null) : null;
  const del = await db(`book_rules?id=eq.${ruleId}`, { method: "DELETE" });
  if (!del.ok) {
    console.error("rule delete failed:", (await del.text()).slice(0, 200));
    return fail(500, { error: "rule_failed", message: "Couldn't delete that rule." });
  }
  if (rule) {
    await audit({
      actor: user,
      action: "books.rule_delete",
      target: { type: "book_rule", id: ruleId, label: rule.match },
      summary: `Deleted the rule “${rule.match}” (${ruleEffect(rule)})`,
      detail: { rule },
    });
  }
  return ok({ deleted: true, rule });
}

/** Put a deleted rule back (the Undo after a delete): the same text and effect, a new id. */
export async function restoreRule({ body, user }: WriteCtx): Promise<Reply> {
  const r = (body?.rule ?? {}) as Record<string, unknown>;
  const match = String(r.match ?? "")
    .trim()
    .slice(0, 200);
  if (normName(match).length < 2) return fail(400, { error: "missing_match" });
  const row: Record<string, unknown> = {
    match,
    book_category: r.book_category ? String(r.book_category).slice(0, 60) : null,
    vendor_name: r.vendor_name ? String(r.vendor_name).slice(0, 80) : null,
    type_override: TYPES.includes(String(r.type_override)) ? r.type_override : null,
    loan_id: r.loan_id && isUuid(String(r.loan_id)) ? r.loan_id : null,
    match_kind: matchKindOf(r.match_kind, "contains"),
    reason: r.reason ? String(r.reason).slice(0, 300) : null,
    created_by: user.id,
    created_by_name: user.name ?? null,
  };
  if (await findRule(match)) return fail(409, { error: "rule_exists", message: "A rule with that text already exists." });
  const saved = await insertRule(row);
  if (!saved) return fail(500, { error: "rule_failed", message: "Couldn't restore that rule." });
  await audit({ actor: user, action: "books.rule_restore", target: { type: "book_rule", id: saved.id, label: match }, summary: `Restored the rule “${match}”`, detail: { rule: row } });
  return ok({ rule: saved });
}

// ── "All of these, and from now on": a rule, and the rows it reaches ──────

/**
 * Teach the books: store a rule (replacing an earlier rule with the same
 * text) and refile what it reaches. `match_kind` "vendor" reaches the payee
 * exactly; "contains" its words. Closed periods are left alone, and with
 * `skip_edited` so are rows a person changed by hand. `apply: false` stores
 * the rule for new arrivals only.
 */
export async function categorizeVendor({ body, user }: WriteCtx): Promise<Reply> {
  const match = String(body?.match ?? "")
    .trim()
    .slice(0, 120);
  const category = String(body?.book_category ?? "")
    .trim()
    .slice(0, 60);
  if (!match || !category) return fail(400, { error: "missing_fields" });
  const kind = matchKindOf(body.match_kind, "contains");
  const reason = body.reason ? String(body.reason).trim().slice(0, 300) : null;

  const dup = await findRule(match);
  const rule = await insertRuleReplacing(dup, {
    match,
    book_category: category,
    vendor_name: dup?.vendor_name ?? null,
    type_override: dup?.type_override ?? null,
    match_kind: kind,
    reason,
    created_by: user.id,
    created_by_name: user.name ?? null,
  });
  if (!rule) return fail(500, { error: "rule_failed", message: "Couldn't save that rule, so nothing was changed." });

  if (body.apply === false) {
    await audit({ actor: user, action: "books.rule_create", target: { type: "book_rule", id: rule.id, label: match }, summary: `Taught the rule “${match}”: ${ruleEffect(rule)}, for new transactions only`, detail: { rule } });
    return ok({ applied: 0, rule, skipped_locked: 0, skipped_edited: 0, undo: [] });
  }

  const patch = categoryPatch(category);
  const out = await applyRule(user, rule, patch, `rule:${rule.id}`, { skipEdited: !!body.skip_edited });
  await audit({
    actor: user,
    action: "books.refile",
    target: { type: "book_rule", id: rule.id, label: match },
    count: out.applied,
    summary: `Filed ${plural(out.applied, "transaction")} under ${shortAccount(category)} by the rule “${match}”`,
    detail: { category, match_kind: kind, ids: out.ids.slice(0, 50), skipped_locked: out.skipped_locked, skipped_edited: out.skipped_edited, replaced: dup ? { id: dup.id, effect: ruleEffect(dup) } : null },
  });
  if (!out.logged) return fail(500, { ...HISTORY_FAILED, applied: out.applied });
  return ok({ applied: out.applied, rule, skipped_locked: out.skipped_locked, skipped_edited: out.skipped_edited, failed: out.failed, undo: out.undo });
}

/** Save a rule in place of an earlier one with the same text (that one goes into the audit trail). */
async function insertRuleReplacing(dup: StoredRule | undefined, row: Record<string, unknown>): Promise<StoredRule | null> {
  if (dup) {
    // One rule per text: update it in place, keeping its id (and so the
    // rule:<id> history it already wrote).
    const r = await writeTolerant(db, `book_rules?id=eq.${dup.id}`, "PATCH", { ...row, updated_at: new Date().toISOString() }, RULE_EXTRAS, { Prefer: "return=representation" });
    if (!r.ok) return null;
    return (((await r.json()) as StoredRule[])[0] ?? null) as StoredRule | null;
  }
  return insertRule(row);
}

// ── A vendor's name, default account and default type ─────────────────────

/**
 * Rename a vendor and/or set the account and type its transactions default
 * to. Stored as a rule (the vendor's name, exactly) so the nightly sync
 * applies it to new arrivals. With `backfill` the vendor's existing rows
 * change too, outside closed periods (and, with `skip_edited`, leaving rows
 * changed by hand). Every row changed is logged; an Undo comes back.
 */
export async function vendorSettings({ body, user }: WriteCtx): Promise<Reply> {
  const match = String(body?.match ?? "")
    .trim()
    .slice(0, 200);
  const vendorName = body?.vendor_name !== undefined ? String(body.vendor_name).trim().slice(0, 80) : undefined;
  const category = body?.book_category !== undefined ? String(body.book_category).trim().slice(0, 60) : undefined;
  const typeOverride = body?.type_override !== undefined ? String(body.type_override) : undefined;
  if (match.length < 2) return fail(400, { error: "missing_match" });
  if (vendorName === undefined && category === undefined && typeOverride === undefined) return fail(400, { error: "nothing_to_update" });
  if (vendorName !== undefined && !vendorName) return fail(400, { error: "empty_name" });
  if (typeOverride !== undefined && !TYPES.includes(typeOverride)) return fail(400, { error: "invalid_type" });
  // Older callers expect the history to change too; the page now asks.
  const backfill = body.backfill !== false;
  const kind = matchKindOf(body.match_kind, "vendor");

  const dup = await findRule(match);
  const rulePatch: Record<string, unknown> = { match_kind: kind };
  if (vendorName !== undefined) rulePatch.vendor_name = vendorName;
  if (category !== undefined) rulePatch.book_category = category || null;
  if (typeOverride !== undefined) rulePatch.type_override = typeOverride;
  const rule = await insertRuleReplacing(dup, dup ? rulePatch : { match, ...rulePatch, created_by: user.id, created_by_name: user.name ?? null });
  if (!rule) return fail(500, { error: "rule_failed", message: "Couldn't save that, so nothing was changed." });

  const txnPatch: Record<string, unknown> = {};
  if (vendorName !== undefined) txnPatch.merchant_name = vendorName;
  if (category !== undefined) Object.assign(txnPatch, categoryPatch(category || null));
  if (typeOverride !== undefined) txnPatch.type_override = typeOverride;

  const what = vendorName !== undefined && vendorName !== match ? `renamed ${match} to ${vendorName}` : category !== undefined ? `set ${match}’s account to ${category ? shortAccount(category) : "none"}` : `set ${match}’s type`;
  if (!backfill) {
    await audit({ actor: user, action: "books.vendor_default", target: { type: "vendor", id: match, label: match }, summary: `${capital(what)} for new transactions`, detail: { rule_id: rule.id, patch: rulePatch } });
    return ok({ applied: 0, rule, skipped_locked: 0, skipped_edited: 0, undo: [], vendor_name: vendorName ?? null, book_category: category ?? null, type_override: typeOverride ?? null });
  }
  const out = await applyRule(user, { ...rule, match, match_kind: kind }, txnPatch, "vendor", { skipEdited: !!body.skip_edited });
  await audit({
    actor: user,
    action: vendorName !== undefined && vendorName !== match ? "books.vendor_rename" : "books.vendor_default",
    target: { type: "vendor", id: match, label: match },
    count: out.applied,
    summary: `${capital(what)} on ${plural(out.applied, "transaction")} and for new ones`,
    detail: { rule_id: rule.id, patch: txnPatch, ids: out.ids.slice(0, 50), skipped_locked: out.skipped_locked, skipped_edited: out.skipped_edited },
  });
  if (!out.logged) return fail(500, { ...HISTORY_FAILED, applied: out.applied });
  return ok({
    applied: out.applied,
    skipped_locked: out.skipped_locked,
    skipped_edited: out.skipped_edited,
    undo: out.undo,
    rule,
    vendor_name: vendorName ?? null,
    book_category: category ?? null,
    type_override: typeOverride ?? null,
  });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Batch edits across selected rows ───────────────────────────────────────

/**
 * One change across up to 500 chosen rows: vendor, the person's note (never
 * the bank's own description), type and/or account. A closed period refuses
 * the whole batch; every row's old values are logged, including a loan the
 * account move detaches.
 */
export async function batchUpdate({ body, user }: WriteCtx): Promise<Reply> {
  const ids = Array.isArray(body?.transaction_ids) ? (body.transaction_ids as unknown[]).map(String).filter((id) => id.length > 0 && id.length < 100) : [];
  if (!ids.length || ids.length > 500) return fail(400, { error: "bad_selection" });
  const patch: Record<string, unknown> = {};
  if (body.merchant_name !== undefined) {
    const v = String(body.merchant_name).trim().slice(0, 80);
    if (!v) return fail(400, { error: "empty_vendor" });
    patch.merchant_name = v;
  }
  // The bank's description (`name`) is the record of who was paid and is
  // never rewritten; a note goes beside it. Older callers' `name` is a note.
  const note = body.memo !== undefined ? body.memo : body.name;
  if (note !== undefined) {
    const v = String(note).trim().slice(0, 300);
    if (!v) return fail(400, { error: "empty_note" });
    patch.memo = v;
  }
  if (body.book_category !== undefined) {
    const c = String(body.book_category).trim().slice(0, 60) || null;
    Object.assign(patch, categoryPatch(c));
    // An account move takes the rows off any loan, so they post to the account.
    patch.loan_id = null;
  }
  if (body.type_override !== undefined) {
    if (!TYPES.includes(String(body.type_override))) return fail(400, { error: "invalid_type" });
    patch.type_override = body.type_override;
  }
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });

  const l = await ledger();
  const rows = await rowsById(ids);
  const locked = rows.filter(lockedRow(l));
  if (locked.length) return closedReply(l, locked, ids.length);

  if (patch.memo !== undefined) {
    const probe = await db("book_transactions?select=memo&limit=1");
    if (!probe.ok && isMissingColumn(await probe.text().catch(() => ""))) {
      return fail(409, { error: "needs_migration", message: "Notes need a database update that hasn't been applied yet." });
    }
  }
  const done = await patchRows(db, rows, patch);
  if (done.failed) {
    return fail(500, {
      error: "update_failed",
      message: done.applied ? `Only ${done.applied} of ${ids.length} were updated.` : "Couldn't update those.",
      updated: done.applied,
    });
  }
  const logged = await writeLog(logRowsFor(done.ids, done.before, patch, "batch", actorOf(user)));
  const fields = Object.keys(patch).filter((k) => k !== "txn_type" && k !== "intercompany");
  await audit({
    actor: user,
    action: "books.bulk_update",
    target: { type: "book_transactions", id: done.ids[0] ?? "", label: `${done.applied} transactions` },
    count: done.applied,
    summary: `Changed ${fields.map((f) => (f === "book_category" ? "the account" : f === "merchant_name" ? "the vendor" : f === "memo" ? "the note" : f === "loan_id" ? "the loan" : "the type")).join(", ")} on ${plural(done.applied, "transaction")}`,
    detail: { patch, ids: done.ids.slice(0, 50) },
  });
  if (!logged) return fail(500, { ...HISTORY_FAILED, updated: done.applied });
  return ok({ updated: done.applied, undo: undoOf(done.ids, done.before, patch) });
}

// ── Undo: put back the values a change replaced ────────────────────────────

/**
 * The Undo after a bulk change: each row's own values from before it (as the
 * change's reply handed them back). Only fields a person can set, only
 * outside closed periods, and every row logged with source "undo".
 */
export async function restoreValues({ body, user }: WriteCtx): Promise<Reply> {
  const changes = Array.isArray(body?.changes) ? (body.changes as Array<{ transaction_id?: unknown; values?: unknown }>) : [];
  if (!changes.length || changes.length > 2000) return fail(400, { error: "bad_changes" });
  const clean = new Map<string, Record<string, unknown>>();
  for (const c of changes) {
    const id = String(c.transaction_id ?? "");
    if (!id || id.length > 100 || !c.values || typeof c.values !== "object") return fail(400, { error: "bad_changes" });
    const values = Object.fromEntries(Object.entries(c.values as Record<string, unknown>).filter(([k]) => RESTORABLE.has(k)));
    if ("type_override" in values && values.type_override !== null && !TYPES.includes(String(values.type_override))) return fail(400, { error: "invalid_type" });
    if ("loan_id" in values && values.loan_id !== null && !isUuid(String(values.loan_id))) return fail(400, { error: "invalid_loan_id" });
    if (Object.keys(values).length) clean.set(id, values);
  }
  const l = await ledger();
  const rows = await rowsById([...clean.keys()]);
  const locked = rows.filter(lockedRow(l));
  if (locked.length) return closedReply(l, locked, rows.length);
  // Rows that share the same values go in one request.
  const groups = new Map<string, MatchedRow[]>();
  for (const r of rows) {
    const key = JSON.stringify(clean.get(r.transaction_id));
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  let restored = 0;
  let allLogged = true;
  for (const [key, group] of groups) {
    const values = JSON.parse(key) as Record<string, unknown>;
    const done = await patchRows(db, group, values);
    restored += done.applied;
    if (!(await writeLog(logRowsFor(done.ids, done.before, values, "undo", actorOf(user))))) allLogged = false;
  }
  await audit({ actor: user, action: "books.undo", target: { type: "book_transactions", id: rows[0]?.transaction_id ?? "", label: `${restored} transactions` }, count: restored, summary: `Undid a change to ${plural(restored, "transaction")}` });
  if (!allLogged) return fail(500, { ...HISTORY_FAILED, restored });
  return ok({ restored });
}

// ── Loans: attach chosen rows ──────────────────────────────────────────────

export async function attachLoan({ body, user }: WriteCtx): Promise<Reply> {
  const loanId = body?.loan_id === null ? null : String(body?.loan_id ?? "");
  if (loanId !== null && !isUuid(loanId)) return fail(400, { error: "missing_loan_id" });
  const ids = Array.isArray(body?.transaction_ids) ? (body.transaction_ids as unknown[]).map(String).filter((id) => id && id.length < 100) : [];
  if (!ids.length || ids.length > 500) return fail(400, { error: "bad_selection" });
  const l = await ledger();
  const rows = await rowsById(ids);
  const locked = rows.filter(lockedRow(l));
  if (locked.length) return closedReply(l, locked, ids.length);
  const patch = { loan_id: loanId };
  const done = await patchRows(db, rows, patch);
  const logged = await writeLog(logRowsFor(done.ids, done.before, patch, "loan", actorOf(user)));
  await audit({
    actor: user,
    action: loanId ? "books.loan_attach" : "books.loan_detach",
    target: { type: "book_loan", id: loanId ?? "", label: null },
    count: done.applied,
    summary: loanId ? `Attached ${plural(done.applied, "transaction")} to a loan` : `Took ${plural(done.applied, "transaction")} off their loan`,
    detail: { ids: done.ids.slice(0, 50) },
  });
  if (!logged) return fail(500, { ...HISTORY_FAILED, attached: done.applied });
  return ok({ attached: done.applied, undo: undoOf(done.ids, done.before, patch) });
}

// ── Sunrise sync ───────────────────────────────────────────────────────────

export async function setSunriseSync({ body, user }: WriteCtx): Promise<Reply> {
  const enabled = !!body?.enabled;
  const saved = await writeTolerant(db, "books_settings?id=eq.1", "PATCH", { sync_at_sunrise: enabled, updated_at: new Date().toISOString(), updated_by: user.id, updated_by_name: user.name ?? null }, ["updated_by", "updated_by_name"]);
  if (!saved.ok) {
    console.error("sunrise sync save failed:", (await saved.text()).slice(0, 200));
    return fail(500, { error: "settings_failed", message: "Couldn't save that setting." });
  }
  await audit({ actor: user, action: "books.sunrise_sync", target: { type: "books_settings", id: "1", label: "Sunrise sync" }, summary: `Turned the morning bank sync ${enabled ? "on" : "off"}` });
  return ok({ sync_at_sunrise: enabled });
}

// ── Period close ───────────────────────────────────────────────────────────

/** GET periods: every close, newest first, and whether the lock is available yet. */
export async function periodsReport(): Promise<Reply> {
  const r = await db("books_periods?select=*&order=closed_at.desc&limit=200");
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (isMissingTable(text)) return ok({ available: false, periods: [] });
    throw new Error(`DB error: ${text.slice(0, 200)}`);
  }
  return ok({ available: true, periods: await r.json() });
}

/** Close an entity's books (or everyone's) through a date. Admins only; a reason is kept. */
export async function closePeriod({ body, user }: WriteCtx): Promise<Reply> {
  if (!isAdmin(user)) return fail(403, { error: "forbidden", message: "Only an admin can close a period." });
  const through = isoDay(body?.closed_through);
  if (!through) return fail(400, { error: "invalid_date", message: "Choose the last day of the period to close." });
  if (through >= new Date().toISOString().slice(0, 10)) return fail(400, { error: "future_date", message: "A period can only be closed through a day that has passed." });
  const entityId = body.entity_id ? String(body.entity_id).slice(0, 100) : null;
  const entityName = body.entity_name ? String(body.entity_name).slice(0, 120) : null;
  const reason = body.reason ? String(body.reason).trim().slice(0, 300) : null;
  const r = await db("books_periods", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ entity_id: entityId, entity_name: entityName, closed_through: through, closed_by: user.id, closed_by_name: user.name ?? null, reason }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (isMissingTable(text)) return fail(409, { error: "needs_migration", message: "Closing a period needs a database update that hasn't been applied yet." });
    return fail(500, { error: "close_failed", message: "Couldn't close that period." });
  }
  const row = ((await r.json()) as Array<Record<string, unknown>>)[0];
  await audit({
    actor: user,
    action: "books.period_close",
    target: { type: "books_period", id: String(row?.id ?? ""), label: entityName ?? "Every entity" },
    summary: `Closed ${entityName ?? "every entity’s"} books through ${through}`,
    detail: { closed_through: through, entity_id: entityId, reason },
  });
  return ok({ period: row });
}

/** Reopen a closed period. Admins only, with a reason, which is kept with the close. */
export async function reopenPeriod({ body, user }: WriteCtx): Promise<Reply> {
  if (!isAdmin(user)) return fail(403, { error: "forbidden", message: "Only an admin can reopen a period." });
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail(400, { error: "bad_id" });
  const reason = String(body?.reason ?? "")
    .trim()
    .slice(0, 300);
  if (reason.length < 5) return fail(400, { error: "missing_reason", message: "Say why the period is being reopened." });
  const r = await db(`books_periods?id=eq.${id}&reopened_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ reopened_at: new Date().toISOString(), reopened_by: user.id, reopened_by_name: user.name ?? null, reopen_reason: reason }),
  });
  if (!r.ok) return fail(500, { error: "reopen_failed", message: "Couldn't reopen that period." });
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return fail(404, { error: "not_found", message: "That period is already open." });
  await audit({
    actor: user,
    action: "books.period_reopen",
    target: { type: "books_period", id: String(id), label: String(rows[0].entity_name ?? "Every entity") },
    summary: `Reopened ${String(rows[0].entity_name ?? "every entity’s")} books closed through ${String(rows[0].closed_through)}`,
    detail: { reason },
  });
  return ok({ period: rows[0] });
}

// ── Possible duplicates: settled by a person ───────────────────────────────

/** Record that a possible-duplicate group is two separate payments, so Review stops listing it. */
export async function reviewDuplicate({ body, user }: WriteCtx): Promise<Reply> {
  const key = String(body?.group_key ?? "").slice(0, 200);
  if (!/^[^|]+\|\d{4}-\d{2}-\d{2}\|-?\d+$/.test(key)) return fail(400, { error: "bad_group" });
  const note = body.note ? String(body.note).trim().slice(0, 300) : null;
  const r = await db("book_duplicate_reviews", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ group_key: key, decision: "separate", note, decided_at: new Date().toISOString(), decided_by: user.id, decided_by_name: user.name ?? null }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (isMissingTable(text)) return fail(409, { error: "needs_migration", message: "Settling duplicates needs a database update that hasn't been applied yet." });
    return fail(500, { error: "review_failed", message: "Couldn't save that." });
  }
  await audit({ actor: user, action: "books.duplicate_dismiss", target: { type: "duplicate_group", id: key, label: key }, summary: "Marked a possible duplicate as two separate payments", detail: { note } });
  return ok({ saved: true });
}

// ── Opening balances (Review › Bank vs books) ──────────────────────────────

export async function setOpening({ body, user }: WriteCtx): Promise<Reply> {
  const accountId = String(body?.account_id ?? "").slice(0, 100);
  const asOf = isoDay(body?.as_of);
  const n = Number(body?.opening_balance);
  if (!accountId || !asOf || !Number.isFinite(n)) return fail(400, { error: "bad_opening", message: "Give the balance and the date it was on the statement." });
  const r = await db("book_account_openings", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ account_id: accountId, opening_balance: Math.round(n * 100) / 100, as_of: asOf, note: body.note ? String(body.note).slice(0, 300) : null, set_at: new Date().toISOString(), set_by: user.id, set_by_name: user.name ?? null }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (isMissingTable(text)) return fail(409, { error: "needs_migration", message: "Opening balances need a database update that hasn't been applied yet." });
    return fail(500, { error: "opening_failed", message: "Couldn't save that balance." });
  }
  await audit({ actor: user, action: "books.opening_balance", target: { type: "bank_account", id: accountId, label: null }, summary: `Set an account’s opening balance as of ${asOf}`, detail: { opening_balance: n, as_of: asOf } });
  return ok({ opening: ((await r.json()) as unknown[])[0] ?? null });
}

// ── One row: a person reclassifying a transaction ──────────────────────────

export async function editTransaction({ body, user }: WriteCtx): Promise<Reply> {
  const { transaction_id, type_override, book_category, loan_id, memo } = body ?? {};
  if (!transaction_id || typeof transaction_id !== "string") return fail(400, { error: "missing_transaction_id" });
  const patch: Record<string, unknown> = {};
  if (book_category !== undefined) {
    const trimmed = book_category === null ? null : String(book_category).trim().slice(0, 60);
    // The account settles the type too (X4), unless the same edit sets the type.
    Object.assign(patch, categoryPatch(trimmed || null));
  }
  if (type_override !== undefined) {
    if (type_override !== null && !TYPES.includes(type_override)) return fail(400, { error: "invalid_type" });
    patch.type_override = type_override;
  }
  if (loan_id !== undefined) {
    if (loan_id !== null && !isUuid(String(loan_id))) return fail(400, { error: "invalid_loan_id" });
    patch.loan_id = loan_id;
  }
  if (memo !== undefined) patch.memo = memo === null ? null : String(memo).trim().slice(0, 300) || null;
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });

  // The old values first, so the history records old → new, and the lock.
  const beforeRows = await rowsById([transaction_id]);
  const before = (beforeRows[0] ?? null) as (MatchedRow & Record<string, unknown>) | null;
  if (before) {
    const l = await ledger();
    if (lockedRow(l)(before)) return closedReply(l, [before], 1);
  }

  const r = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(transaction_id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 300);
    if (patch.memo !== undefined && isMissingColumn(text)) return fail(409, { error: "needs_migration", message: "Notes need a database update that hasn't been applied yet." });
    console.error("books edit failed:", text);
    return fail(500, { error: "update_failed", message: "Couldn't save that change." });
  }
  const rows = (await r.json()) as BookTxn[];
  if (!rows.length) return fail(404, { error: "not_found" });
  // Re-saving the same values logs nothing, unless the row has no history
  // at all, which is what retrying after a failed log write looks like.
  const unchanged = !!before && Object.entries(patch).every(([f, v]) => String(before[f] ?? "") === String(v ?? ""));
  const logBefore = unchanged && !(await hasHistory(transaction_id)) ? null : before;
  if (!(await logChanges([transaction_id], logBefore, patch, "edit", actorOf(user)))) {
    return fail(500, { ...HISTORY_FAILED, transaction: rows[0] });
  }
  return ok({ transaction: rows[0], undo: before ? undoOf([transaction_id], new Map([[transaction_id, before]]), patch) : [] });
}
