import { useEffect, useState } from "react";
import { authFetch, getUser, isAdmin, type User } from "../auth";
import { isNativeApp } from "../native";
import { alertTitle, groupAlerts, jobStatus, jobTitle, scheduleLine, type CronLast, type OpsAlert } from "../notifications-model";
import { enablePush, usePushState } from "../push";
import {
  Badge,
  Banner,
  Button,
  Card,
  confirm,
  Disclosure,
  Field,
  format,
  IconButton,
  Input,
  List,
  ListRow,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Status,
  Switch,
  TextLink,
  toast,
  useDocumentTitle,
} from "../ui";

/**
 * Notifications: what BFO tells this person about, and how. Phone notices
 * (and what they show on a lock screen), the Treasury report's schedule and
 * who it goes to, and, for admins, the scheduled jobs and open alerts.
 * Every change saves at once (a toast says so).
 */

export function meta() {
  return [{ title: "Notifications · BFO" }];
}

type Prefs = Record<string, any>;

const FREQUENCIES = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PREVIEWS = [
  { value: "sender", label: "Sender only", hint: "Who it’s from" },
  { value: "full", label: "Sender, subject and first words" },
  { value: "none", label: "Nothing", hint: "“New email”" },
] as const;

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** An alert's detail as one plain line: its first line, up to any JSON (which stays behind "Technical details"). */
const plainLine = (detail: string | null) =>
  (detail ?? "")
    .split("\n")[0]
    .split(/\s*[{[]/)[0]
    .replace(/[:\s]+$/, "")
    .trim();

export default function Notifications() {
  useDocumentTitle("Notifications");
  const me = getUser();
  const admin = isAdmin(me);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/auth/preferences");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message ?? "Couldn’t load your settings.");
        setPrefs(data.preferences ?? {});
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Couldn’t load your settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(next: Prefs, said = "Saved") {
    const before = prefs;
    setPrefs(next);
    setSaveError("");
    try {
      const res = await authFetch("/api/auth/preferences", { method: "PUT", body: JSON.stringify({ preferences: next }) });
      if (!res.ok) throw new Error();
      toast({ message: said });
    } catch {
      setPrefs(before);
      setSaveError("Couldn’t save that change. Check your connection and try again.");
    }
  }

  // ── The Treasury report ────────────────────────────────────────────────
  const report = prefs.treasuryReport ?? {};
  const frequency: string = report.frequency ?? "off";
  const recipients: string[] = report.recipients ?? [];
  const [team, setTeam] = useState<User[]>([]);
  const [manualEmail, setManualEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/auth/users");
        if (!res.ok) return;
        const data = await res.json();
        setTeam((data.users ?? []).filter((u: User) => u.email && u.role !== "partner" && u.role !== "email"));
      } catch {
        /* without the roster only typed addresses can be added */
      }
    })();
  }, []);
  const staffEmails = new Set(team.map((u) => (u.email ?? "").toLowerCase()));
  const outside = (email: string) => team.length > 0 && !staffEmails.has(email.toLowerCase());
  const nameOf = (email: string) => team.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase())?.name ?? null;

  function addRecipient(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      setEmailError("Enter an email address, like name@example.com.");
      return;
    }
    setEmailError("");
    setManualEmail("");
    if (email === me?.email?.toLowerCase() || recipients.includes(email)) return;
    void save(set(prefs, "treasuryReport.recipients", [...recipients, email]), `Added ${email}`);
  }
  function removeRecipient(email: string) {
    void save(
      set(
        prefs,
        "treasuryReport.recipients",
        recipients.filter((r) => r !== email),
      ),
      `Removed ${email}`,
    );
  }

  async function sendSample() {
    setSampleBusy(true);
    setSaveError("");
    try {
      const res = await authFetch("/api/cron/treasury-report", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn’t send the sample.");
      toast({ message: `Sent a sample to ${me?.email}` });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t send the sample.");
    } finally {
      setSampleBusy(false);
    }
  }

  async function sendNow() {
    const list = [me?.email ?? "", ...recipients].filter(Boolean);
    const outsiders = list.filter((e) => outside(e));
    const ok = await confirm({
      title: "Send the report now?",
      object: { names: list.map((e) => `${e === me?.email ? "You" : (nameOf(e) ?? e)}${e !== me?.email && nameOf(e) ? ` · ${e}` : ""}${outside(e) ? " · outside BFO" : ""}`) },
      message: `The Treasury report goes to each person on their own: balances as of now and recent activity for every connected account, loans and expected income.${outsiders.length ? ` ${format.count(outsiders.length, "address is", "addresses are")} outside BFO.` : ""}`,
      details: ["Recorded in the audit log with who received it."],
      tone: "commit",
      confirmLabel: `Send to ${format.count(list.length, "person", "people")}`,
    });
    if (!ok) return;
    setSendBusy(true);
    setSaveError("");
    try {
      const res = await authFetch("/api/cron/treasury-report", { method: "POST", body: JSON.stringify({ broadcast: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn’t send the report.");
      toast({ message: `Sent the Treasury report to ${format.count(Number(data.count ?? list.length), "person", "people")}` });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn’t send the report.");
    } finally {
      setSendBusy(false);
    }
  }

  // ── Phone notices ──────────────────────────────────────────────────────
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
  const pushPrefs = { mail: prefs.push?.mail !== false, texts: prefs.push?.texts !== false, paper: prefs.push?.paper !== false, previews: (prefs.push?.previews as string) || "sender" };

  async function turnOn() {
    setPushNote("");
    const next = await enablePush();
    setPush(next);
    if (next === "granted") {
      toast({ message: "Notifications are on for this phone" });
      setTimeout(() => void loadPhones(), 1500);
    } else if (next === "denied") setPushNote("Notifications are off for BFO in iPhone Settings.");
  }
  async function sendTest() {
    setTesting(true);
    setPushNote("");
    try {
      const r = await authFetch("/api/push", { method: "POST", body: JSON.stringify({ action: "test" }) }).then((x) => x.json());
      if (r.sent) toast({ message: "Sent a test notice. Check your lock screen." });
      else
        setPushNote(
          r.error === "not_configured"
            ? "Phone notices aren’t set up on the server yet."
            : r.devices
              ? "Apple didn’t accept the test notice. Try again later."
              : "No phone is set up yet. Turn notices on in the BFO app on your iPhone.",
        );
    } catch {
      setPushNote("Couldn’t reach BFO. Check your connection and try again.");
    } finally {
      setTesting(false);
    }
  }

  // ── System (admins) ────────────────────────────────────────────────────
  const [ops, setOps] = useState<{ alerts: OpsAlert[]; crons: CronLast[] } | null>(null);
  const [opsError, setOpsError] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const loadOps = () =>
    authFetch("/api/ops")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        setOps({ alerts: d.alerts ?? [], crons: d.crons ?? [] });
        setOpsError(false);
      })
      .catch(() => setOpsError(true));
  useEffect(() => {
    if (admin) void loadOps();
  }, [admin]);
  async function acknowledge(key: string, ids: string[]) {
    setAcking(key);
    try {
      for (const id of ids) {
        const r = await authFetch("/api/ops", { method: "POST", body: JSON.stringify({ action: "ack", id }) });
        if (!r.ok) throw new Error();
      }
      const at = new Date().toISOString();
      setOps((o) => o && { ...o, alerts: o.alerts.map((a) => (ids.includes(a.id) ? { ...a, acknowledged_at: at } : a)) });
      toast({ message: ids.length === 1 ? "Marked as seen" : `Marked ${ids.length} as seen` });
    } catch {
      setOpsError(true);
    } finally {
      setAcking(null);
    }
  }
  const alertGroups = groupAlerts(ops?.alerts ?? []);

  const others = recipients.length;
  const schedule = scheduleLine(report, others);
  const addable = team.filter((u) => u.email && u.email.toLowerCase() !== me?.email?.toLowerCase() && !recipients.includes(u.email.toLowerCase()));

  return (
    <Page width="reading" header={<PageHeader title="Notifications" context="What BFO tells you about, and how." />}>
      {saveError && (
        <Banner tone="negative" onDismiss={() => setSaveError("")}>
          {saveError}
        </Banner>
      )}
      {loading ? (
        <>
          <Skeleton kind="card" rows={3} />
          <Skeleton kind="card" rows={3} />
        </>
      ) : loadError ? (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Banner>
      ) : (
        <>
          {/* ── Phone notices ─────────────────────────────────────── */}
          <Card
            title="On your iPhone"
            action={
              isNativeApp() && push !== "granted" && push !== "unsupported" ? (
                <Button variant="primary" size="sm" onClick={() => void turnOn()}>
                  Turn on notices
                </Button>
              ) : undefined
            }
          >
            <p className="text-body text-ink-2">
              {phones === null
                ? "Checking which phones are set up…"
                : !phones.configured
                  ? "Phone notices aren’t set up on the server yet."
                  : phones.devices
                    ? `${format.count(phones.devices, "phone")} set up${isNativeApp() ? (push === "granted" ? ", this one included." : push === "denied" ? ". This one has notices off in iPhone Settings." : ". This one hasn’t allowed them yet.") : "."}`
                    : isNativeApp()
                      ? "No phone set up yet. Turn notices on above."
                      : "No phone set up yet. Open BFO on your iPhone and turn notices on there."}
            </p>
            {pushNote && <p className="mt-1 text-body text-ink">{pushNote}</p>}
            <div className="mt-4 flex flex-col divide-y divide-line">
              <div className="py-2">
                <Switch checked={pushPrefs.mail} onChange={(v) => void save(set(prefs, "push.mail", v))} label="New email" hint="Mail to your BFO address." />
              </div>
              {admin && (
                <div className="py-2">
                  <Switch
                    checked={pushPrefs.texts}
                    onChange={(v) => void save(set(prefs, "push.texts", v))}
                    label="Texts to the office"
                    hint="Texts to BFO’s number. A notice never shows a verification code; texts with a code reach owners only."
                  />
                </div>
              )}
              <div className="py-2">
                <Switch
                  checked={pushPrefs.paper}
                  onChange={(v) => void save(set(prefs, "push.paper", v))}
                  label="Paper mail"
                  hint="Mail arriving at the office’s address: the sender and who it’s for."
                />
              </div>
              <div className="pt-3 pb-1">
                <Field label="What a notice shows on the lock screen" hint="A locked phone shows this without Face ID. Notices pass through Apple’s push service.">
                  <Select
                    label="What a notice shows on the lock screen"
                    value={pushPrefs.previews}
                    onChange={(v) => void save(set(prefs, "push.previews", v))}
                    options={PREVIEWS.map((p) => ({ ...p }))}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="sm" busy={testing} busyLabel="Sending…" onClick={() => void sendTest()}>
                Send a test notice
              </Button>
              <TextLink to="/legal/privacy" inline>
                Privacy
              </TextLink>
            </div>
          </Card>

          {/* ── The Treasury report ───────────────────────────────── */}
          <Card title="Treasury report" staffOnly>
            <p className="text-body text-pretty text-ink-2">An email with every connected account’s balance, the movement since your last report, recent activity, loans and expected income.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Send">
                <Select label="Send" value={frequency} onChange={(v) => void save(set(prefs, "treasuryReport.frequency", v))} options={FREQUENCIES.map((f) => ({ ...f }))} />
              </Field>
              {frequency === "weekly" && (
                <Field label="On">
                  <Select
                    label="On"
                    value={String(report.dayOfWeek ?? 1)}
                    onChange={(v) => void save(set(prefs, "treasuryReport.dayOfWeek", Number(v)))}
                    options={DAYS.map((d, i) => ({ value: String(i), label: d }))}
                  />
                </Field>
              )}
              {frequency === "monthly" && (
                <Field label="On day">
                  <Select
                    label="On day"
                    value={String(report.dayOfMonth ?? 1)}
                    onChange={(v) => void save(set(prefs, "treasuryReport.dayOfMonth", Number(v)))}
                    options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                  />
                </Field>
              )}
            </div>
            {schedule && <p className="mt-3 text-small text-ink-2">{schedule}</p>}

            {frequency !== "off" && (
              <div className="mt-6">
                <h3 className="text-small font-semibold text-ink">Send to</h3>
                <List label="Who gets the report" className="-mx-5 mt-1 px-1 touch:-mx-4">
                  <ListRow title={me?.name ? `${me.name} (you)` : "You"} secondary={me?.email ?? undefined} />
                  {recipients.map((email) => (
                    <ListRow
                      key={email}
                      title={nameOf(email) ?? email}
                      secondary={
                        <>
                          {nameOf(email) ? `${email}` : null}
                          {outside(email) && !admin ? `${nameOf(email) ? " · " : ""}Not sent: only an owner or admin can include an address outside BFO` : null}
                        </>
                      }
                      label={email}
                      meta={outside(email) ? <Badge>Outside BFO</Badge> : undefined}
                      action={<IconButton icon="x" label={`Remove ${email}`} onClick={() => removeRecipient(email)} />}
                    />
                  ))}
                </List>
                <div className="mt-4 flex flex-col gap-4">
                  {addable.length > 0 && (
                    <Field label="Add someone at BFO">
                      <Select
                        label="Add someone at BFO"
                        value={null}
                        placeholder="Choose a person…"
                        onChange={(v) => addRecipient(v)}
                        options={addable.map((u) => ({ value: (u.email ?? "").toLowerCase(), label: u.name ?? u.email ?? "", hint: u.email ?? undefined }))}
                      />
                    </Field>
                  )}
                  {admin && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addRecipient(manualEmail);
                      }}
                    >
                      <div className="flex items-end gap-2">
                        <Field label="Add an address outside BFO" className="min-w-0 flex-1">
                          <Input
                            type="email"
                            value={manualEmail}
                            onChange={(e) => {
                              setManualEmail(e.target.value);
                              setEmailError("");
                            }}
                            placeholder="name@example.com"
                            autoComplete="off"
                          />
                        </Field>
                        <Button type="submit" disabled={!manualEmail.trim()}>
                          Add
                        </Button>
                      </div>
                      <p className={emailError ? "mt-2 text-small text-negative" : "mt-2 text-small text-ink-2"} role={emailError ? "alert" : undefined}>
                        {emailError || "They get their own copy with a confidentiality notice, and can ask you to remove them."}
                      </p>
                    </form>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button busy={sampleBusy} busyLabel="Sending…" onClick={() => void sendSample()}>
                Send me a sample
              </Button>
              {admin && recipients.length > 0 && (
                <Button busy={sendBusy} busyLabel="Sending…" onClick={() => void sendNow()}>
                  Send now to the list
                </Button>
              )}
            </div>
          </Card>

          {/* ── System (admins) ───────────────────────────────────── */}
          {admin && (
            <Card
              title="System"
              count={alertGroups.length || undefined}
              countTone="attention"
              action={
                <Button variant="quiet" size="sm" onClick={() => void loadOps()}>
                  Refresh
                </Button>
              }
            >
              <p className="text-body text-ink-2">What went wrong, and when each scheduled job last ran. Only admins see this.</p>
              {opsError && (
                <Banner tone="negative" className="mt-3">
                  Couldn’t load the system status. Refresh to try again.
                </Banner>
              )}
              <h3 className="mt-5 text-small font-semibold text-ink">Alerts</h3>
              {ops === null && !opsError ? (
                <Skeleton kind="rows" rows={2} />
              ) : alertGroups.length === 0 ? (
                <p className="mt-1 text-body text-ink-2">Nothing open.</p>
              ) : (
                <List label="Open alerts" className="-mx-5 mt-1 px-1 touch:-mx-4">
                  {alertGroups.map((g) => (
                    <ListRow
                      key={g.key}
                      title={alertTitle(g)}
                      label={alertTitle(g)}
                      secondary={`${g.times > 1 ? `Happened ${g.times} times · last ` : ""}${format.relative(g.latest)}${plainLine(g.detail) ? ` · ${plainLine(g.detail)}` : ""}`}
                      action={
                        <Button variant="quiet" size="sm" busy={acking === g.key} busyLabel="Saving…" onClick={() => void acknowledge(g.key, g.ids)}>
                          Mark as seen
                        </Button>
                      }
                    />
                  ))}
                </List>
              )}
              {alertGroups.some((g) => g.detail) && (
                <Disclosure label="Technical details" className="mt-2">
                  <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-sunken p-4 font-mono text-caption whitespace-pre-wrap text-ink-2">
                    {alertGroups
                      .filter((g) => g.detail)
                      .map((g) => `${g.kind}\n${g.detail}`)
                      .join("\n\n")}
                  </pre>
                </Disclosure>
              )}

              <h3 className="mt-6 text-small font-semibold text-ink">Scheduled jobs</h3>
              {ops === null && !opsError ? (
                <Skeleton kind="rows" rows={4} />
              ) : (
                <List label="Scheduled jobs" className="-mx-5 mt-1 px-1 touch:-mx-4">
                  {(ops?.crons ?? []).map((c) => {
                    const st = jobStatus(c);
                    return (
                      <ListRow
                        key={c.name}
                        title={jobTitle(c.name)}
                        label={jobTitle(c.name)}
                        secondary={st.note ?? undefined}
                        trailing={st.tone === "neutral" ? <span className="text-small font-normal text-ink-2">{st.text}</span> : <Status tone={st.tone}>{st.text}</Status>}
                      />
                    );
                  })}
                </List>
              )}
              {(ops?.crons ?? []).some((c) => c.note && /^\s*[[{]|"\w+":|\d{4}-\d{2}-\d{2}T/.test(c.note)) && (
                <Disclosure label="Job details" className="mt-2">
                  <pre className="mt-2 max-h-64 overflow-auto rounded-card bg-sunken p-4 font-mono text-caption whitespace-pre-wrap text-ink-2">
                    {(ops?.crons ?? [])
                      .filter((c) => c.note)
                      .map((c) => `${c.name}\n${c.note}`)
                      .join("\n\n")}
                  </pre>
                </Disclosure>
              )}
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
