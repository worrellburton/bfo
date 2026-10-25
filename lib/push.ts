import { sb } from "./auth.js";
import { apnsConfig, deadToken, sendApns, type ApnsEnv } from "./apns.js";

/**
 * Push notifications for the iPhone app: the devices people have allowed
 * notifications on (push_devices, migration 20261029_push_devices), and a
 * notice for each new message that lands in someone's inbox. A device
 * belongs to whoever last registered it, so switching accounts in the app
 * moves the phone's notifications with it.
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

export async function devicesFor(userIds: string[]): Promise<Device[]> {
  const ids = [...new Set(userIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return [];
  return (await sb<Device[]>(`push_devices?user_id=in.(${ids.join(",")})&select=token,user_id,environment`)) ?? [];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export type NewMail = { id: string; user_id: string | null; from_email: string | null; from_name: string | null; subject: string | null; snippet: string | null; thread_key?: string | null; occurred_at?: string | null };

/** What a notice for one message says: the sender, the subject, the first words; tapping it opens the message. */
export function mailPayload(m: NewMail) {
  const sender = m.from_name?.trim() || m.from_email || "New mail";
  return {
    aps: {
      alert: { title: clip(sender, 80), subtitle: clip(m.subject?.trim() || "(no subject)", 120), body: clip((m.snippet ?? "").replace(/\s+/g, " ").trim(), 180) },
      sound: "default",
      "thread-id": m.thread_key || m.id,
    },
    url: `/inbox?m=${m.id}`,
    messageId: m.id,
  };
}

/** Mail older than this (a backfill catching up) arrives without a notice. */
const FRESH_MS = 30 * 60_000;

/**
 * A notice to every device of everyone who just received one of these
 * messages. Never throws: mail is stored whatever happens here. Devices Apple
 * says are gone are forgotten; the environment that took each one is kept.
 */
export async function notifyNewMail(rows: NewMail[], now = Date.now()): Promise<number> {
  const cfg = apnsConfig();
  if (!cfg) return 0;
  const fresh = rows.filter((r) => r.user_id && (!r.occurred_at || now - Date.parse(r.occurred_at) < FRESH_MS));
  if (!fresh.length) return 0;
  try {
    const devices = await devicesFor(fresh.map((r) => r.user_id!));
    if (!devices.length) return 0;
    let sent = 0;
    const dead: string[] = [];
    const moved: { token: string; env: ApnsEnv }[] = [];
    for (const m of fresh) {
      const mine = devices.filter((d) => d.user_id === m.user_id);
      if (!mine.length) continue;
      const results = await sendApns(cfg, mine.map((d) => ({ token: d.token, env: d.environment })), mailPayload(m), { collapseId: m.id });
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
    console.error("push: new-mail notices failed", err);
    return 0;
  }
}

/** A test notice to one person's devices (the app's "Send a test notification"). */
export async function notifyTest(userId: string): Promise<{ devices: number; sent: number; error?: string }> {
  const cfg = apnsConfig();
  if (!cfg) return { devices: 0, sent: 0, error: "not_configured" };
  const devices = await devicesFor([userId]);
  if (!devices.length) return { devices: 0, sent: 0 };
  const results = await sendApns(cfg, devices.map((d) => ({ token: d.token, env: d.environment })), {
    aps: { alert: { title: "BFO", body: "Notifications are working. New mail will show up here." }, sound: "default" },
    url: "/inbox",
  });
  let sent = 0;
  let error: string | undefined;
  for (const d of devices) {
    const r = results.get(d.token);
    if (r?.status === 200) {
      sent++;
      if (r.env !== d.environment) await sb(`push_devices?token=eq.${d.token}`, { method: "PATCH", body: { environment: r.env } }).catch(() => undefined);
    } else if (r) error = `${r.status}${r.reason ? ` ${r.reason}` : ""}`;
  }
  return { devices: devices.length, sent, ...(error ? { error } : {}) };
}
