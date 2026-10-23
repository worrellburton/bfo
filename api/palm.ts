import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logActivity } from "../lib/activity.js";
import { canWrite, currentUser, isAdmin, sb } from "../lib/auth.js";
import { buildFormationRequest, einPatch, extraFields, formationPatch, stateRules, summarizeFiling, type FormationDraft, type PalmFiling } from "../lib/palm-formation.js";
import { applyOps, readRows } from "../lib/tree.js";
import { PALM_PRICES, type PalmProduct } from "../lib/palm-pricing.js";
import { ownerName, ownerPercent, parentOwnerId } from "../lib/formation-owners.js";
import { checkEin, einCheckText, einName, MonitorError, monitorsFor, refreshMonitors, registrationsOf, startMonitor, stopMonitor } from "../lib/palm-monitor.js";
import {
  isJurisdiction,
  normalizeEin,
  normalizeLegalName,
  businessDifferences,
  listPalmDocuments,
  palm,
  PalmError,
  palmFile,
  palmEntityType,
  palmMode,
  vaultAddress,
  type PalmUsage,
  type RegisteredAgentService,
} from "../lib/palm.js";

/** Palm moving a filing along shows in the entity's activity as Palm. */
const PALM = { id: null, name: "Palm", source: "palm" } as const;

/**
 * Palm, for one entity at a time. POST { action, … }:
 *
 *   status            → { configured, mode }
 *   usage             → what Palm has billed: this month and last, by product, the latest calls
 *   registry-search   { name | palmId, jurisdiction? } → matches on the state registries
 *   registry-detail   { jurisdiction, number }         → the state's record: status, standing, agent, people
 *   link              { assetId, entity }              → the entity's Palm business (found or added)
 *   business          { businessId, assetId, entity }  → Palm's copy of the business against ours: its name kept in step
 *                                                        (the one thing Palm lets us change), the rest as differences
 *   ra                { businessId }                   → Palm's registered agent service for it
 *   ra-change         { businessId, assetId }          → move the registered agent to Palm (files with the state)
 *   ra-end            { businessId, assetId }          → Palm stops being the agent (the entity is dissolved); owner/admin
 *   documents         { businessId }                   → mail and filings Palm holds for it (every page; truncated past 10,000)
 *   document          { documentId }                   → one document's file
 *   inbox             { assetId?, unread? }            → mail and agent events Palm has sent (webhook)
 *   inbox-read        { ids } | { assetId }            → mark them read
 *
 * Forming a new entity (lib/palm-formation.ts):
 *   form-requirements { jurisdiction, entityType }     → what the state asks for: extra fields, expedite tiers
 *   form-name         { jurisdiction, entityType, name } → is the name compliant and available
 *   form-fee          { jurisdiction, entityType, expeditedTier?, extra? } → the state's fee, estimated
 *   form-validate     { draft }                        → Palm's full list of problems, filing nothing
 *   form-submit       { draft, assetId, stateName, mode, idempotencyKey } → files with the state; owner/admin only
 *   form-status       { assetId, filingId, mode }      → the filing now, written to the entity's record
 *   cases             { assetId }                      → Palm's questions on its filings, open ones first
 *
 * Monitoring and checks (lib/palm-monitor.ts):
 *   monitor-list      { assetId }                      → each registration, and whether Palm is watching it
 *   monitor-on        { assetId, state, mode }         → Palm watches it ($1.99/month live); owner/admin
 *   monitor-off       { assetId, state, mode }         → Palm stops; owner/admin
 *   ein-check         { assetId, mode, simulate? }     → the IRS asked whether the EIN is this legal name's (99¢ live)
 *   case-respond      { assetId, caseId, fields, documents? } → answer one; owner/admin only
 *
 * Reads need a signed-in user; adding a business needs write access; moving
 * the agent — a state filing billed to the Palm account — needs an owner or admin.
 *
 * Every call may carry the `mode` the page believes it's in; link and
 * ra-change must. If the key has since switched between test and live, the
 * call is refused (409 mode_changed) rather than acting in the other mode.
 */

/** A question Palm has on a filing or business (GET /v1/case). */
type PalmCase = {
  id: string;
  kind: string;
  status: "needs_response" | "under_review" | "resolved" | "superseded";
  summary: string;
  details?: string | null;
  request?: { fields: { name: string; type: string; description: string; required?: boolean; example?: unknown; document_types?: string[] }[]; documents?: string[] } | null;
  response?: unknown;
  due_at?: string | null;
  opened_at: string;
  resolved_at?: string | null;
  parent_type: string;
  parent_id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_ID = /^[\w-]{1,128}$/;

type Entity = {
  name?: string;
  ein?: string;
  type?: string;
  jurisdiction?: string;
  formationDate?: string;
  fileNumber?: string;
  address?: string;
};

type Business = { id: string; palm_id: string | null; display_name: string | null; metadata?: Record<string, string>; vault?: Record<string, unknown> | null };

/** A wizard address as one line: "street, suite, city, ST 12345". */
const oneLine = (a: { street1: string; street2?: string | null; city: string; region: string; postal: string }) =>
  [[a.street1, a.street2].filter((x) => x?.trim()).join(", "), a.city, `${a.region.toUpperCase()} ${a.postal}`].filter(Boolean).join(", ");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body.action || "");
  const mode = palmMode();

  if (action === "status") return res.status(200).json({ configured: !!mode, mode });
  if (action === "usage") {
    if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });
    const [report, webhook] = await Promise.all([usageReport(), webhookHealth()]);
    return res.status(200).json({ mode, ...report, webhook });
  }
  if (!mode) return res.status(503).json({ error: "not_connected", message: "Palm isn't connected yet." });
  const mustMatchMode = ["link", "ra-change", "ra-end", "form-submit", "form-status", "monitor-on", "monitor-off", "ein-check"].includes(action);
  if ((body.mode !== undefined || mustMatchMode) && body.mode !== mode) {
    return res.status(409).json({ error: "mode_changed", mode, message: `Palm is now in ${mode} mode. Reload the page and check again before going on.` });
  }

  // Kept with each billed call (palm_usage): who asked, for which entity, why.
  const usage = (reason: string): PalmUsage => ({
    actorId: user.id,
    actorName: user.name ?? null,
    assetId: typeof body.assetId === "string" && /^[\w-]{1,80}$/.test(body.assetId) ? body.assetId : null,
    reason,
  });

  try {
    switch (action) {
      case "registry-search": {
        // Billed by Palm on a live key: only people who can change the record may run it.
        if (!canWrite(user)) return res.status(403).json({ error: "forbidden", message: "Only people who can edit entities can read state records." });
        const name = String(body.name || "").trim();
        const palmId = String(body.palmId || "").trim();
        if (!name && !palmId) return res.status(400).json({ error: "missing_name" });
        if (palmId && !/^[\w-]{1,128}$/.test(palmId)) return res.status(400).json({ error: "bad_palm_id" });
        const jurisdiction = isJurisdiction(body.jurisdiction) ? body.jurisdiction : undefined;
        const r = await palm<{ data: unknown[] }>("/v1/business/registry/search", {
          method: "POST",
          body: palmId ? { palm_id: palmId } : { name, ...(jurisdiction ? { registration_jurisdiction: jurisdiction } : {}) },
          usage: usage("State record"),
        });
        return res.status(200).json({ mode, results: (r?.data ?? []).slice(0, 10) });
      }

      case "registry-detail": {
        if (!canWrite(user)) return res.status(403).json({ error: "forbidden", message: "Only people who can edit entities can read state records." });
        const number = String(body.number || "").trim();
        if (!isJurisdiction(body.jurisdiction) || !number || number.length > 64) return res.status(400).json({ error: "missing_params" });
        const r = await palm(`/v1/business/registry/${body.jurisdiction}/${encodeURIComponent(number)}`, { usage: usage("State record") });
        return res.status(200).json({ mode, record: r, checkedAt: Date.now() });
      }

      case "link": {
        if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });
        const assetId = String(body.assetId || "");
        const e = (body.entity || {}) as Entity;
        if (!assetId || !e.name || !isJurisdiction(e.jurisdiction)) return res.status(400).json({ error: "missing_params", message: "The entity needs a name and a state." });

        const ein = normalizeEin(e.ein);
        const search = async (q: Record<string, unknown>) =>
          (await palm<{ data: Business[] }>("/v1/business/search", { method: "POST", body: { ...q, limit: 50 } }))?.data ?? [];
        const ours = (b: Business) => b.metadata?.bfo_asset_id === assetId;
        const unclaimed = (b: Business) => !b.metadata?.bfo_asset_id;
        const sameState = (b: Business) => {
          const v = b.vault ?? {};
          return v["business.formation_jurisdiction"] === e.jurisdiction || v["business.registration_jurisdiction"] === e.jurisdiction;
        };
        const adopt = async (b: Business) => {
          if (!ours(b)) await palm(`/v1/business/${b.id}`, { method: "PATCH", body: { metadata: { bfo_asset_id: assetId } } });
          return res.status(200).json({ mode, businessId: b.id, palmId: b.palm_id, created: false });
        };

        // 1. This entity's own business, by the id we stamped on it.
        const byId = (await search({ metadata: { bfo_asset_id: assetId } })).filter(ours);
        if (byId.length === 1) return adopt(byId[0]);
        if (byId.length > 1) return res.status(409).json({ error: "ambiguous", message: "Palm has more than one business linked to this entity. Sort it out in Palm Console first." });

        // 2. The same EIN — an exact match — not claimed by another entity.
        if (ein) {
          const byEin = await search({ ein });
          const other = byEin.find((b) => !unclaimed(b) && !ours(b));
          if (other) return res.status(409).json({ error: "claimed", message: "A business with this EIN is already linked to another BFO entity in Palm." });
          if (byEin.length === 1) return adopt(byEin[0]);
          if (byEin.length > 1) return res.status(409).json({ error: "ambiguous", message: "Palm has more than one business with this EIN. Sort it out in Palm Console first." });
        }

        // 3. Same legal name in the same state, and not claimed by another entity.
        const want = normalizeLegalName(e.name);
        const byName = (await search({ vault: { "business.legal_name": e.name } })).filter(
          (b) => unclaimed(b) && sameState(b) && normalizeLegalName(String(b.vault?.["business.legal_name"] ?? b.display_name ?? "")) === want,
        );
        if (byName.length === 1) return adopt(byName[0]);
        if (byName.length > 1) return res.status(409).json({ error: "ambiguous", message: "Palm has more than one unlinked business with this name in this state. Sort it out in Palm Console first." });

        const vault: Record<string, string> = {
          "business.legal_name": e.name,
          "business.entity_type": palmEntityType(e.type),
          "business.formation_jurisdiction": e.jurisdiction,
          "business.registration_jurisdiction": e.jurisdiction,
          ...(e.formationDate && /^\d{4}-\d{2}-\d{2}$/.test(e.formationDate) ? { "business.formation_date": e.formationDate } : {}),
          ...(e.fileNumber ? { "business.registration_number": e.fileNumber.trim() } : {}),
          ...(ein ? { "business.ein": ein } : {}),
          ...vaultAddress(e.address),
        };
        const created = await palm<Business>("/v1/business", {
          method: "POST",
          body: { display_name: e.name, metadata: { bfo_asset_id: assetId }, vault },
        });
        return res.status(200).json({ mode, businessId: created.id, palmId: created.palm_id, created: true });
      }

      case "business": {
        const id = String(body.businessId || "");
        const assetId = String(body.assetId || "");
        if (!UUID.test(id) || !assetId) return res.status(400).json({ error: "missing_params" });
        const business = await palm<Business>(`/v1/business/${id}`);
        if (business?.metadata?.bfo_asset_id !== assetId) {
          return res.status(409).json({ error: "business_mismatch", message: "That Palm business isn't linked to this entity." });
        }
        const e = (body.entity || {}) as Entity;
        // Palm's API changes only a business's display name and metadata after it's added; the vault (EIN,
        // address, file number) is set when it's added and corrected in Palm Console.
        let renamed = false;
        if (canWrite(user) && e.name?.trim() && business.display_name !== e.name.trim()) {
          await palm(`/v1/business/${id}`, { method: "PATCH", body: { display_name: e.name.trim() } });
          renamed = true;
        }
        return res.status(200).json({ mode, renamed, palmId: business.palm_id, differences: businessDifferences(business.vault ?? {}, e) });
      }

      case "monitor-list": {
        const assetId = String(body.assetId || "");
        if (!/^[\w-]{1,80}$/.test(assetId)) return res.status(400).json({ error: "missing_params" });
        const asset = (await readRows("assets", [assetId]))[0];
        if (!asset) return res.status(404).json({ error: "not_found" });
        const monitors = await refreshMonitors(await monitorsFor([assetId], mode));
        const on = (m: { status: string; ended_at: string | null }) => !m.ended_at && m.status !== "canceled" && m.status !== "expired";
        const registrations = registrationsOf((asset.data ?? {}) as never).map((r) => ({ ...r, monitor: monitors.find((m) => m.state === r.state && on(m)) ?? null }));
        return res.status(200).json({ mode, cents: mode === "live" ? PALM_PRICES.monitor.cents : 0, registrations });
      }

      case "monitor-on":
      case "monitor-off": {
        if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin turns monitoring on or off (Palm bills it monthly)." });
        const assetId = String(body.assetId || "");
        const state = String(body.state || "").toUpperCase();
        if (!/^[\w-]{1,80}$/.test(assetId) || !/^[A-Z]{2}$/.test(state)) return res.status(400).json({ error: "missing_params" });
        const asset = (await readRows("assets", [assetId]))[0];
        if (!asset) return res.status(404).json({ error: "not_found" });
        const data = (asset.data ?? {}) as { name?: string; palm?: Record<string, { businessId?: string | null } | undefined> };
        const tag = mode === "test" ? " (test)" : "";
        try {
          if (action === "monitor-off") {
            const row = (await monitorsFor([assetId], mode)).find((m) => m.state === state);
            if (row) {
              await stopMonitor(row);
              await logActivity(assetId, { id: user.id, name: user.name, source: "user" }, [{ kind: "palm", summary: `Stopped Palm monitoring ${state}${tag}` }]);
            }
            return res.status(200).json({ mode, monitor: null });
          }
          const reg = registrationsOf(data as never).find((r) => r.state === state);
          if (!reg) return res.status(400).json({ error: "no_registration", message: `${data.name ?? "This entity"} isn't registered in ${state}.` });
          const row = await startMonitor({ assetId, reg, linkedBusinessId: data.palm?.[mode]?.businessId ?? null, mode, by: { id: user.id, name: user.name } });
          await logActivity(assetId, { id: user.id, name: user.name, source: "user" }, [{ kind: "palm", summary: `Palm is now monitoring ${state}${mode === "live" ? " ($1.99/month)" : tag}` }]);
          return res.status(200).json({ mode, monitor: row });
        } catch (err) {
          if (err instanceof MonitorError) return res.status(err.status).json({ error: "monitor_failed", message: err.message });
          throw err;
        }
      }

      case "ein-check": {
        if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });
        const assetId = String(body.assetId || "");
        if (!/^[\w-]{1,80}$/.test(assetId)) return res.status(400).json({ error: "missing_params" });
        const asset = (await readRows("assets", [assetId]))[0];
        if (!asset) return res.status(404).json({ error: "not_found" });
        const data = (asset.data ?? {}) as Parameters<typeof einName>[0];
        const ein = normalizeEin(data.ein);
        if (!ein) return res.status(400).json({ error: "no_ein", message: "Add the EIN (12-3456789) first." });
        // The IRS matches the legal name as filed: the state's spelling when we've read it, else ours.
        const name = einName(data);
        if (!name) return res.status(400).json({ error: "no_name" });
        const simulate = mode === "test" && ["match", "no_match", "unavailable"].includes(String(body.simulate)) ? (String(body.simulate) as "match" | "no_match" | "unavailable") : undefined;
        const check = await checkEin({ ein, name, mode, usage: usage("EIN check"), simulate });
        await applyOps([{ op: "update", path: ["assets", assetId], value: { einCheck: check } as never }], { id: user.id, name: user.name, source: "user" });
        const verdict = check.matched === true ? "matches" : check.matched === false ? "doesn't match" : "couldn't be checked";
        await logActivity(assetId, { id: user.id, name: user.name, source: "user" }, [{ kind: "palm", summary: `IRS check: the EIN ${verdict} ${name}${mode === "test" ? " (test)" : ""}` }]);
        return res.status(200).json({ mode, check, text: einCheckText(check) });
      }

      case "ra": {
        const id = String(body.businessId || "");
        if (!UUID.test(id)) return res.status(400).json({ error: "bad_business_id" });
        try {
          const ra = await palm<RegisteredAgentService>(`/v1/business/${id}/registered-agent`);
          return res.status(200).json({ mode, service: ra });
        } catch (err) {
          // 404 = Palm has never been this business's agent.
          if (err instanceof PalmError && err.status === 404) return res.status(200).json({ mode, service: null });
          throw err;
        }
      }

      case "ra-change": {
        if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can change a registered agent." });
        const id = String(body.businessId || "");
        const assetId = String(body.assetId || "");
        if (!UUID.test(id) || !assetId) return res.status(400).json({ error: "missing_params" });
        // The filing goes only to the business linked to the entity the admin confirmed.
        const business = await palm<Business>(`/v1/business/${id}`);
        if (business?.metadata?.bfo_asset_id !== assetId) {
          return res.status(409).json({ error: "business_mismatch", message: "That Palm business isn't linked to this entity. Reload and check the state record again." });
        }
        // Omitting registered_agent moves the business onto Palm-provided service.
        const ra = await palm<RegisteredAgentService>(`/v1/business/${id}/registered-agent`, {
          method: "PATCH",
          body: { status: "change_requested", metadata: { source: "bfo", bfo_asset_id: assetId, requested_by: user.id } },
        });
        return res.status(200).json({ mode, service: ra });
      }

      case "ra-end": {
        // Closing the entity down: Palm stops serving as its agent once the work completes.
        if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can end a registered agent." });
        const id = String(body.businessId || "");
        const assetId = String(body.assetId || "");
        if (!UUID.test(id) || !assetId) return res.status(400).json({ error: "missing_params" });
        const business = await palm<Business>(`/v1/business/${id}`);
        if (business?.metadata?.bfo_asset_id !== assetId) {
          return res.status(409).json({ error: "business_mismatch", message: "That Palm business isn't linked to this entity." });
        }
        const ra = await palm<RegisteredAgentService>(`/v1/business/${id}/registered-agent`, {
          method: "PATCH",
          body: { status: "termination_requested", reason: "business_dissolved", metadata: { source: "bfo", bfo_asset_id: assetId, requested_by: user.id } },
        });
        await logActivity(assetId, { id: user.id, name: user.name || user.email, source: "user" }, [{ kind: "palm", summary: "Asked Palm to end its registered agent service (dissolved)" }]);
        return res.status(200).json({ mode, service: ra });
      }

      case "documents": {
        const id = String(body.businessId || "");
        if (!UUID.test(id)) return res.status(400).json({ error: "bad_business_id" });
        const { documents, truncated } = await listPalmDocuments(id);
        return res.status(200).json({ mode, documents, ...(truncated ? { truncated } : {}) });
      }

      case "document": {
        const id = String(body.documentId || "");
        if (!DOC_ID.test(id)) return res.status(400).json({ error: "bad_document_id" });
        let file: Awaited<ReturnType<typeof palmFile>>;
        try {
          file = await palmFile(`/v1/document/${id}/content`);
        } catch (err) {
          if (err instanceof PalmError) return res.status(err.status === 404 ? 404 : 502).json({ error: "document_unavailable", message: err.message });
          throw err;
        }
        const buf = file.bytes;
        // Only PDFs and images are shown inline; anything else is a download, never a page on our origin.
        const ct = file.contentType;
        const safe = ct === "application/pdf" || /^image\/(png|jpeg|gif|webp)$/.test(ct);
        res.setHeader("Content-Type", safe ? ct : "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const cd = file.disposition;
        if (cd && !/[\r\n]/.test(cd)) res.setHeader("Content-Disposition", safe ? cd : cd.replace(/^\s*inline/i, "attachment"));
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).send(buf);
      }

      case "inbox": {
        const assetId = String(body.assetId || "");
        if (assetId && !/^[\w-]{1,128}$/.test(assetId)) return res.status(400).json({ error: "bad_asset_id" });
        const q = [
          `mode=eq.${mode}`,
          assetId ? `asset_id=eq.${encodeURIComponent(assetId)}` : "",
          body.unread ? "read_at=is.null" : "",
          "select=id,type,asset_id,business_id,document_id,document_type,filename,status,rejection_reason,occurred_at,read_at",
          "order=occurred_at.desc",
          "limit=100",
        ].filter(Boolean).join("&");
        const events = await sb<unknown[]>(`palm_events?${q}`);
        return res.status(200).json({ mode, events });
      }

      case "inbox-read": {
        if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });
        const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string" && /^[\w-]{1,128}$/.test(x)).slice(0, 200) : [];
        const assetId = String(body.assetId || "");
        if (!ids.length && !/^[\w-]{1,128}$/.test(assetId)) return res.status(400).json({ error: "missing_params" });
        const where = ids.length ? `id=in.(${ids.map((i) => `"${i}"`).join(",")})` : `asset_id=eq.${encodeURIComponent(assetId)}`;
        await sb(`palm_events?${where}&read_at=is.null`, { method: "PATCH", body: { read_at: new Date().toISOString(), read_by: user.id }, prefer: "return=minimal" });
        return res.status(200).json({ ok: true });
      }

      // ── Forming a new entity ────────────────────────────────────────────
      case "form-requirements": {
        const jurisdiction = isJurisdiction(body.jurisdiction) ? body.jurisdiction : null;
        const entityType = formationType(body.entityType);
        if (!jurisdiction || !entityType) return res.status(400).json({ error: "missing_params" });
        try {
          const r = await palm<{ expedited_tiers?: string[]; schema?: unknown }>(`/v1/filing/formation/requirement?entity_type=${entityType}&jurisdiction=${jurisdiction}`);
          return res.status(200).json({ mode, supported: true, expeditedTiers: r.expedited_tiers ?? [], extra: extraFields(r.schema), rules: stateRules(r.schema) });
        } catch (err) {
          if (err instanceof PalmError && (err.status === 404 || err.status === 501)) return res.status(200).json({ mode, supported: false, expeditedTiers: [], extra: [], rules: {} });
          throw err;
        }
      }

      case "form-name": {
        const jurisdiction = isJurisdiction(body.jurisdiction) ? body.jurisdiction : null;
        const entityType = formationType(body.entityType);
        const name = String(body.name ?? "").trim().slice(0, 200);
        if (!jurisdiction || !entityType || name.length < 2) return res.status(400).json({ error: "missing_params" });
        const q = new URLSearchParams({ name, entity_type: entityType, suggest: "true" });
        const r = await palm<{ eligible: boolean; compliant: boolean; available: boolean; violations?: { severity: string; message: string; fix?: { message?: string } }[]; alternatives?: string[] }>(
          `/v1/business/registry/${jurisdiction}/name-eligibility?${q}`,
          { usage: usage("Name check for a new entity") }
        );
        return res.status(200).json({
          eligible: !!r.eligible,
          compliant: !!r.compliant,
          available: !!r.available,
          violations: (r.violations ?? []).map((v) => ({ severity: v.severity, message: v.fix?.message ? `${v.message} ${v.fix.message}` : v.message })),
          alternatives: (r.alternatives ?? []).slice(0, 6),
        });
      }

      case "form-fee": {
        const jurisdiction = isJurisdiction(body.jurisdiction) ? body.jurisdiction : null;
        const entityType = formationType(body.entityType);
        if (!jurisdiction || !entityType) return res.status(400).json({ error: "missing_params" });
        const q = new URLSearchParams({ jurisdiction, entity_type: entityType });
        const tier = String(body.expeditedTier ?? "").trim();
        if (/^[a-z0-9_]{1,30}$/.test(tier)) q.set("expedited_tier", tier);
        // Some states price on inputs (member count, shares): pass the state-specific answers along.
        for (const [k, v] of Object.entries((body.extra ?? {}) as Record<string, unknown>)) {
          if (/^[a-z0-9_]{1,40}$/.test(k) && (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 40))) q.set(k, String(v));
        }
        try {
          const r = await palm<{ fee?: { total?: { amount?: number; currency?: string }; items?: { component_type: string; name: string; amount: number; currency: string }[] }; expedited_tiers?: { tier: string; fee: { amount: number; currency: string } }[] }>(
            `/v1/filing/formation/fee?${q}`
          );
          return res.status(200).json({
            total: r.fee?.total?.amount ?? null,
            currency: r.fee?.total?.currency ?? "USD",
            items: (r.fee?.items ?? []).map((i) => ({ kind: i.component_type, name: i.name, amount: i.amount })),
            expeditedTiers: (r.expedited_tiers ?? []).map((t) => ({ tier: t.tier, amount: t.fee?.amount ?? 0 })),
          });
        } catch (err) {
          if (err instanceof PalmError && (err.status === 404 || err.status === 400)) return res.status(200).json({ total: null, currency: "USD", items: [], expeditedTiers: [], note: err.message });
          throw err;
        }
      }

      case "form-validate": {
        const draft = body.draft as FormationDraft | undefined;
        const entityType = formationType(draft?.entityType);
        if (!draft || !entityType || !isJurisdiction(draft.jurisdiction)) return res.status(400).json({ error: "missing_params" });
        try {
          // Palm answers every problem at once: errors block the filing, warnings (a field the state ignores) don't.
          type Issue = { path?: string; code?: string; message?: string };
          const r = await palm<{ valid?: boolean; errors?: Issue[]; warnings?: Issue[] } | null>(`/v1/filing/formation/${entityType}/validate`, { method: "POST", body: buildFormationRequest(draft, "pending") });
          const list = (xs: Issue[] | undefined) => (xs ?? []).map((e) => ({ field: e.path || null, message: e.message || e.code || "Problem" }));
          const errors = list(r?.errors);
          return res.status(200).json({ ok: r?.valid ?? !errors.length, errors, warnings: list(r?.warnings) });
        } catch (err) {
          if (!(err instanceof PalmError)) throw err;
          // Palm answers 400 with every problem at once; anything else means it couldn't check.
          if (err.status === 400) return res.status(200).json({ ok: false, errors: palmErrors(err) });
          if (err.status === 404 || err.status === 501) return res.status(200).json({ ok: true, errors: [], skipped: true });
          throw err;
        }
      }

      case "form-submit": {
        if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "Only an owner or admin can file with the state." });
        const draft = body.draft as FormationDraft | undefined;
        const entityType = formationType(draft?.entityType);
        const assetId = String(body.assetId ?? "");
        const stateName = String(body.stateName ?? "").trim().slice(0, 40);
        const idempotencyKey = String(body.idempotencyKey ?? "").trim();
        if (!draft || !entityType || !isJurisdiction(draft.jurisdiction)) return res.status(400).json({ error: "missing_params" });
        if (!/^[\w-]{8,64}$/.test(assetId) || !stateName || !/^[\w-]{8,255}$/.test(idempotencyKey)) return res.status(400).json({ error: "bad_params" });
        const existing = await readRows("assets", [assetId]);
        if (existing.length) return res.status(409).json({ error: "exists", message: "That entity already exists." });

        let filing: PalmFiling;
        try {
          filing = await palm<PalmFiling>(`/v1/filing/formation/${entityType}`, {
            method: "POST",
            body: buildFormationRequest(draft, assetId),
            headers: { "Idempotency-Key": idempotencyKey },
          });
        } catch (err) {
          if (err instanceof PalmError && err.status === 400) return res.status(400).json({ error: "invalid", message: err.message, errors: palmErrors(err) });
          if (err instanceof PalmError && err.status === 409) return res.status(409).json({ error: "name_taken", message: err.message });
          throw err;
        }
        const state = summarizeFiling(filing);
        // The business Palm created is this entity's: stamp it so documents, mail and the agent find their way back.
        if (filing.business_id) await palm(`/v1/business/${filing.business_id}`, { method: "PATCH", body: { metadata: { bfo_asset_id: assetId } } }).catch(() => {});
        const a = draft.principal;
        const owners = Array.isArray(draft.owners) ? draft.owners : [];
        const record: Record<string, unknown> = {
          name: draft.legalName.trim(),
          type: entityType === "llc" ? "LLC" : "C-Corp",
          state: stateName,
          ein: "",
          createdAt: Date.now(),
          formedVia: "palm",
          address: oneLine(a),
          ...(draft.mailing ? { mailingAddress: oneLine(draft.mailing) } : {}),
          ...(parentOwnerId(owners) ? { ownerId: parentOwnerId(owners) } : {}),
          ...(owners.length ? { members: owners.map((o) => ({ name: ownerName(o), percent: ownerPercent(o) || null, role: entityType === "llc" ? "Member" : "Shareholder" })) } : {}),
          ...(draft.email ? { email: draft.email.trim() } : {}),
          palm: { [mode]: { businessId: filing.business_id ?? null, linkedAt: state.submittedAt, formation: state } },
        };
        Object.assign(record, Object.fromEntries(Object.entries(formationPatch(state, mode)).filter(([k]) => !k.includes("/"))));
        await applyOps([{ op: "set", path: ["assets", assetId], value: record as never }], { id: user.id, name: user.name || user.email, source: "user" });
        return res.status(200).json({ mode, assetId, businessId: filing.business_id ?? null, formation: state });
      }

      case "form-status": {
        const assetId = String(body.assetId ?? "");
        const filingId = String(body.filingId ?? "");
        if (!/^[\w-]{8,64}$/.test(assetId) || !UUID.test(filingId)) return res.status(400).json({ error: "bad_params" });
        const row = (await readRows("assets", [assetId]))[0];
        const data = (row?.data ?? {}) as { palm?: Record<string, { formation?: import("../lib/palm-formation.js").FormationState }> };
        const prev = data.palm?.[mode]?.formation ?? null;
        if (!prev || prev.filingId !== filingId) return res.status(404).json({ error: "not_found" });
        const filing = await palm<PalmFiling>(`/v1/filing/${filingId}`);
        const state = summarizeFiling(filing, prev);
        let patch = formationPatch(state, mode, filing.business_id ?? undefined);
        // The EIN is its own filing; once formation is done, its number is what's left to collect.
        if (state.ein && !state.ein.number && state.ein.status !== "canceled") {
          const einFiling = await palm<PalmFiling>(`/v1/filing/${state.ein.filingId}`).catch(() => null);
          if (einFiling) patch = { ...patch, ...einPatch(einFiling, mode, state) };
        }
        await applyOps([{ op: "update", path: ["assets", assetId], value: patch as never }], PALM);
        return res.status(200).json({ mode, formation: (patch[`palm/${mode}/formation`] as unknown) ?? state, patch });
      }

      case "cases": {
        const assetId = String(body.assetId ?? "");
        if (!/^[\w-]{8,64}$/.test(assetId)) return res.status(400).json({ error: "bad_params" });
        const row = (await readRows("assets", [assetId]))[0];
        const link = ((row?.data ?? {}) as { palm?: Record<string, { businessId?: string | null; formation?: { filingId?: string; ein?: { filingId?: string } | null } }> }).palm?.[mode];
        // The formation, its EIN, and the business itself can each have questions.
        const parents: [string, string][] = [];
        if (link?.formation?.filingId) parents.push(["filing", link.formation.filingId]);
        if (link?.formation?.ein?.filingId) parents.push(["filing", link.formation.ein.filingId]);
        if (link?.businessId) parents.push(["business", link.businessId]);
        const lists = await Promise.all(
          parents.filter(([, id]) => UUID.test(id)).map(([type, id]) => palm<{ data?: PalmCase[] } | PalmCase[]>(`/v1/case?parent_type=${type}&parent_id=${id}`).catch(() => null))
        );
        const seen = new Set<string>();
        const cases = lists
          .flatMap((l) => (Array.isArray(l) ? l : l?.data ?? []))
          .filter((c) => c?.id && !seen.has(c.id) && seen.add(c.id))
          .sort((a, b) => Number(b.status === "needs_response") - Number(a.status === "needs_response") || String(b.opened_at).localeCompare(String(a.opened_at)));
        return res.status(200).json({ mode, cases });
      }

      case "case-respond": {
        if (!isAdmin(user)) return res.status(403).json({ error: "forbidden", message: "An owner or admin answers Palm." });
        const assetId = String(body.assetId ?? "");
        const caseId = String(body.caseId ?? "");
        const fields = body.fields;
        const documents = Array.isArray(body.documents) ? body.documents.map(String) : [];
        if (!/^[\w-]{8,64}$/.test(assetId) || !UUID.test(caseId) || !fields || typeof fields !== "object" || Array.isArray(fields) || !documents.every((d) => UUID.test(d))) {
          return res.status(400).json({ error: "bad_params" });
        }
        if (JSON.stringify(fields).length > 20_000) return res.status(413).json({ error: "too_large" });
        const answered = await palm<PalmCase>(`/v1/case/${caseId}/response`, { method: "POST", body: { response: { fields, ...(documents.length ? { documents } : {}) } } });
        await logActivity(assetId, { id: user.id, name: user.name || user.email, source: "user" }, [
          { kind: "palm", summary: `Answered Palm's question: ${answered?.summary ?? "more information"}`, detail: { fields: Object.keys(fields as object) } },
        ]);
        return res.status(200).json({ mode, case: answered });
      }

      default:
        return res.status(400).json({ error: "unknown_action" });
    }
  } catch (err) {
    if (err instanceof PalmError) {
      const status = err.status === 401 || err.status === 403 ? 502 : err.status >= 500 ? 502 : err.status;
      return res.status(status).json({ error: "palm_error", palmStatus: err.status, message: err.message });
    }
    console.error("palm failed", action, err);
    return res.status(502).json({ error: "palm_failed", message: "Couldn't reach Palm. Try again." });
  }
}

/** Palm's entity_type for a formation, or null for anything else. */
function formationType(v: unknown): "llc" | "corporation" | null {
  return v === "llc" || v === "corporation" ? v : null;
}

/** Palm's problem list, one line each, for a form to show. */
function palmErrors(err: PalmError): { field: string | null; message: string }[] {
  const d = (err.detail ?? {}) as { errors?: { field?: string; path?: string; pointer?: string; message?: string; detail?: string }[]; detail?: string };
  const list = (d.errors ?? []).map((e) => ({ field: e.field ?? e.path ?? e.pointer ?? null, message: e.message ?? e.detail ?? "Problem" }));
  return list.length ? list : [{ field: null, message: err.message }];
}

type UsageRow = { at: string; mode: "test" | "live"; product: PalmProduct; cents: number; actor_name: string | null; asset_id: string | null; reason: string | null };

/** Billed Palm calls: this month's and last month's totals, this month by product, and the latest 30. */
async function usageReport() {
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const rows =
    (await sb<UsageRow[]>(`palm_usage?at=gte.${encodeURIComponent(lastMonth)}&select=at,mode,product,cents,actor_name,asset_id,reason&order=at.desc&limit=10000`)) ?? [];
  const month = { cents: 0, calls: 0, testCalls: 0, byProduct: {} as Partial<Record<PalmProduct, { calls: number; cents: number }>> };
  let lastCents = 0;
  for (const r of rows) {
    if (r.at < thisMonth) {
      lastCents += r.cents;
      continue;
    }
    if (r.mode === "test") month.testCalls++;
    else month.calls++;
    month.cents += r.cents;
    const p = (month.byProduct[r.product] ??= { calls: 0, cents: 0 });
    p.calls++;
    p.cents += r.cents;
  }
  return {
    prices: PALM_PRICES,
    month,
    lastMonth: { cents: lastCents },
    recent: rows.slice(0, 30).map((r) => ({ at: r.at, mode: r.mode, product: r.product, cents: r.cents, by: r.actor_name, assetId: r.asset_id, reason: r.reason })),
  };
}

/** Whether Palm's webhooks are reaching BFO: the last event stored, and how many in the past week. */
async function webhookHealth(): Promise<{ lastAt: string | null; lastType: string | null; lastMode: string | null; weekCount: number; url: string }> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [last, week] = await Promise.all([
    sb<{ type: string; occurred_at: string; mode: string }[]>("palm_events?select=type,occurred_at,mode&order=occurred_at.desc&limit=1").catch(() => []),
    sb<{ id: string }[]>(`palm_events?select=id&occurred_at=gte.${encodeURIComponent(since)}&limit=500`).catch(() => []),
  ]);
  const site = (process.env.SITE_URL?.replace(/\/$/, "") || "https://www.burtonfamilyoffice.com");
  return { lastAt: last[0]?.occurred_at ?? null, lastType: last[0]?.type ?? null, lastMode: last[0]?.mode ?? null, weekCount: week.length, url: `${site}/api/palm-webhook` };
}
