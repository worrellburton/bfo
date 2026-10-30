import type { VercelRequest, VercelResponse } from "@vercel/node";
import { alertAdmins, alertOnThrow } from "../lib/alert.js";
import { sb } from "../lib/auth.js";
import { getInbound, ingestInbound } from "../lib/mail.js";
import { verifyWebhook } from "../lib/mail-webhook.js";
import { smsRow } from "../lib/sms-inbound.js";
import { notifyNewTexts } from "../lib/push.js";

/**
 * Bird calls this when mail arrives for the family domain (email.received).
 * We fetch the message with the API key and file it into each recipient's
 * inbox (lib/mail.ts). Deliveries can repeat; copies already stored are
 * skipped. The inbox's own sync catches anything this misses.
 *
 * A text to BFO's Bird number (sms.received) is kept in public.sms_messages
 * for the Phone page (lib/sms-inbound.ts), once per text.
 *
 * Set up in Bird → Developers → Webhooks: URL https://<site>/api/mail-webhook,
 * events email.received and sms.received, and the signing secret in Vercel as
 * BIRD_WEBHOOK_SECRET.
 */

async function rawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const header = (req: VercelRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

type BirdEvent = { type?: string; data?: { inbound_message_id?: unknown } };

// An error nothing below caught alerts the admins (lib/alert.ts) and still answers 500, so Bird retries.
export default alertOnThrow("webhook:mail", "Mail webhook crashed", handle);

async function handle(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.BIRD_WEBHOOK_SECRET?.trim();
  if (!secret) return res.status(503).json({ error: "not_configured" });

  const raw = await rawBody(req);
  const signed = verifyWebhook(
    raw,
    { id: header(req, "webhook-id"), timestamp: header(req, "webhook-timestamp"), signature: header(req, "webhook-signature") },
    secret
  );
  if (!signed) return res.status(401).json({ error: "bad_signature" });

  let event: BirdEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "bad_json" });
  }
  if (event?.type === "sms.received") {
    // Bird's webhook test (the Phone page's setup check) is a signed event with no message: accepted, nothing kept.
    if (!(event as { data?: unknown }).data) return res.status(200).json({ ok: true, test: true });
    const row = smsRow(event, header(req, "webhook-id"));
    if (!row) return res.status(400).json({ error: "bad_event" });
    try {
      await sb("sms_messages?on_conflict=id", { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=minimal" });
      await notifyNewTexts([row]);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("sms webhook store failed", err);
      await alertAdmins("webhook:mail", "A text to the office couldn't be stored", err);
      return res.status(500).json({ error: "store_failed" }); // Bird retries
    }
  }
  if (event?.type !== "email.received") return res.status(200).json({ ok: true, ignored: true });

  const id = event.data?.inbound_message_id;
  if (typeof id !== "string" || !/^[\w-]{1,200}$/.test(id)) return res.status(400).json({ error: "bad_event" });

  try {
    const message = await getInbound(id);
    if (!message) return res.status(200).json({ ok: true, gone: true }); // past Bird's retention: nothing to retry
    const ingested = await ingestInbound(message);
    return res.status(200).json({ ok: true, ingested });
  } catch (err) {
    console.error("mail webhook ingest failed", err);
    await alertAdmins("webhook:mail", "Incoming mail couldn't be filed", `message ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(500).json({ error: "ingest_failed" }); // Bird retries
  }
}
