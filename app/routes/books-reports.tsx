import { useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Reports" }];
}

type PnlRow = { label: string; monthly: number[]; total: number };
type Section = { in: number[]; out: number[]; net: number[]; total: number };
type Pnl = {
  year: number;
  entity: string;
  transaction_count: number;
  income: PnlRow[];
  expenses: PnlRow[];
  income_monthly: number[];
  expense_monthly: number[];
  net_monthly: number[];
  net_total: number;
  transfers: Section;
  intercompany: { transfer: Section; distribution: Section; loan: Section } | null;
};

type Entity = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(n: number): string {
  if (Math.round(n) === 0) return "—";
  const v = Math.round(n).toLocaleString("en-US");
  return n < 0 ? `($${Math.abs(Math.round(n)).toLocaleString("en-US")})` : `$${v}`;
}

export default function BooksReports() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [entities, setEntities] = useState<Entity[]>([]);
  const [entity, setEntity] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=meta");
        if (res.ok) setEntities((await res.json()).entities ?? []);
      } catch {
        // switcher just stays short
      }
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await authFetch(`/api/books/data?report=pnl&entity=${encodeURIComponent(entity)}&year=${year}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn't build the P&L.");
        setPnl(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't build the P&L.");
      } finally {
        setLoading(false);
      }
    })();
  }, [entity, year]);

  const subtle = "text-gray-500";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const tab = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
      active
        ? isDark
          ? "bg-white/15 text-white"
          : "bg-gray-900 text-white"
        : isDark
          ? "bg-white/[0.04] text-gray-400 hover:text-white"
          : "bg-gray-100 text-gray-600 hover:text-gray-900"
    }`;

  const years = [0, 1].map((d) => String(new Date().getFullYear() - d));

  const num = "px-3 py-2 text-right whitespace-nowrap tabular-nums";
  const sectionHead = `px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${subtle}`;

  function bodyRow(label: string, monthly: number[], total: number, opts?: { bold?: boolean; color?: string; indent?: boolean }) {
    return (
      <tr key={label} className={`border-t ${rowBorder} ${opts?.bold ? "font-semibold" : ""}`}>
        <td className={`px-3 py-2 sticky left-0 whitespace-nowrap ${isDark ? "bg-[#0b0b0b]" : "bg-white"} ${opts?.indent ? "pl-6" : ""}`}>
          {label}
        </td>
        {monthly.map((v, i) => (
          <td key={i} className={`${num} ${opts?.color ?? (v === 0 ? subtle : "")}`}>{money(v)}</td>
        ))}
        <td className={`${num} font-semibold ${opts?.color ?? ""}`}>{money(total)}</td>
      </tr>
    );
  }

  function transferRows(title: string, s: Section) {
    if (s.in.every((v) => v === 0) && s.out.every((v) => v === 0)) return null;
    return (
      <>
        <tr className={`border-t ${border}`}>
          <td colSpan={14} className={sectionHead}>{title}</td>
        </tr>
        {bodyRow("In", s.in, s.in.reduce((a, b) => a + b, 0), { indent: true })}
        {bodyRow("Out", s.out.map((v) => -v), -s.out.reduce((a, b) => a + b, 0), { indent: true })}
        {bodyRow("Net", s.net, s.total, { bold: true })}
      </>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Profit &amp; loss</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Cash basis · categories are Plaid's auto-labels for now · transfers live in their own
            section · the rollup eliminates intercompany movements.
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className={`px-3 py-2 rounded-lg text-sm border cursor-pointer ${
            isDark ? "bg-white/[0.04] border-white/10 text-white" : "bg-white border-gray-200 text-gray-900"
          }`}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-5">
        <button className={tab(entity === "all")} onClick={() => setEntity("all")}>All entities</button>
        {entities.map((en) => (
          <button key={en.id} className={tab(entity === en.id)} onClick={() => setEntity(en.id)}>
            {en.name}
          </button>
        ))}
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <p className={`text-sm ${subtle}`}>Building the P&amp;L…</p>
      ) : !pnl ? null : pnl.transaction_count === 0 ? (
        <p className={`text-sm ${subtle}`}>
          Nothing booked for {pnl.year} yet — sync transactions on the Transactions page first.
        </p>
      ) : (
        <div className={`rounded-xl border overflow-x-auto ${card}`}>
          <table className="text-sm min-w-[1100px] w-full">
            <thead>
              <tr className={`text-xs uppercase tracking-wider ${subtle} border-b ${border}`}>
                <th className={`px-3 py-3 text-left font-medium sticky left-0 ${isDark ? "bg-[#0b0b0b]" : "bg-white"}`}>
                  {entity === "all" ? "All entities" : entities.find((e) => e.id === entity)?.name ?? ""} · {pnl.year}
                </th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-3 py-3 text-right font-medium">{m}</th>
                ))}
                <th className="px-3 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={14} className={sectionHead}>Income</td>
              </tr>
              {pnl.income.map((r) => bodyRow(r.label, r.monthly, r.total, { indent: true }))}
              {bodyRow("Total income", pnl.income_monthly, pnl.income_monthly.reduce((a, b) => a + b, 0), { bold: true, color: "text-emerald-500" })}

              <tr className={`border-t ${border}`}>
                <td colSpan={14} className={sectionHead}>Expenses</td>
              </tr>
              {pnl.expenses.map((r) => bodyRow(r.label, r.monthly, r.total, { indent: true }))}
              {bodyRow("Total expenses", pnl.expense_monthly, pnl.expense_monthly.reduce((a, b) => a + b, 0), { bold: true })}

              {bodyRow("Net", pnl.net_monthly, pnl.net_total, {
                bold: true,
                color: pnl.net_total >= 0 ? "text-emerald-500" : "text-red-400",
              })}

              {transferRows("Transfers", pnl.transfers)}
              {pnl.intercompany && (
                <>
                  {transferRows("Intercompany · transfers", pnl.intercompany.transfer)}
                  {transferRows("Intercompany · distributions", pnl.intercompany.distribution)}
                  {transferRows("Intercompany · loans", pnl.intercompany.loan)}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
