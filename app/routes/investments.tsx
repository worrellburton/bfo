import { useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Investments" }];
}

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type Item = { item_id: string; institution_name: string; created_at: string };
type Account = {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  currency: string | null;
};
type Holding = {
  account_id: string;
  ticker: string | null;
  name: string;
  type: string | null;
  quantity: number;
  price: number | null;
  value: number | null;
  cost_basis: number | null;
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
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(n);

const qty = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);

export default function Investments() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [items, setItems] = useState<Item[]>([]);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    if (activeItem) void loadHoldings(activeItem);
  }, [activeItem]);

  async function call(path: string, init?: RequestInit) {
    const res = await authFetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || data?.error || "Request failed.");
    return data;
  }

  async function loadItems() {
    setLoading(true);
    try {
      const data = await call("/api/plaid/data?report=list");
      setItems(data.items ?? []);
      setActiveItem((current) => current ?? data.items?.[0]?.item_id ?? null);
      if (!data.items?.length) {
        setAccounts([]);
        setHoldings([]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load connected accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHoldings(itemId: string) {
    setLoading(true);
    try {
      const data = await call(`/api/plaid/data?report=holdings&item_id=${itemId}`);
      setAccounts(data.accounts ?? []);
      setHoldings(data.holdings ?? []);
      setError("");
    } catch (err) {
      setAccounts([]);
      setHoldings([]);
      setError(err instanceof Error ? err.message : "Couldn't load holdings.");
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setLinking(true);
    setError("");
    try {
      const [{ link_token }] = await Promise.all([
        call("/api/plaid/create-link-token", { method: "POST", body: "{}" }),
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
                institution_name: metadata?.institution?.name ?? "Unknown",
              }),
            });
            await loadItems();
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

  async function disconnect(item: Item) {
    if (!confirm(`Disconnect ${item.institution_name}?`)) return;
    try {
      await call(`/api/plaid/disconnect?item_id=${item.item_id}`, { method: "POST" });
      setActiveItem((current) => (current === item.item_id ? null : current));
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect that account.");
    }
  }

  const total = holdings.reduce((sum, h) => sum + (h.value ?? 0), 0);
  const costBasis = holdings.reduce((sum, h) => sum + (h.cost_basis ?? 0), 0);
  const gain = costBasis > 0 ? total - costBasis : null;

  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Investments</h1>
          <p className={`text-sm mt-1 ${subtle}`}>Brokerage holdings, live from Plaid</p>
        </div>
        <button
          onClick={() => void connect()}
          disabled={linking}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
            isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
          }`}
        >
          {linking ? "Connecting…" : "Connect account"}
        </button>
      </div>

      {error && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {items.map((item) => {
            const active = item.item_id === activeItem;
            return (
              <div
                key={item.item_id}
                className={`flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg border text-xs transition-colors ${
                  active
                    ? isDark ? "border-white/25 bg-white/10 text-white" : "border-gray-400 bg-gray-100 text-gray-900"
                    : isDark ? "border-white/10 text-gray-400" : "border-gray-200 text-gray-500"
                }`}
              >
                <button onClick={() => setActiveItem(item.item_id)} className="cursor-pointer font-medium">
                  {item.institution_name}
                </button>
                <button
                  onClick={() => void disconnect(item)}
                  title="Disconnect"
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    isDark ? "text-gray-600 hover:text-red-400" : "text-gray-400 hover:text-red-600"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {loading && <p className={`text-sm ${subtle}`}>Loading…</p>}

      {!loading && items.length === 0 && (
        <div className={`rounded-xl border p-10 text-center ${card}`}>
          <div className={`mx-auto w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
            <svg className={`w-5 h-5 ${subtle}`} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <p className="text-sm font-medium">No brokerage connected</p>
          <p className={`text-xs mt-1 ${subtle}`}>
            Connect an account to pull balances and holdings straight from the custodian.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            {[
              { label: "Market value", value: money(total) },
              { label: "Cost basis", value: costBasis > 0 ? money(costBasis) : "—" },
              {
                label: "Unrealized gain",
                value: gain == null ? "—" : money(gain),
                tone: gain == null ? "" : gain >= 0 ? "text-emerald-400" : "text-red-400",
              },
            ].map((stat) => (
              <div key={stat.label} className={`rounded-xl border p-5 ${card}`}>
                <p className={`text-xs uppercase tracking-wider ${subtle}`}>{stat.label}</p>
                <p className={`text-2xl font-semibold mt-2 ${stat.tone ?? ""}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          {accounts.length > 0 && (
            <section className={`rounded-xl border mb-6 overflow-hidden ${card}`}>
              <h2 className={`text-sm font-semibold px-5 py-4 border-b ${rowBorder} ${isDark ? "" : "text-gray-900"}`}>
                Accounts
              </h2>
              {accounts.map((account, i) => (
                <div key={account.account_id} className={`flex items-center justify-between gap-4 px-5 py-3.5 ${i > 0 ? `border-t ${rowBorder}` : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{account.official_name || account.name}</p>
                    <p className={`text-xs ${subtle}`}>
                      {[account.type, account.subtype].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="text-sm font-medium shrink-0">
                    {money(account.balance_current, account.currency ?? "USD")}
                  </p>
                </div>
              ))}
            </section>
          )}

          {holdings.length > 0 && (
            <section className={`rounded-xl border overflow-hidden ${card}`}>
              <h2 className={`text-sm font-semibold px-5 py-4 border-b ${rowBorder} ${isDark ? "" : "text-gray-900"}`}>
                Holdings
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`text-xs uppercase tracking-wider ${subtle}`}>
                      <th className="text-left font-medium px-5 py-2.5">Security</th>
                      <th className="text-right font-medium px-5 py-2.5">Qty</th>
                      <th className="text-right font-medium px-5 py-2.5">Price</th>
                      <th className="text-right font-medium px-5 py-2.5">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...holdings]
                      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                      .map((h, i) => (
                        <tr key={`${h.account_id}-${h.ticker ?? h.name}-${i}`} className={`border-t ${rowBorder}`}>
                          <td className="px-5 py-3">
                            <span className="font-medium">{h.ticker || h.name}</span>
                            {h.ticker && <span className={`ml-2 text-xs ${subtle}`}>{h.name}</span>}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">{qty(h.quantity)}</td>
                          <td className="px-5 py-3 text-right tabular-nums">{money(h.price)}</td>
                          <td className="px-5 py-3 text-right tabular-nums font-medium">{money(h.value)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!loading && holdings.length === 0 && accounts.length === 0 && (
            <p className={`text-sm ${subtle}`}>No holdings returned for this connection.</p>
          )}
        </>
      )}
    </div>
  );
}
