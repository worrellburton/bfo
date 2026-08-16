import { useEffect, useState } from "react";
import { Link } from "react-router";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { shortDate } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Review" }];
}

const money = (n: number) => {
  if (Math.round(n) === 0) return "—";
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `($${v})` : `$${v}`;
};

/**
 * The review desk: what the automated books want a human to look at —
 * reconciliation tie-outs, uncategorized and low-confidence rows, likely
 * duplicates across the feeds, and the biggest items to sanity-check.
 */
export default function BooksReview() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [review, setReview] = useState<any | null>(null);
  const [recon, setRecon] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [r, c] = await Promise.all([
          authFetch("/api/books/data?report=review"),
          authFetch("/api/books/data?report=reconciliation"),
        ]);
        if (r.ok) setReview(await r.json());
        if (c.ok) setRecon(await c.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const head = `text-[11px] uppercase tracking-[0.12em] ${subtle}`;
  const who = (t: any) => t.merchant_name || t.name || "—";

  if (loading) {
    return (
      <div className={`rounded-2xl border p-4 max-w-3xl space-y-2.5 rise-in ${card}`}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
        ))}
      </div>
    );
  }

  const c = review?.counts ?? { uncategorized: 0, low_confidence: 0, duplicate_groups: 0 };

  return (
    <div className="w-full max-w-4xl space-y-8">
      <div>
        <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "" : "text-gray-900"}`}>Review</h1>
        <p className={`text-sm mt-0.5 ${subtle}`}>What the books want a second look at.</p>
      </div>

      {/* Headline counts */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ["Uncategorized", c.uncategorized, "/books/transactions"],
          ["Low confidence", c.low_confidence, null],
          ["Duplicate groups", c.duplicate_groups, null],
        ] as const).map(([label, n, href]) => {
          const inner = (
            <>
              <p className={`text-[11px] uppercase tracking-wider ${subtle}`}>{label}</p>
              <p className={`text-2xl font-semibold tabular-nums mt-1 ${n ? (isDark ? "text-white" : "text-gray-900") : subtle}`}>{n}</p>
            </>
          );
          return href ? (
            <Link key={label} to={href} className={`rounded-2xl border p-4 rise-in ${card} hover:border-current transition-colors`}>{inner}</Link>
          ) : (
            <div key={label} className={`rounded-2xl border p-4 rise-in ${card}`}>{inner}</div>
          );
        })}
      </div>

      {/* Reconciliation */}
      {recon?.accounts?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Reconciliation — ledger vs bank</h2>
          <div className={`rounded-2xl border overflow-x-auto rise-in ${card}`}>
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className={`${head} border-b ${border}`}>
                  <th className="px-4 py-2.5 text-left font-medium">Account</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ledger (net in)</th>
                  <th className="px-4 py-2.5 text-right font-medium">Bank balance</th>
                  <th className="px-4 py-2.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recon.accounts.map((a: any) => (
                  <tr key={a.account_id} className={`border-t ${rowBorder}`}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{a.name}</div>
                      <div className={`text-xs ${subtle}`}>{[a.institution, a.entity_name].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(a.ledger_net)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(a.bank_balance)}</td>
                    <td className="px-4 py-2 text-right">
                      {!a.has_ledger ? (
                        <span className="text-amber-500 text-xs">No ledger rows</span>
                      ) : (
                        <span className={`text-xs ${subtle}`}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`text-xs mt-2 ${subtle}`}>
            Ledger shows net cash movement recorded for the account; the bank balance is the live figure. A big gap or “no ledger rows” points to a sync hole or an unmapped account.
          </p>
        </section>
      )}

      {/* Duplicates */}
      {review?.duplicates?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Possible duplicates</h2>
          <div className={`rounded-2xl border divide-y rise-in ${card} ${isDark ? "divide-white/5" : "divide-gray-100"}`}>
            {review.duplicates.map((g: any, i: number) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate">{who(g.rows[0])}</span>
                  <span className="tabular-nums text-sm">{money(-g.amount)}</span>
                </div>
                <div className={`text-xs mt-0.5 ${subtle}`}>
                  {shortDate(g.date)} · {g.count}× {g.cross_source && <span className="text-amber-500">· across feeds (likely real)</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Outliers */}
      {review?.outliers?.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Largest items — sanity check</h2>
          <div className={`rounded-2xl border overflow-hidden rise-in ${card}`}>
            <table className="w-full text-sm">
              <tbody>
                {review.outliers.map((t: any) => (
                  <tr key={t.transaction_id} className={`border-t first:border-t-0 ${rowBorder}`}>
                    <td className={`px-4 py-2 whitespace-nowrap ${subtle}`}>{shortDate(t.date)}</td>
                    <td className="px-4 py-2 truncate max-w-[240px]">{who(t)}</td>
                    <td className={`px-4 py-2 text-xs ${subtle}`}>{(t.book_category ?? "Uncategorized").replace(/^\d{4}\s+/, "")}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{money(-t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
