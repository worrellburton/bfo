import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser, fail, guard, handleError, type AppUser } from "../../lib/auth.js";
import { builtInRules } from "../../lib/books-rules.js";
import { unassignedLoanRows } from "../../lib/books-loans.js";
import { rulesLedgerReport } from "../../lib/books/rules-report.js";
import { ok, type Query, type Reply, type WriteCtx } from "../../lib/books/types.js";
import {
  attachLoan,
  closePeriod,
  periodsReport,
  previewMatch,
  reopenPeriod,
  restoreRule,
  restoreValues,
  reviewDuplicate,
  setOpening,
} from "../../lib/books/writes.js";

/**
 * The ledger's controls, beside the main Books endpoint (api/books/data):
 * what a bulk change will touch before it runs, the Undo after it, the
 * period lock, the rules with their order and overlaps, settling possible
 * duplicates, and opening balances. The work lives in lib/books/.
 *
 *   GET  ?report=preview&match=…&match_kind=vendor|contains → count, span, entities, hand edits, closed rows, overlapping rules
 *   GET  ?report=periods  → every period close, newest first
 *   GET  ?report=rules    → taught rules in the order they're tried, with matches, overlaps and who made them; the built-in rules
 *   GET  ?report=loan-activity → posted rows filed to 9300 Loans that aren't attached to a loan
 *   POST {action: restore_values, changes}            → Undo a bulk change
 *   POST {action: restore_rule, rule}                 → Undo a rule delete
 *   POST {action: attach_loan, loan_id, transaction_ids}
 *   POST {action: close_period, entity_id?, entity_name?, closed_through, reason?}  (admins)
 *   POST {action: reopen_period, id, reason}                                        (admins)
 *   POST {action: review_duplicate, group_key, note?}
 *   POST {action: set_opening, account_id, opening_balance, as_of, note?}
 *
 * Who may call it: anyone signed in may read; writing needs canWrite, and
 * closing or reopening a period needs an admin. Partners are refused (403).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through lib/auth.ts sbFetch).
 */

const ACTIONS: Record<string, (ctx: WriteCtx) => Promise<Reply>> = {
  restore_values: restoreValues,
  restore_rule: restoreRule,
  attach_loan: attachLoan,
  close_period: closePeriod,
  reopen_period: reopenPeriod,
  review_duplicate: reviewDuplicate,
  set_opening: setOpening,
};

const REPORTS: Record<string, (q: Query) => Promise<Reply>> = {
  preview: previewMatch,
  periods: () => periodsReport(),
  rules: () => rulesLedgerReport(builtInRules()),
  "loan-activity": async () => ok({ rows: await unassignedLoanRows() }),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;
  let user: AppUser | null;
  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    user = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!user) return fail(res, 401, "unauthorized");
  if (req.method === "POST" && !canWrite(user)) return fail(res, 403, "forbidden", "You have view-only access to Books.");
  try {
    let reply: Reply;
    if (req.method === "POST") {
      const name = String(req.body?.action ?? "");
      const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
      if (!action) return fail(res, 400, "unknown_action");
      reply = await action({ body: req.body ?? {}, user });
    } else {
      const name = String(req.query.report ?? "");
      const report = Object.hasOwn(REPORTS, name) ? REPORTS[name] : null;
      if (!report) return fail(res, 400, "unknown_report");
      reply = await report(req.query);
    }
    return res.status(reply.status).json(reply.body);
  } catch (err) {
    return handleError(res, err);
  }
}
