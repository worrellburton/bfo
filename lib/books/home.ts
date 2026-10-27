import { sbFetch as db } from "../auth.js";
import { anticipateInflows, type InflowRow, type PlannedInflow } from "../books-inflows.js";
import { flowMonths, flowSummary } from "../books-report.js";
import { fetchAll } from "../db-pages.js";
import { getPrefs, scopeFilter } from "./prefs.js";
import { ok, type BookTxn, type Reply } from "./types.js";

/**
 * ?report=home — one round trip for the dashboard: treasury trend, 30-day
 * money in/out, the review backlog and anticipated inflows. Each part fails
 * soft to null so one bad query never blanks the whole page.
 */
export async function homeReport(): Promise<Reply> {
  const now = new Date();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const DAY = 86400000;
  const prefsP = getPrefs().catch(() => null);

  const treasuryP = (async () => {
    try {
      const r = await db("treasury_daily?select=day,cash,invested,credit&order=day.desc&limit=120");
      if (!r.ok) throw new Error((await r.text()).slice(0, 200));
      const rows = (await r.json()) as Array<{ day: string; cash: number | string | null; invested: number | string | null; credit: number | string | null }>;
      return rows
        .map((x) => ({ day: x.day, cash: Number(x.cash ?? 0), invested: Number(x.invested ?? 0), credit: Number(x.credit ?? 0) }))
        .reverse();
    } catch (err: any) {
      console.error("home treasury failed:", err?.message ?? err);
      return null;
    }
  })();

  const flowP = (async () => {
    try {
      const prefs = await prefsP;
      if (!prefs) return null;
      const priorFrom = iso(now.getTime() - 60 * DAY);
      // Six calendar months, for the revenue and expense cards' bars.
      const since = `${flowMonths(now)[0]}-01`;
      const rows = await fetchAll<BookTxn>(
        "book_transactions?select=transaction_id,date,amount,book_category,plaid_category,type_override,txn_type,intercompany,loan_id,account_id,merchant_name,name,entity_name" +
          `&pending=eq.false&date=gte.${since < priorFrom ? since : priorFrom}` +
          scopeFilter(prefs, null) +
          "&order=transaction_id.asc"
      );
      return flowSummary(rows, now, (id) => prefs.get(id)?.entity_name);
    } catch (err: any) {
      console.error("home flow failed:", err?.message ?? err);
      return null;
    }
  })();

  const reviewP = (async () => {
    try {
      const prefs = await prefsP;
      if (!prefs) return null;
      const r = await db(
        `book_transactions?select=transaction_id&pending=eq.false&book_category=is.null${scopeFilter(prefs, null)}`,
        { headers: { Range: "0-0", Prefer: "count=exact" } }
      );
      if (!r.ok) throw new Error((await r.text()).slice(0, 200));
      const total = Number(r.headers.get("content-range")?.split("/")[1]);
      return { uncategorized: Number.isFinite(total) ? total : 0 };
    } catch (err: any) {
      console.error("home review failed:", err?.message ?? err);
      return null;
    }
  })();

  const inflowsP = (async () => {
    try {
      const prefs = await prefsP;
      if (!prefs) return null;
      const since = iso(now.getTime() - 548 * DAY);
      const [rows, adjustments] = await Promise.all([
        fetchAll<InflowRow & { account_id: string }>(
          "book_transactions?select=date,amount,merchant_name,name,book_category,entity_name,type_override,txn_type,intercompany,loan_id,account_id" +
            `&pending=eq.false&amount=lt.0&date=gte.${since}&order=date.asc,transaction_id.asc`
        ),
        fetchAll<{ kind: string; name: string; amount: number | string | null; cadence: string | null; expected_day: number | null; entity_name: string | null; note: string | null }>(
          "books_expected_inflows?select=kind,name,amount,cadence,expected_day,entity_name,note&active=eq.true&order=created_at.asc"
        ).catch(() => []),
      ]);
      const visible = rows
        .filter((r) => !prefs.get(r.account_id)?.hidden)
        .map((r) => ({ ...r, entity_name: prefs.get(r.account_id)?.entity_name ?? r.entity_name ?? null }));
      const planned: PlannedInflow[] = adjustments
        .filter((a) => a.kind === "manual")
        .map((a) => ({
          name: a.name,
          amount: Number(a.amount ?? 0),
          cadence: a.cadence === "one_time" ? "one_time" : "monthly",
          expectedDay: a.expected_day,
          entity: a.entity_name,
          note: a.note,
        }));
      const exclude = adjustments.filter((a) => a.kind === "exclude").map((a) => a.name);
      const a = anticipateInflows(visible, now, { planned, exclude });
      return {
        monthly: Math.round(a.monthly),
        streams: [...a.streams]
          .sort((x, y) => y.monthly - x.monthly)
          .slice(0, 6)
          .map((s) => ({
            source: s.source,
            entity: s.entity,
            monthly: Math.round(s.monthly),
            typical: Math.round(s.typical),
            nextExpected: s.nextExpected,
            overdue: s.overdue,
            cadence: s.cadence,
          })),
      };
    } catch (err: any) {
      console.error("home inflows failed:", err?.message ?? err);
      return null;
    }
  })();

  const [treasury, flow, review, inflows] = await Promise.all([treasuryP, flowP, reviewP, inflowsP]);
  return ok({ treasury, flow, review, inflows });
}
