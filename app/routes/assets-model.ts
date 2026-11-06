/**
 * The Entities page's arithmetic, kept apart from the screen so it can be
 * tested: what the rule book reads for each entity (the same input the
 * entity page builds), its records score and the points each missing item
 * is worth, the conflicts in its records, who owns it and in what shares,
 * the return it files or rides on, and the state filter's choices. Pure: no
 * React, no network.
 */

import { foreignStates } from "../entity-addresses";
import { entityCompleteness, type CompletenessItem } from "../entity-completeness";
import { entityType, paperworkChecks, stateCode, stateName, taxClassOf, TAX_CLASSES, type EntityType, type PaperworkInput, type PaperworkIssue } from "../entity-paperwork";

// ── The record ───────────────────────────────────────────────────────────

export type Member = { name: string; percent: number | null; role?: string | null };

/** What the page reads from an entity's record. */
export type EntityRec = PaperworkInput & {
  id: string;
  name: string;
  ownerId?: string;
  members?: Member[];
  membersSource?: string;
  status?: string;
  initials?: string;
  llcTypeSource?: string;
  palm?: Record<string, { formation?: { status?: string } | null } | undefined>;
  ownerEffective?: string;
  ownerChangedAt?: string;
  ownerChangedBy?: { name?: string | null } | null;
};

/** How the page names each legal form. "C-Corp" is how older records store a corporation; C or S is its tax class. */
export const TYPE_LABEL: Record<EntityType, string> = { LLC: "LLC", "C-Corp": "Corporation", LP: "LP", Trust: "Trust" };

export const isDissolved = (a: { status?: string }) => (a.status ?? "").toLowerCase() === "dissolved";
export const isForming = (a: EntityRec) => Object.values(a.palm ?? {}).some((p) => p?.formation && p.formation.status !== "completed" && p.formation.status !== "canceled");

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

/** An owner, not only a manager: a Manager/Director/Officer counts once they hold a share (as app/entity/model.ts). */
const holdsOwnership = (m: Member) => !/manager|director|officer/i.test(m.role ?? "") || m.percent != null;

/** The people named in a trust's trustees field ("A and B", "A, B"). */
function names(s?: string | null): string[] {
  return (s ?? "")
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 2);
}

/**
 * Is this member line the owning trust's trustees holding title for it? A
 * member named "…, Trustees of …", or whose every name is one of the owning
 * trust's trustees, is the trust itself, not an outside owner.
 */
export function isTrusteeLine(m: Member, trust: EntityRec | undefined): boolean {
  if (!trust || entityType(trust) !== "Trust") return false;
  if (/\btrustees?\b/i.test(m.name)) return true;
  const trustees = names(trust.trustees).map(norm);
  const who = names(m.name).map(norm);
  return who.length > 0 && trustees.length > 0 && who.every((w) => trustees.some((t) => t === w || t.startsWith(w) || w.startsWith(t)));
}

export type Owner = { name: string; percent: number | null; entityId?: string };

/**
 * Who owns an entity, from the record: its member list (with shares) and
 * its owner on record. The owner on record comes first; a member line that
 * is the owning trust's trustees counts as the trust. Trusts have no owners
 * (see trustPeople).
 */
export function ownersOf(a: EntityRec, byId: Map<string, EntityRec>): Owner[] {
  if (entityType(a) === "Trust") return [];
  const parent = a.ownerId && a.ownerId !== a.id ? byId.get(a.ownerId) : undefined;
  const byName = new Map([...byId.values()].map((e) => [norm(e.name), e]));
  const out: Owner[] = [];
  const add = (o: Owner) => {
    const same = out.find((x) => (o.entityId && x.entityId === o.entityId) || norm(x.name) === norm(o.name));
    if (same) {
      if (same.percent == null && o.percent != null) same.percent = o.percent;
      return;
    }
    out.push(o);
  };
  if (parent) add({ name: parent.name, percent: null, entityId: parent.id });
  for (const m of (a.members ?? []).filter((m) => m?.name?.trim() && holdsOwnership(m) && (m.percent == null || m.percent > 0))) {
    const ent = isTrusteeLine(m, parent) ? parent : byName.get(norm(m.name));
    if (ent && ent.id === a.id) continue;
    add(ent ? { name: ent.name, percent: m.percent ?? null, entityId: ent.id } : { name: m.name.trim(), percent: m.percent ?? null });
  }
  return out;
}

/** The shares on record add up to 100% (null when not every owner's share is recorded). */
export function sharesTotal(owners: Owner[]): number | null {
  if (!owners.length || owners.some((o) => o.percent == null)) return null;
  return Math.round(owners.reduce((s, o) => s + (o.percent ?? 0), 0) * 100) / 100;
}

/** "50%", "33.33%": as recorded, up to two decimals (DESIGN.md §10.3). */
export function share(p: number | null): string {
  if (p == null) return "";
  return `${Math.round(p * 100) / 100}%`;
}

/** One owner as a phrase: "Northwind Holdings, LLC 50%". */
export const ownerPhrase = (o: Owner) => (o.percent != null ? `${o.name} ${share(o.percent)}` : o.name);

/** A trust's people, where a company shows its owners. */
export function trustPeople(a: EntityRec): string {
  const g = names(a.grantors);
  const t = names(a.trustees);
  const parts = [g.length ? `Grantors: ${g.join(", ")}` : "", t.length ? `Trustees: ${t.join(", ")}` : ""].filter(Boolean);
  return parts.join(" · ");
}

// ── What the rule book reads ─────────────────────────────────────────────

/**
 * The rule book's input for one entity, as the entity page builds it
 * (app/entity/derive.ts): the record, its owner on record, how many owners
 * its documents list, and whether it's still being formed.
 */
export function paperOf(a: EntityRec, byId: Map<string, EntityRec>): PaperworkInput {
  const parent = a.ownerId && a.ownerId !== a.id ? byId.get(a.ownerId) : undefined;
  const owners = ownersOf(a, byId);
  const fromDocs = (a.members ?? []).some((m) => m?.name?.trim() && holdsOwnership(m));
  const owns = [...byId.values()].filter((e) => e.ownerId === a.id && e.id !== a.id).length;
  return {
    ...a,
    owner: parent ? { name: parent.name, type: parent.type, llcType: parent.llcType } : null,
    ownerCount: fromDocs ? owners.length : undefined,
    ownsCount: owns,
    forming: isForming(a),
  } as PaperworkInput;
}

// ── The records score ────────────────────────────────────────────────────

export type RecordsTone = "positive" | "neutral" | "warning" | "negative";

export type Records = {
  /** 0–100: how much of the record's facts and documents are on file. */
  score: number;
  items: CompletenessItem[];
  /** Missing, most valuable first. */
  missing: CompletenessItem[];
  /** The points each missing item is worth; they add up to 100 − score exactly. */
  points: Map<string, number>;
  /** Where the records disagree with each other or the law (the rule book's high and medium checks). */
  conflicts: PaperworkIssue[];
  /** One status for the score: a conflict outranks everything; 100 is done; under 60 needs attention. */
  tone: RecordsTone;
};

export const ATTENTION_BELOW = 60;

/**
 * Split `total` points among `weights` in proportion, by largest remainder,
 * so the parts are whole numbers that add up to `total` exactly.
 */
export function allocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((x, y) => y.rem - x.rem || x.i - y.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

/** The trust's tax class isn't on record: whether it needs an EIN isn't known yet. */
const classUnknownTrust = (a: PaperworkInput) => entityType(a) === "Trust" && !TAX_CLASSES.Trust.includes((a.llcType ?? "").trim() as never);

/**
 * The records score for one entity, from the rule book (entity-completeness.ts)
 * on the same input the entity page uses. A trust whose tax class isn't on
 * record isn't asked for an EIN: a revocable (grantor) trust reports under the
 * grantor's SSN, so the EIN can't be judged until the class is recorded; the
 * class itself is what's missing.
 */
export function recordsOf(a: EntityRec, byId: Map<string, EntityRec>, today = new Date()): Records {
  const paper = paperOf(a, byId);
  const raw = entityCompleteness(paper, today);
  let items = raw.items;
  if (classUnknownTrust(paper)) {
    items = items.filter((i) => !(i.key === "ein" && !i.done)).map((i) => (i.key === "llcType" && !i.done ? { ...i, label: "Tax classification (grantor or non-grantor)" } : i));
  }
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const score = total ? Math.round((got / total) * 100) : 0;
  const missing = items.filter((i) => !i.done).sort((x, y) => y.weight - x.weight);
  const parts = allocate(
    missing.map((m) => m.weight),
    100 - score,
  );
  const points = new Map(missing.map((m, i) => [m.key, parts[i]]));
  const conflicts = paperworkChecks(paper).filter((c) => c.severity === "high" || (c.severity === "medium" && CONFLICT_KEYS.has(c.key)));
  const docClass = (a as { llcTypeConflict?: { value?: string } | null }).llcTypeConflict?.value;
  if (docClass && !conflicts.some((c) => c.key === "documents-class" || c.key === "class-conflict")) {
    conflicts.push({
      key: "documents-class",
      severity: "high",
      title: `Its documents say ${docClass}`,
      detail: `The record says ${a.llcType || "nothing"}. Check the EIN letter and the operating agreement, then record the right class.`,
    });
  }
  const owners = ownersOf(a, byId);
  const sum = sharesTotal(owners);
  if (sum != null && Math.abs(sum - 100) > 0.01) {
    conflicts.push({
      key: "shares",
      severity: "medium",
      title: `Owners' shares add up to ${share(sum)}`,
      detail: "The shares on record should add up to 100%. Correct them on the entity's Owners tab.",
    });
  }
  const tone: RecordsTone = conflicts.some((c) => c.severity === "high") ? "negative" : score >= 100 ? "positive" : score < ATTENTION_BELOW || conflicts.length ? "warning" : "neutral";
  return { score, items, missing, points, conflicts, tone };
}

/** Medium checks that are disagreements between records (the rest are reminders, shown on the entity page). */
const CONFLICT_KEYS = new Set(["partnership-one-owner"]);

/** Missing items grouped as the tip lists them: facts to record, documents the law requires, documents expected. */
export function missingGroups(r: Records): { label: string; items: CompletenessItem[] }[] {
  const facts = r.missing.filter((m) => !m.filing);
  const required = r.missing.filter((m) => m.filing && m.level === "required");
  const expected = r.missing.filter((m) => m.filing && m.level !== "required");
  return [
    { label: "Facts to record", items: facts },
    { label: "Required documents", items: required },
    { label: "Expected documents", items: expected },
  ].filter((g) => g.items.length);
}

/** "6 missing · Articles of Organization, EIN letter…": the count first, required items first. */
export function missingLine(r: Records, max = 2): string {
  if (!r.missing.length) return "Everything on file";
  const ordered = [...r.missing].sort((x, y) => rank(x) - rank(y) || y.weight - x.weight);
  const shown = ordered.slice(0, max).map((m) => m.label);
  return `${r.missing.length} missing · ${shown.join(", ")}${r.missing.length > max ? "…" : ""}`;
}
const rank = (m: CompletenessItem) => (m.filing ? (m.level === "required" ? 0 : 2) : 1);

// ── Tax ──────────────────────────────────────────────────────────────────

export type TaxLine = {
  /** The class: recorded, or the IRS default. Null when neither is known. */
  value: string | null;
  isDefault: boolean;
  /** What it files: "Form 1065 and K-1s", "No return: disregarded into …". */
  files: string | null;
  /** Where a recorded class came from (the EIN letter, a document, by hand). */
  source?: string;
};

/** The tax class and the return it means, as a preparer reads them. */
export function taxLine(a: EntityRec, byId: Map<string, EntityRec>): TaxLine {
  const paper = paperOf(a, byId);
  const { value, isDefault } = taxClassOf(paper);
  const parent = a.ownerId && a.ownerId !== a.id ? byId.get(a.ownerId) : undefined;
  let files: string | null = null;
  if (value === "Partnership") files = "Form 1065 and K-1s";
  else if (value === "S Corporation") files = "Form 1120-S and K-1s";
  else if (value === "C Corporation") files = "Form 1120";
  else if (value === "Non-grantor trust") files = "Form 1041";
  else if (value === "Grantor trust") files = "On the grantors' Form 1040";
  else if (value === "Disregarded Entity") files = parent ? whereReported(parent, byId) : "On its owner's return";
  return { value, isDefault, files, source: !isDefault ? a.llcTypeSource : undefined };
}

/**
 * Where a disregarded entity's income is reported: up the chain of owners
 * past every disregarded one, to the first that files.
 */
function whereReported(owner: EntityRec, byId: Map<string, EntityRec>): string {
  const seen = new Set<string>();
  let cur: EntityRec | undefined = owner;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const v = taxClassOf(paperOf(cur, byId)).value;
    if (v === "Partnership") return `On ${cur.name}'s Form 1065`;
    if (v === "S Corporation") return `On ${cur.name}'s Form 1120-S`;
    if (v === "C Corporation") return `On ${cur.name}'s Form 1120`;
    if (v === "Non-grantor trust") return `On ${cur.name}'s Form 1041`;
    if (v === "Grantor trust") return `On the grantors' Form 1040, through ${cur.name}`;
    if (v !== "Disregarded Entity") return `Through ${cur.name}, whose tax class isn't on record`;
    cur = cur.ownerId && cur.ownerId !== cur.id ? byId.get(cur.ownerId) : undefined;
  }
  return `Into ${owner.name}`;
}

/** "Disregarded entity", as a label (sentence case). */
export const taxLabel = (v: string | null) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace("s corporation", "S corporation").replace("c corporation", "C corporation") : "Not recorded");

// ── States ───────────────────────────────────────────────────────────────

export const NO_STATE = "none";

export type StateChoices = {
  /** Formed in: state name → entities. */
  formed: Map<string, number>;
  /** Registered in as a foreign entity: state name → entities. */
  foreign: Map<string, number>;
  /** Entities with no state of formation on record. */
  none: number;
};

/**
 * The states, other than its home state, it's registered in or must register
 * in (it does business there: its address is there), as names. The same list
 * the records score asks an agent for (app/entity-addresses.ts).
 */
export function foreignNames(a: EntityRec): string[] {
  return foreignStates(a as Parameters<typeof foreignStates>[0]).map((c) => stateName(c));
}

/** A record's state of formation as a name ("AZ" and "Arizona" are one state). */
export const formedIn = (a: { state?: string }) => {
  const c = stateCode(a.state);
  return c ? stateName(c) : (a.state ?? "").trim();
};

export function stateChoices(list: EntityRec[]): StateChoices {
  const formed = new Map<string, number>();
  const foreign = new Map<string, number>();
  let none = 0;
  for (const a of list) {
    const st = formedIn(a);
    if (st) formed.set(st, (formed.get(st) ?? 0) + 1);
    else none++;
    for (const f of foreignNames(a)) foreign.set(f, (foreign.get(f) ?? 0) + 1);
  }
  return { formed, foreign, none };
}

/** The filter's values: "formed:Arizona", "foreign:Arizona", "none". An entity matches any of them. */
export function inStates(a: EntityRec, chosen: string[]): boolean {
  if (!chosen.length) return true;
  const st = formedIn(a);
  const regs = new Set(foreignNames(a));
  return chosen.some((v) => (v === NO_STATE ? !st : v.startsWith("formed:") ? v.slice(7) === st : v.startsWith("foreign:") ? regs.has(v.slice(8)) : false));
}

// ── Initials ─────────────────────────────────────────────────────────────

/** Why these initials can't be used for this entity (another entity has them), or null. */
export function initialsClash(raw: string, id: string, tags: { id: string; name: string; tag: string }[]): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  if (!/^[A-Z0-9&]{1,4}$/.test(t)) return "Use up to 4 letters or digits.";
  const other = tags.find((x) => x.id !== id && x.tag.toUpperCase() === t);
  return other ? `${t} is already ${other.name}'s initials.` : null;
}

/** Entities whose initials another entity also has, so the list can flag them. */
export function sharedInitials(tags: { id: string; tag: string }[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const x of tags) seen.set(x.tag.toUpperCase(), [...(seen.get(x.tag.toUpperCase()) ?? []), x.id]);
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

// ── New entity ───────────────────────────────────────────────────────────

/** A new record's name matches one already on record (ignoring case, punctuation and the designator). */
export function sameName(a: string, b: string): boolean {
  const strip = (s: string) =>
    norm(s)
      .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|lp|l p|ltd|limited partnership|co|company|pllc|pc)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!strip(a) && strip(a) === strip(b);
}

/** "123456789" → "12-3456789", as the person types. */
export function formatEin(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d;
}

/** The IRS default tax class for a new record, from its form and (for an LLC) how many owners it has. */
export function defaultClass(type: EntityType, owners: "one" | "several" | null, revocable?: boolean | null): string {
  if (type === "C-Corp") return "C Corporation";
  if (type === "LP") return "Partnership";
  if (type === "Trust") return revocable == null ? "" : revocable ? "Grantor trust" : "Non-grantor trust";
  return owners === "one" ? "Disregarded Entity" : owners === "several" ? "Partnership" : "";
}
