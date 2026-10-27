import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser } from "../../lib/auth.js";
import { balanceSheetReport } from "../../lib/books/balance-sheet.js";
import { homeReport } from "../../lib/books/home.js";
import { addReceipt, deleteReceipt, historyReport } from "../../lib/books/receipts.js";
import {
  loansReport,
  metaReport,
  reconciliationReport,
  rulesReport,
  settingsReport,
  transactionsReport,
} from "../../lib/books/reports.js";
import { recurringReport, reviewReport } from "../../lib/books/review.js";
import { pnlReport, statementsReport, tax1099Report, vendorsReport } from "../../lib/books/statements.js";
import type { Query, Reply, WriteCtx } from "../../lib/books/types.js";
import {
  batchUpdate,
  categorizeVendor,
  createLoan,
  deleteRule,
  editTransaction,
  loanRule,
  setSunriseSync,
  updateLoan,
  vendorSettings,
} from "../../lib/books/writes.js";

/**
 * Books reads and edits. Everything is served from book_transactions — the
 * nightly Plaid mirror — never from Plaid directly, so pages stay fast.
 *
 *   GET ?report=meta          → entities, categories, last sync, row count
 *   GET ?report=home          → dashboard: treasury trend, 30d flow, review count, inflows
 *   GET ?report=transactions  → filterable, paginated rows (full detail)
 *   GET ?report=pnl           → cash-basis Jan–Dec matrix; entity=all | id[,id…]
 *   GET ?report=cell          → the transactions behind one P&L cell
 *   GET ?report=vendors       → vendor × month spend matrix
 *   POST {transaction_id, …}  → set type_override and/or book_category
 *
 * Books is open to everyone with a login.
 *
 * A transaction's *effective* type decides where it lands:
 *   user's type_override → rules/heuristics (intercompany flag, then txn_type)
 * 'normal' rows hit the P&L, 'transfer' rows sit in the Transfers section,
 * 'intercompany' rows are eliminated when both legs' entities are selected.
 *
 * This file is the Vercel entry point and only routes: it authenticates,
 * picks the report or action, and writes the Reply. The work lives in
 * lib/books/ (Vercel deploys everything under api/ as a function, so helpers
 * must not live here).
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

/** GET ?report= → handler. */
const REPORTS: Record<string, (query: Query) => Promise<Reply>> = {
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
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "GET" && !canWrite(user)) return res.status(403).json({ error: "forbidden" });

  try {
    let reply: Reply;
    if (req.method === "POST") {
      const name = String(req.body?.action ?? "");
      const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : editTransaction;
      reply = await action({ body: req.body ?? {}, user });
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "method_not_allowed" });
    } else {
      const name = String(req.query.report ?? "");
      const report = Object.hasOwn(REPORTS, name) ? REPORTS[name] : null;
      if (!report) {
        return res.status(400).json({ error: "unknown_report", message: "Use: meta, transactions, pnl, cell, vendors" });
      }
      reply = await report(req.query);
    }
    return res.status(reply.status).json(reply.body);
  } catch (err: any) {
    console.error("books data error:", err.message);
    return res.status(500).json({ error: "books_data_failed", message: "Couldn't load that report." });
  }
}
