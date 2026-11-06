/**
 * What the views show, worked out once from the record: the rule book's
 * paperwork, deadlines and checks, completeness, owners per the documents,
 * whose return its income lands on, what it owns, and the tabs. Pure — no
 * React.
 */

import { formingNow } from "../entity-addresses";
import { entityCompleteness, entityType, undecidedHost } from "../entity-completeness";
import { documentRules, obligations, paperworkChecks, taxClassOf, taxHome, type Obligation, type PaperworkInput } from "../entity-paperwork";
import { stateFindings, type PalmMode } from "../palm";
import { FILING_KINDS, holdsOwnership, normEntityName, splitNames, type Asset, type AssetDoc, type EntityTab, type FileKind, type OperatingContract } from "./model";

/** A tab: its count is only ever the number of things in it that need the person (DESIGN.md §8.11). */
type Tab = { key: EntityTab; label: string; count?: number; alert?: boolean };

type Lookup = Record<string, PaperworkInput & { ownerId?: string; members?: { name: string; percent: number | null }[] }>;

export function deriveEntity(input: {
  asset: Asset;
  docs: AssetDoc[];
  contracts: OperatingContract[];
  allAssets: Lookup;
  kindsFor: (a: Asset | null) => FileKind[];
  tabParam?: string;
  /** An invited entity owner: a read-only page of documents and people. */
  partner?: boolean;
  /** Palm's mode now: only its filings from this mode show as deadlines. */
  palmMode?: PalmMode | null;
  /** The entity's id, to find the entities it owns. */
  id?: string;
}) {
  const { asset, contracts, allAssets, kindsFor, tabParam, partner = false, palmMode, id } = input;
  const etype = entityType(asset);
  const isTrust = etype === "Trust";
  const glyph = etype === "C-Corp" ? "INC" : etype === "Trust" ? "TR" : etype === "LP" ? "LP" : "LLC";

  // What the rule book reads: the record, plus its owner and the owners its documents list.
  const ownerRec = asset.ownerId ? allAssets[asset.ownerId] : undefined;
  const docOwners = (asset.members?.length ? asset.members : (asset.profile?.members ?? []).map((m) => ({ ...m, role: "member" }))).filter(
    (m) => holdsOwnership(m) && (m.percent == null || m.percent > 0),
  );
  const owned = id ? ownedBy(id, asset, allAssets) : [];
  const paper: PaperworkInput = {
    ...asset,
    owner: ownerRec ? { name: ownerRec.name, type: ownerRec.type, llcType: ownerRec.llcType } : null,
    ownerCount: docOwners.length || undefined,
    ownsCount: owned.length || undefined,
    forming: !!formingNow(asset as never),
  };
  // A foreign registration nobody has said is needed (only its address is in that state) isn't asked for yet;
  // a W-9 is required, not just expected, once it bills a client as manager (the payer needs it for a 1099).
  const undecided = undecidedHost(paper);
  const billing = contracts.some((c) => c.status === "active" && c.role === "manager");
  const rules = documentRules(paper)
    .filter((r) => !(undecided && r.key === "foreignRegistration"))
    .map((r) => (r.key === "w9" && billing && r.level !== "required" ? { ...r, level: "required" as const, why: `${r.why} It bills a client under an active agreement, so the client needs this W-9 to issue its 1099.` } : r));
  const scoredKinds = rules.filter((r) => r.level !== "recommended").map((r) => r.key);
  const kinds = kindsFor(asset).filter((k) => !(undecided && k === "foreignRegistration" && !asset[k]));
  const filedCount = scoredKinds.filter((k) => asset[k]).length;
  const homeReturn = taxHome({ ...paper, ownerId: asset.ownerId }, (oid) => allAssets[oid]);
  const home = taxHomeLine({ ...paper, ownerId: asset.ownerId }, allAssets);
  const ruleDeadlines = obligations(paper, new Date(), homeReturn ? `${homeReturn.name}'s ${homeReturn.form === "return" ? "return" : homeReturn.form}` : null);
  const palmDue = palmFilingDeadlines(asset.palmFilings, palmMode ?? null);
  const deadlines = [...palmDue.deadlines, ...ruleDeadlines];
  const issues = paperworkChecks(paper);
  const { score, items: checklist, missing: ranked } = entityCompleteness(paper);
  const missing = ranked;
  const docFiledAs = new Map<string, FileKind>();
  for (const k of FILING_KINDS) if (asset[k]?.docId) docFiledAs.set(asset[k]!.docId!, k);

  const stateBad = asset.stateRecord ? stateFindings(asset.stateRecord, asset).filter((f) => f.tone === "bad").length : 0;
  const complianceAlerts = issues.filter((i) => i.severity !== "info").length + stateBad + palmDue.overdue;
  const people = { key: "people" as const, label: isTrust ? "People" : "Owners" };
  const tabs: Tab[] = partner
    ? [{ key: "documents", label: "Documents" }, people]
    : [
        { key: "overview", label: "Overview" },
        { key: "documents", label: "Documents" },
        people,
        { key: "compliance", label: "Compliance", count: complianceAlerts || undefined, alert: complianceAlerts > 0 },
        ...(etype === "LLC" ? [{ key: "agreements" as const, label: "Contracts" }] : []),
        ...(asset.type === "C-Corp" ? [{ key: "governance" as const, label: "Governance" }] : []),
        { key: "activity", label: "Activity" },
      ];
  const tab: EntityTab = tabs.some((t) => t.key === tabParam) ? (tabParam as EntityTab) : tabs[0].key;

  return {
    etype,
    isTrust,
    glyph,
    ownerRec,
    docOwners,
    owned,
    paper,
    rules,
    scoredKinds,
    kinds,
    filedCount,
    homeReturn,
    /** Whose return its income lands on, in one sentence, or what's missing to say. */
    homeLine: home,
    undecidedHost: undecided,
    deadlines,
    issues,
    score,
    checklist,
    missing,
    docFiledAs,
    complianceAlerts,
    tabs,
    tab,
  };
}

export type EntityView = ReturnType<typeof deriveEntity>;

/** What a formation through Palm brings with it: not a to-do while it's under way. */
export const WITH_FORMATION = new Set(["ein", "formationDate", "registeredAgent", "registeredAgentAddress", "articles", "einLetter"]);

/** The family's entities this one owns on record, with its share of each when the child's owners list says. */
export function ownedBy(id: string, asset: { name?: string }, all: Lookup): { id: string; name: string; percent: number | null }[] {
  const me = normEntityName(asset.name);
  return Object.entries(all)
    .filter(([cid, a]) => a && a.ownerId === id && cid !== id)
    .map(([cid, a]) => {
      const share = (a.members ?? []).find((m) => normEntityName(m.name) === me);
      return { id: cid, name: a.name ?? "An entity", percent: share?.percent ?? null };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** "Robert and Claire Doe" from ["Robert Doe", "Claire Doe"]; otherwise the names joined. */
function joinPeople(names: string[]): string {
  if (names.length === 1) return names[0];
  const last = (n: string) => n.trim().split(/\s+/).pop() ?? "";
  const first = (n: string) => n.trim().split(/\s+/).slice(0, -1).join(" ");
  if (names.length === 2 && last(names[0]) && last(names[0]) === last(names[1])) return `${first(names[0])} and ${first(names[1])} ${last(names[0])}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
const possessive = (s: string) => (/s$/.test(s) ? `${s}’` : `${s}’s`);

/**
 * Whose return a disregarded entity's income lands on, as one plain
 * sentence, following its owners up the chain. A trust with no tax class on
 * record isn't assumed to be a grantor trust: the sentence says so, and what
 * to set. Null when it isn't disregarded or has no owner on record.
 */
export function taxHomeLine(
  a: PaperworkInput & { ownerId?: string },
  all: Record<string, PaperworkInput & { ownerId?: string }>,
): { text: string; needsClass?: { id: string; name: string } } | null {
  if (taxClassOf(a).value !== "Disregarded Entity") return null;
  const seen = new Set<string>();
  const through: string[] = [];
  let id = a.ownerId;
  while (id && all[id] && !seen.has(id)) {
    seen.add(id);
    const cur = all[id];
    const name = cur.name ?? "its owner";
    const via = through.length ? `, through ${through.join(" and ")}` : "";
    if (entityType(cur) === "Trust") {
      const recorded = (cur.llcType ?? "").trim();
      if (!recorded) return { text: `Its owner, ${name}, has no tax class on record. Set it to see whose return this lands on.`, needsClass: { id, name } };
      if (/^non-grantor/i.test(recorded)) return { text: `Reported on ${possessive(name)} Form 1041${via}.` };
      const grantors = splitNames(cur.grantors);
      if (!grantors.length) return { text: `Reported on the grantors’ Form 1040, through ${name} (a grantor trust files no separate return)${via ? via.replace(/^,/, ";") : ""}.` };
      return { text: `Reported on ${possessive(joinPeople(grantors))} Form 1040 (the ${grantors.length === 1 ? "grantor" : "grantors"}), through ${name}${via}. A grantor trust files no separate return.` };
    }
    const tax = taxClassOf(cur).value;
    if (tax === "Partnership") return { text: `Reported on ${possessive(name)} Form 1065${via}.` };
    if (tax === "S Corporation") return { text: `Reported on ${possessive(name)} Form 1120-S${via}.` };
    if (tax === "C Corporation") return { text: `Reported on ${possessive(name)} Form 1120${via}.` };
    if (tax !== "Disregarded Entity" || !cur.ownerId) return { text: `Reported on ${possessive(name)} return${via}.` };
    through.push(name);
    id = cur.ownerId;
  }
  return null;
}

/**
 * The filings Palm Monitor says are due or overdue (asset.palmFilings), as
 * deadlines ahead of the rule book's own: the state's word on what's owed.
 * A "due" one more than 30 days past its date is stale (the next event
 * replaces it); an overdue one stays until Palm says otherwise.
 */
export function palmFilingDeadlines(filings: Asset["palmFilings"], mode: PalmMode | null, now = Date.now()): { deadlines: Obligation[]; overdue: number } {
  const out: Obligation[] = [];
  let overdue = 0;
  for (const [key, f] of Object.entries(filings ?? {})) {
    if (!f || (mode && f.mode !== mode)) continue;
    const late = f.status === "overdue";
    if (!late && f.dueDate && now - Date.parse(f.dueDate) > 30 * 86_400_000) continue;
    if (late) overdue++;
    out.push({
      key: `palm_${key}`,
      title: `${f.state} ${f.name}${late ? " (overdue)" : ""}`,
      agency: `${f.state} (per Palm Monitor)`,
      due: f.dueDate,
      rule: late ? "The state's records show this filing overdue." : `Due per the state's records${f.frequency ? `; filed ${f.frequency.replace(/_/g, " ")}` : ""}.`,
      note: f.mode === "test" ? "Palm sandbox (test mode)." : undefined,
    });
  }
  out.sort((a, b) => Number(b.title.endsWith("(overdue)")) - Number(a.title.endsWith("(overdue)")) || String(a.due ?? "9").localeCompare(String(b.due ?? "9")));
  return { deadlines: out, overdue };
}
