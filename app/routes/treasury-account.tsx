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
  entity_id: string | null;
  entity_name: string | null;
};

type Entity = { id: string; name: string };

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

// ── CSV import (bank history past the Plaid window) ──────────────────────────
type CsvRow = { date: string; description: string; amount: number };

/** RFC-ish CSV split: honours quotes, doubled quotes, and CRLF. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "08/13/2026", "2026-08-13", "8/3/26" → "YYYY-MM-DD" (or "" if unusable). */
function normalizeDate(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    const mo = m[1].padStart(2, "0");
    const da = m[2].padStart(2, "0");
    let yr = m[3];
    if (yr.length === 2) yr = Number(yr) > 70 ? `19${yr}` : `20${yr}`;
    return `${yr}-${mo}-${da}`;
  }
  return "";
}

/** "$1,234.56", "(45.00)", "-45" → number (parens / trailing minus = negative). */
function parseAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.replace(/-$/, ""); }
  s = s.replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

/**
 * Parse a bank CSV into {date, description, amount} rows. Handles both
 * headered exports (maps columns by name, incl. split Debit/Credit) and the
 * header-less Wells Fargo layout [date, amount, *, "", description].
 * Sign out is the bank convention: deposits positive, withdrawals negative.
 */
function parseBankCsv(text: string): CsvRow[] {
  const records = splitCsv(text);
  if (!records.length) return [];
  const header = records[0].map((c) => c.trim().toLowerCase());
  const hasHeader = header.some((c) => /date|amount|description|payee|debit|credit|withdraw|deposit|memo/.test(c));

  let iDate = -1, iDesc = -1, iAmt = -1, iDebit = -1, iCredit = -1;
  let body = records;
  if (hasHeader) {
    header.forEach((c, i) => {
      if (iDate < 0 && /date/.test(c)) iDate = i;
      if (iDesc < 0 && /desc|payee|name|memo/.test(c)) iDesc = i;
      if (iAmt < 0 && /^amount|amount$|\bamount\b/.test(c)) iAmt = i;
      if (iDebit < 0 && /debit|withdraw/.test(c)) iDebit = i;
      if (iCredit < 0 && /credit|deposit/.test(c)) iCredit = i;
    });
    body = records.slice(1);
  } else {
    iDate = 0; iAmt = 1; iDesc = 4; // Wells Fargo default
  }
  if (iDate < 0) iDate = 0;

  const out: CsvRow[] = [];
  for (const cols of body) {
    const date = normalizeDate(cols[iDate] ?? "");
    if (!date) continue;
    const description = (iDesc >= 0 ? cols[iDesc] ?? "" : "").trim() || (cols.find((c, i) => i !== iDate && i !== iAmt && c.trim()) ?? "").trim();
    let amount = NaN;
    if (iAmt >= 0 && (cols[iAmt] ?? "").trim() !== "") {
      amount = parseAmount(cols[iAmt]);
    } else if (iDebit >= 0 || iCredit >= 0) {
      const d = parseAmount(cols[iDebit] ?? "");
      const c = parseAmount(cols[iCredit] ?? "");
      amount = (Number.isFinite(c) ? Math.abs(c) : 0) - (Number.isFinite(d) ? Math.abs(d) : 0);
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    out.push({ date, description, amount });
  }
  return out;
}

export default function TreasuryAccount() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [account, setAccount] = useState<Account | null>(null);
  const [siblings, setSiblings] = useState<Account[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
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

  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/plaid/data?report=treasury");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn't load the account.");
        const list: Account[] = (data.accounts ?? []).filter((a: Account) => !a.hidden);
        const found = (data.accounts ?? []).find((a: Account) => a.account_id === accountId);
        if (!found) throw new Error("That account isn't connected any more.");
        setSiblings(list.some((a) => a.account_id === found.account_id) ? list : [found, ...list]);
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
    // Entities come from the Firebase assets tree, same source as the mappings page.
    let unsub: (() => void) | undefined;
    void (async () => {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");
      unsub = onValue(ref(db, "assets"), (snap) => {
        const data = snap.val() || {};
        setEntities(
          Object.entries<any>(data)
            .map(([id, asset]) => ({ id, name: asset?.name || "Unnamed entity" }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      });
    })();
    return () => unsub?.();
  }, []);

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

  async function assignEntity(entityId: string) {
    if (!account) return;
    const entity = entities.find((e) => e.id === entityId) ?? null;
    const res = await authFetch("/api/plaid/account-prefs", {
      method: "POST",
      body: JSON.stringify({
        account_id: account.account_id,
        entity_id: entity?.id ?? "",
        entity_name: entity?.name ?? "",
      }),
    });
    if (!res.ok) {
      setError("Couldn't save that mapping.");
      return;
    }
    setAccount({ ...account, entity_id: entity?.id ?? null, entity_name: entity?.name ?? null });
  }

  async function importCsv(file: File) {
    if (!account) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      const rows = parseBankCsv(text);
      if (!rows.length) {
        setImportMsg({ ok: false, text: "Couldn't find any dated rows with amounts in that file." });
        return;
      }
      const res = await authFetch("/api/books/import-csv", {
        method: "POST",
        body: JSON.stringify({ account_id: account.account_id, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Import failed.");
      const imported = data.imported ?? 0;
      const skipped = data.skipped_existing ?? 0;
      setImportMsg({
        ok: true,
        text:
          `Imported ${imported} transaction${imported === 1 ? "" : "s"} into Books` +
          (skipped ? ` · ${skipped} already present` : "") +
          ". They appear in the Books ledger.",
      });
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
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

  const idx = siblings.findIndex((a) => a.account_id === account.account_id);
  const count = siblings.length;
  const prevAcct = count > 1 ? siblings[(idx - 1 + count) % count] : null;
  const nextAcct = count > 1 ? siblings[(idx + 1) % count] : null;
  const navBtn = `w-8 h-8 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
    isDark ? "border-white/10 text-gray-400 hover:bg-white/10 hover:text-white" : "border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
  }`;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Link to="/treasury" className={`text-sm ${subtle} hover:underline`}>← Treasury</Link>
        {count > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => prevAcct && navigate(`/treasury/${prevAcct.account_id}`)}
              title={prevAcct ? prevAcct.nickname || prevAcct.official_name || prevAcct.name : "Previous"}
              className={navBtn}
              aria-label="Previous account"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className={`text-xs tabular-nums ${subtle}`}>{idx + 1} / {count}</span>
            <button
              onClick={() => nextAcct && navigate(`/treasury/${nextAcct.account_id}`)}
              title={nextAcct ? nextAcct.nickname || nextAcct.official_name || nextAcct.name : "Next"}
              className={navBtn}
              aria-label="Next account"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>

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

      {/* Entity mapping */}
      <div className="flex items-center gap-2 mb-6 -mt-1">
        <span className={`text-[11px] uppercase tracking-wider ${subtle}`}>Entity</span>
        <span className="relative inline-flex items-center">
          <select
            value={account.entity_id ?? ""}
            disabled={entities.length === 0}
            onChange={(e) => void assignEntity(e.target.value)}
            className={`appearance-none pl-3.5 pr-9 py-1.5 rounded-full text-sm border cursor-pointer disabled:opacity-50 ${
              account.entity_id
                ? isDark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"
                : isDark ? "bg-white/[0.04] border-white/10 text-gray-300" : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            <option value="">{entities.length === 0 ? "No entities found" : "Unassigned"}</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <svg className="w-3.5 h-3.5 absolute right-3.5 pointer-events-none opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </div>

      {/* Transactions */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Transactions</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importCsv(f);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={importing}
            title="Import a bank CSV export — history older than Plaid serves"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border cursor-pointer disabled:opacity-50 transition-colors ${
              isDark ? "bg-white/[0.04] border-white/10 text-gray-300 hover:bg-white/10" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 7.5L12 3m0 0L7.5 7.5M12 3v13.5" />
            </svg>
            {importing ? "Importing…" : "Import CSV"}
          </button>
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
      </div>

      {importMsg && (
        <div
          className={`mb-3 rounded-lg px-4 py-2.5 text-xs ${
            importMsg.ok
              ? isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"
              : isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"
          }`}
        >
          {importMsg.text}
        </div>
      )}

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
