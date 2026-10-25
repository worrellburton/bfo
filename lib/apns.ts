import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

/**
 * Apple Push Notification service, token-based (an APNs key, .p8), over
 * HTTP/2 as Apple requires. Configured from the environment:
 *
 *   APNS_KEY_ID     the key's Key ID (developer.apple.com → Keys)
 *   APNS_TEAM_ID    the Apple Developer Team ID
 *   APNS_KEY_P8     the .p8 file's text (newlines may be written as \n)
 *   APNS_BUNDLE_ID  optional; com.burtonfamilyoffice.app by default
 *
 * A device token belongs to one APNs environment: production (TestFlight and
 * App Store builds) or sandbox (builds run from Xcode). A send tries the
 * device's known environment first, then the other on BadDeviceToken, and
 * reports which one took it.
 */

export type ApnsEnv = "production" | "sandbox";
export type ApnsConfig = { keyId: string; teamId: string; key: string; topic: string };
export type ApnsResult = { status: number; reason?: string; env: ApnsEnv };

const HOSTS: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
const TIMEOUT_MS = 6000;

export function apnsConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const key = process.env.APNS_KEY_P8?.trim();
  if (!keyId || !teamId || !key) return null;
  return { keyId, teamId, key, topic: process.env.APNS_BUNDLE_ID?.trim() || "com.burtonfamilyoffice.app" };
}

/** A .p8 as pasted into an environment variable: literal \n turned back into newlines, the PEM armour added if it was left off. */
export function pemOf(raw: string): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  if (text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

let cachedKey: { raw: string; key: KeyObject } | null = null;
let cachedJwt: { keyId: string; token: string; at: number } | null = null;

/** The provider token: an ES256 JWT, reused for 40 minutes (Apple accepts up to 60 and rejects refreshing more often than every 20). */
export function apnsJwt(cfg: ApnsConfig, now = Date.now()): string {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && now - cachedJwt.at < 40 * 60_000) return cachedJwt.token;
  if (!cachedKey || cachedKey.raw !== cfg.key) cachedKey = { raw: cfg.key, key: createPrivateKey(pemOf(cfg.key)) };
  const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key: cachedKey.key, dsaEncoding: "ieee-p1363" });
  const token = `${head}.${claims}.${b64url(signature)}`;
  cachedJwt = { keyId: cfg.keyId, token, at: now };
  return token;
}

function post(session: ClientHttp2Session, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { status: number; reason?: string }) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const req = session.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (h) => {
      status = Number(h[":status"]) || 0;
    });
    req.on("data", (c: string) => {
      data += c;
    });
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
      } catch {
        // not JSON: keep the status alone
      }
      finish({ status, reason });
    });
    req.on("error", (e) => finish({ status: 0, reason: e.message }));
    req.setTimeout(TIMEOUT_MS, () => {
      req.close();
      finish({ status: 0, reason: "timeout" });
    });
    req.end(body);
  });
}

/**
 * Send one payload to many devices. Each device is tried in its known
 * environment (production when unknown), and in the other one if Apple says
 * the token doesn't belong there. One HTTP/2 connection per environment.
 */
export async function sendApns(
  cfg: ApnsConfig,
  devices: { token: string; env?: ApnsEnv | null }[],
  payload: unknown,
  opts: { collapseId?: string; threadId?: string } = {},
): Promise<Map<string, ApnsResult>> {
  const out = new Map<string, ApnsResult>();
  if (!devices.length) return out;
  const sessions = new Map<ApnsEnv, ClientHttp2Session>();
  const session = (env: ApnsEnv) => {
    let s = sessions.get(env);
    if (!s || s.closed || s.destroyed) {
      s = connect(HOSTS[env]);
      s.on("error", () => undefined); // a failed connection surfaces as each request's error
      sessions.set(env, s);
    }
    return s;
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    authorization: `bearer ${apnsJwt(cfg)}`,
    "apns-topic": cfg.topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "content-type": "application/json",
  };
  if (opts.collapseId) headers["apns-collapse-id"] = opts.collapseId.slice(0, 64);
  try {
    await Promise.all(
      devices.map(async (d) => {
        const first: ApnsEnv = d.env === "sandbox" ? "sandbox" : "production";
        let r = await post(session(first), `/3/device/${d.token}`, headers, body);
        let env = first;
        if (r.status === 400 && r.reason === "BadDeviceToken") {
          env = first === "production" ? "sandbox" : "production";
          r = await post(session(env), `/3/device/${d.token}`, headers, body);
        }
        out.set(d.token, { ...r, env });
      }),
    );
  } finally {
    for (const s of sessions.values()) s.close();
  }
  return out;
}

/** True when Apple says the token will never work again: forget the device. */
export function deadToken(r: ApnsResult): boolean {
  return r.status === 410 || (r.status === 400 && (r.reason === "BadDeviceToken" || r.reason === "DeviceTokenNotForTopic"));
}
