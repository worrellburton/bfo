import { sbFetch } from "../auth.js";
import { computeLoans } from "../books-loans.js";
import { fetchAll } from "../db-pages.js";
import { parseEntities } from "./filters.js";
import { scopeFilter, getPrefs } from "./prefs.js";
import { cleanEntityName, roundCents, unmatchedTransfers } from "./statements.js";
import { payeeOf } from "./tax1099.js";
import { ok, type Query, type Reply } from "./types.js";

/**
 * ?report=balance-sheet — the connected balances: what the connected bank,
 * brokerage and card accounts held, plus the loans the family is owed, as of
 * the latest reading (or a past day, once daily balances are kept). It is a
 * statement of connected balances, not a full balance sheet: real estate,
 * interests in entities and any liability that isn't connected are not in
 * it, and the response says which liabilities the ledger shows payments to.
 *
 * The rules:
 *  - An account with no balance reading is listed as "balance unavailable",
 *    never dropped; it isn't in any total.
 *  - Each row carries its own reading time; the header gives the newest and
 *    the footer the oldest.
 *  - A retirement account (IRA, 401(k)…) or an account recorded as a
 *    person's belongs to an individual. On a single entity's sheet it is
 *    listed but not counted; on the combined sheet it has its own section.
 *  - A loan counts on its holder's sheet once the loan names a holder
 *    (book_loans.holder_entity_id); until then it is on the combined sheet
 *    only. A payable loan is a liability.
 *  - Statement figures: whole dollars that foot, with a Rounding line when
 *    the rows as shown don't add to the rounded total. Exact values ride
 *    along to the cent.
 *
 * HTTP surface: none; api/books/data.ts serves it as GET ?report=balance-sheet[&entity=…][&as_of=YYYY-MM-DD].
 * Who may call it: staff with a login (the endpoint's role check).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sbFetch and fetchAll).
 */

type Identity = {
  account_id: string;
  institution_name: string | null;
  mask: string | null;
  subtype: string | null;
  account_name: string | null;
  nickname: string | null;
  entity_id: string | null;
  entity_name: string | null;
  hidden: boolean;
  archived_at: string | null;
  // From the treasury migration (20261107_treasury_keep_history.sql), when applied.
  account_type?: string | null;
  owner_kind?: string | null;
  owner_names?: string[] | null;
  disconnected_at?: string | null;
  last_balance?: number | string | null;
  last_balance_at?: string | null;
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

const RETIREMENT = /\bira\b|roth|401|403|\bsep\b|simple|pension|retire|keogh|457/i;
const INVESTMENT = /brokerage|investment|trust|529|annuity|mutual|stock|hsa|cash management/i;
const LIABILITY = /credit|mortgage|line of credit|heloc|home equity|student|overdraft|loan|paypal/i;

const TYPES: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  "money market": "Money market",
  cd: "CD",
  ira: "IRA",
  "traditional ira": "Traditional IRA",
  roth: "Roth IRA",
  "roth ira": "Roth IRA",
  "sep ira": "SEP IRA",
  "simple ira": "SIMPLE IRA",
  "401k": "401(k)",
  "403b": "403(b)",
  brokerage: "Brokerage",
  "credit card": "Credit card",
  credit: "Credit card",
  mortgage: "Mortgage",
  loan: "Loan",
  "line of credit": "Line of credit",
  trust: "Trust",
  "cash management": "Cash management",
  hsa: "HSA",
  "529": "529 plan",
};

/** An account type in sentence case from its subtype ("ira" → "IRA"). */
export function typeLabel(subtype: string | null | undefined): string {
  const key = String(subtype ?? "")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  if (TYPES[key]) return TYPES[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "Account";
}

/** Which section a connected account belongs in. */
export function sectionFor(id: Pick<Identity, "subtype" | "account_type" | "owner_kind">): "cash" | "investments" | "retirement" | "liabilities" {
  const sub = (id.subtype ?? "").toLowerCase();
  const kind = (id.account_type ?? "").toLowerCase();
  if (kind === "credit" || kind === "loan" || LIABILITY.test(sub)) return "liabilities";
  if (RETIREMENT.test(sub)) return "retirement";
  if (kind === "investment" || INVESTMENT.test(sub)) return "investments";
  return "cash";
}

/** Whole-dollar rows that foot: the section total is the rounded exact total, and a rounding figure carries any difference. */
export function footSection(rows: SheetRow[]): { total: number; exact: number; rounding: number } {
  const counted = rows.filter((r) => r.balance !== null);
  const cents = counted.reduce((s, r) => s + Math.round((r.balance ?? 0) * 100), 0);
  const total = roundCents(cents);
  const shown = counted.reduce((s, r) => s + (r.shown ?? 0), 0);
  return { total, exact: cents / 100, rounding: total - shown };
}

const DAY = 86_400_000;

export async function balanceSheetReport(query: Query): Promise<Reply> {
  const selection = parseEntities(String(query.entity ?? "all"));
  const asOfDay = /^\d{4}-\d{2}-\d{2}$/.test(String(query.as_of ?? "")) ? String(query.as_of) : null;
  const now = new Date();

  const identities = await fetchAll<Identity>("plaid_account_prefs?select=*&archived_at=is.null&order=account_id.asc");
  const states = await fetchAll<{ account_id: string; balance: number | string | null; seen_at: string }>("plaid_account_state?select=account_id,balance,seen_at&order=account_id.asc");
  const stateBy = new Map(states.map((st) => [st.account_id, st]));

  // Daily readings (treasury migration): the first day kept, and a past day's balances when asked.
  let historyFrom: string | null = null;
  let pastBy: Map<string, { balance: number | string | null; day: string }> | null = null;
  try {
    const r = await sbFetch("plaid_account_daily?select=day&order=day.asc&limit=1");
    if (r.ok) historyFrom = ((await r.json()) as Array<{ day: string }>)[0]?.day ?? null;
    if (asOfDay && historyFrom && asOfDay >= historyFrom) {
      const from = new Date(Date.parse(asOfDay) - 7 * DAY).toISOString().slice(0, 10);
      const list = await fetchAll<{ account_id: string; day: string; balance: number | string | null }>(
        `plaid_account_daily?select=account_id,day,balance&day=gte.${from}&day=lte.${asOfDay}&order=day.desc,account_id.asc`,
      );
      pastBy = new Map();
      for (const d of list) if (!pastBy.has(d.account_id)) pastBy.set(d.account_id, { balance: d.balance, day: d.day });
    }
  } catch {
    // no daily table yet: the sheet is as of the latest reading
  }

  const selected = (entityId: string | null) => !selection || (!!entityId && selection.includes(entityId));
  const buckets: Record<"cash" | "investments" | "retirement" | "liabilities" | "individual", SheetRow[]> = { cash: [], investments: [], retirement: [], liabilities: [], individual: [] };
  const entitiesSeen = new Set<string>();

  for (const id of identities) {
    if (id.hidden || !selected(id.entity_id)) continue;
    const st = stateBy.get(id.account_id);
    const past = pastBy?.get(id.account_id);
    const raw = pastBy ? (past?.balance ?? null) : (st?.balance ?? id.last_balance ?? null);
    const asOf = pastBy ? (past ? `${past.day}T23:59:59Z` : null) : (st?.seen_at ?? id.last_balance_at ?? null);
    const balance = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (balance !== null && Math.abs(balance) < 0.005) continue; // a closed-out account adds a line of nothing
    const entity = cleanEntityName(id.entity_name) || null;
    if (id.entity_id) entitiesSeen.add(id.entity_id);
    const section = sectionFor(id);
    const person = id.owner_kind === "person" || id.owner_kind === "joint";
    const owner = person && id.owner_names?.length ? id.owner_names.join(" and ") : null;
    const notes: string[] = [];
    if (balance === null) notes.push("Balance unavailable");
    if (id.disconnected_at) notes.push("No longer syncing");
    if (section === "retirement" && !person && entity) notes.push(`A retirement account belongs to its owner, not to ${entity}. Record the owner in Treasury.`);
    const row: SheetRow = {
      account_id: id.account_id,
      name: id.nickname?.trim() || id.account_name?.trim() || id.institution_name?.trim() || "Account",
      mask: id.mask ? String(id.mask).slice(-4) : null,
      institution: id.institution_name ?? null,
      type: typeLabel(id.subtype),
      entity,
      owner,
      balance,
      shown: balance === null ? null : roundCents(Math.round(balance * 100)),
      as_of: asOf,
      notes,
    };
    // An individual's account on one entity's sheet: listed, not counted.
    if (selection && (section === "retirement" || person)) buckets.individual.push(row);
    else if (person && section !== "liabilities") buckets.retirement.push(row);
    else buckets[section].push(row);
  }

  // Loans the family is owed (or owes), from the ledger.
  const loanRows: SheetRow[] = [];
  const payableRows: SheetRow[] = [];
  let holders = new Map<string, { holder_entity_id: string | null; holder_entity_name: string | null; direction: string | null }>();
  try {
    const list = await fetchAll<{ id: string; holder_entity_id: string | null; holder_entity_name: string | null; direction: string | null }>(
      "book_loans?select=id,holder_entity_id,holder_entity_name,direction&order=id.asc",
    );
    holders = new Map(list.map((l) => [l.id, l]));
  } catch {
    // before the ledger migration loans name no holder
  }
  const { loans } = await computeLoans();
  let unassignedLoans = 0;
  for (const l of loans) {
    if (Math.abs(l.outstanding) < 0.005 || !l.show_on_report) continue;
    const h = l.id ? holders.get(l.id) : undefined;
    const holder = h?.holder_entity_id ?? null;
    if (selection && (!holder || !selection.includes(holder))) {
      if (!holder) unassignedLoans += 1;
      continue;
    }
    const row: SheetRow = {
      account_id: null,
      name: l.name,
      mask: null,
      institution: null,
      type: l.id ? "Loan" : "Loan, from categories",
      entity: cleanEntityName(h?.holder_entity_name) || null,
      owner: null,
      balance: l.outstanding,
      shown: roundCents(Math.round(l.outstanding * 100)),
      as_of: l.last_date ? `${l.last_date}T00:00:00Z` : null,
      notes: holder ? [] : ["Holder not recorded"],
    };
    (h?.direction === "payable" ? payableRows : loanRows).push(row);
  }

  // What the ledger knows that the sheet doesn't: payments on liabilities that
  // aren't connected, and loan activity that isn't attached to a loan.
  const since = new Date(now.getTime() - 120 * DAY).toISOString().slice(0, 10);
  let unlinked: Array<{ kind: "mortgage" | "card"; payee: string; last_date: string; paid: number; count: number }> = [];
  let unattachedLoanRows = 0;
  try {
    const prefs = await getPrefs();
    const ledger = await fetchAll<{
      transaction_id: string;
      account_id: string;
      date: string;
      amount: number;
      name: string | null;
      merchant_name: string | null;
      book_category: string | null;
      loan_id: string | null;
    }>(
      `book_transactions?select=transaction_id,account_id,date,amount,name,merchant_name,book_category,loan_id&pending=eq.false&date=gte.${since}${scopeFilter(prefs, selection)}` +
        "&or=(book_category.like.7000*,book_category.like.9150*,book_category.like.9300*)&order=transaction_id.asc",
    );
    const group = new Map<string, { kind: "mortgage" | "card"; payee: string; last_date: string; cents: number; count: number }>();
    const note = (kind: "mortgage" | "card", t: (typeof ledger)[number]) => {
      const payee = payeeOf(t);
      const k = `${kind}|${payee.toLowerCase()}`;
      const g = group.get(k) ?? { kind, payee, last_date: t.date, cents: 0, count: 0 };
      g.cents += Math.round(Number(t.amount) * 100);
      g.count += 1;
      if (t.date > g.last_date) g.last_date = t.date;
      group.set(k, g);
    };
    const hasMortgage = buckets.liabilities.some((r) => /mortgage/i.test(r.type));
    if (!hasMortgage) for (const t of ledger) if ((t.book_category ?? "").startsWith("7000") && Number(t.amount) > 0) note("mortgage", t);
    const cardLegs = ledger.filter((t) => (t.book_category ?? "").startsWith("9150"));
    for (const t of unmatchedTransfers(cardLegs)) if (Number(t.amount) > 0) note("card", t);
    unlinked = [...group.values()].map((g) => ({ kind: g.kind, payee: g.payee, last_date: g.last_date, paid: g.cents / 100, count: g.count })).sort((a, b) => b.paid - a.paid);
    unattachedLoanRows = ledger.filter((t) => (t.book_category ?? "").startsWith("9300") && !t.loan_id).length;
  } catch {
    // a disclosure we couldn't compute is left out rather than failing the sheet
  }

  const byBalance = (a: SheetRow, b: SheetRow) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity) || a.name.localeCompare(b.name);
  const make = (key: string, title: string, side: "asset" | "liability", rows: SheetRow[], counted = true, note?: string): SheetSection => {
    rows.sort(byBalance);
    return { key, title, side, counted, ...(note ? { note } : {}), rows, ...footSection(rows) };
  };
  const sections: SheetSection[] = [
    make("cash", "Cash", "asset", buckets.cash),
    make("investments", "Investments, at market value", "asset", buckets.investments),
    ...(selection ? [] : [make("retirement", "Retirement and personal accounts", "asset", buckets.retirement, true, "Owned by individuals, not by an entity.")]),
    make("loans", "Loans receivable", "asset", loanRows),
    make("liabilities", "Liabilities", "liability", [...buckets.liabilities, ...payableRows]),
  ];
  const individual =
    selection && buckets.individual.length ? make("individual", "Mapped here, owned by individuals", "asset", buckets.individual, false, "Not counted in this entity's totals.") : null;

  const totalAssets = sections.filter((s) => s.side === "asset" && s.counted).reduce((s, x) => s + x.total, 0);
  const totalLiabilities = sections.filter((s) => s.side === "liability").reduce((s, x) => s + x.total, 0);
  const exactAssets = sections.filter((s) => s.side === "asset" && s.counted).reduce((s, x) => s + Math.round(x.exact * 100), 0) / 100;
  const exactLiabilities = sections.filter((s) => s.side === "liability").reduce((s, x) => s + Math.round(x.exact * 100), 0) / 100;
  const allRows = [...sections, ...(individual ? [individual] : [])].flatMap((s) => s.rows);
  const stamps = allRows.filter((r) => r.account_id && r.as_of).map((r) => r.as_of!) as string[];

  return ok({
    entity: selection ? selection.join(",") : "all",
    entities_count: entitiesSeen.size,
    requested_as_of: asOfDay,
    history_from: historyFrom,
    as_of: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
    earliest_as_of: stamps.length ? stamps.reduce((a, b) => (a < b ? a : b)) : null,
    sections,
    individual,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_worth: totalAssets - totalLiabilities,
    exact: { assets: exactAssets, liabilities: exactLiabilities, net_worth: Math.round((exactAssets - exactLiabilities) * 100) / 100 },
    unavailable: allRows.filter((r) => r.balance === null).length,
    unlinked_liabilities: unlinked,
    unattached_loan_rows: unattachedLoanRows,
    unassigned_loans: unassignedLoans,
  });
}
