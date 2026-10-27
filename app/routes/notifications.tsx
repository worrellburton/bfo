import { useEffect, useState } from "react";
import { confirmDialog } from "../confirm-dialog";
import { authFetch, getUser, isAdmin, type User } from "../auth";
import { isNativeApp } from "../native";
import { enablePush, usePushState } from "../push";
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

/** A switch, with its label and what it's for. */
function Switch({ on, onToggle, label, hint, isDark }: { on: boolean; onToggle: () => void; label: string; hint: string; isDark: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`flex w-full cursor-pointer items-center gap-4 py-3 text-left ${isDark ? "border-white/5" : "border-gray-100"} border-t first:border-t-0`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${isDark ? "text-gray-100" : "text-gray-900"}`}>{label}</span>
        <span className={`block text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>{hint}</span>
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-[#6366f1]" : isDark ? "bg-white/15" : "bg-gray-300"}`} aria-hidden>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
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
    if (!(await confirmDialog({ title: "Send the report now?", message: `It goes to ${count} recipient${count === 1 ? "" : "s"} immediately.`, confirmLabel: "Send now" }))) return;
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

  // Push notifications: the iPhone app's permission, the phones set up, and what to be told about.
  const [push, setPush] = usePushState();
  const [phones, setPhones] = useState<{ configured: boolean; devices: number } | null>(null);
  const [pushNote, setPushNote] = useState("");
  const [testing, setTesting] = useState(false);
  const loadPhones = () =>
    authFetch("/api/push")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPhones({ configured: !!d.configured, devices: Number(d.devices ?? 0) }))
      .catch(() => undefined);
  useEffect(() => {
    void loadPhones();
  }, []);
  const pushPrefs = { mail: prefs.push?.mail !== false, texts: prefs.push?.texts !== false, paper: prefs.push?.paper !== false };
  const admin = isAdmin(getUser());

  async function turnOn() {
    setPushNote("");
    const next = await enablePush();
    setPush(next);
    if (next === "granted") {
      setPushNote("On. This phone will get BFO's notices.");
      setTimeout(() => void loadPhones(), 1500);
    } else if (next === "denied") setPushNote("Notifications are off for BFO in iPhone Settings.");
  }
  async function sendTest() {
    setTesting(true);
    setPushNote("");
    try {
      const r = await authFetch("/api/push", { method: "POST", body: JSON.stringify({ action: "test" }) }).then((x) => x.json());
      setPushNote(
        r.error === "not_configured" ? "Not set up on the server yet." : r.sent ? "Sent. Check your lock screen." : r.devices ? `Apple refused it (${r.error ?? "unknown"}).` : "No phone is set up yet. Turn notifications on in the BFO app."
      );
    } catch {
      setPushNote("Couldn't reach BFO.");
    } finally {
      setTesting(false);
    }
  }

  // System: open alerts and each cron's last run (admins), from /api/ops.
  const [ops, setOps] = useState<{ alerts: OpsAlert[]; crons: CronLast[] } | null>(null);
  const [opsError, setOpsError] = useState("");
  const [acking, setAcking] = useState<string | null>(null);
  const loadOps = () =>
    authFetch("/api/ops")
      .then(async (r) => {
        if (!r.ok) throw new Error("Couldn't load the system status.");
        const d = await r.json();
        setOps({ alerts: d.alerts ?? [], crons: d.crons ?? [] });
        setOpsError("");
      })
      .catch((err) => setOpsError(err instanceof Error ? err.message : "Couldn't load the system status."));
  useEffect(() => {
    if (admin) void loadOps();
  }, [admin]);
  async function acknowledge(id: string) {
    setAcking(id);
    try {
      const r = await authFetch("/api/ops", { method: "POST", body: JSON.stringify({ action: "ack", id }) });
      if (!r.ok) throw new Error("Couldn't acknowledge it.");
      setOps((o) => o && { ...o, alerts: o.alerts.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)) });
    } catch (err) {
      setOpsError(err instanceof Error ? err.message : "Couldn't acknowledge it.");
    } finally {
      setAcking(null);
    }
  }
  const openAlerts = ops?.alerts.filter((a) => !a.acknowledged_at) ?? [];

  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const card = isDark ? "glass-card" : "glass-card";
  const divider = isDark ? "border-white/5" : "border-gray-100";
  const field = `px-3 py-2 max-sm:min-h-[44px] max-sm:text-[16px] rounded-lg text-sm border cursor-pointer focus:outline-none ${
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
          {/* Push notifications: the iPhone app */}
          <section className={`rounded-xl border p-6 mb-6 ${card}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className={`text-[17px] font-semibold ${isDark ? "" : "text-gray-900"}`}>Push notifications</h2>
                <p className={`text-sm mt-1 ${subtle}`}>On your iPhone, the moment something arrives.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isNativeApp() && push !== "granted" && push !== "unsupported" && (
                  <button type="button" onClick={() => void turnOn()} className="rounded-full bg-[#6366f1] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f46e5] max-sm:min-h-[44px]">
                    Turn on notifications
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void sendTest()}
                  disabled={testing}
                  className={`rounded-full border px-4 py-2 text-sm font-medium max-sm:min-h-[44px] ${isDark ? "border-white/15 text-gray-200 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"} disabled:opacity-50`}
                >
                  {testing ? "Sending…" : "Send a test notification"}
                </button>
              </div>
            </div>
            <p className={`mt-3 flex items-center gap-2 text-xs ${subtle}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${phones === null ? (isDark ? "bg-white/20" : "bg-gray-300") : !phones.configured ? "bg-amber-400" : phones.devices ? "bg-emerald-400" : "bg-amber-400"}`}
                aria-hidden
              />
              {phones === null
                ? "Checking…"
                : !phones.configured
                  ? "Not set up on the server yet."
                  : phones.devices
                    ? `${phones.devices} phone${phones.devices === 1 ? "" : "s"} set up${isNativeApp() ? (push === "granted" ? ", this one included." : push === "denied" ? "; this one has notifications off in iPhone Settings." : "; this one hasn't allowed them yet.") : "."}`
                    : isNativeApp()
                      ? "No phone set up yet. Turn them on here."
                      : "No phone set up yet. Open BFO on your iPhone and turn them on."}
              {pushNote && <span className={isDark ? "text-gray-300" : "text-gray-700"}>{pushNote}</span>}
            </p>
            <div className="mt-4">
              <Switch isDark={isDark} on={pushPrefs.mail} onToggle={() => void save(set(prefs, "push.mail", !pushPrefs.mail))} label="New email" hint="Mail to your BFO address, with the sender and subject." />
              {admin && <Switch isDark={isDark} on={pushPrefs.texts} onToggle={() => void save(set(prefs, "push.texts", !pushPrefs.texts))} label="Texts to the office" hint="Texts to BFO's number, including verification codes." />}
              <Switch isDark={isDark} on={pushPrefs.paper} onToggle={() => void save(set(prefs, "push.paper", !pushPrefs.paper))} label="Physical mail" hint="Paper mail arriving at the office's address." />
            </div>
          </section>

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
                  <span className={`px-3 py-1.5 rounded-full text-xs break-all ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"}`}>
                    {getUser()?.email} <span className={subtle}>(you)</span>
                  </span>
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1 max-sm:py-1.5 max-sm:pr-2.5 rounded-full text-xs border break-all ${
                        isDark ? "border-white/15 text-gray-300" : "border-gray-300 text-gray-700"
                      }`}
                    >
                      {email}
                      <button
                        onClick={() => removeRecipient(email)}
                        title="Remove"
                        aria-label={`Remove ${email}`}
                        className={`relative p-0.5 rounded-full cursor-pointer max-sm:after:absolute max-sm:after:-inset-[16px] max-sm:after:content-[''] ${isDark ? "hover:bg-white/10 text-gray-500 hover:text-white" : "hover:bg-black/10 text-gray-400 hover:text-black"}`}
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
                      className={`${field} max-sm:w-full`}
                      aria-label="Add a user as a recipient"
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
                    className="flex items-center gap-2 max-sm:w-full"
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
                      aria-label="Add a recipient by email"
                      className={`${field} cursor-text w-56 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1`}
                    />
                    <button
                      type="submit"
                      disabled={!manualEmail.trim()}
                      className={`px-3 py-2 max-sm:min-h-[44px] max-sm:px-4 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 ${
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

            <div className={`mt-5 pt-4 border-t ${divider} flex flex-wrap items-center gap-3`}>
              <button
                onClick={() => void sendSample()}
                disabled={sampleState === "sending"}
                className={`px-4 py-2 max-sm:min-h-[40px] rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
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
                className={`px-4 py-2 max-sm:min-h-[40px] rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
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
                <span role="status" className={`text-xs ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                  Sent to {getUser()?.email} — check your inbox
                </span>
              )}
            </div>
          </section>

          {/* System: what broke, and when each scheduled job last ran (admins) */}
          {admin && (
            <section className={`rounded-xl border p-6 mb-6 ${card}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className={`text-[17px] font-semibold ${isDark ? "" : "text-gray-900"}`}>System</h2>
                  <p className={`text-sm mt-1 ${subtle}`}>What broke, and when each scheduled job last ran.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadOps()}
                  className={`rounded-full border px-4 py-2 text-sm font-medium max-sm:min-h-[44px] ${isDark ? "border-white/15 text-gray-200 hover:bg-white/5" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                >
                  Refresh
                </button>
              </div>
              {opsError && <p className={`mt-3 text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>{opsError}</p>}

              <span className={`text-xs font-medium uppercase tracking-wider block mt-5 mb-2 ${subtle}`}>Alerts</span>
              {ops === null ? (
                <p className={`text-sm ${subtle}`}>Checking…</p>
              ) : openAlerts.length === 0 ? (
                <p className={`flex items-center gap-2 text-sm ${subtle}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  Nothing open.
                </p>
              ) : (
                <ul className={`divide-y ${divider}`}>
                  {openAlerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 py-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${isDark ? "text-gray-100" : "text-gray-900"}`}>{a.title}</div>
                        {a.detail && <div className={`mt-0.5 whitespace-pre-line break-words text-xs ${subtle}`}>{a.detail}</div>}
                        <div className={`mt-1 text-xs ${subtle}`}>
                          {a.kind} · {when(a.created_at)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void acknowledge(a.id)}
                        disabled={acking === a.id}
                        className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium max-sm:min-h-[40px] disabled:opacity-50 ${isDark ? "border-white/15 text-gray-200 hover:bg-white/10" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                      >
                        {acking === a.id ? "…" : "Acknowledge"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <span className={`text-xs font-medium uppercase tracking-wider block mt-5 mb-2 ${subtle}`}>Scheduled jobs</span>
              {ops === null ? (
                <p className={`text-sm ${subtle}`}>Checking…</p>
              ) : (
                <ul className={`divide-y ${divider}`}>
                  {ops.crons.map((c) => (
                    <li key={c.name} className="flex items-center gap-3 py-2.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${!c.started_at ? (isDark ? "bg-white/20" : "bg-gray-300") : c.ok === false ? "bg-red-400" : c.finished_at ? "bg-emerald-400" : "bg-amber-400"}`}
                        aria-hidden
                      />
                      <span className={`min-w-0 flex-1 text-sm ${isDark ? "text-gray-100" : "text-gray-900"}`}>
                        {c.name}
                        {c.note && <span className={`ml-2 text-xs ${subtle}`}>{c.note.split("\n")[0]}</span>}
                      </span>
                      <span className={`shrink-0 text-xs ${c.ok === false ? (isDark ? "text-red-400" : "text-red-700") : subtle}`}>
                        {!c.started_at ? "never ran" : c.ok === false ? `failed ${when(c.started_at)}` : c.finished_at ? `ok ${when(c.started_at)}` : `running since ${when(c.started_at)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

        </>
      )}
    </div>
  );
}

type OpsAlert = { id: string; kind: string; title: string; detail: string | null; created_at: string; acknowledged_at: string | null };
type CronLast = { name: string; started_at: string | null; finished_at: string | null; ok: boolean | null; note: string | null };

/** "just now", "12 min ago", "3 h ago", "2 days ago", or the date. */
function when(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
