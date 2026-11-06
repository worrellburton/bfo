/**
 * An account's settings in Treasury: its nickname, whether Treasury hides it,
 * and who owns it (an entity, one person, or joint owners), with its tax
 * status and any beneficiary entity.
 *
 * GET  ?account_id=…  → what a change would reach: the account's Books
 *                       transactions (count, first and last date) and its
 *                       current settings. Any signed-in staff role.
 * POST { account_id, nickname?, hidden?, entity_id?, entity_name?,
 *        owner_kind?, owner_names?, tenancy?, tax_status?,
 *        beneficiary_entity_id?, beneficiary_name? }
 *      → saves the fields given; answers { prefs }.
 * POST { account_ids: [...], hidden }  → hides or shows several accounts in
 *      one call (the dormant accounts), answering { saved: [...], failed: [...] }.
 *
 * Every change is written to the audit log (lib/audit.ts) with its before and
 * after, and an owner change to the activity of the entities it moves
 * between. A retirement account can't be given to an entity
 * (app/treasury-model.ts validateOwner).
 *
 * Who may call it: owners, admins and members (canWrite) for POST; viewers
 * may read. Partners get 403 (PartnerRefused).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (lib/auth.ts).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { canWrite, currentUser, fail, guard, handleError, sb, type AppUser } from "../../lib/auth.js";
import { fetchAll } from "../../lib/db-pages.js";
import { audit } from "../../lib/audit.js";
import { logActivity } from "../../lib/activity.js";
import { bookSpans } from "../../lib/plaid-history.js";
import { keepColumnsReady } from "../../lib/plaid-mappings.js";
import { validateOwner } from "../../app/treasury-model.js";

type PrefRow = {
  account_id: string;
  nickname: string | null;
  hidden: boolean | null;
  entity_id: string | null;
  entity_name: string | null;
  account_name: string | null;
  institution_name: string | null;
  mask: string | null;
  subtype: string | null;
  owner_kind?: string | null;
  owner_names?: string[] | null;
  tenancy?: string | null;
  tax_status?: string | null;
  beneficiary_entity_id?: string | null;
  beneficiary_name?: string | null;
};

const OWNER_KEYS = ["owner_kind", "owner_names", "tenancy", "tax_status", "beneficiary_entity_id", "beneficiary_name"] as const;

/** "Checking •• 4821" for the trail: the name people know, and the last four. */
function labelOf(p: Partial<PrefRow> | undefined, id: string): string {
  const name = p?.nickname || p?.account_name || "Account";
  return p?.mask ? `${name} •• ${p.mask}` : name || id;
}

/** The fields that changed, as { field: { from, to } }. Pure, so the trail reads the same everywhere. */
export function changesOf(before: Partial<PrefRow> | undefined, row: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(row)) {
    if (k === "account_id" || k === "updated_at" || k === "updated_by") continue;
    const from = (before as Record<string, unknown> | undefined)?.[k] ?? null;
    const same = JSON.stringify(from ?? null) === JSON.stringify(to ?? null) || (k === "hidden" && !!from === !!to);
    if (!same) out[k] = { from: from ?? null, to: to ?? null };
  }
  return out;
}

async function readPref(accountId: string): Promise<PrefRow | undefined> {
  const rows = await sb<PrefRow[]>(`plaid_account_prefs?account_id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`);
  return rows?.[0];
}

async function trail(user: AppUser, accountId: string, before: PrefRow | undefined, changes: Record<string, { from: unknown; to: unknown }>) {
  const label = labelOf(before, accountId);
  const keys = Object.keys(changes);
  if (!keys.length) return;
  const ownerMoved = "entity_id" in changes || "owner_kind" in changes || "owner_names" in changes;
  const action = ownerMoved
    ? "treasury.account_owner"
    : "hidden" in changes
      ? changes.hidden.to
        ? "treasury.account_hide"
        : "treasury.account_show"
      : "nickname" in changes
        ? "treasury.account_rename"
        : "treasury.account_update";
  const summary = ownerMoved
    ? `Changed the owner of ${label}`
    : "hidden" in changes
      ? `${changes.hidden.to ? "Hid" : "Showed"} ${label} in Treasury`
      : "nickname" in changes
        ? `Renamed ${label} to “${changes.nickname.to ?? label}”`
        : `Updated ${label}`;
  await audit({ actor: user, action, target: { type: "bank_account", id: accountId, label }, summary, detail: { changes, institution: before?.institution_name ?? null } });

  if ("entity_id" in changes) {
    const actor = { id: user.id, name: user.name, source: "user" as const };
    const from = changes.entity_id.from as string | null;
    const to = changes.entity_id.to as string | null;
    const toName = (changes.entity_name?.to as string | null) ?? null;
    const fromName = (changes.entity_name?.from as string | null) ?? before?.entity_name ?? null;
    if (from)
      await logActivity(from, actor, [
        { kind: "treasury", summary: `${label} moved ${toName ? `to ${toName}` : "off this entity"}. Its Books history moves with it.`, detail: { account_id: accountId } },
      ]);
    if (to)
      await logActivity(to, actor, [
        { kind: "treasury", summary: `${label} mapped to this entity${fromName ? ` from ${fromName}` : ""}. Its Books history moves with it.`, detail: { account_id: accountId } },
      ]);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res, ["GET", "POST"])) return;

  try {
    // currentUser throws PartnerRefused for a partner; handleError answers 403.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, "unauthorized");

    if (req.method === "GET") {
      const accountId = String(req.query.account_id ?? "").trim();
      if (!accountId) return fail(res, 400, "missing_account_id");
      const rows = await fetchAll<{ account_id: string; date: string }>(`book_transactions?account_id=eq.${encodeURIComponent(accountId)}&select=account_id,date&order=transaction_id.asc`);
      const span = bookSpans(rows).get(accountId) ?? { count: 0, from: null, to: null };
      return res.json({ account_id: accountId, books: span, prefs: (await readPref(accountId)) ?? null });
    }

    if (!canWrite(user)) return fail(res, 403, "forbidden", "Viewers can see Treasury but not change it.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();

    // Several accounts hidden or shown at once (the dormant ones): one call, one entry each in the trail.
    if (Array.isArray(body.account_ids)) {
      const ids = body.account_ids.filter((x): x is string => typeof x === "string" && !!x).slice(0, 100);
      if (!ids.length || typeof body.hidden !== "boolean") return fail(res, 400, "bad_request");
      const saved: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const before = await readPref(id);
          await sb("plaid_account_prefs", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { account_id: id, hidden: body.hidden, updated_at: now } });
          saved.push(id);
          await trail(user, id, before, changesOf(before, { hidden: body.hidden }));
        } catch (err) {
          console.error("account-prefs: couldn't save one account", { saved: false });
          failed.push(id);
          void err;
        }
      }
      return res.status(failed.length && !saved.length ? 500 : 200).json({ saved, failed });
    }

    const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
    if (!accountId) return fail(res, 400, "missing_account_id");
    const before = await readPref(accountId);

    const row: Record<string, unknown> = { account_id: accountId, updated_at: now };
    if (body.nickname !== undefined)
      row.nickname =
        String(body.nickname ?? "")
          .trim()
          .slice(0, 60) || null;
    if (body.hidden !== undefined) row.hidden = !!body.hidden;

    const ownerTouched = body.entity_id !== undefined || OWNER_KEYS.some((k) => body[k] !== undefined);
    if (ownerTouched) {
      const ready = await keepColumnsReady();
      const extended = OWNER_KEYS.some((k) => body[k] !== undefined);
      if (extended && !ready) return fail(res, 503, "not_ready", "Recording a person or joint owner needs a database update that hasn't been applied yet.");
      const checked = validateOwner(body, { subtype: before?.subtype ?? null, name: before?.account_name ?? null });
      if (!checked.ok) return fail(res, 422, "invalid_owner", checked.message);
      row.entity_id = checked.row.entity_id;
      row.entity_name = checked.row.entity_name;
      if (ready) {
        row.owner_kind = checked.row.owner_kind;
        row.owner_names = checked.row.owner_names;
        row.tenancy = checked.row.tenancy;
        if (checked.row.tax_status !== undefined) row.tax_status = checked.row.tax_status;
        if (checked.row.beneficiary_entity_id !== undefined) {
          row.beneficiary_entity_id = checked.row.beneficiary_entity_id;
          row.beneficiary_name = checked.row.beneficiary_name ?? null;
        }
        row.updated_by = user.id;
      }
    } else if (body.tax_status !== undefined) {
      if (!(await keepColumnsReady())) return fail(res, 503, "not_ready", "Recording tax status needs a database update that hasn't been applied yet.");
      const checked = validateOwner(
        { tax_status: body.tax_status, owner_kind: before?.owner_kind ?? null, owner_names: before?.owner_names, tenancy: before?.tenancy, entity_id: before?.entity_id },
        { subtype: null, name: null },
      );
      if (!checked.ok) return fail(res, 422, "invalid_tax_status", checked.message);
      row.tax_status = checked.row.tax_status ?? null;
    }

    const saved = await sb<PrefRow[]>("plaid_account_prefs", { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: row });
    await trail(user, accountId, before, changesOf(before, row));
    return res.status(200).json({ prefs: saved?.[0] ?? null });
  } catch (err) {
    return handleError(res, err);
  }
}
