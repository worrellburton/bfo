import { sb } from "./auth.js";
import { apnsConfig, deadToken, sendApns, type ApnsEnv } from "./apns.js";

/**
 * Push notifications for the iPhone app: the devices people have allowed
 * notifications on (push_devices, migration 20261029_push_devices), and a
 * notice for each new message that lands in someone's inbox. A device
 * belongs to whoever last registered it, so switching accounts in the app
 * moves the phone's notifications with it.
 *
 * What a notice shows on the lock screen follows the person's "previews"
 * setting (Notifications page): "sender" (the default: who it's from, no
 * subject or words), "full" (sender, subject and the first words) or "none"
 * ("New email" alone). A verification code's value never goes in a notice,
 * whatever the setting: lock screens sit outside the app's Face ID lock and
 * the notice passes through Apple. Texts carrying a code go to owners only.
 *
 * HTTP surface: none; a library for api/push.ts, the mail and text webhooks
 * and the paper-mail sync.
 * Who may call it: server code.
 * Env: APNS_* (through lib/apns.ts), Supabase through sb().
 */

export const TOKEN_RE = /^[0-9a-f]{64,200}$/i;

type Device = { token: string; user_id: string; environment: ApnsEnv | null };

export async function registerDevice(userId: string, token: string, platform = "ios"): Promise<void> {
  await sb("push_devices?on_conflict=token", {
    method: "POST",
    body: { token: token.toLowerCase(), user_id: userId, platform, last_seen_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export async function unregisterDevice(userId: string, token: string): Promise<void> {
  await sb(`push_devices?token=eq.${encodeURIComponent(token.toLowerCase())}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
}

/**
 * What each person wants told about, from their notification_prefs.push
 * (the Notifications page). Everything is on until switched off.
 */
export type Previews = "sender" | "full" | "none";
type PushPrefs = { mail: boolean; texts: boolean; paper: boolean; previews: Previews };
export function pushPrefsOf(prefs: unknown): PushPrefs {
  const p = ((prefs as { push?: Partial<PushPrefs> } | null)?.push ?? {}) as Partial<PushPrefs>;
  const previews: Previews = p.previews === "full" || p.previews === "none" ? p.previews : "sender";
  return { mail: p.mail !== false, texts: p.texts !== false, paper: p.paper !== false, previews };
}

/** Digit runs masked, so a code inside a text never reaches a lock screen. */
export const maskCodes = (text: string) => text.replace(/\d(?:[\s-]?\d){3,}/g, (run) => run.replace(/\d/g, "•"));

type Person = { id: string; role: string; status: string; notification_prefs: unknown };

/** Approved members in these roles, with what they want told about. */
async function peopleIn(roles: string[]): Promise<Array<{ id: string; prefs: PushPrefs }>> {
  const rows = (await sb<Person[]>(`app_users?select=id,role,status,notification_prefs&role=in.(${roles.join(",")})&status=eq.approved`)) ?? [];
  return rows.map((r) => ({ id: r.id, prefs: pushPrefsOf(r.notification_prefs) }));
}

async function prefsFor(userIds: string[]): Promise<Map<string, PushPrefs>> {
  const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return new Map();
  const rows = (await sb<Person[]>(`app_users?select=id,role,status,notification_prefs&id=in.(${ids.join(",")})`)) ?? [];
  return new Map(rows.map((r) => [r.id, pushPrefsOf(r.notification_prefs)]));
}

export async function devicesFor(userIds: string[]): Promise<Device[]> {
  const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return [];
  return (await sb<Device[]>(`push_devices?user_id=in.(${ids.join(",")})&select=token,user_id,environment`)) ?? [];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export type NewMail = {
  id: string;
  user_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  thread_key?: string | null;
  occurred_at?: string | null;
};

/**
 * What a notice for one message says, by the person's previews setting:
 * the sender (default), the sender, subject and first words (full), or
 * nothing but "New email" (none). Tapping it opens the message.
 */
export function mailPayload(m: NewMail, previews: Previews = "sender") {
  const sender = m.from_name?.trim() || m.from_email || "New mail";
  const alert =
    previews === "full"
      ? { title: clip(sender, 80), subtitle: clip(m.subject?.trim() || "(no subject)", 120), body: clip(maskCodes((m.snippet ?? "").replace(/\s+/g, " ").trim()), 180) }
      : previews === "none"
        ? { title: "BFO", body: "New email" }
        : { title: clip(sender, 80), body: "New email" };
  return {
    aps: {
      alert,
      sound: "default",
      "thread-id": m.thread_key || m.id,
    },
    url: `/inbox?m=${m.id}`,
    messageId: m.id,
  };
}

/** Mail older than this (a backfill catching up) arrives without a notice. */
const FRESH_MS = 30 * 60_000;

type Notice = { to: string[]; payload: Record<string, unknown>; collapseId?: string };

/**
 * Notices to every device of the people named. Never throws: what's being
 * stored is stored whatever happens here. Devices Apple says are gone are
 * forgotten; the environment that took each one is kept.
 */
async function deliver(notices: Notice[], what: string): Promise<number> {
  const cfg = apnsConfig();
  if (!cfg || !notices.length) return 0;
  try {
    const devices = await devicesFor(notices.flatMap((n) => n.to));
    if (!devices.length) return 0;
    let sent = 0;
    const dead: string[] = [];
    const moved: { token: string; env: ApnsEnv }[] = [];
    for (const n of notices) {
      const mine = devices.filter((d) => n.to.includes(d.user_id));
      if (!mine.length) continue;
      const results = await sendApns(
        cfg,
        mine.map((d) => ({ token: d.token, env: d.environment })),
        n.payload,
        n.collapseId ? { collapseId: n.collapseId } : undefined,
      );
      for (const d of mine) {
        const r = results.get(d.token);
        if (!r) continue;
        if (r.status === 200) {
          sent++;
          if (r.env !== d.environment) moved.push({ token: d.token, env: r.env });
        } else if (deadToken(r)) dead.push(d.token);
        else console.warn("push: apns refused", r.status, r.reason);
      }
    }
    await Promise.all([
      dead.length ? sb(`push_devices?token=in.(${[...new Set(dead)].join(",")})`, { method: "DELETE" }) : null,
      ...moved.map((m) => sb(`push_devices?token=eq.${m.token}`, { method: "PATCH", body: { environment: m.env } })),
    ]).catch((err) => console.error("push: couldn't tidy devices", err));
    return sent;
  } catch (err) {
    console.error(`push: ${what} notices failed`, err);
    return 0;
  }
}

/** A notice to everyone who just received one of these messages (and wants to hear about mail). */
export async function notifyNewMail(rows: NewMail[], now = Date.now()): Promise<number> {
  if (!apnsConfig()) return 0;
  const fresh = rows.filter((r) => r.user_id && (!r.occurred_at || now - Date.parse(r.occurred_at) < FRESH_MS));
  if (!fresh.length) return 0;
  try {
    const prefs = await prefsFor(fresh.map((r) => r.user_id!));
    const wanted = fresh.filter((r) => prefs.get(r.user_id!)?.mail !== false);
    return await deliver(
      wanted.map((m) => ({ to: [m.user_id!], payload: mailPayload(m, prefs.get(m.user_id!)?.previews ?? "sender"), collapseId: m.id })),
      "new-mail",
    );
  } catch (err) {
    console.error("push: new-mail notices failed", err);
    return 0;
  }
}

type NewText = { id: string; from_number?: string | null; body?: string | null; code?: string | null };

/**
 * A notice for a text to the office's number. Never the code's value: "A
 * verification code arrived". The words show only with full previews, and
 * then with digit runs masked.
 */
export function textPayload(r: NewText, previews: Previews = "sender") {
  const body = maskCodes((r.body ?? "").replace(/\s+/g, " ").trim());
  const title = r.code ? "A verification code arrived" : "Text to the office";
  const alert =
    previews === "none"
      ? { title: "BFO", body: r.code ? "A verification code arrived" : "New text" }
      : previews === "full"
        ? { title, subtitle: clip(r.from_number || "Unknown number", 80), body: clip(body, 180) }
        : { title, body: clip(r.from_number || "Unknown number", 80) };
  return { aps: { alert, sound: "default", "thread-id": "texts" }, url: "/phone" };
}

/**
 * A text to the office's number, to those who want them (the Phone page):
 * owners and admins; a text carrying a verification code to owners only, so
 * a bank's code isn't spread across several people.
 */
export async function notifyNewTexts(rows: NewText[]): Promise<number> {
  if (!apnsConfig() || !rows.length) return 0;
  try {
    const people = (await peopleIn(["owner", "admin"])).filter((p) => p.prefs.texts);
    const owners = new Set((await peopleIn(["owner"])).map((p) => p.id));
    if (!people.length) return 0;
    const sends = rows.flatMap((r) => {
      const audience = r.code ? people.filter((p) => owners.has(p.id)) : people;
      const byPreview = new Map<Previews, string[]>();
      for (const p of audience) byPreview.set(p.prefs.previews, [...(byPreview.get(p.prefs.previews) ?? []), p.id]);
      return [...byPreview.entries()].map(([previews, to]) => ({ to, payload: textPayload(r, previews), collapseId: r.id }));
    });
    return await deliver(sends, "text");
  } catch (err) {
    console.error("push: text notices failed", err);
    return 0;
  }
}

type NewPaperMail = { id: string; from_name?: string | null; recipient?: string | null; received_at?: string | null };

/** What a notice for one piece of paper mail says; tapping it opens the piece. */
export function paperMailPayload(r: NewPaperMail) {
  return {
    aps: {
      alert: { title: "Physical mail", subtitle: clip(r.from_name?.trim() || "Unknown sender", 80), body: r.recipient ? clip(`For ${r.recipient}`, 180) : "Arrived at the office's address." },
      sound: "default",
      "thread-id": "paper-mail",
    },
    url: `/mailbox/${encodeURIComponent(r.id)}`,
  };
}

/** Physical mail at the office's address: staff who want to know (the piece's page). */
export async function notifyNewPaperMail(rows: NewPaperMail[], now = Date.now()): Promise<number> {
  if (!apnsConfig()) return 0;
  // A catch-up sync can bring older pieces: only today's arrivals ring.
  const fresh = rows.filter((r) => !r.received_at || now - Date.parse(r.received_at) < 24 * 60 * 60_000);
  if (!fresh.length) return 0;
  try {
    const to = (await peopleIn(["owner", "admin", "member"])).filter((p) => p.prefs.paper).map((p) => p.id);
    if (!to.length) return 0;
    return await deliver(
      fresh.map((r) => ({ to, payload: paperMailPayload(r), collapseId: r.id })),
      "paper-mail",
    );
  } catch (err) {
    console.error("push: paper-mail notices failed", err);
    return 0;
  }
}

/**
 * A notice to every approved owner and admin, whatever their preferences:
 * the office's own operational alerts (lib/alert.ts). Never throws.
 */
export async function notifyAdmins(payload: Record<string, unknown>, collapseId?: string): Promise<number> {
  if (!apnsConfig()) return 0;
  try {
    const to = (await peopleIn(["owner", "admin"])).map((p) => p.id);
    if (!to.length) return 0;
    return await deliver([{ to, payload, ...(collapseId ? { collapseId } : {}) }], "admin");
  } catch (err) {
    console.error("push: admin notices failed", err);
    return 0;
  }
}

/** A test notice to one person's devices (the app's "Send a test notification"). */
export async function notifyTest(userId: string): Promise<{ devices: number; sent: number; error?: string }> {
  const cfg = apnsConfig();
  if (!cfg) return { devices: 0, sent: 0, error: "not_configured" };
  const devices = await devicesFor([userId]);
  if (!devices.length) return { devices: 0, sent: 0 };
  const results = await sendApns(
    cfg,
    devices.map((d) => ({ token: d.token, env: d.environment })),
    {
      aps: { alert: { title: "BFO", body: "Notifications are working. New mail will show up here." }, sound: "default" },
      url: "/inbox",
    },
  );
  let sent = 0;
  let error: string | undefined;
  for (const d of devices) {
    const r = results.get(d.token);
    if (r?.status === 200) {
      sent++;
      if (r.env !== d.environment)
        await sb(`push_devices?token=eq.${encodeURIComponent(d.token)}`, { method: "PATCH", body: { environment: r.env } }).catch((err) =>
          console.error("push: couldn't record the device's environment", err),
        );
    } else if (r) error = `${r.status}${r.reason ? ` ${r.reason}` : ""}`;
  }
  return { devices: devices.length, sent, ...(error ? { error } : {}) };
}
