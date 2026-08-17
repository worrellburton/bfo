import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { categorize } from "../../lib/books-rules.js";
import { betterVendor } from "../../lib/vendor-parse.js";

/**
 * Import bank-exported CSV rows into Books — the escape hatch for history a
 * bank won't serve through Plaid (Wells Fargo caps at ~90 days).
 *
 * The client parses the CSV and posts clean rows; this endpoint stamps ids
 * ("csv_<sha1>") deterministically so re-importing the same file is a no-op,
 * and skips any row that already exists for the account on the same date with
 * the same amount (i.e. rows Plaid already covers) so nothing double-counts.
 *
 * Sign convention in: bank exports sign deposits positive, withdrawals
 * negative. Books (Plaid convention) signs outflows positive — flipped here.
 */

type InRow = { date: string; description: string; amount: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const accountId = String(req.body?.account_id ?? "").trim();
  const input = Array.isArray(req.body?.rows) ? (req.body.rows as InRow[]) : [];
  if (!accountId) return res.status(400).json({ error: "missing_account_id" });
  if (!input.length) return res.status(400).json({ error: "no_rows" });
  if (input.length > 20000) return res.status(400).json({ error: "too_many_rows" });

  const clean = input
    .map((r) => ({
      date: String(r.date ?? "").slice(0, 10),
      description: String(r.description ?? "").trim().slice(0, 500),
      amount: Number(r.amount),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.amount) && r.amount !== 0);
  if (!clean.length) return res.status(400).json({ error: "no_valid_rows" });

  try {
    const prefRes = await db(
      `plaid_account_prefs?account_id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`
    );
    const pref = prefRes.ok ? ((await prefRes.json()) as any[])[0] ?? null : null;

    // Existing (date, amount-in-cents) pairs for this account across the CSV's
    // date range — anything already present (from Plaid or a prior import) is
    // skipped rather than doubled.
    const dates = clean.map((r) => r.date).sort();
    const existingRes = await db(
      `book_transactions?account_id=eq.${encodeURIComponent(accountId)}` +
        `&date=gte.${dates[0]}&date=lte.${dates[dates.length - 1]}` +
        `&select=date,amount&limit=20000`
    );
    const existing = new Set(
      existingRes.ok
        ? ((await existingRes.json()) as any[]).map(
            (t) => `${t.date}|${Math.round(Number(t.amount) * 100)}`
          )
        : []
    );

    // Same rule set the nightly sync applies, so imported rows pick up the
    // user's category, vendor rename, and type override — not just category.
    const rulesRes = await db("book_rules?select=match,book_category,vendor_name,type_override");
    const userRules = rulesRes.ok
      ? ((await rulesRes.json()) as any[]).map((r) => ({
          match: String(r.match).toLowerCase(),
          book_category: (r.book_category ?? null) as string | null,
          vendor_name: (r.vendor_name ?? null) as string | null,
          type_override: (r.type_override ?? null) as string | null,
        }))
      : [];
    const ruleFor = (desc: string) => {
      const text = desc.toLowerCase();
      return {
        category: userRules.find((u) => u.book_category && text.includes(u.match))?.book_category ?? null,
        vendor: userRules.find((u) => u.vendor_name && text.includes(u.match))?.vendor_name ?? null,
        type: userRules.find((u) => u.type_override && text.includes(u.match))?.type_override ?? null,
      };
    };

    const now = new Date().toISOString();
    let skipped = 0;
    const rows = clean.flatMap((r) => {
      // CSV: deposits positive → Books: outflows positive.
      const amount = -r.amount;
      const key = `${r.date}|${Math.round(amount * 100)}`;
      if (existing.has(key)) {
        skipped += 1;
        return [];
      }
      const id = createHash("sha1")
        .update(`${accountId}|${r.date}|${amount.toFixed(2)}|${r.description}`)
        .digest("hex");
      const rule = categorize(r.description, null, null);
      const taught = ruleFor(r.description);
      return [
        {
          transaction_id: `csv_${id}`,
          account_id: accountId,
          item_id: "csv_import",
          date: r.date,
          name: r.description || null,
          // A vendor-rename rule names the payee; otherwise the descriptor
          // parser derives one, same as the nightly sync.
          merchant_name: taught.vendor ?? betterVendor(r.description, null),
          amount,
          pending: false,
          currency: "USD",
          plaid_category: null,
          plaid_category_detailed: null,
          payment_channel: "csv",
          txn_type: (rule.type === "intercompany" ? "transfer" : rule.type ?? "normal") as
            | "normal"
            | "transfer",
          intercompany: rule.type === "intercompany",
          book_category: taught.category ?? rule.category,
          // Uniform across every row (null when no rule) so the bulk upsert
          // keeps one column set; mirrors the sync's type override.
          type_override: taught.type,
          entity_id: pref?.entity_id ?? null,
          entity_name: pref?.entity_name ?? null,
          hidden: pref?.hidden ?? false,
          updated_at: now,
        },
      ];
    });

    for (let i = 0; i < rows.length; i += 500) {
      const r = await db("book_transactions", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
      if (!r.ok) throw new Error(`upsert failed: ${(await r.text()).slice(0, 300)}`);
    }

    return res.status(200).json({ imported: rows.length, skipped_existing: skipped });
  } catch (err: any) {
    console.error("csv import error:", err.message);
    return res.status(500).json({ error: "import_failed", message: err.message?.slice(0, 300) });
  }
}
