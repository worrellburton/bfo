/**
 * Activity tab: everything that happened to the entity, newest first, as an
 * audit trail: edits with before and after, uploads, documents removed and
 * restored, filings, decisions and their reasons, facts read by AI and who
 * accepted them, the state's record, Palm, Stable, shared links, invites.
 * Kept by the server as each change is written (lib/activity.ts), append
 * only, so it's the same for everyone.
 *
 * Grouped by day; a run of one person's edits within a few minutes shows as
 * one line that opens to each. Filters by what and who, and exports the
 * whole log (or the filtered part) as CSV.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../auth";
import { Banner, Button, Card, Icon, Select, Skeleton, cx, format, type IconName } from "../ui";
import { useEntity } from "./context";

type Field = { key: string; label: string; from: string | null; to: string | null };
type ActivityItem = {
  id: number;
  at: string;
  actor_name: string | null;
  source: "user" | "palm" | "stable" | "system";
  kind: string;
  summary: string;
  detail: { fields?: Field[]; names?: string[]; owners?: string[]; reason?: string } | null;
};

/** One glyph per kind of event (§8.0: each glyph means one thing). */
const ICON: Record<string, IconName> = {
  created: "plus",
  edit: "edit",
  owners: "user",
  upload: "upload",
  delete: "trash",
  rename: "edit",
  filed: "doc",
  unfiled: "doc",
  address: "mail",
  palm: "doc",
  state: "building",
  decision: "building",
  check: "check",
  agreement: "doc",
  governance: "user",
  mail: "mail",
  access: "user",
  share: "link",
  ai: "sparkle",
  archive: "lock",
  hold: "lock",
  closing: "calendar",
};

/** What the filter offers, by kind. */
const GROUPS: { value: string; label: string; kinds: string[] }[] = [
  { value: "all", label: "Everything", kinds: [] },
  { value: "edits", label: "Edits to the record", kinds: ["edit", "created", "owners", "governance", "agreement", "decision", "archive", "closing"] },
  { value: "documents", label: "Documents", kinds: ["upload", "delete", "rename", "filed", "unfiled", "share", "hold"] },
  { value: "state", label: "The state and Palm", kinds: ["state", "palm", "mail", "address"] },
  { value: "ai", label: "Read by AI", kinds: ["ai", "check"] },
  { value: "access", label: "Access", kinds: ["access"] },
];

const SOURCE: Record<ActivityItem["source"], string> = { user: "Someone in the office", palm: "Palm", stable: "Stable", system: "BFO, automatically" };
const PAGE = 50;
const MAX_EXPORT = 5000;
const GROUP_MS = 15 * 60 * 1000;

const who = (i: ActivityItem) => i.actor_name || SOURCE[i.source];
/** "5:30 AM MST": times in an audit trail carry their zone (§10.5). */
const clock = (iso: string) => format.dateTime(iso, { zone: true }).split(", ").slice(2).join(", ");

/** Consecutive edits by one person within a few minutes, shown as one line (the rows stay separate). */
type Shown = { lead: ActivityItem; runs: ActivityItem[] };
function group(items: ActivityItem[]): Shown[] {
  const out: Shown[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    const prev = last?.runs[last.runs.length - 1];
    if (last && it.kind === "edit" && last.lead.kind === "edit" && who(it) === who(last.lead) && prev && Date.parse(prev.at) - Date.parse(it.at) < GROUP_MS) last.runs.push(it);
    else out.push({ lead: it, runs: [it] });
  }
  return out;
}

/** The log as CSV: one row per entry, with each field's before and after. */
export function activityCsv(items: ActivityItem[], entity: string): string {
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["Entity", "When (UTC)", "When (local)", "Who", "Source", "Kind", "What", "Details"];
  const rows = items.map((i) => {
    const fields = (i.detail?.fields ?? []).map((f) => `${f.label}: ${f.from ?? "blank"} -> ${f.to ?? "blank"}`);
    const more = [...fields, ...(i.detail?.names ?? []), ...(i.detail?.owners?.length ? [`Now: ${i.detail.owners.join("; ")}`] : []), ...(i.detail?.reason ? [`Why: ${i.detail.reason}`] : [])].join(" | ");
    return [entity, i.at, format.dateTime(i.at, { zone: true }), who(i), i.source, i.kind, i.summary, more].map(q).join(",");
  });
  return [head.map(q).join(","), ...rows].join("\n");
}

export function ActivityTab() {
  const { page, asset } = useEntity();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [what, setWhat] = useState("all");
  const [person, setPerson] = useState("all");

  const fetchPage = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams({ path: `assets/${page.id}`, view: "activity" });
      if (before) q.set("before", before);
      const r = await authFetch(`/api/tree?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("The activity didn’t load. Check your connection and try again.");
      return (j.activity ?? []) as ActivityItem[];
    },
    [page.id],
  );

  const load = useCallback(async () => {
    try {
      const list = await fetchPage();
      setItems(list);
      setMore(list.length === PAGE);
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setItems((x) => x ?? []);
    }
  }, [fetchPage]);

  // Again whenever the record changes (a save here, or someone else's), once the write has landed.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      void load();
      return;
    }
    const timer = setTimeout(() => void load(), 1200);
    return () => clearTimeout(timer);
  }, [asset, load]);

  async function loadMore() {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const next = await fetchPage(items[items.length - 1].at);
      setItems([...items, ...next.filter((n) => !items.some((i) => i.id === n.id))]);
      setMore(next.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /** Every entry (up to MAX_EXPORT), then the filters, as a CSV download. */
  async function exportCsv() {
    setExporting(true);
    try {
      let all = items ?? [];
      let next = more;
      while (next && all.length < MAX_EXPORT) {
        const page2 = await fetchPage(all[all.length - 1]?.at);
        all = [...all, ...page2.filter((n) => !all.some((i) => i.id === n.id))];
        next = page2.length === PAGE;
      }
      setItems(all);
      setMore(next);
      const blob = new Blob([activityCsv(all.filter(matches), asset.name)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${asset.name} activity ${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const kinds = GROUPS.find((g) => g.value === what)?.kinds ?? [];
  const matches = (i: ActivityItem) => (!kinds.length || kinds.includes(i.kind)) && (person === "all" || who(i) === person);
  const people = useMemo(() => [...new Set((items ?? []).map(who))].sort(), [items]);
  const shown = (items ?? []).filter(matches);
  const days: { label: string; rows: Shown[] }[] = [];
  for (const it of group(shown)) {
    const label = format.date(it.lead.at, "medium");
    const last = days[days.length - 1];
    if (last?.label === label) last.rows.push(it);
    else days.push({ label, rows: [it] });
  }
  const oldest = items?.length && !more ? items[items.length - 1].at : null;

  return (
    <Card
      title="Activity"
      info="Each change to this entity and who made it: edits with before and after, documents, decisions and their reasons, facts read by AI and who accepted them, the state's record, Palm and Stable. Entries are only ever added; none is changed or removed."
      action={
        items?.length ? (
          <Button size="sm" icon="download" busy={exporting} busyLabel="Exporting…" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        ) : undefined
      }
    >
      {error && (
        <Banner tone="negative" className="mb-4" action={<Button variant="quiet" onClick={() => void load()}>Try again</Button>}>
          {error}
        </Banner>
      )}
      {items === null ? (
        <Skeleton kind="rows" rows={6} />
      ) : !items.length ? (
        <p className="text-body text-ink-2">Nothing yet. Changes to this entity show up here as they’re made.</p>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <div className="w-full sm:w-[220px]">
              <Select label="Show" value={what} onChange={setWhat} options={GROUPS.map((g) => ({ value: g.value, label: g.label }))} />
            </div>
            <div className="w-full sm:w-[220px]">
              <Select label="By" value={person} onChange={setPerson} options={[{ value: "all", label: "Anyone" }, ...people.map((p) => ({ value: p, label: p }))]} />
            </div>
          </div>
          {!shown.length && <p className="text-body text-ink-2">Nothing matches these filters{more ? " in what’s loaded" : ""}.</p>}
          {days.map((d) => (
            <section key={d.label} aria-label={d.label}>
              <h3 className="pb-1 text-small font-medium text-ink-2">{d.label}</h3>
              <ol className="flex flex-col">
                {d.rows.map((row) => (
                  <Entry key={row.lead.id} row={row} />
                ))}
              </ol>
            </section>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            {more && (
              <Button busy={loadingMore} busyLabel="Loading…" onClick={() => void loadMore()}>
                Show older
              </Button>
            )}
            {oldest && <p className="text-small text-ink-3">The oldest entry is from {format.date(oldest, "medium")}.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

/** One entry (or a run of edits): icon, what happened, who and when; it opens to the details when it has them. */
function Entry({ row }: { row: Shown }) {
  const [open, setOpen] = useState(false);
  const it = row.lead;
  const many = row.runs.length > 1;
  const fields = (r: ActivityItem) => r.detail?.fields?.filter((f) => f.from !== null || f.to !== null) ?? [];
  const has = (r: ActivityItem) => fields(r).length > 0 || (r.detail?.names?.length ?? 0) > 1 || !!r.detail?.owners?.length || !!r.detail?.reason;
  const opens = many || row.runs.some(has);
  const summary = many ? `${row.runs.length} edits to the record` : it.summary;
  const body = (
    <>
      <span className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
        <Icon name={ICON[it.kind] ?? "info"} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-pretty text-ink">{summary}</span>
        <span className="block text-small text-ink-2 tabular-nums">
          {who(it)} · {clock(many ? row.runs[row.runs.length - 1].at : it.at)}
          {many ? `–${clock(it.at)}` : ""}
        </span>
      </span>
      {opens && (
        <span className="mt-[6px] shrink-0 text-ink-3">
          <span className={cx("inline-flex transition-transform duration-(--dur-3)", open && "rotate-90")}>
            <Icon name="chevronRight" size={16} />
          </span>
        </span>
      )}
    </>
  );
  return (
    <li className="border-t border-line first:border-t-0">
      {opens ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-3 rounded-control py-3 text-left hover:bg-hover touch:min-h-[48px]">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 py-3">{body}</div>
      )}
      {open && (
        <div className="ds-reveal mb-3 ml-[40px] flex flex-col gap-2 text-small text-ink-2">
          {row.runs.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              {many && (
                <p className="text-ink">
                  {r.summary} <span className="text-ink-3">· {clock(r.at)}</span>
                </p>
              )}
              {fields(r).map((f) => (
                <p key={f.key} className="break-words">
                  {f.label}: {f.from ?? "blank"} → <span className="text-ink">{f.to ?? "cleared"}</span>
                </p>
              ))}
              {(r.detail?.names?.length ?? 0) > 1 && r.detail!.names!.map((n) => <p key={n} className="break-words">{n}</p>)}
              {r.detail?.owners?.length ? <p>Now: {r.detail.owners.join(" · ")}</p> : null}
              {r.detail?.reason && <p className="text-ink">Why: {r.detail.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
