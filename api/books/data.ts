import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { computeLoans } from "../../lib/books-loans.js";
import { patchMatching, ACCOUNTS, sectionOf } from "../../lib/books-rules.js";

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
  loan_id: string | null;
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

type EffType = "normal" | "transfer" | "intercompany" | "loan";

function effType(t: BookTxn): EffType {
  // A transaction attached to a loan is a balance-sheet movement — that
  // attachment is the user's most explicit signal, so it wins outright.
  if (t.loan_id) return "loan";
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
  // The all-entities rollup eliminates every intercompany movement — that's
  // the family-wide view the user asked for, and these rows never touch the
  // operating net (income − expense) either way, so dropping them from the
  // rollup doesn't distort it. Under a partial selection, a movement is
  // eliminated only when its counterparty's entity is also selected.
  if (selection === null) return true;
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
      if (req.body.show_on_report !== undefined) patch.show_on_report = !!req.body.show_on_report;
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

    // ── Auto-attach rule: descriptions containing X belong to this loan ──
    if (req.method === "POST" && req.body?.action === "loan_rule") {
      const match = String(req.body.match ?? "").trim().slice(0, 120);
      const loanId = String(req.body.loan_id ?? "");
      if (!match || match.length < 3) {
        return res.status(400).json({ error: "match_too_short", message: "Use at least 3 characters." });
      }
      if (!/^[0-9a-f-]{36}$/i.test(loanId)) return res.status(400).json({ error: "missing_loan_id" });

      const ruleRes = await db("book_rules", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ match, loan_id: loanId }),
      });
      if (!ruleRes.ok) {
        console.error("loan rule save failed:", (await ruleRes.text()).slice(0, 200));
        return res.status(500).json({ error: "rule_failed", message: "Couldn't save that rule." });
      }
      const rule = ((await ruleRes.json()) as any[])[0];

      // Attach every already-synced, not-yet-on-a-loan transaction that
      // literally contains the rule text — same matcher as the nightly pass.
      const attached = await patchMatching(db, match, "loan_id=is.null", { loan_id: loanId });
      return res.json({ rule, attached });
    }

    if (req.method === "POST" && req.body?.action === "delete_rule") {
      const ruleId = String(req.body.rule_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(ruleId)) return res.status(400).json({ error: "missing_rule_id" });
      await db(`book_rules?id=eq.${ruleId}`, { method: "DELETE" });
      return res.json({ deleted: true });
    }

    // ── "All of these, and from now on": bulk categorize + store a rule ──
    if (req.method === "POST" && req.body?.action === "categorize_vendor") {
      const match = String(req.body.match ?? "").trim().slice(0, 120);
      const category = String(req.body.book_category ?? "").trim().slice(0, 60);
      if (!match || !category) return res.status(400).json({ error: "missing_fields" });

      // Remember the rule (replacing any earlier rule for the same text) so
      // the nightly sync categorizes future arrivals the same way. Find the
      // duplicate by exact (case-insensitive) text rather than an ilike, which
      // would mis-handle _ % and other metacharacters.
      const existing = await db("book_rules?select=id,match&loan_id=is.null");
      if (existing.ok) {
        const dup = ((await existing.json()) as Array<{ id: string; match: string }>).find(
          (x) => x.match.toLowerCase() === match.toLowerCase()
        );
        if (dup) await db(`book_rules?id=eq.${dup.id}`, { method: "DELETE" }).catch(() => {});
      }
      const ruleRes = await db("book_rules", {
        method: "POST",
        body: JSON.stringify({ match, book_category: category }),
      });
      if (!ruleRes.ok) console.error("rule save failed:", (await ruleRes.text()).slice(0, 200));

      // Apply to everything already synced that literally contains the text.
      const applied = await patchMatching(db, match, "", { book_category: category });
      return res.json({ applied, rule: { match, book_category: category } });
    }

    // ── Vendor settings: rename the vendor and/or set its default account.
    //    Stored as a rule so the nightly sync keeps applying both to new
    //    arrivals; existing rows are patched immediately. ──────────────────
    if (req.method === "POST" && req.body?.action === "vendor_settings") {
      const match = String(req.body.match ?? "").trim().slice(0, 200);
      const vendorName =
        req.body.vendor_name !== undefined ? String(req.body.vendor_name).trim().slice(0, 80) : undefined;
      const category =
        req.body.book_category !== undefined ? String(req.body.book_category).trim().slice(0, 60) : undefined;
      if (match.length < 2) return res.status(400).json({ error: "missing_match" });
      if (vendorName === undefined && category === undefined) {
        return res.status(400).json({ error: "nothing_to_update" });
      }
      if (vendorName !== undefined && !vendorName) return res.status(400).json({ error: "empty_name" });

      // One rule per matched text: merge into the existing rule if present.
      const existing = await db("book_rules?select=id,match&loan_id=is.null");
      const dup = existing.ok
        ? ((await existing.json()) as Array<{ id: string; match: string }>).find(
            (x) => x.match.toLowerCase() === match.toLowerCase()
          )
        : undefined;
      const rulePatch: Record<string, unknown> = {};
      if (vendorName !== undefined) rulePatch.vendor_name = vendorName;
      if (category !== undefined) rulePatch.book_category = category;
      if (dup) {
        await db(`book_rules?id=eq.${dup.id}`, { method: "PATCH", body: JSON.stringify(rulePatch) });
      } else {
        await db("book_rules", { method: "POST", body: JSON.stringify({ match, ...rulePatch }) });
      }

      const txnPatch: Record<string, unknown> = {};
      if (vendorName !== undefined) txnPatch.merchant_name = vendorName;
      if (category !== undefined) txnPatch.book_category = category;
      const applied = await patchMatching(db, match, "", txnPatch);
      return res.json({ applied, vendor_name: vendorName ?? null, book_category: category ?? null });
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
      // The canonical chart of accounts, unioned with anything already filed in
      // the data, so every account (incl. manual-only ones) is always offered.
      const categories = [...new Set([...ACCOUNTS, ...cats.map((c) => c.book_category!)])].sort((a, b) =>
        a.localeCompare(b)
      );

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
      } else if (type === "uncategorized") {
        path += `&book_category=is.null`;
      }
      if (q) {
        // Structural chars and the * wildcard drop out; the LIKE metacharacters
        // _ and % are escaped so a search behaves as a literal substring.
        const safe = q
          .replace(/[,()*]/g, " ")
          .replace(/([\\%_])/g, "\\$1")
          .trim();
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
      const loanNames = new Map(
        (await fetchAll<{ id: string; name: string }>("book_loans?select=id,name")).map((l) => [l.id, l.name])
      );
      const rowLabel = (t: BookTxn) =>
        t.loan_id ? `${loanNames.get(t.loan_id) ?? "Loan"} (loan)` : label(t);

      // Which income-statement group a 'normal' row lands in: its account's
      // section, or — for uncategorized / flow-coded rows — by sign.
      const pnlSection = (t: BookTxn): "revenue" | "operating" | "other" => {
        const sec = sectionOf(label(t));
        if (sec === "revenue" || sec === "operating" || sec === "other") return sec;
        return t.amount < 0 ? "revenue" : "operating";
      };

      // ── One P&L cell: the transactions behind it ──────────────────────
      if (report === "cell") {
        const section = String(req.query.section ?? "");
        const wantLabel = req.query.label != null ? String(req.query.label) : null;
        const month = /^\d{1,2}$/.test(String(req.query.month)) ? Number(req.query.month) : null; // 1-12

        const matches = rows
          .filter((t) => {
            if (month !== null && monthOf(t.date) !== month - 1) return false;
            const eff = effType(t);
            if (section === "revenue" || section === "operating" || section === "other") {
              return eff === "normal" && pnlSection(t) === section && (!wantLabel || label(t) === wantLabel);
            }
            if (section === "net") return eff === "normal";
            if (section === "transfers") {
              return (eff === "transfer" || eff === "loan") && (!wantLabel || rowLabel(t) === wantLabel);
            }
            if (section === "intercompany") {
              return eff === "intercompany" && !eliminated(t, selection, prefs);
            }
            return false;
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        return res.json({ transactions: matches, count: matches.length });
      }

      // ── The P&L matrix itself — grouped into GAAP statement sections ──
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
          if (eliminated(t, selection, prefs)) {
            eliminatedCount += 1;
            continue;
          }
          if (t.amount < 0) interIn[m] += -t.amount;
          else interOut[m] += t.amount;
          continue;
        }
        if (eff === "transfer" || eff === "loan") {
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

      return res.json({
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

    if (report === "loans") {
      const { loans, totalOutstanding } = await computeLoans();
      const rules = await fetchAll<{ id: string; match: string; loan_id: string | null }>(
        "book_rules?loan_id=not.is.null&select=id,match,loan_id"
      );
      return res.json({ loans, rules, total_outstanding: totalOutstanding });
    }

    // ── Balance sheet: what the family owns and owes, as of the last
    //    balance snapshot. Cash and investments from the connected accounts,
    //    loans receivable from the ledger, credit cards as liabilities. ──────
    if (report === "balance-sheet") {
      const selection = parseEntities(String(req.query.entity ?? "all"));
      const prefs = await getPrefs();

      const identities = await fetchAll<{
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
      }>("plaid_account_prefs?select=*&archived_at=is.null");
      const states = await fetchAll<{ account_id: string; balance: number | null; seen_at: string }>(
        "plaid_account_state?select=account_id,balance,seen_at"
      );
      const stateBy = new Map(states.map((st) => [st.account_id, st]));

      const INVESTISH = /ira|brokerage|trust|401|403|roth|529|pension|annuity|mutual/i;
      // Loan/mortgage/line-of-credit accounts are liabilities, not cash —
      // without them here their principal would land in the cash bucket and
      // inflate assets. (Plaid's account `type` would be the fuller signal;
      // we key on subtype since that's what we store.)
      const LIABILITY = /credit|mortgage|line of credit|heloc|home equity|student|overdraft|paypal/i;
      type Row = { label: string; detail: string; balance: number };
      const cash: Row[] = [];
      const investments: Row[] = [];
      const credit: Row[] = [];
      let asOf: string | null = null;

      for (const id of identities) {
        if (id.hidden) continue;
        if (selection && (!id.entity_id || !selection.includes(id.entity_id))) continue;
        const st = stateBy.get(id.account_id);
        if (!st || st.balance == null) continue; // no snapshot = not on the sheet
        if (Math.abs(Number(st.balance)) < 0.005) continue;
        if (!asOf || st.seen_at > asOf) asOf = st.seen_at;

        const subtype = (id.subtype ?? "").toLowerCase();
        const label = id.entity_name || id.nickname || id.account_name || "Account";
        const detailBits = [id.institution_name, id.mask ? `····${id.mask}` : null, id.subtype]
          .filter(Boolean)
          .join(" · ");
        const row: Row = { label, detail: detailBits, balance: Number(st.balance) };

        if (LIABILITY.test(subtype)) credit.push(row);
        else if (INVESTISH.test(subtype)) investments.push(row);
        else cash.push(row);
      }

      const byBalance = (a: Row, b: Row) => b.balance - a.balance;
      cash.sort(byBalance);
      investments.sort(byBalance);
      credit.sort(byBalance);

      // Loans receivable are family-level — book_loans carries no entity — so
      // they belong only to the all-entities sheet. Adding them to a single
      // entity's totals would attribute the whole loan book to that one entity
      // (and count it again for the next), overstating per-entity net worth.
      const loanRows =
        selection === null
          ? (await computeLoans()).loans
              .filter((l) => Math.abs(l.outstanding) >= 0.005)
              .map((l) => ({
                label: l.name,
                detail: l.id ? "loan receivable" : "from categories",
                balance: l.outstanding,
              }))
          : [];

      const sum = (rows: Row[]) => rows.reduce((total, r) => total + r.balance, 0);
      const totals = {
        cash: sum(cash),
        investments: sum(investments),
        loans: sum(loanRows),
        credit: sum(credit),
      };
      const totalAssets = totals.cash + totals.investments + totals.loans;

      return res.json({
        as_of: asOf,
        entity: selection ? selection.join(",") : "all",
        sections: {
          cash: { rows: cash, total: totals.cash },
          investments: { rows: investments, total: totals.investments },
          loans: { rows: loanRows, total: totals.loans },
          credit: { rows: credit, total: totals.credit },
        },
        total_assets: totalAssets,
        total_liabilities: totals.credit,
        net_worth: totalAssets - totals.credit,
      });
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
