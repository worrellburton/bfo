import { sectionOf } from "./books-rules.js";

/**
 * The report arithmetic behind Books and the home page, kept pure so it can
 * be tested without a database: what kind of movement a transaction is, when
 * an intercompany row vanishes from a rollup, and the home page's revenue
 * and expense windows.
 */

export type ReportTxn = {
  transaction_id?: string;
  account_id: string;
  date: string;
  amount: number | string;
  name?: string | null;
  merchant_name?: string | null;
  entity_name?: string | null;
  plaid_category: string | null;
  book_category: string | null;
  txn_type: string;
  intercompany: boolean;
  counterparty_account_id?: string | null;
  type_override: string | null;
  loan_id: string | null;
};

export type EffType = "normal" | "transfer" | "intercompany" | "loan";

export function prettyCategory(primary: string | null): string {
  if (!primary) return "Uncategorized";
  const s = primary.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** What a transaction is for the report: the loan attachment wins, then the person's override, then the sync's reading. */
export function effType(t: Pick<ReportTxn, "loan_id" | "type_override" | "intercompany" | "txn_type">): EffType {
  // A transaction attached to a loan is a balance-sheet movement — that
  // attachment is the user's most explicit signal, so it wins outright.
  if (t.loan_id) return "loan";
  if (t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany") {
    return t.type_override;
  }
  if (t.intercompany) return "intercompany";
  return t.txn_type === "transfer" ? "transfer" : "normal";
}

/** The books account a transaction is reported under. */
export function label(t: Pick<ReportTxn, "book_category" | "plaid_category">): string {
  return t.book_category || prettyCategory(t.plaid_category);
}

/**
 * Should this intercompany row vanish from the report? Only when we can see
 * both legs inside the current selection — for "all entities" that is every
 * row; under a partial selection the counterparty's entity must be selected
 * too. Unpaired rows under a partial selection stay visible rather than
 * silently disappearing.
 */
export function eliminated(
  t: Pick<ReportTxn, "counterparty_account_id">,
  selection: string[] | null,
  entityOfAccount: (accountId: string) => string | null | undefined,
): boolean {
  if (selection === null) return true;
  const counterEntity = t.counterparty_account_id ? entityOfAccount(t.counterparty_account_id) ?? null : null;
  return !!counterEntity && selection.includes(counterEntity);
}

/**
 * Income and expenses over a set of ledger rows, the way the P&L counts
 * them: transfers, roll-ups, loan movements and "flow" accounts (card
 * payments, internal transfers) are moving the family's own money, not
 * earning or spending it. Negative amounts are money in.
 */
export function incomeExpense(
  rows: Array<Pick<ReportTxn, "amount" | "book_category" | "plaid_category" | "loan_id" | "type_override" | "intercompany" | "txn_type">>
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const t of rows) {
    if (effType(t) !== "normal" || sectionOf(label(t)) === "flow") continue;
    const a = Number(t.amount);
    if (a > 0) expenses += a;
    else income -= a;
  }
  return { income: Math.round(income * 100) / 100, expenses: Math.round(expenses * 100) / 100 };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type FlowWindow = { in: number; out: number; net: number };
export type FlowRecent = { id: string; date: string; who: string; amount: number; entity: string | null; account: string };
export type FlowSummary = {
  current: FlowWindow;
  prior: FlowWindow;
  months: { month: string; in: number; out: number }[];
  topIn: { name: string; amount: number }[];
  topOut: { name: string; amount: number }[];
  recentIn: FlowRecent[];
  recentOut: FlowRecent[];
  countIn: number;
  countOut: number;
};

/** The six calendar months ending in `now`, as YYYY-MM. */
export function flowMonths(now: Date): string[] {
  const keys: string[] = [];
  for (let i = 5; i >= 0; i--) keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return keys;
}

/**
 * The home page's revenue and expense picture from settled transactions:
 * the last 30 days against the 30 before, six months of bars, the top
 * accounts and the newest transactions of the last 30 days. Transfers,
 * intercompany and loan movements are not revenue or expense, nor is
 * anything in a "flow" account; negative amounts are money in.
 */
export function flowSummary(rows: ReportTxn[], now: Date, entityName: (accountId: string) => string | null | undefined, recentLimit = 40): FlowSummary {
  const curFrom = iso(now.getTime() - 30 * DAY);
  const priorFrom = iso(now.getTime() - 60 * DAY);
  const win = (): FlowWindow => ({ in: 0, out: 0, net: 0 });
  const current = win();
  const prior = win();
  const months = new Map(flowMonths(now).map((m) => [m, { month: m, in: 0, out: 0 }]));
  const topIn = new Map<string, number>();
  const topOut = new Map<string, number>();
  const recentIn: FlowRecent[] = [];
  const recentOut: FlowRecent[] = [];
  for (const t of rows) {
    if (effType(t) !== "normal" || sectionOf(label(t)) === "flow") continue;
    const amt = Number(t.amount);
    const m = months.get(t.date.slice(0, 7));
    if (m) {
      if (amt < 0) m.in += -amt;
      else m.out += amt;
    }
    if (t.date <= priorFrom) continue;
    const w = t.date > curFrom ? current : prior;
    if (amt < 0) w.in += -amt;
    else w.out += amt;
    if (t.date > curFrom) {
      const top = amt < 0 ? topIn : topOut;
      const key = label(t);
      top.set(key, (top.get(key) ?? 0) + Math.abs(amt));
      (amt < 0 ? recentIn : recentOut).push({
        id: String(t.transaction_id ?? ""),
        date: t.date,
        who: t.merchant_name || t.name || "—",
        amount: Math.round(Math.abs(amt)),
        entity: entityName(t.account_id) ?? t.entity_name ?? null,
        account: key.replace(/^\d{4}\s+/, ""),
      });
    }
  }
  for (const w of [current, prior]) {
    w.in = Math.round(w.in);
    w.out = Math.round(w.out);
    w.net = w.in - w.out;
  }
  const ranked = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }));
  const newest = (list: FlowRecent[]) => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  return {
    current,
    prior,
    months: [...months.values()].map((m) => ({ month: m.month, in: Math.round(m.in), out: Math.round(m.out) })),
    topIn: ranked(topIn),
    topOut: ranked(topOut),
    recentIn: newest(recentIn).slice(0, recentLimit),
    recentOut: newest(recentOut).slice(0, recentLimit),
    countIn: recentIn.length,
    countOut: recentOut.length,
  };
}
