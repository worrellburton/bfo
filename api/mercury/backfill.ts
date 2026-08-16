import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentUser, sbFetch as db } from "../../lib/auth.js";
import { categorize } from "../../lib/books-rules.js";
import { mercuryConfigured, mercuryAccounts, mercuryTransactions, mercuryDownload, mask4 } from "../../lib/mercury.js";
import { storageUpload } from "../../lib/storage.js";

/**
 * Backfill Mercury history from Mercury's own API — it returns the full
 * account history, where Plaid caps out at ~90 days.
 *
 * Safety model: each Mercury account is matched to its Plaid account by the
 * last four digits, rows are written under the *Plaid* account_id (so entity
 * mappings, Treasury and the P&L all just work), and only dates strictly
 * BEFORE the earliest Plaid transaction for that account are inserted — the
 * two sources never overlap, so nothing can double-count. Idempotent:
 * transaction ids are "mercury_<id>" and re-runs merge.
 */

const HISTORY_MONTHS = 24;

type UserRule = { match: string; book_category: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  if (!mercuryConfigured()) {
    return res.status(400).json({
      error: "not_configured",
      message: "Set MERCURY_API_TOKEN in the environment first.",
    });
  }

  try {
    // Mercury accounts ↔ Plaid accounts, matched on the last four digits.
    const prefsRes = await db("plaid_account_prefs?select=*&archived_at=is.null");
    const prefs = prefsRes.ok ? ((await prefsRes.json()) as any[]) : [];
    const mercuryPrefs = prefs.filter((p) => /mercury/i.test(p.institution_name ?? ""));

    const rulesRes = await db("book_rules?select=match,book_category");
    const userRules: UserRule[] = rulesRes.ok
      ? ((await rulesRes.json()) as UserRule[]).map((r) => ({
          match: r.match.toLowerCase(),
          book_category: r.book_category,
        }))
      : [];

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
    const sinceDay = cutoff.toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const accounts = await mercuryAccounts();
    const summary: any[] = [];
    let totalInserted = 0;

    for (const acct of accounts) {
      const last4 = mask4(acct.accountNumber);
      const pref = mercuryPrefs.find((p) => p.mask && p.mask === last4);
      if (!pref) {
        summary.push({ mercury_account: acct.name, last4, matched: false });
        continue;
      }

      // Only fill history Plaid doesn't already cover for this account.
      const earliestRes = await db(
        `book_transactions?account_id=eq.${encodeURIComponent(pref.account_id)}` +
          `&select=date&order=date.asc&limit=1`
      );
      const earliest = earliestRes.ok ? ((await earliestRes.json()) as any[])[0]?.date ?? null : null;

      const txns = await mercuryTransactions(acct.id, sinceDay);
      const rows = txns
        .filter((t) => t.status === "sent")
        .map((t) => {
          const date = (t.postedAt ?? t.createdAt ?? "").slice(0, 10);
          return { t, date };
        })
        .filter(({ date }) => date && date >= sinceDay && (!earliest || date < earliest))
        .map(({ t, date }) => {
          const vendor = t.counterpartyName?.trim() || null;
          const description = t.bankDescription?.trim() || t.note?.trim() || vendor;
          // Mercury signs outflows negative; Plaid (and Books) signs them positive.
          const amount = -t.amount;
          const rule = categorize(description ?? null, vendor, null);
          const text = `${vendor ?? ""} ${description ?? ""}`.toLowerCase();
          const taught = userRules.find((r) => text.includes(r.match))?.book_category ?? null;
          return {
            transaction_id: `mercury_${t.id}`,
            account_id: pref.account_id,
            item_id: `mercury_api`,
            date,
            name: description ?? null,
            merchant_name: vendor,
            amount,
            pending: false,
            currency: "USD",
            plaid_category: null,
            plaid_category_detailed: null,
            payment_channel: t.kind ?? null,
            txn_type: (rule.type === "intercompany" ? "transfer" : rule.type ?? "normal") as
              | "normal"
              | "transfer",
            intercompany: rule.type === "intercompany",
            book_category: taught ?? rule.category,
            entity_id: pref.entity_id ?? null,
            entity_name: pref.entity_name ?? null,
            hidden: pref.hidden ?? false,
            updated_at: now,
          };
        });

      for (let i = 0; i < rows.length; i += 500) {
        const r = await db("book_transactions", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(rows.slice(i, i + 500)),
        });
        if (!r.ok) throw new Error(`upsert failed: ${(await r.text()).slice(0, 300)}`);
      }

      // Pull Mercury's own receipt attachments into Books storage. Same
      // window as the rows above; idempotent by (transaction_id, label).
      let receiptsAdded = 0;
      const eligible = txns.filter((t) => {
        const date = (t.postedAt ?? t.createdAt ?? "").slice(0, 10);
        return t.status === "sent" && date && date >= sinceDay && (!earliest || date < earliest) && (t.attachments?.length ?? 0) > 0;
      });
      if (eligible.length) {
        const ids = eligible.map((t) => `"mercury_${t.id}"`).join(",");
        const existingRes = await db(`book_txn_receipt?transaction_id=in.(${ids})&select=transaction_id,label`);
        const existing = new Set(
          existingRes.ok ? ((await existingRes.json()) as any[]).map((r) => `${r.transaction_id}|${r.label}`) : []
        );
        for (const t of eligible) {
          for (const att of t.attachments ?? []) {
            if (!att.url) continue;
            const txnId = `mercury_${t.id}`;
            const label = (att.fileName || "receipt").slice(0, 120);
            if (existing.has(`${txnId}|${label}`)) continue;
            const dl = await mercuryDownload(att.url);
            if (!dl || !dl.bytes.length) continue;
            try {
              const safe = label.replace(/[^a-zA-Z0-9._-]/g, "_");
              const path = `${txnId}/mercury-${safe}`;
              await storageUpload(path, dl.bytes, dl.contentType);
              const ins = await db("book_txn_receipt", {
                method: "POST",
                body: JSON.stringify({ transaction_id: txnId, path, label, content_type: dl.contentType, source: "mercury" }),
              });
              if (ins.ok) receiptsAdded += 1;
            } catch {
              /* best-effort per attachment */
            }
          }
        }
      }

      totalInserted += rows.length;
      summary.push({
        mercury_account: acct.name,
        last4,
        matched: true,
        plaid_account: pref.nickname || pref.account_name,
        fetched: txns.length,
        backfilled: rows.length,
        receipts: receiptsAdded,
        before: earliest,
      });
    }

    return res.status(200).json({ backfilled: totalInserted, accounts: summary });
  } catch (err: any) {
    console.error("mercury backfill error:", err.message);
    return res.status(500).json({ error: "backfill_failed", message: err.message?.slice(0, 300) });
  }
}
