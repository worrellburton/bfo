import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  AiNote,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  ChoiceTiles,
  Count,
  DateInput,
  DateText,
  Dialog,
  Disclosure,
  Empty,
  ErrorPage,
  Field,
  FilterChip,
  Icon,
  ICON_NAMES,
  IconButton,
  InfoToggle,
  Input,
  Keycap,
  LegalLinks,
  LinkButton,
  List,
  ListRow,
  Menu,
  Money,
  MoneyInput,
  MultiSelect,
  Page,
  PageHeader,
  Popover,
  Row,
  Rows,
  SearchField,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  Status,
  Switch,
  Table,
  Tabs,
  Textarea,
  TextLink,
  Toolbar,
  Tooltip,
  confirm,
  cx,
  format,
  toast,
  useDocumentTitle,
  type Column,
  type MenuItem,
} from "../ui";

export function meta() {
  return [{ title: "Design system · BFO" }];
}

/**
 * Development only (app/routes.ts registers it outside production): every
 * token and component of the design system (docs/DESIGN.md, app/ui) in every
 * state, in the current theme, for the designer to judge the system itself.
 * Made-up records only. The tour captures it as "design-system".
 */

const SURFACES = ["page", "raised", "sunken", "overlay", "field", "hover", "selected"];
const INKS = ["ink", "ink-2", "ink-3", "ink-disabled", "ink-inverse"];
const LINES = ["line", "line-strong", "edge"];
const ACCENTS = ["accent", "accent-hover", "accent-tint", "on-accent", "primary-hover", "primary-pressed"];
const STATUS = ["positive", "positive-tint", "negative", "negative-tint", "warning", "warning-tint", "info", "info-tint", "danger", "danger-hover", "on-danger"];
const CHARTS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-other"];
const OTHER = ["scrim", "paper", "brand-ivory", "brand-ink", "door", "door-ink", "door-ink-2", "door-ink-3", "door-edge"];
const TYPE = [
  ["caption", "12/16 · timestamps, column heads, counts"],
  ["small", "13/18 · secondary lines, labels, hints"],
  ["body", "14/20 desktop, 15/22 touch · rows, values, buttons"],
  ["field", "14/20 desktop, 16/22 touch · text in inputs"],
  ["reading", "16/26 · Terms, Privacy, mail bodies, notes"],
  ["section", "15/20 600 · card titles"],
  ["title", "17/22 600 · dialog and sheet titles"],
  ["heading", "22/28 600 · page titles, KPI values"],
  ["display", "28/34 600 · the one headline figure"],
] as const;
const TYPE_CLASS: Record<string, string> = {
  caption: "text-caption",
  small: "text-small",
  body: "text-body",
  field: "text-field",
  reading: "text-reading",
  section: "text-section",
  title: "text-title",
  heading: "text-heading",
  display: "text-display",
};
const TEXT_TOKENS = ["ink", "ink-2", "ink-3", "accent", "positive", "negative", "warning", "info", "edge"];

const STATES = ["Arizona", "California", "Colorado", "Delaware", "Florida", "Georgia", "Illinois", "Nevada", "New York", "Texas", "Utah", "Washington", "Wyoming"];

type Txn = { id: string; payee: string; account: string; entity: string; date: string; amount: number };
const TXNS: Txn[] = [
  { id: "t1", payee: "Harbor Light Utilities", account: "6200 Utilities", entity: "Northwind Holdings, LLC", date: "2026-11-04", amount: -184.2 },
  { id: "t2", payee: "Rent from Unit 4", account: "4000 Rental income", entity: "Northwind Holdings, LLC", date: "2026-11-03", amount: 2450 },
  { id: "t3", payee: "Cedar & Pine Legal", account: "6100 Professional fees", entity: "Alder Family Trust", date: "2026-11-01", amount: -1250 },
  { id: "t4", payee: "Quarterly estimate", account: "6700 Taxes and licenses", entity: "Alder Family Trust", date: "2026-10-15", amount: -3200 },
];

function hexToRgb(v: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number | null {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return null;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The current theme's value of each token, read from CSS so the page shows what the theme really uses. */
function useTokens(names: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.querySelector("[data-design-root]") ?? document.documentElement);
      setValues(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--color-${n}`).trim()])));
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join()]);
  return values;
}

function Section({ id, title, children, note }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${id}-h`} className="text-title text-ink">
          {title}
        </h2>
        {note && <p className="mt-1 max-w-[68ch] text-small text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, block = false }: { label: string; children: ReactNode; block?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-ink-3">{label}</span>
      {block ? children : <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

function Swatches({ names, values }: { names: string[]; values: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {names.map((n) => (
        <div key={n} className="flex items-center gap-3 rounded-card border border-line bg-raised p-2">
          <span className="size-10 shrink-0 rounded-control border border-line" style={{ background: `var(--color-${n})` }} />
          <span className="min-w-0">
            <span className="block truncate text-small font-medium text-ink">{n}</span>
            <span className="block truncate font-mono text-caption text-ink-2">{values[n] || "—"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DesignReference() {
  useDocumentTitle("Design system");
  const { tab } = useParams();
  const allColours = useMemo(() => [...SURFACES, ...INKS, ...LINES, ...ACCENTS, ...STATUS, ...CHARTS, ...OTHER], []);
  const values = useTokens(allColours);

  const [text, setText] = useState("Northwind Holdings, LLC");
  const [ein, setEin] = useState("123-45-6789");
  const [amount, setAmount] = useState<number | null>(1250);
  const [when, setWhen] = useState<string | null>("2026-11-06");
  const [notes, setNotes] = useState("Notes grow from three lines to ten, then scroll.");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<string | null>("Nevada");
  const [states, setStates] = useState<string[]>(["Arizona", "Nevada"]);
  const [view, setView] = useState<"list" | "cards" | "map">("list");
  const [period, setPeriod] = useState<"30" | "90" | "all">("90");
  const [agree, setAgree] = useState(false);
  const [mode, setMode] = useState<"plain" | "game" | null>(null);
  const [role, setRole] = useState<"member" | "viewer" | "admin">("member");
  const [push, setPush] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set(["t2"]));
  const [dialog, setDialog] = useState<null | "sm" | "md" | "lg">(null);
  const [sheet, setSheet] = useState<null | "bottom" | "full" | "right">(null);
  const [draft, setDraft] = useState("");
  const [selectedRow, setSelectedRow] = useState(true);

  const menu: MenuItem[] = [
    { group: "Record" },
    { label: "Rename…", icon: "edit", onSelect: () => toast({ message: "Renamed Northwind Holdings, LLC" }) },
    { label: "Download a copy", icon: "download", hint: "PDF", onSelect: () => undefined },
    { label: "Copy link", icon: "copy", onSelect: () => toast({ message: "Copied the link" }) },
    { label: "Sync records", icon: "sync", disabled: true, disabledReason: "Already up to date", onSelect: () => undefined },
    { divider: true },
    {
      label: "Delete rule",
      icon: "trash",
      danger: true,
      onSelect: () =>
        void confirm({
          title: "Delete this rule?",
          object: { name: "Harbor Light Utilities", detail: "Created Mar 3 · matches 48 transactions" },
          message: "Future syncs stop applying it. Transactions it already filed keep their account.",
          irreversible: true,
          confirmLabel: "Delete rule",
          tone: "danger",
        }),
    },
  ];
  const sortMenu: MenuItem[] = [
    { label: "Newest first", checked: true, onSelect: () => undefined },
    { label: "Oldest first", checked: false, onSelect: () => undefined },
    { label: "Largest amount", checked: false, onSelect: () => undefined },
  ];

  const columns: Column<Txn>[] = [
    { key: "payee", header: "Payee", render: (r) => r.payee, sort: (a, b) => a.payee.localeCompare(b.payee) },
    { key: "account", header: "Account", width: "200px", render: (r) => <span className="text-ink-2">{r.account}</span> },
    { key: "date", header: "Date", width: "110px", render: (r) => <DateText value={r.date} />, sort: (a, b) => a.date.localeCompare(b.date) },
    { key: "amount", header: "Amount", align: "right", width: "140px", render: (r) => <Money value={r.amount} sign="always" tone="in" />, sort: (a, b) => a.amount - b.amount },
  ];
  const net = TXNS.reduce((s, t) => s + t.amount, 0);

  if (!import.meta.env.DEV) return null;

  return (
    <div data-design-root className="ds min-h-dvh bg-page px-(--gutter) pt-8 pb-24 text-body text-ink">
      <Page
        width="workspace"
        header={
          <PageHeader
            title="Design system"
            context={`Tokens and components in the ${typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark"} theme · docs/DESIGN.md`}
            back={{ to: "/home", label: "Home" }}
            menu={menu.slice(1, 4)}
            secondary={<Button icon="download">Export</Button>}
            create={{ label: "Add owner", onClick: () => setDialog("md") }}
          />
        }
      >
        <Tabs
          label="Sections"
          items={[
            { to: "/design", label: "Overview", end: true },
            { to: "/design/documents", label: "Documents", count: 2 },
            { to: "/design/owners", label: "Owners" },
            { to: "/design/compliance", label: "Compliance", count: 1 },
            { to: "/design/activity", label: "Activity" },
          ]}
        />
        {tab && <Banner tone="info">The tab bar follows the URL; this is the “{tab}” tab of the reference page.</Banner>}

        <Section id="colour" title="Colour" note="Semantic tokens only. Values read live from the stylesheet for the current theme.">
          <Specimen label="Surfaces" block>
            <Swatches names={SURFACES} values={values} />
          </Specimen>
          <Specimen label="Ink" block>
            <Swatches names={INKS} values={values} />
          </Specimen>
          <Specimen label="Lines" block>
            <Swatches names={LINES} values={values} />
          </Specimen>
          <Specimen label="Accent and the primary button" block>
            <Swatches names={ACCENTS} values={values} />
          </Specimen>
          <Specimen label="Status" block>
            <Swatches names={STATUS} values={values} />
          </Specimen>
          <Specimen label="Charts" block>
            <Swatches names={CHARTS} values={values} />
          </Specimen>
          <Specimen label="Other" block>
            <Swatches names={OTHER} values={values} />
          </Specimen>
          <Card title="Measured contrast" info="WCAG 2 ratios computed in the browser from the values above. Text tokens need 4.5:1, edge needs 3:1." flush>
            <div className="overflow-x-auto">
              <table className="w-full text-small tabular-nums">
                <thead>
                  <tr className="text-caption font-medium text-ink-2">
                    <th className="h-8 border-b border-line-strong pl-5 text-left">Token</th>
                    {SURFACES.map((s) => (
                      <th key={s} className="h-8 border-b border-line-strong px-3 text-right">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEXT_TOKENS.map((t) => (
                    <tr key={t}>
                      <th scope="row" className="h-10 border-b border-line pl-5 text-left font-medium" style={{ color: `var(--color-${t})` }}>
                        {t}
                      </th>
                      {SURFACES.map((s) => {
                        const r = ratio(values[t] ?? "", values[s] ?? "");
                        const need = t === "edge" ? 3 : 4.5;
                        return (
                          <td key={s} className="h-10 border-b border-line px-3 text-right" style={{ background: `var(--color-${s})`, color: `var(--color-${t})` }}>
                            {r ? r.toFixed(2) : "—"}
                            {r !== null && r < need && <span className="ml-1 text-negative">fails</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        <Section id="type" title="Type" note="Geist for everything; Geist Mono only for identifiers read aloud; Playfair only for the wordmark. Nothing below 12px; weights 400, 500, 600.">
          <Card flush>
            <Rows>
              {TYPE.map(([name, use]) => (
                <div key={name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                  <span className="w-[96px] shrink-0 font-mono text-caption text-ink-3">{name}</span>
                  <span className={cx(TYPE_CLASS[name], "min-w-0 flex-1 text-ink")}>Northwind Holdings, LLC $12,480.00</span>
                  <span className="text-caption text-ink-2">{use}</span>
                </div>
              ))}
              <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="w-[96px] shrink-0 font-mono text-caption text-ink-3">mono</span>
                <span className="font-mono text-body text-ink">EIN 12-3456789 · code 482 913</span>
              </div>
              <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="w-[96px] shrink-0 font-mono text-caption text-ink-3">brand</span>
                <span className="font-brand text-heading text-ink">BFO</span>
              </div>
            </Rows>
          </Card>
        </Section>

        <Section id="shape" title="Spacing, shape and depth" note="A 4px grid; four radii and full; borders over shadows; elevation only on what floats.">
          <div className="flex flex-wrap items-end gap-3">
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
              <div key={n} className="flex flex-col items-center gap-1">
                <span className="w-4 rounded-mark bg-accent" style={{ height: n * 4 }} />
                <span className="text-caption text-ink-2 tabular-nums">{n * 4}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              ["rounded-mark", "mark 4"],
              ["rounded-control", "control 8"],
              ["rounded-card", "card 12"],
              ["rounded-dialog", "dialog 16"],
              ["rounded-full", "full"],
            ].map(([c, l]) => (
              <div key={c} className="flex flex-col items-center gap-2">
                <span className={cx("size-16 border border-edge bg-raised", c)} />
                <span className="text-caption text-ink-2">{l}</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-2">
              <span className="size-16 rounded-card border border-line bg-raised" />
              <span className="text-caption text-ink-2">card: line, no shadow</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="size-16 rounded-control border border-edge bg-overlay shadow-(--elevation-1)" />
              <span className="text-caption text-ink-2">elevation-1</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="size-16 rounded-card border border-line-strong bg-overlay shadow-(--elevation-2)" />
              <span className="text-caption text-ink-2">elevation-2</span>
            </div>
          </div>
        </Section>

        <Section id="icons" title="Icons" note="One set, stroke 1.75, 16px desktop and 20px touch, in currentColor. Each glyph means one thing everywhere.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {ICON_NAMES.map((n) => (
              <div key={n} className="flex flex-col items-center gap-2 rounded-control border border-line bg-raised py-3 text-ink">
                <Icon name={n} />
                <span className="text-caption text-ink-2">{n}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="buttons" title="Buttons and links" note="Ink is the primary; danger only inside a confirm. Disabled is a fill and a label, never opacity, and says why.">
          {(["primary", "secondary", "quiet", "danger"] as const).map((v) => (
            <Specimen key={v} label={v}>
              <Button variant={v} size="sm">
                Add owner
              </Button>
              <Button variant={v}>Add owner</Button>
              <Button variant={v} size="lg">
                Add owner
              </Button>
              <Button variant={v} icon="plus">
                Add owner
              </Button>
              <Button variant={v} disabled disabledReason="Add a name to continue">
                Add owner
              </Button>
              <Button variant={v} busy busyLabel="Saving…">
                Save changes
              </Button>
            </Specimen>
          ))}
          <Specimen label="States, forced (rest, hover, pressed, focus)">
            <Button>Rest</Button>
            <Button className="bg-hover">Hover</Button>
            <Button className="bg-selected">Pressed</Button>
            <Button className="outline-2 outline-offset-2 outline-accent outline-solid">Focus</Button>
            <Button variant="primary" className="bg-primary-hover">
              Primary hover
            </Button>
            <Button variant="primary" className="bg-primary-pressed">
              Primary pressed
            </Button>
          </Specimen>
          <p className="text-small text-ink-2">Add a name to continue</p>
          <Specimen label="IconButton">
            <IconButton icon="more" label="More actions" />
            <IconButton icon="copy" label="Copy" />
            <IconButton icon="edit" label="Edit" variant="secondary" />
            <IconButton icon="sidebar" label="Collapse sidebar" pressed />
            <IconButton icon="trash" label="Delete" disabled />
            <IconButton icon="x" label="Close" size="md" />
          </Specimen>
          <Specimen label="Links">
            <span className="max-w-[40ch] text-body text-ink">
              Read the{" "}
              <TextLink to="/legal/privacy" inline>
                Privacy policy
              </TextLink>{" "}
              before you continue.
            </span>
            <TextLink to="/design">View all</TextLink>
            <TextLink to="https://example.com">Open in the registry</TextLink>
            <LinkButton to="/design" icon="external">
              Open in Books
            </LinkButton>
          </Specimen>
        </Section>

        <Section id="fields" title="Fields" note="Label above, hint or error below. 16px text on touch. The border never changes on focus; the ring does.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" hint="As filed with the state.">
              <Input value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label="EIN" error={format.looksLikeSsn(ein) ? "That looks like a Social Security number. Enter the entity's EIN (12-3456789)." : undefined}>
              <Input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" className="tabular-nums" />
            </Field>
            <Field label="Monthly fee">
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Ownership" optional>
              <Input suffix="%" defaultValue="50" inputMode="decimal" className="tabular-nums" />
            </Field>
            <Field label="Effective date" hint="Type a date or choose one.">
              <DateInput value={when} onChange={setWhen} />
            </Field>
            <Field label="State file number" hint="Disabled until a state is chosen">
              <Input disabled defaultValue="" placeholder="E0000000" />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <SearchField value={query} onChange={setQuery} placeholder="Search entities" label="Search entities" />
            </div>
          </div>
        </Section>

        <Section
          id="choosing"
          title="Choosing"
          note="Pick by kind: Select for long lists, Segmented for two to five views, Checkbox, ChoiceTiles for choices with consequences, Switch for an immediate setting."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="State">
              <Select label="State" value={state} onChange={setState} options={STATES.map((s) => ({ value: s, label: s }))} footnote="Only states where an entity is registered." />
            </Field>
            <Field label="Registered in">
              <MultiSelect label="Registered in" value={states} onChange={setStates} options={STATES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Entity type">
              <Select
                label="Entity type"
                value={null}
                onChange={() => undefined}
                options={[
                  { value: "llc", label: "LLC" },
                  { value: "trust", label: "Trust" },
                  { value: "corp", label: "Corporation", disabled: true, disabledReason: "Not offered" },
                ]}
              />
            </Field>
            <Field label="Account">
              <Select label="Account" value="6100" disabled onChange={() => undefined} options={[{ value: "6100", label: "6100 Professional fees" }]} />
            </Field>
          </div>
          <Specimen label="Segmented">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "List" },
                { value: "cards", label: "Cards" },
                { value: "map", label: "Map" },
              ]}
            />
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "30", label: "30D" },
                { value: "90", label: "90D" },
                { value: "all", label: "All" },
              ]}
            />
          </Specimen>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox checked={agree} onChange={setAgree} label="I agree to use electronic records and signatures for this document" />
            <Checkbox checked onChange={() => undefined} label="Include closed entities" hint="Dissolved and archived ones too." />
            <Checkbox checked="mixed" onChange={() => undefined} label="Select all" />
            <Checkbox checked={false} disabled onChange={() => undefined} label="Send a copy to the signer" hint="Add their email to continue" />
          </div>
          <ChoiceTiles
            label="How will they sign?"
            value={mode}
            onChange={setMode}
            options={[
              { value: "plain", title: "Plain", description: "Read the document, then sign where it's marked." },
              { value: "game", title: "Guided", description: "A short walk-through before the signature." },
            ]}
          />
          <ChoiceTiles
            label="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: "viewer", title: "Viewer", description: "Can see everything; changes nothing." },
              { value: "member", title: "Member", description: "Can add and edit records." },
              { value: "admin", title: "Admin", description: "Can also manage people and access." },
            ]}
          />
          <Card flush>
            <div className="divide-y divide-line px-5">
              <Switch checked={push} onChange={setPush} label="Push notifications" hint="New mail and texts on this device." />
              <Switch checked={false} onChange={() => undefined} label="Lock-screen previews" />
              <Switch checked disabled onChange={() => undefined} label="Daily summary" hint="Set by the office" />
            </div>
          </Card>
        </Section>

        <Section id="status" title="Status, badges and counts" note="Exceptions only; normal shows nothing. A dot and a word; colour never alone.">
          <Specimen label="Status">
            <Status tone="neutral">Draft</Status>
            <Status tone="positive">Filed</Status>
            <Status tone="warning">Needs review</Status>
            <Status tone="negative">Overdue</Status>
            <Status tone="info">Scheduled</Status>
          </Specimen>
          <Specimen label="Status with shapes (grids)">
            <Status tone="neutral" shape>
              Not started
            </Status>
            <Status tone="positive" shape>
              Done
            </Status>
            <Status tone="warning" shape>
              Needs you
            </Status>
            <Status tone="negative" shape>
              Failed
            </Status>
            <Status tone="info" shape>
              Test mode
            </Status>
          </Specimen>
          <Specimen label="Badge, Count, FilterChip">
            <Badge>LLC</Badge>
            <Badge>Trust</Badge>
            <Badge icon="lock">Staff only</Badge>
            <Count n={3} />
            <Count n={2} tone="attention" />
            <Count n={148} />
            <FilterChip onRemove={() => undefined}>Nevada</FilterChip>
            <FilterChip onRemove={() => undefined}>Needs review</FilterChip>
          </Specimen>
        </Section>

        <Section id="cards" title="Cards, rows and lists">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card
              title="Addresses"
              count={2}
              countTone="attention"
              info="Where the state, the IRS and the banks send mail for this entity."
              action={
                <Button variant="quiet" size="sm" icon="edit">
                  Edit
                </Button>
              }
              menu={menu}
            >
              <Rows>
                <Row label="Principal office">1200 Example Avenue, Suite 400, Springfield, NV 89000</Row>
                <Row label="Mailing address" hint="Each piece is scanned into Paper mail.">
                  Same as the principal office
                </Row>
                <Row
                  label="Registered agent"
                  action={
                    <Button variant="quiet" size="sm">
                      Change
                    </Button>
                  }
                >
                  Example Registered Agents, Inc.
                </Row>
                <Row label="State file number" />
              </Rows>
              <CardSection title="Address change" action={<TextLink to="/design">Open checklist</TextLink>}>
                <p className="text-body text-ink-2">Moved Oct 20, 2026. Three places still have the old address.</p>
              </CardSection>
            </Card>
            <div className="flex flex-col gap-4">
              <Card title="Notes" staffOnly>
                <Empty>No notes yet. Notes you add to an entity appear here; only staff can see them.</Empty>
              </Card>
              <Card title="Mail" footer={<TextLink to="/design">View all</TextLink>}>
                <p className="text-body text-ink-2">No mail yet.</p>
              </Card>
            </div>
          </div>
          <Card title="Accounts" count={4} flush>
            <List label="Accounts">
              <ListRow
                title="Operating checking •• 4821"
                secondary="Northwind Holdings, LLC"
                trailing={<Money value={12480} />}
                to="/design"
                leading={<Avatar name="Harbor Bank" kind="organisation" size={32} />}
              />
              <ListRow
                title="Reserve savings •• 1102"
                secondary="Northwind Holdings, LLC · as of Nov 6, 7:00 AM"
                trailing={<Money value={50000} />}
                to="/design"
                leading={<Avatar name="Harbor Bank" kind="organisation" size={32} />}
              />
              <ListRow
                title="Business card •• 0091"
                secondary="Owed"
                trailing={<Money value={2140} />}
                onClick={() => undefined}
                leading={<Avatar name="Harbor Bank" kind="organisation" size={32} />}
                menu={menu.slice(1, 4)}
                label="Business card"
              />
              <ListRow title="Overdrawn checking •• 7310" secondary="Last updated Nov 2 · Reconnect" trailing={<Money value={-45.2} className="text-negative" />} to="/design" />
            </List>
          </Card>
          <Card title="Inbox" flush>
            <List label="Messages">
              <ListRow
                unread
                title="Annual report reminder"
                secondary="Secretary of State · Your list is due Nov 30"
                meta="9:14 AM"
                onClick={() => undefined}
                leading={<Avatar name="Secretary of State" size={32} />}
              />
              <ListRow
                unread={false}
                title="Invoice 1042"
                secondary="Cedar & Pine Legal · Attached: invoice.pdf"
                meta="Yesterday"
                onClick={() => undefined}
                leading={<Avatar name="Cedar Pine" size={32} />}
              />
              <ListRow
                unread={false}
                selected={selectedRow}
                onSelect={setSelectedRow}
                title="Selected row"
                secondary="With its checkbox in selection mode"
                meta="Nov 2"
                onClick={() => undefined}
                label="Selected row"
              />
            </List>
          </Card>
        </Section>

        <Section id="table" title="Table" note="Desktop and tablet; on a phone each row becomes a ListRow. Numbers right and tabular; totals foot.">
          <Toolbar
            search={<SearchField value={query} onChange={setQuery} placeholder="Search transactions" label="Search transactions" />}
            filters={
              <>
                <Select
                  size="sm"
                  label="Entity"
                  value="all"
                  onChange={() => undefined}
                  options={[
                    { value: "all", label: "All entities" },
                    { value: "nw", label: "Northwind Holdings, LLC" },
                  ]}
                />
                <Select size="sm" label="Account" value={null} placeholder="Any account" onChange={() => undefined} options={[{ value: "6100", label: "6100 Professional fees" }]} />
              </>
            }
            view={
              <Segmented
                label="Period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: "30", label: "30D" },
                  { value: "90", label: "90D" },
                  { value: "all", label: "All" },
                ]}
              />
            }
            activeFilters={[{ label: "Nevada", onRemove: () => undefined }]}
            onClearFilters={() => undefined}
          />
          <Card title="Transactions" count={TXNS.length} flush menu={sortMenu}>
            <Table
              caption="Transactions"
              columns={columns}
              rows={TXNS}
              rowKey={(r) => r.id}
              onRowClick={() => undefined}
              selection={{ selected: picked, onChange: setPicked }}
              groups={(r) => r.entity}
              groupTotal={(rows) => <Money value={rows.reduce((s, r) => s + r.amount, 0)} sign="always" />}
              totals={["Net", "", "", <Money key="n" value={net} sign="always" />]}
              phoneRow={(r) => ({ title: r.payee, secondary: `${r.account} · ${format.date(r.date)}`, trailing: <Money value={r.amount} sign="always" tone="in" /> })}
            />
          </Card>
          <Card title="Profit and loss" info="All entities · Jan 1 – Nov 5, 2026 · Cash basis" flush>
            <Table
              caption="Profit and loss"
              columns={[
                { key: "line", header: "Line", render: (r: { line: string; v: number }) => r.line },
                { key: "v", header: "Amount", align: "right", width: "160px", render: (r: { line: string; v: number }) => <Money value={r.v} precision="dollars" sign="accounting" zero="dash" /> },
              ]}
              rows={[
                { line: "Rental income", v: 24500 },
                { line: "Professional fees", v: -2140 },
                { line: "Other income", v: 0.2 },
              ]}
              rowKey={(r) => r.line}
              totals={["Net income", <Money key="t" value={22360} precision="dollars" sign="accounting" />]}
              grandTotal
              phoneRow={(r) => ({ title: r.line, trailing: <Money value={r.v} precision="dollars" sign="accounting" zero="dash" /> })}
            />
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Loading" flush>
              <Table caption="Loading" columns={columns} rows={[]} rowKey={(r) => r.id} loading phoneRow={(r) => ({ title: r.payee })} />
            </Card>
            <Card title="Filtered to nothing" flush>
              <Table
                caption="Empty"
                columns={columns.slice(0, 2)}
                rows={[]}
                rowKey={(r) => r.id}
                phoneRow={(r) => ({ title: r.payee })}
                empty={
                  <Empty
                    action={
                      <Button variant="quiet" size="sm">
                        Clear filters
                      </Button>
                    }
                  >
                    No transactions match “Alder”.
                  </Empty>
                }
              />
            </Card>
          </div>
        </Section>

        <Section id="states" title="States" note="Loading, empty and errors are designed. Skeletons appear after 300ms; errors are banners in the region that failed.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Empty card">
              <Empty
                size="page"
                title="No notes yet"
                action={
                  <Button variant="primary" icon="plus">
                    Add note
                  </Button>
                }
              >
                Notes you add to an entity appear here; only staff can see them.
              </Empty>
            </Card>
            <div className="flex flex-col gap-3">
              <Skeleton kind="card" rows={3} />
              <Skeleton kind="line" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Banner tone="info">Test mode: nothing is filed or charged.</Banner>
            <Banner
              tone="warning"
              title="2 accounts haven’t updated since Nov 3."
              action={
                <Button variant="quiet" size="sm">
                  Reconnect
                </Button>
              }
            >
              Balances on this page may be out of date.
            </Banner>
            <Banner
              tone="negative"
              action={
                <Button variant="quiet" size="sm" icon="sync">
                  Try again
                </Button>
              }
              onDismiss={() => undefined}
            >
              Couldn’t load the balances. Check your connection and try again.
            </Banner>
            <Banner tone="positive">The state approved the filing.</Banner>
          </div>
          <Card>
            <Disclosure label="Done" count={10}>
              <p className="py-2 text-body text-ink-2">Ten finished items sit here.</p>
            </Disclosure>
            <Disclosure label="Technical details">
              <pre className="mt-2 rounded-card bg-sunken p-3 font-mono text-caption text-ink-2">request 7f3a·c201 · status 502</pre>
            </Disclosure>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-body">
              Record score
              <InfoToggle label="About the record score">The share of facts and documents on file for this entity, out of those it should have.</InfoToggle>
            </div>
            <div className="mt-3 flex items-center gap-2 text-small text-ink-2">
              <Spinner /> Syncing…
            </div>
          </Card>
        </Section>

        <Section id="numbers" title="Numbers, dates and masks" note="Everything through app/ui/format.ts: one convention per context.">
          <Card>
            <Rows>
              <Row label="Ledger">
                <span className="flex flex-wrap gap-4">
                  <Money value={-84} sign="always" />
                  <Money value={1250} sign="always" tone="in" />
                  <Money value={0} zero="dash" />
                </span>
              </Row>
              <Row label="Balances">
                <span className="flex flex-wrap gap-4">
                  <Money value={12480} />
                  <Money value={-45.2} />
                  <Money value={0} />
                </span>
              </Row>
              <Row label="Statements">
                <span className="flex flex-wrap gap-4">
                  <Money value={-2140} precision="dollars" sign="accounting" />
                  <Money value={18240} precision="dollars" sign="accounting" />
                  <Money value={0} precision="dollars" zero="dash" />
                </span>
              </Row>
              <Row label="KPI and change">
                <span className="flex flex-wrap items-baseline gap-4">
                  <span className="text-heading">
                    <Money value={18240} precision="dollars" />
                  </span>
                  <Money value={-18240} precision="dollars" tone="direction" />
                  <span className="text-ink-2">
                    ↓ {format.money(2800, { precision: "dollars" })} · {format.percent(12.5)}
                  </span>
                </span>
              </Row>
              <Row label="Compact (chips, axes)">
                <span className="flex flex-wrap gap-4">
                  <Money value={240000} precision="compact" />
                  <Money value={1200000} precision="compact" />
                  <Money value={-12000} precision="compact" />
                </span>
              </Row>
              <Row label="Percentages">
                {format.percent(50, { decimals: 2, trim: true })} · {format.percent(33.3333, { decimals: 2, trim: true })} · {format.percent(8.64)} · {format.percent(4.25, { decimals: 2 })} ·{" "}
                {format.percent(76, { decimals: 0 })}
              </Row>
              <Row label="Counts">
                {format.count(1, "entity", "entities")} · {format.count(3, "entity", "entities")} · {format.count(0, "entity", "entities")} · {format.list(["Alex", "Sam", "Jo"])}
              </Row>
              <Row label="Dates">
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <DateText value="2026-11-06" />
                  <DateText value="2025-11-06" />
                  <DateText value="2026-11-06" style="medium" />
                  <DateText value="2026-11-06" style="long" />
                  <DateText value="2026-11-06T20:14:00Z" style="audit" />
                </span>
              </Row>
              <Row label="Ranges">
                {format.dateRange("2026-11-01", "2026-11-05")} · {format.dateRange("2026-01-01", "2026-11-05")} · {format.dateRange("2025-12-15", "2026-01-10")}
              </Row>
              <Row label="Freshness">{format.asOf("2026-11-06T14:00:00Z", { time: true })}</Row>
              <Row label="Masks">
                {format.maskAccount("4821")} · {format.maskEin("12-3456789")} · {format.maskTin("123-45-6789", "ssn")} · {format.phone("+15550100142")}
              </Row>
              <Row label="Accounts">
                {format.accountLabel({ name: "BUSINESS_PREMIER_CHECKING", mask: "4821" })} · {format.accountType("roth")} · {format.accountType("401k")}
              </Row>
            </Rows>
          </Card>
        </Section>

        <Section id="pieces" title="Small pieces">
          <Specimen label="Avatar">
            <Avatar name="Alex Rivera" size={24} />
            <Avatar name="Alex Rivera" size={32} />
            <Avatar name="Alex Rivera" size={40} />
            <Avatar name="Northwind Holdings, LLC" kind="organisation" size={40} />
          </Specimen>
          <Specimen label="Tooltip and keycaps (fine pointer only)">
            <Tooltip label="Opens the palette">
              <Button size="sm" icon="search">
                Search
              </Button>
            </Tooltip>
            <Keycap keys={["mod", "K"]} />
            <Keycap keys={["G", "H"]} sequence />
            <Keycap keys={["["]} />
          </Specimen>
          <Specimen label="AI labels">
            <AiNote kind="read" source="Operating Agreement" />
            <AiNote kind="drafted" />
            <AiNote kind="summary" />
          </Specimen>
          <Specimen label="Legal links">
            <LegalLinks />
            <span className="rounded-card bg-door px-4 py-3">
              <LegalLinks tone="door" />
            </span>
          </Specimen>
        </Section>

        <Section id="overlay-kinds" title="Overlays" note="One manager: a stack, focus in and back, Escape and the scrim on the top only, the app inert behind a modal, the Ask button hidden.">
          <Specimen label="Dialog and sheet">
            <Button onClick={() => setDialog("sm")}>Dialog sm</Button>
            <Button onClick={() => setDialog("md")}>Form dialog</Button>
            <Button onClick={() => setDialog("lg")}>Dialog lg</Button>
            <Button onClick={() => setSheet("bottom")}>Bottom sheet</Button>
            <Button onClick={() => setSheet("full")}>Full-screen sheet</Button>
            <Button onClick={() => setSheet("right")}>Side sheet</Button>
          </Specimen>
          <Specimen label="Menu and popover">
            <Menu label="Actions" items={menu} trigger={<Button icon="more">Actions</Button>} />
            <Menu label="Sort" items={sortMenu} trigger={<Button>Sort</Button>} />
            <Popover label="Filter" trigger={<Button icon="filter">Filter</Button>}>
              <div className="flex flex-col gap-4">
                <Field label="State">
                  <Select label="State" value={state} onChange={setState} options={STATES.map((s) => ({ value: s, label: s }))} />
                </Field>
                <Checkbox checked={agree} onChange={setAgree} label="Only entities that need me" />
              </div>
            </Popover>
            <Popover
              label="About the score"
              trigger={
                <Button variant="quiet" icon="info">
                  About the score
                </Button>
              }
            >
              <p className="text-body text-ink-2">The share of facts and documents on file, out of those this kind of entity should have.</p>
            </Popover>
          </Specimen>
          <Specimen label="confirm()">
            <Button onClick={() => void confirm({ title: "Mark this filing as reviewed?", confirmLabel: "Mark reviewed" })}>Routine</Button>
            <Button
              onClick={() =>
                void confirm({
                  title: "File the annual report?",
                  object: { name: "Northwind Holdings, LLC", detail: "Nevada · annual list for 2026" },
                  message: "We send it to the state now. The state usually answers within 2 business days.",
                  receipt: {
                    lines: [
                      { label: "State fee", cents: 15000 },
                      { label: "Service fee", cents: 4500, estimate: true },
                    ],
                    mode: "test",
                  },
                  confirmLabel: "File for $195.00",
                  tone: "commit",
                })
              }
            >
              Commit with receipt
            </Button>
            <Button
              onClick={() =>
                void confirm({
                  title: "Delete this entity?",
                  object: { name: "Northwind Holdings, LLC", detail: "LLC · Nevada · 4 documents" },
                  message: "Its documents, owners and activity are removed for everyone.",
                  irreversible: true,
                  typeToConfirm: "Northwind Holdings, LLC",
                  alternative: { label: "Archive instead", value: "archive" },
                  confirmLabel: "Delete entity",
                  tone: "danger",
                })
              }
            >
              Danger, typed
            </Button>
            <Button
              onClick={() =>
                void confirm({
                  title: "File under 6100 Professional fees?",
                  scope: {
                    label: "Which transactions",
                    options: [
                      { value: "one", title: "Only this transaction", description: "Nov 4 · $184.20" },
                      { value: "all", title: "All 48 from this vendor", description: "Dec 2024 – Nov 2026, and new ones" },
                    ],
                  },
                  confirmLabel: "Refile",
                })
              }
            >
              With a scope
            </Button>
            <Button
              onClick={() =>
                void confirm({
                  title: "Delete 9 messages?",
                  object: {
                    names: [
                      "Invoice 1042",
                      "Annual report reminder",
                      "Welcome to the portal",
                      "Statement for October",
                      "Receipt 88",
                      "Lease renewal",
                      "Meeting notes",
                      "Quarterly estimate",
                      "Insurance card",
                    ],
                  },
                  irreversible: true,
                  confirmLabel: "Delete messages",
                  tone: "danger",
                })
              }
            >
              Many names
            </Button>
            <Button onClick={() => toast({ message: "Archived 3 messages", action: { label: "Undo", run: () => toast({ message: "Restored 3 messages" }) } })}>Toast with Undo</Button>
          </Specimen>
        </Section>

        <Section id="pages" title="Page templates">
          <Card title="Not found" flush>
            <div className="px-5 pb-8">
              <ErrorPage kind="not-found" home="/design" />
            </div>
          </Card>
        </Section>
      </Page>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        size={dialog ?? "md"}
        title={dialog === "md" ? "Add owner: Northwind Holdings, LLC" : dialog === "lg" ? "Results" : "Rename this rule"}
        description={dialog === "md" ? "Owners appear on the entity's record and its filings." : undefined}
        dirty={dialog === "md" && draft.trim().length > 0}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={dialog === "md" && !draft.trim()} disabledReason="Add a name to continue" onClick={() => setDialog(null)}>
              {dialog === "md" ? "Add owner" : "Save"}
            </Button>
          </>
        }
      >
        {dialog === "md" ? (
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Alex Rivera" />
            </Field>
            <Field label="Share" optional>
              <Input suffix="%" inputMode="decimal" />
            </Field>
            <Field label="State">
              <Select label="State" value={state} onChange={setState} options={STATES.map((s) => ({ value: s, label: s }))} />
            </Field>
          </div>
        ) : dialog === "lg" ? (
          <p className="text-body text-ink-2">Long content scrolls inside the dialog while the header and footer stay put.</p>
        ) : (
          <Field label="Rule name">
            <Input defaultValue="Harbor Light Utilities" />
          </Field>
        )}
      </Dialog>

      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        side={sheet ?? "bottom"}
        title={sheet === "full" ? "New message" : sheet === "right" ? "Harbor Light Utilities" : "Sort"}
        action={
          <Button variant="primary" onClick={() => setSheet(null)}>
            Send
          </Button>
        }
        footer={
          sheet === "full" ? undefined : (
            <>
              <Button onClick={() => setSheet(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => setSheet(null)}>
                Done
              </Button>
            </>
          )
        }
      >
        {sheet === "right" ? (
          <Rows>
            <Row label="Amount">
              <Money value={-184.2} />
            </Row>
            <Row label="Account">6200 Utilities</Row>
            <Row label="Date">
              <DateText value="2026-11-04" style="medium" />
            </Row>
          </Rows>
        ) : sheet === "full" ? (
          <div className="flex flex-col gap-4">
            <Field label="To">
              <Input placeholder="name@example.com" />
            </Field>
            <Field label="Message">
              <Textarea />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col">
            {["Newest first", "Oldest first", "Largest amount"].map((l) => (
              <button key={l} type="button" className="flex min-h-[48px] items-center rounded-control px-2 text-left text-body text-ink hover:bg-hover">
                {l}
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
