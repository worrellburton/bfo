import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { alertAdmins, alertOnThrow } from "../lib/alert.js";
import { sb, sendEmail } from "../lib/auth.js";
import { palm, palmMode } from "../lib/palm.js";
import { raPatch, type RaServiceLike } from "../lib/palm-agent.js";
import { monitorByBusiness } from "../lib/palm-monitor.js";
import { monitorPatch, toEventRow, verifyPalmSignature, type PalmEvent } from "../lib/palm-webhook.js";
import { einPatch, formationPatch, summarizeFiling, type FormationState, type PalmFiling } from "../lib/palm-formation.js";
import { applyOps, readRows } from "../lib/tree.js";

const PALM = { id: null, name: "Palm", source: "palm" } as const;

/**
 * Palm calls this when something happens to a business it serves: mail the
 * state or a court sent to the registered agent (document.created), and the
 * agent service changing (registered_agent.*). Each event is kept once in
 * public.palm_events, tied to its BFO entity, for the entity page and Home
 * to show. Legal papers served on an entity also email the owners/admins.
 *
 * A question Palm opens on a filing or on the business (case.opened/updated/
 * resolved) updates the formation's count of open questions, shows in
 * activity, and emails the owners and admins to answer it on the entity page.
 *
 * The agent service changing (registered_agent.*) is written onto the entity
 * the same way the page does when it reads the service (lib/palm-agent.ts),
 * so the record follows even when nobody has the page open.
 *
 * A registration Palm monitors (lib/palm-monitor.ts) changing at the state
 * (business.registration.updated) or a filing coming due or going overdue
 * (business.filing.due / .overdue) is written onto its entity (palmMonitor,
 * palmFilings), shows in activity, and in live mode emails the owners and
 * admins about a change to the record or an overdue filing.
 *
 * Set up in Palm Console → Webhooks: URL https://<site>/api/palm-webhook,
 * the document.created, registered_agent.*, filing.*, case.* and business.* events, and the signing
 * secret in Vercel as PALM_WEBHOOK_SECRET.
 */

const SITE = process.env.SITE_URL?.replace(/\/$/, "") || "https://www.burtonfamilyoffice.com";

async function rawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function within<T>(ms: number, p: Promise<T>): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch((err) => (console.error("palm-webhook: handling failed", err), null));
}

// An error nothing below caught alerts the admins (lib/alert.ts) and still answers 500, so Palm retries.
export default alertOnThrow("webhook:palm", "Palm webhook crashed", handle);

async function handle(req: VercelRequest, res: VercelResponse) {
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
  // Palm redelivers: an event handled before changes nothing (and logs nothing) a second time.
  const seen = await alreadyStored(row.id);
  const object = (event.data?.object ?? {}) as Record<string, unknown>;

  // A monitored registration: the monitor says which entity and which state.
  let monitorState: string | null = null;
  let monitorAsset: string | null = null;
  if (event.type.startsWith("business.") && row.business_id) {
    const m = await monitorByBusiness(row.business_id, row.mode).catch((err) => (console.error("palm-webhook: couldn't look up the monitor", err), null));
    if (m) {
      monitorAsset = m.asset_id;
      monitorState = m.state;
    }
  }

  // Which BFO entity: the id stamped on the filing, else the entity linked to the business, else the id on the Palm business.
  let assetId: string | null = monitorAsset ?? (object.metadata as Record<string, string> | undefined)?.bfo_asset_id ?? null;
  let entityName: string | null = null;
  if (!assetId && row.business_id) {
    const linked = await businessEntity(row.business_id, row.mode).catch((err) => (console.error("palm-webhook: couldn't look up the business's entity", err), null));
    if (linked) {
      assetId = linked.assetId;
      entityName = linked.name;
    }
  }
  if (!assetId && row.business_id && row.mode === palmMode()) {
    const business = await within(4000, palm<{ display_name?: string | null; metadata?: Record<string, string> }>(`/v1/business/${row.business_id}`));
    assetId = business?.metadata?.bfo_asset_id ?? null;
    entityName = business?.display_name ?? null;
  }

  // A question from Palm (case.opened / updated / resolved): find the entity by the filing it's on.
  if (event.type.startsWith("case.")) {
    const found = await caseEntity(object, row.mode).catch((err) => (console.error("palm-webhook: couldn't look up the case's entity", err), null));
    if (found) {
      assetId = assetId ?? found.assetId;
      entityName = entityName ?? found.name;
    }
  }

  // A formation (or its EIN) moving along: the entity's record follows the
  // filing as Palm has it now, read by id. The body may be a late or
  // redelivered event, so its status is never written as it stands.
  if (assetId && !seen && event.type.startsWith("filing.") && (object.type === "formation" || object.type === "ein") && typeof object.id === "string" && row.mode === palmMode()) {
    const filing = await within(5000, palm<PalmFiling>(`/v1/filing/${encodeURIComponent(object.id)}`));
    if (filing) await trackFiling(assetId, row.mode, filing).catch((err) => console.error("palm-webhook: couldn't record the filing", err));
  }

  // Writing an event onto its entity failed: it isn't stored, and Palm is asked to send it again.
  let retry = false;
  const failures: string[] = [];
  const fail = (what: string) => (err: unknown) => {
    console.error(`palm-webhook: couldn't record the ${what}`, err);
    failures.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    retry = true;
  };

  // The agent service moving along: the entity's agent follows.
  if (assetId && event.type.startsWith("registered_agent.") && !seen) {
    await trackAgent(assetId, row.mode, object as RaServiceLike, Date.parse(row.occurred_at) || Date.now()).catch(fail("agent"));
  }

  if (assetId && monitorState && event.type.startsWith("business.") && !seen) {
    await onMonitor(event, assetId, entityName, monitorState, row.mode).catch(fail("monitor event"));
  }

  if (assetId && event.type.startsWith("case.") && !seen) {
    await onCase(event.id, event.type, assetId, entityName, row.mode, object).catch(fail("case"));
  }
  if (retry) {
    await alertAdmins("webhook:palm", "A Palm event couldn't be written onto its entity", `${event.type} ${event.id}: ${failures.join("; ")}`);
    return res.status(500).json({ error: "record_failed" }); // Palm retries
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
      const to = await ownerEmails();
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
    await alertAdmins("webhook:palm", "A Palm event couldn't be stored", `${event.type} ${event.id}: ${err instanceof Error ? err.message : String(err)}`);
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
    await applyOps([{ op: "update", path: ["assets", assetId], value: einPatch(filing, mode, prev) as never }], PALM);
    return;
  }
  if (prev && prev.filingId !== filing.id) return; // a different filing than the one this record tracks
  const state = summarizeFiling(filing, prev);
  await applyOps([{ op: "update", path: ["assets", assetId], value: formationPatch(state, mode, filing.business_id ?? undefined) as never }], PALM);
}

/** The agent service as Palm reports it now, onto the entity (lib/palm-agent.ts). */
async function trackAgent(assetId: string, mode: "test" | "live", service: RaServiceLike, at: number): Promise<void> {
  if (!/^[\w-]{8,64}$/.test(assetId) || !service?.status) return;
  const row = (await readRows("assets", [assetId]))[0];
  if (!row) return;
  const data = (row.data ?? {}) as Parameters<typeof raPatch>[0] & { palm?: Record<string, { ra?: { status?: string | null; eventAt?: number } | null } | undefined> };
  const prior = data.palm?.[mode]?.ra;
  // An event older than the last one applied (Palm's times compared with Palm's, not a browser's clock) changes nothing.
  if (prior?.eventAt && prior.eventAt > at) return;
  const patch = raPatch(data, service, mode, at);
  patch[`palm/${mode}/ra`] = { ...(patch[`palm/${mode}/ra`] as object), eventAt: at };
  await applyOps([{ op: "update", path: ["assets", assetId], value: patch as never }], PALM);
  if (prior?.status === service.status) return; // Palm resending, or nothing new to say
  const label = { pending: "is filing the agent change", active: "is now the registered agent", termination_requested: "is resigning as agent", terminated: "stopped serving as agent", failed: "couldn't make the agent change", canceled: "canceled the agent change" }[service.status];
  const why = service.status === "failed" && service.rejection_reason ? `: ${service.rejection_reason}` : "";
  await logActivity(assetId, PALM, [{ kind: "palm", summary: `Palm ${label}${why}${mode === "test" ? " (test)" : ""}` }]);
}

/** True when this event was handled before (Palm redelivers): it changes nothing a second time. */
async function alreadyStored(eventId: string): Promise<boolean> {
  // Unreadable counts as new: the event is handled again rather than dropped.
  const rows = await sb<{ id: string }[]>(`palm_events?id=eq.${encodeURIComponent(eventId)}&select=id&limit=1`).catch((err) => (console.error("palm-webhook: couldn't check for an earlier delivery", err), []));
  return !!rows?.length;
}

/** The entity linked to a Palm business, by the business id kept on it (palm/<mode>/businessId). */
async function businessEntity(businessId: string, mode: "test" | "live"): Promise<{ assetId: string; name: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return null;
  const rows = await sb<{ id: string; name: string | null }[]>(`tree_nodes?collection=eq.assets&data->palm->${mode}->>businessId=eq.${businessId}&select=id,name:data->>name&limit=1`);
  return rows[0] ? { assetId: rows[0].id, name: rows[0].name } : null;
}

/** The entity a case belongs to: the one whose formation (or its EIN) is the case's filing. */
async function caseEntity(c: Record<string, unknown>, mode: "test" | "live"): Promise<{ assetId: string; name: string | null } | null> {
  const parent = String(c.parent_id ?? "");
  if (c.parent_type !== "filing" || !/^[0-9a-f-]{36}$/i.test(parent)) return null;
  for (const path of [`data->palm->${mode}->formation->>filingId`, `data->palm->${mode}->formation->ein->>filingId`]) {
    const rows = await sb<{ id: string; name: string | null }[]>(`tree_nodes?collection=eq.assets&${path}=eq.${parent}&select=id,name:data->>name&limit=1`);
    if (rows[0]) return { assetId: rows[0].id, name: rows[0].name };
  }
  return null;
}

/** A case opened or closed: the formation's count of open questions follows, it shows in activity, and an opened one emails the owners. */
async function onCase(eventId: string, type: string, assetId: string, entityName: string | null, mode: "test" | "live", c: Record<string, unknown>): Promise<void> {
  const row = (await readRows("assets", [assetId]))[0];
  const formation = ((row?.data ?? {}) as { palm?: Record<string, { formation?: FormationState }> }).palm?.[mode]?.formation;
  // Read the formation again so its open-question count is current.
  if (formation?.filingId && mode === palmMode()) {
    const filing = await within(5000, palm<PalmFiling>(`/v1/filing/${formation.filingId}`));
    if (filing) await trackFiling(assetId, mode, filing);
  }
  const summary = String(c.summary ?? "Palm needs more information.");
  const tag = mode === "test" ? " (test)" : "";
  const onFiling = c.parent_type === "filing";
  if (type === "case.opened") {
    await logActivity(assetId, PALM, [{ kind: "palm", summary: `Palm asked: ${summary}${tag}` }]);
    if (mode === "live") {
      const to = await ownerEmails();
      const who = entityName || "one of your entities";
      const link = `${SITE}/assets/${assetId}`;
      if (to.length) {
        await sendEmail(
          to,
          `Palm has a question about ${who}`,
          `Palm needs an answer about ${who}${onFiling ? "'s filing" : ""}: ${summary}\nAnswer it in BFO: ${link}`,
          `<p>Palm needs an answer about <b>${who.replace(/</g, "&lt;")}</b>${onFiling ? "'s filing" : ""}:</p><p>${summary.replace(/</g, "&lt;")}</p><p><a href="${link}">Answer it in BFO</a></p>`,
          undefined,
          undefined,
          { idempotencyKey: `palm-${eventId}` },
        ).catch((err) => console.error("palm case email failed", err));
      }
    }
  } else if (type === "case.resolved") {
    await logActivity(assetId, PALM, [{ kind: "palm", summary: `Palm closed its question: ${summary}${tag}` }]);
  }
}

/** The owners' and admins' email addresses. */
async function ownerEmails(): Promise<string[]> {
  const people = await sb<{ email: string | null }[]>("app_users?status=eq.approved&role=in.(owner,admin)&select=email").catch((err) => (console.error("palm-webhook: couldn't read who to email", err), []));
  return [...new Set(people.map((p) => p.email).filter((e): e is string => !!e))];
}

/** A monitored registration changed at the state, or a filing came due or went overdue: onto the entity, into activity, and (live) to the owners. */
async function onMonitor(event: PalmEvent, assetId: string, entityName: string | null, state: string, mode: "test" | "live"): Promise<void> {
  const row = (await readRows("assets", [assetId]))[0];
  if (!row) return;
  const who = entityName || ((row.data ?? {}) as { name?: string }).name || "one of your entities";
  const at = Date.parse(event.created_at ?? "") || Date.now();
  const patch = monitorPatch(event, state, mode, at, (row.data ?? {}) as Parameters<typeof monitorPatch>[4]);
  if (!patch) return;
  await applyOps([{ op: "update", path: ["assets", assetId], value: patch as never }], PALM);
  const tag = mode === "test" ? " (test)" : "";
  const link = `${SITE}/assets/${assetId}/compliance`;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  if (event.type === "business.registration.updated") {
    const lines = (event.data?.changes ?? []).map((c) => c.summary || `${c.attribute ?? "Record"} ${c.action ?? "updated"}`).filter(Boolean).slice(0, 10);
    const summary = lines.length ? lines.join("; ") : "Its record changed.";
    await logActivity(assetId, PALM, [{ kind: "palm", summary: `${state} record changed: ${summary}${tag}` }]);
    if (mode === "live") {
      const to = await ownerEmails();
      if (to.length) {
        await sendEmail(
          to,
          `${who}'s ${state} record changed`,
          `Palm saw a change to ${who}'s record with ${state}:\n${lines.map((l) => `- ${l}`).join("\n") || summary}\n\nSee it in BFO: ${link}`,
          `<p>Palm saw a change to <b>${esc(who)}</b>'s record with ${state}:</p><ul>${(lines.length ? lines : [summary]).map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p><a href="${link}">See it in BFO</a></p>`,
          undefined,
          undefined,
          { idempotencyKey: `palm-${event.id}` },
        ).catch((err) => console.error("palm monitor email failed", err));
      }
    }
    return;
  }

  const filing = (event.data?.object ?? {}) as { type?: { id?: string; name?: string }; due_date?: string };
  const name = filing.type?.name || "A filing";
  const overdue = event.type === "business.filing.overdue";
  const due = filing.due_date ? ` (due ${filing.due_date.slice(0, 10)})` : "";
  await logActivity(assetId, PALM, [{ kind: "palm", summary: `${state}: ${name} ${overdue ? "is overdue" : "is coming due"}${due}${tag}` }]);
  if (overdue && mode === "live") {
    const to = await ownerEmails();
    if (to.length) {
      await sendEmail(
        to,
        `${who}: ${name} is overdue in ${state}`,
        `Palm reports ${who}'s ${name} with ${state} is overdue${due}. Late filings can cost an entity its good standing.\nSee it in BFO: ${link}`,
        `<p>Palm reports <b>${esc(who)}</b>'s <b>${esc(name)}</b> with ${state} is <b>overdue</b>${esc(due)}.</p><p>Late filings can cost an entity its good standing.</p><p><a href="${link}">See it in BFO</a></p>`,
        undefined,
        undefined,
        { idempotencyKey: `palm-${event.id}` },
      ).catch((err) => console.error("palm monitor email failed", err));
    }
  }
}
