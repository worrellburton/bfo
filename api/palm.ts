import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser, isAdmin, sb } from "../lib/auth.js";
import { buildFormationRequest, einPatch, extraFields, formationPatch, summarizeFiling, type FormationDraft, type PalmFiling } from "../lib/palm-formation.js";
import { applyOps, readRows } from "../lib/tree.js";
import { ownerName, ownerPercent, parentOwnerId } from "../lib/formation-owners.js";
import {
  isJurisdiction,
  normalizeEin,
  normalizeLegalName,
  palm,
  PalmError,
  palmEntityType,
  palmMode,
  vaultAddress,
  type RegisteredAgentService,
} from "../lib/palm.js";

/**
 * Palm, for one entity at a time. POST { action, … }:
 *
 *   status            → { configured, mode }
 *   registry-search   { name | palmId, jurisdiction? } → matches on the state registries
 *   registry-detail   { jurisdiction, number }         → the state's record: status, standing, agent, people
 *   link              { assetId, entity }              → the entity's Palm business (found or added)
 *   ra                { businessId }                   → Palm's registered agent service for it
 *   ra-change         { businessId, assetId }          → move the registered agent to Palm (files with the state)
 *   documents         { businessId }                   → mail and filings Palm holds for it
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
 *
 * Reads need a signed-in user; adding a business needs write access; moving
 * the agent — a state filing billed to the Palm account — needs an owner or admin.
 *
 * Every call may carry the `mode` the page believes it's in; link and
 * ra-change must. If the key has since switched between test and live, the
 * call is refused (409 mode_changed) rather than acting in the other mode.
 */

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body.action || "");
  const mode = palmMode();

  if (action === "status") return res.status(200).json({ configured: !!mode, mode });
  if (!mode) return res.status(503).json({ error: "not_connected", message: "Palm isn't connected yet." });
  const mustMatchMode = action === "link" || action === "ra-change" || action === "form-submit" || action === "form-status";
  if ((body.mode !== undefined || mustMatchMode) && body.mode !== mode) {
    return res.status(409).json({ error: "mode_changed", mode, message: `Palm is now in ${mode} mode. Reload the page and check again before going on.` });
  }

  try {
    switch (action) {
      case "registry-search": {
        const name = String(body.name || "").trim();
        const palmId = String(body.palmId || "").trim();
        if (!name && !palmId) return res.status(400).json({ error: "missing_name" });
        if (palmId && !/^[\w-]{1,128}$/.test(palmId)) return res.status(400).json({ error: "bad_palm_id" });
        const jurisdiction = isJurisdiction(body.jurisdiction) ? body.jurisdiction : undefined;
        const r = await palm<{ data: unknown[] }>("/v1/business/registry/search", {
          method: "POST",
          body: palmId ? { palm_id: palmId } : { name, ...(jurisdiction ? { registration_jurisdiction: jurisdiction } : {}) },
        });
        return res.status(200).json({ mode, results: (r?.data ?? []).slice(0, 10) });
      }

      case "registry-detail": {
        const number = String(body.number || "").trim();
        if (!isJurisdiction(body.jurisdiction) || !number || number.length > 64) return res.status(400).json({ error: "missing_params" });
        const r = await palm(`/v1/business/registry/${body.jurisdiction}/${encodeURIComponent(number)}`);
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

      case "documents": {
        const id = String(body.businessId || "");
        if (!UUID.test(id)) return res.status(400).json({ error: "bad_business_id" });
        // Follow the pages so nothing — legal papers above all — is cut off.
        const documents: unknown[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
          const r: { data?: unknown[]; has_more?: boolean; next_cursor?: string | null } = await palm(`/v1/business/${id}/document?limit=100${q}`);
          documents.push(...(r?.data ?? []));
          if (!r?.has_more || !r.next_cursor) break;
          cursor = r.next_cursor;
        }
        return res.status(200).json({ mode, documents });
      }

      case "document": {
        const id = String(body.documentId || "");
        if (!DOC_ID.test(id)) return res.status(400).json({ error: "bad_document_id" });
        const r = await fetch(`https://api.getpalm.com/v1/document/${id}/content`, {
          headers: { Authorization: `Bearer ${process.env.PALM_API_KEY}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ error: "document_unavailable" });
        const buf = Buffer.from(await r.arrayBuffer());
        // Only PDFs and images are shown inline; anything else is a download, never a page on our origin.
        const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        const safe = ct === "application/pdf" || /^image\/(png|jpeg|gif|webp)$/.test(ct);
        res.setHeader("Content-Type", safe ? ct : "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const cd = r.headers.get("content-disposition");
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
          return res.status(200).json({ mode, supported: true, expeditedTiers: r.expedited_tiers ?? [], extra: extraFields(r.schema) });
        } catch (err) {
          if (err instanceof PalmError && (err.status === 404 || err.status === 501)) return res.status(200).json({ mode, supported: false, expeditedTiers: [], extra: [] });
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
          `/v1/business/registry/${jurisdiction}/name-eligibility?${q}`
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
          await palm(`/v1/filing/formation/${entityType}/validate`, { method: "POST", body: buildFormationRequest(draft, "pending") });
          return res.status(200).json({ ok: true, errors: [] });
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
          address: [[a.street1, a.street2].filter((x) => x?.trim()).join(", "), a.city, `${a.region.toUpperCase()} ${a.postal}`].filter(Boolean).join(", "),
          ...(parentOwnerId(owners) ? { ownerId: parentOwnerId(owners) } : {}),
          ...(owners.length ? { members: owners.map((o) => ({ name: ownerName(o), percent: ownerPercent(o) || null, role: "Member" })) } : {}),
          ...(draft.email ? { email: draft.email.trim() } : {}),
          palm: { [mode]: { businessId: filing.business_id ?? null, linkedAt: state.submittedAt, formation: state } },
        };
        Object.assign(record, Object.fromEntries(Object.entries(formationPatch(state, mode)).filter(([k]) => !k.includes("/"))));
        await applyOps([{ op: "set", path: ["assets", assetId], value: record as never }]);
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
        await applyOps([{ op: "update", path: ["assets", assetId], value: patch as never }]);
        return res.status(200).json({ mode, formation: (patch[`palm/${mode}/formation`] as unknown) ?? state, patch });
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
