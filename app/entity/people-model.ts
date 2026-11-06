/**
 * The rules behind an entity's people (owners, managers, a trust's people),
 * kept apart from the screens so they can be tested
 * (tests/people-model.test.ts). Pure: no React, no store.
 *
 * - Managers are read from the record with their source: the owner list,
 *   the state's record, or the operating agreement as read by AI. An empty
 *   list is "no managers on record", never a conclusion about how the
 *   entity is run.
 * - An ownership change is a dated transaction: an issuance, a transfer
 *   between owners, a redemption, or a correction of BFO's record. The
 *   shares must add up to 100% afterwards unless it's a correction.
 * - A trust's people are kept as a list of people with roles (acting or
 *   successor trustee; current, remainder or contingent beneficiary), so a
 *   name with a comma or "and" in it stays one person. The legacy
 *   comma-joined strings are written alongside for older readers.
 */

import { splitNames, type Asset, type Member } from "./model";

// ── Owners and managers ──────────────────────────────────────────────────

/** An owner row as stored, with the fields this area adds. */
export type OwnerRow = Member & {
  /** One of the family's entities, when the owner is one (the row links to it). */
  entityId?: string | null;
  /** When this owner's current share took effect (YYYY-MM-DD). */
  since?: string | null;
  /** A corporation's shareholder: shares held, and their class. */
  shares?: number | null;
  shareClass?: string | null;
};

const MANAGING = /manager|director|officer/i;
export const holdsShare = (m: { role?: string | null; percent?: number | null }) => !MANAGING.test(m.role ?? "") || m.percent != null;

/** Names compared the way people write them: case, punctuation and "L.L.C." don't matter. */
export function sameName(a?: string | null, b?: string | null): boolean {
  const n = (s?: string | null) =>
    (s ?? "")
      .toLowerCase()
      .replace(/l\.\s*l\.\s*c\.?/g, "llc")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return !!n(a) && n(a) === n(b);
}

export const isCompanyName = (name: string) => /\b(llc|l\.l\.c\.|inc\.?|corp\.?|corporation|company|trust|trustees?|lp|l\.p\.|ltd\.?|partners|llp|pllc)\b/i.test(name);

/** The roles an owner can hold, by entity type (an LLC has members, not shareholders). */
export function ownerRoles(type?: string | null): string[] {
  switch (type) {
    case "C-Corp":
      return ["Shareholder"];
    case "LP":
      return ["General partner", "Limited partner"];
    default:
      return ["Member", "Managing member"];
  }
}

export function managerRoles(type?: string | null): string[] {
  return type === "C-Corp" ? ["Director", "Officer"] : type === "LP" ? ["General partner"] : ["Manager"];
}

export type ManagerOnRecord = { name: string; role: string; address?: string | null };
export type ManagersOnRecord = {
  /** The managers BFO shows, from the best source that has any. */
  list: ManagerOnRecord[];
  /** Where they came from, in words ("The owner list", "Nevada's record", "The operating agreement, read by AI"). */
  source: string | null;
  /** True when they're the owner list's own rows (editable there); false when read from elsewhere. */
  onOwnerList: boolean;
  /** Managers other sources name that the owner list doesn't have yet (to offer "Add them"). */
  missing: ManagerOnRecord[];
  /** Whether a document or the state says the entity is run by managers. */
  managerManaged: boolean;
};

const isManagerRole = (role?: string | null) => /manager/i.test(role ?? "") && !/managing member/i.test(role ?? "");

/** The managers on record, with where the list came from. Never a guess about how it's run. */
export function managersOnRecord(asset: Partial<Pick<Asset, "members" | "stateRecord" | "profile" | "state">>): ManagersOnRecord {
  const own = (asset.members ?? []).filter((m) => !holdsShare(m)).map((m) => ({ name: m.name, role: m.role ?? "Manager", address: m.address ?? null }));
  const statePeople = (asset.stateRecord?.people ?? []).filter((p) => isManagerRole(p.role) || /^manager$/i.test(p.title ?? ""));
  const fromState: ManagerOnRecord[] = statePeople.length
    ? statePeople.map((p) => ({ name: p.name, role: "Manager", address: p.address ?? null }))
    : (asset.stateRecord?.managers ?? []).map((name) => ({ name, role: "Manager" }));
  const fromProfile: ManagerOnRecord[] = (asset.profile?.managers ?? []).map((name) => ({ name, role: "Manager" }));
  const management = asset.profile?.management ?? "";
  const managerManaged = /manager[- ]managed/i.test(management) || fromState.length > 0 || fromProfile.length > 0 || own.some((m) => isManagerRole(m.role));
  const stateName = asset.state ? `${asset.state}’s record` : "The state’s record";
  if (own.length) {
    const others = fromState.length ? fromState : fromProfile;
    return { list: own, source: "The owner list", onOwnerList: true, missing: others.filter((o) => !own.some((m) => sameName(m.name, o.name))), managerManaged };
  }
  if (fromState.length) return { list: fromState, source: stateName, onOwnerList: false, missing: fromState, managerManaged };
  if (fromProfile.length) return { list: fromProfile, source: "The operating agreement, read by AI", onOwnerList: false, missing: fromProfile, managerManaged };
  return { list: [], source: null, onOwnerList: false, missing: [], managerManaged };
}

/** The shares' total, to two decimals. */
export const shareTotal = (owners: { percent?: number | null }[]) => Math.round(owners.reduce((n, m) => n + (m.percent ?? 0), 0) * 100) / 100;

/** "50%", "33.33%": as recorded, up to two decimals, trailing zeros dropped (§10.3). */
export const pct = (n: number | null | undefined) => (n == null ? "" : `${Math.round(n * 100) / 100}%`);

/**
 * When the owner count and the tax class on record disagree: an LLC recorded
 * as disregarded with two or more owners is a partnership by default from
 * the day the second owner came in (Rev. Rul. 99-5); a "partnership" with
 * one owner left is disregarded unless it elected otherwise (Rev. Rul. 99-6).
 */
export function classificationNote(type: string | undefined, llcType: string | undefined, owners: number): { suggest: string; message: string } | null {
  if (type !== "LLC" || !owners) return null;
  if (llcType === "Disregarded Entity" && owners >= 2)
    return {
      suggest: "Partnership",
      message: `It’s recorded as a disregarded entity but has ${owners} owners. Unless it elected otherwise, an LLC with two or more owners is taxed as a partnership: Form 1065, with a K-1 to each owner.`,
    };
  if (llcType === "Partnership" && owners === 1)
    return {
      suggest: "Disregarded Entity",
      message: "It’s recorded as a partnership but has one owner. When a partnership is left with one owner it ends (a final Form 1065 is due), and the LLC is disregarded unless it elects otherwise.",
    };
  return null;
}

/** The family entity an owner row is, by its link, its exact name, or a trust named inside "Trustees of …". */
export function linkedEntity(m: OwnerRow, entities: { id: string; name?: string | null }[], ownerId?: string | null): { id: string; name: string } | null {
  if (m.entityId) {
    const e = entities.find((x) => x.id === m.entityId);
    if (e?.name) return { id: e.id, name: e.name };
  }
  const exact = entities.find((e) => e.name && sameName(e.name, m.name));
  if (exact) return { id: exact.id, name: exact.name! };
  if (ownerId) {
    const owner = entities.find((e) => e.id === ownerId);
    const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (owner?.name && n(owner.name).trim().length > 6 && n(m.name).includes(n(owner.name).trim())) return { id: owner.id, name: owner.name };
  }
  return null;
}

/** The "owned by" entity after a change: the family entity with the largest share, or the one on record if no owner links to one. */
export function nextOwnerId(owners: OwnerRow[], entities: { id: string; name?: string | null }[], current?: string | null): string | null | undefined {
  let best: { id: string; pct: number } | null = null;
  let anyLinked = false;
  for (const m of owners) {
    const e = linkedEntity(m, entities, current);
    if (!e) continue;
    anyLinked = true;
    const p = m.percent ?? 0;
    if (!best || p > best.pct) best = { id: e.id, pct: p };
  }
  if (best) return best.id;
  // Nothing on the list is one of the family's entities: leave the record's owner alone unless it was just removed.
  return anyLinked ? null : undefined;
}

// ── Ownership changes ────────────────────────────────────────────────────

/** How an ownership change happened. */
export type ChangeHow = "issuance" | "transfer" | "redemption" | "correction";

export const HOW_WORDS: Record<ChangeHow, string> = {
  issuance: "New interest issued",
  transfer: "Transferred between owners",
  redemption: "Redeemed by the company",
  correction: "Correcting BFO’s record",
};

export type OwnerChange =
  | { kind: "add"; owner: OwnerRow; how: ChangeHow; /** For a transfer: whose share it comes from. */ counterparty?: string | null; effective: string | null }
  | { kind: "edit"; index: number; owner: OwnerRow; how: ChangeHow; counterparty?: string | null; effective: string | null }
  | { kind: "remove"; index: number; how: ChangeHow; counterparty?: string | null; effective: string | null };

export type HistoryEntry = {
  /** When it took effect (YYYY-MM-DD); null for a correction with no date. */
  effective: string | null;
  how: ChangeHow;
  kind: "add" | "edit" | "remove";
  name: string;
  from: number | null;
  to: number | null;
  counterparty?: string | null;
  /** The shares of everyone afterwards, as recorded. */
  after: { name: string; percent: number | null }[];
  /** A document filed under the entity (assignment, joinder, consent). */
  doc?: { id: string; name: string } | null;
  note?: string | null;
};

export type ChangeResult = { ok: true; owners: OwnerRow[]; entry: HistoryEntry; total: number } | { ok: false; error: string; field?: "share" | "counterparty" | "effective" | "name" };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Scale the other owners so the list adds up to 100% again (an issuance dilutes them; a redemption concentrates them). */
function rescale(list: OwnerRow[], keep: number | null): OwnerRow[] {
  const fixed = keep === null ? 0 : (list[keep].percent ?? 0);
  const others = list.reduce((n, m, i) => (i === keep || !holdsShare(m) ? n : n + (m.percent ?? 0)), 0);
  if (others <= 0) return list;
  const factor = (100 - fixed) / others;
  return list.map((m, i) => (i === keep || !holdsShare(m) || m.percent == null ? m : { ...m, percent: round2(m.percent * factor) }));
}

/**
 * Apply an ownership change to the list, with its counterpart: a transfer
 * moves the share from (or to) the named owner; an issuance or a redemption
 * rescales the others pro rata; a correction changes only the row. The
 * shares must add up to 100% afterwards unless it's a correction.
 */
export function applyOwnerChange(list: OwnerRow[], change: OwnerChange): ChangeResult {
  const next = list.map((m) => ({ ...m }));
  const owners = () => next.filter(holdsShare);
  const findOther = (name?: string | null, not?: number) => next.findIndex((m, i) => i !== not && sameName(m.name, name));
  if (change.how !== "correction" && !change.effective) return { ok: false, error: "Say when it took effect.", field: "effective" };

  let name = "";
  let from: number | null = null;
  let to: number | null = null;
  let self: number | null = null;

  if (change.kind === "add") {
    const o = change.owner;
    name = o.name.trim();
    if (!name) return { ok: false, error: "Add a name.", field: "name" };
    if (next.some((m) => sameName(m.name, name))) return { ok: false, error: `${name} is already on the list. Edit their row instead.`, field: "name" };
    const share = o.percent;
    if (holdsShare(o) && (share == null || !(share > 0))) return { ok: false, error: "Add their share, above 0%.", field: "share" };
    if (share != null && share > 100) return { ok: false, error: "A share can’t be over 100%.", field: "share" };
    to = share ?? null;
    next.push({ ...o, name, since: change.effective ?? o.since ?? null });
    self = next.length - 1;
    if (change.how === "transfer" && share != null) {
      const k = findOther(change.counterparty, self);
      if (k < 0) return { ok: false, error: "Choose whose share it came from.", field: "counterparty" };
      const left = round2((next[k].percent ?? 0) - share);
      if (left < 0) return { ok: false, error: `${next[k].name} holds only ${pct(next[k].percent)}.`, field: "share" };
      next[k] = { ...next[k], percent: left, since: change.effective };
    } else if (change.how === "issuance") {
      const scaled = rescale(next, self);
      next.splice(0, next.length, ...scaled);
    }
  } else if (change.kind === "edit") {
    const old = next[change.index];
    if (!old) return { ok: false, error: "That owner is no longer on the list." };
    const o = change.owner;
    name = o.name.trim();
    if (!name) return { ok: false, error: "Add a name.", field: "name" };
    if (next.some((m, i) => i !== change.index && sameName(m.name, name))) return { ok: false, error: `${name} is already on the list.`, field: "name" };
    from = old.percent ?? null;
    to = o.percent ?? null;
    if (holdsShare(o) && to != null && to < 0) return { ok: false, error: "A share can’t be negative.", field: "share" };
    if (to != null && to > 100) return { ok: false, error: "A share can’t be over 100%.", field: "share" };
    const moved = round2((to ?? 0) - (from ?? 0));
    next[change.index] = { ...old, ...o, name, since: moved && change.how !== "correction" ? change.effective : (old.since ?? null) };
    self = change.index;
    if (moved && change.how === "transfer") {
      const k = findOther(change.counterparty, self);
      if (k < 0) return { ok: false, error: moved > 0 ? "Choose whose share it came from." : "Choose who received it.", field: "counterparty" };
      const left = round2((next[k].percent ?? 0) - moved);
      if (left < 0) return { ok: false, error: `${next[k].name} holds only ${pct(next[k].percent)}.`, field: "share" };
      next[k] = { ...next[k], percent: left, since: change.effective };
    } else if (moved && (change.how === "issuance" || change.how === "redemption")) {
      const scaled = rescale(next, self);
      next.splice(0, next.length, ...scaled);
    }
  } else {
    const old = next[change.index];
    if (!old) return { ok: false, error: "That owner is no longer on the list." };
    name = old.name;
    from = old.percent ?? null;
    next.splice(change.index, 1);
    if (change.how === "transfer" && from) {
      const k = findOther(change.counterparty);
      if (k < 0) return { ok: false, error: "Choose who received the interest.", field: "counterparty" };
      next[k] = { ...next[k], percent: round2((next[k].percent ?? 0) + from), since: change.effective };
    } else if (change.how === "redemption" && from) {
      const scaled = rescale(next, null);
      next.splice(0, next.length, ...scaled);
    }
  }

  const total = shareTotal(owners());
  if (change.how !== "correction" && owners().length && Math.abs(total - 100) > 0.011)
    return {
      ok: false,
      error: `The shares would add up to ${pct(total)}. ${change.how === "transfer" ? "Check the amount moved." : "Choose whose share it comes from, or record it as a correction."}`,
      field: "share",
    };

  const entry: HistoryEntry = {
    effective: change.effective || null,
    how: change.how,
    kind: change.kind,
    name,
    from,
    to,
    counterparty: change.counterparty ?? null,
    after: owners().map((m) => ({ name: m.name, percent: m.percent ?? null })),
  };
  return { ok: true, owners: next, entry, total };
}

/** One history line in words: "Jul 1, 2026 · Alex Rivera admitted at 20%, transferred from Northwind Holdings, LLC". */
export function historyWords(e: HistoryEntry): string {
  const share = (n: number | null) => (n == null ? "no share" : pct(n));
  const how =
    e.how === "transfer"
      ? e.counterparty
        ? `, transferred ${e.kind === "remove" || (e.to ?? 0) < (e.from ?? 0) ? "to" : "from"} ${e.counterparty}`
        : ", transferred"
      : e.how === "issuance"
        ? ", new interest issued"
        : e.how === "redemption"
          ? ", redeemed"
          : ", correcting the record";
  if (e.kind === "add") return `${e.name} added at ${share(e.to)}${how}`;
  if (e.kind === "remove") return `${e.name} removed (held ${share(e.from)})${how}`;
  if (e.from !== e.to) return `${e.name}: ${share(e.from)} to ${share(e.to)}${how}`;
  return `${e.name}: details updated`;
}

// ── A trust's people ─────────────────────────────────────────────────────

export type TrustRole = "trustee" | "successor" | "grantor" | "beneficiary";
export type BeneficiaryClass = "current" | "remainder" | "contingent";

export type TrustPerson = {
  name: string;
  role: TrustRole;
  /** Successors in the order they'd serve (1 first). */
  order?: number | null;
  /** A beneficiary's class. */
  class?: BeneficiaryClass | null;
  /** Since when (YYYY-MM-DD). */
  since?: string | null;
  /** How they came to the role: named in the trust agreement, an amendment, an appointment. */
  basis?: string | null;
  doc?: { id: string; name: string } | null;
};

/** A trust role in words. */
export const TRUST_WORDS: Record<TrustRole, { one: string; many: string }> = {
  trustee: { one: "Trustee", many: "trustees" },
  successor: { one: "Successor trustee", many: "successor trustees" },
  grantor: { one: "Grantor", many: "grantors" },
  beneficiary: { one: "Beneficiary", many: "beneficiaries" },
};

export const CLASS_WORDS: Record<BeneficiaryClass, string> = { current: "Current", remainder: "Remainder", contingent: "Contingent" };

const LEGACY: Record<"trustees" | "grantors" | "beneficiaries", TrustRole> = { trustees: "trustee", grantors: "grantor", beneficiaries: "beneficiary" };

type TrustRecord = Pick<Asset, "trustees" | "grantors" | "beneficiaries"> & { trustPeople?: TrustPerson[] | Record<string, TrustPerson> | null; successorTrustees?: string | null };

const listOf = <T>(v: T[] | Record<string, T> | null | undefined): T[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

/** The strings older readers use: acting trustees, successors, grantors, beneficiaries, comma-joined. */
export function legacyStrings(people: TrustPerson[]): { trustees: string; successorTrustees: string; grantors: string; beneficiaries: string } {
  const join = (role: TrustRole) =>
    people
      .filter((p) => p.role === role)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((p) => p.name)
      .join(", ");
  return { trustees: join("trustee"), successorTrustees: join("successor"), grantors: join("grantor"), beneficiaries: join("beneficiary") };
}

/**
 * The trust's people. The structured list is the truth when the legacy
 * strings still match what it wrote; when someone changed a string since
 * (another screen, a document scan), the strings' names win and keep the
 * details the list had for them.
 */
export function trustPeopleOf(rec: TrustRecord): { people: TrustPerson[]; structured: boolean } {
  const stored = listOf(rec.trustPeople);
  if (stored.length) {
    const want = legacyStrings(stored);
    const matches = (["trustees", "grantors", "beneficiaries"] as const).every((k) => (rec[k] ?? "").trim() === want[k]) && (rec.successorTrustees ?? "").trim() === want.successorTrustees;
    if (matches) return { people: stored, structured: true };
  }
  const people: TrustPerson[] = [];
  for (const key of ["trustees", "grantors", "beneficiaries"] as const) {
    for (const name of splitNames(rec[key])) {
      const known = stored.find((p) => sameName(p.name, name) && (p.role === LEGACY[key] || (key === "trustees" && p.role === "successor")));
      people.push(known ? { ...known, name } : { name, role: LEGACY[key] });
    }
  }
  for (const name of splitNames(rec.successorTrustees)) {
    if (people.some((p) => sameName(p.name, name) && (p.role === "successor" || p.role === "trustee"))) continue;
    const known = stored.find((p) => sameName(p.name, name) && p.role === "successor");
    people.push(known ? { ...known, name } : { name, role: "successor" });
  }
  return { people, structured: false };
}

/** The writes for a trust's people: the list, and the strings older readers use. */
export function trustPatch(people: TrustPerson[]): Record<string, unknown> {
  const clean = people.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as TrustPerson);
  return { trustPeople: clean, ...legacyStrings(clean) };
}

/** Everyone once, with the roles they hold ("Trustee · Grantor"). */
export function trustPeopleByPerson(people: TrustPerson[]): { name: string; roles: TrustPerson[] }[] {
  const out: { name: string; roles: TrustPerson[] }[] = [];
  for (const p of people) {
    const hit = out.find((o) => sameName(o.name, p.name));
    if (hit) hit.roles.push(p);
    else out.push({ name: p.name, roles: [p] });
  }
  return out;
}

// ── A corporation's cap table ────────────────────────────────────────────

export type CapCheck = { tone: "warning" | "info"; text: string };

/**
 * What doesn't foot or doesn't fit in a corporation's stock: issued over
 * authorized, holdings that don't add up to the shares issued, and, for an
 * S corporation, a second class of stock, holders that may not be eligible,
 * or more than 100 shareholders.
 */
export function capTableChecks(o: {
  authorized?: number | null;
  issued?: number | null;
  holders: { name: string; shares?: number | null; shareClass?: string | null; percent?: number | null }[];
  taxClass?: string | null;
  classes?: string | null;
}): CapCheck[] {
  const out: CapCheck[] = [];
  const n = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const authorized = n(o.authorized);
  const issued = n(o.issued);
  const fmt = (v: number) => v.toLocaleString("en-US");
  if (authorized !== null && issued !== null && issued > authorized)
    out.push({ tone: "warning", text: `${fmt(issued)} shares are recorded as issued but only ${fmt(authorized)} are authorized: an over-issuance. Check the articles and the stock ledger.` });
  const withShares = o.holders.filter((h) => n(h.shares) !== null);
  if (issued !== null && withShares.length) {
    const held = withShares.reduce((s, h) => s + (h.shares ?? 0), 0);
    if (held !== issued) out.push({ tone: "warning", text: `The shareholders hold ${fmt(held)} shares; ${fmt(issued)} are issued.` });
  }
  if (o.holders.some((h) => h.percent != null)) {
    const total = shareTotal(o.holders);
    if (Math.abs(total - 100) > 0.011) out.push({ tone: "warning", text: `Holdings add up to ${pct(total)}, not 100%.` });
  }
  if (o.taxClass === "S Corporation") {
    const classes = new Set(o.holders.map((h) => (h.shareClass ?? "Common").toLowerCase()));
    if (classes.size > 1 || /preferred/i.test(o.classes ?? ""))
      out.push({ tone: "warning", text: "An S corporation may have only one class of stock. A preferred class (different rights to distributions or liquidation) ends the election." });
    const entities = o.holders.filter((h) => isCompanyName(h.name) && !/\btrust\b/i.test(h.name)).map((h) => h.name);
    if (entities.length)
      out.push({ tone: "warning", text: `${entities.join(", ")} may not be an eligible S corporation shareholder: partnerships, corporations and most LLCs aren’t. Confirm each holder.` });
    if (o.holders.length > 100) out.push({ tone: "warning", text: "An S corporation may have at most 100 shareholders." });
    if (o.holders.some((h) => /\btrust\b/i.test(h.name))) out.push({ tone: "info", text: "A trust can hold S corporation stock only as a grantor trust, a QSST or an ESBT. Confirm which." });
  }
  return out;
}
