import { sb } from "./auth.js";
import { errorText, log } from "./log.js";
import { notifyAdmins } from "./push.js";

/**
 * Something broke that the office should hear about without reading logs:
 * a row in ops_alerts (migration 20261027_ops_alerts, shown on the
 * Notifications page's System card) and a push to the approved owners and
 * admins. The same `kind` is raised once per six hours, so a cron failing
 * every hour makes one notice, not twenty-four. Never throws: an alert that
 * can't be raised is logged and nothing more.
 */

const ALERT_WINDOW_MS = 6 * 60 * 60_000;

type AlertOutcome = "sent" | "duplicate" | "failed";
type AlertOpts = {
  /** Re-alert window for this kind; the default is six hours. */
  windowMs?: number;
  /** Where tapping the notice opens; the System card by default. */
  url?: string;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function alertAdmins(kind: string, title: string, detail: unknown, opts: AlertOpts = {}): Promise<AlertOutcome> {
  const text = typeof detail === "string" ? detail : errorText(detail);
  try {
    log.error("alert", title, { kind, detail: text });
    const since = new Date(Date.now() - (opts.windowMs ?? ALERT_WINDOW_MS)).toISOString();
    const recent = await sb<{ id: string }[]>(`ops_alerts?kind=eq.${encodeURIComponent(kind)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
    if (recent?.length) return "duplicate";
    await sb("ops_alerts", { method: "POST", body: { kind, title: clip(title, 200), detail: clip(text, 4000) }, prefer: "return=minimal" });
    await notifyAdmins(
      {
        aps: { alert: { title: clip(title, 80), body: clip(text.replace(/\s+/g, " ").trim(), 180) }, sound: "default", "thread-id": "ops" },
        url: opts.url ?? "/notifications",
        alertKind: kind,
      },
      `ops:${kind}`
    );
    return "sent";
  } catch (err) {
    log.error("alert", "couldn't raise the alert", { kind, error: err });
    return "failed";
  }
}

/**
 * A handler that alerts on an error nothing else caught, then rethrows so the
 * platform still answers 500 (and a webhook's sender retries).
 */
export function alertOnThrow<A extends unknown[], R>(kind: string, title: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      await alertAdmins(kind, title, err);
      throw err;
    }
  };
}
