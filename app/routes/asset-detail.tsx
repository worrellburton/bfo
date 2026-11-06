/**
 * An entity: its page header, the section tabs, then the section. All state
 * and actions live in useEntityPage (app/entity/use-entity.tsx); the views
 * in app/entity/* render them. The page is on the design system (<Page>,
 * docs/DESIGN.md §14.6), so every tab inside it is in the `ds` scope.
 */

import { Navigate } from "react-router";
import { ActivityTab } from "../entity/activity";
import { AgreementsTab } from "../entity/agreements";
import { ComplianceTab } from "../entity/compliance";
import { EntityProvider } from "../entity/context";
import { deriveEntity } from "../entity/derive";
import { DocumentsTab } from "../entity/documents";
import { GovernanceTab } from "../entity/governance";
import { CategoryMenu, EntityHeader, PalmSyncResults } from "../entity/header";
import { ScanToast } from "../entity/overlay";
import { OverviewTab } from "../entity/overview";
import { PeopleTab } from "../entity/people";
import { isPartner } from "../auth";
import { Banner, Button, Empty, LinkButton, Page, Skeleton, useDocumentTitle } from "../ui";
import { useEntityPage } from "../entity/use-entity";

export function meta() {
  return [{ title: "Entity · BFO" }];
}

const SECTION: Record<string, string> = {
  overview: "Overview",
  documents: "Documents",
  people: "Owners",
  compliance: "Compliance",
  agreements: "Contracts",
  governance: "Governance",
  activity: "Activity",
};

export default function AssetDetail() {
  const page = useEntityPage();
  // "Northwind Holdings, LLC · Documents · Entities · BFO" (§5.5); Overview adds no section.
  const section = page.tabParam && page.tabParam !== "overview" ? (SECTION[page.tabParam] ?? null) : null;
  useDocumentTitle(page.asset?.name ?? (page.loading ? null : "Entity"), section, "Entities");

  // A failed load says so (the store also retries it on its next poll).
  if (page.loadError && !page.asset) {
    return (
      <Page width="workspace">
        <Banner tone="negative" action={<Button variant="quiet" onClick={page.retryLoad}>Try again</Button>}>
          Couldn’t load this entity. Check your connection and try again.
        </Banner>
      </Page>
    );
  }

  if (page.loading) {
    return (
      <Page width="workspace">
        <Skeleton kind="line" />
        <Skeleton kind="card" rows={4} />
      </Page>
    );
  }

  const asset = page.asset;
  if (!asset) {
    return (
      <Page width="reading">
        <Empty size="page" title="We couldn’t find that entity" action={<LinkButton to="/assets">Go to Entities</LinkButton>}>
          It may have been removed, or the link is mistyped.
        </Empty>
      </Page>
    );
  }

  const partner = isPartner();
  // An invited owner's page starts on Documents: give it its own address, so the tab shows as current.
  if (partner && !page.tabParam) return <Navigate to={page.tabPath("documents")} replace />;

  const view = deriveEntity({
    asset,
    docs: page.docs,
    contracts: page.contracts,
    allAssets: page.allAssets,
    kindsFor: page.kindsFor,
    tabParam: page.tabParam,
    partner,
    palmMode: page.palmMode,
    id: page.id,
  });

  return (
    <EntityProvider value={{ page, view, asset, tabPath: page.tabPath, goToTab: page.goToTab }}>
      {/* Keyed by entity, so local view state (open lists, errors) starts fresh on another entity. */}
      <Page key={page.id} width="workspace" header={<EntityHeader />} className={page.editing ? "pb-[96px]" : undefined}>
        <div className="flex flex-col gap-6">
          {asset.archived && (
            <Banner tone="info" title="Archived.">
              It’s read-only and left out of the lists; everything on it is kept. It still exists with the state until it’s dissolved.
            </Banner>
          )}
          <PalmSyncResults />
          <CategoryMenu />
          {view.tab === "overview" && <OverviewTab />}
          {view.tab === "documents" && <DocumentsTab />}
          {view.tab === "people" && <PeopleTab />}
          {view.tab === "compliance" && <ComplianceTab />}
          {view.tab === "agreements" && <AgreementsTab />}
          {view.tab === "governance" && <GovernanceTab />}
          {view.tab === "activity" && <ActivityTab />}
        </div>
        <ScanToast />
      </Page>
    </EntityProvider>
  );
}
