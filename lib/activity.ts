import { sb } from "./auth.js";

/**
 * Each entity's activity (public.entity_activity): what changed, who changed
 * it, and when. Writes to the tree are compared before and after
 * (describeChange) and told as a few plain lines; Palm, Stable, invites and
 * shared links add their own. The pure pieces are exported so they're tested
 * without a network.
 *
 * The log is append-only: every write is its own row, never edited or
 * deleted afterwards (the migration 20261108_entity_activity_append_only.sql
 * makes the table refuse it). A run of one person's edits is grouped when
 * it's shown (app/entity/activity.tsx), not by rewriting rows.
 *
 * HTTP surface: none; a library for api/tree.ts (through lib/tree.ts),
 * api/documents/url.ts, the Palm and Stable webhooks.
 * Who may call it: server code, after its own role check.
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through sb() in lib/auth.ts).
 */

export type Actor = { id: string | null; name: string | null; source: "user" | "palm" | "stable" | "system" };
type FieldChange = { key: string; label: string; from: string | null; to: string | null };
type ActivityEntry = { kind: string; summary: string; detail?: Record<string, unknown> | null };
type ActivityRow = {
  id: number;
  asset_id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  source: Actor["source"];
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
};

type Rec = Record<string, any>;

/** The record's own fields, as people call them. */
const FIELDS: Record<string, string> = {
  name: "Legal name",
  type: "Entity type",
  state: "State",
  ein: "EIN",
  address: "Principal office",
  mailingAddress: "Mailing address",
  registeredAgentAddress: "Registered agent's address",
  formationDate: "Formation date",
  registeredAgent: "Registered agent",
  llcType: "Tax classification",
  ownerId: "Owner",
  status: "Status",
  fileNumber: "State file number",
  stateLink: "State record link",
  email: "Email",
  trustees: "Trustees",
  grantors: "Grantors",
  beneficiaries: "Beneficiaries",
  operatingAgreementDate: "Operating agreement date",
  articlesOfOrgDate: "Articles filing date",
  annualReportYear: "Annual report year",
  taxYearEnd: "Tax year end",
  accountingMethod: "Accounting method",
};
/** Changed without showing the before and after (none: notes show both, cut to 160 characters). */
const QUIET = new Set<string>();

/** Filing slots (app/entity/model.ts FALLBACK_TITLE). */
const SLOTS: Record<string, string> = {
  articles: "Formation filing",
  einLetter: "EIN Letter",
  w9: "Form W-9",
  operatingAgreement: "Operating agreement",
  trustAgreement: "Trust Agreement",
  trustCertificate: "Certification of Trust",
  trustSchedule: "Schedule A & assignments",
  sElection: "Form 2553 (S election)",
  sElectionAccepted: "CP261 (S election accepted)",
  classElection: "Form 8832 + IRS acceptance",
  annualReport: "Annual report",
  foreignRegistration: "Foreign registration",
  goodStanding: "Certificate of Good Standing",
  ownershipLedger: "Ownership ledger",
  minutes: "Minutes / consents",
};

const ADDRESS_STEPS: Record<string, string> = { state: "the state", irs: "the IRS", banks: "the banks" };

const FILING_STATUS: Record<string, string> = {
  draft: "is a draft",
  submitted: "was submitted",
  processing: "is with the state",
  pending: "is pending",
  action_required: "needs an answer",
  completed: "is complete: the state approved it",
  canceled: "was canceled",
  rejected: "was rejected",
};

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const quote = (s: string) => `“${s}”`;

/** "Changed the EIN to 93-1234567", or for several, "Changed the address, EIN and owner". */
export function editSummary(fields: FieldChange[]): string {
  if (fields.length === 1) {
    const f = fields[0];
    if (QUIET.has(f.key) || f.key === "notes") return `Edited the ${f.label.toLowerCase()}`;
    if (f.to === null) return `Cleared the ${lower(f.label)}`;
    return `${f.from === null ? "Set" : "Changed"} the ${lower(f.label)} to ${f.to}`;
  }
  return `Changed the ${list(fields.map((f) => lower(f.label)))}`;
}
/** "EIN" stays "EIN"; "Legal name" reads "legal name". */
const lower = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label[0].toLowerCase() + label.slice(1));

/**
 * One entity's record before and after a write, told as activity. `names`
 * turns an entity id (an owner) into its name.
 */
export function describeChange(before: Rec | null, after: Rec | null, names: (id: string) => string | null = () => null): ActivityEntry[] {
  if (!before && after) return [{ kind: "created", summary: `Added ${after.name ? quote(after.name) : "the entity"}` }];
  if (before && !after) return [{ kind: "deleted", summary: `Deleted ${before.name ? quote(before.name) : "the entity"}` }];
  if (!before || !after) return [];
  const out: ActivityEntry[] = [];

  // Fields
  const fields: FieldChange[] = [];
  for (const [key, label] of Object.entries(FIELDS).concat([["notes", "Notes"]])) {
    if (same(before[key], after[key])) continue;
    const show = (v: unknown) => (key === "ownerId" && typeof v === "string" ? (names(v) ?? v) : text(v));
    fields.push({ key, label, from: QUIET.has(key) ? null : show(before[key]), to: QUIET.has(key) ? null : show(after[key]) });
  }
  // The agent and file number in each state it's registered in as a foreign entity.
  const foreignOf = (r: Rec): Record<string, Rec> => (r.foreign && typeof r.foreign === "object" ? r.foreign : {});
  for (const code of new Set([...Object.keys(foreignOf(before)), ...Object.keys(foreignOf(after))])) {
    const b = foreignOf(before)[code] ?? {};
    const a = foreignOf(after)[code] ?? {};
    for (const [k, label] of [
      ["agent", "agent"],
      ["agentAddress", "agent's address"],
      ["fileNumber", "file number"],
    ] as const) {
      if (!same(b[k], a[k])) fields.push({ key: `foreign.${code}.${k}`, label: `${code} ${label}`, from: text(b[k]), to: text(a[k]) });
    }
  }
  // Why a key fact changed (the edit form asks: a correction, or a real change with its effective date).
  const note = after.changeNote && after.changeNote.at !== before.changeNote?.at ? (after.changeNote as Rec) : null;
  const why = note
    ? `${note.kind === "change" ? `A real change${note.effective ? `, effective ${note.effective}` : ""}` : "A correction"}${note.reason ? `: ${String(note.reason)}` : ""}`
    : null;
  if (fields.length) out.push({ kind: "edit", summary: editSummary(fields), detail: { fields, ...(why ? { reason: why } : {}) } });

  // Owners
  const owners = (r: Rec) => (Array.isArray(r.members) ? (r.members as Rec[]) : []).filter((m) => m && m.name);
  if (!same(owners(before), owners(after))) {
    const was = new Map(owners(before).map((m) => [m.name as string, m]));
    const now = new Map(owners(after).map((m) => [m.name as string, m]));
    const added = [...now.keys()].filter((n) => !was.has(n));
    const removed = [...was.keys()].filter((n) => !now.has(n));
    const changed = [...now.keys()].filter((n) => was.has(n) && !same(was.get(n), now.get(n)));
    const bits = [added.length ? `added ${list(added)}` : "", removed.length ? `removed ${list(removed)}` : "", changed.length ? `updated ${list(changed)}` : ""].filter(Boolean);
    const shares = owners(after).map((m) => `${m.name}${typeof m.percent === "number" ? ` ${m.percent}%` : ""}`);
    out.push({ kind: "owners", summary: bits.length ? `Owners: ${bits.join("; ")}` : "Reordered the owners", detail: { owners: shares } });
  }

  // Documents
  const docs = (r: Rec): Record<string, Rec> => (r.documents && typeof r.documents === "object" ? r.documents : {});
  const db = docs(before);
  const da = docs(after);
  const uploaded = Object.keys(da).filter((k) => !db[k] && da[k]?.name && !(before.removedDocuments && (before.removedDocuments as Rec)[k]));
  const deleted = Object.keys(db).filter((k) => !da[k] && db[k]?.name);
  if (uploaded.length)
    out.push({
      kind: "upload",
      summary: uploaded.length === 1 ? `Uploaded ${quote(da[uploaded[0]].name)}` : `Uploaded ${uploaded.length} documents`,
      detail: { names: uploaded.map((k) => da[k].name) },
    });
  // Taken out of the library into Removed (kept), back again, or deleted for good from Removed.
  const removedOf = (r: Rec): Record<string, Rec> => (r.removedDocuments && typeof r.removedDocuments === "object" ? r.removedDocuments : {});
  const rb = removedOf(before);
  const ra = removedOf(after);
  const removed = deleted.filter((k) => ra[k]);
  const gone = deleted.filter((k) => !ra[k]);
  if (removed.length) {
    const reason = removed.map((k) => ra[k]?.reason).find((r) => typeof r === "string" && r.trim());
    out.push({
      kind: "delete",
      summary: removed.length === 1 ? `Removed ${quote(db[removed[0]].name)} from the library (kept in Removed)` : `Removed ${removed.length} documents from the library (kept in Removed)`,
      detail: { names: removed.map((k) => db[k].name), ...(reason ? { reason } : {}) },
    });
  }
  if (gone.length) out.push({ kind: "delete", summary: gone.length === 1 ? `Deleted ${quote(db[gone[0]].name)}` : `Deleted ${gone.length} documents`, detail: { names: gone.map((k) => db[k].name) } });
  for (const k of Object.keys(rb)) {
    if (ra[k]) continue;
    if (da[k]) out.push({ kind: "upload", summary: `Restored ${quote(String(rb[k]?.name ?? "a document"))} to the library` });
    else out.push({ kind: "delete", summary: `Deleted ${quote(String(rb[k]?.name ?? "a document"))} for good`, detail: rb[k]?.purgeReason ? { reason: String(rb[k].purgeReason) } : null });
  }
  for (const k of Object.keys(da)) {
    if (db[k]?.name && da[k]?.name && db[k].name !== da[k].name) out.push({ kind: "rename", summary: `Renamed ${quote(db[k].name)} to ${quote(da[k].name)}` });
  }

  // Filing slots
  for (const [key, title] of Object.entries(SLOTS)) {
    const b = before[key] as Rec | undefined;
    const a = after[key] as Rec | undefined;
    if (same(b?.fileName, a?.fileName) && same(b?.docId, a?.docId)) continue;
    if (a?.fileName && !b?.fileName) out.push({ kind: "filed", summary: `Filed ${quote(a.fileName)} as the ${lower(title)}` });
    else if (a?.fileName) out.push({ kind: "filed", summary: `Replaced the ${lower(title)} with ${quote(a.fileName)}` });
    else if (b?.fileName) out.push({ kind: "unfiled", summary: `Took ${quote(b.fileName)} off the ${lower(title)}` });
  }

  // The address change's paperwork
  const steps = (r: Rec): Rec => (r.addressUpdates && typeof r.addressUpdates === "object" ? r.addressUpdates : {});
  for (const [step, who] of Object.entries(ADDRESS_STEPS)) {
    const b = steps(before)[step];
    const a = steps(after)[step];
    if (same(b, a)) continue;
    const proof = (after.addressUpdateRefs ?? {})[step] as Rec | undefined;
    out.push({
      kind: "address",
      summary: a ? `Marked the new address as reported to ${who}${proof?.on ? `, sent ${proof.on}` : ""}` : `Unmarked the new address as reported to ${who}`,
      detail: a && proof?.ref ? { reason: `Tracking or confirmation number ${String(proof.ref)}` } : null,
    });
  }

  // Palm
  for (const mode of ["live", "test"]) {
    const pb = (before.palm?.[mode] ?? null) as Rec | null;
    const pa = (after.palm?.[mode] ?? null) as Rec | null;
    const tag = mode === "test" ? " (test)" : "";
    if (pa?.businessId && pb?.businessId !== pa.businessId && !pa.formation) out.push({ kind: "palm", summary: `Linked to Palm${tag}` });
    const fb = pb?.formation as Rec | undefined;
    const fa = pa?.formation as Rec | undefined;
    if (fa && !fb) out.push({ kind: "palm", summary: `Filed the formation with Palm${tag}`, detail: { jurisdiction: fa.jurisdiction ?? null, expedited: fa.expeditedTier ?? null } });
    else if (fa && fb && fa.status !== fb.status) {
      out.push({
        kind: "palm",
        summary: `The formation ${FILING_STATUS[fa.status] ?? `is ${String(fa.status).replace(/_/g, " ")}`}${tag}`,
        detail: fa.statusReason ? { reason: fa.statusReason } : null,
      });
    }
    if (fa?.ein && fb?.ein?.status !== fa.ein.status && fb) {
      out.push({
        kind: "palm",
        summary: fa.ein.status === "completed" ? `The IRS issued the EIN${fa.ein.number ? ` ${fa.ein.number}` : ""}${tag}` : `EIN application ${String(fa.ein.status).replace(/_/g, " ")}${tag}`,
      });
    }
    if (fa && fb && (fa.openCases ?? 0) > (fb.openCases ?? 0)) out.push({ kind: "palm", summary: `Palm opened a case that needs an answer${tag}` });
  }

  // The state's record, as read through Palm
  const sb0 = before.stateRecord as Rec | undefined;
  const sa = after.stateRecord as Rec | undefined;
  const stateWho = typeof after.state === "string" && after.state.trim() ? `${after.state.trim()}'s record` : "The state's record";
  if (sa && !sb0) out.push({ kind: "state", summary: `Read ${stateWho.replace(/^The/, "the")} through Palm` });
  else if (sa && sb0) {
    // Only a value that was there and is now different: a field read for the first time isn't a change.
    const moved = (["status", "standing", "address", "agent"] as const).filter((k) => sb0[k] != null && sa[k] != null && !same(sb0[k], sa[k]));
    const say = (k: string, v: any): string =>
      k === "standing"
        ? `standing ${Object.entries((v ?? {}) as Record<string, string>)
            .map(([part, s]) => `${part === "registration" ? "filings" : part} ${s === "compliant" ? "current" : "behind"}`)
            .join(", ")}`
        : k === "status"
          ? `status ${v}`
          : k === "agent"
            ? `agent ${v}`
            : `address ${v}`;
    if (moved.length) out.push({ kind: "state", summary: `${stateWho}, read through Palm: ${moved.map((k) => say(k, sa[k]).replace(/^(status|standing|agent|address) /, "$1 now ")).join("; ")}` });
  }

  // Foreign registrations: reading another state's record, and deciding whether it does business there
  const fb = (before.foreign ?? {}) as Record<string, Rec>;
  const fa = (after.foreign ?? {}) as Record<string, Rec>;
  for (const code of Object.keys(fa)) {
    if (fa[code]?.record && fa[code].record.checkedAt !== fb[code]?.record?.checkedAt) out.push({ kind: "state", summary: `Read ${code}'s record through Palm` });
  }
  for (const code of new Set([...Object.keys(fb), ...Object.keys(fa)])) {
    const b = fb[code] ?? {};
    const a = fa[code] ?? {};
    const reason = typeof a.decisionReason === "string" && a.decisionReason !== b.decisionReason ? { reason: a.decisionReason } : null;
    if (a.confirmed && !b.confirmed) out.push({ kind: "decision", summary: `Decided it does business in ${code}: it must register there`, detail: reason });
    else if (a.notNeeded && !b.notNeeded) out.push({ kind: "decision", summary: `Decided it doesn't do business in ${code}: only its mail goes there`, detail: reason });
    else if ((b.confirmed && !a.confirmed) || (b.notNeeded && !a.notNeeded)) out.push({ kind: "decision", summary: `Reopened whether it does business in ${code}` });
  }

  // The state's site seen to say active over Palm's copy
  if (after.stateConfirmed?.at && after.stateConfirmed.at !== before.stateConfirmed?.at)
    out.push({ kind: "state", summary: "Confirmed on the state's own site that it's active and in good standing", detail: after.stateConfirmed.note ? { reason: String(after.stateConfirmed.note) } : null });
  else if (before.stateConfirmed?.at && !after.stateConfirmed) out.push({ kind: "state", summary: "Withdrew the confirmation from the state's own site" });

  // Archive
  if (after.archived?.at && after.archived.at !== before.archived?.at)
    out.push({ kind: "archive", summary: "Archived it: hidden from the lists, everything kept", detail: after.archived.reason ? { reason: String(after.archived.reason) } : null });
  else if (before.archived?.at && !after.archived) out.push({ kind: "archive", summary: "Restored it from the archive" });

  // A legal hold
  if (after.legalHold?.at && after.legalHold.at !== before.legalHold?.at) out.push({ kind: "hold", summary: "Put its documents on legal hold", detail: after.legalHold.note ? { reason: String(after.legalHold.note) } : null });
  else if (before.legalHold?.at && !after.legalHold) out.push({ kind: "hold", summary: "Lifted the legal hold" });

  // Facts read by AI, proposed and then accepted or dismissed by a person
  const pb = (before.proposed ?? {}) as Record<string, Rec | null>;
  const pa = (after.proposed ?? {}) as Record<string, Rec | null>;
  for (const key of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
    const label = lower(FIELDS[key] ?? (key === "members" ? "Owners" : key));
    const was = pb[key];
    const now = pa[key];
    if (now && (!was || was.at !== now.at)) out.push({ kind: "ai", summary: `AI read the ${label} from ${now.docName ? quote(String(now.docName)) : "a document"}: proposed, not on the record yet` });
    else if (was && !now) {
      const accepted = same(after[key], was.value);
      out.push({ kind: "ai", summary: accepted ? `Accepted the ${label} read by AI from ${was.docName ? quote(String(was.docName)) : "a document"}` : `Dismissed the ${label} read by AI` });
    }
  }
  if (after.profile?.checkedAt && after.profile.checkedAt !== before.profile?.checkedAt) {
    const from = Array.isArray(after.profile.sources) && after.profile.sources.length ? ` from ${list(after.profile.sources.map((x: unknown) => quote(String(x))))}` : "";
    out.push({ kind: "ai", summary: `Summary by AI${from}` });
  }

  // Closing it down
  const cb0 = before.closing as Rec | null | undefined;
  const ca0 = after.closing as Rec | null | undefined;
  if (ca0 && !cb0) out.push({ kind: "closing", summary: "Started closing it down" });
  else if (!ca0 && cb0) out.push({ kind: "closing", summary: "Stopped closing it down" });
  else if (ca0 && cb0) {
    const sb1 = (cb0.steps ?? {}) as Record<string, string | null>;
    const sa1 = (ca0.steps ?? {}) as Record<string, string | null>;
    for (const k of new Set([...Object.keys(sb1), ...Object.keys(sa1)])) {
      if (!sb1[k] && sa1[k]) out.push({ kind: "closing", summary: `Closing: done with ${stepWords(k)}` });
      else if (sb1[k] && !sa1[k]) out.push({ kind: "closing", summary: `Closing: reopened ${stepWords(k)}` });
    }
    if (ca0.closedAt && !cb0.closedAt) out.push({ kind: "closing", summary: "Marked dissolved" });
  }

  // Checks
  if (after.verification?.checkedAt && after.verification.checkedAt !== before.verification?.checkedAt) {
    const issues = Array.isArray(after.verification.issues) ? after.verification.issues.length : 0;
    out.push({ kind: "check", summary: issues ? `Ran the document check: ${issues} issue${issues === 1 ? "" : "s"}` : "Ran the document check: all clear" });
  }

  // Agreements
  const contracts = (r: Rec): Record<string, Rec> => (r.contracts && typeof r.contracts === "object" ? r.contracts : {});
  const cb = contracts(before);
  const ca = contracts(after);
  for (const [k, c] of Object.entries(ca)) {
    if (!cb[k]) out.push({ kind: "agreement", summary: `Added an agreement with ${c.counterparty || "a counterparty"}` });
    else if (cb[k].status !== c.status && c.status) out.push({ kind: "agreement", summary: `The agreement with ${c.counterparty || "a counterparty"} is now ${c.status}` });
  }
  for (const [k, c] of Object.entries(cb)) if (!ca[k]) out.push({ kind: "agreement", summary: `Removed the agreement with ${c.counterparty || "a counterparty"}` });
  const TERMS: Record<string, string> = { fee: "Fee", frequency: "Frequency", effectiveDate: "Effective date", term: "Term", services: "Services", counterparty: "Counterparty", letterhead: "Letterhead" };
  for (const [k, c] of Object.entries(ca)) {
    const b = cb[k];
    if (!b) continue;
    const changed: FieldChange[] = Object.entries(TERMS)
      .filter(([f]) => !same(b[f], c[f]))
      .map(([f, label]) => ({ key: `contract.${f}`, label, from: text(Array.isArray(b[f]) ? b[f].join(", ") : b[f]), to: text(Array.isArray(c[f]) ? c[f].join(", ") : c[f]) }));
    if (changed.length) out.push({ kind: "agreement", summary: `Changed the agreement with ${c.counterparty || "a counterparty"}: ${list(changed.map((f) => lower(f.label)))}`, detail: { fields: changed } });
  }

  // Governance (a corporation's board, officers, shareholders and stock)
  const corpOf = (r: Rec): Rec => (r.corp && typeof r.corp === "object" ? r.corp : {});
  const kb = corpOf(before);
  const ka = corpOf(after);
  for (const [group, word] of [
    ["directors", "director"],
    ["officers", "officer"],
    ["shareholders", "shareholder"],
  ] as const) {
    const gb = (kb[group] ?? {}) as Record<string, Rec>;
    const ga = (ka[group] ?? {}) as Record<string, Rec>;
    for (const [k, v] of Object.entries(ga)) if (!gb[k]) out.push({ kind: "governance", summary: `Added ${v?.name ? quote(String(v.name)) : `a ${word}`} as ${word}${v?.title ? ` (${String(v.title)})` : ""}` });
    for (const [k, v] of Object.entries(gb)) if (!ga[k]) out.push({ kind: "governance", summary: `Removed ${v?.name ? quote(String(v.name)) : `a ${word}`} as ${word}` });
  }
  const corpFields = Object.keys({ ...kb, ...ka }).filter((k) => !["directors", "officers", "shareholders"].includes(k) && !same(kb[k], ka[k]));
  if (corpFields.length)
    out.push({
      kind: "governance",
      summary: `Changed the corporate records: ${list(corpFields.map((k) => k.replace(/([A-Z])/g, " $1").toLowerCase()))}`,
      detail: { fields: corpFields.map((k) => ({ key: `corp.${k}`, label: k.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase()), from: text(kb[k]), to: text(ka[k]) })) },
    });

  return out;
}

/** A closing step's key as words (app/entity-closing.ts). */
function stepWords(key: string): string {
  if (key.startsWith("state:")) return `the state filing (${key.slice(6)})`;
  if (key.startsWith("withdraw:")) return `the withdrawal in ${key.slice(9)}`;
  if (key.startsWith("transfer:")) return "transferring an interest it owns";
  return (
    (
      {
        consent: "the owners' consent",
        windup: "winding up",
        bank: "closing the accounts",
        tax: "the final tax return",
        ein: "closing the EIN account",
        agent: "ending the registered agent",
        mail: "stopping the mail",
        payroll: "the final payroll returns and 1099s",
        books: "closing its books",
      } as Record<string, string>
    )[key] ?? key
  );
}

/**
 * Two edits' fields as one: each field's first "from" and last "to"; any that
 * went back where it started drop out. For showing a run of edits together;
 * the rows themselves are never merged.
 */
export function mergeFields(older: FieldChange[], newer: FieldChange[]): FieldChange[] {
  const out = new Map(older.map((f) => [f.key, { ...f }]));
  for (const f of newer) {
    const prev = out.get(f.key);
    out.set(f.key, prev ? { ...prev, to: f.to } : { ...f });
  }
  return [...out.values()].filter((f) => QUIET.has(f.key) || f.from !== f.to);
}

/** The rows one write adds: every entry its own row, newest last. Pure, so it's tested. */
export function activityRows(assetId: string, actor: Actor, entries: ActivityEntry[]) {
  return entries.map((e) => ({ asset_id: assetId, actor_id: actor.id, actor_name: actor.name, source: actor.source, kind: e.kind, summary: e.summary.slice(0, 500), detail: e.detail ?? null }));
}

// ── Supabase ─────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

/**
 * Record entries for one entity: appended, never edited. Tries twice. It
 * doesn't throw into the write it describes; a row it couldn't add is logged
 * as a warning (booleans only) so ops can see the gap.
 */
export async function logActivity(assetId: string, actor: Actor, entries: ActivityEntry[], _now = Date.now()): Promise<boolean> {
  if (!entries.length) return true;
  const body = activityRows(assetId, actor, entries);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sb("entity_activity", { method: "POST", body, prefer: "return=minimal" });
      return true;
    } catch {
      // try once more
    }
  }
  console.warn("activity: couldn't record", { rows: body.length, hasActor: !!actor.id, retried: true });
  return false;
}

export async function readActivity(assetId: string, before?: string, limit = 50): Promise<ActivityRow[]> {
  const cursor = before ? `&at=lt.${enc(before)}` : "";
  return (await sb<ActivityRow[]>(`entity_activity?asset_id=eq.${enc(assetId)}${cursor}&select=*&order=at.desc,id.desc&limit=${Math.min(limit, 200)}`)) ?? [];
}
