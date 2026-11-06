import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authFetch } from "../auth";
import { Menu, displayName, entityLabel } from "../books-shared";
import { Banner, Card, Checkbox, Empty, Page, PageHeader, SearchField, Table, Toolbar, format, useDocumentTitle, type Column } from "../ui";

export function meta() {
  return [{ title: "Vendors · BFO" }];
}

type Vendor = { vendor: string; count: number; monthly: number[]; spent: number; received: number; last_date: string; entities: string[] };
type Entity = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A payee that is one of the family's own entities (payments between them aren't vendor spend). */
function relatedEntity(vendor: string, entities: Entity[]): Entity | null {
  const v = vendor.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  for (const e of entities) {
    const words = entityLabel(e.name)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !["llc", "trust", "family", "revocable", "the", "inc", "pllc"].includes(w));
    if (words.length && words.every((w) => v.includes(w))) return e;
  }
  return null;
}

/**
 * Everyone the family paid this year, by month: the payee, what was spent
 * each month, refunds, and when they were last paid. Payees that are the
 * family's own entities are marked and left out of the totals unless asked
 * for. A row opens the vendor.
 */
export default function BooksVendors() {
  useDocumentTitle("Vendors");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entity, setEntity] = useState("all");
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [q, setQ] = useState(params.get("q") ?? "");
  const [error, setError] = useState("");
  const [related, setRelated] = useState(false);

  useEffect(() => {
    void authFetch("/api/books/data?report=meta")
      .then(async (r) => r.ok && setEntities((await r.json()).entities ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setVendors(null);
    setError("");
    void (async () => {
      try {
        const qs = new URLSearchParams({ report: "vendors", year });
        if (entity !== "all") qs.set("entity", entity);
        const res = await authFetch(`/api/books/data?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || "Couldn’t load vendors.");
        setVendors(data.vendors ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t load vendors.");
        setVendors([]);
      }
    })();
  }, [entity, year]);

  const now = new Date();
  const current = Number(year) === thisYear;
  const lastMonth = current ? now.getMonth() : 11;
  const relOf = useMemo(() => new Map((vendors ?? []).map((v) => [v.vendor, relatedEntity(v.vendor, entities)])), [vendors, entities]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (vendors ?? []).filter((v) => (related || !relOf.get(v.vendor)) && (!needle || v.vendor.toLowerCase().includes(needle) || displayName(v.vendor).toLowerCase().includes(needle)));
  }, [vendors, q, related, relOf]);
  const relatedCount = (vendors ?? []).filter((v) => relOf.get(v.vendor)).length;
  const totals = useMemo(() => {
    const monthly = Array(12).fill(0) as number[];
    let spent = 0;
    let received = 0;
    for (const v of shown) {
      spent += v.spent;
      received += v.received;
      v.monthly.forEach((m, i) => (monthly[i] += m));
    }
    return { monthly, spent, received };
  }, [shown]);
  const anyRefunds = shown.some((v) => v.received > 0);
  const dollars = (n: number) => format.money(n, { precision: "dollars", zero: "dash" });

  const columns: Column<Vendor>[] = [
    {
      key: "vendor",
      header: "Vendor",
      width: "240px",
      sort: (a, b) => displayName(a.vendor).localeCompare(displayName(b.vendor)),
      render: (v) => (
        <span>
          {displayName(v.vendor)}
          {relOf.get(v.vendor) && <span className="ml-2 text-small text-ink-2">Related party</span>}
        </span>
      ),
    },
    ...MONTHS.map((m, i): Column<Vendor> => ({
      key: m,
      header: current && i === lastMonth ? `${m} (to ${now.getDate()})` : m,
      align: "right",
      width: current && i === lastMonth ? "104px" : "84px",
      render: (v) => (i > lastMonth ? "" : <span className={v.monthly[i] ? "" : "text-ink-3"}>{dollars(v.monthly[i])}</span>),
    })),
    { key: "spent", header: "Spent", align: "right", width: "104px", sort: (a, b) => a.spent - b.spent, render: (v) => <span className="font-medium">{dollars(v.spent)}</span> },
    ...(anyRefunds ? [{ key: "in", header: "Refunds", align: "right" as const, width: "96px", render: (v: Vendor) => (v.received ? dollars(v.received) : "") }] : []),
    {
      key: "last",
      header: "Last paid",
      width: "120px",
      sort: (a, b) => a.last_date.localeCompare(b.last_date),
      render: (v) => <span className="text-ink-2">{format.date(v.last_date, "short")}</span>,
    },
  ];
  const yearLabel = current ? `${year} to ${format.date(now, "short")}` : year;
  const context = vendors
    ? `${format.count(shown.length, "vendor", "vendors")} · ${format.money(totals.spent, { precision: "dollars" })} paid in ${yearLabel}${totals.received ? ` · ${format.money(totals.received, { precision: "dollars" })} refunded` : ""}`
    : undefined;

  return (
    <Page width="full" header={<PageHeader title="Vendors" context={context} />}>
      {error && <Banner tone="negative">{error}</Banner>}
      <Card flush>
        <div className="px-5 py-3 touch:px-4">
          <Toolbar
            search={
              <SearchField
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setParams(v ? { q: v } : {}, { replace: true });
                }}
                placeholder="Search vendors"
                label="Search vendors"
              />
            }
            filters={
              <>
                <Menu value={entity} label="Entity" onChange={setEntity} options={[{ value: "all", label: "All entities" }, ...entities.map((e) => ({ value: e.id, label: entityLabel(e.name) }))]} />
                <Menu value={year} label="Period" onChange={setYear} options={[0, 1, 2].map((d) => ({ value: String(thisYear - d), label: d === 0 ? `${thisYear} to date` : String(thisYear - d) }))} />
              </>
            }
          />
          {relatedCount > 0 && (
            <div className="mt-3">
              <Checkbox
                checked={related}
                onChange={setRelated}
                label={`Include the family’s own entities (${relatedCount})`}
                hint="Payments between the family’s entities need their own basis (a loan, a contribution, a distribution) and aren’t vendor spend."
              />
            </div>
          )}
        </div>
        <div className="border-t border-line">
          <Table
            caption={`Vendors, ${yearLabel}`}
            columns={columns}
            rows={shown}
            rowKey={(v) => v.vendor}
            loading={!vendors}
            stickyFirst
            onRowClick={(v) => navigate(`/books/vendors/detail?name=${encodeURIComponent(v.vendor)}`)}
            totals={[
              `Total, ${format.count(shown.length, "vendor", "vendors")}`,
              ...MONTHS.map((_, i) => (i > lastMonth ? "" : dollars(totals.monthly[i]))),
              dollars(totals.spent),
              ...(anyRefunds ? [dollars(totals.received)] : []),
              "",
            ]}
            phoneRow={(v) => ({
              title: displayName(v.vendor),
              secondary: [
                `Last paid ${format.date(v.last_date, "short")}`,
                v.entities.length > 1 ? `${v.entities.length} entities` : v.entities[0] ? entityLabel(v.entities[0]) : null,
                relOf.get(v.vendor) ? "Related party" : null,
              ]
                .filter(Boolean)
                .join(" · "),
              trailing: dollars(v.spent),
              to: `/books/vendors/detail?name=${encodeURIComponent(v.vendor)}`,
            })}
            empty={<Empty size="section">{vendors && vendors.length ? `No vendors match “${q}”.` : "No vendor payments in this period yet."}</Empty>}
          />
        </div>
      </Card>
      <p className="text-small text-ink-2">
        Spent counts posted money out filed as income or expense; transfers between the family’s own accounts aren’t vendors. Taxes paid are included, so the total won’t match the expenses on the
        profit and loss.
      </p>
    </Page>
  );
}
