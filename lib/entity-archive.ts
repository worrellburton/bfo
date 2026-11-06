/**
 * Keep, don't delete (docs/DESIGN.md §11.1): the rules for archiving an
 * entity, restoring it, removing a record made by mistake, and purging a
 * removed document. Pure, so they're tested without a network; the
 * endpoints (api/entity-archive.ts, api/documents/delete.ts) apply them.
 *
 * - Archiving hides an entity from the lists and makes it read-only. Its
 *   documents, contracts, filings, owners and activity are all kept, and it
 *   still exists with the state. Owners and admins only.
 * - Removing a record (a permanent delete) is only for one recorded by
 *   mistake: nothing on file, no EIN, no filings, no owners, no contracts,
 *   no entities under it, never linked to Palm. Anything with standing is
 *   archived instead. Owners and admins only.
 * - A removed document is kept in Removed. An owner or admin may delete it for good
 *   once it has been there RETENTION_DAYS, unless the entity is on legal
 *   hold, and with a reason.
 *
 * HTTP surface: none; a library.
 * Who may call it: server code, after its own role check.
 * Env: none.
 */

export const RETENTION_DAYS = 30;
const DAY = 86_400_000;

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/** The filing slots an entity record may hold (app/entity-paperwork.ts DOC_KEYS). */
const SLOTS = [
  "articles",
  "einLetter",
  "w9",
  "operatingAgreement",
  "trustAgreement",
  "trustCertificate",
  "trustSchedule",
  "sElection",
  "sElectionAccepted",
  "classElection",
  "annualReport",
  "foreignRegistration",
  "goodStanding",
  "ownershipLedger",
  "minutes",
];

/** What an entity has on record that gives it standing, as plain phrases ("an EIN", "4 documents"). Empty means it was recorded by mistake. */
export function standingOf(data: unknown, childCount: number): string[] {
  const a = obj(data);
  const out: string[] = [];
  const n = (k: string) => Object.keys(obj(a[k])).length;
  if (filled(a.ein)) out.push("an EIN");
  const docs = n("documents") + n("removedDocuments");
  if (docs) out.push(`${docs} document${docs === 1 ? "" : "s"}`);
  const slots = SLOTS.filter((k) => a[k]).length;
  if (slots) out.push(`${slots} filing${slots === 1 ? "" : "s"}`);
  const contracts = n("contracts");
  if (contracts) out.push(`${contracts} contract${contracts === 1 ? "" : "s"}`);
  const members = Array.isArray(a.members) ? a.members.length : n("members");
  if (members || filled(a.trustees) || filled(a.grantors)) out.push("owners or trustees");
  if (childCount) out.push(`${childCount} ${childCount === 1 ? "entity" : "entities"} it owns`);
  if (Object.values(obj(a.palm)).some((p) => filled(obj(p).businessId) || obj(p).formation)) out.push("a link to Palm");
  if (a.stateRecord || filled(a.fileNumber) || filled(a.formationDate)) out.push("a state registration");
  if (a.closing) out.push("a closing under way");
  return out;
}

export type ArchiveAction = "archive" | "restore" | "remove";

/** Why this person may not do this to this entity now, or null. */
export function archiveRefusal(action: ArchiveAction, data: unknown, opts: { admin: boolean; childCount: number }): { status: number; code: string; message: string } | null {
  const a = obj(data);
  if (!data) return { status: 404, code: "not_found", message: "There's no such entity." };
  if (action === "remove") {
    if (!opts.admin) return { status: 403, code: "owner_or_admin", message: "Only an owner or an admin can remove a record from BFO." };
    const has = standingOf(a, opts.childCount);
    if (has.length) return { status: 409, code: "keep_it", message: `It has ${has.join(", ")} on record, so it's kept: archive it instead.` };
    return null;
  }
  if (!opts.admin) return { status: 403, code: "owner_or_admin", message: "Only an owner or an admin can archive or restore an entity." };
  if (action === "archive" && a.archived) return { status: 409, code: "already_archived", message: "It's already archived." };
  if (action === "restore" && !a.archived) return { status: 409, code: "not_archived", message: "It isn't archived." };
  return null;
}

/** Why an admin may not delete this removed document for good yet, or null. `now` in ms. */
export function purgeRefusal(data: unknown, docId: string, opts: { admin: boolean; reason: string; now: number }): { status: number; code: string; message: string } | null {
  if (!opts.admin) return { status: 403, code: "owner_or_admin", message: "Only an owner or an admin can delete a document for good." };
  const a = obj(data);
  if (!data) return { status: 404, code: "not_found", message: "There's no such entity." };
  if (a.legalHold) return { status: 409, code: "legal_hold", message: "Its documents are on legal hold: nothing can be deleted until the hold is lifted." };
  const doc = obj(obj(a.removedDocuments)[docId]);
  if (!Object.keys(doc).length) return { status: 409, code: "not_removed", message: "Remove the document first; it's kept in Removed before it can be deleted." };
  const at = Number(doc.removedAt);
  if (!Number.isFinite(at) || opts.now - at < RETENTION_DAYS * DAY) {
    const left = Number.isFinite(at) ? Math.ceil((at + RETENTION_DAYS * DAY - opts.now) / DAY) : RETENTION_DAYS;
    return { status: 409, code: "retention", message: `It's kept for ${RETENTION_DAYS} days after it's removed: ${left} ${left === 1 ? "day" : "days"} to go.` };
  }
  if (opts.reason.trim().length < 3) return { status: 400, code: "reason_required", message: "Say why it's being deleted for good." };
  return null;
}

/** The storage path of a removed document, when it's one of this entity's own files. */
export function removedPath(data: unknown, assetId: string, docId: string): string | null {
  const doc = obj(obj(obj(data).removedDocuments)[docId]);
  const path = typeof doc.storagePath === "string" ? doc.storagePath : "";
  return path.startsWith(`assets/${assetId}/`) && !path.includes("..") ? path : null;
}
