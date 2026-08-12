import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { computeLoans } from "../../lib/books-loans.js";

/**
 * Books reads and edits. Everything is served from book_transactions — the
 * nightly Plaid mirror — never from Plaid directly, so pages stay fast.
 *
 *   GET ?report=meta          → entities, categories, last sync, row count
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
  currency: string | null;
  plaid_category: string | null;
  plaid_category_detailed: string | null;
  payment_channel: string | null;
  txn_type: string;
  intercompany: boolean;
  intercompany_class: string | null;
  counterparty_account_id: string | null;
  type_override: string | null;
  book_category: string | null;
  entity_id: string | null;
  entity_name: string | null;
  updated_at?: string;
};

type Pref = {
  account_id: string;
  entity_id: string | null;
  entity_name: string | null;
  hidden: boolean;
};

/**
 * Mappings are read live rather than trusted from the copy stamped onto each
 * transaction at sync time — remapping an account takes effect at once.
 */
async function getPrefs(): Promise<Map<string, Pref>> {
  const rows = await fetchAll<Pref>(
    "plaid_account_prefs?select=account_id,entity_id,entity_name,hidden&archived_at=is.null"
  );
  return new Map(rows.map((p) => [p.account_id, p]));
}

const idList = (ids: string[]) => ids.map((id) => `"${id}"`).join(",");

/** Comma-separated entity ids, or null meaning "all". */
function parseEntities(raw: string | undefined): string[] | null {
  if (!raw || raw === "all") return null;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * Turn an entity selection into account-level PostgREST filters, so paging
 * and counts stay server-side. Hidden accounts are always excluded.
 */
function scopeFilter(prefs: Map<string, Pref>, selection: string[] | null | "unmapped"): string {
  const hidden = [...prefs.values()].filter((p) => p.hidden).map((p) => p.account_id);
  const base = hidden.length ? `&account_id=not.in.(${idList(hidden)})` : "";

  if (selection === null) return base;

  if (selection === "unmapped") {
    const mapped = [...prefs.values()].filter((p) => p.entity_id).map((p) => p.account_id);
    return base + (mapped.length ? `&account_id=not.in.(${idList(mapped)})` : "");
  }

  const wanted = [...prefs.values()]
    .filter((p) => p.entity_id && selection.includes(p.entity_id))
    .map((p) => p.account_id);
  return base + `&account_id=in.(${wanted.length ? idList(wanted) : '"none"'})`;
}

/** Overlay each row with the entity its account is mapped to right now. */
function withLiveEntity(rows: BookTxn[], prefs: Map<string, Pref>): BookTxn[] {
  return rows.map((row) => {
    const pref = prefs.get(row.account_id);
    return { ...row, entity_id: pref?.entity_id ?? null, entity_name: pref?.entity_name ?? null };
  });
}

type EffType = "normal" | "transfer" | "intercompany";

function effType(t: BookTxn): EffType {
  if (t.type_override === "normal" || t.type_override === "transfer" || t.type_override === "intercompany") {
    return t.type_override;
  }
  if (t.intercompany) return "intercompany";
  return t.txn_type === "transfer" ? "transfer" : "normal";
}

function label(t: BookTxn): string {
  return t.book_category || prettyCategory(t.plaid_category);
}

/**
 * Should this intercompany row vanish from the report? Only when we can see
 * both legs inside the current selection — for "all entities" that is every
 * row; under a partial selection the counterparty's entity must be selected
 * too. Unpaired rows under a partial selection stay visible rather than
 * silently disappearing.
 */
function eliminated(t: BookTxn, selection: string[] | null, prefs: Map<string, Pref>): boolean {
  if (selection === null) return true; // family-wide view nets all intercompany to zero
  const counterEntity = t.counterparty_account_id
    ? prefs.get(t.counterparty_account_id)?.entity_id ?? null
    : null;
  return !!counterEntity && selection.includes(counterEntity);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  try {
    // ── Loan registry actions ───────────────────────────────────────────
    if (req.method === "POST" && req.body?.action === "create_loan") {
      const name = String(req.body.name ?? "").trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: "missing_name", message: "Give the loan a name." });
      const starting = Number(req.body.starting_balance ?? 0);
      const r = await db("book_loans", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name, starting_balance: Number.isFinite(starting) ? starting : 0 }),
      });
      if (!r.ok) {
        console.error("create loan failed:", (await r.text()).slice(0, 300));
        return res.status(500).json({ error: "create_failed", message: "Couldn't create that loan." });
      }
      return res.json({ loan: ((await r.json()) as any[])[0] });
    }

    if (req.method === "POST" && req.body?.action === "update_loan") {
      const loanId = String(req.body.loan_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(loanId)) return res.status(400).json({ error: "missing_loan_id" });
      const patch: Record<string, unknown> = {};
      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: "missing_name" });
        patch.name = name;
      }
      if (req.body.starting_balance !== undefined) {
        const n = Number(req.body.starting_balance);
        if (!Number.isFinite(n)) return res.status(400).json({ error: "invalid_balance" });
        patch.starting_balance = n;
      }
      if (req.body.archived !== undefined) patch.archived_at = req.body.archived ? new Date().toISOString() : null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing_to_update" });
      const r = await db(`book_loans?id=eq.${loanId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) return res.status(500).json({ error: "update_failed", message: "Couldn't save that loan." });
      const rows = (await r.json()) as any[];
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ loan: rows[0] });
    }

    // ── Edits: a person reclassifying a transaction ─────────────────────
    if (req.method === "POST") {
      const { transaction_id, type_override, book_category, loan_id } = req.body ?? {};
      if (!transaction_id || typeof transaction_id !== "string") {
        return res.status(400).json({ error: "missing_transaction_id" });
      }
      const patch: Record<string, unknown> = {};
      if (type_override !== undefined) {
        if (type_override !== null && !["normal", "transfer", "intercompany"].includes(type_override)) {
          return res.status(400).json({ error: "invalid_type" });
        }
        patch.type_override = type_override;
      }
      if (book_category !== undefined) {
        const trimmed = book_category === null ? null : String(book_category).trim().slice(0, 60);
        patch.book_category = trimmed || null;
      }
      if (loan_id !== undefined) {
        if (loan_id !== null && !/^[0-9a-f-]{36}$/i.test(String(loan_id))) {
          return res.status(400).json({ error: "invalid_loan_id" });
        }
        patch.loan_id = loan_id;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing_to_update" });

      const r = await db(`book_transactions?transaction_id=eq.${encodeURIComponent(transaction_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        console.error("books edit failed:", (await r.text()).slice(0, 300));
        return res.status(500).json({ error: "update_failed", message: "Couldn't save that change." });
      }
      const rows = (await r.json()) as BookTxn[];
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ transaction: rows[0] });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
    const report = String(req.query.report ?? "");

    if (report === "meta") {
      const prefs = await getPrefs();
      const seen = new Map<string, string>();
      for (const p of prefs.values()) if (p.entity_id) seen.set(p.entity_id, p.entity_name ?? p.entity_id);
      const entities = [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const countRes = await db("book_transactions?select=transaction_id&limit=1", {
        headers: { Prefer: "count=exact" },
      });
      const total = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
      const lastRes = await db("book_transactions?select=updated_at&order=updated_at.desc&limit=1");
      const last = lastRes.ok ? ((await lastRes.json()) as any[])[0]?.updated_at ?? null : null;

      // The chart of accounts as it exists in the data — feeds the category
      // dropdowns so edits pick from real lines.
      const cats = await fetchAll<{ book_category: string | null }>(
        "book_transactions?select=book_category&book_category=not.is.null"
      );
      const categories = [...new Set(cats.map((c) => c.book_category!))].sort();

      const loanRows = await fetchAll<{ id: string; name: string }>(
        "book_loans?archived_at=is.null&select=id,name&order=name.asc"
      );

      return res.json({ entities, categories, loans: loanRows, total_transactions: total, last_synced_at: last });
    }

    if (report === "transactions") {
      const { entity, type, q, year } = req.query as Record<string, string | undefined>;
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const offset = Number(req.query.offset ?? 0) || 0;

      const prefs = await getPrefs();
      const selection = entity === "unmapped" ? ("unmapped" as const) : parseEntities(entity);
      let path = `book_transactions?select=*${scopeFilter(prefs, selection)}`;
      if (year && /^\d{4}$/.test(year)) {
        path += `&date=gte.${year}-01-01&date=lte.${year}-12-31`;
      }
      // Override-aware type filters, kept server-side for correct counts.
      if (type === "transfers") {
        path += `&or=(type_override.eq.transfer,and(type_override.is.null,txn_type.eq.transfer,intercompany.is.false))`;
      } else if (type === "intercompany") {
        path += `&or=(type_override.eq.intercompany,and(type_override.is.null,intercompany.is.true))`;
      }
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
      return res.json({ transactions: withLiveEntity(rows, prefs), total, offset, limit });
    }

    if (report === "pnl" || report === "cell") {
      const year = /^\d{4}$/.test(String(req.query.year))
        ? String(req.query.year)
        : String(new Date().getFullYear());
      const selection = parseEntities(String(req.query.entity ?? "all"));

      const prefs = await getPrefs();
      // Cash basis: posted transactions only, hidden accounts excluded.
      const rows = withLiveEntity(
        await fetchAll<BookTxn>(
          `book_transactions?select=*&pending=eq.false` +
            `&date=gte.${year}-01-01&date=lte.${year}-12-31` +
            scopeFilter(prefs, selection) +
            "&order=date.asc"
        ),
        prefs
      );

      const monthOf = (d: string) => Number(d.slice(5, 7)) - 1;

      // ── One P&L cell: the transactions behind it ──────────────────────
      if (report === "cell") {
        const section = String(req.query.section ?? "");
        const wantLabel = req.query.label != null ? String(req.query.label) : null;
        const month = /^\d{1,2}$/.test(String(req.query.month)) ? Number(req.query.month) : null; // 1-12

        const matches = rows
          .filter((t) => {
            if (month !== null && monthOf(t.date) !== month - 1) return false;
            const eff = effType(t);
            if (section === "income") {
              return eff === "normal" && t.amount < 0 && (!wantLabel || label(t) === wantLabel);
            }
            if (section === "expenses") {
              return eff === "normal" && t.amount > 0 && (!wantLabel || label(t) === wantLabel);
            }
            if (section === "net") return eff === "normal";
            if (section === "transfers") {
              return eff === "transfer" && (!wantLabel || label(t) === wantLabel);
            }
            if (section === "intercompany") {
              return eff === "intercompany" && !eliminated(t, selection, prefs);
            }
            return false;
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        return res.json({ transactions: matches, count: matches.length });
      }

      // ── The P&L matrix itself ─────────────────────────────────────────
      const zeros = () => Array(12).fill(0) as number[];
      const income = new Map<string, number[]>();
      const expenses = new Map<string, number[]>();
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
          if (eliminated(t, selection, prefs)) {
            eliminatedCount += 1;
            continue;
          }
          if (t.amount < 0) interIn[m] += -t.amount;
          else interOut[m] += t.amount;
          continue;
        }
        if (eff === "transfer") {
          if (t.amount < 0) transfersIn[m] += -t.amount;
          else transfersOut[m] += t.amount;
          const row = transferCats.get(label(t)) ?? zeros();
          row[m] += -t.amount; // net: in positive, out negative
          transferCats.set(label(t), row);
          continue;
        }

        // Plaid: negative = money in. Cash-basis P&L: inflows are income.
        const bucket = t.amount < 0 ? income : expenses;
        const row = bucket.get(label(t)) ?? zeros();
        row[m] += Math.abs(t.amount);
        bucket.set(label(t), row);
      }

      const toRows = (map: Map<string, number[]>) =>
        [...map.entries()]
          .map(([rowLabel, monthly]) => ({
            label: rowLabel,
            monthly,
            total: monthly.reduce((s, v) => s + v, 0),
          }))
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

      const incomeRows = toRows(income);
      const expenseRows = toRows(expenses);
      const incomeMonthly = zeros().map((_, m) => incomeRows.reduce((s, r) => s + r.monthly[m], 0));
      const expenseMonthly = zeros().map((_, m) => expenseRows.reduce((s, r) => s + r.monthly[m], 0));
      const netMonthly = incomeMonthly.map((v, m) => v - expenseMonthly[m]);

      return res.json({
        year: Number(year),
        entity: selection ? selection.join(",") : "all",
        basis: "cash",
        transaction_count: rows.length,
        eliminated_count: eliminatedCount,
        income: incomeRows,
        expenses: expenseRows,
        income_monthly: incomeMonthly,
        expense_monthly: expenseMonthly,
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

    if (report === "loans") {
      const { loans, totalOutstanding } = await computeLoans();
      return res.json({ loans, total_outstanding: totalOutstanding });
    }

    if (report === "vendors") {
      const year = /^\d{4}$/.test(String(req.query.year))
        ? String(req.query.year)
        : String(new Date().getFullYear());
      const selection = parseEntities(String(req.query.entity ?? "all"));
      const prefs = await getPrefs();

      const rows = withLiveEntity(
        await fetchAll<BookTxn>(
          `book_transactions?select=*&pending=eq.false` +
            `&date=gte.${year}-01-01&date=lte.${year}-12-31` +
            scopeFilter(prefs, selection)
        ),
        prefs
      );

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

      return res.json({
        year: Number(year),
        vendors: [...vendors.values()]
          .map((v) => ({ ...v, entities: [...v.entities].sort() }))
          .sort((a, b) => b.spent - a.spent),
      });
    }

    return res.status(400).json({ error: "unknown_report", message: "Use: meta, transactions, pnl, cell, vendors" });
  } catch (err: any) {
    console.error("books data error:", err.message);
    return res.status(500).json({ error: "books_data_failed", message: "Couldn't load that report." });
  }
}
