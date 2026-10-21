/**
 * What the views show, worked out once from the record: the rule book's
 * paperwork, deadlines and checks, completeness, owners per the documents,
 * and the category menu. Pure — no React.
 */

import { formingNow } from "../entity-addresses";
import { entityCompleteness, entityType } from "../entity-completeness";
import { documentRules, obligations, paperworkChecks, taxHome, type PaperworkInput } from "../entity-paperwork";
import { stateFindings } from "../palm";
import { FILING_KINDS, type Asset, type AssetDoc, type EntityTab, type FileKind, type OperatingContract } from "./model";

export type Tab = { key: EntityTab; label: string; count?: number; alert?: boolean };

export function deriveEntity(input: {
  asset: Asset;
  docs: AssetDoc[];
  contracts: OperatingContract[];
  allAssets: Record<string, PaperworkInput & { ownerId?: string }>;
  kindsFor: (a: Asset | null) => FileKind[];
  tabParam?: string;
  /** An invited entity owner: a read-only page of documents and people. */
  partner?: boolean;
}) {
  const { asset, docs, contracts, allAssets, kindsFor, tabParam, partner = false } = input;
  const etype = entityType(asset);
  const isTrust = etype === "Trust";
  const glyph = etype === "C-Corp" ? "INC" : etype === "Trust" ? "TR" : etype === "LP" ? "LP" : "LLC";

  // What the rule book reads: the record, plus its owner and the owners its documents list.
  const ownerRec = asset.ownerId ? allAssets[asset.ownerId] : undefined;
  const docOwners = (asset.members?.length ? asset.members : (asset.profile?.members ?? []).map((m) => ({ ...m, role: "member" }))).filter(
    (m) => !/manager|director|officer/i.test(m.role ?? "") && (m.percent == null || m.percent > 0),
  );
  const paper: PaperworkInput = {
    ...asset,
    owner: ownerRec ? { name: ownerRec.name, type: ownerRec.type, llcType: ownerRec.llcType } : null,
    ownerCount: docOwners.length || undefined,
    forming: !!formingNow(asset as never),
  };
  const rules = documentRules(paper);
  const scoredKinds = rules.filter((r) => r.level !== "recommended").map((r) => r.key);
  const kinds = kindsFor(asset);
  const filedCount = scoredKinds.filter((k) => asset[k]).length;
  const homeReturn = taxHome({ ...paper, ownerId: asset.ownerId }, (oid) => allAssets[oid]);
  const deadlines = obligations(paper, new Date(), homeReturn ? `${homeReturn.name}'s ${homeReturn.form === "return" ? "return" : homeReturn.form}` : null);
  const issues = paperworkChecks(paper);
  const { score, items: checklist } = entityCompleteness(paper);
  const missing = checklist.filter((i) => !i.done);
  const docFiledAs = new Map<string, FileKind>();
  for (const k of FILING_KINDS) if (asset[k]?.docId) docFiledAs.set(asset[k]!.docId!, k);

  const stateBad = asset.stateRecord ? stateFindings(asset.stateRecord, asset).filter((f) => f.tone === "bad").length : 0;
  const complianceAlerts = issues.filter((i) => i.severity !== "info").length + stateBad;
  const people = { key: "people" as const, label: isTrust ? "People" : "Owners", count: (asset.members?.length || (asset.ownerId ? 1 : 0)) || undefined };
  const tabs: Tab[] = partner
    ? [{ key: "documents", label: "Documents", count: docs.length || undefined }, people]
    : [
        { key: "overview", label: "Overview" },
        { key: "documents", label: "Documents", count: docs.length || undefined },
        people,
        { key: "compliance", label: "Compliance", count: complianceAlerts || undefined, alert: complianceAlerts > 0 },
        ...(etype === "LLC" ? [{ key: "agreements" as const, label: "Contracts", count: contracts.length || undefined }] : []),
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
    paper,
    rules,
    scoredKinds,
    kinds,
    filedCount,
    homeReturn,
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
