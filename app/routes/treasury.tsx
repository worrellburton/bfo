import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
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
  created_at?: string | null;
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
  nickname: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
  last_activity: string | null;
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

/** Account name plus its mask — without repeating a mask the name carries. */
function accountLabel(a: Account): string {
  const base = a.nickname || a.official_name || a.name || "Account";
  if (!a.mask) return base;
  return base.includes(a.mask) ? base : `${base} ····${a.mask}`;
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
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("bfo-treasury-view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  function setView(next: "grid" | "list") {
    setViewState(next);
    try {
      localStorage.setItem("bfo-treasury-view", next);
    } catch {}
  }
  const [error, setError] = useState("");

  const [showHidden, setShowHidden] = useState(false);

  // Which entity sections are folded away, remembered between visits.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("bfo-treasury-collapsed") ?? "[]"));
    } catch {
      return new Set();
    }
  });

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try {
        localStorage.setItem("bfo-treasury-collapsed", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    void load();
  }, []);

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

  async function setHidden(account: Account, hidden: boolean) {
    try {
      await call("/api/plaid/account-prefs", {
        method: "POST",
        body: JSON.stringify({ account_id: account.account_id, hidden }),
      });
      setAccounts((prev) =>
        prev.map((a) => (a.account_id === account.account_id ? { ...a, hidden } : a))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that account.");
    }
  }

  /**
   * Reopen the bank's own account picker for an existing connection. Accounts
   * closed at the bank (or simply deselected here) stop being shared, and the
   * data they left behind is pruned afterwards.
   */
  async function refreshConnection(conn: Connection) {
    setLinking(true);
    setError("");
    try {
      const [{ link_token }] = await Promise.all([
        call("/api/plaid/create-link-token", {
          method: "POST",
          body: JSON.stringify({ kind: "bank", item_id: conn.item_id }),
        }),
        loadPlaid(),
      ]);
      if (!window.Plaid) throw new Error("Couldn't load Plaid.");

      window.Plaid.create({
        token: link_token,
        // Update mode returns no new public token to exchange — the existing
        // connection is simply re-scoped to the accounts still selected.
        onSuccess: async () => {
          try {
            await call("/api/plaid/prune-accounts", { method: "POST", body: "{}" });
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Refreshed, but couldn't tidy up old accounts.");
          } finally {
            setLinking(false);
          }
        },
        onExit: (err) => {
          setLinking(false);
          if (err) setError(err.display_message || err.error_message || "Refresh cancelled.");
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
      await call("/api/plaid/prune-accounts", { method: "POST", body: "{}" }).catch(() => {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect.");
    }
  }

  const hiddenCount = accounts.filter((a) => a.hidden).length;
  const visible = accounts
    .filter((a) => showHidden || !a.hidden)
    .sort(
      (a, b) =>
        a.institution_name.localeCompare(b.institution_name) ||
        (b.balance_current ?? 0) - (a.balance_current ?? 0)
    );

  // Accounts belong to entities — group them that way. Entities sort by what
  // they hold; anything still unmapped collects at the bottom.
  const entityGroups = (() => {
    const map = new Map<string, { key: string; name: string; accounts: Account[]; total: number }>();
    for (const a of visible) {
      const key = a.entity_id ?? "__unmapped__";
      const group = map.get(key) ?? {
        key,
        name: a.entity_name ?? "Unmapped",
        accounts: [] as Account[],
        total: 0,
      };
      group.accounts.push(a);
      // Cards are a liability, so they pull the entity's total down.
      group.total += (a.type === "credit" ? -1 : 1) * (a.balance_current ?? 0);
      map.set(key, group);
    }
    for (const group of map.values()) {
      group.accounts.sort((a, b) => (b.balance_current ?? 0) - (a.balance_current ?? 0));
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === "__unmapped__") return 1;
      if (b.key === "__unmapped__") return -1;
      return b.total - a.total;
    });
  })();

  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );

  const GroupHeader = ({ group }: { group: (typeof entityGroups)[number] }) => {
    const unmapped = group.key === "__unmapped__";
    const open = !collapsed.has(group.key);
    return (
      <div className="flex items-center justify-between gap-4 mb-3">
        <button
          onClick={() => toggleGroup(group.key)}
          aria-expanded={open}
          className={`flex items-center gap-2 min-w-0 text-sm font-semibold cursor-pointer transition-colors ${
            unmapped ? "text-amber-500" : isDark ? "text-white hover:text-white/70" : "text-gray-900 hover:text-gray-600"
          }`}
        >
          <Chevron open={open} />
          <span className="truncate">{group.name}</span>
          <span className={`text-xs font-normal shrink-0 ${subtle}`}>
            {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
          </span>
        </button>
        <span className="text-sm font-semibold tabular-nums shrink-0">{money(group.total)}</span>
      </div>
    );
  };

  const cash = visible
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
  const credit = visible
    .filter((a) => a.type === "credit")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
  const invested = visible
    .filter((a) => a.type === "investment")
    .reduce((sum, a) => sum + (a.balance_current ?? 0), 0);
  const movement = visible.reduce((sum, a) => sum + (a.change ?? 0), 0);

  const statusFor = (itemId: string) =>
    connections.find((c) => c.item_id === itemId)?.status ?? "offline";

  const DORMANT_DAYS = 90;

  /**
   * A live bank connection says nothing about whether one of its accounts is
   * still open — a closed account keeps being shared until it's deselected at
   * the bank. So an empty account with no recent movement reads as dormant,
   * not "online".
   */
  function accountState(account: Account): { label: string; tone: "live" | "dormant" | "down" } {
    if (statusFor(account.item_id) !== "online") return { label: "Offline", tone: "down" };
    const empty = Math.abs(account.balance_current ?? 0) < 0.005;
    if (!empty) return { label: "Online", tone: "live" };
    const days = account.last_activity
      ? (Date.now() - new Date(`${account.last_activity}T12:00:00Z`).getTime()) / 86_400_000
      : Infinity;
    if (days > DORMANT_DAYS) {
      return { label: account.last_activity ? "Dormant" : "No activity", tone: "dormant" };
    }
    return { label: "Online", tone: "live" };
  }

  const dormant = visible.filter((a) => accountState(a).tone === "dormant" && !a.hidden);

  async function hideDormant() {
    if (
      !confirm(
        `Hide ${dormant.length} empty account${dormant.length === 1 ? "" : "s"} with no activity in ${DORMANT_DAYS} days?\n\n` +
          "They stay out of Treasury totals and the report. To remove them for good, use Refresh and deselect them at the bank."
      )
    ) {
      return;
    }
    try {
      for (const account of dormant) {
        await call("/api/plaid/account-prefs", {
          method: "POST",
          body: JSON.stringify({ account_id: account.account_id, hidden: true }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't hide those accounts.");
    }
  }

  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Treasury</h1>
          <p className={`text-sm mt-1 ${subtle}`}>Bank accounts, balances and history</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate("/treasury/mappings")}
            title="Map accounts to entities"
            className={`px-3 py-2 rounded-lg border text-sm transition-colors cursor-pointer ${
              isDark
                ? "border-white/10 text-gray-400 hover:text-white hover:border-white/25"
                : "border-gray-200 text-gray-500 hover:text-black hover:border-gray-400"
            }`}
          >
            Mappings
          </button>
          <div className={`flex rounded-lg border p-0.5 ${isDark ? "border-white/10" : "border-gray-200"}`}>
            {([
              ["grid", "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"],
              ["list", "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"],
            ] as const).map(([value, d]) => (
              <button
                key={value}
                onClick={() => setView(value)}
                title={value === "grid" ? "Grid view" : "List view"}
                aria-pressed={view === value}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  view === value
                    ? isDark ? "bg-white/10 text-white" : "bg-black/5 text-black"
                    : isDark ? "text-gray-500 hover:text-white" : "text-gray-400 hover:text-black"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={d} />
                </svg>
              </button>
            ))}
          </div>
          <button
            onClick={() => void connect()}
            disabled={linking}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
            }`}
          >
            {linking ? "Connecting…" : "Connect bank"}
          </button>
        </div>
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

      {!loading && accounts.length > 0 && (() => {
        const total = cash + invested;
        const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0;
        const investPct = total > 0 ? 100 - cashPct : 0;
        const entityCount = entityGroups.filter((g) => g.key !== "__unmapped__").length;
        const stat = (label: string, value: string, dot?: string, pct?: number) => (
          <div className="min-w-0">
            <p className={`text-[11px] uppercase tracking-wider flex items-center gap-1.5 ${subtle}`}>
              {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
              {label}
            </p>
            <p className="text-lg font-semibold mt-1 tabular-nums truncate">
              {value}
              {pct != null && total > 0 && (
                <span className={`ml-1.5 text-xs font-normal ${subtle}`}>{pct}%</span>
              )}
            </p>
          </div>
        );

        return (
          <div className={`rounded-2xl border mb-8 overflow-hidden ${card}`}>
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className={`text-[11px] uppercase tracking-[0.16em] ${subtle}`}>Total value</p>
                  <p className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1.5 tabular-nums">
                    {money(total)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      movement === 0
                        ? isDark
                          ? "bg-white/[0.06] text-gray-400"
                          : "bg-gray-100 text-gray-600"
                        : movement > 0
                          ? isDark
                            ? "bg-emerald-500/12 text-emerald-400"
                            : "bg-emerald-50 text-emerald-700"
                          : isDark
                            ? "bg-rose-500/12 text-rose-400"
                            : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {movement !== 0 && <span>{movement > 0 ? "▲" : "▼"}</span>}
                    {movement === 0 ? "No change" : signed(movement)}
                    <span className="opacity-60 font-normal">since last visit</span>
                  </span>
                </div>
              </div>

              {total > 0 && (
                <div
                  className={`flex h-2 rounded-full overflow-hidden mt-5 ${isDark ? "bg-white/[0.06]" : "bg-gray-100"}`}
                  role="img"
                  aria-label={`Cash ${cashPct}%, invested ${investPct}%`}
                >
                  <div style={{ width: `${cashPct}%`, background: "#38bdf8" }} />
                  <div style={{ width: `${investPct}%`, background: "#34d399" }} />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 mt-5">
                {stat("Cash", money(cash), "#38bdf8", cashPct)}
                {stat("Invested", invested > 0 ? money(invested) : "—", "#34d399", investPct)}
                {stat("Credit owed", credit > 0 ? money(credit) : "—")}
                {stat(
                  "Accounts",
                  `${visible.length}`,
                  undefined
                )}
              </div>
            </div>

            <div
              className={`px-6 sm:px-7 py-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 border-t ${
                isDark ? "border-white/[0.07] bg-white/[0.02] text-gray-500" : "border-gray-100 bg-gray-50/60 text-gray-500"
              }`}
            >
              <span>
                {entityCount} {entityCount === 1 ? "entity" : "entities"}
              </span>
              <span className={isDark ? "text-white/15" : "text-gray-300"}>·</span>
              <span>
                {connections.length} bank {connections.length === 1 ? "connection" : "connections"}
              </span>
              {dormant.length > 0 && (
                <>
                  <span className={isDark ? "text-white/15" : "text-gray-300"}>·</span>
                  <button
                    onClick={() => void hideDormant()}
                    className="text-amber-500 hover:underline cursor-pointer"
                  >
                    {dormant.length} dormant
                  </button>
                </>
              )}
              {entityGroups.some((g) => g.key === "__unmapped__") && (
                <>
                  <span className={isDark ? "text-white/15" : "text-gray-300"}>·</span>
                  <button
                    onClick={() => navigate("/treasury/mappings")}
                    className="text-amber-500 hover:underline cursor-pointer"
                  >
                    {entityGroups.find((g) => g.key === "__unmapped__")!.accounts.length} unmapped
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

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

      {view === "grid" && entityGroups.map((group) => (
      <section key={group.key} className="mb-8 last:mb-0">
        <GroupHeader group={group} />
        {!collapsed.has(group.key) && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {group.accounts.map((account) => {
          const rgb = tint(account.institution_color);
          const state = accountState(account);
          return (
            <button
              key={account.account_id}
              onClick={() => navigate(`/treasury/${account.account_id}`)}
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

                <span
                  className="flex items-center gap-1.5 shrink-0"
                  title={
                    state.tone === "live"
                      ? "Live"
                      : state.tone === "down"
                        ? "Needs reconnecting"
                        : `Empty, no activity in over ${DORMANT_DAYS} days — likely closed at the bank`
                  }
                >
                  <span
                    className={
                      state.tone === "live"
                        ? "treasury-dot treasury-dot-live"
                        : state.tone === "down"
                          ? "treasury-dot treasury-dot-down"
                          : "treasury-dot"
                    }
                    style={state.tone === "dormant" ? { background: "rgba(255,255,255,0.3)" } : undefined}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-white/45">{state.label}</span>
                </span>
              </div>

              <div className="relative mt-3">
                <p className="text-white/55 text-xs truncate">{accountLabel(account)}</p>
                <p className="text-white text-[21px] font-semibold tracking-tight mt-0.5">
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

              <div className="relative mt-3 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-white/35">
                  {account.subtype || account.type}
                  {account.hidden && <span className="ml-2 text-amber-300/70 normal-case tracking-normal">hidden</span>}
                </span>
                <span className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span
                    role="button"
                    tabIndex={0}
                    title={account.hidden ? "Unhide account" : "Hide account"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void setHidden(account, !account.hidden);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        void setHidden(account, !account.hidden);
                      }
                    }}
                    className="p-1 rounded text-white/45 hover:text-white cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                      {account.hidden ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      )}
                    </svg>
                  </span>
                  <span className="text-[11px] text-white/45">View →</span>
                </span>
              </div>
            </button>
          );
        })}
        </div>
        )}
      </section>
      ))}

      {view === "list" && !loading && accounts.length > 0 && (
        <div className={`rounded-xl border overflow-hidden ${card}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[760px]">
              <thead>
                <tr className={isDark ? "bg-white/[0.03]" : "bg-gray-50"}>
                  {["Institution", "Account", "Type", "Status", "Change", "Balance"].map((h, i) => (
                    <th
                      key={h}
                      className={`text-[11px] uppercase tracking-wider font-medium px-4 py-3 ${
                        i >= 4 ? "text-right" : "text-left"
                      } ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              {entityGroups.map((group) => (
              <tbody key={group.key}>
                <tr
                  onClick={() => toggleGroup(group.key)}
                  className={`cursor-pointer transition-colors ${
                    isDark ? "bg-white/[0.04] hover:bg-white/[0.07]" : "bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <th
                    colSpan={6}
                    scope="colgroup"
                    aria-expanded={!collapsed.has(group.key)}
                    className={`text-left px-4 py-2.5 border-t ${
                      isDark ? "border-white/10" : "border-gray-200"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span
                        className={`flex items-center gap-2 text-xs font-semibold ${
                          group.key === "__unmapped__"
                            ? "text-amber-500"
                            : isDark
                              ? "text-white"
                              : "text-gray-900"
                        }`}
                      >
                        <Chevron open={!collapsed.has(group.key)} />
                        {group.name}
                        <span className={`font-normal ${subtle}`}>
                          {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="text-xs font-semibold tabular-nums">{money(group.total)}</span>
                    </span>
                  </th>
                </tr>
                {!collapsed.has(group.key) && group.accounts.map((account) => {
                  const state = accountState(account);
                  const rgb = tint(account.institution_color);
                  return (
                    <tr
                      key={account.account_id}
                      onClick={() => navigate(`/treasury/${account.account_id}`)}
                      className={`cursor-pointer transition-colors ${isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50"}`}
                    >
                      <td className={`px-4 py-3 border-t whitespace-nowrap ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        <span className="flex items-center gap-2.5">
                          {account.institution_logo ? (
                            <img
                              src={`data:image/png;base64,${account.institution_logo}`}
                              alt=""
                              className="w-6 h-6 rounded object-contain bg-white/90 p-0.5 shrink-0"
                            />
                          ) : (
                            <span
                              className="w-6 h-6 rounded shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                              style={{ background: `rgba(${rgb}, 0.55)` }}
                            >
                              {account.institution_name.slice(0, 1)}
                            </span>
                          )}
                          <span className="font-medium">{account.institution_name}</span>
                        </span>
                      </td>
                      <td className={`px-4 py-3 border-t whitespace-nowrap ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        {accountLabel(account)}
                      </td>
                      <td className={`px-4 py-3 border-t whitespace-nowrap capitalize ${subtle} ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        {account.subtype || account.type}
                      </td>
                      <td className={`px-4 py-3 border-t whitespace-nowrap ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        <span
                          className="inline-flex items-center gap-1.5"
                          title={
                            state.tone === "dormant"
                              ? `Empty, no activity in over ${DORMANT_DAYS} days — likely closed at the bank`
                              : undefined
                          }
                        >
                          <span
                            className={
                              state.tone === "live"
                                ? "treasury-dot treasury-dot-live"
                                : state.tone === "down"
                                  ? "treasury-dot treasury-dot-down"
                                  : "treasury-dot"
                            }
                            style={
                              state.tone === "dormant"
                                ? { background: isDark ? "rgba(255,255,255,0.25)" : "rgb(203,213,225)" }
                                : undefined
                            }
                          />
                          <span className={`text-xs ${subtle}`}>{state.label}</span>
                        </span>
                      </td>
                      <td className={`px-4 py-3 border-t whitespace-nowrap text-right tabular-nums ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        {account.change != null && account.change !== 0 ? (
                          <span className={account.change > 0 ? "text-emerald-400" : "text-rose-400"}>
                            {signed(account.change, account.currency ?? "USD")}
                          </span>
                        ) : (
                          <span className={subtle}>—</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 border-t whitespace-nowrap text-right tabular-nums font-semibold ${isDark ? "border-white/5" : "border-gray-100"}`}>
                        <span className="inline-flex items-center gap-2">
                          {money(account.balance_current, account.currency ?? "USD")}
                          <button
                            title={account.hidden ? "Unhide account" : "Hide account"}
                            onClick={(e) => {
                              e.stopPropagation();
                              void setHidden(account, !account.hidden);
                            }}
                            className={`p-1 rounded cursor-pointer ${isDark ? "text-gray-600 hover:text-white" : "text-gray-400 hover:text-black"}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                            </svg>
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              ))}
            </table>
          </div>
        </div>
      )}

      {(connections.length > 0 || hiddenCount > 0) && (
        <div className="flex flex-wrap gap-2 mt-6">
          {dormant.length > 0 && (
            <button
              onClick={() => void hideDormant()}
              title={`Hide ${dormant.length} empty accounts with no activity in ${DORMANT_DAYS} days`}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                isDark
                  ? "border-amber-400/25 text-amber-400/80 hover:text-amber-300 hover:border-amber-400/50"
                  : "border-amber-300 text-amber-700 hover:border-amber-500"
              }`}
            >
              Hide {dormant.length} dormant
            </button>
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                isDark
                  ? "border-white/10 text-gray-500 hover:text-white hover:border-white/25"
                  : "border-gray-200 text-gray-500 hover:text-black hover:border-gray-400"
              }`}
            >
              {showHidden ? "Hide hidden accounts" : `Show ${hiddenCount} hidden`}
            </button>
          )}
        </div>
      )}

      {connections.length > 0 && (
        <section className="mt-8">
          <h2 className={`text-xs uppercase tracking-wider mb-3 ${subtle}`}>Bank connections</h2>
          <div className={`rounded-xl border overflow-hidden ${card}`}>
            {connections.map((conn, i) => {
              const mine = accounts.filter((a) => a.item_id === conn.item_id);
              const total = mine.reduce(
                (sum, a) => sum + (a.type === "credit" ? -1 : 1) * (a.balance_current ?? 0),
                0
              );
              const mapped = mine.filter((a) => a.entity_id).length;
              const empties = mine.filter((a) => Math.abs(a.balance_current ?? 0) < 0.005).length;
              // Same bank connected twice — the detail below is how you tell
              // them apart before removing one.
              const duplicate = connections.filter(
                (c) => c.institution_name === conn.institution_name
              ).length > 1;
              const rgb = tint(conn.institution_color);
              return (
                <div
                  key={conn.item_id}
                  className={`flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 ${
                    i ? `border-t ${isDark ? "border-white/5" : "border-gray-100"}` : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {conn.institution_logo ? (
                      <img
                        src={`data:image/png;base64,${conn.institution_logo}`}
                        alt=""
                        className="w-8 h-8 rounded-md object-contain bg-white/90 p-0.5 shrink-0"
                      />
                    ) : (
                      <span
                        className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: `rgba(${rgb}, 0.55)` }}
                      >
                        {conn.institution_name.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2">
                        {conn.institution_name}
                        {duplicate && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                              isDark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            duplicate
                          </span>
                        )}
                        {conn.status !== "online" && (
                          <span className="text-[10px] uppercase tracking-wider text-rose-400">
                            {conn.status}
                          </span>
                        )}
                      </p>
                      <p className={`text-xs mt-0.5 ${subtle}`}>
                        {mine.length} account{mine.length === 1 ? "" : "s"}
                        {" · "}
                        {mapped} mapped
                        {empties > 0 && ` · ${empties} empty`}
                        {conn.created_at &&
                          ` · added ${new Date(conn.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}`}
                      </p>
                    </div>
                  </div>

                  <span className="text-sm font-semibold tabular-nums shrink-0">{money(total)}</span>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => void refreshConnection(conn)}
                      disabled={linking}
                      title="Re-pick which accounts this connection shares — closed ones drop off"
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-50 ${
                        isDark
                          ? "border-white/10 text-gray-400 hover:text-white hover:border-white/25"
                          : "border-gray-200 text-gray-600 hover:text-black hover:border-gray-400"
                      }`}
                    >
                      Refresh
                    </button>
                    <button
                      onClick={() => void disconnect(conn)}
                      title="Disconnect this connection"
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                        isDark
                          ? "border-white/10 text-gray-500 hover:text-red-400 hover:border-red-400/30"
                          : "border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300"
                      }`}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
