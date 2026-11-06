import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { audit } from "../../lib/audit.js";
import { canWrite, currentUser, fail, guard, handleError, sbFetch as db, type AppUser } from "../../lib/auth.js";
import { nearDuplicates, planCsvImport } from "../../lib/books-csv.js";
import { classify } from "../../lib/books-rules.js";
import { editedAmong } from "../../lib/books/audit.js";
import { isMissingColumn, isMissingTable, readLocks, without, writeTolerant } from "../../lib/books/db.js";
import { closedThrough, firstRule, orderRules, type TaughtRule } from "../../lib/books/ledger.js";
import { fetchAll } from "../../lib/db-pages.js";
import { betterVendor } from "../../lib/vendor-parse.js";

/**
 * Import bank-exported CSV rows into Books: the way in for history a bank
 * won't serve through the live feed (some banks stop at about 90 days).
 *
 * The client parses the file and posts clean rows with the file's name and
 * SHA-256. First a dry run (`dry_run: true`) answers what the import would
 * do: rows to add and rows already here (the same day and amount, or a day
 * or three off with a similar description), money in and out, the date span,
 * and any rows in a closed period, which refuse the import. Then the real
 * run writes the rows (ids "csv_<sha1>", so the same file twice is a no-op),
 * each carrying the import's id, and one book_imports record: who, when,
 * which file and account, how many rows and their totals. `undo_import_id`
 * removes an import's rows again (leaving any a person has since changed)
 * and marks the record undone.
 *
 * Signs: bank exports usually sign deposits positive. Books signs money out
 * positive, so amounts are flipped unless `charges_positive` says the file
 * signs charges positive (common for card exports).
 *
 * HTTP surface: POST /api/books/import-csv {account_id, rows, file_name?, file_sha256?, charges_positive?, dry_run?} or {undo_import_id}.
 * Who may call it: anyone who can write (canWrite); partners are refused.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through lib/auth.ts sbFetch).
 */

type InRow = { date: string; description: string; amount: number };

const IMPORT_EXTRAS = ["import_id"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["POST"])) return;
  let user: AppUser | null;
  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    user = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!user) return fail(res, 401, "unauthorized");
  if (!canWrite(user)) return fail(res, 403, "forbidden", "You have view-only access to Books.");

  try {
    if (req.body?.undo_import_id) return await undoImport(res, user, String(req.body.undo_import_id));
    return await runImport(req, res, user);
  } catch (err) {
    return handleError(res, err);
  }
}

async function runImport(req: VercelRequest, res: VercelResponse, user: AppUser) {
  const accountId = String(req.body?.account_id ?? "").trim();
  const input = Array.isArray(req.body?.rows) ? (req.body.rows as InRow[]) : [];
  const dryRun = !!req.body?.dry_run;
  const chargesPositive = !!req.body?.charges_positive;
  const fileName = req.body?.file_name ? String(req.body.file_name).slice(0, 200) : null;
  const fileSha = /^[0-9a-f]{64}$/i.test(String(req.body?.file_sha256 ?? "")) ? String(req.body.file_sha256).toLowerCase() : null;
  if (!accountId) return fail(res, 400, "missing_account_id", "Choose the account the file belongs to.");
  if (!input.length) return fail(res, 400, "no_rows", "That file has no rows to import.");
  if (input.length > 20000) return fail(res, 400, "too_many_rows", "Import at most 20,000 rows at a time.");

  const clean = input
    .map((r) => ({
      date: String(r.date ?? "").slice(0, 10),
      description: String(r.description ?? "")
        .trim()
        .slice(0, 500),
      amount: Number(r.amount),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount) && r.amount !== 0);
  if (!clean.length) return fail(res, 400, "no_valid_rows", "Couldn't find dated rows with amounts in that file.");

  const prefRes = await db(`plaid_account_prefs?account_id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`);
  const pref = prefRes.ok ? ((((await prefRes.json()) as Array<Record<string, unknown>>)[0] ?? null) as Record<string, any> | null) : null;

  // Books sign: money out positive.
  const books = clean.map((r) => ({ ...r, amount: chargesPositive ? r.amount : -r.amount }));
  const dates = books.map((r) => r.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  // Rows dated in a closed period refuse the import.
  const locks = await readLocks(db);
  const through = closedThrough(locks, pref?.entity_id ?? null);
  const lockedRows = through ? books.filter((r) => r.date <= through).length : 0;

  // What the account already has across the file's span, three days either
  // side. Every page is read, and a failed read stops the import: an empty
  // list here would import the whole file on top of what's there.
  const pad = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const existing = await fetchAll<{ transaction_id: string; date: string; amount: number | string; name: string | null }>(
    `book_transactions?account_id=eq.${encodeURIComponent(accountId)}` + `&date=gte.${pad(first, -3)}&date=lte.${pad(last, 3)}` + `&select=transaction_id,date,amount,name&order=transaction_id.asc`,
  );
  const plan = planCsvImport(
    books,
    existing.filter((e) => e.date >= first && e.date <= last),
  );
  const near = nearDuplicates(plan.rows, existing);
  const nearSet = new Set(near.map((n) => n.index));
  const toWrite = plan.rows.filter((_, i) => !nearSet.has(i));

  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of toWrite) {
    if (r.amount < 0) moneyIn += -r.amount;
    else moneyOut += r.amount;
  }
  const summary = {
    rows_in_file: clean.length,
    to_add: toWrite.length,
    already_here: plan.skipped,
    near_matches: near.length,
    money_in: Math.round(moneyIn * 100) / 100,
    money_out: Math.round(moneyOut * 100) / 100,
    first,
    last,
    locked: lockedRows,
    closed_through: through,
    near_sample: near.slice(0, 5).map((n) => ({ csv: plan.rows[n.index], stored: n.existing })),
  };
  if (dryRun) return res.status(200).json({ dry_run: true, ...summary });
  if (lockedRows) {
    return fail(res, 409, "period_closed", `${lockedRows} row${lockedRows === 1 ? " is" : "s are"} dated in a closed period (closed through ${through}). Remove them from the file, or ask an admin to reopen the period.`);
  }

  // The rules people taught, in the order the sync tries them.
  const rules = orderRules(await fetchAll<TaughtRule & { id: string }>("book_rules?select=*&order=id.asc"));
  const taught = (desc: string) => {
    const row = { name: desc, merchant_name: betterVendor(desc, null), entity_id: pref?.entity_id ?? null };
    return {
      category: firstRule(rules, row, "book_category")?.book_category ?? null,
      vendor: firstRule(rules, row, "vendor_name")?.vendor_name ?? null,
      type: firstRule(rules, row, "type_override")?.type_override ?? null,
    };
  };

  // The import's record first, so each row can name it.
  const label = [pref?.nickname || pref?.account_name || "Account", pref?.mask ? `•• ${pref.mask}` : null].filter(Boolean).join(" ");
  let importId: string | null = null;
  const rec = await db("book_imports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      account_id: accountId,
      account_label: label,
      file_name: fileName,
      file_sha256: fileSha,
      rows_in_file: clean.length,
      inserted: toWrite.length,
      skipped: plan.skipped + near.length,
      total_in: summary.money_in,
      total_out: summary.money_out,
      first_date: first,
      last_date: last,
      signs_flipped: !chargesPositive,
      imported_by: user.id,
      imported_by_name: user.name ?? null,
    }),
  });
  if (rec.ok) importId = (((await rec.json()) as Array<{ id: string }>)[0]?.id ?? null) as string | null;
  else if (!isMissingTable(await rec.text().catch(() => ""))) return fail(res, 500, "import_failed", "The import didn't start. Try again.");

  const now = new Date().toISOString();
  const rows = toWrite.map((r) => {
    // A twin's position joins the id (the first keeps the original form,
    // so ids from earlier imports still match).
    const twin = r.occurrence ? `|${r.occurrence}` : "";
    const id = createHash("sha1")
      .update(`${accountId}|${r.date}|${r.amount.toFixed(2)}|${r.description}${twin}`)
      .digest("hex");
    const t = taught(r.description);
    const rule = classify(r.description, null, null, t.category);
    return {
      transaction_id: `csv_${id}`,
      account_id: accountId,
      item_id: "csv_import",
      date: r.date,
      name: r.description || null,
      merchant_name: t.vendor ?? betterVendor(r.description, null),
      amount: r.amount,
      pending: false,
      currency: "USD",
      plaid_category: null,
      plaid_category_detailed: null,
      payment_channel: "csv",
      txn_type: (rule.type === "intercompany" ? "transfer" : (rule.type ?? "normal")) as "normal" | "transfer",
      intercompany: rule.type === "intercompany",
      book_category: rule.category,
      // Uniform across every row (null when no rule) so the bulk upsert
      // keeps one column set.
      type_override: t.type,
      entity_id: pref?.entity_id ?? null,
      entity_name: pref?.entity_name ?? null,
      hidden: pref?.hidden ?? false,
      updated_at: now,
      import_id: importId,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    const part = importId ? rows.slice(i, i + 500) : without(rows.slice(i, i + 500), IMPORT_EXTRAS);
    const r = await writeTolerant(db, "book_transactions", "POST", part, IMPORT_EXTRAS, { Prefer: "resolution=merge-duplicates" });
    if (!r.ok) throw new Error(`upsert failed: ${(await r.text()).slice(0, 300)}`);
  }

  await audit({
    actor: user,
    action: "books.import",
    target: { type: "bank_account", id: accountId, label },
    count: rows.length,
    summary: `Imported ${rows.length} transaction${rows.length === 1 ? "" : "s"} from ${fileName ?? "a CSV file"} into ${label}`,
    detail: { import_id: importId, file_sha256: fileSha, ...summary, near_sample: undefined },
  });
  return res.status(200).json({ imported: rows.length, skipped_existing: plan.skipped + near.length, import_id: importId, ...summary });
}

/** Take an import's rows back out (rows a person has since changed stay), and mark the record undone. */
async function undoImport(res: VercelResponse, user: AppUser, importId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return fail(res, 400, "bad_import_id");
  const r = await db(`book_transactions?import_id=eq.${importId}&select=transaction_id,date,account_id&order=transaction_id.asc&limit=1`);
  if (!r.ok) {
    if (isMissingColumn(await r.text().catch(() => ""))) return fail(res, 409, "needs_migration", "Undoing an import needs a database update that hasn't been applied yet.");
    return fail(res, 500, "undo_failed", "Couldn't undo that import.");
  }
  const rows = await fetchAll<{ transaction_id: string; date: string; account_id: string }>(`book_transactions?import_id=eq.${importId}&select=transaction_id,date,account_id&order=transaction_id.asc`);
  const locks = await readLocks(db);
  const pref = rows[0] ? await db(`plaid_account_prefs?account_id=eq.${encodeURIComponent(rows[0].account_id)}&select=entity_id&limit=1`) : null;
  const entityId = pref?.ok ? ((((await pref.json()) as Array<{ entity_id: string | null }>)[0]?.entity_id ?? null) as string | null) : null;
  const through = closedThrough(locks, entityId);
  if (through && rows.some((x) => x.date <= through)) return fail(res, 409, "period_closed", `Some of these rows are in a closed period (closed through ${through}). An admin can reopen the period.`);
  const edited = await editedAmong(rows.map((x) => x.transaction_id));
  const remove = rows.filter((x) => !edited.has(x.transaction_id)).map((x) => x.transaction_id);
  for (let i = 0; i < remove.length; i += 200) {
    const list = remove
      .slice(i, i + 200)
      .map((id) => `"${id}"`)
      .join(",");
    const d = await db(`book_transactions?transaction_id=in.(${list})`, { method: "DELETE" });
    if (!d.ok) return fail(res, 500, "undo_failed", "Couldn't undo all of that import. Try again.");
  }
  await db(`book_imports?id=eq.${importId}`, { method: "PATCH", body: JSON.stringify({ undone_at: new Date().toISOString(), undone_by: user.id, undone_by_name: user.name ?? null }) });
  await audit({
    actor: user,
    action: "books.import_undo",
    target: { type: "book_import", id: importId, label: null },
    count: remove.length,
    summary: `Undid a CSV import: removed ${remove.length} imported row${remove.length === 1 ? "" : "s"}${edited.size ? `, kept ${edited.size} changed by hand` : ""}`,
  });
  return res.status(200).json({ removed: remove.length, kept: edited.size });
}
