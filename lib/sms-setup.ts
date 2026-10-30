import { birdPlatformFetch } from "./auth.js";

/**
 * Whether texts to BFO's Bird number can reach the Phone page, read from
 * Bird itself: the webhook that delivers mail (api/mail-webhook.ts) must
 * also carry sms.received and be active, the number must be one Bird says
 * can take SMS, and a signed test text sent through Bird's webhook test must
 * be accepted here (which proves the address and the signing secret). Used by api/texts.ts (?view=setup, fix-setup, replay) for the
 * Phone page's setup card. Needs BIRD_ACCESS_KEY (the workspace bk_ key).
 *
 * Beyond what blocks texts: whether the webhook also carries delivery
 * receipts (sms.sent, sms.delivered, …; without them a sent text stays
 * "Sent"), whether Bird lets the number send to the US (its SMS sender's
 * destinations: toll-free verification), and how many sms.received
 * deliveries to BFO's verified webhook failed in the last day, which a
 * replay (POST /v1/webhooks/{id}/replay) brings in.
 *
 * The one thing fixed from here is the webhook's event list or paused
 * state: a PATCH keeps the webhook's signing secret, so BIRD_WEBHOOK_SECRET
 * stays right. A missing webhook isn't created, because a new one comes with
 * a new secret that has to go into Vercel by hand.
 */

export const WEBHOOK_PATH = "/api/mail-webhook";
export const SITE_HOST = "www.burtonfamilyoffice.com";
const OUR_HOSTS = new Set([SITE_HOST, "burtonfamilyoffice.com"]);

export type BirdWebhook = { id: string; url: string; events?: string[] | null; status?: string | null };
/** Bird's answer to POST /v1/webhooks/{id}/test. */
export type WebhookTest = { status: "delivered" | "failed"; response_status_code: number | null; error?: string };
export type BirdNumber = { id?: string; number?: string | null; capabilities?: string[] | null; status?: string | null; number_type?: string | null };

/** The receipts that move a sent text's status (lib/sms-send.ts applySmsStatus). */
export const SMS_STATUS_EVENTS = ["sms.sent", "sms.delivered", "sms.undelivered", "sms.failed", "sms.rejected", "sms.expired"] as const;
export type BirdSender = { id: string; status?: string | null; destinations?: { active?: string[]; pending?: string[]; needs_attention?: string[] } | null; next?: { kind?: string; description?: string }[] | null };
/** One delivery attempt from GET /v1/webhooks/{id}/attempts. */
export type WebhookAttempt = { id: string; event_id?: string | null; event_type?: string; status: "delivered" | "pending" | "failed"; attempted_at?: string };

/** `blocking`: it stops texts arriving. A problem that isn't (delivery receipts missing) leaves `ok` true. */
export type SetupProblem = { code: string; message: string; fixable: boolean; blocking: boolean };
/** A list BFO's Bird key wasn't allowed (or able) to read, and the permission Bird named when it said so. */
export type Unreadable = { unreadable: true; status: number; scope: string | null };
const isUnreadable = (v: unknown): v is Unreadable => !!v && typeof v === "object" && (v as Unreadable).unreadable === true;

/** The permission Bird names when a key lacks it ("This request requires the \"numbers:read\" scope…"). Pure. */
export function scopeIn(text: string): string | null {
  return /requires the \\?"([\w.:-]{2,60})\\?" scope/.exec(text)?.[1] ?? null;
}
export type SmsSetup = {
  /** No blocking problem: texts reach BFO. */
  ok: boolean;
  webhook: { id: string; url: string; events: string[]; status: string | null } | null;
  number: { number: string; capabilities: string[]; status: string | null; type: string | null } | null;
  /** The signed test text: did BFO accept it? */
  test: { delivered: boolean; code: number | null } | null;
  problems: SetupProblem[];
  /** Checks Bird's key wasn't allowed to make; they don't block texts, but weren't confirmed. */
  notes: string[];
  /** Can BFO's number text US numbers (Bird's SMS sender for it)? Null when it couldn't be asked. */
  sending: { ready: boolean; state: "ready" | "pending" | "needs_attention" | "ownership" | "unknown"; message: string } | null;
  /** sms.received deliveries Bird couldn't make to BFO's verified webhook in the last day (null: not checked). The workspace is shared, so some may be another site's texts. */
  missed: number | null;
  /** Set when this answer follows a replay: Bird is sending the missed ones again. */
  replayed?: boolean;
};

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
};
const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};
const digits = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "");

/**
 * BFO's own webhook: at /api/mail-webhook on burtonfamilyoffice.com (www, or the bare domain that should be www).
 * The Bird workspace is shared with other sites that use the same path; their webhooks are never BFO's to read or change.
 */
export function bfoHooks(hooks: BirdWebhook[]): BirdWebhook[] {
  return hooks.filter((h) => pathOf(h.url) === WEBHOOK_PATH && OUR_HOSTS.has(hostOf(h.url)));
}

/** BFO's webhook: the one whose signed test BFO accepted, else the one carrying mail, else any. */
export function mailHook(hooks: BirdWebhook[], tests: Record<string, WebhookTest> = {}): BirdWebhook | null {
  const ours = bfoHooks(hooks);
  return ours.find((h) => tests[h.id]?.status === "delivered") ?? ours.find((h) => (h.events ?? []).includes("email.received")) ?? ours[0] ?? null;
}

/** Whether the number can text out: the US among its sender's active destinations, else why not, in plain words. Pure. */
export function sendingReadiness(senders: BirdSender[], ourNumber: string): NonNullable<SmsSetup["sending"]> {
  const sender = senders[0];
  if (!sender) return { ready: false, state: "unknown", message: `Bird lists no SMS sender for ${ourNumber}, so it can't send texts from it yet.` };
  const d = sender.destinations ?? {};
  const next = (sender.next ?? []).map((n) => n.description?.trim()).filter(Boolean).join(" ");
  const then = next ? ` Bird says: ${next}` : "";
  if ((d.active ?? []).includes("US")) return { ready: true, state: "ready", message: "BFO can text US numbers from this number." };
  if (sender.status === "pending_number_ownership")
    return { ready: false, state: "ownership", message: `Bird is waiting for the paperwork proving BFO owns this number; no text can be sent from it until that's accepted.${then}` };
  if ((d.needs_attention ?? []).includes("US"))
    return { ready: false, state: "needs_attention", message: `Bird needs something before BFO can text US numbers: the toll-free verification was refused, or US texting is switched off in Bird (SMS → Destinations).${then}` };
  if ((d.pending ?? []).includes("US"))
    return { ready: false, state: "pending", message: "The toll-free verification is under review with the carriers. BFO can text out once it's approved; texts still arrive here meanwhile." };
  return { ready: false, state: "needs_attention", message: `US texting isn't set up for this number yet: submit the toll-free verification in Bird (SMS → Senders).${then}` };
}

/** sms.received deliveries that failed and were never delivered since. Attempts name no number, so another site's texts (the workspace is shared) count too. Pure. */
export function missedTexts(attempts: WebhookAttempt[]): number {
  const texts = attempts.filter((a) => a.event_type === "sms.received");
  const delivered = new Set(texts.filter((a) => a.status === "delivered").map((a) => a.event_id ?? a.id));
  return new Set(texts.filter((a) => a.status === "failed" && !delivered.has(a.event_id ?? a.id)).map((a) => a.event_id ?? a.id)).size;
}

/** What stands between a text and the Phone page, from Bird's own answers. Pure. */
export function diagnose(
  hooksOrNot: BirdWebhook[] | Unreadable,
  numbersOrNot: BirdNumber[] | Unreadable,
  ourNumber: string,
  tests: Record<string, WebhookTest> = {},
  more: { senders?: BirdSender[] | Unreadable; attempts?: WebhookAttempt[] | Unreadable } = {}
): SmsSetup {
  // Everything below stops texts unless it says otherwise.
  const problems: (Omit<SetupProblem, "blocking"> & { blocking?: boolean })[] = [];
  const notes: string[] = [];
  const hooks = isUnreadable(hooksOrNot) ? null : hooksOrNot;
  const ours = hooks ? bfoHooks(hooks) : [];
  const hook = hooks ? mailHook(hooks, tests) : null;
  const test = hook ? tests[hook.id] ?? null : null;
  if (isUnreadable(hooksOrNot)) {
    const { scope, status } = hooksOrNot;
    problems.push({
      code: "cant_read_webhooks",
      message: scope
        ? `BFO's Bird key isn't allowed to read webhooks (it needs the "${scope}" permission), so BFO can't see whether Bird sends texts here. Either give the key that permission in Bird (Settings → API keys), or open Platform tools → Webhooks in Bird and tick sms.received on the webhook to https://${SITE_HOST}${WEBHOOK_PATH}.`
        : `Bird didn't answer BFO's question about its webhooks (HTTP ${status}).`,
      fixable: false,
    });
  } else if (!hook) {
    problems.push({
      code: "no_webhook",
      message: `Bird has no webhook for BFO. In Bird, Platform tools → Webhooks → Create webhook: endpoint https://${SITE_HOST}${WEBHOOK_PATH}, events email.received and sms.received. Copy its signing secret (whsec_…) into Vercel as BIRD_WEBHOOK_SECRET and redeploy. Leave other sites' webhooks as they are.`,
      fixable: false,
    });
  } else {
    const events = hook.events ?? [];
    if (!events.includes("sms.received")) problems.push({ code: "missing_event", message: "Bird's webhook to BFO doesn't include sms.received, so texts are never sent here.", fixable: true });
    if (SMS_STATUS_EVENTS.some((e) => !events.includes(e)))
      problems.push({
        code: "missing_receipts",
        message: "Bird's webhook to BFO doesn't carry delivery receipts (sms.delivered and the rest), so a text BFO sends shows as Sent but never Delivered or Not delivered.",
        fixable: true,
        blocking: false,
      });
    if (hostOf(hook.url) !== SITE_HOST) problems.push({ code: "wrong_host", message: `Bird's webhook to BFO uses the bare domain, not ${SITE_HOST}. The bare domain redirects, and Bird doesn't follow redirects.`, fixable: true });
    if (hook.status === "paused") problems.push({ code: "paused", message: "Bird's webhook to BFO is paused.", fixable: true });
    if (hook.status === "degraded") problems.push({ code: "degraded", message: "Bird reports that deliveries to BFO's webhook have been failing. Check that BIRD_WEBHOOK_SECRET in Vercel matches the webhook's signing secret.", fixable: false });
    if (test && test.status !== "delivered") {
      const code = test.response_status_code;
      problems.push({
        code: "test_failed",
        message:
          code === 401 && ours.length > 1
            ? `${ours.length} webhooks in Bird point at BFO, and BFO turned down the signed test from each: BIRD_WEBHOOK_SECRET in Vercel matches none of them. In Bird, open the webhook you made for BFO, copy its signing secret (it starts with whsec_), paste it into Vercel exactly, and redeploy. Point the other one back to its own site.`
            : code === 401
            ? "BFO turned down Bird's signed test: BIRD_WEBHOOK_SECRET in Vercel doesn't match this webhook's signing secret. In Bird, open the webhook, copy its signing secret (it starts with whsec_), paste it into Vercel exactly, and redeploy."
            : code === 503
              ? "BFO isn't set up to take Bird's webhook: BIRD_WEBHOOK_SECRET isn't set in Vercel."
              : code
                ? `BFO answered Bird's test text with HTTP ${code}.`
                : `Bird couldn't reach BFO's webhook${test.error ? ` (${test.error})` : ""}.`,
        fixable: false,
      });
    }
    // BFO's webhook works; another one also points here, signed with some other secret: another site's, re-pointed.
    const strays = test?.status === "delivered" ? ours.filter((h) => h.id !== hook.id && tests[h.id] && tests[h.id].status !== "delivered") : [];
    if (strays.length) {
      problems.push({
        code: "other_hook",
        message: `${strays.length === 1 ? "Another webhook" : `${strays.length} other webhooks`} in Bird also ${strays.length === 1 ? "points" : "point"} at BFO but ${strays.length === 1 ? "isn't" : "aren't"} signed with BFO's secret, so BFO turns ${strays.length === 1 ? "its" : "their"} deliveries away. If one belongs to another site (Impact Advisory's was re-pointed here), point it back to that site in Platform tools → Webhooks; otherwise delete it.`,
        fixable: false,
      });
    }
  }
  const numbers = isUnreadable(numbersOrNot) ? null : numbersOrNot;
  const mine = numbers?.find((n) => digits(n.number) && digits(n.number) === digits(ourNumber)) ?? null;
  if (isUnreadable(numbersOrNot)) {
    notes.push(
      numbersOrNot.scope
        ? `The number itself wasn't checked: BFO's Bird key needs the "${numbersOrNot.scope}" permission to look it up.`
        : `The number itself wasn't checked: Bird didn't answer (HTTP ${numbersOrNot.status}).`
    );
  } else if (!mine) {
    problems.push({ code: "no_number", message: `Bird doesn't list ${ourNumber} among this workspace's numbers, so it can't deliver texts to it here.`, fixable: false });
  } else {
    if (!(mine.capabilities ?? []).includes("sms")) problems.push({ code: "no_sms", message: `Bird says ${ourNumber} can't take SMS. Texting needs a number with the SMS capability.`, fixable: false });
    if (mine.status === "released") problems.push({ code: "released", message: `${ourNumber} has been released in Bird.`, fixable: false });
  }
  const { senders, attempts } = more;
  if (isUnreadable(senders)) notes.push(senders.scope ? `Sending wasn't checked: BFO's Bird key needs the "${senders.scope}" permission to read SMS senders.` : `Sending wasn't checked: Bird didn't answer${senders.status ? ` (HTTP ${senders.status})` : ""}.`);
  if (isUnreadable(attempts)) notes.push(attempts.scope ? `Missed texts weren't counted: BFO's Bird key needs the "${attempts.scope}" permission to read webhook deliveries.` : `Missed texts weren't counted: Bird didn't answer${attempts.status ? ` (HTTP ${attempts.status})` : ""}.`);
  const all: SetupProblem[] = problems.map((p) => ({ ...p, blocking: p.blocking ?? true }));
  return {
    ok: !all.some((p) => p.blocking),
    webhook: hook ? { id: hook.id, url: hook.url, events: hook.events ?? [], status: hook.status ?? null } : null,
    number: mine ? { number: mine.number ?? ourNumber, capabilities: mine.capabilities ?? [], status: mine.status ?? null, type: mine.number_type ?? null } : null,
    test: test ? { delivered: test.status === "delivered", code: test.response_status_code } : null,
    problems: all,
    notes,
    sending: senders && !isUnreadable(senders) ? sendingReadiness(senders, ourNumber) : null,
    missed: attempts && !isUnreadable(attempts) ? missedTexts(attempts) : null,
  };
}

/** The PATCH body that makes the mail webhook carry texts and their delivery receipts too, or null when there's nothing to change. Pure. */
export function fixBody(hook: BirdWebhook): Record<string, unknown> | null {
  // Only ever BFO's own webhook (mailHook); anything else is left alone.
  if (!OUR_HOSTS.has(hostOf(hook.url)) || pathOf(hook.url) !== WEBHOOK_PATH) return null;
  const body: Record<string, unknown> = {};
  const events = hook.events ?? [];
  const missing = ["sms.received", ...SMS_STATUS_EVENTS].filter((e) => !events.includes(e));
  if (missing.length) body.events = [...events, ...missing];
  if (hostOf(hook.url) !== SITE_HOST) body.url = `https://${SITE_HOST}${WEBHOOK_PATH}`;
  if (hook.status === "paused") body.status = "active";
  return Object.keys(body).length ? body : null;
}

/** A list, or why Bird wouldn't give it (a refused permission is an answer, not a crash). */
async function birdListOrWhy<T>(path: string): Promise<T[] | Unreadable> {
  try {
    return await birdList<T>(path);
  } catch (err) {
    if (err instanceof BirdRefused) return { unreadable: true, status: err.status, scope: err.scope };
    throw err;
  }
}

class BirdRefused extends Error {
  constructor(readonly status: number, readonly scope: string | null, message: string) {
    super(message);
  }
}

async function birdList<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  for (let page = 0; page < 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await birdPlatformFetch(`${path}${sep}limit=100${next ? `&starting_after=${encodeURIComponent(next)}` : ""}`);
    const text = await r.text();
    if (!r.ok) {
      const message = `Bird ${path.split("?")[0]} ${r.status}: ${text.slice(0, 200)}`;
      throw r.status === 401 || r.status === 403 ? new BirdRefused(r.status, scopeIn(text), message) : new Error(message);
    }
    const j = JSON.parse(text || "{}") as { data?: T[]; results?: T[]; next_cursor?: string | null };
    out.push(...(j.data ?? j.results ?? []));
    next = j.next_cursor ?? null;
    if (!next) break;
  }
  return out;
}

/** Has Bird send a signed, empty sms.received to the webhook; api/mail-webhook.ts answers it 200 without storing anything. */
async function testHook(id: string): Promise<WebhookTest> {
  const r = await birdPlatformFetch(`/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST", body: { event_type: "sms.received" } });
  const text = await r.text();
  if (!r.ok) return { status: "failed", response_status_code: null, error: `Bird's test call answered ${r.status}` };
  return JSON.parse(text) as WebhookTest;
}

/** For the checks beyond what blocks texts: any failure is a note, never a crash. */
const softly = <T>(p: Promise<T[] | Unreadable>): Promise<T[] | Unreadable> =>
  p.catch((err): Unreadable => ({ unreadable: true, status: Number(/ (\d{3}):/.exec(err instanceof Error ? err.message : "")?.[1] ?? 0), scope: null }));

const DAY_MS = 24 * 60 * 60_000;

/** Bird's answers, and a signed test text, diagnosed. */
export async function smsSetup(ourNumber: string): Promise<SmsSetup> {
  const [hooks, numbers] = await Promise.all([
    birdListOrWhy<BirdWebhook>("/v1/webhooks"),
    birdListOrWhy<BirdNumber>(`/v1/numbers?number=${encodeURIComponent(ourNumber)}`),
  ]);
  // Every webhook pointing at BFO gets a signed test: the one BFO accepts is BFO's.
  const ours = isUnreadable(hooks) ? [] : bfoHooks(hooks).slice(0, 5);
  const results = await Promise.all(
    ours.map((h) => testHook(h.id).catch((err): WebhookTest => ({ status: "failed", response_status_code: null, error: err instanceof Error ? err.message : String(err) })))
  );
  const tests = Object.fromEntries(ours.map((h, i) => [h.id, results[i]]));
  // The number's SMS sender (exactly one per number), and missed texts on the webhook BFO's own secret verifies, only.
  const mine = isUnreadable(numbers) ? null : numbers.find((n) => n.id && digits(n.number) === digits(ourNumber));
  const verified = ours.find((h) => tests[h.id]?.status === "delivered");
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [senders, attempts] = await Promise.all([
    mine?.id ? softly(birdListOrWhy<BirdSender>(`/v1/sms/senders?number_id=${encodeURIComponent(mine.id)}`)) : undefined,
    verified ? softly(birdListOrWhy<WebhookAttempt>(`/v1/webhooks/${encodeURIComponent(verified.id)}/attempts?after=${encodeURIComponent(since)}`)) : undefined,
  ]);
  return diagnose(hooks, numbers, ourNumber, tests, { senders, attempts });
}

/**
 * Has Bird send again what failed to reach BFO's webhook in the last day
 * (texts, and mail with them; a replay never delivers twice). Only the
 * webhook BFO's own secret verifies: another site's is never replayed.
 */
export async function replayMissedTexts(ourNumber: string): Promise<SmsSetup> {
  const before = await smsSetup(ourNumber);
  const id = before.test?.delivered ? before.webhook?.id : null;
  if (!id) return before;
  // A paused webhook redelivers nothing, and the replay would still count against the day's.
  if (before.webhook?.status === "paused") {
    before.notes.unshift("Bird's webhook to BFO is paused, so a replay would bring nothing in. Fix it in Bird first, then bring the missed texts in.");
    return before;
  }
  const now = Date.now();
  const r = await birdPlatformFetch(`/v1/webhooks/${encodeURIComponent(id)}/replay`, {
    method: "POST",
    body: { since: new Date(now - DAY_MS).toISOString(), until: new Date(now).toISOString() },
  });
  if (!r.ok) {
    const text = await r.text();
    if (r.status !== 401 && r.status !== 403 && r.status !== 429) throw new Error(`Bird webhook replay ${r.status}: ${text.slice(0, 200)}`);
    const scope = scopeIn(text);
    let quota = false;
    try {
      const e = (JSON.parse(text) as { error?: { name?: string; quota?: unknown } }).error;
      quota = e?.name === "WebhookReplayQuotaExceeded" || !!e?.quota;
    } catch {
      // Not JSON: an ordinary rate limit.
    }
    before.notes.unshift(
      r.status !== 429
        ? `BFO's Bird key isn't allowed to replay webhook deliveries${scope ? ` (it needs the "${scope}" permission)` : ""}.`
        : quota
          ? "Bird allows 20 replays a day across the organization (shared with Impact Advisory), and today's are used up. Try again tomorrow."
          : "Bird is busy with replays just now. Try again in a minute."
    );
    return before;
  }
  // Queued: the texts arrive over the next moments, and the count drops as they do.
  return { ...(await smsSetup(ourNumber)), replayed: true };
}

/** Adds sms.received and the delivery receipts to the mail webhook (and points it at www, and un-pauses it) when that's what's missing. */
export async function fixSmsSetup(ourNumber: string): Promise<SmsSetup> {
  const hooks = await birdListOrWhy<BirdWebhook>("/v1/webhooks");
  // Only the webhook BFO's own secret verifies is changed (smsSetup tested each one just now).
  const before = await smsSetup(ourNumber);
  const hook = isUnreadable(hooks) || !before.test?.delivered ? null : bfoHooks(hooks).find((h) => h.id === before.webhook?.id) ?? null;
  const body = hook ? fixBody(hook) : null;
  if (hook && body) {
    const r = await birdPlatformFetch(`/v1/webhooks/${encodeURIComponent(hook.id)}`, { method: "PATCH", body });
    if (!r.ok) {
      const text = await r.text();
      if (r.status !== 401 && r.status !== 403) throw new Error(`Bird webhook update ${r.status}: ${text.slice(0, 200)}`);
      // Allowed to look, not to change: say which permission, and the way to do it by hand.
      const after = await smsSetup(ourNumber);
      const scope = scopeIn(text);
      after.problems.unshift({
        code: "cant_update_webhook",
        message: `BFO's Bird key isn't allowed to change webhooks${scope ? ` (it needs the "${scope}" permission)` : ""}. Give it that permission in Bird (Settings → API keys), or tick the missing events (sms.received, ${SMS_STATUS_EVENTS.join(", ")}) yourself in Platform tools → Webhooks.`,
        fixable: false,
        blocking: false,
      });
      after.problems = after.problems.map((p) => ({ ...p, fixable: false }));
      after.ok = !after.problems.some((p) => p.blocking);
      return after;
    }
  }
  return smsSetup(ourNumber);
}
