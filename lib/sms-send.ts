import { birdPlatformFetch, sb } from "./auth.js";
import { HELP_REPLY, keywordOf, MAX_SEGMENTS, MAX_TEXT, optedOutAt, smsSegments, toE164, withStopLine } from "./sms-compose.js";
import { forOurNumber, textNumber } from "./sms-inbound.js";
import { scopeIn } from "./sms-setup.js";
export { SMS_STATUS_EVENTS } from "./sms-setup.js";

/**
 * Texting from BFO's Bird number, for the Phone page: POST /v1/sms/messages
 * from textNumber() (category "service": replies, and people who agreed to
 * texts from the office), then the text kept in public.sms_messages as an
 * outbound row (direction 'out', id = Bird's sms_id). Bird's delivery
 * receipts (sms.sent, sms.delivered, sms.undelivered, sms.failed,
 * sms.rejected, sms.expired) reach api/mail-webhook.ts, which hands them to
 * applySmsStatus: the message is re-read from Bird by id and its status
 * moved forward, never back.
 *
 * Before a text goes, the number's history decides: a number whose newest
 * keyword was STOP isn't texted until it sends START; a number BFO has never
 * texted with needs the sender to confirm the person agreed to texts, and
 * that first text ends with "Reply STOP to opt out." A HELP gets the office's
 * name and how to stop (answerKeyword, for the webhook).
 *
 * Pure (tested on their own): Bird's refusals and failures in one plain
 * sentence, and which status wins when receipts arrive out of order. The
 * number, segment and keyword rules are lib/sms-compose.ts, shared with the
 * browser.
 *
 * HTTP surface: none. Called by api/texts.ts (owners and admins) and
 * api/mail-webhook.ts. Needs BIRD_ACCESS_KEY; BIRD_SMS_FROM optional (the
 * number texts go from).
 */

export { smsSegments, toE164 } from "./sms-compose.js";

/** A text that didn't go, with the reason in one plain sentence for the person sending it. */
export class SmsRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 422,
  ) {
    super(message);
  }
}

type BirdError = { type?: string; code?: string; name?: string; message?: string; param?: string; remediation?: string; details?: { param?: string }[] };
const birdError = (bodyText: string): BirdError => {
  try {
    return (JSON.parse(bodyText) as { error?: BirdError }).error ?? {};
  } catch {
    return {}; // Not JSON: the status says enough.
  }
};
/** Bird's 409 for an Idempotency-Key still being worked on by an earlier request (E01004): the same key must be used again. Pure. */
export const stillSending = (status: number, bodyText: string) => {
  const e = birdError(bodyText);
  return status === 409 && (e.code === "E01004" || /request_in_progress/i.test(e.name ?? ""));
};

/**
 * Bird's refusal of a send (HTTP status and its error body), as one sentence:
 * by its documented error names, type and param, never its message (Bird says
 * not to parse it; it's only shown when nothing else fits). Pure.
 */
export function refusalSentence(status: number, bodyText: string): string {
  const e = birdError(bodyText);
  const params = [e.param, ...(e.details ?? []).map((d) => d.param)];
  if (stillSending(status, bodyText)) return "Bird is still sending this text. Wait a moment, then tap Retry; it won't go twice.";
  if (status === 402 || e.type === "billing_error") return "Bird's balance is too low to send texts. Top up the wallet in Bird (Billing), then try again.";
  if (status === 429 || e.type === "rate_limit_error") return "Bird is getting too many texts from BFO right now. Wait a minute and try again.";
  if (status === 401 || status === 403) {
    const scope = scopeIn(bodyText);
    return `BFO's Bird key isn't allowed to send texts${scope ? ` (it needs the "${scope}" permission)` : ""}. Give it that permission in Bird (Settings → API keys).`;
  }
  if (e.name === "SMSSenderNotConfigured")
    return "BFO's sending number isn't a sender in this Bird workspace. BIRD_SMS_FROM in Vercel should be BFO's Bird number written +1 and ten digits (or unset), then redeploy.";
  if (e.name === "SenderCategoryNotPermitted") return "BFO's number isn't cleared to send these texts yet: its toll-free verification in Bird doesn't cover them. Texts will send once it does.";
  if (e.name === "SMSInvalidRecipient" || params.includes("to")) return "Bird says that isn't a valid phone number.";
  if (status >= 500) return "Bird couldn't take the text just now. Try again in a minute.";
  const said = e.remediation?.trim() || e.message?.trim();
  return `Bird didn't send it (HTTP ${status}${said ? `: ${said.slice(0, 160)}` : ""}).`;
}

type SmsError = { code?: string | null; description?: string | null } | null | undefined;

/** Why a sent text wasn't delivered (Bird's SMSError), as one sentence. Pure. */
export function failureSentence(err: SmsError, status?: string | null): string | null {
  const known: Record<string, string> = {
    invalid_destination: "That number isn't in service.",
    unreachable: "The phone was off or out of coverage.",
    blocked_by_carrier: "The carrier filtered it.",
    blocked_by_fraud_protection: "Bird's fraud protection held it.",
    blocked_by_recipient: "They've blocked BFO's number.",
    landline_unreachable: "That's a landline; it can't take texts.",
    content_rejected: "The carrier refused the wording.",
    sender_unregistered: "BFO's number isn't cleared to text yet: the toll-free verification isn't approved.",
    recipient_opted_out: "They've opted out of texts from BFO (they replied STOP).",
    provider_unavailable: "The carrier couldn't be reached.",
    insufficient_balance: "Bird's balance was too low to send it.",
  };
  const code = err?.code ?? "";
  if (known[code]) return known[code];
  const said = err?.description?.trim();
  if (said) return said.slice(0, 300);
  if (status === "expired") return "It wasn't delivered in time.";
  return isFailed(status) ? "The carrier didn't say why." : null;
}

const FINAL = new Set(["delivered", "undelivered", "failed", "rejected", "expired"]);
const RANK: Record<string, number> = { scheduled: 0, accepted: 1, sent: 2 };
const rank = (s: string | null | undefined) => (s && FINAL.has(s) ? 3 : (RANK[s ?? ""] ?? 0));
export const isFailed = (s: string | null | undefined) => !!s && FINAL.has(s) && s !== "delivered";

/**
 * The status to store when `incoming` arrives on a text now at `current`, or
 * null to leave it. A final status (delivered, or any way of not being
 * delivered) is never replaced, and nothing moves backwards: a late sms.sent
 * after sms.delivered changes nothing. Pure.
 */
export function nextStatus(current: string | null | undefined, incoming: string | null | undefined): string | null {
  if (!incoming || incoming === current) return null;
  if (current && FINAL.has(current)) return null;
  return rank(incoming) > rank(current) ? incoming : null;
}

export type SentText = {
  id: string;
  direction: "out";
  from: string;
  to: string;
  body: string;
  code: null;
  receivedAt: string;
  readAt: string;
  status: string;
  error: string | null;
  /** Who in the office sent it (their name), for "Sent by Jane". */
  sentBy: string | null;
  sentById: string | null;
};

/** The forms a number may be stored in ("+14805551234", "14805551234", "4805551234"), for a PostgREST in.() list. Pure. */
export function numberForms(e164: string): string[] {
  const d = e164.replace(/\D/g, "");
  const forms = new Set([e164, d]);
  if (/^1\d{10}$/.test(d)) forms.add(d.slice(1));
  return [...forms];
}

/** What BFO has exchanged with a number: whether anything at all, and when it opted out (null: it hasn't). */
export async function historyWith(e164: string): Promise<{ any: boolean; optedOutAt: string | null }> {
  const list = numberForms(e164)
    .map((f) => encodeURIComponent(`"${f}"`))
    .join(",");
  const rows =
    (await sb<{ direction: "in" | "out" | null; body: string | null; received_at: string }[] | null>(
      `sms_messages?or=(from_number.in.(${list}),to_number.in.(${list}))&select=direction,body,received_at&order=received_at.desc&limit=200`,
    )) ?? [];
  return { any: rows.length > 0, optedOutAt: optedOutAt(rows.map((r) => ({ direction: r.direction, body: r.body, receivedAt: r.received_at }))) };
}

/**
 * Sends `text` to `to` from BFO's number and keeps it. `key` (from the Phone
 * page, one per attempt) goes to Bird as the Idempotency-Key, so a retry after
 * a lost answer doesn't send twice. A number that opted out is refused; a
 * number BFO has never texted with is refused unless `consent` says the
 * person agreed to texts, and that first text ends with the STOP line.
 * Throws SmsRefused with a plain sentence. `first` says it was the first.
 */
export async function sendText({
  to,
  text,
  userId,
  userName = null,
  key,
  consent = false,
}: {
  to: string;
  text: string;
  userId: string;
  userName?: string | null;
  key?: string;
  /** The sender confirmed the person agreed to texts from the office (needed for a first text). */
  consent?: boolean;
}): Promise<SentText & { first: boolean }> {
  const from = textNumber();
  const number = toE164(to, from);
  if (!number.ok) throw new SmsRefused("bad_number", number.why, 400);
  const typed = text.trim();
  if (!typed) throw new SmsRefused("empty", "Write something to send.", 400);
  if (typed.length > MAX_TEXT) throw new SmsRefused("too_long", `A text can be at most ${MAX_TEXT} characters.`, 400);

  const history = await historyWith(number.e164);
  if (history.optedOutAt) throw new SmsRefused("opted_out", "They replied STOP, so BFO can't text them until they reply START.", 422);
  if (!history.any && !consent) throw new SmsRefused("consent_needed", "Confirm they've agreed to texts from the office before the first text.", 422);
  const first = !history.any;
  const body = first ? withStopLine(typed) : typed;
  if (body.length > MAX_TEXT || smsSegments(body).segments > MAX_SEGMENTS)
    throw new SmsRefused("too_long", `This text is too long: Bird sends at most ${MAX_SEGMENTS} parts. Shorten it and try again.`, 400);

  const sent = await deliver({ to: number.e164, body, key, sentBy: userId });
  return { ...sent, sentBy: userName, sentById: userId, first };
}

/**
 * A text that is a keyword (lib/sms-compose.ts keywordOf), answered as the
 * carriers expect: HELP gets the office's name and how to stop. STOP and
 * START are confirmed by the toll-free network itself, so nothing is sent for
 * them here. Called by api/mail-webhook.ts after it keeps an inbound text.
 */
export async function answerKeyword(row: { from_number: string; body: string | null }): Promise<"answered" | "none"> {
  if (keywordOf(row.body) !== "help") return "none";
  const number = toE164(row.from_number, textNumber());
  if (!number.ok) return "none";
  const history = await historyWith(number.e164);
  if (history.optedOutAt) return "none";
  await deliver({ to: number.e164, body: HELP_REPLY, sentBy: null });
  return "answered";
}

/** Bird's send and the stored row, shared by a person's text and the HELP answer. */
async function deliver({ to, body, key, sentBy }: { to: string; body: string; key?: string; sentBy: string | null }): Promise<Omit<SentText, "sentBy" | "sentById">> {
  const from = textNumber();
  const r = await birdPlatformFetch("/v1/sms/messages", {
    method: "POST",
    body: { to, from, text: body, category: "service" },
    ...(key && /^[\w-]{8,80}$/.test(key) ? { headers: { "Idempotency-Key": key } } : {}),
  });
  const answer = await r.text();
  if (!r.ok) {
    // Bird's structured answer only: its message can quote the number typed, and never the text.
    const e = birdError(answer);
    console.warn("sms-send: Bird refused a text", { status: r.status, type: e.type, code: e.code, name: e.name, param: e.param });
    // Still sending (409): the page keeps the key for its Retry, as it does after a 5xx.
    if (stillSending(r.status, answer)) throw new SmsRefused("still_sending", refusalSentence(r.status, answer), 409);
    throw new SmsRefused("bird_refused", refusalSentence(r.status, answer), r.status >= 500 ? 502 : 422);
  }
  const msg = JSON.parse(answer || "{}") as { id?: string; status?: string; from?: string; to?: string; created_at?: string; last_error?: SmsError };
  if (!msg.id) throw new Error("Bird accepted the text without an id");
  const now = new Date().toISOString();
  const row = {
    id: msg.id,
    direction: "out",
    from_number: (msg.from ?? from).slice(0, 40),
    to_number: (msg.to ?? to).slice(0, 40),
    body,
    code: null,
    // For an outbound row, when BFO sent it.
    received_at: msg.created_at && !Number.isNaN(Date.parse(msg.created_at)) ? new Date(msg.created_at).toISOString() : now,
    read_at: now,
    read_by: sentBy,
    sent_by: sentBy,
    status: msg.status ?? "accepted",
    // Refused at once (a suppressed recipient): the reason is in the 202 already, and its receipt changes nothing.
    error: isFailed(msg.status) ? failureSentence(msg.last_error, msg.status) : null,
    payload: msg,
  };
  try {
    // A replayed idempotent send returns the same id: the row is already there.
    await sb("sms_messages?on_conflict=id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=minimal" });
  } catch (err) {
    // Sent all the same: say so rather than invite a second send.
    console.error("sms-send: sent, but the copy couldn't be kept", err);
  }
  return { id: row.id, direction: "out", from: row.from_number, to: row.to_number, body, code: null, receivedAt: row.received_at, readAt: now, status: row.status, error: row.error };
}

/**
 * A delivery receipt from Bird's webhook (already signature-checked). The
 * event names the message; its status is re-read from Bird by id, never taken
 * from the event. A text BFO didn't send (another site's, in the shared
 * workspace) is ignored. One BFO did send that isn't stored yet (a rejection
 * can beat sendText's insert) throws, so the webhook answers 500 and Bird
 * delivers the receipt again.
 */
/** How long a receipt for one of BFO's texts with no stored row is retried, waiting for sendText's insert. */
const RECEIPT_WAIT_MS = 5 * 60_000;

export async function applySmsStatus(event: { type?: string; data?: { sms_id?: unknown; from?: unknown } }): Promise<"updated" | "unchanged" | "ignored"> {
  const id = event.data?.sms_id;
  if (typeof id !== "string" || !/^[\w.:-]{1,200}$/.test(id)) return "ignored";
  const rows = await sb<{ id: string; status: string | null }[]>(`sms_messages?id=eq.${encodeURIComponent(id)}&direction=eq.out&select=id,status`);
  const row = rows?.[0];
  // Another site's text (by the event's sender) is left without asking Bird; BFO's is confirmed with Bird below.
  const from = event.data?.from;
  if (!row && !(typeof from === "string" && from && forOurNumber(from))) return "ignored";
  const r = await birdPlatformFetch(`/v1/sms/messages/${encodeURIComponent(id)}`);
  if (r.status === 404) return "ignored";
  if (!r.ok) throw new Error(`Bird sms lookup ${r.status}`);
  const msg = (await r.json()) as { status?: string; from?: string; created_at?: string; last_error?: SmsError };
  if (!row) {
    if (!msg.from || !forOurNumber(msg.from)) return "ignored";
    // A text sent moments ago whose row isn't saved yet: Bird delivers the receipt again. Anything older was never
    // kept here (member invitations go out through lib/auth.ts sendSms), so retrying would only fail forever.
    const age = msg.created_at ? Date.now() - Date.parse(msg.created_at) : Infinity;
    if (!(age >= 0 && age < RECEIPT_WAIT_MS)) return "ignored";
    throw new Error("sms receipt arrived before its text was stored; Bird will deliver it again");
  }
  const status = nextStatus(row.status, msg.status);
  if (!status) return "unchanged";
  // Compare-and-set against any earlier status: of two receipts at once the further one wins, and a final status is never undone.
  const earlier = Object.keys(RANK).filter((s) => rank(s) < rank(status));
  const guard = `or=(status.is.null${earlier.length ? `,status.in.(${earlier.join(",")})` : ""})`;
  await sb(`sms_messages?id=eq.${encodeURIComponent(id)}&direction=eq.out&${guard}`, {
    method: "PATCH",
    body: { status, error: isFailed(status) ? failureSentence(msg.last_error, status) : null },
    prefer: "return=minimal",
  });
  return "updated";
}
