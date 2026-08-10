import { useEffect, useState } from "react";
import { authFetch, getUser, type User } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Notifications" }];
}

type Prefs = Record<string, any>;

const FREQUENCIES = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function set(prefs: Prefs, path: string, value: unknown): Prefs {
  const parts = path.split(".");
  const next = { ...prefs };
  let node: any = next;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) node[part] = value;
    else {
      node[part] = { ...(node[part] ?? {}) };
      node = node[part];
    }
  });
  return next;
}

export default function Notifications() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/auth/preferences");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message ?? "Couldn't load your settings.");
        setPrefs(data.preferences ?? {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load your settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(next: Prefs) {
    setPrefs(next);
    setStatus("Saving…");
    setError("");
    try {
      const res = await authFetch("/api/auth/preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences: next }),
      });
      if (!res.ok) throw new Error("Couldn't save.");
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  const report = prefs.treasuryReport ?? {};
  const frequency: string = report.frequency ?? "off";
  const recipients: string[] = report.recipients ?? [];
  const [sampleState, setSampleState] = useState<"idle" | "sending" | "sent">("idle");
  const [broadcastState, setBroadcastState] = useState<"idle" | "sending" | "sent">("idle");

  async function sendNow() {
    const count = 1 + recipients.length;
    if (!confirm(`Send the report now to ${count} recipient${count === 1 ? "" : "s"}?`)) return;
    setBroadcastState("sending");
    setError("");
    try {
      const res = await authFetch("/api/cron/treasury-report", {
        method: "POST",
        body: JSON.stringify({ broadcast: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn't send the report.");
      setBroadcastState("sent");
      setTimeout(() => setBroadcastState("idle"), 4000);
    } catch (err) {
      setBroadcastState("idle");
      setError(err instanceof Error ? err.message : "Couldn't send the report.");
    }
  }
  const [team, setTeam] = useState<User[]>([]);
  const [manualEmail, setManualEmail] = useState("");

  // The user dropdown needs the roster; non-admins just get the manual field.
  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/auth/users");
        if (!res.ok) return;
        const data = await res.json();
        setTeam((data.users ?? []).filter((u: User) => u.email));
      } catch {}
    })();
  }, []);

  function addRecipient(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (email === getUser()?.email || recipients.includes(email)) {
      setManualEmail("");
      return;
    }
    setManualEmail("");
    void save(set(prefs, "treasuryReport.recipients", [...recipients, email]));
  }

  function removeRecipient(email: string) {
    void save(
      set(
        prefs,
        "treasuryReport.recipients",
        recipients.filter((r) => r !== email)
      )
    );
  }

  async function sendSample() {
    setSampleState("sending");
    setError("");
    try {
      const res = await authFetch("/api/cron/treasury-report", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn't send the sample.");
      setSampleState("sent");
      setTimeout(() => setSampleState("idle"), 4000);
    } catch (err) {
      setSampleState("idle");
      setError(err instanceof Error ? err.message : "Couldn't send the sample.");
    }
  }

  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const divider = isDark ? "border-white/5" : "border-gray-100";
  const field = `px-3 py-2 rounded-lg text-sm border cursor-pointer focus:outline-none ${
    isDark
      ? "bg-white/[0.04] border-white/10 text-white"
      : "bg-white border-gray-200 text-gray-900"
  }`;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Notifications</h1>
          <p className={`text-sm mt-1 ${subtle}`}>Choose what BFO tells you about, and how</p>
        </div>
        {status && <span className={`text-xs mt-2 ${subtle}`}>{status}</span>}
      </div>

      {error && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {loading ? (
        <p className={`text-sm ${subtle}`}>Loading…</p>
      ) : (
        <>
          {/* Scheduled Treasury report */}
          <section className={`rounded-xl border p-6 mb-6 ${card}`}>
            <h2 className={`text-[17px] font-semibold ${isDark ? "" : "text-gray-900"}`}>
              Treasury report
            </h2>
            <p className={`text-sm mt-1 ${subtle}`}>
              A snapshot of every connected account — balances, movement since the last report, and
              anything that needs reconnecting.
            </p>

            <div className="flex flex-wrap items-end gap-3 mt-5">
              <label className="flex flex-col gap-1.5">
                <span className={`text-xs font-medium uppercase tracking-wider ${subtle}`}>Send</span>
                <select
                  className={field}
                  value={frequency}
                  onChange={(e) => void save(set(prefs, "treasuryReport.frequency", e.target.value))}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>

              {frequency === "weekly" && (
                <label className="flex flex-col gap-1.5">
                  <span className={`text-xs font-medium uppercase tracking-wider ${subtle}`}>On</span>
                  <select
                    className={field}
                    value={String(report.dayOfWeek ?? 1)}
                    onChange={(e) =>
                      void save(set(prefs, "treasuryReport.dayOfWeek", Number(e.target.value)))
                    }
                  >
                    {DAYS.map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </label>
              )}

              {frequency === "monthly" && (
                <label className="flex flex-col gap-1.5">
                  <span className={`text-xs font-medium uppercase tracking-wider ${subtle}`}>On the</span>
                  <select
                    className={field}
                    value={String(report.dayOfMonth ?? 1)}
                    onChange={(e) =>
                      void save(set(prefs, "treasuryReport.dayOfMonth", Number(e.target.value)))
                    }
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
              )}

            </div>

            {frequency !== "off" && (
              <div className="mt-5">
                <span className={`text-xs font-medium uppercase tracking-wider block mb-2 ${subtle}`}>
                  Send to
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {/* You always get your own report */}
                  <span className={`px-3 py-1.5 rounded-full text-xs ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"}`}>
                    {getUser()?.email} <span className={subtle}>(you)</span>
                  </span>
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs border ${
                        isDark ? "border-white/15 text-gray-300" : "border-gray-300 text-gray-700"
                      }`}
                    >
                      {email}
                      <button
                        onClick={() => removeRecipient(email)}
                        title="Remove"
                        className={`p-0.5 rounded-full cursor-pointer ${isDark ? "hover:bg-white/10 text-gray-500 hover:text-white" : "hover:bg-black/10 text-gray-400 hover:text-black"}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {team.filter((u) => u.email !== getUser()?.email && !recipients.includes(u.email!)).length > 0 && (
                    <select
                      className={field}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addRecipient(e.target.value);
                      }}
                    >
                      <option value="">Add a user…</option>
                      {team
                        .filter((u) => u.email !== getUser()?.email && !recipients.includes(u.email!))
                        .map((u) => (
                          <option key={u.id} value={u.email!}>
                            {u.name ? `${u.name} — ${u.email}` : u.email}
                          </option>
                        ))}
                    </select>
                  )}
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addRecipient(manualEmail);
                    }}
                  >
                    <input
                      type="email"
                      value={manualEmail}
                      onChange={(e) => {
                        setManualEmail(e.target.value);
                        setError("");
                      }}
                      placeholder="or add any email…"
                      className={`${field} cursor-text w-56`}
                    />
                    <button
                      type="submit"
                      disabled={!manualEmail.trim()}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 ${
                        isDark ? "bg-white/10 text-white hover:bg-white/15" : "bg-black/5 text-gray-800 hover:bg-black/10"
                      }`}
                    >
                      Add
                    </button>
                  </form>
                </div>

                <p className={`text-xs mt-3 ${subtle}`}>
                  Reports go out each morning around 8am Eastern to everyone above.
                </p>
              </div>
            )}

            <div className={`mt-5 pt-4 border-t ${divider} flex items-center gap-3`}>
              <button
                onClick={() => void sendSample()}
                disabled={sampleState === "sending"}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? "border border-white/15 text-gray-200 hover:bg-white/10"
                    : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {sampleState === "sending" ? "Sending…" : "Send me a sample"}
              </button>
              <button
                onClick={() => void sendNow()}
                disabled={broadcastState === "sending"}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                  isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
                }`}
              >
                {broadcastState === "sending"
                  ? "Sending…"
                  : broadcastState === "sent"
                    ? "Sent to everyone"
                    : `Send now${recipients.length ? ` (${recipients.length + 1})` : ""}`}
              </button>
              {sampleState === "sent" && (
                <span className="text-xs text-emerald-400">
                  Sent to {getUser()?.email} — check your inbox
                </span>
              )}
            </div>
          </section>

        </>
      )}
    </div>
  );
}
