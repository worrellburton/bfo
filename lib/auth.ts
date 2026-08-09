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

// ── Bird (SMS + email delivery) ───────────────────────────────────────

type BirdChannel = { id: string; name: string; platformId: string; status: string };

function birdConfig() {
  const accessKey = process.env.BIRD_ACCESS_KEY;
  const workspaceId = process.env.BIRD_WORKSPACE_ID;
  if (!accessKey || !workspaceId) {
    throw new ConfigError("BIRD_ACCESS_KEY and BIRD_WORKSPACE_ID must be set");
  }
  return { accessKey, workspaceId };
}

// Discovered channels are cached for the life of the lambda instance so a
// warm function doesn't re-list the workspace on every sign-in.
let channelCache: BirdChannel[] | null = null;

async function listChannels(): Promise<BirdChannel[]> {
  if (channelCache) return channelCache;
  const { accessKey, workspaceId } = birdConfig();
  const res = await fetch(`https://api.bird.com/workspaces/${workspaceId}/channels?limit=100`, {
    headers: { Authorization: `AccessKey ${accessKey}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`bird channels ${res.status} for workspace ${workspaceId}: ${detail}`);

    // A 404 here almost always means the workspace id doesn't belong to this
    // access key. Ask Bird which workspaces the key *can* see and log them, so
    // the fix is a copy-paste rather than a guess.
    if (res.status === 404 || res.status === 403) {
      try {
        const wsRes = await fetch("https://api.bird.com/workspaces", {
          headers: { Authorization: `AccessKey ${accessKey}` },
        });
        const body = await wsRes.text();
        console.error(`bird workspaces visible to this access key (${wsRes.status}): ${body}`);
      } catch (err) {
        console.error("bird workspace lookup failed:", err);
      }
      throw new ConfigError(
        "Bird doesn't recognize this workspace for the access key in use. " +
          "Check BIRD_WORKSPACE_ID, or set BIRD_SMS_CHANNEL_ID / BIRD_EMAIL_CHANNEL_ID directly."
      );
    }
    throw new ConfigError(`Couldn't list Bird channels (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { results?: BirdChannel[] };
  channelCache = data.results ?? [];
  return channelCache;
}

/**
 * Resolve the channel to send on. An explicit env var wins; otherwise pick the
 * first matching channel in the workspace, preferring an active one.
 */
async function resolveChannel(kind: "sms" | "email"): Promise<string> {
  const override =
    kind === "sms" ? process.env.BIRD_SMS_CHANNEL_ID : process.env.BIRD_EMAIL_CHANNEL_ID;
  if (override) return override;

  const matches = kind === "sms" ? /sms/i : /e?mail/i;
  const channels = await listChannels();
  const candidates = channels.filter(
    (c) => matches.test(c.platformId ?? "") || matches.test(c.name ?? "")
  );
  const chosen = candidates.find((c) => c.status === "active") ?? candidates[0];

  if (!chosen) {
    const seen = channels.map((c) => c.platformId).join(", ") || "none";
    throw new ConfigError(
      `No ${kind} channel in this Bird workspace (channels seen: ${seen}). ` +
        `Set BIRD_${kind.toUpperCase()}_CHANNEL_ID to choose one explicitly.`
    );
  }
  return chosen.id;
}

async function birdSend(channelId: string, payload: unknown): Promise<void> {
  const { accessKey, workspaceId } = birdConfig();

  const res = await fetch(
    `https://api.bird.com/workspaces/${workspaceId}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `AccessKey ${accessKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`bird ${res.status}: ${detail}`);
  }
}

export async function sendSms(to: string, text: string): Promise<void> {
  const channelId = await resolveChannel("sms");
  await birdSend(channelId, {
    receiver: { contacts: [{ identifierValue: to }] },
    body: { type: "text", text: { text } },
  });
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<void> {
  const channelId = await resolveChannel("email");
  await birdSend(channelId, {
    receiver: {
      contacts: [{ identifierKey: "emailaddress", identifierValue: to }],
    },
    body: { type: "html", html: { text, html, metadata: { subject } } },
  });
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
