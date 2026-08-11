import { Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Account mappings" }];
}

type Account = {
  account_id: string;
  item_id: string;
  institution_name: string;
  institution_color: string | null;
  institution_logo: string | null;
  name: string;
  official_name: string | null;
  nickname: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
};

type Entity = { id: string; name: string };

function tint(hex: string | null): string {
  const fallback = "99, 102, 241";
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function label(a: Account): string {
  const base = a.nickname || a.official_name || a.name;
  return a.mask && !base.includes(a.mask) ? `${base} ····${a.mask}` : base;
}

export default function TreasuryMappings() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // Accounts from the treasury API; entities from the Firebase assets tree.
    void (async () => {
      try {
        const res = await authFetch("/api/plaid/data?report=treasury");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn't load accounts.");
        setAccounts(data.accounts ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load accounts.");
      } finally {
        setLoading(false);
      }
    })();

    let unsub: (() => void) | undefined;
    void (async () => {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");
      unsub = onValue(ref(db, "assets"), (snap) => {
        const data = snap.val() || {};
        const list: Entity[] = Object.entries<any>(data)
          .map(([id, asset]) => ({ id, name: asset?.name || "Unnamed entity" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntities(list);
      });
    })();
    return () => unsub?.();
  }, []);

  async function assign(account: Account, entityId: string) {
    const entity = entities.find((e) => e.id === entityId) ?? null;
    setBusyId(account.account_id);
    setError("");
    try {
      const res = await authFetch("/api/plaid/account-prefs", {
        method: "POST",
        body: JSON.stringify({
          account_id: account.account_id,
          entity_id: entity?.id ?? "",
          entity_name: entity?.name ?? "",
        }),
      });
      if (!res.ok) throw new Error("Couldn't save that mapping.");
      setAccounts((prev) =>
        prev.map((a) =>
          a.account_id === account.account_id
            ? { ...a, entity_id: entity?.id ?? null, entity_name: entity?.name ?? null }
            : a
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that mapping.");
    } finally {
      setBusyId(null);
    }
  }

  const unmapped = accounts.filter((a) => !a.entity_id).length;

  const grouped = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const a of accounts) {
      const list = map.get(a.institution_name) ?? [];
      list.push(a);
      map.set(a.institution_name, list);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [accounts]);

  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";

  return (
    <div className="max-w-4xl">
      <Link to="/treasury" className={`text-sm ${subtle} hover:underline`}>← Treasury</Link>
      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Account mappings</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Which entity each bank account and card belongs to — Books and the entity P&amp;Ls are
            built on these.
          </p>
        </div>
        {unmapped > 0 && (
          <span className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-700"}`}>
            {unmapped} unmapped
          </span>
        )}
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <p className={`text-sm ${subtle}`}>Loading…</p>
      ) : accounts.length === 0 ? (
        <p className={`text-sm ${subtle}`}>No accounts connected yet.</p>
      ) : (
        grouped.map(([bank, list]) => {
          const rgb = tint(list[0].institution_color);
          return (
            <section key={bank} className={`rounded-xl border overflow-hidden mb-4 ${card}`}>
              <div className={`flex items-center gap-2.5 px-5 py-3 border-b ${rowBorder}`}>
                {list[0].institution_logo ? (
                  <img
                    src={`data:image/png;base64,${list[0].institution_logo}`}
                    alt=""
                    className="w-6 h-6 rounded object-contain bg-white/90 p-0.5"
                  />
                ) : (
                  <span
                    className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ background: `rgba(${rgb}, 0.55)` }}
                  >
                    {bank.slice(0, 1)}
                  </span>
                )}
                <span className="text-sm font-semibold">{bank}</span>
                <span className={`text-xs ${subtle}`}>· {list.length}</span>
              </div>

              {list.map((account) => (
                <div
                  key={account.account_id}
                  className={`flex flex-wrap items-center gap-3 px-5 py-3 border-t first:border-t-0 ${rowBorder}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {label(account)}
                      {account.hidden && (
                        <span className={`ml-2 text-[10px] uppercase tracking-wider ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>hidden</span>
                      )}
                    </p>
                    <p className={`text-xs capitalize ${subtle}`}>{account.subtype || account.type}</p>
                  </div>

                  {!account.entity_id && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Not mapped yet" />
                  )}
                  <select
                    value={account.entity_id ?? ""}
                    disabled={busyId === account.account_id || entities.length === 0}
                    onChange={(e) => void assign(account, e.target.value)}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors cursor-pointer disabled:opacity-50 min-w-[220px] ${
                      account.entity_id
                        ? isDark
                          ? "bg-white/[0.04] border-white/10 text-white"
                          : "bg-white border-gray-200 text-gray-900"
                        : isDark
                          ? "bg-amber-500/[0.06] border-amber-500/30 text-amber-200"
                          : "bg-amber-50 border-amber-300 text-amber-900"
                    }`}
                  >
                    <option value="">
                      {entities.length === 0 ? "No entities found" : "Assign to entity…"}
                    </option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
