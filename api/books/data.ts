import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";

/**
 * Books reads. Everything here is served from book_transactions — the nightly
 * Plaid mirror — never from Plaid directly, so pages stay fast.
 *
 *   ?report=meta          → entities, last sync, row count
 *   ?report=transactions  → filterable, paginated spreadsheet rows
 *   ?report=pnl           → cash-basis Jan–Dec matrix for one entity or the rollup
 *   ?report=vendors       → auto-derived vendor aggregates
 *
 * Books is open to everyone with a login.
 */

/** Page through PostgREST's 1000-row window until the query is exhausted. */
async function fetchAll<T>(pathWithFilters: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db(pathWithFilters, { headers: { Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`DB error: ${(await r.text()).slice(0, 300)}`);
    const rows = (await r.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function prettyCategory(primary: string | null): string {
  if (!primary) return "Uncategorized";
  const s = primary.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type BookTxn = {
  transaction_id: string;
  account_id: string;
  item_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  plaid_category: string | null;
  txn_type: string;
  intercompany: boolean;
  intercompany_class: string | null;
  entity_id: string | null;
  entity_name: string | null;
};

const TXN_COLS =
  "transaction_id,account_id,item_id,date,name,merchant_name,amount,pending," +
  "plaid_category,txn_type,intercompany,intercompany_class,entity_id,entity_name";

function entityFilter(entity: string | undefined): string {
  if (!entity || entity === "all") return "";
  if (entity === "unmapped") return "&entity_id=is.null";
  return `&entity_id=eq.${encodeURIComponent(entity)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const report = String(req.query.report ?? "");

  try {
    if (report === "meta") {
      const prefs = await fetchAll<{ entity_id: string | null; entity_name: string | null }>(
        "plaid_account_prefs?select=entity_id,entity_name&entity_id=not.is.null"
      );
      const seen = new Map<string, string>();
      for (const p of prefs) if (p.entity_id) seen.set(p.entity_id, p.entity_name ?? p.entity_id);
      const entities = [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const countRes = await db("book_transactions?select=transaction_id&limit=1", {
        headers: { Prefer: "count=exact" },
      });
      const total = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
      const lastRes = await db("book_transactions?select=updated_at&order=updated_at.desc&limit=1");
      const last = lastRes.ok ? ((await lastRes.json()) as any[])[0]?.updated_at ?? null : null;
      return res.json({ entities, total_transactions: total, last_synced_at: last });
    }

    if (report === "transactions") {
      const { entity, type, q, year } = req.query as Record<string, string | undefined>;
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const offset = Number(req.query.offset ?? 0) || 0;

      let path = `book_transactions?select=${TXN_COLS}&hidden=eq.false${entityFilter(entity)}`;
      if (year && /^\d{4}$/.test(year)) {
        path += `&date=gte.${year}-01-01&date=lte.${year}-12-31`;
      }
      if (type === "transfers") path += "&txn_type=eq.transfer";
      else if (type === "intercompany") path += "&intercompany=is.true";
      if (q) {
        const safe = q.replace(/[%*,()]/g, " ").trim();
        if (safe) path += `&or=(name.ilike.*${encodeURIComponent(safe)}*,merchant_name.ilike.*${encodeURIComponent(safe)}*)`;
      }
      path += "&order=date.desc,transaction_id.asc";

      const r = await db(path, {
        headers: { Range: `${offset}-${offset + limit - 1}`, Prefer: "count=exact" },
      });
      if (!r.ok) throw new Error(`DB error: ${(await r.text()).slice(0, 300)}`);
      const rows = (await r.json()) as BookTxn[];
      const total = Number(r.headers.get("content-range")?.split("/")[1] ?? rows.length);
      return res.json({ transactions: rows, total, offset, limit });
    }

    if (report === "pnl") {
      const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : String(new Date().getFullYear());
      const entity = String(req.query.entity ?? "all");
      const rollup = entity === "all";

      // Cash basis: posted transactions only, hidden accounts excluded.
      const rows = await fetchAll<BookTxn>(
        `book_transactions?select=${TXN_COLS}&hidden=eq.false&pending=eq.false` +
          `&date=gte.${year}-01-01&date=lte.${year}-12-31${entityFilter(rollup ? "all" : entity)}` +
          "&order=date.asc"
      );

      const monthOf = (d: string) => Number(d.slice(5, 7)) - 1;
      const zeros = () => Array(12).fill(0) as number[];

      const income = new Map<string, number[]>();
      const expenses = new Map<string, number[]>();
      const transfersIn = zeros();
      const transfersOut = zeros();
      // Intercompany, by how it's booked. In the rollup these are eliminated
      // (both legs net to zero across the family), so they only show per-entity.
      const interco: Record<string, { in: number[]; out: number[] }> = {
        transfer: { in: zeros(), out: zeros() },
        distribution: { in: zeros(), out: zeros() },
        loan: { in: zeros(), out: zeros() },
      };

      for (const t of rows) {
        const m = monthOf(t.date);
        const isTransfer = t.txn_type === "transfer" || t.intercompany;

        if (t.intercompany) {
          if (rollup) continue; // eliminated in the family-wide view
          const cls = interco[t.intercompany_class ?? "transfer"] ?? interco.transfer;
          if (t.amount < 0) cls.in[m] += -t.amount;
          else cls.out[m] += t.amount;
          continue;
        }
        if (isTransfer) {
          if (t.amount < 0) transfersIn[m] += -t.amount;
          else transfersOut[m] += t.amount;
          continue;
        }

        // Plaid: negative = money in. Cash-basis P&L: inflows are income.
        const label = prettyCategory(t.plaid_category);
        const bucket = t.amount < 0 ? income : expenses;
        const row = bucket.get(label) ?? zeros();
        row[m] += Math.abs(t.amount);
        bucket.set(label, row);
      }

      const toRows = (map: Map<string, number[]>) =>
        [...map.entries()]
          .map(([label, monthly]) => ({ label, monthly, total: monthly.reduce((s, v) => s + v, 0) }))
          .sort((a, b) => b.total - a.total);

      const incomeRows = toRows(income);
      const expenseRows = toRows(expenses);
      const incomeMonthly = zeros().map((_, m) => incomeRows.reduce((s, r) => s + r.monthly[m], 0));
      const expenseMonthly = zeros().map((_, m) => expenseRows.reduce((s, r) => s + r.monthly[m], 0));
      const netMonthly = incomeMonthly.map((v, m) => v - expenseMonthly[m]);

      const section = (data: { in: number[]; out: number[] }) => ({
        in: data.in,
        out: data.out,
        net: data.in.map((v, m) => v - data.out[m]),
        total: data.in.reduce((s, v) => s + v, 0) - data.out.reduce((s, v) => s + v, 0),
      });

      return res.json({
        year: Number(year),
        entity,
        basis: "cash",
        transaction_count: rows.length,
        income: incomeRows,
        expenses: expenseRows,
        income_monthly: incomeMonthly,
        expense_monthly: expenseMonthly,
        net_monthly: netMonthly,
        net_total: netMonthly.reduce((s, v) => s + v, 0),
        transfers: section({ in: transfersIn, out: transfersOut }),
        intercompany: rollup
          ? null
          : {
              transfer: section(interco.transfer),
              distribution: section(interco.distribution),
              loan: section(interco.loan),
            },
      });
    }

    if (report === "vendors") {
      const { entity } = req.query as Record<string, string | undefined>;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const rows = await fetchAll<BookTxn>(
        `book_transactions?select=${TXN_COLS}&hidden=eq.false&pending=eq.false&txn_type=eq.normal` +
          `&intercompany=is.false&date=gte.${cutoff.toISOString().slice(0, 10)}${entityFilter(entity)}`
      );

      type Vendor = {
        vendor: string;
        count: number;
        spent: number;
        received: number;
        last_date: string;
        entities: Set<string>;
      };
      const vendors = new Map<string, Vendor>();
      for (const t of rows) {
        const name = (t.merchant_name || t.name || "Unknown").trim();
        const key = name.toLowerCase();
        const v = vendors.get(key) ?? {
          vendor: name,
          count: 0,
          spent: 0,
          received: 0,
          last_date: t.date,
          entities: new Set<string>(),
        };
        v.count += 1;
        if (t.amount > 0) v.spent += t.amount;
        else v.received += -t.amount;
        if (t.date > v.last_date) v.last_date = t.date;
        if (t.entity_name) v.entities.add(t.entity_name);
        vendors.set(key, v);
      }

      return res.json({
        vendors: [...vendors.values()]
          .map((v) => ({ ...v, entities: [...v.entities].sort() }))
          .sort((a, b) => b.spent - a.spent),
      });
    }

    return res.status(400).json({ error: "unknown_report", message: "Use: meta, transactions, pnl, vendors" });
  } catch (err: any) {
    console.error("books data error:", err.message);
    return res.status(500).json({ error: "books_data_failed", message: "Couldn't load that report." });
  }
}
