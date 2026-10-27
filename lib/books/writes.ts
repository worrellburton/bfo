import { sbFetch as db } from "../auth.js";
import { patchMatching, typeForCategory } from "../books-rules.js";
import { HISTORY_FAILED, hasHistory, logChanges } from "./audit.js";
import { fail, ok, type BookTxn, type Reply, type WriteCtx } from "./types.js";

/**
 * Books edits: a person reclassifying transactions, teaching the books a
 * rule, or keeping the loan registry. Every action here is a POST to
 * api/books/data with {action, …}; the plain {transaction_id, …} edit is the
 * default when no action is named.
 */

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const TYPES = ["normal", "transfer", "intercompany"];

/**
 * Booking rows to an account also settles their mechanical type: a P&L
 * account means income/expense, 9000 means roll-up, the other 9000s a
 * transfer. Without this, a vendor defaulted to Salaries & Wages kept the
 * intercompany flag a description-based rule had set, and showed as Roll-up.
 * A user's explicit type_override still wins at read time.
 */
export function categoryPatch(category: string): Record<string, unknown> {
  const implied = typeForCategory(category);
  if (!implied) return { book_category: category };
  return {
    book_category: category,
    intercompany: implied === "intercompany",
    txn_type: implied === "normal" ? "normal" : "transfer",
  };
}

/** The current non-loan rule whose text equals `match`, ignoring case. */
async function findRule(match: string): Promise<{ id: string; match: string } | undefined> {
  // Find the duplicate by exact (case-insensitive) text rather than an ilike,
  // which would mis-handle _ % and other metacharacters.
  const existing = await db("book_rules?select=id,match&loan_id=is.null");
  if (!existing.ok) return undefined;
  return ((await existing.json()) as Array<{ id: string; match: string }>).find(
    (x) => x.match.toLowerCase() === match.toLowerCase()
  );
}

// ── Loan registry actions ───────────────────────────────────────────────

export async function createLoan({ body }: WriteCtx): Promise<Reply> {
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return fail(400, { error: "missing_name", message: "Give the loan a name." });
  const starting = Number(body.starting_balance ?? 0);
  const r = await db("book_loans", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, starting_balance: Number.isFinite(starting) ? starting : 0 }),
  });
  if (!r.ok) {
    console.error("create loan failed:", (await r.text()).slice(0, 300));
    return fail(500, { error: "create_failed", message: "Couldn't create that loan." });
  }
  return ok({ loan: ((await r.json()) as any[])[0] });
}

export async function updateLoan({ body }: WriteCtx): Promise<Reply> {
  const loanId = String(body.loan_id ?? "");
  if (!isUuid(loanId)) return fail(400, { error: "missing_loan_id" });
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) return fail(400, { error: "missing_name" });
    patch.name = name;
  }
  if (body.starting_balance !== undefined) {
    const n = Number(body.starting_balance);
    if (!Number.isFinite(n)) return fail(400, { error: "invalid_balance" });
    patch.starting_balance = n;
  }
  if (body.show_on_report !== undefined) patch.show_on_report = !!body.show_on_report;
  if (body.archived !== undefined) patch.archived_at = body.archived ? new Date().toISOString() : null;
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });
  const r = await db(`book_loans?id=eq.${loanId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return fail(500, { error: "update_failed", message: "Couldn't save that loan." });
  const rows = (await r.json()) as any[];
  if (!rows.length) return fail(404, { error: "not_found" });
  return ok({ loan: rows[0] });
}

// ── Auto-attach rule: descriptions containing X belong to this loan ──────

export async function loanRule({ body }: WriteCtx): Promise<Reply> {
  const match = String(body.match ?? "").trim().slice(0, 120);
  const loanId = String(body.loan_id ?? "");
  if (!match || match.length < 3) {
    return fail(400, { error: "match_too_short", message: "Use at least 3 characters." });
  }
  if (!isUuid(loanId)) return fail(400, { error: "missing_loan_id" });

  const ruleRes = await db("book_rules", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ match, loan_id: loanId }),
  });
  if (!ruleRes.ok) {
    console.error("loan rule save failed:", (await ruleRes.text()).slice(0, 200));
    return fail(500, { error: "rule_failed", message: "Couldn't save that rule." });
  }
  const rule = ((await ruleRes.json()) as any[])[0];

  // Attach every already-synced, not-yet-on-a-loan transaction that
  // literally contains the rule text — same matcher as the nightly pass.
  const attached = await patchMatching(db, match, "loan_id=is.null", { loan_id: loanId });
  return ok({ rule, attached });
}

export async function deleteRule({ body }: WriteCtx): Promise<Reply> {
  const ruleId = String(body.rule_id ?? "");
  if (!isUuid(ruleId)) return fail(400, { error: "missing_rule_id" });
  const del = await db(`book_rules?id=eq.${ruleId}`, { method: "DELETE" });
  if (!del.ok) {
    console.error("rule delete failed:", (await del.text()).slice(0, 200));
    return fail(500, { error: "rule_failed", message: "Couldn't delete that rule." });
  }
  return ok({ deleted: true });
}

// ── "All of these, and from now on": bulk categorize + store a rule ──────

export async function categorizeVendor({ body }: WriteCtx): Promise<Reply> {
  const match = String(body.match ?? "").trim().slice(0, 120);
  const category = String(body.book_category ?? "").trim().slice(0, 60);
  if (!match || !category) return fail(400, { error: "missing_fields" });

  // Remember the rule (replacing any earlier rule for the same text) so
  // the nightly sync categorizes future arrivals the same way.
  const dup = await findRule(match);
  if (dup) await db(`book_rules?id=eq.${dup.id}`, { method: "DELETE" }).catch(() => {});
  const ruleRes = await db("book_rules", {
    method: "POST",
    body: JSON.stringify({ match, book_category: category }),
  });
  if (!ruleRes.ok) {
    console.error("rule save failed:", (await ruleRes.text()).slice(0, 200));
    return fail(500, { error: "rule_failed", message: "Couldn't save that rule, so nothing was changed." });
  }

  // Apply to everything already synced that literally contains the text.
  const applied = await patchMatching(db, match, "", categoryPatch(category));
  return ok({ applied, rule: { match, book_category: category } });
}

// ── Vendor settings: rename the vendor and/or set its default account.
//    Stored as a rule so the nightly sync keeps applying both to new
//    arrivals; existing rows are patched immediately. ──────────────────────

export async function vendorSettings({ body }: WriteCtx): Promise<Reply> {
  const match = String(body.match ?? "").trim().slice(0, 200);
  const vendorName = body.vendor_name !== undefined ? String(body.vendor_name).trim().slice(0, 80) : undefined;
  const category = body.book_category !== undefined ? String(body.book_category).trim().slice(0, 60) : undefined;
  const typeOverride = body.type_override !== undefined ? String(body.type_override) : undefined;
  if (match.length < 2) return fail(400, { error: "missing_match" });
  if (vendorName === undefined && category === undefined && typeOverride === undefined) {
    return fail(400, { error: "nothing_to_update" });
  }
  if (vendorName !== undefined && !vendorName) return fail(400, { error: "empty_name" });
  if (typeOverride !== undefined && !TYPES.includes(typeOverride)) {
    return fail(400, { error: "invalid_type" });
  }

  // One rule per matched text: merge into the existing rule if present.
  const dup = await findRule(match);
  const rulePatch: Record<string, unknown> = {};
  if (vendorName !== undefined) rulePatch.vendor_name = vendorName;
  if (category !== undefined) rulePatch.book_category = category;
  if (typeOverride !== undefined) rulePatch.type_override = typeOverride;
  if (dup) {
    await db(`book_rules?id=eq.${dup.id}`, { method: "PATCH", body: JSON.stringify(rulePatch) });
  } else {
    await db("book_rules", { method: "POST", body: JSON.stringify({ match, ...rulePatch }) });
  }

  const txnPatch: Record<string, unknown> = {};
  if (vendorName !== undefined) txnPatch.merchant_name = vendorName;
  if (category !== undefined) Object.assign(txnPatch, categoryPatch(category));
  if (typeOverride !== undefined) txnPatch.type_override = typeOverride;
  const applied = await patchMatching(db, match, "", txnPatch);
  return ok({
    applied,
    vendor_name: vendorName ?? null,
    book_category: category ?? null,
    type_override: typeOverride ?? null,
  });
}

// ── Batch edits: vendor/description across selected rows ────────────────

export async function batchUpdate({ body, user }: WriteCtx): Promise<Reply> {
  const ids = Array.isArray(body.transaction_ids)
    ? (body.transaction_ids as unknown[]).map(String).filter((id) => id.length > 0 && id.length < 100)
    : [];
  if (!ids.length || ids.length > 500) return fail(400, { error: "bad_selection" });
  const patch: Record<string, unknown> = {};
  if (body.merchant_name !== undefined) {
    const v = String(body.merchant_name).trim().slice(0, 80);
    if (!v) return fail(400, { error: "empty_vendor" });
    patch.merchant_name = v;
  }
  if (body.name !== undefined) {
    const v = String(body.name).trim().slice(0, 300);
    if (!v) return fail(400, { error: "empty_description" });
    patch.name = v;
  }
  if (body.book_category !== undefined) {
    // An account move also detaches any loan link, so the rows post to the
    // chosen P&L account instead of the balance sheet.
    patch.book_category = String(body.book_category).trim().slice(0, 60) || null;
    patch.loan_id = null;
  }
  if (body.type_override !== undefined) {
    if (!TYPES.includes(String(body.type_override))) {
      return fail(400, { error: "invalid_type" });
    }
    patch.type_override = body.type_override;
  }
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });

  let updated = 0;
  let failedChunk: string | null = null;
  for (let i = 0; i < ids.length; i += 200) {
    const list = ids.slice(i, i + 200).map((id) => `"${id.replace(/"/g, "")}"`).join(",");
    const r = await db(`book_transactions?transaction_id=in.(${list})`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (r.ok) updated += Math.min(200, ids.length - i);
    else failedChunk ??= (await r.text().catch(() => "")).slice(0, 200);
  }
  if (failedChunk !== null) {
    console.error("batch update failed:", failedChunk);
    return fail(500, {
      error: "update_failed",
      message: updated ? `Only ${updated} of ${ids.length} were updated.` : "Couldn't update those.",
      updated,
    });
  }
  // Log only the fields the user actually chose. loan_id here is an
  // automatic side-effect of an account move, not an edit — logging it
  // would assert a "loan changed" event that never happened.
  const { loan_id: _dropped, ...logPatch } = patch;
  if (!(await logChanges(ids, null, logPatch, "batch", user.id))) {
    return fail(500, { ...HISTORY_FAILED, updated });
  }
  return ok({ updated });
}

// ── Toggle the daily sync-at-sunrise behavior ───────────────────────────

export async function setSunriseSync({ body }: WriteCtx): Promise<Reply> {
  const enabled = !!body.enabled;
  const saved = await db("books_settings?id=eq.1", {
    method: "PATCH",
    body: JSON.stringify({ sync_at_sunrise: enabled, updated_at: new Date().toISOString() }),
  });
  if (!saved.ok) {
    console.error("sunrise sync save failed:", (await saved.text()).slice(0, 200));
    return fail(500, { error: "settings_failed", message: "Couldn't save that setting." });
  }
  return ok({ sync_at_sunrise: enabled });
}

// ── Edits: a person reclassifying a transaction ─────────────────────────

export async function editTransaction({ body, user }: WriteCtx): Promise<Reply> {
  const { transaction_id, type_override, book_category, loan_id } = body ?? {};
  if (!transaction_id || typeof transaction_id !== "string") {
    return fail(400, { error: "missing_transaction_id" });
  }
  const patch: Record<string, unknown> = {};
  if (type_override !== undefined) {
    if (type_override !== null && !TYPES.includes(type_override)) {
      return fail(400, { error: "invalid_type" });
    }
    patch.type_override = type_override;
  }
  if (book_category !== undefined) {
    const trimmed = book_category === null ? null : String(book_category).trim().slice(0, 60);
    patch.book_category = trimmed || null;
  }
  if (loan_id !== undefined) {
    if (loan_id !== null && !isUuid(String(loan_id))) {
      return fail(400, { error: "invalid_loan_id" });
    }
    patch.loan_id = loan_id;
  }
  if (!Object.keys(patch).length) return fail(400, { error: "nothing_to_update" });

  // Capture the old values first, so the audit log records old → new.
  const beforeRes = await db(
    `book_transactions?transaction_id=eq.${encodeURIComponent(transaction_id)}&select=book_category,type_override,loan_id,merchant_name,name&limit=1`
  );
  const before = beforeRes.ok ? ((await beforeRes.json()) as any[])[0] ?? null : null;

  const r = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(transaction_id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    console.error("books edit failed:", (await r.text()).slice(0, 300));
    return fail(500, { error: "update_failed", message: "Couldn't save that change." });
  }
  const rows = (await r.json()) as BookTxn[];
  if (!rows.length) return fail(404, { error: "not_found" });
  // Re-saving the same values logs nothing, unless the row has no history
  // at all, which is what retrying after a failed log write looks like.
  // Log it then, so the retry really does protect the edit from the sync.
  const unchanged =
    !!before && Object.entries(patch).every(([f, v]) => String(before[f] ?? "") === String(v ?? ""));
  const logBefore = unchanged && !(await hasHistory(transaction_id)) ? null : before;
  if (!(await logChanges([transaction_id], logBefore, patch, "edit", user.id))) {
    return fail(500, { ...HISTORY_FAILED, transaction: rows[0] });
  }
  return ok({ transaction: rows[0] });
}
