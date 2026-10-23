import { Link } from "react-router";
import { ActivityTab } from "../entity/activity";
import { AgreementsTab } from "../entity/agreements";
import { ComplianceTab } from "../entity/compliance";
import { EntityProvider } from "../entity/context";
import { deriveEntity } from "../entity/derive";
import { DocumentsTab } from "../entity/documents";
import { GovernanceTab } from "../entity/governance";
import { CategoryMenu, EntityHeader } from "../entity/header";
import { ScanToast } from "../entity/overlay";
import { OverviewTab } from "../entity/overview";
import { PeopleTab } from "../entity/people";
import { isPartner } from "../auth";
import { Icon, TextButton, toneText, useTone } from "../entity/ui";
import { useEntityPage } from "../entity/use-entity";

export function meta() {
  return [{ title: "BFO - Entity" }];
}

/**
 * An entity: its card on top, a category menu, then the category's page.
 * All state and actions live in useEntityPage (app/entity/use-entity.tsx);
 * the views in app/entity/* render them.
 */
export default function AssetDetail() {
  const page = useEntityPage();
  const t = useTone();

  // A failed load says so (the store also retries it on its next poll).
  if (page.loadError && !page.asset) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl border px-5 py-5 text-[12.5px] ${t.surface}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className={toneText("warn", t.dark)}>Couldn't load this entity.</span>
          <TextButton onClick={page.retryLoad}>Try again</TextButton>
        </div>
      </div>
    );
  }

  if (page.loading) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className={`flex items-center gap-2.5 rounded-2xl border px-5 py-5 text-[12.5px] ${t.surface} ${t.muted}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[#818cf8] motion-safe:animate-pulse" />
          Loading entity…
        </div>
      </div>
    );
  }

  const asset = page.asset;
  if (!asset) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div className={`rounded-2xl border px-5 py-5 ${t.surface}`}>
          <Link to="/assets" className={`inline-flex items-center gap-1 text-[12px] ${t.muted}`}>
            <Icon name="chevronLeft" className="h-3 w-3" strokeWidth={2.25} />
            Entities
          </Link>
          <p className={`mt-3 text-[14px] ${t.soft}`}>Entity not found.</p>
        </div>
      </div>
    );
  }

  const view = deriveEntity({
    asset,
    docs: page.docs,
    contracts: page.contracts,
    allAssets: page.allAssets,
    kindsFor: page.kindsFor,
    tabParam: page.tabParam,
    partner: isPartner(),
    palmMode: page.palmMode,
  });

  return (
    <EntityProvider value={{ page, view, asset, tabPath: page.tabPath, goToTab: page.goToTab }}>
      {/* Keyed by entity, so local view state (open lists, errors) starts fresh on another entity. */}
      <div key={page.id} className="mx-auto max-w-[1400px] space-y-4">
        <EntityHeader />
        <CategoryMenu />
        {view.tab === "overview" && <OverviewTab />}
        {view.tab === "documents" && <DocumentsTab />}
        {view.tab === "people" && <PeopleTab />}
        {view.tab === "compliance" && <ComplianceTab />}
        {view.tab === "agreements" && <AgreementsTab />}
        {view.tab === "governance" && <GovernanceTab />}
        {view.tab === "activity" && <ActivityTab />}
        <ScanToast />
      </div>
    </EntityProvider>
  );
}
