import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Calendar" }];
}

type Stream = {
  vendor: string;
  cadence: string;
  cadence_days: number;
  avg_amount: number;
  count: number;
  last_date: string;
  day_of_month: number;
  account: string | null;
  entity_name: string | null;
  next_expected: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (n: number) => {
  const v = Math.abs(Math.round(n)).toLocaleString("en-US");
  return n < 0 ? `+$${v}` : `$${v}`;
};

/** Which days of the given month this stream is expected to land on. */
function daysInMonth(s: Stream, year: number, month: number): number[] {
  const last = new Date(s.last_date + "T00:00:00Z");
  const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: number[] = [];
  if (s.cadence_days <= 20) {
    // weekly / biweekly — step by days from the last known occurrence.
    const step = s.cadence_days * 86400000;
    const start = Date.UTC(year, month, 1);
    const end = Date.UTC(year, month, monthDays, 23, 59);
    let t = last.getTime();
    while (t > start) t -= step;
    while (t <= end) {
      if (t >= start) out.push(new Date(t).getUTCDate());
      t += step;
    }
  } else {
    // monthly and longer — align by month interval from the anchor month.
    const per = Math.max(1, Math.round(s.cadence_days / 30));
    const anchor = last.getUTCFullYear() * 12 + last.getUTCMonth();
    const idx = year * 12 + month;
    if ((idx - anchor) % per === 0 && idx >= anchor - per * 24) {
      out.push(Math.min(s.day_of_month || 1, monthDays));
    }
  }
  return [...new Set(out)];
}

/**
 * The recurring calendar: every repeating charge and deposit the books detected,
 * projected onto the month so you can see what's expected and when.
 */
export default function BooksCalendar() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/books/data?report=recurring");
        if (!res.ok) throw new Error();
        setStreams((await res.json()).streams ?? []);
      } catch {
        setError("Couldn't load the recurring streams. Refresh to try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const cellBorder = isDark ? "border-white/5" : "border-gray-100";

  // Map day → the streams expected that day, for the current month.
  const { grid, monthTotal } = useMemo(() => {
    const byDay = new Map<number, Stream[]>();
    let total = 0;
    for (const s of streams) {
      for (const d of daysInMonth(s, cursor.year, cursor.month)) {
        (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s);
        total += s.avg_amount;
      }
    }
    return { grid: byDay, monthTotal: total };
  }, [streams, cursor]);

  const firstDow = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  const monthDays = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: monthDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (d: number) => {
    let m = cursor.month + d, y = cursor.year;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setCursor({ year: y, month: m });
  };
  const navBtn = `w-[40px] h-[40px] sm:w-8 sm:h-8 rounded-full border flex items-center justify-center cursor-pointer ${
    isDark ? "border-white/10 text-gray-400 hover:bg-white/10" : "border-gray-200 text-gray-500 hover:bg-gray-100"
  }`;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "" : "text-gray-900"}`}>Recurring calendar</h1>
          <p className={`text-sm mt-0.5 ${subtle}`}>
            {streams.length} recurring stream{streams.length === 1 ? "" : "s"} detected ·
            {" "}<span className="tabular-nums">{money(monthTotal)}</span> expected net this month
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => shift(-1)} className={navBtn} aria-label="Previous month">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <span className="text-sm font-semibold tabular-nums w-36 sm:w-40 text-center" aria-live="polite">{MONTHS[cursor.month]} {cursor.year}</span>
          <button onClick={() => shift(1)} className={navBtn} aria-label="Next month">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
        </div>
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={`rounded-2xl border p-4 space-y-2.5 rise-in ${card}`}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="shimmer h-8" />)}
        </div>
      ) : (
        <div className={`rounded-2xl border overflow-hidden rise-in ${card}`}>
          <div className="grid grid-cols-7">
            {DOW.map((d) => (
              <div key={d} className={`px-1 sm:px-2 py-2 text-xs text-center border-b ${border} ${subtle}`}>{d}</div>
            ))}
            {cells.map((day, i) => {
              const items = day ? grid.get(day) ?? [] : [];
              const isToday = day === now.getDate() && cursor.month === now.getMonth() && cursor.year === now.getFullYear();
              return (
                <div key={i} className={`min-h-[52px] sm:min-h-[92px] p-1 sm:p-1.5 border-b border-r ${cellBorder} ${day ? "" : isDark ? "bg-white/[0.01]" : "bg-gray-50/50"}`}>
                  {day && (
                    <div className={`text-xs mb-1 ${isToday ? "font-bold text-emerald-500" : subtle}`}>{day}</div>
                  )}
                  {/* Phones: a dot per expected item (the agenda below lists them). */}
                  {items.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                      {items.slice(0, 6).map((s, j) => (
                        <span key={j} className={`w-1.5 h-1.5 rounded-full ${s.avg_amount < 0 ? "bg-emerald-500" : isDark ? "bg-gray-400" : "bg-gray-500"}`} />
                      ))}
                    </div>
                  )}
                  <div className="space-y-1 hidden sm:block">
                    {items.slice(0, 4).map((s, j) => {
                      const inflow = s.avg_amount < 0;
                      return (
                        <div
                          key={j}
                          title={`${s.vendor} · ${s.cadence} · ${money(s.avg_amount)}`}
                          className={`px-1.5 py-1 rounded-md text-[10px] leading-tight truncate ${
                            inflow
                              ? isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
                              : isDark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          <span className="truncate">{s.vendor}</span>
                          <span className="block tabular-nums opacity-80">{money(s.avg_amount)}</span>
                        </div>
                      );
                    })}
                    {items.length > 4 && (
                      <div className={`text-[10px] ${subtle}`} title={items.slice(4).map((s) => `${s.vendor} · ${money(s.avg_amount)}`).join("\n")}>
                        +{items.length - 4} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Phones: the month as an agenda — the grid is too narrow for names. */}
      {!loading && (
        <div className="sm:hidden mt-5 space-y-4">
          {[...grid.entries()].sort((a, b) => a[0] - b[0]).map(([day, items]) => (
            <section key={day}>
              <h2 className={`text-xs mb-1.5 ${subtle}`}>
                {DOW[new Date(Date.UTC(cursor.year, cursor.month, day)).getUTCDay()]}, {MONTHS[cursor.month].slice(0, 3)} {day}
              </h2>
              <ul className={`rounded-xl border divide-y ${card} ${isDark ? "divide-white/5" : "divide-gray-100"}`}>
                {items.map((s, j) => (
                  <li key={j} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{s.vendor}</span>
                      <span className={`block text-xs capitalize ${subtle}`}>{s.cadence}</span>
                    </span>
                    <span className={`tabular-nums shrink-0 ${s.avg_amount < 0 ? (isDark ? "text-emerald-400" : "text-emerald-700") : ""}`}>{money(s.avg_amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {grid.size === 0 && !error && <p className={`text-sm ${subtle}`}>Nothing recurring expected this month.</p>}
        </div>
      )}
    </div>
  );
}
