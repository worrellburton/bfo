import { useEffect, useState } from "react";
import { authFetch } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Books · Rules" }];
}

type Rule = {
  id: string;
  match: string;
  book_category: string | null;
  vendor_name: string | null;
  type_override: string | null;
  loan_id: string | null;
  matches: number;
  created_at: string;
};

/**
 * Every rule the books have learned — from "apply to all", vendor renames,
 * type overrides, and loan links. This is the memory that makes the system
 * run itself; here you can see it, and prune anything that's wrong.
 */
export default function BooksRules() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await authFetch("/api/books/data?report=rules");
      if (!res.ok) throw new Error();
      setRules((await res.json()).rules ?? []);
    } catch {
      setError("Couldn't load the rules. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function remove(id: string) {
    const before = rules;
    setError("");
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await authFetch("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "delete_rule", rule_id: id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Put it back — the rule is still live on the server.
      setRules(before);
      setError("Couldn't delete that rule.");
    }
  }

  const subtle = "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const border = isDark ? "border-white/10" : "border-gray-200";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const head = `text-xs ${subtle}`;
  const chip = isDark ? "bg-white/[0.06] text-gray-300" : "bg-gray-100 text-gray-700";

  const needle = q.trim().toLowerCase();
  const shown = needle ? rules.filter((r) => r.match.toLowerCase().includes(needle)) : rules;

  const effect = (r: Rule) => {
    const bits: string[] = [];
    if (r.book_category) bits.push(r.book_category);
    if (r.vendor_name) bits.push(`vendor → ${r.vendor_name}`);
    if (r.type_override) bits.push(`type → ${r.type_override}`);
    if (r.loan_id) bits.push("linked to a loan");
    return bits;
  };

  return (
    <div className="w-full max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${isDark ? "" : "text-gray-900"}`}>Rules</h1>
          <p className={`text-sm mt-0.5 ${subtle}`}>What the books have learned — {rules.length} rule{rules.length === 1 ? "" : "s"}. New ones are created whenever you choose “apply to all”.</p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rules…"
          aria-label="Search rules"
          className={`px-3.5 h-[40px] sm:h-9 rounded-full text-sm border focus:outline-none w-full sm:w-56 ${
            isDark ? "bg-white/[0.04] border-white/10 text-white placeholder-gray-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
          }`}
        />
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={`rounded-2xl border p-4 space-y-2.5 rise-in ${card}`}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="shimmer h-4" style={{ width: `${95 - (i % 3) * 10}%` }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        error && rules.length === 0 ? null :
        <p className={`text-sm ${subtle}`}>{rules.length === 0 ? "No rules yet. Categorize a vendor with “apply to all” to teach your first one." : "No rules match that search."}</p>
      ) : (
        <div className={`rounded-2xl border overflow-x-auto rise-in ${card}`}>
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className={`${head} border-b ${border}`}>
                <th className="px-4 py-2.5 text-left font-medium">When description contains</th>
                <th className="px-4 py-2.5 text-left font-medium">Do this</th>
                <th className="px-4 py-2.5 text-right font-medium">Matches</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`border-t ${rowBorder}`}>
                  <td className="px-4 py-2.5 font-medium break-all max-w-[280px]">“{r.match}”</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {effect(r).map((b) => (
                        <span key={b} className={`px-2 py-0.5 rounded-full text-xs ${chip}`}>{b}</span>
                      ))}
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${r.matches ? "" : subtle}`}>{r.matches}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => void remove(r.id)}
                      title="Delete this rule"
                      aria-label={`Delete rule “${r.match}”`}
                      className={`text-xs cursor-pointer px-3 py-[14px] -my-[14px] -mr-3 sm:p-0 sm:m-0 ${subtle} hover:text-red-500`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
