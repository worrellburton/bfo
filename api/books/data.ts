import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit } from "../../lib/audit.js";
import { canWrite, currentUser, fail, guard, handleError, type AppUser } from "../../lib/auth.js";
import { balanceSheetReport } from "../../lib/books/balance-sheet.js";
import { homeReport } from "../../lib/books/home.js";
import { addReceipt, deleteReceipt, historyReport } from "../../lib/books/receipts.js";
import { loansReport, metaReport, reconciliationReport, rulesReport, settingsReport, transactionsReport } from "../../lib/books/reports.js";
import { recurringReport, reviewReport } from "../../lib/books/review.js";
import { ledgerExport, pnlReport, statementsReport, vendorsReport } from "../../lib/books/statements.js";
import { tax1099Report } from "../../lib/books/tax1099.js";
import type { Query, Reply, WriteCtx } from "../../lib/books/types.js";
import { batchUpdate, categorizeVendor, createLoan, deleteRule, editTransaction, loanRule, setSunriseSync, updateLoan, vendorSettings } from "../../lib/books/writes.js";

/**
 * Books reads and edits. Everything is served from book_transactions — the
 * nightly Plaid mirror — never from Plaid directly, so pages stay fast.
 *
 *   GET ?report=meta           → entities, categories, last sync, row count
 *   GET ?report=home           → dashboard: treasury trend, 30-day receipts and disbursements, review count, inflows
 *   GET ?report=transactions   → filterable, paginated rows (full detail) and the strip's totals
 *   GET ?report=pnl            → revenue and expenses, cash basis, by month and by entity; entity=all | id[,id…]
 *   GET ?report=cell           → the transactions behind one statement cell (section, label, month or col)
 *   GET ?report=statements     → cash-flow summary and trial balance
 *   GET ?report=tax1099        → the 1099 worksheet: candidates, wages outside payroll, exclusions
 *   GET ?report=balance-sheet  → connected balances[, as_of=YYYY-MM-DD]
 *   GET ?report=ledger         → the year's posted rows for export (recorded in the audit log)
 *   GET ?report=vendors        → vendor × month spend matrix
 *   GET ?report=review | recurring | reconciliation | loans | rules | settings | history
 *   POST {transaction_id, …}   → set type_override and/or book_category
 *   POST {action, …}           → the actions below
 *
 * Who may call it: anyone signed in with staff access may read; writing needs
 * canWrite. Partners and email-only members are refused by currentUser (403).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through lib/auth.ts sbFetch).
 *
 * How a row lands on the statements (one rule for P&L, Home, Ask and the
 * strip) is lib/books/statements.ts. This file only routes: it
 * authenticates, picks the report or action, and writes the Reply. The work
 * lives in lib/books/ (Vercel deploys everything under api/ as a function,
 * so helpers must not live here).
 */

/** POST {action} → handler. A POST naming no action here is a plain transaction edit. */
const ACTIONS: Record<string, (ctx: WriteCtx) => Promise<Reply>> = {
  create_loan: createLoan,
  update_loan: updateLoan,
  loan_rule: loanRule,
  delete_rule: deleteRule,
  categorize_vendor: categorizeVendor,
  vendor_settings: vendorSettings,
  batch_update: batchUpdate,
  add_receipt: addReceipt,
  set_sunrise_sync: setSunriseSync,
  delete_receipt: deleteReceipt,
};

/** The general ledger leaves the office as a file: who took it, which year and which entities is recorded. */
async function ledgerWithAudit(query: Query, user: AppUser): Promise<Reply> {
  const reply = await ledgerExport(query);
  const body = reply.body as { year: number; entity: string; entities: string[]; rows: unknown[] };
  await audit({
    actor: user,
    action: "books.export",
    target: { type: "books_ledger", id: `${body.year}:${body.entity}`, label: `${body.year} general ledger` },
    count: body.rows.length,
    summary: `Exported the ${body.year} general ledger (${body.rows.length} transactions) for ${body.entity === "all" ? "all entities" : body.entities.join(", ")}`,
    detail: { year: body.year, entity: body.entity, rows: body.rows.length },
  });
  return reply;
}

/** GET ?report= → handler. */
const REPORTS: Record<string, (query: Query, user: AppUser) => Promise<Reply>> = {
  home: homeReport,
  rules: rulesReport,
  settings: settingsReport,
  history: historyReport,
  meta: metaReport,
  transactions: transactionsReport,
  pnl: (q) => pnlReport(q, "pnl"),
  cell: (q) => pnlReport(q, "cell"),
  statements: statementsReport,
  tax1099: tax1099Report,
  review: reviewReport,
  recurring: recurringReport,
  reconciliation: reconciliationReport,
  loans: loansReport,
  "balance-sheet": balanceSheetReport,
  vendors: vendorsReport,
  ledger: ledgerWithAudit,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");
    if (req.method === "POST") {
      if (!canWrite(user)) return fail(res, 403, "forbidden", "Your role can read Books but not change it.");
      const name = String(req.body?.action ?? "");
      const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : editTransaction;
      const reply = await action({ body: req.body ?? {}, user });
      return res.status(reply.status).json(reply.body);
    }
    const name = String(req.query.report ?? "");
    const report = Object.hasOwn(REPORTS, name) ? REPORTS[name] : null;
    if (!report) return fail(res, 400, "unknown_report", `Use one of: ${Object.keys(REPORTS).join(", ")}.`);
    const reply = await report(req.query, user);
    return res.status(reply.status).json(reply.body);
  } catch (err) {
    return handleError(res, err);
  }
}
