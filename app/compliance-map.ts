/**
 * Entity compliance across the whole family (Tools → Entity compliance) and
 * on each entity's Compliance tab: one assessment per entity, read from the
 * state's record (through Palm), the rule book (app/entity-paperwork.ts) and
 * what's recorded as filed. Pure — the pages draw it, tests read it.
 *
 * The checks, each good / warn / bad / missing / n/a, and for anything short
 * of good the one thing to do about it:
 *
 *   state      the state's record read through Palm: active, and read recently
 *   standing   the state's word on good standing (its filings and fees)
 *   tax        the state's word on its tax account, where the state reports it
 *   agent      a registered (statutory) agent the state accepts
 *   filings    the state's annual report, list or tax: the latest period filed
 *   returns    the federal and state returns: the latest period recorded as filed
 *   paperwork  the documents the rule book requires, current
 *   records    our record agrees with itself and the rules (paperworkChecks)
 *   palm       linked to Palm (a vendor relationship: shown, never counted)
 *
 * One status vocabulary, used everywhere an entity's compliance is shown:
 *   act        "Act now": the state shows it lapsed or not in good standing, a
 *              filing is overdue, the state rejects its agent, or its tax class
 *              contradicts its owners
 *   attention  "Needs attention": something is missing, unrecorded or unread
 *   clear      "No issues found": nothing in what BFO checks needs anyone
 * "In good standing" is only ever the state's own word, with the date it was
 * read; BFO's tiers never claim it. These are BFO's checks, not a legal opinion.
 */

import { entityCompleteness } from "./entity-completeness";
import {
  agentTerm,
  documentRules,
  entityType,
  filingAgency,
  obligations,
  paperworkChecks,
  slotCurrent,
  stateCode,
  stateName,
  taxClassOf,
  taxHome,
  type Obligation,
  type PaperworkInput,
} from "./entity-paperwork";
import { effectiveRecord, normalizeName, type PalmLink, type PalmMode, type StateConfirmation, type StateRecord } from "./palm";

export type PillarKey = "state" | "standing" | "tax" | "agent" | "filings" | "returns" | "paperwork" | "records" | "palm";
export type PillarStatus = "good" | "warn" | "bad" | "missing" | "na";

/** What fixes a pillar: a step in words, and where it's done. */
export type Fix = {
  text: string;
  /** "check-state" runs the state lookup from the page; otherwise a link. */
  action?: "check-state";
  href?: string;
  cta?: string;
};

export type Pillar = { key: PillarKey; label: string; status: PillarStatus; summary: string; fix?: Fix };

export type Tier = "act" | "attention" | "clear";

export const TIER_LABEL: Record<Tier, string> = { act: "Act now", attention: "Needs attention", clear: "No issues found" };

/** The state's own word on the entity, with when it was read: the only place "in good standing" is said. */
export type Standing = {
  /** good: active and in good standing. bad: lapsed or not in good standing. unknown: not read, or the state doesn't say. none: nothing filed with a state (a trust). */
  tone: "good" | "bad" | "unknown" | "none";
  /** "In good standing", "Active, but not in good standing", "Revoked", "Not checked with the state", "Nothing filed with a state". */
  word: string;
  /** The state, by name. */
  state: string | null;
  /** When the state's record was read (or its own site confirmed), ms. */
  asOf: number | null;
  /** Read from the state's own site by someone here, over Palm's lagging copy. */
  confirmed: boolean;
  /** The recurring filing the rule book says is behind, when it can name it. */
  missed: { title: string; period: string; due: string; daysLate: number; lateFee?: string; consequence?: string; url?: string; agency: string } | null;
};

export type Assessment = {
  id: string;
  name: string;
  type: string;
  state: string | null;
  ownerId: string | null;
  /** The owner's share, as its members list records it (0–100), when known. */
  ownerShare: number | null;
  /** How it's taxed, in words ("Disregarded", "Partnership", "Grantor trust"), and whether that's the default rather than recorded. */
  taxClass: { label: string; assumed: boolean } | null;
  pillars: Pillar[];
  /** 0–100, weighted toward standing and filings over paperwork; Palm's link doesn't count. Never shown as compliance. */
  score: number;
  tier: Tier;
  standing: Standing;
  /** The state hasn't been asked about this entity in the current mode. */
  unverified: boolean;
  /** How complete the record is (facts and documents), as the entity page scores it: a different number from compliance. */
  record: { score: number; todo: number };
  /** The steps, most urgent first: what needs someone. Their count is the entity's "needs action". */
  fixes: (Fix & { pillar: PillarKey; status: PillarStatus })[];
};

export const PILLARS: { key: PillarKey; label: string; short: string }[] = [
  { key: "standing", label: "Good standing", short: "Standing" },
  { key: "state", label: "State record", short: "Record" },
  { key: "filings", label: "State filings", short: "Filings" },
  { key: "tax", label: "State tax standing", short: "State tax" },
  { key: "agent", label: "Registered agent", short: "Agent" },
  { key: "returns", label: "Tax returns", short: "Returns" },
  { key: "paperwork", label: "Paperwork", short: "Papers" },
  { key: "records", label: "Records agree", short: "Records" },
  { key: "palm", label: "Palm link", short: "Palm" },
];

/** A state record older than this is read again before it's trusted. */
export const STALE_DAYS = 45;
const DAY = 86_400_000;

type Member = { name: string; percent?: number | null; role?: string | null };

export type EntityInput = PaperworkInput & {
  ownerId?: string;
  fileNumber?: string;
  status?: string;
  palm?: Partial<Record<PalmMode, PalmLink>>;
  stateRecord?: StateRecord;
  stateConfirmed?: StateConfirmation | null;
  members?: Member[] | null;
  palmFilings?: Record<string, { state: string; name: string; dueDate: string | null; status: "due" | "overdue"; mode: PalmMode } | null>;
};

/** What each pillar weighs in the score: the state's word and what's overdue first; Palm's link nothing. */
const WEIGHT: Record<PillarKey, number> = { standing: 3, state: 2, filings: 3, tax: 1, agent: 2, returns: 2, paperwork: 2, records: 2, palm: 0 };
const POINTS: Record<PillarStatus, number | null> = { good: 1, warn: 0.5, bad: 0, missing: 0.25, na: null };
const URGENCY: Record<PillarStatus, number> = { bad: 0, missing: 1, warn: 2, good: 3, na: 4 };
const ORDER = new Map<PillarKey, number>(["standing", "state", "filings", "agent", "tax", "records", "returns", "paperwork", "palm"].map((k, i) => [k as PillarKey, i]));
/** Pillars whose "bad" means act now; a missing document is attention, not alarm. */
const ACT = new Set<PillarKey>(["standing", "state", "filings", "agent", "tax", "records"]);

const TAX_WORD: Record<string, string> = {
  "Disregarded Entity": "Disregarded",
  Partnership: "Partnership",
  "S Corporation": "S corporation",
  "C Corporation": "C corporation",
  "Grantor trust": "Grantor trust",
  "Non-grantor trust": "Non-grantor trust",
};

function daysUntil(isoDate: string, today: Date): number {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - t) / DAY);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-31" → "Aug 31, 2026" (pure, so the rule book's text reads the same on the server). */
export function shortDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${MONTH[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : isoDate;
}
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** The members who hold a share (managers with none don't). */
export const shareHolders = (members?: Member[] | null) =>
  (members ?? []).filter((m) => m?.name?.trim() && (!/manager|director|officer/i.test(m.role ?? "") || m.percent != null) && (m.percent == null || m.percent > 0));

/** The record as the rule book reads it: its owner, and how many members hold a share. */
export function paperFor(a: EntityInput, all: Record<string, EntityInput>, id?: string): PaperworkInput & { ownerId?: string } {
  const owner = a.ownerId ? all[a.ownerId] : undefined;
  const holders = shareHolders(a.members);
  return {
    ...a,
    owner: owner ? { name: owner.name, type: owner.type, llcType: owner.llcType } : null,
    ownerCount: holders.length || undefined,
    ownsCount: id ? Object.values(all).filter((x) => x?.ownerId === id).length || undefined : undefined,
  };
}

/** The owner's share of `a` as its members list records it, matched by name. */
function ownerShareOf(a: EntityInput, owner: EntityInput | undefined): number | null {
  if (!owner?.name) return null;
  const hit = (a.members ?? []).find((m) => m?.name && normalizeName(m.name) === normalizeName(owner.name!));
  return typeof hit?.percent === "number" ? hit.percent : null;
}

/** The state's word on an entity, as of its last read in `mode`, and the filing the rule book says is behind. */
export function standingOf(a: EntityInput, mode: PalmMode | null, today = new Date(), due?: Obligation[]): Standing {
  const type = entityType(a);
  const st = stateCode(a.state);
  const where = st ? stateName(st) : null;
  if (type === "Trust") return { tone: "none", word: "Nothing filed with a state", state: where, asOf: null, confirmed: false, missed: null };
  const raw = mode && a.stateRecord?.mode === mode ? a.stateRecord : undefined;
  if (!raw) return { tone: "unknown", word: "Not checked with the state", state: where, asOf: null, confirmed: false, missed: null };
  const rec = effectiveRecord(raw, a.stateConfirmed);
  const confirmed = rec !== raw;
  const asOf = confirmed && a.stateConfirmed ? a.stateConfirmed.at : raw.checkedAt;
  const status = rec.status ?? null;
  const reg = rec.standing?.registration ?? null;
  const lapsed = !!status && status !== "active";
  const word = lapsed
    ? status!.charAt(0).toUpperCase() + status!.slice(1)
    : reg === "not_compliant"
      ? "Active, but not in good standing"
      : reg === "compliant"
        ? "In good standing"
        : status === "active"
          ? "Active"
          : "Read, with no status";
  const tone: Standing["tone"] = lapsed || reg === "not_compliant" ? "bad" : reg === "compliant" ? "good" : "unknown";
  let missed: Standing["missed"] = null;
  if (tone === "bad") {
    const annual = (due ?? obligations(a, today)).find((o) => o.key === "state-annual");
    const p = annual?.last && annual.last.status === "overdue" ? annual.last : null;
    if (annual && p)
      missed = {
        title: annual.title,
        period: p.label,
        due: p.due,
        daysLate: p.daysLate ?? 0,
        lateFee: annual.lateFee,
        consequence: annual.consequence,
        url: annual.url,
        agency: annual.agency,
      };
  }
  return { tone, word, state: where, asOf, confirmed, missed };
}

/** One entity, every pillar. `all` resolves owners; `mode` is Palm's (null: not connected). */
export function assessEntity(id: string, a: EntityInput, all: Record<string, EntityInput>, mode: PalmMode | null, today = new Date()): Assessment {
  const type = entityType(a);
  const isTrust = type === "Trust";
  const st = stateCode(a.state);
  const where = st ? stateName(st) : null;
  const agency = st ? `the ${filingAgency(st, type)}` : "the state";
  const page = (tab: string) => `/assets/${encodeURIComponent(id)}/${tab}`;
  const owner = a.ownerId ? all[a.ownerId] : undefined;
  const paper = paperFor(a, all, id);
  // Judged as the state has it, where its own site was confirmed to say active over Palm's lagging copy.
  const rec = mode && a.stateRecord?.mode === mode ? effectiveRecord(a.stateRecord, a.stateConfirmed) : undefined;
  const link = mode ? a.palm?.[mode] : undefined;
  const dissolved = /dissolv|closed|cancel/i.test(a.status ?? "");
  const check: Fix = { text: "", action: "check-state", cta: "Check with the state" };
  const home = taxHome(paper, (oid) => (all[oid] ? paperFor(all[oid], all, oid) : undefined));
  const due = obligations(paper, today, home ? `${home.name}’s ${home.form}` : null);
  const standing = standingOf(a, mode, today, due);
  const pillars: Pillar[] = [];
  const add = (p: Omit<Pillar, "label"> & { label?: string }) => pillars.push({ label: PILLARS.find((x) => x.key === p.key)!.label, ...p });

  // ── State record ────────────────────────────────────────────────────
  if (isTrust) add({ key: "state", status: "na", summary: "A trust files nothing with a state" });
  else if (!st)
    add({
      key: "state",
      status: "bad",
      summary: "No state of formation",
      fix: { text: "Set the state it was formed in, so its record and filings can be looked up.", href: page("overview"), cta: "Open entity" },
    });
  else if (!mode) add({ key: "state", status: "missing", summary: "Needs Palm to read" });
  else if (!rec) add({ key: "state", status: "missing", summary: "Never checked with the state", fix: { ...check, text: `Read its record from ${agency} through Palm.` } });
  else if (rec.status && rec.status !== "active") {
    add({
      key: "state",
      status: dissolved ? "warn" : "bad",
      summary: `${where ?? "The state"} lists it as ${rec.status}`,
      fix: dissolved
        ? { text: `Marked closed here and ${rec.status} with the state. Nothing to file, unless it should still exist.` }
        : {
            text: `If it should still exist, it can be reinstated with ${agency}: the overdue reports and fees, then a reinstatement application. If it was closed on purpose, mark it dissolved here.`,
            href: page("compliance"),
            cta: "Open Compliance",
          },
    });
  } else {
    const age = Math.floor((today.getTime() - rec.checkedAt) / DAY);
    add(
      age > STALE_DAYS
        ? { key: "state", status: "warn", summary: `Last read ${days(age)} ago`, fix: { ...check, text: "Read it again; standing can lapse between annual reports." } }
        : { key: "state", status: "good", summary: age <= 0 ? "Active, read today" : `Active, read ${days(age)} ago` },
    );
  }

  // ── Good standing / state tax standing ──────────────────────────────
  const std = rec?.standing;
  if (isTrust) {
    add({ key: "standing", status: "na", summary: "Nothing filed with a state" });
    add({ key: "tax", status: "na", summary: "No state record for a trust" });
  } else {
    if (!rec)
      add({ key: "standing", status: "missing", summary: "Unknown until the state is read", fix: mode && st ? { ...check, text: "Check it with the state to learn its standing." } : undefined });
    else if (std?.registration === "not_compliant") {
      const m = standing.missed;
      add({
        key: "standing",
        status: dissolved ? "warn" : "bad",
        summary: m ? `The ${m.period} ${shortTitle(m.title)} is ${days(m.daysLate)} late` : "Not in good standing",
        fix: dissolved
          ? undefined
          : m
            ? {
                text: `File the ${m.period} ${m.title} with ${m.agency} and pay the late fees (${m.lateFee}), then record it as filed. ${m.consequence ?? ""}`.trim(),
                href: m.url ?? page("compliance"),
                cta: m.url ? "File it" : "Open Compliance",
              }
            : { text: `A required filing or fee is outstanding with ${agency}. File it, then read the record again.`, href: page("compliance"), cta: "Open Compliance" },
      });
    } else if (std?.registration === "compliant") add({ key: "standing", status: "good", summary: standing.confirmed ? "In good standing, per the state's own site" : "In good standing" });
    else
      add({
        key: "standing",
        status: "warn",
        summary: "The state's registry doesn't say",
        fix: { text: `${where ?? "The state"}'s registry doesn't report standing. Order a certificate of good standing from ${agency} to confirm it.` },
      });

    if (!rec) add({ key: "tax", status: "missing", summary: "Unknown until the state is read" });
    else if (std?.tax === "not_compliant")
      add({
        key: "tax",
        status: "bad",
        summary: "Behind on state tax",
        fix: { text: `Settle the state tax account${where ? ` with ${where}` : ""} (franchise tax, annual tax report or fees), then read the record again.` },
      });
    else if (std?.tax === "compliant") add({ key: "tax", status: "good", summary: "Current" });
    else add({ key: "tax", status: "na", summary: "Not reported by this state" });
  }

  // ── Registered agent ────────────────────────────────────────────────
  const term = agentTerm(st);
  const ra = link?.ra?.status;
  if (isTrust) add({ key: "agent", label: term, status: "na", summary: "A trust needs none" });
  else if (std?.agent === "not_compliant")
    add({
      key: "agent",
      label: term,
      status: "bad",
      summary: "The state rejects the agent on file",
      fix: { text: `Appoint a new ${term.toLowerCase()}; Palm can arrange one and files the change itself.`, href: page("compliance"), cta: "Open Compliance" },
    });
  else if (ra === "active") add({ key: "agent", label: term, status: "good", summary: rec?.agent ? `${titleCase(rec.agent)}, through Palm` : "Arranged through Palm" });
  else if (ra === "pending") add({ key: "agent", label: term, status: "warn", summary: "Change with the state", fix: { text: "The change is with the state; nothing to do until it's accepted." } });
  else if (ra === "failed")
    add({
      key: "agent",
      label: term,
      status: "bad",
      summary: "The change didn't go through",
      fix: { text: "See why on the Compliance tab and try again.", href: page("compliance"), cta: "Open Compliance" },
    });
  else if (rec?.agent && a.registeredAgent && normalizeName(rec.agent) !== normalizeName(a.registeredAgent))
    add({
      key: "agent",
      label: term,
      status: "warn",
      summary: "The state has a different agent",
      fix: {
        text: `The state has ${titleCase(rec.agent)}; our record says ${a.registeredAgent}. Update the record, or change the agent with the state.`,
        href: page("compliance"),
        cta: "Open Compliance",
      },
    });
  else if (rec?.agent || a.registeredAgent?.trim()) add({ key: "agent", label: term, status: "good", summary: titleCase(rec?.agent ?? a.registeredAgent!.trim()) });
  else
    add({
      key: "agent",
      label: term,
      status: "missing",
      summary: "None on record",
      fix: { text: `Every ${where ?? "state"} entity must keep a ${term.toLowerCase()}. Record the one it has, or have Palm arrange one.`, href: page("compliance"), cta: "Open Compliance" },
    });

  // ── State filings (the annual report, list or tax) ──────────────────
  const annual = due.find((o) => o.key === "state-annual");
  const palmLate = Object.values(a.palmFilings ?? {}).filter((f): f is NonNullable<typeof f> => !!f && f.status === "overdue" && (!mode || f.mode === mode));
  if (dissolved) add({ key: "filings", status: "na", summary: "Closed" });
  else if (palmLate.length && !annual?.overdue)
    add({
      key: "filings",
      status: "bad",
      summary: `${palmLate[0].state} ${palmLate[0].name} is overdue`,
      fix: {
        text: `The state's records (through Palm Monitor) show the ${palmLate[0].state} ${palmLate[0].name} overdue. File it, then record it as filed.`,
        href: page("compliance"),
        cta: "Open Compliance",
      },
    });
  else if (annual) add(periodPillar("filings", annual, today, page("compliance")));
  else add({ key: "filings", status: "na", summary: isTrust ? "None for a trust" : st ? `${where} has no annual filing for it` : "Unknown without a state" });

  // ── Tax returns (federal, and Arizona's where it applies) ───────────
  const fed = due.find((o) => o.key === "fed");
  const stateReturn = due.find((o) => o.key === "az-return");
  if (dissolved) add({ key: "returns", status: "na", summary: "Closed" });
  else if (!fed)
    add({
      key: "returns",
      status: "missing",
      summary: "Tax classification not on record",
      fix: { text: "Record how it's taxed; the returns it files follow from that.", href: page("overview"), cta: "Open entity" },
    });
  else if (fed.missing)
    add({ key: "returns", status: "missing", summary: `${fed.missing} not on record`, fix: { text: `${fed.title}. ${fed.note ?? ""}`.trim(), href: page("overview"), cta: "Open entity" } });
  else if (!fed.last && !fed.next) {
    const r = stateReturn ? periodPillar("returns", stateReturn, today, page("compliance")) : null;
    add(r ?? { key: "returns", status: "na", summary: home ? `On ${home.name}’s ${home.form}` : fed.title });
  } else {
    const worst = [periodPillar("returns", fed, today, page("compliance")), ...(stateReturn ? [periodPillar("returns", stateReturn, today, page("compliance"))] : [])].sort(
      (x, y) => URGENCY[x.status] - URGENCY[y.status],
    )[0];
    add(worst);
  }

  // ── Paperwork ───────────────────────────────────────────────────────
  const rules = documentRules(paper, today).filter((r) => r.level !== "recommended");
  const lacking = rules.filter((r) => !slotCurrent(r, paper));
  const required = lacking.filter((r) => r.level === "required");
  const list = (rs: typeof lacking) => {
    const names = rs.map((r) => r.title);
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  };
  if (!rules.length) add({ key: "paperwork", status: "na", summary: "Nothing required" });
  else if (!lacking.length) add({ key: "paperwork", status: "good", summary: `All ${rules.length} on file` });
  else
    add({
      key: "paperwork",
      status: required.length ? "bad" : "warn",
      summary: `${rules.length - lacking.length} of ${rules.length} on file`,
      fix: { text: `Upload ${list(required.length ? required : lacking)}.`, href: page("documents"), cta: "Open Documents" },
    });

  // ── Records agree ───────────────────────────────────────────────────
  const issues = paperworkChecks(paper).filter((i) => i.severity !== "info");
  const worst = issues.find((i) => i.severity === "high") ?? issues.find((i) => i.severity === "medium") ?? issues[0];
  if (!issues.length) add({ key: "records", status: "good", summary: "No conflicts" });
  else
    add({
      key: "records",
      status: issues.some((i) => i.severity === "high") ? "bad" : "warn",
      summary: issues.length === 1 ? worst.title : `${issues.length} to settle: ${worst.title}`,
      fix: { text: worst.detail, href: page("compliance"), cta: "Open Compliance" },
    });

  // ── Palm link (shown, never counted) ────────────────────────────────
  if (isTrust) add({ key: "palm", status: "na", summary: "Trusts aren't on a state registry" });
  else if (!mode) add({ key: "palm", status: "missing", summary: "Palm isn't connected" });
  else if (link?.businessId) add({ key: "palm", status: "good", summary: link.formation ? "Formed through Palm" : "Linked" });
  else if (rec) add({ key: "palm", status: "warn", summary: "Read from the registry, not added to Palm" });
  else add({ key: "palm", status: "missing", summary: "Not linked to Palm" });

  const order = (ps: Pillar[]) => [...ps].sort((x, y) => ORDER.get(x.key)! - ORDER.get(y.key)!);
  const shown = order(pillars);
  const counted = shown.filter((p) => p.key !== "palm" && POINTS[p.status] !== null);
  const total = counted.reduce((s, p) => s + WEIGHT[p.key], 0);
  const got = counted.reduce((s, p) => s + WEIGHT[p.key] * POINTS[p.status]!, 0);
  const score = total ? Math.round((got / total) * 100) : 100;
  const counts = shown.filter((p) => p.key !== "palm");
  const tier: Tier = counts.some((p) => p.status === "bad" && ACT.has(p.key)) ? "act" : counts.some((p) => p.status !== "good" && p.status !== "na") ? "attention" : "clear";
  // Most urgent first. Reading the state comes before anything else it might
  // overturn, and is asked for once however many pillars wait on it.
  const rank = (p: Pillar) => (p.status === "bad" && ACT.has(p.key) ? -2 : p.fix?.action === "check-state" ? -1 : URGENCY[p.status]);
  let asked = false;
  const fixes = counts
    .filter((p) => p.fix && p.status !== "good" && p.status !== "na")
    .sort((x, y) => rank(x) - rank(y) || ORDER.get(x.key)! - ORDER.get(y.key)!)
    .filter((p) => (p.fix!.action === "check-state" ? !asked && (asked = true) : true))
    .map((p) => ({ ...p.fix!, pillar: p.key, status: p.status }));
  const tax = taxClassOf(paper);
  const completeness = entityCompleteness(paper, today);

  return {
    id,
    name: a.name?.trim() || "Untitled entity",
    type,
    state: st,
    ownerId: a.ownerId && all[a.ownerId] ? a.ownerId : null,
    ownerShare: ownerShareOf(a, owner),
    taxClass: tax.value ? { label: TAX_WORD[tax.value] ?? tax.value, assumed: tax.isDefault } : null,
    pillars: shown,
    score,
    tier,
    standing,
    unverified: !isTrust && !rec,
    record: { score: completeness.score, todo: completeness.missing.length },
    fixes,
  };
}

/** A recurring filing's latest period, as a pillar. */
function periodPillar(key: "filings" | "returns", o: Obligation, today: Date, compliance: string): Pillar {
  const label = PILLARS.find((p) => p.key === key)!.label;
  const last = o.last;
  const short = shortTitle(o.title);
  if (o.missing)
    return {
      key,
      label,
      status: "missing",
      summary: `${short}: date unknown`,
      fix: { text: `Add the ${o.missing.toLowerCase()}; the ${o.title} is due ${o.rule.toLowerCase()}.`, href: compliance.replace(/compliance$/, "overview"), cta: "Open entity" },
    };
  if (last?.status === "overdue")
    return {
      key,
      label,
      status: "bad",
      summary: `${last.label} ${short}: ${days(last.daysLate ?? 0)} late`,
      fix: {
        text: `File the ${last.label} ${o.title} with ${o.agency}${o.lateFee ? ` (late: ${o.lateFee})` : ""}, then record it as filed.`,
        href: o.url ?? compliance,
        cta: o.url ? "File it" : "Open Compliance",
      },
    };
  if (last?.status === "unrecorded")
    return {
      key,
      label,
      status: "missing",
      summary: `${last.label} ${short} not recorded as filed`,
      fix: {
        text: `Record the ${last.label} ${o.title} as filed (the date, and the confirmation if there is one), or file it if it wasn't. It was due ${shortDate(last.extendedTo ?? last.due)}.`,
        href: compliance,
        cta: "Open Compliance",
      },
    };
  const nextDue = o.due;
  const d = nextDue ? daysUntil(nextDue, today) : null;
  if (d != null && d <= 30)
    return {
      key,
      label,
      status: "warn",
      summary: `${short} due ${d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${days(d)}`}`,
      fix: { text: `The ${o.title} is due ${shortDate(nextDue!)}${o.fee ? ` (${o.fee})` : ""}.`, href: o.url ?? compliance, cta: o.url ? "File it" : "Open Compliance" },
    };
  const was =
    last?.status === "filed"
      ? `${last.label} filed`
      : last?.status === "extended"
        ? `${last.label} extended to ${shortDate(last.extendedTo!)}`
        : last?.status === "current"
          ? `${last.label} current per the state`
          : null;
  return { key, label, status: "good", summary: [was, nextDue ? `next ${shortDate(nextDue)}` : null].filter(Boolean).join("; ") || "Nothing due" };
}

/** "Nevada Annual List + State Business License" → "annual list"; "Form 1065 + Schedule K-1s" → "Form 1065". */
function shortTitle(t: string): string {
  if (/annual list/i.test(t)) return "annual list";
  if (/annual report/i.test(t)) return "annual report";
  if (/franchise tax/i.test(t)) return "franchise tax";
  if (/annual tax/i.test(t)) return "annual tax";
  return t.replace(/\s*\+.*$/, "").replace(/\s*\(.*\)$/, "");
}

/** "NORTHWEST REGISTERED AGENT LLC*" → "Northwest Registered Agent LLC": a registry's capitals, for display. */
export function titleCase(s: string): string {
  const t = s.replace(/\*+$/, "").trim();
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_m, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Llc|Lp|Llp|Pllc|Inc|Ltd|Co|Ste|Po|Pmb|Ne|Nw|Se|Sw|N|S|E|W)\b/g, (w) => (/^(Llc|Lp|Llp|Pllc|Po|Pmb|Ne|Nw|Se|Sw)$/.test(w) ? w.toUpperCase() : w))
    .replace(/\b(Nv|Az|De|Ny|Ca|Tx|Fl|Wy|Ut|Co|Wa)\b(?=\s+\d{5})/g, (w) => w.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (w) => w.toUpperCase());
}

export function assessAll(all: Record<string, EntityInput>, mode: PalmMode | null, today = new Date()): Assessment[] {
  return Object.entries(all)
    .filter(([, a]) => a && typeof a.name === "string" && a.name.trim())
    .map(([id, a]) => assessEntity(id, a, all, mode, today));
}

const TIER_ORDER: Record<Tier, number> = { act: 0, attention: 1, clear: 2 };

/** Worst first: act now, then needs attention, then clear; within each, the most failing checks, then the lowest score, then by name. */
export function byUrgency(a: Assessment, b: Assessment): number {
  const bad = (x: Assessment) => x.pillars.filter((p) => p.status === "bad" && p.key !== "palm").length;
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || bad(b) - bad(a) || a.score - b.score || a.name.localeCompare(b.name);
}

/** The family's picture: how many entities in each tier (they add up to the total), and of those, how many the state hasn't been asked about. */
export function summarize(list: Assessment[]) {
  const by = (t: Tier) => list.filter((a) => a.tier === t).length;
  const coverage = PILLARS.map((p) => {
    const counts: Record<PillarStatus, number> = { good: 0, warn: 0, bad: 0, missing: 0, na: 0 };
    for (const a of list) counts[a.pillars.find((x) => x.key === p.key)?.status ?? "na"]++;
    return { ...p, counts };
  });
  // The oldest state read among those read: what "as of" the picture is.
  const reads = list.map((a) => a.standing.asOf).filter((x): x is number => typeof x === "number");
  return {
    total: list.length,
    act: by("act"),
    attention: by("attention"),
    clear: by("clear"),
    unverified: list.filter((a) => a.unverified).length,
    oldestRead: reads.length ? Math.min(...reads) : null,
    coverage,
  };
}

/** Owners before what they own, as columns for the map: depth → entities, by name. Cycles break at the first repeat. */
export function treeLevels(list: Assessment[]): Assessment[][] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const depth = new Map<string, number>();
  const depthOf = (a: Assessment, seen = new Set<string>()): number => {
    if (depth.has(a.id)) return depth.get(a.id)!;
    const parent = a.ownerId ? byId.get(a.ownerId) : undefined;
    const d = parent && !seen.has(parent.id) ? depthOf(parent, new Set(seen).add(a.id)) + 1 : 0;
    depth.set(a.id, d);
    return d;
  };
  const levels: Assessment[][] = [];
  for (const a of list) (levels[depthOf(a)] ??= []).push(a);
  // Order each column by its parents' order, so lines cross as little as possible.
  const pos = new Map<string, number>();
  levels.forEach((col, i) => {
    col.sort((x, y) => {
      if (i > 0) {
        const px = pos.get(x.ownerId ?? "") ?? 0;
        const py = pos.get(y.ownerId ?? "") ?? 0;
        if (px !== py) return px - py;
      }
      return x.name.localeCompare(y.name);
    });
    col.forEach((a, k) => pos.set(a.id, k));
  });
  return levels.filter(Boolean);
}
