import { birdPlatformFetch } from "./auth.js";

/**
 * Whether texts to BFO's Bird number can reach the Phone page, read from
 * Bird itself: the webhook that delivers mail (api/mail-webhook.ts) must
 * also carry sms.received and be active, the number must be one Bird says
 * can take SMS, and a signed test text sent through Bird's webhook test must
 * be accepted here (which proves the address and the signing secret). Used by api/texts.ts (?view=setup, fix-setup) for the
 * Phone page's setup card. Needs BIRD_ACCESS_KEY (the workspace bk_ key).
 *
 * The one thing fixed from here is the webhook's event list or paused
 * state: a PATCH keeps the webhook's signing secret, so BIRD_WEBHOOK_SECRET
 * stays right. A missing webhook isn't created, because a new one comes with
 * a new secret that has to go into Vercel by hand.
 */

export const WEBHOOK_PATH = "/api/mail-webhook";
export const SITE_HOST = "www.burtonfamilyoffice.com";

export type BirdWebhook = { id: string; url: string; events?: string[] | null; status?: string | null };
/** Bird's answer to POST /v1/webhooks/{id}/test. */
export type WebhookTest = { status: "delivered" | "failed"; response_status_code: number | null; error?: string };
export type BirdNumber = { id?: string; number?: string | null; capabilities?: string[] | null; status?: string | null; number_type?: string | null };

export type SetupProblem = { code: string; message: string; fixable: boolean };
export type SmsSetup = {
  ok: boolean;
  webhook: { id: string; url: string; events: string[]; status: string | null } | null;
  number: { number: string; capabilities: string[]; status: string | null; type: string | null } | null;
  /** The signed test text: did BFO accept it? */
  test: { delivered: boolean; code: number | null } | null;
  problems: SetupProblem[];
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

/** The webhook BFO's mail arrives through: the one at /api/mail-webhook carrying email.received, else any at that path. */
export function mailHook(hooks: BirdWebhook[]): BirdWebhook | null {
  const ours = hooks.filter((h) => pathOf(h.url) === WEBHOOK_PATH);
  return ours.find((h) => (h.events ?? []).includes("email.received")) ?? ours[0] ?? null;
}

/** What stands between a text and the Phone page, from Bird's own answers. Pure. */
export function diagnose(hooks: BirdWebhook[], numbers: BirdNumber[], ourNumber: string, test: WebhookTest | null = null): SmsSetup {
  const problems: SetupProblem[] = [];
  const hook = mailHook(hooks);
  if (!hook) {
    problems.push({
      code: "no_webhook",
      message: `Bird has no webhook pointing at BFO. In Bird, Platform tools → Webhooks, add https://${SITE_HOST}${WEBHOOK_PATH} with the events email.received and sms.received, and put its signing secret in Vercel as BIRD_WEBHOOK_SECRET.`,
      fixable: false,
    });
  } else {
    const events = hook.events ?? [];
    if (!events.includes("sms.received")) problems.push({ code: "missing_event", message: "Bird's webhook to BFO doesn't include sms.received, so texts are never sent here.", fixable: true });
    if (hostOf(hook.url) !== SITE_HOST) problems.push({ code: "wrong_host", message: `Bird's webhook points at ${hostOf(hook.url) || hook.url}, not ${SITE_HOST}. The bare domain redirects, and Bird doesn't follow redirects.`, fixable: true });
    if (hook.status === "paused") problems.push({ code: "paused", message: "Bird's webhook to BFO is paused.", fixable: true });
    if (hook.status === "degraded") problems.push({ code: "degraded", message: "Bird reports that deliveries to BFO's webhook have been failing. Check that BIRD_WEBHOOK_SECRET in Vercel matches the webhook's signing secret.", fixable: false });
    if (test && test.status !== "delivered") {
      const code = test.response_status_code;
      problems.push({
        code: "test_failed",
        message:
          code === 401
            ? "BFO turned down Bird's signed test: BIRD_WEBHOOK_SECRET in Vercel doesn't match this webhook's signing secret."
            : code === 503
              ? "BFO isn't set up to take Bird's webhook: BIRD_WEBHOOK_SECRET isn't set in Vercel."
              : code
                ? `BFO answered Bird's test text with HTTP ${code}.`
                : `Bird couldn't reach BFO's webhook${test.error ? ` (${test.error})` : ""}.`,
        fixable: false,
      });
    }
  }
  const mine = numbers.find((n) => digits(n.number) && digits(n.number) === digits(ourNumber)) ?? null;
  if (!mine) {
    problems.push({ code: "no_number", message: `Bird doesn't list ${ourNumber} among this workspace's numbers, so it can't deliver texts to it here.`, fixable: false });
  } else {
    if (!(mine.capabilities ?? []).includes("sms")) problems.push({ code: "no_sms", message: `Bird says ${ourNumber} can't take SMS. Texting needs a number with the SMS capability.`, fixable: false });
    if (mine.status === "released") problems.push({ code: "released", message: `${ourNumber} has been released in Bird.`, fixable: false });
  }
  return {
    ok: problems.length === 0,
    webhook: hook ? { id: hook.id, url: hook.url, events: hook.events ?? [], status: hook.status ?? null } : null,
    number: mine ? { number: mine.number ?? ourNumber, capabilities: mine.capabilities ?? [], status: mine.status ?? null, type: mine.number_type ?? null } : null,
    test: test ? { delivered: test.status === "delivered", code: test.response_status_code } : null,
    problems,
  };
}

/** The PATCH body that makes the mail webhook carry texts too, or null when there's nothing to change. Pure. */
export function fixBody(hook: BirdWebhook): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const events = hook.events ?? [];
  if (!events.includes("sms.received")) body.events = [...events, "sms.received"];
  if (hostOf(hook.url) !== SITE_HOST && pathOf(hook.url) === WEBHOOK_PATH) body.url = `https://${SITE_HOST}${WEBHOOK_PATH}`;
  if (hook.status === "paused") body.status = "active";
  return Object.keys(body).length ? body : null;
}

async function birdList<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  for (let page = 0; page < 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await birdPlatformFetch(`${path}${sep}limit=100${next ? `&starting_after=${encodeURIComponent(next)}` : ""}`);
    const text = await r.text();
    if (!r.ok) throw new Error(`Bird ${path.split("?")[0]} ${r.status}: ${text.slice(0, 200)}`);
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

/** Bird's answers, and a signed test text, diagnosed. */
export async function smsSetup(ourNumber: string): Promise<SmsSetup> {
  const [hooks, numbers] = await Promise.all([
    birdList<BirdWebhook>("/v1/webhooks"),
    birdList<BirdNumber>(`/v1/numbers?number=${encodeURIComponent(ourNumber)}`),
  ]);
  const hook = mailHook(hooks);
  const test = hook ? await testHook(hook.id).catch((err): WebhookTest => ({ status: "failed", response_status_code: null, error: err instanceof Error ? err.message : String(err) })) : null;
  return diagnose(hooks, numbers, ourNumber, test);
}

/** Adds sms.received to the mail webhook (and points it at www, and un-pauses it) when that's what's missing. */
export async function fixSmsSetup(ourNumber: string): Promise<SmsSetup> {
  const hook = mailHook(await birdList<BirdWebhook>("/v1/webhooks"));
  const body = hook ? fixBody(hook) : null;
  if (hook && body) {
    const r = await birdPlatformFetch(`/v1/webhooks/${encodeURIComponent(hook.id)}`, { method: "PATCH", body });
    if (!r.ok) throw new Error(`Bird webhook update ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return smsSetup(ourNumber);
}
