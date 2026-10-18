import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sb, sendEmail } from "../lib/auth.js";
import { palm, palmMode } from "../lib/palm.js";
import { toEventRow, verifyPalmSignature, type PalmEvent } from "../lib/palm-webhook.js";
import { einPatch, formationPatch, summarizeFiling, type FormationState, type PalmFiling } from "../lib/palm-formation.js";
import { applyOps, readRows } from "../lib/tree.js";

/**
 * Palm calls this when something happens to a business it serves: mail the
 * state or a court sent to the registered agent (document.created), and the
 * agent service changing (registered_agent.*). Each event is kept once in
 * public.palm_events, tied to its BFO entity, for the entity page and Home
 * to show. Legal papers served on an entity also email the owners/admins.
 *
 * Set up in Palm Console → Webhooks: URL https://<site>/api/palm-webhook,
 * the document.created and registered_agent.* events, and the signing
 * secret in Vercel as PALM_WEBHOOK_SECRET.
 */

const SITE = process.env.SITE_URL?.replace(/\/$/, "") || "https://burtonfamilyoffice.com";

async function rawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function within<T>(ms: number, p: Promise<T>): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.PALM_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "not_configured" });

  const raw = await rawBody(req);
  const header = req.headers["palm-signature"];
  if (!verifyPalmSignature(raw, Array.isArray(header) ? header[0] : header, secret)) return res.status(401).json({ error: "bad_signature" });

  let event: PalmEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "bad_json" });
  }
  if (!event?.id || !event.type) return res.status(400).json({ error: "bad_event" });

  const row = toEventRow(event);
  const object = (event.data?.object ?? {}) as Record<string, unknown>;

  // Which BFO entity: the id stamped on the filing, else on the Palm business (only readable with a key in the same mode).
  let assetId: string | null = (object.metadata as Record<string, string> | undefined)?.bfo_asset_id ?? null;
  let entityName: string | null = null;
  if (!assetId && row.business_id && row.mode === palmMode()) {
    const business = await within(4000, palm<{ display_name?: string | null; metadata?: Record<string, string> }>(`/v1/business/${row.business_id}`));
    assetId = business?.metadata?.bfo_asset_id ?? null;
    entityName = business?.display_name ?? null;
  }

  // A formation (or its EIN) moving along: the entity's record follows it.
  if (assetId && event.type.startsWith("filing.") && (object.type === "formation" || object.type === "ein")) {
    await trackFiling(assetId, row.mode, object as unknown as PalmFiling).catch((err) => console.error("palm-webhook: couldn't record the filing", err));
  }

  try {
    const inserted = await sb<unknown[]>("palm_events?on_conflict=id", {
      method: "POST",
      body: { ...row, asset_id: assetId },
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    const isNew = Array.isArray(inserted) && inserted.length > 0;

    // Legal papers have a response deadline: tell the people who can act, once.
    if (isNew && row.mode === "live" && row.document_type === "service_of_process") {
      const people = await sb<{ email: string | null }[]>("app_users?status=eq.approved&role=in.(owner,admin)&select=email").catch(() => []);
      const to = [...new Set(people.map((p) => p.email).filter((e): e is string => !!e))];
      if (to.length) {
        const who = entityName || "one of your entities";
        const link = assetId ? `${SITE}/assets/${assetId}/compliance` : `${SITE}/assets`;
        await sendEmail(
          to,
          `Legal papers served on ${who}`,
          `Palm, as registered agent, received legal papers for ${who}${row.filename ? ` (${row.filename})` : ""}. There is usually a deadline to respond — open it now:\n${link}`,
          `<p>Palm, as registered agent, received <b>legal papers</b> for <b>${who.replace(/</g, "&lt;")}</b>${row.filename ? ` (${row.filename.replace(/</g, "&lt;")})` : ""}.</p><p>There is usually a deadline to respond.</p><p><a href="${link}">Open it in BFO</a></p>`,
          undefined,
          undefined,
          { idempotencyKey: `palm-${row.id}` },
        ).catch((err) => console.error("palm alert email failed", err));
      }
    }
  } catch (err) {
    console.error("palm webhook store failed", err);
    return res.status(500).json({ error: "store_failed" }); // Palm retries
  }
  return res.status(200).json({ ok: true });
}

/** Write a filing's state onto its entity (lib/palm-formation.ts). */
async function trackFiling(assetId: string, mode: "test" | "live", filing: PalmFiling): Promise<void> {
  if (!/^[\w-]{8,64}$/.test(assetId)) return;
  const row = (await readRows("assets", [assetId]))[0];
  const prev = ((row?.data ?? {}) as { palm?: Record<string, { formation?: FormationState }> }).palm?.[mode]?.formation ?? null;
  if (filing.type === "ein") {
    if (!prev) return;
    await applyOps([{ op: "update", path: ["assets", assetId], value: einPatch(filing, mode, prev) as never }]);
    return;
  }
  if (prev && prev.filingId !== filing.id) return; // a different filing than the one this record tracks
  const state = summarizeFiling(filing, prev);
  await applyOps([{ op: "update", path: ["assets", assetId], value: formationPatch(state, mode, filing.business_id ?? undefined) as never }]);
}
