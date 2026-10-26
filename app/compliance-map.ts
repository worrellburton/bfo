/**
 * Entity compliance across the whole family (Tools → Entity compliance): each
 * entity read through Palm and the rule book into eight pillars, each one
 * good / warn / bad / missing / n/a, and for anything short of good, the one
 * thing to do about it. Pure — the page draws it, tests read it.
 *
 *   palm       linked to Palm in the current mode (a trust has no state record)
 *   state      the state's record read through Palm, active and recent
 *   standing   the state's good standing (registration)
 *   tax        the state's tax standing, where the state reports it
 *   agent      a registered agent the state accepts
 *   paperwork  the documents the rule book requires
 *   records    our record agrees with itself and the rules (paperworkChecks)
 *   deadlines  what's due next, and whether it can be worked out
 */

import { documentRules, entityType, obligations, paperworkChecks, stateCode, stateName, agentTerm, type PaperworkInput } from "./entity-paperwork";
import { effectiveRecord, normalizeName, type PalmLink, type PalmMode, type StateConfirmation, type StateRecord } from "./palm";

export type PillarKey = "palm" | "state" | "standing" | "tax" | "agent" | "paperwork" | "records" | "deadlines";
export type PillarStatus = "good" | "warn" | "bad" | "missing" | "na";

/** What fixes a pillar: a step in words, and where it's done. */
export type Fix = {
  text: string;
  /** "check-state" runs the state lookup from the map; otherwise a link. */
  action?: "check-state";
  href?: string;
  cta?: string;
};

export type Pillar = { key: PillarKey; label: string; status: PillarStatus; summary: string; fix?: Fix };

export type Tier = "good" | "attention" | "risk";

export type Assessment = {
  id: string;
  name: string;
  type: string;
  state: string | null;
  ownerId: string | null;
  pillars: Pillar[];
  /** 0–100 over the pillars that apply. */
  score: number;
  tier: Tier;
  /** The state hasn't been asked about this entity in the current mode. */
  unverified: boolean;
  /** The steps, most urgent first. */
  fixes: (Fix & { pillar: PillarKey; status: PillarStatus })[];
};

export const PILLARS: { key: PillarKey; label: string; short: string }[] = [
  { key: "palm", label: "Palm link", short: "Palm" },
  { key: "state", label: "State record", short: "State" },
  { key: "standing", label: "Good standing", short: "Standing" },
  { key: "tax", label: "Tax standing", short: "Tax" },
  { key: "agent", label: "Registered agent", short: "Agent" },
  { key: "paperwork", label: "Paperwork", short: "Papers" },
  { key: "records", label: "Records agree", short: "Records" },
  { key: "deadlines", label: "Deadlines", short: "Due" },
];

/** A state record older than this is read again before it's trusted. */
export const STALE_DAYS = 45;
const DAY = 86_400_000;

export type EntityInput = PaperworkInput & {
  ownerId?: string;
  fileNumber?: string;
  status?: string;
  palm?: Partial<Record<PalmMode, PalmLink>>;
  stateRecord?: StateRecord;
  stateConfirmed?: StateConfirmation | null;
};

const POINTS: Record<PillarStatus, number | null> = { good: 1, warn: 0.5, bad: 0, missing: 0, na: null };
const URGENCY: Record<PillarStatus, number> = { bad: 0, missing: 1, warn: 2, good: 3, na: 4 };
const ORDER = new Map(["state", "standing", "tax", "agent", "palm", "paperwork", "records", "deadlines"].map((k, i) => [k, i]));

function daysUntil(isoDate: string, today: Date): number {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - t) / DAY);
}

/** One entity, all eight pillars. `all` resolves owners; `mode` is Palm's (null: not connected). */
export function assessEntity(
  id: string,
  a: EntityInput,
  all: Record<string, EntityInput>,
  mode: PalmMode | null,
  today = new Date(),
): Assessment {
  const type = entityType(a);
  const isTrust = type === "Trust";
  const st = stateCode(a.state);
  const where = st ? stateName(st) : null;
  const sos = where ? `the ${where} Secretary of State` : "the state";
  const page = (tab: string) => `/assets/${encodeURIComponent(id)}/${tab}`;
  const owner = a.ownerId ? all[a.ownerId] : undefined;
  const paper: PaperworkInput = { ...a, owner: owner ? { name: owner.name, type: owner.type, llcType: owner.llcType } : null };
  // Judged as the state has it, where its own site was confirmed to say active over Palm's lagging copy.
  const rec = mode && a.stateRecord?.mode === mode ? effectiveRecord(a.stateRecord, a.stateConfirmed) : undefined;
  const link = mode ? a.palm?.[mode] : undefined;
  const dissolved = /dissolv|closed|cancel/i.test(a.status ?? "");
  const check: Fix = { text: "", action: "check-state", cta: "Check with the state" };
  const pillars: Pillar[] = [];

  // ── Palm link ───────────────────────────────────────────────────────
  if (isTrust) pillars.push({ key: "palm", label: "Palm link", status: "na", summary: "Trusts aren't on a state registry" });
  else if (!mode) pillars.push({ key: "palm", label: "Palm link", status: "missing", summary: "Palm isn't connected", fix: { text: "Add PALM_API_KEY in Vercel so BFO can read the state registries." } });
  else if (link?.businessId) pillars.push({ key: "palm", label: "Palm link", status: "good", summary: link.formation ? "Formed through Palm" : "Linked" });
  else if (rec) pillars.push({ key: "palm", label: "Palm link", status: "warn", summary: "Read from the registry, not added to Palm", fix: { text: "Add it to Palm from its Compliance tab (moving the agent to Palm does this) so state mail and filings reach BFO.", href: page("compliance"), cta: "Open Compliance" } });
  else
    pillars.push({
      key: "palm",
      label: "Palm link",
      status: "missing",
      summary: "Not linked to Palm",
      fix: st ? { ...check, text: "Check it with the state: Palm finds it on the registry, then it can be added to Palm." } : { text: "Once its state is set, check it with the state to find it on the registry." },
    });

  // ── State record ────────────────────────────────────────────────────
  if (isTrust) pillars.push({ key: "state", label: "State record", status: "na", summary: "No state filing for a trust" });
  else if (!st) pillars.push({ key: "state", label: "State record", status: "bad", summary: "No state of formation", fix: { text: "Set the state it was formed in, so its record and filings can be looked up.", href: page("overview"), cta: "Open entity" } });
  else if (!mode) pillars.push({ key: "state", label: "State record", status: "missing", summary: "Needs Palm to read" });
  else if (!rec) pillars.push({ key: "state", label: "State record", status: "missing", summary: "Never checked with the state", fix: { ...check, text: `Read its record from ${sos} through Palm.` } });
  else if (rec.status && rec.status !== "active") {
    pillars.push({
      key: "state",
      label: "State record",
      status: dissolved ? "warn" : "bad",
      summary: `The state lists it as ${rec.status}`,
      fix: dissolved
        ? { text: `Marked closed here and ${rec.status} with the state. Nothing to file, unless it should still exist.` }
        : { text: `If it should still exist, file for reinstatement with ${sos}: the overdue reports and fees, then a reinstatement application. If it was closed on purpose, mark it dissolved here.`, href: page("compliance"), cta: "Open Compliance" },
    });
  } else {
    const age = Math.floor((today.getTime() - rec.checkedAt) / DAY);
    pillars.push(
      age > STALE_DAYS
        ? { key: "state", label: "State record", status: "warn", summary: `Active, last read ${age} days ago`, fix: { ...check, text: "Read it again; standing can lapse between annual reports." } }
        : { key: "state", label: "State record", status: "good", summary: age <= 0 ? "Active, read today" : `Active, read ${age} day${age === 1 ? "" : "s"} ago` },
    );
  }

  // ── Good standing / tax standing ────────────────────────────────────
  const standing = rec?.standing;
  if (isTrust) {
    pillars.push({ key: "standing", label: "Good standing", status: "na", summary: "Doesn't apply to a trust" });
    pillars.push({ key: "tax", label: "Tax standing", status: "na", summary: "Doesn't apply to a trust" });
  } else {
    if (!rec) pillars.push({ key: "standing", label: "Good standing", status: "missing", summary: "Unknown until the state is checked", fix: mode && st ? { ...check, text: "Check it with the state to learn its standing." } : undefined });
    else if (standing?.registration === "not_compliant")
      pillars.push({ key: "standing", label: "Good standing", status: dissolved ? "warn" : "bad", summary: "Not in good standing", fix: dissolved ? undefined : { text: `File the overdue annual report and pay what's owed to ${sos}, then check again. Banks and buyers ask for a good-standing certificate.`, href: page("compliance"), cta: "Open Compliance" } });
    else if (standing?.registration === "compliant") pillars.push({ key: "standing", label: "Good standing", status: "good", summary: "In good standing" });
    else pillars.push({ key: "standing", label: "Good standing", status: "warn", summary: "Not reported by the state", fix: { text: `${where ?? "The state"}'s registry doesn't report standing. Order a certificate of good standing from ${sos} to confirm it.` } });

    if (!rec) pillars.push({ key: "tax", label: "Tax standing", status: "missing", summary: "Unknown until the state is checked" });
    else if (standing?.tax === "not_compliant") pillars.push({ key: "tax", label: "Tax standing", status: "bad", summary: "Not compliant on state tax", fix: { text: `Settle the state tax account${where ? ` with ${where}` : ""} (franchise tax, annual tax report or fees), then check again.` } });
    else if (standing?.tax === "compliant") pillars.push({ key: "tax", label: "Tax standing", status: "good", summary: "Compliant" });
    else pillars.push({ key: "tax", label: "Tax standing", status: "na", summary: "Not reported by this state" });
  }

  // ── Registered agent ────────────────────────────────────────────────
  const term = agentTerm(st);
  const ra = link?.ra?.status;
  if (isTrust) pillars.push({ key: "agent", label: term, status: "na", summary: "A trust needs none" });
  else if (standing?.agent === "not_compliant") pillars.push({ key: "agent", label: term, status: "bad", summary: "The state rejects the agent on file", fix: { text: `Appoint a new ${term.toLowerCase()}; Palm can be the agent and files the change itself.`, href: page("compliance"), cta: "Make Palm the agent" } });
  else if (ra === "active") pillars.push({ key: "agent", label: term, status: "good", summary: "Palm is the agent" });
  else if (ra === "pending") pillars.push({ key: "agent", label: term, status: "warn", summary: "Moving to Palm", fix: { text: "The change is with the state; nothing to do until it's accepted." } });
  else if (ra === "failed") pillars.push({ key: "agent", label: term, status: "bad", summary: "The move to Palm didn't go through", fix: { text: "See why on the Compliance tab and try again.", href: page("compliance"), cta: "Open Compliance" } });
  else if (rec?.agent && a.registeredAgent && normalizeName(rec.agent) !== normalizeName(a.registeredAgent))
    pillars.push({ key: "agent", label: term, status: "warn", summary: `State has ${rec.agent}`, fix: { text: `Our record says ${a.registeredAgent}. Update the record, or change the agent with the state.`, href: page("compliance"), cta: "Open Compliance" } });
  else if (rec?.agent || a.registeredAgent?.trim()) pillars.push({ key: "agent", label: term, status: "good", summary: rec?.agent ?? a.registeredAgent!.trim() });
  else pillars.push({ key: "agent", label: term, status: "missing", summary: "None on file", fix: { text: `Every ${where ?? "state"} entity needs a ${term.toLowerCase()}. Make Palm the agent, or record the one you have.`, href: page("compliance"), cta: "Make Palm the agent" } });

  // ── Paperwork ───────────────────────────────────────────────────────
  const rules = documentRules(paper).filter((r) => r.level !== "recommended");
  const lacking = rules.filter((r) => !a[r.key]);
  const required = lacking.filter((r) => r.level === "required");
  const list = (rs: typeof lacking) => {
    const names = rs.map((r) => r.title);
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  };
  if (!rules.length) pillars.push({ key: "paperwork", label: "Paperwork", status: "na", summary: "Nothing required" });
  else if (!lacking.length) pillars.push({ key: "paperwork", label: "Paperwork", status: "good", summary: `All ${rules.length} on file` });
  else
    pillars.push({
      key: "paperwork",
      label: "Paperwork",
      status: required.length ? "bad" : "warn",
      summary: `${rules.length - lacking.length} of ${rules.length} on file`,
      fix: { text: `Upload ${list(required.length ? required : lacking)}.`, href: page("documents"), cta: "Open Documents" },
    });

  // ── Records agree ───────────────────────────────────────────────────
  const issues = paperworkChecks(paper).filter((i) => i.severity !== "info");
  const worst = issues.find((i) => i.severity === "high") ?? issues.find((i) => i.severity === "medium") ?? issues[0];
  if (!issues.length) pillars.push({ key: "records", label: "Records agree", status: "good", summary: "No conflicts" });
  else
    pillars.push({
      key: "records",
      label: "Records agree",
      status: issues.some((i) => i.severity === "high") ? "bad" : "warn",
      summary: issues.length === 1 ? worst.title : `${issues.length} issues: ${worst.title}`,
      fix: { text: worst.detail, href: page("compliance"), cta: "Open Compliance" },
    });

  // ── Deadlines ───────────────────────────────────────────────────────
  const due = obligations(paper, today);
  const dated = due.filter((o) => o.due).sort((x, y) => x.due!.localeCompare(y.due!));
  const next = dated[0];
  const undatedState = due.find((o) => !o.due && o.key === "state-annual");
  if (dissolved) pillars.push({ key: "deadlines", label: "Deadlines", status: "na", summary: "Closed" });
  else if (undatedState) pillars.push({ key: "deadlines", label: "Deadlines", status: "missing", summary: `${undatedState.title}: date unknown`, fix: { text: `Add the formation date; the ${undatedState.title} is due ${undatedState.rule.toLowerCase()}.`, href: page("overview"), cta: "Open entity" } });
  else if (!next) pillars.push({ key: "deadlines", label: "Deadlines", status: due.length ? "good" : "na", summary: due.length ? "Nothing dated" : "Nothing recurring" });
  else {
    const days = daysUntil(next.due!, today);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    pillars.push(
      days <= 30
        ? { key: "deadlines", label: "Deadlines", status: "warn", summary: `${next.title} ${when}`, fix: { text: `${next.title} for ${next.agency} is due ${next.due}${next.fee ? ` (${next.fee})` : ""}.`, href: next.url ?? page("compliance"), cta: next.url ? "File it" : "Open Compliance" } }
        : { key: "deadlines", label: "Deadlines", status: "good", summary: `Next: ${next.title}, ${next.due}` },
    );
  }

  const scored = pillars.map((p) => POINTS[p.status]).filter((v): v is number => v !== null);
  const score = scored.length ? Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 100) : 100;
  const tier: Tier = pillars.some((p) => p.status === "bad") ? "risk" : pillars.some((p) => p.status === "warn" || p.status === "missing") ? "attention" : "good";
  // Most urgent first. Reading the state comes before anything else it might
  // overturn, and is asked for once however many pillars wait on it.
  const rank = (p: Pillar) => (p.fix?.action === "check-state" ? -1 : URGENCY[p.status]);
  let asked = false;
  const fixes = pillars
    .filter((p) => p.fix && p.status !== "good" && p.status !== "na")
    .sort((x, y) => rank(x) - rank(y) || ORDER.get(x.key)! - ORDER.get(y.key)!)
    .filter((p) => (p.fix!.action === "check-state" ? !asked && (asked = true) : true))
    .map((p) => ({ ...p.fix!, pillar: p.key, status: p.status }));

  return {
    id,
    name: a.name?.trim() || "Untitled entity",
    type,
    state: st,
    ownerId: a.ownerId && all[a.ownerId] ? a.ownerId : null,
    pillars,
    score,
    tier,
    unverified: !isTrust && !rec,
    fixes,
  };
}

export function assessAll(all: Record<string, EntityInput>, mode: PalmMode | null, today = new Date()): Assessment[] {
  return Object.entries(all)
    .filter(([, a]) => a && typeof a.name === "string" && a.name.trim())
    .map(([id, a]) => assessEntity(id, a, all, mode, today));
}

/** The family's overall picture. */
export function summarize(list: Assessment[]) {
  const by = (t: Tier) => list.filter((a) => a.tier === t).length;
  const score = list.length ? Math.round(list.reduce((s, a) => s + a.score, 0) / list.length) : 0;
  const coverage = PILLARS.map((p) => {
    const counts: Record<PillarStatus, number> = { good: 0, warn: 0, bad: 0, missing: 0, na: 0 };
    for (const a of list) counts[a.pillars.find((x) => x.key === p.key)?.status ?? "na"]++;
    return { ...p, counts };
  });
  return { score, total: list.length, good: by("good"), attention: by("attention"), risk: by("risk"), unverified: list.filter((a) => a.unverified).length, coverage };
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
