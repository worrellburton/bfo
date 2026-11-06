/**
 * The data side of the Books reports, shared by the reports
 * (app/routes/books-reports.tsx and its views) and the cell drill-down
 * (app/routes/books-cell.tsx): the money formats a statement and a working schedule use (docs/DESIGN.md
 * §10.2), the scope and period lines (§10.6), and the shapes the report API
 * returns.
 *
 * The figures themselves are counted on the server (lib/books/statements.ts),
 * which makes them foot and cross-foot. The adapters at the bottom read the
 * older report shape the same way, so a page served before the new server
 * code is deployed still shows a statement that adds up; they can go once
 * every server answers with the new shape.
 */

import * as format from "./ui/format";

// ── Money, by context (§10.2) ────────────────────────────────────────────

/** Statements: whole dollars, parentheses for negatives, a dash for zero. */
export const statementMoney = (n: number | null | undefined) => format.money(n, { precision: "dollars", sign: "accounting", zero: "dash" });
/** Working schedules (trial balance, 1099 list): cents, parentheses, a dash for zero. */
export const scheduleMoney = (n: number | null | undefined) => format.money(n, { precision: "cents", sign: "accounting", zero: "dash" });
/** KPI strips: whole dollars with a true minus. */
export const kpiMoney = (n: number | null | undefined) => format.money(n, { precision: "dollars" });

/** "4000 Rental Income" → code and name. */
export function splitAccount(label: string): { code: string | null; name: string } {
  const m = /^(\d{4})\s+(.+)$/.exec(label.trim());
  return m ? { code: m[1], name: m[2] } : { code: null, name: label.trim() };
}

/** An entity's name without BFO's notes in parentheses ("(100%)"). */
export const cleanName = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Jan 1 – Nov 5, 2026", or the year alone when nothing is booked yet. */
export function periodText(year: number | string, period?: { from: string; to: string | null } | null): string {
  if (period?.to) return format.dateRange(period.from, period.to);
  return String(year);
}

/** "All entities", one name, or "3 entities". */
export function scopeText(selected: string[], entities: Array<{ id: string; name: string }>): string {
  if (!selected.length) return "All entities";
  if (selected.length === 1) return cleanName(entities.find((e) => e.id === selected[0])?.name) || "1 entity";
  return format.count(selected.length, "entity", "entities");
}

/** The legend every report carries, in place (§11.5). */
export const BASIS_LEGEND = "Cash basis · unaudited · prepared from bank feeds for internal use; not a GAAP financial statement.";

// ── The report shapes ────────────────────────────────────────────────────

export type Figures = { monthly: number[]; by_entity: number[]; total: number; exact: number };
export type Line = { label: string; code: string | null; name: string; figures: Figures; drill: string | null };
export type Block = {
  key: string;
  title: string;
  sign: "in" | "out";
  note?: string;
  lines: Line[];
  rounding: Figures | null;
  total: Figures;
  check?: { unmatched: number; unmatched_count: number } | null;
  /** Where the total drills, when it isn't the block's own key (the older server's sections). */
  drill?: string | null;
};
export type Moves = { in: number; out: number; net: number; count: number };

export type Pnl = {
  year: number;
  entity: string;
  basis: "cash";
  period: { from: string; to: string | null } | null;
  transaction_count: number;
  columns: { months: string[]; entities: Array<{ id: string; name: string }> };
  sections: Block[];
  operating_income: Figures;
  net: Figures;
  receipts: number;
  disbursements: number;
  uncategorized: Block & { count: number; in: number; out: number };
  flows: Block[];
  eliminated: Moves;
  coverage: { ledger_start: string | null; late_accounts: Array<{ account: string; first: string }> } | null;
};

export type SheetRow = {
  account_id: string | null;
  name: string;
  mask: string | null;
  institution: string | null;
  type: string;
  entity: string | null;
  owner: string | null;
  balance: number | null;
  shown: number | null;
  as_of: string | null;
  notes: string[];
};
export type SheetSection = { key: string; title: string; side: "asset" | "liability"; counted: boolean; note?: string; rows: SheetRow[]; total: number; exact: number; rounding: number };
export type Sheet = {
  entity: string;
  entities_count: number;
  requested_as_of: string | null;
  history_from: string | null;
  as_of: string | null;
  earliest_as_of: string | null;
  sections: SheetSection[];
  individual: SheetSection | null;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  unavailable: number;
  unlinked_liabilities: Array<{ kind: "mortgage" | "card"; payee: string; last_date: string; paid: number; count: number }>;
  unattached_loan_rows: number;
  unassigned_loans: number;
};

export type FlowLine = { label: string; amount: number; exact: number; drill: string | null };
export type FlowBlock = { key: string; title: string; note?: string; lines: FlowLine[]; total: number; exact: number };
export type TbRow = { account: string; group: string; detail: string | null; debit: number; credit: number };
export type Statements = {
  year: number;
  basis: "cash";
  period: { from: string; to: string | null } | null;
  cash_flow: { blocks: FlowBlock[]; net_change: number; net_change_exact: number; ties_to_pnl: boolean; pnl_net: number | null };
  trial_balance: { rows: TbRow[]; totals: { debit: number; credit: number }; derived?: boolean };
};

export type Worksheet = {
  year: number;
  threshold: number;
  threshold_note: string | null;
  candidates: Array<{
    payee: string;
    entity: string | null;
    form: "NEC" | "MISC";
    paid: number;
    count: number;
    accounts: string[];
    via_transfers: number;
    via_transfers_count: number;
    notes: string[];
  }>;
  below_threshold: number;
  wages: Array<{ payee: string; entity: string | null; paid: number; count: number; via_transfers?: number }>;
  excluded: Array<{ payee: string; entity: string | null; paid: number; count: number; reason: string }>;
  partial?: boolean;
};

// ── Footing (for the older shape only; the server does this itself) ─────

const roundCents = (c: number) => (c < 0 ? -Math.round(-c / 100) : Math.round(c / 100));

/** Whole dollars summing exactly to `total`, each within $1 of its value. */
function apportion(values: number[], total: number): number[] {
  const cents = values.map((v) => Math.round(v * 100));
  const out = cents.map(roundCents);
  let diff = total - out.reduce((s, v) => s + v, 0);
  const step = diff > 0 ? 1 : -1;
  const order = cents
    .map((c, i) => ({ i, r: c / 100 - out[i], c }))
    .filter((x) => x.c !== 0)
    .sort((a, b) => (step > 0 ? b.r - a.r : a.r - b.r));
  for (let k = 0; diff !== 0 && order.length; k++) {
    out[order[k % order.length].i] += step;
    diff -= step;
  }
  return out;
}

function figures(monthly: number[]): Figures {
  const exact = Math.round(monthly.reduce((s, v) => s + v, 0) * 100) / 100;
  const total = roundCents(Math.round(exact * 100));
  return { monthly: apportion(monthly, total), by_entity: [], total, exact };
}

function block(key: string, title: string, sign: "in" | "out", lines: Array<{ label: string; monthly: number[]; drill: string }>, note?: string): Block {
  const built: Line[] = lines.map((l) => ({ label: l.label, ...splitAccount(l.label), figures: figures(l.monthly), drill: l.drill }));
  const sum = lines.reduce((s, l) => s.map((v, i) => v + l.monthly[i]), Array<number>(12).fill(0));
  const total = figures(sum);
  const rm = total.monthly.map((v, i) => v - built.reduce((s, l) => s + l.figures.monthly[i], 0));
  const rt = total.total - built.reduce((s, l) => s + l.figures.total, 0);
  const rounding = rm.some((v) => v !== 0) || rt !== 0 ? { monthly: rm, by_entity: [], total: rt, exact: 0 } : null;
  return { key, title, sign, ...(note ? { note } : {}), lines: built, rounding, total };
}

const add = (parts: Array<[Figures, 1 | -1]>): Figures => ({
  monthly: parts[0][0].monthly.map((_, i) => parts.reduce((s, [f, k]) => s + k * f.monthly[i], 0)),
  by_entity: [],
  total: parts.reduce((s, [f, k]) => s + k * f.total, 0),
  exact: Math.round(parts.reduce((s, [f, k]) => s + k * f.exact, 0) * 100) / 100,
});

type OldRow = { label: string; monthly: number[]; total: number };
type OldPnl = {
  year: number;
  entity: string;
  transaction_count: number;
  eliminated_count?: number;
  revenue: OldRow[];
  operating: OldRow[];
  other: OldRow[];
  transfers?: { rows: OldRow[] };
  intercompany?: { in: number[]; out: number[] };
};

const PERSONAL = /^(4300|6750)\b/;
const flowGroup = (l: string) =>
  /^9000\b/.test(l) ? "intercompany" : /^92\d\d\b/.test(l) ? "distributions" : /^93\d\d\b|\(loan\)$/.test(l) ? "loans" : /^94\d\d\b/.test(l) ? "capital" : /^[4-7]\d{3}\b/.test(l) ? "conflict" : "own";
const FLOW_TITLES: Record<string, [string, string?]> = {
  own: ["Transfers between your own accounts", "These should net to zero."],
  conflict: ["Income or expense accounts typed as transfers", "Left out of the statement until the account or the type is fixed."],
  intercompany: ["Between family entities, not matched"],
  loans: ["Loans"],
  capital: ["Capital improvements"],
  distributions: ["Distributions and draws", "Payments out of a trust may need a gift-tax return or a trustee's review."],
};

/** The report as the server sends it now, or the older shape read the same way. */
export function readPnl(raw: unknown): Pnl {
  const r = raw as Partial<Pnl> & Partial<OldPnl>;
  if (Array.isArray(r.sections)) return r as Pnl;
  const old = raw as OldPnl;
  const coded = (rows: OldRow[]) => rows.filter((x) => /^\d{4}\s/.test(x.label));
  const plain = (rows: OldRow[]) => rows.filter((x) => !/^\d{4}\s/.test(x.label));
  const asIn = (x: OldRow, sign: 1 | -1) => x.monthly.map((v) => sign * v);
  const revenue = block(
    "revenue",
    "Revenue",
    "in",
    coded(old.revenue)
      .filter((x) => !PERSONAL.test(x.label))
      .map((x) => ({ label: x.label, monthly: x.monthly, drill: "revenue" })),
  );
  const operating = block(
    "operating",
    "Operating expenses",
    "out",
    coded(old.operating)
      .filter((x) => !PERSONAL.test(x.label))
      .map((x) => ({ label: x.label, monthly: x.monthly, drill: "operating" })),
  );
  const other = block(
    "other",
    "Other income (expense)",
    "in",
    coded(old.other).map((x) => ({ label: x.label, monthly: asIn(x, -1), drill: "other" })),
  );
  const personal: Block = {
    drill: null,
    ...block("personal", "Personal (grantor)", "in", [
      ...coded(old.revenue)
        .filter((x) => PERSONAL.test(x.label))
        .map((x) => ({ label: x.label, monthly: x.monthly, drill: "revenue" })),
      ...coded(old.operating)
        .filter((x) => PERSONAL.test(x.label))
        .map((x) => ({ label: x.label, monthly: asIn(x, -1), drill: "operating" })),
    ]),
  };
  const unc: Block = {
    drill: null,
    ...block(
      "uncategorized",
      "Uncategorized, needs review",
      "in",
      [
        ...plain(old.revenue).map((x) => ({ label: x.label, monthly: x.monthly, drill: "revenue" })),
        ...plain(old.operating).map((x) => ({ label: x.label, monthly: asIn(x, -1), drill: "operating" })),
      ],
      "Not in any total above. File these to an account to bring them in.",
    ),
  };
  const groups = new Map<string, Array<{ label: string; monthly: number[]; drill: string }>>();
  for (const x of old.transfers?.rows ?? []) {
    const g = flowGroup(x.label);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push({ label: x.label, monthly: x.monthly, drill: "transfers" });
  }
  if (old.intercompany && [...old.intercompany.in, ...old.intercompany.out].some((v) => v !== 0)) {
    (groups.get("intercompany") ?? groups.set("intercompany", []).get("intercompany")!).push({
      label: "Not matched",
      monthly: old.intercompany.in.map((v, i) => v - old.intercompany!.out[i]),
      drill: "intercompany",
    });
  }
  const flows = ["own", "conflict", "intercompany", "loans", "capital", "distributions"]
    .filter((g) => groups.has(g))
    .map((g) => ({ ...block(`flow:${g}`, FLOW_TITLES[g][0], "in", groups.get(g)!, FLOW_TITLES[g][1]), check: null, drill: g === "intercompany" ? "intercompany" : null }));
  const operatingIncome = add([
    [revenue.total, 1],
    [operating.total, -1],
  ]);
  const net = add([
    [operatingIncome, 1],
    [other.total, 1],
    [personal.total, 1],
  ]);
  const sumIf = (lines: Line[], pick: (l: Line) => boolean, k: 1 | -1) => lines.filter(pick).reduce((s, l) => s + k * l.figures.exact, 0);
  const inc = (l: Line) => (l.code ?? "").startsWith("4");
  const receipts = revenue.total.exact + sumIf(personal.lines, inc, 1);
  const disbursements = operating.total.exact - other.total.exact - sumIf(personal.lines, (l) => !inc(l), 1);
  const uncIn = unc.lines.reduce((s, l) => s + Math.max(0, l.figures.exact), 0);
  const uncOut = unc.lines.reduce((s, l) => s + Math.max(0, -l.figures.exact), 0);
  return {
    year: old.year,
    entity: old.entity,
    basis: "cash",
    period: null,
    transaction_count: old.transaction_count,
    columns: { months: Array.from({ length: 12 }, (_, i) => `${old.year}-${String(i + 1).padStart(2, "0")}`), entities: [] },
    sections: [revenue, operating, other, personal],
    operating_income: operatingIncome,
    net,
    receipts: Math.round(receipts * 100) / 100,
    disbursements: Math.round(disbursements * 100) / 100,
    // The older report doesn't count rows, only accounts.
    uncategorized: { ...unc, count: 0, in: uncIn, out: uncOut },
    flows,
    eliminated: { in: 0, out: 0, net: 0, count: old.eliminated_count ?? 0 },
    coverage: null,
  };
}

const TYPE_WORDS: Record<string, string> = { ira: "IRA", roth: "Roth IRA", "401k": "401(k)", "credit card": "Credit card", cd: "CD", hsa: "HSA" };
const typeWord = (s: string) => TYPE_WORDS[s.toLowerCase()] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Account");

type OldSheet = {
  as_of: string | null;
  sections: Record<"cash" | "investments" | "loans" | "credit", { rows: Array<{ label: string; detail: string; balance: number }>; total: number }>;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
};

/** The connected balances as the server sends them now, or the older shape read the same way. */
export function readSheet(raw: unknown): Sheet {
  const r = raw as Partial<Sheet>;
  if (Array.isArray(r.sections)) return r as Sheet;
  const old = raw as OldSheet;
  const rowOf = (x: { label: string; detail: string; balance: number }, loan = false): SheetRow => {
    const bits = x.detail.split(" · ").map((b) => b.trim());
    const mask = bits.find((b) => /^·+\d+$/.test(b))?.replace(/·/g, "") ?? null;
    const sub = bits.filter((b) => !/^·+\d+$/.test(b));
    const institution = loan ? null : (sub[0] ?? null);
    const type = loan ? "Loan" : typeWord(sub[1] ?? "");
    return {
      account_id: null,
      name: loan ? x.label : [institution, type].filter(Boolean).join(" ") || cleanName(x.label),
      mask,
      institution,
      type,
      entity: loan ? null : cleanName(x.label) || null,
      owner: null,
      balance: x.balance,
      shown: Math.round(x.balance),
      as_of: null,
      notes: loan ? ["Holder not recorded"] : [],
    };
  };
  const section = (key: string, title: string, side: "asset" | "liability", rows: SheetRow[]): SheetSection => {
    const exact = Math.round(rows.reduce((s, x) => s + (x.balance ?? 0), 0) * 100) / 100;
    const total = Math.round(exact);
    return { key, title, side, counted: true, rows, total, exact, rounding: total - rows.reduce((s, x) => s + (x.shown ?? 0), 0) };
  };
  const sections = [
    section(
      "cash",
      "Cash",
      "asset",
      old.sections.cash.rows.map((x) => rowOf(x)),
    ),
    section(
      "investments",
      "Investments, at market value",
      "asset",
      old.sections.investments.rows.map((x) => rowOf(x)),
    ),
    section(
      "loans",
      "Loans receivable",
      "asset",
      old.sections.loans.rows.map((x) => rowOf(x, true)),
    ),
    section(
      "liabilities",
      "Liabilities",
      "liability",
      old.sections.credit.rows.map((x) => rowOf(x)),
    ),
  ];
  const assets = sections.filter((s) => s.side === "asset").reduce((s, x) => s + x.total, 0);
  const liabilities = sections[3].total;
  return {
    entity: "all",
    entities_count: 0,
    requested_as_of: null,
    history_from: null,
    as_of: old.as_of,
    earliest_as_of: null,
    sections,
    individual: null,
    total_assets: assets,
    total_liabilities: liabilities,
    net_worth: assets - liabilities,
    unavailable: 0,
    unlinked_liabilities: [],
    unattached_loan_rows: 0,
    unassigned_loans: 0,
  };
}

type OldStatements = {
  year: number;
  trial_balance: Array<{ account: string; section: string; debit: number; credit: number }>;
  totals: { debit: number; credit: number };
  cash_flow: { operating: number; financing: number; uncategorized: number; net_change: number };
};

/** Cash flow and trial balance as the server sends them now, or the older shape read the same way. */
export function readStatements(raw: unknown): Statements {
  const r = raw as Partial<Statements> & Partial<OldStatements>;
  if (r.cash_flow && "blocks" in r.cash_flow) return r as Statements;
  const old = raw as OldStatements;
  const one = (key: string, title: string, label: string, amount: number, drill: string | null, note?: string): FlowBlock => ({
    key,
    title,
    ...(note ? { note } : {}),
    lines: amount ? [{ label, amount, exact: amount, drill }] : [],
    total: amount,
    exact: amount,
  });
  // The older trial balance listed each account's gross debits and credits
  // with no bank side, so it didn't balance. Each account's net, plus the
  // bank and card accounts' net movement as the other side, does.
  const rows: TbRow[] = old.trial_balance
    .map((x) => {
      const net = Math.round((x.debit - x.credit) * 100) / 100;
      const group =
        x.section === "revenue"
          ? "Revenue"
          : x.section === "operating"
            ? "Operating expenses"
            : x.section === "other"
              ? "Other income (expense)"
              : x.section === "flow"
                ? "Transfers, loans and distributions"
                : "Uncategorized";
      return { account: x.account, group, detail: null, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((x) => x.debit || x.credit);
  const d = rows.reduce((s, x) => s + x.debit, 0);
  const c = rows.reduce((s, x) => s + x.credit, 0);
  const bank = Math.round((c - d) * 100) / 100;
  if (bank) rows.unshift({ account: "All bank and card accounts, net movement", group: "Bank and card accounts", detail: null, debit: bank > 0 ? bank : 0, credit: bank < 0 ? -bank : 0 });
  const total = Math.max(d, c);
  return {
    year: old.year,
    basis: "cash",
    period: null,
    cash_flow: {
      blocks: [
        one("operating", "Operating activities", "Revenue less expenses", old.cash_flow.operating, null),
        one("uncategorized", "Uncategorized, needs review", "Not yet filed to an account", old.cash_flow.uncategorized, "uncategorized"),
        one("other", "Transfers, loans and distributions", "Not yet split into investing and financing", old.cash_flow.financing, "transfers"),
      ],
      net_change: old.cash_flow.net_change,
      net_change_exact: old.cash_flow.net_change,
      ties_to_pnl: false,
      pnl_net: null,
    },
    trial_balance: { rows, totals: { debit: total, credit: total }, derived: true },
  };
}

const GOVERNMENT = /internal revenue|\birs\b|revenue agency|revenu|franchise tax|department of revenue|tax collector|treasurer|comptroller|secretary of state/i;

/** The 1099 worksheet as the server sends it now, or the older list read with this year's rules where it can be. */
export function readWorksheet(raw: unknown): Worksheet | null {
  if (!raw) return null;
  const r = raw as Partial<Worksheet> & { vendors?: Array<{ vendor: string; entity: string | null; paid: number; count: number; account: string }> };
  if (Array.isArray(r.candidates)) return r as Worksheet;
  const year = Number(r.year);
  const threshold = year <= 2025 ? 600 : 2000;
  const list = r.vendors ?? [];
  const isWage = (v: { account: string }) => v.account.startsWith("6000");
  const isGov = (v: { vendor: string }) => GOVERNMENT.test(v.vendor);
  return {
    year,
    threshold,
    threshold_note: year > 2026 ? "The $2,000 threshold is indexed for inflation after 2026. Confirm this year's figure with your CPA." : null,
    candidates: list
      .filter((v) => !isWage(v) && !isGov(v) && v.paid >= threshold)
      .map((v) => ({
        payee: v.vendor,
        entity: v.entity,
        form: v.account.startsWith("6350") ? "MISC" : "NEC",
        paid: v.paid,
        count: v.count,
        accounts: [v.account],
        via_transfers: 0,
        via_transfers_count: 0,
        notes: [],
      })),
    below_threshold: list.filter((v) => !isWage(v) && !isGov(v) && v.paid < threshold).length,
    wages: list.filter(isWage).map((v) => ({ payee: v.vendor, entity: v.entity, paid: v.paid, count: v.count })),
    excluded: list
      .filter((v) => !isWage(v) && isGov(v))
      .map((v) => ({ payee: v.vendor, entity: v.entity, paid: v.paid, count: v.count, reason: "A government payee: tax payments aren't 1099 items." })),
    partial: true,
  };
}
