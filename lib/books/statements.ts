import { sbFetch } from "../auth.js";
import { sectionOf } from "../books-accounts.js";
import { fetchAll } from "../db-pages.js";
import { readLocks } from "./db.js";
import { isLocked, type PeriodLock } from "./ledger.js";
import { parseEntities, yearOf } from "./filters.js";
import { getPrefs, scopeFilter, withLiveEntity } from "./prefs.js";
import { ok, type BookTxn, type Pref, type Query, type Reply } from "./types.js";

/**
 * Books' statements, and the one place income and spending are counted.
 *
 * The first half is pure: where a ledger row lands (placeTxn), the totals
 * that follow (incomeStatement), Home's 30-day picture (flowSummary), the
 * ledger strip's income and expenses (incomeExpense), and the statements
 * built from the same placement: the revenue-and-expense matrix (buildPnl),
 * the cash-flow summary (cashFlow) and the trial balance (trialBalance).
 * Home (lib/books/home.ts), the Transactions strip (lib/books/reports.ts) and
 * Ask (lib/ask.ts, lib/ask-books.ts) import from here, so the same rows give
 * the same figures to the cent everywhere (tests/books-statements.test.ts).
 *
 * The rules, once:
 *  - A row's kind is effType(): a loan attachment wins, then the person's
 *    override, then the sync's reading.
 *  - Transfers, loan movements and anything filed to a 9000s account are
 *    the family moving its own money. They sit in "flow" groups, never in
 *    receipts or disbursements.
 *  - An intercompany row is eliminated only when its other leg is in the
 *    report: its counterparty account is in Books and belongs to a selected
 *    entity. An unpaired leg stays visible as unmatched.
 *  - Every other row with a chart account lands in its account's section and
 *    nets inside the account, so a refund reduces the expense it refunds.
 *    4000s are income; 6000s and 7000s are expense. 4300 (Social Security)
 *    and 6750 (Medical) are the grantor's own items and sit in a personal
 *    band, outside operations.
 *  - A row with no chart account is uncategorized: reported on its own line,
 *    outside every total, until someone files it.
 *  - Whole-dollar statements foot and cross-foot: each line's months (and
 *    entities) are apportioned to its rounded total, each section's columns
 *    to its rounded total, and a "Rounding" line carries any difference
 *    between the lines as shown and the section as rounded.
 *
 * The second half is I/O: ?report=pnl, cell, statements, vendors and ledger
 * (api/books/data.ts routes here).
 *
 * HTTP surface: none directly; api/books/data.ts serves these reports.
 * Who may call it: server code, after the endpoint's role check (staff with a
 * login; partners are refused by currentUser).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through fetchAll and sbFetch).
 */

// ════════════════════════════════════════════════════════════════════════
// Pure: what a row is
// ════════════════════════════════════════════════════════════════════════

export type ReportTxn = {
  transaction_id?: string;
  account_id: string;
  date: string;
  amount: number | string;
  name?: string | null;
  merchant_name?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  plaid_category: string | null;
  book_category: string | null;
  txn_type: string | null;
  intercompany: boolean | null;
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
  if (t.loan_id) return "loan";
  if (t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany") return t.type_override;
  if (t.intercompany) return "intercompany";
  return t.txn_type === "transfer" ? "transfer" : "normal";
}

/** The books account a transaction is reported under. */
export function label(t: Pick<ReportTxn, "book_category" | "plaid_category">): string {
  return t.book_category || prettyCategory(t.plaid_category);
}

/**
 * Does this intercompany row drop out of the report? Only when its other leg
 * is in the report too: the counterparty account is in Books (and not
 * hidden) and belongs to a selected entity (any entity, for "all"). A leg
 * whose other side isn't in Books, or isn't selected, stays visible as
 * unmatched instead of silently disappearing.
 */
export function eliminated(t: Pick<ReportTxn, "counterparty_account_id">, selection: string[] | null, entityOfAccount: (accountId: string) => string | null | undefined): boolean {
  const other = t.counterparty_account_id;
  if (!other) return false;
  const entity = entityOfAccount(other);
  if (!entity) return false;
  return selection === null || selection.includes(entity);
}

/** An entity's name without BFO's notes in parentheses: "Breezewood (100%)" → "Breezewood". */
export function cleanEntityName(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "4000 Rental Income" → { code: "4000", name: "Rental Income" }; a Plaid label has no code. */
export function splitAccount(account: string): { code: string | null; name: string } {
  const m = /^(\d{4})\s+(.+)$/.exec(account.trim());
  return m ? { code: m[1], name: m[2] } : { code: null, name: account.trim() };
}

/** Where a statement line sits. Revenue, other and personal read money in as positive; operating expenses read money out as positive. */
export type StatementSection = "revenue" | "operating" | "other" | "personal";

/** The grantor's own items a revocable trust carries: Social Security in, medical out. */
const PERSONAL_CODES = new Set(["4300", "6750"]);

/** The statement section for a chart account, "flow" for the 9000s, null for a label that isn't a chart account. */
export function statementSection(account: string): StatementSection | "flow" | null {
  const s = sectionOf(account);
  if (s === null || s === "flow") return s;
  if (PERSONAL_CODES.has(account.trim().slice(0, 4))) return "personal";
  return s;
}

/** 4000s are income; 6000s and 7000s are expense. */
export function natureOf(account: string): "income" | "expense" {
  return account.trim().startsWith("4") ? "income" : "expense";
}

/** The off-statement groups, in the order the report shows them. */
export type FlowGroup = "own" | "conflict" | "intercompany" | "loans" | "capital" | "distributions";
export const FLOW_GROUPS: FlowGroup[] = ["own", "conflict", "intercompany", "loans", "capital", "distributions"];

function flowGroupOf(account: string): FlowGroup {
  const code = account.trim().slice(0, 4);
  if (code === "9000") return "intercompany";
  if (/^92\d\d$/.test(code)) return "distributions";
  if (/^93\d\d$/.test(code)) return "loans";
  if (/^94\d\d$/.test(code)) return "capital";
  return "own";
}

/** Which entities the report covers, and how to find an account's entity (undefined: not in Books, or hidden). */
export type Scope = { selection: string[] | null; entityOfAccount: (accountId: string) => string | null | undefined };

/** Every entity, with no account map: nothing is eliminated. */
export const ALL: Scope = { selection: null, entityOfAccount: () => undefined };

/** The scope for a selection over the live account mappings: hidden accounts aren't in the report. */
export function scopeOf(prefs: Map<string, Pick<Pref, "entity_id" | "hidden">>, selection: string[] | null): Scope {
  return {
    selection,
    entityOfAccount: (id) => {
      const p = prefs.get(id);
      return p && !p.hidden ? p.entity_id : undefined;
    },
  };
}

export type PlaceableTxn = Pick<ReportTxn, "amount" | "book_category" | "plaid_category" | "loan_id" | "type_override" | "intercompany" | "txn_type"> & {
  counterparty_account_id?: string | null;
};

/** Where one row lands. `cents` is the row in whole cents, money in positive. */
export type Placement =
  | { kind: "line"; section: StatementSection; nature: "income" | "expense"; account: string; cents: number }
  | { kind: "uncategorized"; account: string; cents: number }
  | { kind: "flow"; group: FlowGroup; account: string; cents: number; eliminated: boolean };

/** A Plaid amount (money out positive) as whole cents, money in positive. */
export const inflowCents = (amount: number | string): number => -Math.round(Number(amount) * 100);

/** One row's place on the statements. */
export function placeTxn(t: PlaceableTxn, scope: Scope = ALL): Placement {
  const eff = effType(t);
  const account = label(t);
  const cents = inflowCents(t.amount);
  if (eff === "intercompany") {
    return { kind: "flow", group: "intercompany", account, cents, eliminated: eliminated({ counterparty_account_id: t.counterparty_account_id ?? null }, scope.selection, scope.entityOfAccount) };
  }
  if (eff === "loan") return { kind: "flow", group: "loans", account, cents, eliminated: false };
  const section = statementSection(account);
  if (eff === "transfer") {
    // An income or expense account typed as a transfer: neither on the
    // statement nor a real transfer. Shown as an exception until fixed.
    if (section && section !== "flow") return { kind: "flow", group: "conflict", account, cents, eliminated: false };
    return { kind: "flow", group: flowGroupOf(account), account, cents, eliminated: false };
  }
  if (section === "flow") return { kind: "flow", group: flowGroupOf(account), account, cents, eliminated: false };
  if (section === null) return { kind: "uncategorized", account, cents };
  return { kind: "line", section, nature: natureOf(account), account, cents };
}

/** A line's value in its section's sign: operating expenses read money out as positive; the rest money in. */
export const sectionCents = (section: StatementSection, cents: number): number => (section === "operating" ? -cents : cents);

// ════════════════════════════════════════════════════════════════════════
// Pure: the totals (what Home, Ask and the ledger strip read)
// ════════════════════════════════════════════════════════════════════════

/** Money in and out, to the cent, and how many rows. */
export type Moves = { in: number; out: number; net: number; count: number };

const dollars = (cents: number): number => cents / 100;

class Tally {
  in = 0;
  out = 0;
  count = 0;
  add(cents: number) {
    this.count += 1;
    if (cents >= 0) this.in += cents;
    else this.out -= cents;
  }
  moves(): Moves {
    return { in: dollars(this.in), out: dollars(this.out), net: dollars(this.in - this.out), count: this.count };
  }
}

export type IncomeStatement = {
  transactions: number;
  /** Income accounts (4000s), refunds netted: the P&L's receipts. */
  receipts: number;
  /** Expense accounts (6000s, 7000s), refunds netted: the P&L's disbursements. */
  disbursements: number;
  /** Receipts less disbursements: the bottom line of the P&L. */
  net: number;
  /** Revenue less operating expenses. */
  operatingIncome: number;
  /** Each section's total and its accounts, in the section's sign (operating: money out positive; the rest money in positive). */
  sections: Record<StatementSection, { total: number; accounts: { account: string; amount: number }[] }>;
  /** Rows with no chart account: outside every total above. */
  uncategorized: Moves;
  /** Off-statement movements by group (not eliminated). */
  flows: Record<FlowGroup, Moves>;
  /** Intercompany legs whose other side is in the report. */
  eliminated: Moves;
};

/**
 * The income-statement totals for a set of posted rows: what the P&L shows
 * for the same rows and scope, to the cent. Ask answers "how much did we
 * earn or spend" from this; Home's windows and the ledger strip are the same
 * sums over their own rows.
 */
export function incomeStatement(rows: PlaceableTxn[], scope: Scope = ALL): IncomeStatement {
  const lines: Record<StatementSection, Map<string, number>> = { revenue: new Map(), operating: new Map(), other: new Map(), personal: new Map() };
  let receipts = 0;
  let disbursements = 0;
  const uncategorized = new Tally();
  const eliminatedT = new Tally();
  const flows = Object.fromEntries(FLOW_GROUPS.map((g) => [g, new Tally()])) as Record<FlowGroup, Tally>;
  for (const t of rows) {
    const p = placeTxn(t, scope);
    if (p.kind === "uncategorized") uncategorized.add(p.cents);
    else if (p.kind === "flow") (p.eliminated ? eliminatedT : flows[p.group]).add(p.cents);
    else {
      const m = lines[p.section];
      m.set(p.account, (m.get(p.account) ?? 0) + sectionCents(p.section, p.cents));
      if (p.nature === "income") receipts += p.cents;
      else disbursements -= p.cents;
    }
  }
  const section = (m: Map<string, number>) => ({
    total: dollars([...m.values()].reduce((s, v) => s + v, 0)),
    accounts: [...m.entries()].map(([account, c]) => ({ account, amount: dollars(c) })).sort((a, b) => a.account.localeCompare(b.account)),
  });
  const sections = { revenue: section(lines.revenue), operating: section(lines.operating), other: section(lines.other), personal: section(lines.personal) };
  const revenueC = [...lines.revenue.values()].reduce((s, v) => s + v, 0);
  const operatingC = [...lines.operating.values()].reduce((s, v) => s + v, 0);
  return {
    transactions: rows.length,
    receipts: dollars(receipts),
    disbursements: dollars(disbursements),
    net: dollars(receipts - disbursements),
    operatingIncome: dollars(revenueC - operatingC),
    sections,
    uncategorized: uncategorized.moves(),
    flows: Object.fromEntries(FLOW_GROUPS.map((g) => [g, flows[g].moves()])) as Record<FlowGroup, Moves>,
    eliminated: eliminatedT.moves(),
  };
}

/**
 * Income and expenses for the Transactions strip: the P&L's receipts and
 * disbursements over the filtered rows, with what's uncategorized beside
 * them (outside both).
 */
export function incomeExpense(rows: PlaceableTxn[], scope: Scope = ALL): { income: number; expenses: number; uncategorized: Moves } {
  const s = incomeStatement(rows, scope);
  return { income: s.receipts, expenses: s.disbursements, uncategorized: s.uncategorized };
}

// ── Home: the last 30 days against the 30 before ─────────────────────────

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type FlowWindow = { in: number; out: number; net: number; from: string; to: string; uncategorized: Moves };
type FlowRecent = { id: string; date: string; who: string; amount: number; entity: string | null; account: string };
export type FlowSummary = {
  basis: "cash";
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
 * Home's revenue and expense picture from posted rows: the last 30 days
 * against the 30 before, six months of bars, the top accounts and the newest
 * rows of the last 30 days. "In" is receipts and "out" is disbursements, as
 * the P&L counts them (placeTxn): refunds net inside their account (a refund
 * shows in the "out" list as a negative amount), and uncategorized rows sit
 * beside each window, not inside it.
 */
export function flowSummary(rows: ReportTxn[], now: Date, entityName: (accountId: string) => string | null | undefined, recentLimit = 40, scope: Scope = ALL): FlowSummary {
  const curFrom = isoDay(now.getTime() - 30 * DAY);
  const priorFrom = isoDay(now.getTime() - 60 * DAY);
  const today = isoDay(now.getTime());
  const acc = () => ({ inC: 0, outC: 0, unc: new Tally() });
  const cur = acc();
  const pri = acc();
  const months = new Map(flowMonths(now).map((m) => [m, { inC: 0, outC: 0 }]));
  const topIn = new Map<string, number>();
  const topOut = new Map<string, number>();
  const recentIn: FlowRecent[] = [];
  const recentOut: FlowRecent[] = [];
  for (const t of rows) {
    const p = placeTxn(t, scope);
    const inCurrent = t.date > curFrom && t.date <= today;
    const inPrior = t.date > priorFrom && t.date <= curFrom;
    if (p.kind === "uncategorized") {
      if (inCurrent) cur.unc.add(p.cents);
      else if (inPrior) pri.unc.add(p.cents);
      continue;
    }
    if (p.kind !== "line") continue;
    const income = p.nature === "income";
    // In its nature's direction: receipts money in, disbursements money out.
    const v = income ? p.cents : -p.cents;
    const m = months.get(t.date.slice(0, 7));
    if (m) {
      if (income) m.inC += v;
      else m.outC += v;
    }
    const w = inCurrent ? cur : inPrior ? pri : null;
    if (!w) continue;
    if (income) w.inC += v;
    else w.outC += v;
    if (!inCurrent) continue;
    const top = income ? topIn : topOut;
    top.set(p.account, (top.get(p.account) ?? 0) + v);
    (income ? recentIn : recentOut).push({
      id: String(t.transaction_id ?? ""),
      date: t.date,
      who: t.merchant_name || t.name || "—",
      amount: dollars(v),
      entity: cleanEntityName(entityName(t.account_id) ?? t.entity_name ?? "") || null,
      account: splitAccount(p.account).name,
    });
  }
  const win = (a: ReturnType<typeof acc>, from: string, to: string): FlowWindow => ({
    in: dollars(a.inC),
    out: dollars(a.outC),
    net: dollars(a.inC - a.outC),
    from,
    to,
    uncategorized: a.unc.moves(),
  });
  const ranked = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, c]) => ({ name, amount: dollars(c) }));
  const newest = (list: FlowRecent[]) => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  return {
    basis: "cash",
    current: win(cur, isoDay(now.getTime() - 29 * DAY), today),
    prior: win(pri, isoDay(now.getTime() - 59 * DAY), curFrom),
    months: [...months.entries()].map(([month, m]) => ({ month, in: dollars(m.inC), out: dollars(m.outC) })),
    topIn: ranked(topIn),
    topOut: ranked(topOut),
    recentIn: newest(recentIn).slice(0, recentLimit),
    recentOut: newest(recentOut).slice(0, recentLimit),
    countIn: recentIn.length,
    countOut: recentOut.length,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Pure: whole dollars that foot
// ════════════════════════════════════════════════════════════════════════

/** Whole dollars from cents, half away from zero. */
export function roundCents(cents: number): number {
  const r = Math.round(Math.abs(cents) / 100);
  return cents < 0 ? -r : r;
}

/**
 * Whole dollars for each cell, summing exactly to `total`, each within $1 of
 * its cents. Cells start at their nearest dollar; any difference goes, $1 at
 * a time, to the cells whose rounding moved them furthest the other way
 * (never to a cell that holds nothing).
 */
export function apportion(cents: number[], total: number): number[] {
  const out = cents.map(roundCents);
  let diff = total - out.reduce((s, v) => s + v, 0);
  if (diff === 0) return out;
  const step = diff > 0 ? 1 : -1;
  const order = cents
    .map((c, i) => ({ i, residual: c / 100 - out[i], empty: c === 0 }))
    .filter((x) => !x.empty)
    .sort((a, b) => (step > 0 ? b.residual - a.residual : a.residual - b.residual));
  for (let k = 0; diff !== 0 && order.length; k++) {
    out[order[k % order.length].i] += step;
    diff -= step;
  }
  return out;
}

/** One line's (or one total's) figures: whole dollars by month, by entity, and for the period; `exact` to the cent. */
export type Figures = { monthly: number[]; by_entity: number[]; total: number; exact: number };

export type StatementLine = { label: string; code: string | null; name: string; figures: Figures; drill: string | null };

export type Block = {
  key: string;
  title: string;
  /** How the block's figures read: "in" (money in positive) or "out" (money out positive). */
  sign: "in" | "out";
  note?: string;
  lines: StatementLine[];
  /** Present when the lines as shown don't add to the block's rounded total. */
  rounding: Figures | null;
  total: Figures;
};

type CellCents = { monthly: number[]; byEntity: number[] };

const zeros = (n: number) => Array<number>(n).fill(0);
const sumCols = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);

function figuresOf(c: CellCents): Figures {
  const exactC = c.monthly.reduce((s, v) => s + v, 0);
  const total = roundCents(exactC);
  return { monthly: apportion(c.monthly, total), by_entity: apportion(c.byEntity, total), total, exact: dollars(exactC) };
}

/** Lines → a block whose total foots (lines plus rounding) and cross-foots (columns add to the total). */
export function buildBlock(
  key: string,
  title: string,
  sign: "in" | "out",
  lines: Array<{ label: string; drill: string | null; cells: CellCents }>,
  cols: { months: number; entities: number },
  note?: string,
): Block {
  const built = lines.map((l) => ({ label: l.label, ...splitAccount(l.label), figures: figuresOf(l.cells), drill: l.drill }));
  const all = lines.reduce<CellCents>((s, l) => ({ monthly: sumCols(s.monthly, l.cells.monthly), byEntity: sumCols(s.byEntity, l.cells.byEntity) }), {
    monthly: zeros(cols.months),
    byEntity: zeros(cols.entities),
  });
  const total = figuresOf(all);
  const shown = (pick: (f: Figures) => number[]) => built.reduce((s, l) => sumCols(s, pick(l.figures)), zeros(pick(total).length));
  const rm = sumCols(
    total.monthly,
    shown((f) => f.monthly).map((v) => -v),
  );
  const re = sumCols(
    total.by_entity,
    shown((f) => f.by_entity).map((v) => -v),
  );
  const rt = total.total - built.reduce((s, l) => s + l.figures.total, 0);
  const rounding = rm.some((v) => v !== 0) || re.some((v) => v !== 0) || rt !== 0 ? { monthly: rm, by_entity: re, total: rt, exact: 0 } : null;
  return { key, title, sign, ...(note ? { note } : {}), lines: built, rounding, total };
}

/** a + b (or a − b) column by column, for derived lines (operating income, net). */
export function combine(parts: Array<[Figures, 1 | -1]>): Figures {
  const [first] = parts;
  const z: Figures = { monthly: zeros(first[0].monthly.length), by_entity: zeros(first[0].by_entity.length), total: 0, exact: 0 };
  return parts.reduce<Figures>(
    (s, [f, k]) => ({
      monthly: s.monthly.map((v, i) => v + k * f.monthly[i]),
      by_entity: s.by_entity.map((v, i) => v + k * f.by_entity[i]),
      total: s.total + k * f.total,
      exact: Math.round((s.exact + k * f.exact) * 100) / 100,
    }),
    z,
  );
}

// ════════════════════════════════════════════════════════════════════════
// Pure: transfers that should net to zero
// ════════════════════════════════════════════════════════════════════════

type Leg = { transaction_id: string; account_id: string; date: string; amount: number | string };

/**
 * Transfers between the family's own accounts come in pairs: money out of
 * one account and the same amount into another within a few days. Returns
 * the legs with no partner in `rows`: the reason "transfers" don't net.
 */
export function unmatchedTransfers<T extends Leg>(rows: T[], days = 5): T[] {
  const byAmount = new Map<number, T[]>();
  for (const t of rows) {
    const k = Math.abs(Math.round(Number(t.amount) * 100));
    if (!k) continue;
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push(t);
  }
  const paired = new Set<string>();
  for (const list of byAmount.values()) {
    const outs = list.filter((t) => Number(t.amount) > 0).sort((a, b) => a.date.localeCompare(b.date));
    const ins = list.filter((t) => Number(t.amount) < 0).sort((a, b) => a.date.localeCompare(b.date));
    for (const o of outs) {
      const match = ins.find((i) => !paired.has(i.transaction_id) && i.account_id !== o.account_id && Math.abs(Date.parse(i.date) - Date.parse(o.date)) <= days * DAY);
      if (!match) continue;
      paired.add(o.transaction_id);
      paired.add(match.transaction_id);
    }
  }
  return rows.filter((t) => Math.round(Number(t.amount) * 100) !== 0 && !paired.has(t.transaction_id));
}

// ════════════════════════════════════════════════════════════════════════
// Pure: the revenue-and-expense statement (by month and by entity)
// ════════════════════════════════════════════════════════════════════════

export type LedgerRow = ReportTxn & { transaction_id: string };

const SECTION_TITLES: Record<StatementSection, string> = {
  revenue: "Revenue",
  operating: "Operating expenses",
  other: "Other income (expense)",
  personal: "Personal (grantor)",
};

const FLOW_TITLES: Record<FlowGroup, { title: string; note?: string }> = {
  own: { title: "Transfers between your own accounts", note: "These should net to zero." },
  conflict: { title: "Income or expense accounts typed as transfers", note: "Left out of the statement until the account or the type is fixed." },
  intercompany: { title: "Between family entities, not matched", note: "The other side isn't in the selected entities or isn't in Books." },
  loans: { title: "Loans" },
  capital: { title: "Capital improvements" },
  distributions: { title: "Distributions and draws", note: "Payments out of a trust may need a gift-tax return or a trustee's review." },
};

export type PnlOptions = {
  year: number;
  /** Entities in the report, for the by-entity columns (name already cleaned). */
  entities: Array<{ id: string; name: string }>;
  /** Loan id → name, so a loan's movements read under its name. */
  loanNames?: Map<string, string>;
};

/** The flow row label: a loan's movements under the loan's name. */
export function flowLabel(t: Pick<ReportTxn, "loan_id" | "book_category" | "plaid_category">, loanNames?: Map<string, string>): string {
  return t.loan_id ? `${loanNames?.get(t.loan_id) ?? "Loan"} (loan)` : label(t);
}

/**
 * The year's revenue-and-expense statement, cash basis, with columns by
 * month and by entity. Everything shown is whole dollars that foot and
 * cross-foot; every figure also carries its exact value to the cent.
 */
export function buildPnl(rows: LedgerRow[], scope: Scope, opts: PnlOptions) {
  const months = 12;
  const entityCols = [...opts.entities];
  const entityIndex = new Map(entityCols.map((e, i) => [e.id, i]));
  const noEntity = rows.some((t) => !t.entity_id || !entityIndex.has(t.entity_id));
  if (noEntity) entityCols.push({ id: "none", name: "No entity" });
  const colOf = (t: LedgerRow) => (t.entity_id && entityIndex.has(t.entity_id) ? entityIndex.get(t.entity_id)! : entityCols.length - 1);
  const cols = { months, entities: entityCols.length };
  const blank = (): CellCents => ({ monthly: zeros(months), byEntity: zeros(cols.entities) });

  const sectionLines: Record<StatementSection, Map<string, CellCents>> = { revenue: new Map(), operating: new Map(), other: new Map(), personal: new Map() };
  const uncLines = new Map<string, CellCents>();
  const flowLines = Object.fromEntries(FLOW_GROUPS.map((g) => [g, new Map<string, CellCents>()])) as Record<FlowGroup, Map<string, CellCents>>;
  const ownLegs: LedgerRow[] = [];
  const elim = new Tally();
  const conflictAccounts = new Set<string>();

  const add = (m: Map<string, CellCents>, key: string, t: LedgerRow, cents: number) => {
    const c = m.get(key) ?? blank();
    c.monthly[Number(t.date.slice(5, 7)) - 1] += cents;
    c.byEntity[colOf(t)] += cents;
    m.set(key, c);
  };

  for (const t of rows) {
    const p = placeTxn(t, scope);
    if (p.kind === "line") add(sectionLines[p.section], p.account, t, sectionCents(p.section, p.cents));
    else if (p.kind === "uncategorized") add(uncLines, p.account, t, p.cents);
    else if (p.eliminated) elim.add(p.cents);
    else {
      add(flowLines[p.group], flowLabel(t, opts.loanNames), t, p.cents);
      if (p.group === "own") ownLegs.push(t);
      if (p.group === "conflict") conflictAccounts.add(p.account);
    }
  }

  const linesOf = (m: Map<string, CellCents>, drill: (key: string) => string) =>
    [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, cells]) => ({ label: key, drill: drill(key), cells }));

  const sections = (Object.keys(SECTION_TITLES) as StatementSection[]).map((s) =>
    buildBlock(
      s,
      SECTION_TITLES[s],
      s === "operating" ? "out" : "in",
      linesOf(sectionLines[s], () => s),
      cols,
    ),
  );
  const [revenue, operating, other, personal] = sections;
  const operatingIncome = combine([
    [revenue.total, 1],
    [operating.total, -1],
  ]);
  const net = combine([
    [operatingIncome, 1],
    [other.total, 1],
    [personal.total, 1],
  ]);

  const uncategorized = buildBlock(
    "uncategorized",
    "Uncategorized, needs review",
    "in",
    [...uncLines.entries()]
      .sort((a, b) => Math.abs(b[1].monthly.reduce((s, v) => s + v, 0)) - Math.abs(a[1].monthly.reduce((s, v) => s + v, 0)))
      .map(([key, cells]) => ({ label: key, drill: "uncategorized", cells })),
    cols,
    "Not in any total above. File these to an account to bring them in.",
  );

  const unmatched = unmatchedTransfers(ownLegs);
  const flows = FLOW_GROUPS.filter((g) => flowLines[g].size > 0).map((g) => {
    const b = buildBlock(
      `flow:${g}`,
      FLOW_TITLES[g].title,
      "in",
      linesOf(flowLines[g], () => `flow:${g}`),
      cols,
      FLOW_TITLES[g].note,
    );
    if (g !== "own") return { ...b, check: null };
    const c = unmatched.reduce((s, t) => s + inflowCents(t.amount), 0);
    return { ...b, check: { unmatched: dollars(c), unmatched_count: unmatched.length } };
  });

  // The same totals Home and Ask read, from the same placement.
  const totals = incomeStatement(rows, scope);

  return {
    year: opts.year,
    basis: "cash" as const,
    transaction_count: rows.length,
    columns: { months: Array.from({ length: months }, (_, i) => `${opts.year}-${String(i + 1).padStart(2, "0")}`), entities: entityCols },
    sections,
    operating_income: operatingIncome,
    net,
    receipts: totals.receipts,
    disbursements: totals.disbursements,
    net_exact: totals.net,
    uncategorized: { ...uncategorized, count: totals.uncategorized.count, in: totals.uncategorized.in, out: totals.uncategorized.out },
    flows,
    eliminated: elim.moves(),
    conflicts: [...conflictAccounts].sort(),
  };
}

export type Pnl = ReturnType<typeof buildPnl>;

/** The whole-dollar figure the statement shows for one cell, so a drill-down can tie to it. */
export function pnlCell(pnl: Pnl, section: string, rowLabel: string | null): Figures | null {
  if (section === "net") return pnl.net;
  if (section === "operating_income") return pnl.operating_income;
  const block =
    section === "uncategorized"
      ? pnl.uncategorized
      : (pnl.sections.find((b) => b.key === section) ?? pnl.flows.find((b) => b.key === section || (section === "intercompany" && b.key === "flow:intercompany")));
  if (!block) return null;
  if (!rowLabel) return block.total;
  return block.lines.find((l) => l.label === rowLabel)?.figures ?? null;
}

/** A cell's figure in one column: a month (1–12), an entity id, or the period. */
export function figureAt(f: Figures, pnl: Pick<Pnl, "columns">, column: { month?: number | null; entity?: string | null }): number {
  if (column.month) return f.monthly[column.month - 1] ?? 0;
  if (column.entity) {
    const i = pnl.columns.entities.findIndex((e) => e.id === column.entity);
    return i >= 0 ? f.by_entity[i] : 0;
  }
  return f.total;
}

/** Which rows a drill-down shows: the rows behind one statement cell. */
export function cellMatches(t: LedgerRow, scope: Scope, section: string, rowLabel: string | null, loanNames?: Map<string, string>): boolean {
  const p = placeTxn(t, scope);
  const labelOk = (l: string) => !rowLabel || l === rowLabel;
  if (section === "revenue" || section === "operating" || section === "other" || section === "personal") return p.kind === "line" && p.section === section && labelOk(p.account);
  if (section === "operating_income") return p.kind === "line" && (p.section === "revenue" || p.section === "operating");
  if (section === "net") return p.kind === "line";
  if (section === "uncategorized") return p.kind === "uncategorized" && labelOk(p.account);
  if (section === "eliminated") return p.kind === "flow" && p.eliminated;
  // The flow groups; "transfers" and "intercompany" are the older names.
  if (p.kind !== "flow" || p.eliminated) return false;
  if (section === "transfers") return p.group !== "intercompany" && labelOk(flowLabel(t, loanNames));
  if (section === "intercompany") return p.group === "intercompany" && labelOk(flowLabel(t, loanNames));
  if (section.startsWith("flow:")) return p.group === section.slice(5) && labelOk(flowLabel(t, loanNames));
  return false;
}

/** The sign a drill-down's net reads in: operating expenses as money out, everything else as money in. */
export function cellCents(t: LedgerRow, section: string): number {
  const c = inflowCents(t.amount);
  return section === "operating" ? -c : c;
}

// ════════════════════════════════════════════════════════════════════════
// Pure: the cash-flow summary and the trial balance
// ════════════════════════════════════════════════════════════════════════

export type FlowStatementLine = { label: string; amount: number; exact: number; drill: string | null };
export type FlowStatementBlock = { key: string; title: string; note?: string; lines: FlowStatementLine[]; total: number; exact: number };

function single(key: string, title: string, lines: Array<{ label: string; cents: number; drill: string | null }>, note?: string): FlowStatementBlock {
  const kept = lines.filter((l) => l.cents !== 0);
  const shown = kept.map((l) => ({ label: l.label, amount: roundCents(l.cents), exact: dollars(l.cents), drill: l.drill }));
  const exactC = kept.reduce((s, l) => s + l.cents, 0);
  const total = roundCents(exactC);
  const diff = total - shown.reduce((s, l) => s + l.amount, 0);
  if (diff !== 0) shown.push({ label: "Rounding", amount: diff, exact: 0, drill: null });
  return { key, title, ...(note ? { note } : {}), lines: shown, total, exact: dollars(exactC) };
}

/**
 * Where the period's cash went, by activity, from the same placement as the
 * P&L: operating is the P&L's bottom line; uncategorized rows are their own
 * line; loans and capital improvements are investing; distributions and
 * unmatched intercompany are financing; transfers between the family's own
 * accounts should come to zero. Money in positive, whole dollars.
 */
export function cashFlow(rows: LedgerRow[], scope: Scope) {
  const s = incomeStatement(rows, scope);
  const c = (v: number) => Math.round(v * 100);
  const operating = single("operating", "Operating activities", [
    { label: "Revenue received", cents: c(s.sections.revenue.total), drill: "revenue" },
    { label: "Operating expenses paid", cents: -c(s.sections.operating.total), drill: "operating" },
    { label: "Other income (expense)", cents: c(s.sections.other.total), drill: "other" },
    { label: "Personal (grantor) receipts and payments", cents: c(s.sections.personal.total), drill: "personal" },
  ]);
  const uncategorized = single("uncategorized", "Uncategorized, needs review", [{ label: "Not yet filed to an account", cents: c(s.uncategorized.net), drill: "uncategorized" }]);
  const investing = single("investing", "Investing activities", [
    { label: "Capital improvements", cents: c(s.flows.capital.net), drill: "flow:capital" },
    { label: "Loans made and repaid", cents: c(s.flows.loans.net), drill: "flow:loans" },
  ]);
  const financing = single("financing", "Financing activities", [
    { label: "Distributions and draws", cents: c(s.flows.distributions.net), drill: "flow:distributions" },
    { label: "Between family entities, not matched", cents: c(s.flows.intercompany.net), drill: "flow:intercompany" },
  ]);
  const own = single(
    "own",
    "Transfers between your own accounts",
    [
      { label: "Transfers and card payments", cents: c(s.flows.own.net), drill: "flow:own" },
      { label: "Income or expense accounts typed as transfers", cents: c(s.flows.conflict.net), drill: "flow:conflict" },
      { label: "Between family entities, matched", cents: c(s.eliminated.net), drill: "eliminated" },
    ],
    "Should come to zero when both sides are in Books.",
  );
  const blocks = [operating, uncategorized, investing, financing, own];
  const exactC = blocks.reduce((sum, b) => sum + c(b.exact), 0);
  return {
    blocks,
    net_change: blocks.reduce((sum, b) => sum + b.total, 0),
    net_change_exact: dollars(exactC),
    ties_to_pnl: operating.exact === s.net,
    pnl_net: s.net,
  };
}

export type TbRow = { account: string; group: string; detail: string | null; debit: number; credit: number };

const TB_GROUPS = ["Bank and card accounts", "Revenue", "Operating expenses", "Other income (expense)", "Personal (grantor)", "Transfers, loans and distributions", "Uncategorized"] as const;

/**
 * A trial balance of the period's activity, double entry: each ledger row
 * debits one side and credits the other (a payment debits its expense and
 * credits the bank account; a deposit debits the bank and credits its
 * income). Each account shows its net, so debits equal credits exactly.
 * Bank and card accounts show their net movement for the period, not their
 * balance. Before eliminations. Amounts to the cent.
 */
export function trialBalance(
  rows: LedgerRow[],
  scope: Scope,
  accountName: (accountId: string) => { name: string; detail: string | null },
): { rows: TbRow[]; totals: { debit: number; credit: number } } {
  // Each account's net in cents, debit positive.
  const nets = new Map<string, { name: string; group: string; detail: string | null; cents: number }>();
  const bump = (key: string, name: string, group: string, detail: string | null, cents: number) => {
    const e = nets.get(key) ?? { name, group, detail, cents: 0 };
    e.cents += cents;
    nets.set(key, e);
  };
  for (const t of rows) {
    const p = placeTxn(t, scope);
    const group = p.kind === "line" ? SECTION_TITLES[p.section] : p.kind === "uncategorized" ? "Uncategorized" : "Transfers, loans and distributions";
    // Money out debits the account it was spent on and credits the bank; money in the reverse.
    bump(`acct:${p.account}`, p.account, group, null, -p.cents);
    const bank = accountName(t.account_id);
    bump(`bank:${t.account_id}`, bank.name, "Bank and card accounts", bank.detail, p.cents);
  }
  const out: TbRow[] = [...nets.values()]
    .filter((v) => v.cents !== 0)
    .map((v) => ({ account: v.name, group: v.group, detail: v.detail, debit: v.cents > 0 ? dollars(v.cents) : 0, credit: v.cents < 0 ? dollars(-v.cents) : 0 }))
    .sort((a, b) => TB_GROUPS.indexOf(a.group as (typeof TB_GROUPS)[number]) - TB_GROUPS.indexOf(b.group as (typeof TB_GROUPS)[number]) || a.account.localeCompare(b.account));
  const debitC = [...nets.values()].reduce((s, v) => s + Math.max(0, v.cents), 0);
  const creditC = [...nets.values()].reduce((s, v) => s + Math.max(0, -v.cents), 0);
  return { rows: out, totals: { debit: dollars(debitC), credit: dollars(creditC) } };
}

// ════════════════════════════════════════════════════════════════════════
// I/O: the reports
// ════════════════════════════════════════════════════════════════════════

/** The year's posted rows for the selected entities, hidden accounts excluded, stamped with live entities. */
async function yearRows(year: string, prefs: Map<string, Pref>, selection: string[] | null, order: string): Promise<BookTxn[]> {
  return withLiveEntity(
    await fetchAll<BookTxn>(`book_transactions?select=*&pending=eq.false` + `&date=gte.${year}-01-01&date=lte.${year}-12-31` + scopeFilter(prefs, selection) + `&order=${order}`),
    prefs,
  );
}

/** The entities a selection covers, with their names cleaned, sorted by name. */
function entitiesIn(prefs: Map<string, Pref>, selection: string[] | null): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const p of prefs.values()) {
    if (p.hidden || !p.entity_id) continue;
    if (selection && !selection.includes(p.entity_id)) continue;
    seen.set(p.entity_id, cleanEntityName(p.entity_name) || p.entity_id);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** "Operating checking •• 1234": the account's nickname or name, then its last four. */
export function accountTitle(p: Pick<Pref, "nickname" | "account_name" | "institution_name" | "mask"> | undefined): string {
  const base = p?.nickname?.trim() || p?.account_name?.trim() || p?.institution_name?.trim() || "Account";
  return p?.mask ? `${base} •• ${String(p.mask).slice(-4)}` : base;
}

/** The last day the period covers: Dec 31 for a past year, the newest posted row for this one. */
function throughDate(year: string, rows: Array<{ date: string }>): string | null {
  const now = new Date();
  const thisYear = String(now.getUTCFullYear());
  if (year < thisYear) return `${year}-12-31`;
  if (year > thisYear) return null;
  return rows.reduce<string | null>((m, t) => (!m || t.date > m ? t.date : m), null);
}

/**
 * Accounts whose history in Books starts inside the period, so the period is
 * only partly covered for them, and the first day Books holds at all. A
 * failed lookup reads as "nothing known", never as a reason to fail the report.
 */
async function coverage(year: string, rows: Array<{ account_id: string; date: string }>, prefs: Map<string, Pref>, selection: string[] | null) {
  const firstIn = new Map<string, string>();
  for (const t of rows) if (!firstIn.has(t.account_id) || t.date < firstIn.get(t.account_id)!) firstIn.set(t.account_id, t.date);
  const startCandidates = [...firstIn.entries()].filter(([, d]) => d > `${year}-01-31`).slice(0, 12);
  const firstRow = async (path: string) => {
    try {
      const r = await sbFetch(path);
      if (!r.ok) return null;
      const list = (await r.json()) as Array<{ date: string }>;
      return list[0]?.date ?? null;
    } catch {
      return null;
    }
  };
  const [ledgerStart, ...earlier] = await Promise.all([
    firstRow(`book_transactions?select=date&pending=eq.false${scopeFilter(prefs, selection)}&order=date.asc,transaction_id.asc&limit=1`),
    ...startCandidates.map(([id]) =>
      firstRow(`book_transactions?select=date&pending=eq.false&account_id=eq.${encodeURIComponent(id)}&date=lt.${year}-01-01&order=date.asc,transaction_id.asc&limit=1`),
    ),
  ]);
  const late = startCandidates.filter((_, i) => earlier[i] === null).map(([id, first]) => ({ account: accountTitle(prefs.get(id)), first }));
  return { ledger_start: ledgerStart, late_accounts: late };
}

async function loanNameMap(): Promise<Map<string, string>> {
  return new Map((await fetchAll<{ id: string; name: string }>("book_loans?select=id,name&order=id.asc")).map((l) => [l.id, l.name]));
}

// ── P&L, and the transactions behind one of its cells ───────────────────

export async function pnlReport(query: Query, report: "pnl" | "cell"): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = (await yearRows(year, prefs, selection, "date.asc,transaction_id.asc")) as LedgerRow[];
  const scope = scopeOf(prefs, selection);
  const loanNames = await loanNameMap();
  const entities = entitiesIn(prefs, selection);
  const pnl = buildPnl(rows, scope, { year: Number(year), entities, loanNames });
  const period = { from: `${year}-01-01`, to: throughDate(year, rows) };

  if (report === "cell") {
    const section = String(query.section ?? "");
    const wantLabel = query.label != null && String(query.label) !== "" ? String(query.label) : null;
    const month = /^\d{1,2}$/.test(String(query.month)) ? Number(query.month) : null;
    const col = query.col != null && String(query.col) !== "" ? String(query.col) : null;
    const matches = rows
      .filter((t) => {
        if (month !== null && Number(t.date.slice(5, 7)) !== month) return false;
        if (col && (col === "none" ? !!t.entity_id && entities.some((e) => e.id === t.entity_id) : t.entity_id !== col)) return false;
        return cellMatches(t, scope, section, wantLabel, loanNames);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    const fig = pnlCell(pnl, section, wantLabel);
    const exactC = matches.reduce((s, t) => s + cellCents(t, section), 0);
    // Possible duplicates among these rows: the same account, day and amount.
    const groups = new Map<string, string[]>();
    for (const t of matches) {
      const k = `${t.account_id}|${t.date}|${Math.round(Number(t.amount) * 100)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(t.transaction_id);
    }
    let settled = new Set<string>();
    try {
      const r = await sbFetch("book_duplicate_reviews?select=group_key,decision&decision=eq.separate");
      if (r.ok) settled = new Set(((await r.json()) as Array<{ group_key: string }>).map((g) => g.group_key));
    } catch {
      // before the ledger migration there are no decisions yet
    }
    let locks: PeriodLock[] = [];
    try {
      locks = await readLocks(sbFetch);
    } catch {
      // a read-only view can show without the lock; every write path checks it itself
    }
    const locked = matches.filter((t) => isLocked({ date: t.date, entity_id: t.entity_id }, locks)).length;
    return ok({
      transactions: matches,
      count: matches.length,
      basis: "cash",
      period,
      entities: entities.map((e) => e.name),
      net: dollars(exactC),
      shown: fig ? figureAt(fig, pnl, { month, entity: col }) : null,
      // The statement's whole dollars for this line by month, so the drill-down's months match it.
      figures: fig && !col ? { monthly: fig.monthly, total: fig.total } : null,
      duplicates: [...groups.entries()].filter(([k, ids]) => ids.length > 1 && !settled.has(k)).map(([, ids]) => ids),
      locked,
      closed_through: locks.length ? locks.map((l) => l.closed_through).sort()[0] : null,
      accounts: Object.fromEntries([...new Set(matches.map((t) => t.account_id))].map((id) => [id, accountTitle(prefs.get(id))])),
    });
  }

  return ok({
    ...pnl,
    entity: selection ? selection.join(",") : "all",
    period,
    coverage: await coverage(year, rows, prefs, selection),
  });
}

// ── Statements: cash flow and trial balance ──────────────────────────────

export async function statementsReport(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = (await yearRows(year, prefs, selection, "transaction_id.asc")) as LedgerRow[];
  const scope = scopeOf(prefs, selection);
  const flow = cashFlow(rows, scope);
  const tb = trialBalance(rows, scope, (id) => {
    const p = prefs.get(id);
    return { name: accountTitle(p), detail: cleanEntityName(p?.entity_name) || null };
  });
  return ok({
    year: Number(year),
    entity: selection ? selection.join(",") : "all",
    basis: "cash",
    period: { from: `${year}-01-01`, to: throughDate(year, rows) },
    transaction_count: rows.length,
    cash_flow: flow,
    trial_balance: tb,
  });
}

// ── The general ledger, for export ───────────────────────────────────────

/** Every posted row of the year for the selection, with what a CPA needs beside each: the bank account, the effective type, the receipts. */
export async function ledgerExport(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = (await yearRows(year, prefs, selection, "date.asc,transaction_id.asc")) as LedgerRow[];
  const scope = scopeOf(prefs, selection);
  let receipts = new Map<string, number>();
  try {
    const list = await fetchAll<{ transaction_id: string }>("book_txn_receipt?select=transaction_id&order=transaction_id.asc");
    receipts = list.reduce((m, r) => m.set(r.transaction_id, (m.get(r.transaction_id) ?? 0) + 1), new Map<string, number>());
  } catch {
    // receipts are a convenience column; the ledger exports without them
  }
  const kind = (t: LedgerRow) => {
    const p = placeTxn(t, scope);
    return p.kind === "line" ? SECTION_TITLES[p.section] : p.kind === "uncategorized" ? "Uncategorized" : p.eliminated ? "Between family entities, matched" : FLOW_TITLES[p.group].title;
  };
  return ok({
    year: Number(year),
    entity: selection ? selection.join(",") : "all",
    entities: entitiesIn(prefs, selection).map((e) => e.name),
    basis: "cash",
    period: { from: `${year}-01-01`, to: throughDate(year, rows) },
    rows: rows.map((t) => {
      const p = prefs.get(t.account_id);
      return {
        date: t.date,
        transaction_id: t.transaction_id,
        entity: cleanEntityName(t.entity_name) || null,
        bank_account: p?.nickname || p?.account_name || p?.institution_name || null,
        mask: p?.mask ?? null,
        description: t.name ?? null,
        vendor: t.merchant_name ?? null,
        account: label(t),
        statement_line: kind(t),
        type: effType(t),
        status: "posted",
        bank_category: t.plaid_category ?? null,
        amount: Number(t.amount),
        receipts: receipts.get(t.transaction_id) ?? 0,
      };
    }),
  });
}

// ── Vendors: vendor × month spend matrix ─────────────────────────────────

export async function vendorsReport(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = await yearRows(year, prefs, selection, "transaction_id.asc");

  type Vendor = {
    vendor: string;
    count: number;
    monthly: number[]; // spend by month
    spent: number;
    received: number;
    last_date: string;
    entities: Set<string>;
  };
  const vendors = new Map<string, Vendor>();
  for (const t of rows) {
    if (effType(t) !== "normal") continue; // transfers aren't vendors
    const name = (t.merchant_name || t.name || "Unknown").trim();
    const key = name.toLowerCase();
    const v = vendors.get(key) ?? {
      vendor: name,
      count: 0,
      monthly: Array(12).fill(0),
      spent: 0,
      received: 0,
      last_date: t.date,
      entities: new Set<string>(),
    };
    v.count += 1;
    const m = Number(t.date.slice(5, 7)) - 1;
    if (t.amount > 0) {
      v.spent += t.amount;
      v.monthly[m] += t.amount;
    } else {
      v.received += -t.amount;
    }
    if (t.date > v.last_date) v.last_date = t.date;
    if (t.entity_name) v.entities.add(t.entity_name);
    vendors.set(key, v);
  }

  return ok({
    year: Number(year),
    vendors: [...vendors.values()].map((v) => ({ ...v, entities: [...v.entities].sort() })).sort((a, b) => b.spent - a.spent),
  });
}
