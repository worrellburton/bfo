import { useEffect, useState } from "react";
import { authFetch, getUser, isAdmin } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Notifications" }];
}

type Prefs = Record<string, any>;

type Toggle = { key: string; label: string; adminOnly?: boolean };
type Group = { channel: string; toggles: Toggle[] };
type Section = { title: string; description: string; groups: Group[] };

const SECTIONS: Section[] = [
  {
    title: "Treasury",
    description: "Bank balances, transactions and connection health",
    groups: [
      {
        channel: "Email",
        toggles: [
          { key: "treasury.email.balanceSummary", label: "Daily balance summary across all accounts" },
          { key: "treasury.email.largeTransaction", label: "Transactions over your review threshold" },
          { key: "treasury.email.connectionLost", label: "When a bank connection needs reconnecting" },
          { key: "treasury.email.lowBalance", label: "When an account falls below its floor" },
        ],
      },
      {
        channel: "Text message",
        toggles: [
          { key: "treasury.sms.largeTransaction", label: "Transactions over your review threshold" },
          { key: "treasury.sms.connectionLost", label: "When a bank connection needs reconnecting" },
        ],
      },
    ],
  },
  {
    title: "Investments",
    description: "Brokerage holdings and portfolio movement",
    groups: [
      {
        channel: "Email",
        toggles: [
          { key: "investments.email.weeklySummary", label: "Weekly portfolio summary" },
          { key: "investments.email.bigMove", label: "When a holding moves more than 5% in a day" },
        ],
      },
    ],
  },
  {
    title: "Access and security",
    description: "Sign-ins, approvals and changes to who can get in",
    groups: [
      {
        channel: "Email",
        toggles: [
          { key: "security.email.newSignIn", label: "A new sign-in to your account" },
          { key: "security.email.accessRequest", label: "Someone requests access to BFO", adminOnly: true },
          { key: "security.email.userChanged", label: "A user is approved, denied or removed", adminOnly: true },
        ],
      },
    ],
  },
];

const FREQUENCIES = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function get(prefs: Prefs, path: string): boolean {
  return path.split(".").reduce<any>((node, part) => node?.[part], prefs) === true;
}

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

function Switch({
  on,
  onChange,
  isDark,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  isDark: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-[46px] h-[26px] rounded-full shrink-0 transition-colors cursor-pointer ${
        on
          ? "bg-emerald-500"
          : isDark
            ? "bg-[rgba(255,255,255,0.14)]"
            : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function Notifications() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const admin = isAdmin(getUser());

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

              {frequency !== "off" && (
                <label className="flex flex-col gap-1.5">
                  <span className={`text-xs font-medium uppercase tracking-wider ${subtle}`}>Deliver by</span>
                  <select
                    className={field}
                    value={report.channel ?? "email"}
                    onChange={(e) => void save(set(prefs, "treasuryReport.channel", e.target.value))}
                  >
                    <option value="email">Email</option>
                    <option value="sms">Text message</option>
                  </select>
                </label>
              )}
            </div>

            {frequency !== "off" && (
              <p className={`text-xs mt-4 ${subtle}`}>
                Reports go out each morning around 8am Eastern to{" "}
                {report.channel === "sms"
                  ? getUser()?.phoneFormatted || "your phone number"
                  : getUser()?.email || "your email address"}
                .
              </p>
            )}
          </section>

          {SECTIONS.map((section) => (
            <section key={section.title} className={`rounded-xl border p-6 mb-6 ${card}`}>
              <h2 className={`text-[17px] font-semibold ${isDark ? "" : "text-gray-900"}`}>
                {section.title}
              </h2>
              <p className={`text-sm mt-1 ${subtle}`}>{section.description}</p>

              {section.groups.map((group) => {
                const toggles = group.toggles.filter((t) => !t.adminOnly || admin);
                if (toggles.length === 0) return null;
                return (
                  <div key={group.channel} className="mt-6">
                    <h3 className={`text-sm font-medium mb-1 ${isDark ? "" : "text-gray-900"}`}>
                      {group.channel}
                    </h3>
                    <div>
                      {toggles.map((toggle) => (
                        <div
                          key={toggle.key}
                          className={`flex items-center gap-4 py-3 border-t ${divider}`}
                        >
                          <Switch
                            on={get(prefs, toggle.key)}
                            isDark={isDark}
                            label={toggle.label}
                            onChange={(next) => void save(set(prefs, toggle.key, next))}
                          />
                          <span className="text-sm">{toggle.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
