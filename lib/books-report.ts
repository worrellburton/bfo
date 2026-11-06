/**
 * The report arithmetic behind Books, Home and Ask, under its older name.
 * Everything here now lives in lib/books/statements.ts, the one place income
 * and spending are counted; this file re-exports it so existing imports keep
 * working. New code imports from lib/books/statements.js.
 *
 * HTTP surface: none; a library.
 * Who may call it: server code.
 * Env: none of its own (statements.ts reads Supabase only in its report functions).
 */

export {
  ALL,
  cleanEntityName,
  effType,
  eliminated,
  flowMonths,
  flowSummary,
  incomeExpense,
  incomeStatement,
  label,
  placeTxn,
  prettyCategory,
  scopeOf,
  type EffType,
  type FlowSummary,
  type IncomeStatement,
  type Placement,
  type ReportTxn,
  type Scope,
} from "./books/statements.js";
