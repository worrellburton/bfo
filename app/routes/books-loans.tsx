import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";
import { TxnTable, money, type Txn } from "../books-shared";

export function meta() {
  return [{ title: "BFO - Books · Loans" }];
}

type Loan = {
  id: string | null;
  name: string;
  show_on_report: boolean;
  starting_balance: number;
  advanced: number;
  repaid: number;
  outstanding: number;
  first_date: string | null;
  last_date: string | null;
  transactions: Txn[];
};

/**
 * Search-and-attach: find any synced transaction and connect it to a loan.
 * Results come from the same transactions report the Transactions page uses.
 */
function TxnFinder({
  loanId,
  attached,
  isDark,
  onAttached,
  onError,
}: {
  loanId: string;
  attached: Set<string>;
  isDark: boolean;
  onAttached: () => void;
  onError: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Txn[]>([]);
  const [searching, setSearching] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const res = await authFetch(
            `/api/books/data?report=transactions&limit=25&q=${encodeURIComponent(q.trim())}`
          );
          const data = await res.json().catch(() => ({}));
          if (res.ok) setResults((data.transactions ?? []).filter((r: Txn) => !attached.has(r.transaction_id)));
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [q, attached]);

  async function attach(t: Txn) {
    setAttaching(t.transaction_id);
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ transaction_id: t.transaction_id, loan_id: loanId }),
      });
      if (!res.ok) throw new Error("Couldn't attach that transaction.");
      setResults((prev) => prev.filter((r) => r.transaction_id !== t.transaction_id));
      onAttached();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't attach that transaction.");
    } finally {
      setAttaching(null);
    }
  }

  const subtle = "text-gray-500";
  return (
    <div className="min-w-0 flex-1">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find transactions to attach — search any description…"
        className={`w-full max-w-md px-3 py-2 rounded-lg text-sm border ${
          isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
        }`}
      />
      {q.trim() && (
        <div className={`mt-2 rounded-lg border overflow-hidden ${isDark ? "border-white/10" : "border-gray-200"}`}>
          {searching && results.length === 0 ? (
            <p className={`px-3 py-2.5 text-xs ${subtle}`}>Searching…</p>
          ) : results.length === 0 ? (
            <p className={`px-3 py-2.5 text-xs ${subtle}`}>No matches (already-attached rows are hidden).</p>
          ) : (
            results.map((t) => (
              <div
                key={t.transaction_id}
                className={`flex items-center gap-3 px-3 py-2 border-t first:border-t-0 text-sm ${
                  isDark ? "border-white/5" : "border-gray-100"
                }`}
              >
                <span className={`tabular-nums text-xs whitespace-nowrap ${subtle}`}>{t.date}</span>
                <span className="truncate flex-1 min-w-0">
                  {t.merchant_name || t.name || "—"}
                  {t.loan_id && (
                    <span className={`ml-2 text-[10px] uppercase tracking-wider ${subtle}`}>on another loan</span>
                  )}
                </span>
                <span className={`text-xs whitespace-nowrap ${subtle}`}>{t.entity_name ?? "Unmapped"}</span>
                <span className={`tabular-nums whitespace-nowrap font-medium ${t.amount < 0 ? "text-emerald-500" : ""}`}>
                  {t.amount < 0 ? `+${money(-t.amount)}` : money(t.amount)}
                </span>
                <button
                  onClick={() => void attach(t)}
                  disabled={attaching === t.transaction_id}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer disabled:opacity-50 ${
                    isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
                  }`}
                >
                  {attaching === t.transaction_id ? "…" : "Attach"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Money the family is owed: each loan with its starting balance, tracked
 * advances and repayments, and the transactions behind it.
 */
export default function BooksLoans() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [loans, setLoans] = useState<Loan[]>([]);
  const [rules, setRules] = useState<Array<{ id: string; match: string; loan_id: string | null }>>([]);
  const [ruleDraft, setRuleDraft] = useState<Record<string, string>>({});
  const [registry, setRegistry] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [balanceDraft, setBalanceDraft] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [loansRes, metaRes] = await Promise.all([
        authFetch("/api/books/data?report=loans"),
        authFetch("/api/books/data?report=meta"),
      ]);
      const loansData = await loansRes.json().catch(() => ({}));
      if (!loansRes.ok) throw new Error(loansData?.message || "Couldn't load loans.");
      setLoans(loansData.loans ?? []);
      setRules(loansData.rules ?? []);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        setRegistry(meta.loans ?? []);
        setCategories(meta.categories ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load loans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || "That didn't save.");
    return data;
  }

  async function createLoan(name: string, startingBalance: number) {
    setSaving(true);
    setError("");
    try {
      await post({ action: "create_loan", name, starting_balance: startingBalance });
      setAdding(false);
      setNewName("");
      setNewBalance("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that loan.");
    } finally {
      setSaving(false);
    }
  }

  async function saveBalance(loan: Loan) {
    const n = Number(balanceDraft.replace(/[$,]/g, ""));
    if (!Number.isFinite(n)) {
      setError("Enter a number for the starting balance.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (loan.id) {
        await post({ action: "update_loan", loan_id: loan.id, starting_balance: n });
      } else {
        // An implicit (category-only) loan becomes registered the moment it
        // needs a starting balance.
        await post({ action: "create_loan", name: loan.name, starting_balance: n });
      }
      setEditingBalance(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that balance.");
    } finally {
      setSaving(false);
    }
  }

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const field = `px-3 py-2 rounded-lg text-sm border ${
    isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
  }`;

  const totalOutstanding = loans.reduce((s, l) => s + l.outstanding, 0);

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Loans</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Money the family is owed. Link transactions from any table's detail panel, or give a
            transaction the category “Name (loan)”. Balances ride into the Treasury report.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
          }`}
        >
          {adding ? "Cancel" : "Add loan"}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void createLoan(newName.trim(), Number(newBalance.replace(/[$,]/g, "")) || 0);
          }}
          className={`rounded-xl border p-4 mb-6 flex flex-wrap items-end gap-3 ${card}`}
        >
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wider min-w-[220px]">
            <span className={subtle}>Who owes it</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Seven Arrows Recovery"
              className={`${field} normal-case tracking-normal`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wider min-w-[180px]">
            <span className={subtle}>Starting balance</span>
            <input
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              inputMode="decimal"
              placeholder="$0"
              className={`${field} normal-case tracking-normal`}
            />
          </label>
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
            }`}
          >
            {saving ? "Saving…" : "Create loan"}
          </button>
          <p className={`text-xs w-full ${subtle}`}>
            Starting balance covers anything lent before the transaction history begins — tracked
            advances and repayments move it from there.
          </p>
        </form>
      )}

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {!loading && loans.length > 0 && (
        <div className={`rounded-xl border p-5 mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 ${card}`}>
          <div>
            <p className={`text-[11px] uppercase tracking-wider ${subtle}`}>Outstanding across {loans.length} loan{loans.length === 1 ? "" : "s"}</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{money(totalOutstanding)}</p>
          </div>
          <div className={`text-sm ${subtle}`}>
            Advanced {money(loans.reduce((s, l) => s + l.advanced, 0))} · Starting{" "}
            {money(loans.reduce((s, l) => s + l.starting_balance, 0))}
          </div>
        </div>
      )}

      {loading ? (
        <p className={`text-sm ${subtle}`}>Loading…</p>
      ) : loans.length === 0 ? (
        <div className={`rounded-xl border p-10 text-center ${card}`}>
          <p className="text-sm font-medium">No loans yet</p>
          <p className={`text-xs mt-1 ${subtle}`}>
            Add one above, or set a transaction's category to “Name (loan)” and it shows up here.
          </p>
        </div>
      ) : (
        loans.map((loan) => {
          const key = loan.id ?? loan.name;
          const isOpen = open.has(key);
          return (
            <section key={key} className={`rounded-xl border mb-4 overflow-hidden ${card}`}>
              <button
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    next.has(key) ? next.delete(key) : next.add(key);
                    return next;
                  })
                }
                aria-expanded={isOpen}
                className={`w-full flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-left cursor-pointer ${
                  isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"
                }`}
              >
                <svg
                  className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""} ${subtle}`}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {loan.name}
                    {!loan.id && (
                      <span className={`ml-2 text-[10px] uppercase tracking-wider font-normal ${subtle}`}>
                        from categories
                      </span>
                    )}
                  </p>
                  <p className={`text-xs mt-0.5 ${subtle}`}>
                    {loan.transactions.length} transaction{loan.transactions.length === 1 ? "" : "s"}
                    {loan.last_date && ` · last activity ${loan.last_date}`}
                  </p>
                </div>
                <div className={`flex gap-6 text-sm tabular-nums ${subtle}`}>
                  <span>Start {money(loan.starting_balance)}</span>
                  <span>Advanced {money(loan.advanced)}</span>
                </div>
                <span className="text-lg font-semibold tabular-nums shrink-0">{money(loan.outstanding)}</span>
              </button>

              {isOpen && (
                <div className={`border-t ${rowBorder}`}>
                  {loan.id && (
                    <div className="px-5 pt-3">
                      <TxnFinder
                        loanId={loan.id}
                        attached={new Set(loan.transactions.map((t) => t.transaction_id))}
                        isDark={isDark}
                        onAttached={() => void load()}
                        onError={setError}
                      />
                    </div>
                  )}
                  {loan.id && (
                    <div className="px-5 pt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <label className={`flex items-center gap-2 text-xs cursor-pointer ${subtle}`}>
                        <input
                          type="checkbox"
                          checked={loan.show_on_report}
                          onChange={async (e) => {
                            try {
                              await post({ action: "update_loan", loan_id: loan.id, show_on_report: e.target.checked });
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Couldn't save that.");
                            }
                          }}
                        />
                        Show on Treasury report
                      </label>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const draft = (ruleDraft[key] ?? "").trim();
                          if (draft.length < 3) {
                            setError("Rule text needs at least 3 characters.");
                            return;
                          }
                          void (async () => {
                            try {
                              const out = await post({ action: "loan_rule", loan_id: loan.id, match: draft });
                              setRuleDraft((prev) => ({ ...prev, [key]: "" }));
                              await load();
                              if (out.attached) setError("");
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Couldn't save that rule.");
                            }
                          })();
                        }}
                        className="flex items-center gap-2"
                      >
                        <span className={`text-xs ${subtle}`}>Auto-attach descriptions containing</span>
                        <input
                          value={ruleDraft[key] ?? ""}
                          onChange={(e) => setRuleDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder="VISIONQUEST"
                          className={`${field} w-44 py-1.5 text-xs`}
                        />
                        <button
                          type="submit"
                          disabled={saving || (ruleDraft[key] ?? "").trim().length < 3}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50 ${
                            isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
                          }`}
                        >
                          Save rule
                        </button>
                      </form>

                      {rules
                        .filter((r) => r.loan_id === loan.id)
                        .map((r) => (
                          <span
                            key={r.id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                              isDark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            “{r.match}”
                            <button
                              onClick={() => {
                                void (async () => {
                                  try {
                                    await post({ action: "delete_rule", rule_id: r.id });
                                    await load();
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : "Couldn't remove that rule.");
                                  }
                                })();
                              }}
                              title="Remove rule"
                              className={`cursor-pointer ${subtle} hover:text-red-400`}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                    </div>
                  )}
                  <div className="px-5 py-3 flex flex-wrap items-center gap-3">
                    {editingBalance === key ? (
                      <>
                        <input
                          autoFocus
                          value={balanceDraft}
                          onChange={(e) => setBalanceDraft(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void saveBalance(loan)}
                          inputMode="decimal"
                          className={`${field} w-36`}
                        />
                        <button
                          onClick={() => void saveBalance(loan)}
                          disabled={saving}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                            isDark ? "bg-white/10 text-white" : "bg-gray-900 text-white"
                          }`}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingBalance(null)}
                          className={`text-xs cursor-pointer ${subtle}`}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingBalance(key);
                          setBalanceDraft(String(loan.starting_balance || ""));
                        }}
                        className={`text-xs underline cursor-pointer ${subtle} hover:no-underline`}
                      >
                        {loan.id ? "Edit starting balance" : "Set starting balance"}
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <TxnTable
                      rows={loan.transactions}
                      categories={categories}
                      loans={registry}
                      isDark={isDark}
                      onRowChange={() => void load()}
                      onError={setError}
                      onReload={() => void load()}
                    />
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
