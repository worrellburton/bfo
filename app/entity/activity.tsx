import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../auth";
import { useEntity } from "./context";
import { Button, Empty, ErrorLine, Icon, Section, useTone, type IconName } from "./ui";

/**
 * Activity tab: everything that happened to the entity, newest first. Edits,
 * uploads and filings by people; Palm moving a filing along; paper mail from
 * Stable; invitations. Kept by the server as each change is written
 * (lib/activity.ts), so it's the same for everyone.
 */

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

const ICON: Record<string, IconName> = {
  created: "plus",
  edit: "edit",
  owners: "plus",
  upload: "upload",
  delete: "trash",
  rename: "rename",
  filed: "doc",
  unfiled: "doc",
  address: "mail",
  palm: "sparkle",
  state: "link",
  check: "check",
  agreement: "doc",
  mail: "mail",
  access: "link",
};

const SOURCE: Record<ActivityItem["source"], string> = { user: "", palm: "Palm", stable: "Stable", system: "BFO" };
const PAGE = 50;

const dayLabel = (d: Date) => {
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function ActivityTab() {
  const { page, asset } = useEntity();
  const t = useTone();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const fetchPage = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams({ path: `assets/${page.id}`, view: "activity" });
      if (before) q.set("before", before);
      const r = await authFetch(`/api/tree?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load the activity.");
      return (j.activity ?? []) as ActivityItem[];
    },
    [page.id]
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

  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Grouped by day, newest first.
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const item of items ?? []) {
    const label = dayLabel(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  const dotCls = (s: ActivityItem["source"]) =>
    s === "palm"
      ? t.dark ? "bg-[#818cf8]/15 text-[#a5b4fc] ring-[#818cf8]/25" : "bg-indigo-50 text-indigo-600 ring-indigo-100"
      : s === "stable"
        ? t.dark ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" : "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : t.dark ? "bg-white/[0.05] text-gray-300 ring-white/[0.08]" : "bg-gray-50 text-gray-600 ring-gray-200";

  return (
    <Section
      title="Activity"
      info="Every change to this entity, who made it and when: edits, uploads and filings in BFO, Palm moving its filings along, and paper mail Stable received for it. Edits one person makes within a few minutes of each other show as one line."
      actions={<Button icon="refresh" onClick={() => void load()}>Refresh</Button>}
    >
      {error && <div className="px-5 pt-3"><ErrorLine>{error}</ErrorLine></div>}
      {items === null ? (
        <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Loading…</p>
      ) : !items.length ? (
        <Empty>Nothing yet. Changes to this entity show up here from now on.</Empty>
      ) : (
        <div className="px-5 py-2">
          {groups.map((g) => (
            <div key={g.label} className="py-2">
              <p className={`pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${t.faint}`}>{g.label}</p>
              <ol className="relative">
                {g.items.map((item, i) => {
                  const fields = item.detail?.fields?.filter((f) => f.from !== null || f.to !== null) ?? [];
                  const names = item.detail?.names && item.detail.names.length > 1 ? item.detail.names : [];
                  const extra = fields.length > 0 || names.length > 0 || !!item.detail?.owners?.length || !!item.detail?.reason;
                  const isOpen = open.has(item.id);
                  const who = item.actor_name || SOURCE[item.source] || "Someone";
                  return (
                    <li key={item.id} className="relative flex gap-3 py-2">
                      {i < g.items.length - 1 && <span className={`absolute left-[13px] top-[34px] bottom-[-6px] w-px ${t.dark ? "bg-white/[0.06]" : "bg-gray-200"}`} aria-hidden />}
                      <span className={`relative mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full ring-1 ${dotCls(item.source)}`}>
                        <Icon name={ICON[item.kind] ?? "info"} className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className={`text-[13px] leading-snug ${t.text}`}>
                            {extra ? (
                              <button type="button" onClick={() => toggle(item.id)} className="cursor-pointer text-left hover:underline" aria-expanded={isOpen}>
                                {item.summary}
                              </button>
                            ) : (
                              item.summary
                            )}
                          </p>
                          <time dateTime={item.at} title={new Date(item.at).toLocaleString()} className={`shrink-0 text-[11.5px] tabular-nums ${t.muted}`}>
                            {time(new Date(item.at))}
                          </time>
                        </div>
                        <p className={`mt-0.5 text-[11.5px] ${t.muted}`}>{who}</p>
                        {extra && isOpen && (
                          <div className={`mt-2 space-y-1 rounded-lg border px-3 py-2 text-[12px] ${t.line} ${t.soft}`}>
                            {fields.map((f) => (
                              <p key={f.key} className="break-words">
                                <span className={t.muted}>{f.label}: </span>
                                {f.from !== null && <span className="line-through decoration-1 opacity-60">{f.from}</span>}
                                {f.from !== null && f.to !== null && <span className={`mx-1.5 ${t.faint}`}>→</span>}
                                {f.to !== null ? <span className={t.text}>{f.to}</span> : <span className={t.faint}>cleared</span>}
                              </p>
                            ))}
                            {names.map((n) => (
                              <p key={n} className="break-words">{n}</p>
                            ))}
                            {item.detail?.owners?.length ? <p>Now: {item.detail.owners.join(" · ")}</p> : null}
                            {item.detail?.reason && <p>{item.detail.reason}</p>}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {more && (
            <div className="py-2">
              <Button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
