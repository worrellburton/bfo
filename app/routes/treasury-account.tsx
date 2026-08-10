import { Link, useNavigate, useParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Account" }];
}

type Account = {
  item_id: string;
  institution_name: string;
  institution_color: string | null;
  institution_logo: string | null;
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  balance_available: number | null;
  currency: string | null;
  change: number | null;
  change_since: string | null;
  nickname: string | null;
  hidden: boolean;
};

type Txn = {
  date: string;
  name: string;
  description: string;
  category: string | null;
  amount: number;
  pending: boolean;
  currency: string | null;
};

const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

const signed = (n: number, currency = "USD") =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n))}`;

function tint(hex: string | null): string {
  const fallback = "99, 102, 241";
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export default function TreasuryAccount() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<"online" | "reconnect" | "offline">("online");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnState, setTxnState] = useState<"loading" | "idle" | "error">("loading");
  const [txnError, setTxnError] = useState("");
  const [search, setSearch] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/plaid/data?report=treasury");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn't load the account.");
        const found = (data.accounts ?? []).find((a: Account) => a.account_id === accountId);
        if (!found) throw new Error("That account isn't connected any more.");
        setAccount(found);
        setStatus(
          (data.connections ?? []).find((c: any) => c.item_id === found.item_id)?.status ?? "offline"
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load the account.");
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId]);

  useEffect(() => {
    if (!account) return;
    void (async () => {
      setTxnState("loading");
      try {
        const res = await authFetch(
          `/api/plaid/data?report=bank-transactions&item_id=${account.item_id}&account_id=${account.account_id}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data?.message || "Couldn't load transactions.");
        setTxns(data.transactions ?? []);
        setTxnState("idle");
      } catch (err) {
        setTxnError(err instanceof Error ? err.message : "Couldn't load transactions.");
        setTxnState("error");
      }
    })();
  }, [account]);

  useEffect(() => {
    if (editingName) nameInput.current?.focus();
  }, [editingName]);

  async function savePrefs(patch: { nickname?: string; hidden?: boolean }) {
    if (!account) return;
    const res = await authFetch("/api/plaid/account-prefs", {
      method: "POST",
      body: JSON.stringify({ account_id: account.account_id, ...patch }),
    });
    if (!res.ok) {
      setError("Couldn't save that.");
      return;
    }
    setAccount({ ...account, ...("nickname" in patch ? { nickname: patch.nickname || null } : {}), ...("hidden" in patch ? { hidden: !!patch.hidden } : {}) });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q)
    );
  }, [txns, search]);

  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";

  if (loading) return <p className={`text-sm ${subtle}`}>Loading…</p>;
  if (error || !account) {
    return (
      <div>
        <Link to="/treasury" className={`text-sm ${subtle} hover:underline`}>← Treasury</Link>
        <p className={`mt-4 text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>{error}</p>
      </div>
    );
  }

  const rgb = tint(account.institution_color);
  const displayName = account.nickname || account.official_name || account.name;
  const online = status === "online";

  return (
    <div>
      <Link to="/treasury" className={`text-sm ${subtle} hover:underline`}>← Treasury</Link>

      {/* Header card in the bank's colours */}
      <div
        className="treasury-card mt-4 mb-6 cursor-default"
        style={{ ["--bank" as any]: rgb }}
      >
        <div className="treasury-card-sheen" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {account.institution_logo ? (
              <img
                src={`data:image/png;base64,${account.institution_logo}`}
                alt=""
                className="w-10 h-10 rounded-lg object-contain bg-white/90 p-1 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-sm font-bold text-white bg-[rgba(var(--bank),0.55)]">
                {account.institution_name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              {editingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void savePrefs({ nickname: nameDraft });
                    setEditingName(false);
                  }}
                >
                  <input
                    ref={nameInput}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      void savePrefs({ nickname: nameDraft });
                      setEditingName(false);
                    }}
                    maxLength={60}
                    placeholder={account.official_name || account.name}
                    className="bg-transparent border-b border-white/30 focus:border-white/70 focus:outline-none text-white text-xl font-semibold w-full"
                  />
                </form>
              ) : (
                <button
                  onClick={() => {
                    setNameDraft(account.nickname ?? "");
                    setEditingName(true);
                  }}
                  title="Rename this account"
                  className="group flex items-center gap-2 text-left cursor-pointer"
                >
                  <span className="text-white text-xl font-semibold truncate">{displayName}</span>
                  <svg
                    className="w-4 h-4 text-white/40 group-hover:text-white/80 transition-colors shrink-0"
                    fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
              )}
              <p className="text-white/50 text-xs mt-0.5 truncate">
                {account.institution_name}
                {account.mask ? ` ····${account.mask}` : ""} · {account.subtype || account.type}
                {account.nickname && ` · ${account.official_name || account.name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className={online ? "treasury-dot treasury-dot-live" : "treasury-dot treasury-dot-down"} />
              <span className="text-[10px] uppercase tracking-wider text-white/45">
                {online ? "Online" : "Offline"}
              </span>
            </span>
            <button
              onClick={() => {
                void savePrefs({ hidden: !account.hidden });
                if (!account.hidden) navigate("/treasury");
              }}
              className="px-3 py-1.5 rounded-lg text-xs text-white/60 border border-white/15 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              {account.hidden ? "Unhide" : "Hide account"}
            </button>
          </div>
        </div>

        <div className="relative mt-6">
          <p className="text-white text-[34px] font-semibold tracking-tight">
            {money(account.balance_current, account.currency ?? "USD")}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs">
            {account.balance_available != null && (
              <span className="text-white/45">{money(account.balance_available, account.currency ?? "USD")} available</span>
            )}
            {account.change != null && account.change !== 0 && (
              <span className={account.change > 0 ? "text-emerald-300" : "text-rose-300"}>
                {signed(account.change, account.currency ?? "USD")} since last visit
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Transactions</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className={`px-3 py-1.5 rounded-lg text-xs border focus:outline-none w-48 ${
            isDark
              ? "bg-white/[0.04] border-white/10 text-white placeholder-gray-600 focus:border-white/25"
              : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400"
          }`}
        />
      </div>

      <div className={`rounded-xl border overflow-hidden ${card}`}>
        {txnState === "loading" && <p className={`text-sm p-5 ${subtle}`}>Loading transactions…</p>}
        {txnState === "error" && (
          <p className={`text-sm p-5 ${isDark ? "text-red-400" : "text-red-600"}`}>{txnError}</p>
        )}
        {txnState === "idle" && filtered.length === 0 && (
          <p className={`text-sm p-5 ${subtle}`}>No transactions in the last 180 days.</p>
        )}
        {txnState === "idle" && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className={isDark ? "bg-white/[0.03]" : "bg-gray-50"}>
                  {["Date", "Description", "Category", "Amount"].map((h, i) => (
                    <th
                      key={h}
                      className={`text-[11px] uppercase tracking-wider font-medium px-4 py-2.5 ${
                        i === 3 ? "text-right" : "text-left"
                      } ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => (
                  <tr key={`${t.date}-${t.description}-${i}`} className={i % 2 ? (isDark ? "bg-white/[0.015]" : "bg-gray-50/60") : ""}>
                    <td className={`px-4 py-2.5 tabular-nums whitespace-nowrap border-t ${rowBorder} ${subtle}`}>{t.date}</td>
                    <td className={`px-4 py-2.5 border-t ${rowBorder}`}>
                      {t.name}
                      {t.pending && <span className={`ml-2 text-[10px] uppercase tracking-wider ${subtle}`}>pending</span>}
                    </td>
                    <td className={`px-4 py-2.5 border-t ${rowBorder} ${subtle}`}>{t.category ?? "—"}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium border-t ${rowBorder} ${
                        t.amount > 0 ? (isDark ? "text-gray-200" : "text-gray-900") : "text-emerald-400"
                      }`}
                    >
                      {signed(-t.amount, t.currency ?? "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
