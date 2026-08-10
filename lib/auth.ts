import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "admin" | "member" | "viewer";
export type Status = "incoming" | "approved" | "denied";

export type AppUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  status: Status;
  created_at: string;
  approved_at: string | null;
  verified_at: string | null;
  last_login_at: string | null;
};

export const CODE_TTL_MS = 10 * 60 * 1000; // code is good for 10 minutes
export const CODE_RESEND_MS = 45 * 1000; // don't let a number re-request faster than this
export const MAX_CODE_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Supabase (service key — these tables have RLS on and are only ever
//    touched from serverless functions) ────────────────────────────────

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new ConfigError("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
  return { url: url.replace(/\/$/, ""), key };
}

export class ConfigError extends Error {}

export async function sb<T = any>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<T> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

// ── Phone numbers ─────────────────────────────────────────────────────

/** Normalize loose user input to E.164, assuming +1 for bare 10-digit input. */
export function normalizePhone(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (hasPlus) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else e164 = `+${digits}`;

  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

// ── Identifiers (a sign-in is by phone number or by email) ────────────

export type Identifier = { kind: "phone" | "email"; value: string };

export function normalizeEmail(raw: string): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
}

/** Figure out whether the user typed a phone number or an email, and clean it up. */
export function normalizeIdentifier(raw: string): Identifier | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    return email ? { kind: "email", value: email } : null;
  }
  const phone = normalizePhone(trimmed);
  return phone ? { kind: "phone", value: phone } : null;
}

// ── One-time codes ────────────────────────────────────────────────────

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(phone: string, code: string): string {
  const pepper = process.env.AUTH_SECRET ?? "";
  return createHash("sha256").update(`${pepper}:${phone}:${code}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Bird ──────────────────────────────────────────────────────────────
//
// Built to https://docs.bird.com/api/quickstarts/send-an-sms-message:
//
//   POST https://api.bird.com/workspaces/{workspaceId}/channels/{channelId}/messages
//   Authorization: AccessKey <token>
//
// Two things the docs are emphatic about and are easy to get wrong:
//   1. The access key needs the "Application Developer" role (Settings →
//      Security → Access Keys). Scopes alone are not enough — a key without
//      it authenticates as nothing and every call 401s.
//   2. workspaceId is a UUID, not the ws_… identifier shown in dashboard URLs.
//
// So rather than trusting configuration, discover both the workspace and the
// channels from the API and cache the result for the life of the instance.

const BIRD_API = "https://api.bird.com";

type BirdChannel = { id: string; name: string; platformId: string; status: string };
type BirdWorkspace = { id: string; name?: string };

function birdKey(): string {
  const key = process.env.BIRD_ACCESS_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!key) throw new ConfigError("BIRD_ACCESS_KEY is not set");
  return key;
}

function configuredWorkspace(): string | null {
  const raw = process.env.BIRD_WORKSPACE_ID?.trim().replace(/^["']|["']$/g, "");
  return raw || null;
}

async function birdFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BIRD_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `AccessKey ${birdKey()}`,
    },
  });
}

let workspaceCache: string | null = null;
let channelCache: BirdChannel[] | null = null;

/** The configured UUID if there is one, otherwise the first workspace the key can see. */
export async function birdWorkspace(): Promise<string> {
  if (workspaceCache) return workspaceCache;

  const configured = configuredWorkspace();
  if (configured) {
    workspaceCache = configured;
    return configured;
  }

  const res = await birdFetch("/workspaces");
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 401) {
      throw new ConfigError(
        "Bird rejected the access key (401). Create the key under Settings → Security → " +
          "Access Keys with the \"Application Developer\" role, then redeploy."
      );
    }
    throw new ConfigError(`Couldn't list Bird workspaces (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { results?: BirdWorkspace[]; workspaces?: BirdWorkspace[] };
  const found = (data.results ?? data.workspaces ?? [])[0];
  if (!found?.id) {
    throw new ConfigError("This Bird access key can't see any workspace.");
  }
  workspaceCache = found.id;
  return found.id;
}

async function listChannels(): Promise<BirdChannel[]> {
  if (channelCache) return channelCache;

  const workspaceId = await birdWorkspace();
  const res = await birdFetch(`/workspaces/${workspaceId}/channels?limit=100`);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error(`bird channels ${res.status} (workspace ${workspaceId}): ${detail}`);
    if (res.status === 401) {
      throw new ConfigError(
        "Bird rejected the access key (401). It needs the \"Application Developer\" role."
      );
    }
    if (res.status === 404) {
      throw new ConfigError(
        "This Bird key can send but can't list channels — its scopes cover the sms/emails " +
          "products, not channel management. Set BIRD_SMS_CHANNEL_ID and BIRD_EMAIL_CHANNEL_ID " +
          "(from the channel's URL in the Bird dashboard) and discovery is skipped entirely."
      );
    }
    throw new ConfigError(`Couldn't list Bird channels (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { results?: BirdChannel[] };
  channelCache = data.results ?? [];
  return channelCache;
}

export async function birdChannels(): Promise<BirdChannel[]> {
  return listChannels();
}

/** Pick the channel to send on: an explicit id wins, else the workspace's own. */
async function resolveChannel(kind: "sms" | "email"): Promise<string> {
  const override =
    kind === "sms" ? process.env.BIRD_SMS_CHANNEL_ID?.trim() : process.env.BIRD_EMAIL_CHANNEL_ID?.trim();
  if (override) return override;

  const matches = kind === "sms" ? /sms/i : /e?mail/i;
  const channels = await listChannels();
  const candidates = channels.filter(
    (c) => matches.test(c.platformId ?? "") || matches.test(c.name ?? "")
  );
  const chosen = candidates.find((c) => c.status === "active") ?? candidates[0];

  if (!chosen) {
    const seen = channels.map((c) => `${c.platformId}(${c.status})`).join(", ") || "none";
    throw new ConfigError(
      `No ${kind} channel in this Bird workspace. Channels seen: ${seen}. ` +
        `Install one in Bird, or set BIRD_${kind.toUpperCase()}_CHANNEL_ID.`
    );
  }
  return chosen.id;
}

async function birdSend(channelId: string, payload: unknown): Promise<void> {
  const workspaceId = await birdWorkspace();
  const res = await birdFetch(`/workspaces/${workspaceId}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`bird ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export async function sendSms(to: string, text: string): Promise<void> {
  // Platform SMS product endpoint (matches the key's sms scope). A free-text
  // send needs a sender the workspace owns; set BIRD_SMS_FROM to that number.
  const from = process.env.BIRD_SMS_FROM?.trim();
  const res = await birdVerifyFetch("/v1/sms/messages", {
    to,
    text,
    category: "transactional",
    ...(from ? { from } : {}),
  });
  if (!res.ok) {
    throw new Error(`bird sms ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
  headers?: Record<string, string>
): Promise<void> {
  // Platform email product endpoint (matches the key's emails scope). The
  // sender must be on a domain verified in the Bird workspace.
  const from = process.env.BIRD_EMAIL_FROM?.trim() || "BFO <reports@burtonfamilyoffice.com>";
  const res = await birdVerifyFetch("/v1/email/messages", {
    from,
    to: [to],
    subject,
    text,
    html,
    ...(headers ? { headers } : {}),
  });
  if (!res.ok) {
    throw new Error(`bird email ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

// ── Bird Verify ───────────────────────────────────────────────────────
//
// Matches the official SDK (@messagebird/sdk), which is the ground truth the
// dashboard onboarding generates:
//
//   base   https://{region}.platform.bird.com   (region from the bk_{region}_ key prefix)
//   auth   Authorization: Bearer <api key>
//   create POST /v1/verify/verifications        { to: { phone_number | email_address } }
//   check  POST /v1/verify/verifications/check  { to, code } → { success, reason }
//
// Verify generates, delivers and checks the passcode itself — no workspace id,
// no channels, no templates. Re-creating for the same recipient resumes the
// pending verification (Bird enforces its own resend cooldown), and a wrong or
// expired code comes back as success:false with a reason, not an error.

function birdVerifyBase(): string {
  const key = birdKey();
  const region = /^bk_([a-z0-9]+)_/i.exec(key)?.[1]?.toLowerCase();
  if (!region) {
    throw new ConfigError(
      "BIRD_ACCESS_KEY is not in the bk_{region}_{token} format Verify expects."
    );
  }
  return `https://${region}.platform.bird.com`;
}

function verifyRecipient(identifier: Identifier) {
  return identifier.kind === "phone"
    ? { phone_number: identifier.value }
    : { email_address: identifier.value };
}

async function birdVerifyFetch(path: string, body: unknown): Promise<Response> {
  return fetch(`${birdVerifyBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${birdKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function verifyStart(identifier: Identifier): Promise<string> {
  const res = await birdVerifyFetch("/v1/verify/verifications", {
    to: verifyRecipient(identifier),
    // Phone codes go to the phone as a text. Without this, the workspace's
    // configured channel order applies — which had WhatsApp ahead of SMS.
    ...(identifier.kind === "phone" ? { options: { channels: ["sms"] } } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`bird verify start ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 429) {
      throw new ConfigError("Too many codes requested for this address. Wait a minute and try again.");
    }
    if (res.status === 422) {
      throw new ConfigError("Bird Verify didn't accept that address or number.");
    }
    throw new ConfigError(`Bird Verify rejected the request (${res.status}): ${text.slice(0, 160)}`);
  }
  const data = JSON.parse(text) as { id?: string };
  return data.id ?? "pending";
}

export type VerifyOutcome = "verified" | "failed" | "expired" | "spent";

export async function verifyCheck(identifier: Identifier, code: string): Promise<VerifyOutcome> {
  const res = await birdVerifyFetch("/v1/verify/verifications/check", {
    to: verifyRecipient(identifier),
    code,
  });
  const text = await res.text();

  // A finished (or never-started) verification is a 404 — nothing left to check.
  if (res.status === 404) return "expired";
  if (!res.ok) {
    console.error(`bird verify check ${res.status}: ${text.slice(0, 300)}`);
    return "failed";
  }

  const data = JSON.parse(text) as { success?: boolean; reason?: string };
  if (data.success) return "verified";
  if (data.reason === "expired") return "expired";
  if (data.reason && /attempt/i.test(data.reason)) return "spent";
  return "failed";
}

/** Deliver a sign-in code over whichever channel the identifier implies. */
export async function sendLoginCode(identifier: Identifier, code: string): Promise<void> {
  const minutes = Math.round(CODE_TTL_MS / 60000);
  if (identifier.kind === "phone") {
    await sendSms(
      identifier.value,
      `${code} is your BFO sign-in code. It expires in ${minutes} minutes.`
    );
    return;
  }
  await sendEmail(
    identifier.value,
    `${code} is your BFO sign-in code`,
    `${code} is your BFO sign-in code. It expires in ${minutes} minutes. If you didn't request this, ignore this message.`,
    `<!doctype html><html><body style="margin:0;background:#000;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:420px;background:#0b0b0b;border:1px solid rgba(255,255,255,0.12);border-radius:20px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:36px 32px;text-align:center;">
        <div style="font-size:34px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">BFO</div>
        <div style="margin-top:6px;font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:rgba(255,255,255,0.4);">Ledger Louise, LLC</div>
        <div style="margin:28px 0 10px;font-size:14px;color:rgba(255,255,255,0.6);">Your sign-in code</div>
        <div style="font-size:38px;font-weight:600;letter-spacing:0.3em;color:#ffffff;padding-left:0.3em;">${code}</div>
        <div style="margin-top:22px;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);">Expires in ${minutes} minutes.<br/>If you didn't request this, you can ignore this email.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
  );
}

// ── Sessions ──────────────────────────────────────────────────────────

export function bearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Resolve the caller's session token to a user, or null if it's dead. */
export async function currentUser(req: VercelRequest): Promise<AppUser | null> {
  const token = bearerToken(req);
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null;

  const sessions = await sb<Array<{ user_id: string; expires_at: string }>>(
    `app_sessions?token=eq.${encodeURIComponent(token)}&select=user_id,expires_at&limit=1`
  );
  const session = sessions?.[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const users = await sb<AppUser[]>(`app_users?id=eq.${session.user_id}&select=*&limit=1`);
  const user = users?.[0];
  if (!user || user.status !== "approved") return null;
  return user;
}

export function isAdmin(user: AppUser): boolean {
  return user.role === "owner" || user.role === "admin";
}

// ── HTTP plumbing ─────────────────────────────────────────────────────

export function publicUser(user: AppUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    phoneFormatted: formatPhone(user.phone),
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    approvedAt: user.approved_at,
    lastLoginAt: user.last_login_at,
  };
}

export function fail(res: VercelResponse, status: number, error: string, message?: string) {
  return res.status(status).json(message ? { error, message } : { error });
}

/** Shared entry guard: handles CORS preflight and method allow-listing. */
export function guard(
  req: VercelRequest,
  res: VercelResponse,
  methods: string[]
): boolean {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return false;
  }
  if (!methods.includes(req.method ?? "")) {
    fail(res, 405, "method_not_allowed");
    return false;
  }
  return true;
}

export function handleError(res: VercelResponse, err: unknown) {
  if (err instanceof ConfigError) {
    return fail(res, 503, "not_configured", err.message);
  }
  console.error(err);
  return fail(res, 500, "server_error", err instanceof Error ? err.message : String(err));
}
