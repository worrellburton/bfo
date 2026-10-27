import { sectionOf } from "../books-rules.js";
import { effType, eliminated as eliminatedIn, label } from "../books-report.js";
import { fetchAll } from "../db-pages.js";
import { parseEntities, yearOf } from "./filters.js";
import { getPrefs, scopeFilter, withLiveEntity } from "./prefs.js";
import { ok, type BookTxn, type Pref, type Query, type Reply } from "./types.js";

/**
 * The year-scoped statements: the cash-basis P&L (and the transactions
 * behind one of its cells), the trial balance + cash-flow summary, 1099
 * vendor totals and the vendor × month spend matrix.
 */

/** The year's posted rows for the selected entities, hidden accounts excluded, stamped with live entities. */
async function yearRows(
  year: string,
  prefs: Map<string, Pref>,
  selection: string[] | null,
  order: string
): Promise<BookTxn[]> {
  return withLiveEntity(
    await fetchAll<BookTxn>(
      `book_transactions?select=*&pending=eq.false` +
        `&date=gte.${year}-01-01&date=lte.${year}-12-31` +
        scopeFilter(prefs, selection) +
        `&order=${order}`
    ),
    prefs
  );
}

// ── P&L: cash-basis Jan–Dec matrix; entity=all | id[,id…] ─────────────────
// ── Cell: the transactions behind one P&L cell ───────────────────────────

export async function pnlReport(query: Query, report: "pnl" | "cell"): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));

  const prefs = await getPrefs();
  // Cash basis: posted transactions only, hidden accounts excluded.
  const rows = await yearRows(year, prefs, selection, "date.asc,transaction_id.asc");

  const monthOf = (d: string) => Number(d.slice(5, 7)) - 1;
  const loanNames = new Map(
    (await fetchAll<{ id: string; name: string }>("book_loans?select=id,name")).map((l) => [l.id, l.name])
  );
  const rowLabel = (t: BookTxn) => (t.loan_id ? `${loanNames.get(t.loan_id) ?? "Loan"} (loan)` : label(t));

  // Which income-statement group a 'normal' row lands in: its account's
  // section, or — for uncategorized rows — by sign.
  const pnlSection = (t: BookTxn): "revenue" | "operating" | "other" => {
    const sec = sectionOf(label(t));
    if (sec === "revenue" || sec === "operating" || sec === "other") return sec;
    return t.amount < 0 ? "revenue" : "operating";
  };
  // A 9000s account never posts to the income statement — the chart's
  // contract. Even typed "normal", such a row belongs with the flows.
  const flowAcct = (t: BookTxn) => sectionOf(label(t)) === "flow";

  // ── One P&L cell: the transactions behind it ──────────────────────────
  if (report === "cell") {
    const section = String(query.section ?? "");
    const wantLabel = query.label != null ? String(query.label) : null;
    const month = /^\d{1,2}$/.test(String(query.month)) ? Number(query.month) : null; // 1-12

    const matches = rows
      .filter((t) => {
        if (month !== null && monthOf(t.date) !== month - 1) return false;
        const eff = effType(t);
        if (section === "revenue" || section === "operating" || section === "other") {
          return eff === "normal" && !flowAcct(t) && pnlSection(t) === section && (!wantLabel || label(t) === wantLabel);
        }
        if (section === "net") return eff === "normal" && !flowAcct(t);
        if (section === "transfers") {
          return (
            (eff === "transfer" || eff === "loan" || (eff === "normal" && flowAcct(t))) &&
            (!wantLabel || rowLabel(t) === wantLabel)
          );
        }
        if (section === "intercompany") {
          return eff === "intercompany" && !eliminatedIn(t, selection, (id) => prefs.get(id)?.entity_id);
        }
        return false;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    return ok({ transactions: matches, count: matches.length });
  }

  // ── The P&L matrix itself — grouped into GAAP statement sections ──────
  const zeros = () => Array(12).fill(0) as number[];
  const revenue = new Map<string, number[]>();   // inflows positive
  const operating = new Map<string, number[]>(); // outflows positive (expense)
  const other = new Map<string, number[]>();      // 7000s: outflows positive
  const transferCats = new Map<string, number[]>(); // net by category
  const transfersIn = zeros();
  const transfersOut = zeros();
  const interIn = zeros();
  const interOut = zeros();
  let eliminatedCount = 0;

  for (const t of rows) {
    const m = monthOf(t.date);
    const eff = effType(t);

    if (eff === "intercompany") {
      if (eliminatedIn(t, selection, (id) => prefs.get(id)?.entity_id)) {
        eliminatedCount += 1;
        continue;
      }
      if (t.amount < 0) interIn[m] += -t.amount;
      else interOut[m] += t.amount;
      continue;
    }
    if (eff === "transfer" || eff === "loan" || flowAcct(t)) {
      if (t.amount < 0) transfersIn[m] += -t.amount;
      else transfersOut[m] += t.amount;
      const row = transferCats.get(rowLabel(t)) ?? zeros();
      row[m] += -t.amount; // net: in positive, out negative
      transferCats.set(rowLabel(t), row);
      continue;
    }

    // Group by the account's statement section; within an account the
    // sign nets (a refund reduces the account rather than flipping sides).
    // Revenue carries inflows positive; expense sections carry outflows
    // positive. Plaid signs money-in negative.
    const sec = pnlSection(t);
    const bucket = sec === "revenue" ? revenue : sec === "other" ? other : operating;
    const signed = sec === "revenue" ? -t.amount : t.amount;
    const row = bucket.get(label(t)) ?? zeros();
    row[m] += signed;
    bucket.set(label(t), row);
  }

  const toRows = (map: Map<string, number[]>) =>
    [...map.entries()]
      .map(([rowLabel, monthly]) => ({
        label: rowLabel,
        monthly,
        total: monthly.reduce((s, v) => s + v, 0),
      }))
      // Chart accounts sort by their leading code; everything else trails.
      .sort((a, b) => a.label.localeCompare(b.label));

  const revenueRows = toRows(revenue);
  const operatingRows = toRows(operating);
  const otherRows = toRows(other);
  const sumMonthly = (rs: Array<{ monthly: number[] }>) =>
    zeros().map((_, m) => rs.reduce((s, r) => s + r.monthly[m], 0));
  const revenueMonthly = sumMonthly(revenueRows);
  const operatingMonthly = sumMonthly(operatingRows);
  const otherMonthly = sumMonthly(otherRows);
  const operatingIncomeMonthly = revenueMonthly.map((v, m) => v - operatingMonthly[m]);
  const netMonthly = operatingIncomeMonthly.map((v, m) => v - otherMonthly[m]);

  return ok({
    year: Number(year),
    entity: selection ? selection.join(",") : "all",
    basis: "cash",
    transaction_count: rows.length,
    eliminated_count: eliminatedCount,
    revenue: revenueRows,
    operating: operatingRows,
    other: otherRows,
    revenue_monthly: revenueMonthly,
    operating_monthly: operatingMonthly,
    other_monthly: otherMonthly,
    operating_income_monthly: operatingIncomeMonthly,
    net_monthly: netMonthly,
    net_total: netMonthly.reduce((s, v) => s + v, 0),
    transfers: {
      rows: toRows(transferCats),
      in: transfersIn,
      out: transfersOut,
      net: transfersIn.map((v, m) => v - transfersOut[m]),
      total: transfersIn.reduce((s, v) => s + v, 0) - transfersOut.reduce((s, v) => s + v, 0),
    },
    intercompany: {
      in: interIn,
      out: interOut,
      net: interIn.map((v, m) => v - interOut[m]),
      total: interIn.reduce((s, v) => s + v, 0) - interOut.reduce((s, v) => s + v, 0),
    },
  });
}

// ── #9 Statements: trial balance + cash-flow summary (cash basis) ────────

export async function statementsReport(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = await yearRows(year, prefs, selection, "transaction_id.asc");

  // Trial balance: each account's net (outflow positive), with section.
  const accounts = new Map<string, { debit: number; credit: number }>();
  const cash = { operating: 0, financing: 0, uncategorized: 0 };
  for (const t of rows) {
    const acct = label(t);
    const a = accounts.get(acct) ?? { debit: 0, credit: 0 };
    if (t.amount > 0) a.debit += t.amount; else a.credit += -t.amount;
    accounts.set(acct, a);

    const sec = sectionOf(acct);
    const inflow = -t.amount; // money in positive
    if (sec === "flow") cash.financing += inflow;
    else if (sec === null) cash.uncategorized += inflow;
    else cash.operating += inflow; // revenue/operating/other
  }
  const trialBalance = [...accounts.entries()]
    .map(([account, v]) => ({
      account,
      section: sectionOf(account) ?? "uncategorized",
      debit: Math.round(v.debit),
      credit: Math.round(v.credit),
      net: Math.round(v.debit - v.credit),
    }))
    .sort((a, b) => a.account.localeCompare(b.account));

  return ok({
    year: Number(year),
    basis: "cash",
    trial_balance: trialBalance,
    totals: {
      debit: trialBalance.reduce((s, r) => s + r.debit, 0),
      credit: trialBalance.reduce((s, r) => s + r.credit, 0),
    },
    cash_flow: {
      operating: Math.round(cash.operating),
      financing: Math.round(cash.financing),
      uncategorized: Math.round(cash.uncategorized),
      net_change: Math.round(cash.operating + cash.financing + cash.uncategorized),
    },
  });
}

// ── #9 1099 vendor totals: contractor payments for tax season ────────────

export async function tax1099Report(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const prefs = await getPrefs();
  const rows = await yearRows(year, prefs, null, "transaction_id.asc");
  // 1099-NEC candidates: payments to vendors booked to service accounts.
  const NEC = /^(6100|6150|6000)/;
  const byVendor = new Map<string, { paid: number; count: number; account: string }>();
  for (const t of rows) {
    if (effType(t) !== "normal" || t.amount <= 0) continue;
    const acct = label(t);
    if (!NEC.test(acct)) continue;
    const vendor = (t.merchant_name || t.name || "Unknown").trim();
    const v = byVendor.get(vendor) ?? { paid: 0, count: 0, account: acct };
    v.paid += t.amount;
    v.count += 1;
    byVendor.set(vendor, v);
  }
  const vendors = [...byVendor.entries()]
    .map(([vendor, v]) => ({ vendor, paid: Math.round(v.paid), count: v.count, account: v.account }))
    .filter((v) => v.paid >= 600) // the IRS 1099 threshold
    .sort((a, b) => b.paid - a.paid);
  return ok({ year: Number(year), threshold: 600, vendors });
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
    vendors: [...vendors.values()]
      .map((v) => ({ ...v, entities: [...v.entities].sort() }))
      .sort((a, b) => b.spent - a.spent),
  });
}
