import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, randomInt } from "node:crypto";

// ---------------------------------------------------------------------------
// Passwordless login for BFO.
//
// Flow: request-code (SMS or email via Bird.com) -> verify-code -> session.
// Anyone who attempts a login is recorded in app_users with status "incoming"
// and only gets a session once an owner approves them.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   BIRD_API_KEY, BIRD_WORKSPACE_ID, BIRD_SMS_CHANNEL_ID, BIRD_EMAIL_CHANNEL_ID
// Optional: BIRD_EMAIL_FROM_USERNAME, BIRD_EMAIL_FROM_NAME, APP_URL
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const APP_URL = process.env.APP_URL || "https://bfoffice.vercel.app";

const ALLOWED_ORIGINS = new Set([
  "https://bfoffice.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);

type AppUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: "incoming" | "approved" | "denied";
  role: "owner" | "member";
  verified_at: string | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

// ------------------------------- Supabase ---------------------------------

function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function sb<T = any>(path: string, init?: RequestInit): Promise<T> {
  const url = process.env.SUPABASE_URL!;
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!r.ok) throw new Error(`DB error (${r.status}): ${await r.text()}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

// --------------------------------- Bird ------------------------------------

async function birdSend(channelId: string, payload: unknown): Promise<void> {
  const key = process.env.BIRD_API_KEY;
  const workspace = process.env.BIRD_WORKSPACE_ID;
  if (!key || !workspace || !channelId) {
    throw new Error("Bird.com is not configured (missing BIRD_API_KEY / BIRD_WORKSPACE_ID / channel id)");
  }
  const r = await fetch(
    `https://api.bird.com/workspaces/${workspace}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `AccessKey ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  if (!r.ok) throw new Error(`Bird send failed (${r.status}): ${await r.text()}`);
}

function sendSms(phone: string, text: string): Promise<void> {
  return birdSend(process.env.BIRD_SMS_CHANNEL_ID!, {
    receiver: { contacts: [{ identifierValue: phone }] },
    body: { type: "text", text: { text } },
  });
}

function sendEmail(email: string, subject: string, html: string): Promise<void> {
  return birdSend(process.env.BIRD_EMAIL_CHANNEL_ID!, {
    receiver: { contacts: [{ identifierKey: "emailaddress", identifierValue: email }] },
    body: {
      type: "html",
      html: {
        html,
        metadata: {
          subject,
          emailFrom: {
            username: process.env.BIRD_EMAIL_FROM_USERNAME || "no-reply",
            displayName: process.env.BIRD_EMAIL_FROM_NAME || "Burton Family Office",
          },
        },
      },
    },
  });
}

async function notify(user: AppUser, subject: string, message: string): Promise<void> {
  if (user.phone) await sendSms(user.phone, message);
  else if (user.email) {
    await sendEmail(
      user.email,
      subject,
      `<div style="font-family:sans-serif;font-size:15px;color:#111"><p>${message}</p></div>`
    );
  }
}

// ------------------------------ Identifiers --------------------------------

function normalizeIdentifier(raw: string): { kind: "email" | "phone"; value: string } | null {
  const input = (raw || "").trim();
  if (!input) return null;
  if (input.includes("@")) {
    const email = input.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { kind: "email", value: email };
  }
  const digits = input.replace(/[^\d+]/g, "");
  const bare = digits.replace(/\D/g, "");
  if (digits.startsWith("+") && bare.length >= 8 && bare.length <= 15) {
    return { kind: "phone", value: `+${bare}` };
  }
  if (bare.length === 10) return { kind: "phone", value: `+1${bare}` };
  if (bare.length === 11 && bare.startsWith("1")) return { kind: "phone", value: `+${bare}` };
  return null;
}

function hashCode(identifier: string, code: string): string {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_KEY!)
    .update(`${identifier}:${code}`)
    .digest("hex");
}

function publicUser(u: AppUser) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role };
}

async function findUserByIdentifier(kind: "email" | "phone", value: string): Promise<AppUser | null> {
  const rows = await sb<AppUser[]>(`app_users?${kind}=eq.${encodeURIComponent(value)}&select=*`);
  return rows?.[0] ?? null;
}

async function userFromToken(req: VercelRequest): Promise<AppUser | null> {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const sessions = await sb<{ token: string; user_id: string; expires_at: string }[]>(
    `app_sessions?token=eq.${token}&select=*`
  );
  const session = sessions?.[0];
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
  const users = await sb<AppUser[]>(`app_users?id=eq.${session.user_id}&select=*`);
  const user = users?.[0];
  return user && user.status === "approved" ? user : null;
}

// -------------------------------- Actions ----------------------------------

async function requestCode(res: VercelResponse, identifierRaw: string) {
  const id = normalizeIdentifier(identifierRaw);
  if (!id) return res.status(400).json({ error: "Enter a valid email address or mobile number" });

  let user = await findUserByIdentifier(id.kind, id.value);
  if (!user) {
    // First contact: record them as an incoming user awaiting approval.
    const inserted = await sb<AppUser[]>(`app_users`, {
      method: "POST",
      body: JSON.stringify({ [id.kind]: id.value, name: id.kind === "email" ? id.value.split("@")[0] : null }),
    });
    user = inserted[0];
  }
  if (user.status === "denied") {
    // Don't reveal denial; behave like a pending request.
    return res.json({ ok: true, channel: id.kind === "phone" ? "sms" : "email" });
  }

  const code = String(randomInt(100000, 1000000));
  await sb(`login_codes?identifier=eq.${encodeURIComponent(id.value)}`, { method: "DELETE" });
  await sb(`login_codes`, {
    method: "POST",
    body: JSON.stringify({
      identifier: id.value,
      code_hash: hashCode(id.value, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    }),
  });

  if (id.kind === "phone") {
    await sendSms(id.value, `${code} is your BFO login code. It expires in 10 minutes.`);
  } else {
    await sendEmail(
      id.value,
      `${code} is your BFO login code`,
      `<div style="font-family:sans-serif;color:#111">
        <p>Your Burton Family Office login code:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p>
        <p style="color:#666">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
      </div>`
    );
  }
  return res.json({ ok: true, channel: id.kind === "phone" ? "sms" : "email" });
}

async function verifyCode(res: VercelResponse, identifierRaw: string, code: string) {
  const id = normalizeIdentifier(identifierRaw);
  if (!id || !/^\d{6}$/.test(code || "")) {
    return res.status(400).json({ error: "Invalid code" });
  }

  const rows = await sb<any[]>(
    `login_codes?identifier=eq.${encodeURIComponent(id.value)}&consumed=eq.false&select=*&order=created_at.desc&limit=1`
  );
  const rec = rows?.[0];
  if (!rec || new Date(rec.expires_at).getTime() < Date.now() || rec.attempts >= MAX_CODE_ATTEMPTS) {
    return res.status(400).json({ error: "Code expired — request a new one" });
  }
  if (hashCode(id.value, code) !== rec.code_hash) {
    await sb(`login_codes?id=eq.${rec.id}`, {
      method: "PATCH",
      body: JSON.stringify({ attempts: rec.attempts + 1 }),
    });
    return res.status(400).json({ error: "Incorrect code" });
  }
  await sb(`login_codes?id=eq.${rec.id}`, { method: "PATCH", body: JSON.stringify({ consumed: true }) });

  const user = await findUserByIdentifier(id.kind, id.value);
  if (!user || user.status === "denied") return res.json({ status: "incoming" });

  if (user.status !== "approved") {
    // Verified their contact but not yet granted access: leave them in the
    // incoming queue and ping the owners the first time it happens.
    const firstVerify = !user.verified_at;
    await sb(`app_users?id=eq.${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ verified_at: new Date().toISOString() }),
    });
    if (firstVerify) {
      try {
        const owners = await sb<AppUser[]>(`app_users?role=eq.owner&status=eq.approved&select=*`);
        for (const owner of owners || []) {
          await notify(
            owner,
            "BFO access request",
            `BFO: new access request from ${id.value}. Approve or deny it in Settings > Users.`
          );
        }
      } catch {
        // Owner notification is best-effort; the request is already queued.
      }
    }
    return res.json({ status: "incoming" });
  }

  const sessions = await sb<{ token: string }[]>(`app_sessions`, {
    method: "POST",
    body: JSON.stringify({
      user_id: user.id,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    }),
  });
  await sb(`app_users?id=eq.${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ last_login_at: new Date().toISOString(), verified_at: user.verified_at || new Date().toISOString() }),
  });
  return res.json({ status: "approved", token: sessions[0].token, user: publicUser(user) });
}

// -------------------------------- Handler ----------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = String(req.headers.origin || "");
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.has(origin) ? origin : "https://bfoffice.vercel.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (typeof req.body === "object" && req.body) || {};
  const action = String(body.action || "");

  try {
    // --- Unauthenticated actions ---
    if (action === "request-code") return await requestCode(res, String(body.identifier || ""));
    if (action === "verify-code")
      return await verifyCode(res, String(body.identifier || ""), String(body.code || ""));

    // --- Session actions ---
    const me = await userFromToken(req);
    if (!me) return res.status(401).json({ error: "Not signed in" });

    if (action === "me") return res.json({ user: publicUser(me) });

    if (action === "logout") {
      const token = String(req.headers.authorization || "").slice(7).trim();
      await sb(`app_sessions?token=eq.${token}`, { method: "DELETE" });
      return res.json({ ok: true });
    }

    // --- Owner-only user management ---
    if (me.role !== "owner") return res.status(403).json({ error: "Owner access required" });

    if (action === "list-users") {
      const users = await sb<AppUser[]>(`app_users?select=*&order=created_at.desc`);
      return res.json({ users });
    }

    const userId = String(body.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: "Invalid user id" });
    const targetRows = await sb<AppUser[]>(`app_users?id=eq.${userId}&select=*`);
    const target = targetRows?.[0];
    if (!target) return res.status(404).json({ error: "User not found" });

    if (action === "approve-user") {
      await sb(`app_users?id=eq.${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
      });
      try {
        await notify(
          target,
          "Your BFO access is approved",
          `Your BFO access has been approved. Sign in at ${APP_URL}/login`
        );
      } catch {
        // Approval stands even if the notification fails.
      }
      return res.json({ ok: true });
    }

    if (action === "deny-user") {
      if (target.role === "owner") return res.status(400).json({ error: "Owners can't be denied" });
      await sb(`app_users?id=eq.${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "denied" }),
      });
      await sb(`app_sessions?user_id=eq.${userId}`, { method: "DELETE" });
      return res.json({ ok: true });
    }

    if (action === "remove-user") {
      if (target.id === me.id) return res.status(400).json({ error: "You can't remove yourself" });
      if (target.role === "owner") return res.status(400).json({ error: "Owners can't be removed" });
      await sb(`app_users?id=eq.${userId}`, { method: "DELETE" });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err: any) {
    console.error("Auth error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
