import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { apnsConfig, apnsJwt, deadToken, pemOf } from "../lib/apns";
import { TOKEN_RE, mailPayload, notifyNewMail, paperMailPayload } from "../lib/push";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("apns", () => {
  afterEach(() => {
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_KEY_P8;
  });

  it("is off until all three settings exist", () => {
    expect(apnsConfig()).toBeNull();
    process.env.APNS_KEY_ID = "ABC123DEFG";
    process.env.APNS_TEAM_ID = "TEAM123456";
    expect(apnsConfig()).toBeNull();
    process.env.APNS_KEY_P8 = P8;
    expect(apnsConfig()).toMatchObject({ keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "com.burtonfamilyoffice.app" });
  });

  it("reads a key pasted with \\n or without its armour", () => {
    expect(pemOf(P8.replace(/\n/g, "\\n"))).toBe(P8.trim());
    const bare = P8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(pemOf(bare)).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("signs an ES256 provider token Apple can verify", () => {
    const jwt = apnsJwt({ keyId: "ABC123DEFG", teamId: "TEAM123456", key: P8, topic: "x" }, 1_800_000_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    expect(Buffer.from(sig, "base64url").length).toBe(64);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("knows a dead token", () => {
    expect(deadToken({ status: 410, env: "production" })).toBe(true);
    expect(deadToken({ status: 400, reason: "BadDeviceToken", env: "sandbox" })).toBe(true);
    expect(deadToken({ status: 429, reason: "TooManyRequests", env: "production" })).toBe(false);
  });
});

describe("new-mail notices", () => {
  it("say who, what, and open the message", () => {
    const p = mailPayload({ id: "m1", user_id: "u", from_email: "elena@park.example", from_name: "Elena Park", subject: "Closing documents", snippet: "Everything is   signed.", thread_key: "t1" });
    expect(p.aps.alert).toEqual({ title: "Elena Park", subtitle: "Closing documents", body: "Everything is signed." });
    expect(p.aps["thread-id"]).toBe("t1");
    expect(p.url).toBe("/inbox?m=m1");
    const bare = mailPayload({ id: "m2", user_id: "u", from_email: "a@b.example", from_name: null, subject: null, snippet: null });
    expect(bare.aps.alert.title).toBe("a@b.example");
    expect(bare.aps.alert.subtitle).toBe("(no subject)");
  });

  it("for paper mail open that piece", () => {
    const p = paperMailPayload({ id: "mi_8f3a2c", from_name: " Wells Fargo ", recipient: "Ledger Louise LLC" });
    expect(p.url).toBe("/mailbox/mi_8f3a2c");
    expect(p.aps.alert).toEqual({ title: "Physical mail", subtitle: "Wells Fargo", body: "For Ledger Louise LLC" });
  });

  it("send nothing when the server has no APNs key", async () => {
    expect(await notifyNewMail([{ id: "m1", user_id: "u", from_email: "a@b.example", from_name: null, subject: "x", snippet: "y" }])).toBe(0);
  });

  it("accept only APNs-shaped tokens", () => {
    expect(TOKEN_RE.test("a".repeat(64))).toBe(true);
    expect(TOKEN_RE.test("not-a-token")).toBe(false);
  });
});
