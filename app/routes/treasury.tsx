import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Treasury" }];
}

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type Connection = {
  item_id: string;
  institution_name: string;
  institution_color: string | null;
  institution_logo: string | null;
  status: "online" | "reconnect" | "offline";
  message?: string;
};

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

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (publicToken: string, metadata: any) => void;
        onExit: (err: any) => void;
      }): { open: () => void };
    };
  }
}

function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Couldn't load Plaid.")));
      return;
    }
    const script = document.createElement("script");
    script.src = PLAID_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Plaid."));
    document.head.appendChild(script);
  });
}

const money = (n: number | null | undefined, currency = "USD") =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

const signed = (n: number, currency = "USD") =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Math.abs(n))}`;

function sinceLabel(iso: string | null): string {
  if (!iso) return "";
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "since earlier today";
  if (hours < 24) return `since ${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "since yesterday" : `since ${days}d ago`;
}

/** Parse Plaid's brand hex into an rgb triplet we can tint a glass card with. */
function tint(hex: string | null): string {
  const fallback = "99, 102, 241"; // indigo, for banks with no brand colour
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export default function Treasury() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  const [open, setOpen] = useState<Account | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnState, setTxnState] = useState<"idle" | "loading" | "error">("idle");
  const [txnError, setTxnError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (open) void loadTxns(open);
  }, [open]);

  async function call(path: string, init?: RequestInit) {
    const res = await authFetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || data?.error || "Request failed.");
    return data;
  }

  async function load() {
    setLoading(true);
    try {
      const data = await call("/api/plaid/data?report=treasury");
      setConnections(data.connections ?? []);
      setAccounts(data.accounts ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTxns(account: Account) {
    setTxnState("loading");
    setTxnError("");
    setTxns([]);
    setSearch("");
    try {
      const data = await call(
        `/api/plaid/data?report=bank-transactions&item_id=${account.item_id}&account_id=${account.account_id}`
      );
      if (data.error) throw new Error(data.message ?? data.error);
      setTxns(data.transactions ?? []);
      setTxnState("idle");
    } catch (err) {
      setTxnError(err instanceof Error ? err.message : "Couldn't load transactions.");
      setTxnState("error");
    }
  }

  async function connect() {
    setLinking(true);
    setError("");
    try {
      const [{ link_token }] = await Promise.all([
        call("/api/plaid/create-link-token", {
          method: "POST",
          body: JSON.stringify({ kind: "bank" }),
        }),
        loadPlaid(),
      ]);
      if (!window.Plaid) throw new Error("Couldn't load Plaid.");

      window.Plaid.create({
        token: link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            await call("/api/plaid/exchange-token", {
              method: "POST",
              body: JSON.stringify({
                public_token: publicToken,
                kind: "bank",
                institution_name: metadata?.institution?.name ?? "Unknown",
                institution_id: metadata?.institution?.institution_id ?? null,
              }),
            });
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't finish connecting.");
          } finally {
            setLinking(false);
          }
        },
        onExit: (err) => {
          setLinking(false);
          if (err) setError(err.display_message || err.error_message || "Connection cancelled.");
        },
      }).open();
    } catch (err) {
      setLinking(false);
      setError(err instanceof Error ? err.message : "Couldn't start Plaid.");
    }
  }

  async function disconnect(conn: Connection) {
    if (!confirm(`Disconnect ${conn.institution_name}?`)) return;
    try {
      await call(`/api/plaid/disconnect?item_id=${conn.item_id}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect.");
    }
  }

  const cash = accounts
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
  const credit = accounts
    .filter((a) => a.type === "credit")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
  const movement = accounts.reduce((sum, a) => sum + (a.change ?? 0), 0);

  const statusFor = (itemId: string) =>
    connections.find((c) => c.item_id === itemId)?.status ?? "offline";

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

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Treasury</h1>
          <p className={`text-sm mt-1 ${subtle}`}>Bank accounts, balances and history</p>
        </div>
        <button
          onClick={() => void connect()}
          disabled={linking}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
            isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
          }`}
        >
          {linking ? "Connecting…" : "Connect bank"}
        </button>
      </div>

      {error && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {connections.some((c) => c.status !== "online") && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-800"}`}>
          {connections
            .filter((c) => c.status !== "online")
            .map((c) => c.institution_name)
            .join(", ")}{" "}
          need reconnecting — sign in again through Connect bank to refresh the link.
        </div>
      )}

      {!loading && accounts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3 mb-8">
          {[
            { label: "Cash", value: money(cash) },
            { label: "Credit balances", value: money(credit) },
            {
              label: "Change since last visit",
              value: movement === 0 ? "—" : signed(movement),
              tone: movement === 0 ? "" : movement > 0 ? "text-emerald-400" : "text-red-400",
            },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-xl border p-5 ${card}`}>
              <p className={`text-xs uppercase tracking-wider ${subtle}`}>{stat.label}</p>
              <p className={`text-2xl font-semibold mt-2 ${stat.tone ?? ""}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading && <p className={`text-sm ${subtle}`}>Loading…</p>}

      {!loading && accounts.length === 0 && (
        <div className={`rounded-xl border p-10 text-center ${card}`}>
          <div className={`mx-auto w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
            <svg className={`w-5 h-5 ${subtle}`} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          </div>
          <p className="text-sm font-medium">No bank accounts connected</p>
          <p className={`text-xs mt-1 ${subtle}`}>
            Connect a bank to see live balances and transaction history.
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const rgb = tint(account.institution_color);
          const online = statusFor(account.item_id) === "online";
          return (
            <button
              key={account.account_id}
              onClick={() => setOpen(account)}
              className="treasury-card group text-left"
              style={{ ["--bank" as any]: rgb }}
            >
              <div className="treasury-card-sheen" aria-hidden />

              <div className="relative flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {account.institution_logo ? (
                    <img
                      src={`data:image/png;base64,${account.institution_logo}`}
                      alt=""
                      className="w-7 h-7 rounded-md object-contain bg-white/90 p-0.5 shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-[11px] font-bold text-white bg-[rgba(var(--bank),0.55)]">
                      {account.institution_name.slice(0, 1)}
                    </div>
                  )}
                  <span className="text-[13px] font-medium text-white/85 truncate">
                    {account.institution_name}
                  </span>
                </div>

                <span className="flex items-center gap-1.5 shrink-0" title={online ? "Live" : "Needs reconnecting"}>
                  <span className={online ? "treasury-dot treasury-dot-live" : "treasury-dot treasury-dot-down"} />
                  <span className="text-[10px] uppercase tracking-wider text-white/45">
                    {online ? "Online" : "Offline"}
                  </span>
                </span>
              </div>

              <div className="relative mt-6">
                <p className="text-white/55 text-xs truncate">
                  {account.official_name || account.name}
                  {account.mask ? ` ····${account.mask}` : ""}
                </p>
                <p className="text-white text-[27px] font-semibold tracking-tight mt-1">
                  {money(account.balance_current, account.currency ?? "USD")}
                </p>

                <div className="flex items-center gap-2 mt-1.5 h-4">
                  {account.change != null && account.change !== 0 ? (
                    <>
                      <span
                        className={`text-xs font-medium ${
                          account.change > 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {signed(account.change, account.currency ?? "USD")}
                      </span>
                      <span className="text-[11px] text-white/35">{sinceLabel(account.change_since)}</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-white/30">No change since last visit</span>
                  )}
                </div>
              </div>

              <div className="relative mt-5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-white/35">
                  {account.subtype || account.type}
                </span>
                <span className="text-[11px] text-white/45 opacity-0 group-hover:opacity-100 transition-opacity">
                  View transactions →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {connections.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-6">
          {connections.map((conn) => (
            <button
              key={conn.item_id}
              onClick={() => void disconnect(conn)}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                isDark
                  ? "border-white/10 text-gray-500 hover:text-red-400 hover:border-red-400/30"
                  : "border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300"
              }`}
            >
              Disconnect {conn.institution_name}
            </button>
          ))}
        </div>
      )}

      {/* Spreadsheet drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(null)} />
          <div
            className={`relative ml-auto h-full w-full max-w-4xl shadow-2xl flex flex-col ${
              isDark ? "bg-[#0b0b0b] border-l border-white/10" : "bg-white border-l border-gray-200"
            }`}
          >
            <div className={`flex items-center justify-between gap-4 px-6 py-4 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">
                  {open.official_name || open.name}
                  {open.mask ? ` ····${open.mask}` : ""}
                </h2>
                <p className={`text-xs ${subtle}`}>
                  {open.institution_name} · {money(open.balance_current, open.currency ?? "USD")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter…"
                  className={`px-3 py-1.5 rounded-lg text-xs border focus:outline-none ${
                    isDark
                      ? "bg-white/[0.04] border-white/10 text-white placeholder-gray-600 focus:border-white/25"
                      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400"
                  }`}
                />
                <button
                  onClick={() => setOpen(null)}
                  className={`p-1.5 rounded-lg cursor-pointer ${isDark ? "hover:bg-white/10 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {txnState === "loading" && <p className={`text-sm p-6 ${subtle}`}>Loading transactions…</p>}
              {txnState === "error" && (
                <p className={`text-sm p-6 ${isDark ? "text-red-400" : "text-red-600"}`}>{txnError}</p>
              )}
              {txnState === "idle" && filtered.length === 0 && (
                <p className={`text-sm p-6 ${subtle}`}>No transactions in the last 180 days.</p>
              )}
              {txnState === "idle" && filtered.length > 0 && (
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className={isDark ? "bg-[#141414]" : "bg-gray-50"}>
                      {["Date", "Description", "Category", "Amount"].map((h, i) => (
                        <th
                          key={h}
                          className={`text-[11px] uppercase tracking-wider font-medium px-4 py-2.5 border-b ${
                            i === 3 ? "text-right" : "text-left"
                          } ${isDark ? "border-white/10 text-gray-400" : "border-gray-200 text-gray-500"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => (
                      <tr
                        key={`${t.date}-${t.description}-${i}`}
                        className={
                          i % 2
                            ? isDark ? "bg-white/[0.015]" : "bg-gray-50/60"
                            : ""
                        }
                      >
                        <td className={`px-4 py-2 tabular-nums whitespace-nowrap border-b ${isDark ? "border-white/5 text-gray-400" : "border-gray-100 text-gray-500"}`}>
                          {t.date}
                        </td>
                        <td className={`px-4 py-2 border-b ${isDark ? "border-white/5" : "border-gray-100"}`}>
                          {t.name}
                          {t.pending && (
                            <span className={`ml-2 text-[10px] uppercase tracking-wider ${subtle}`}>pending</span>
                          )}
                        </td>
                        <td className={`px-4 py-2 border-b ${isDark ? "border-white/5 text-gray-400" : "border-gray-100 text-gray-500"}`}>
                          {t.category ?? "—"}
                        </td>
                        {/* Plaid signs outflows positive; flip so money out reads negative. */}
                        <td
                          className={`px-4 py-2 text-right tabular-nums whitespace-nowrap font-medium border-b ${
                            isDark ? "border-white/5" : "border-gray-100"
                          } ${t.amount > 0 ? (isDark ? "text-gray-200" : "text-gray-900") : "text-emerald-400"}`}
                        >
                          {signed(-t.amount, t.currency ?? "USD")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
