/**
 * Entities: every entity the family holds, as an ownership tree (list),
 * cards or a map. Each row says what the entity is, its tax class and the
 * return that means, who owns it, its core documents and how complete its
 * records are ("Records": facts and documents on file; state standing and
 * deadlines are Entity compliance's). Rare and billed jobs (Palm, the
 * document scan) live in the header's "…" and confirm their cost first.
 * Partners see only the entities shared with them. The arithmetic is in
 * assets-model.ts; the dialogs in assets-dialogs.tsx.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { dollars, stateRecordCents } from "../../lib/palm-pricing";
import { statesToRead as readsOf, stateReadCost as readCost, type StateReadable } from "../../lib/state-reads";
import { authFetch, canWrite, getUser, isAdmin, isPartner } from "../auth";
import { entityTag, setEntityTagLocal } from "../books-shared";
import { FormEntityWizard } from "../entity/form-wizard";
import { entityType, type EntityType } from "../entity-paperwork";
import { scanAllEntities, type ScanProgress } from "../entity-scan";
import { palmCall } from "../palm";
import {
  Banner,
  Button,
  Card,
  confirm,
  Dialog,
  cx,
  Disclosure,
  Empty,
  Icon,
  IconButton,
  List,
  ListRow,
  Menu,
  MultiSelect,
  Page,
  PageHeader,
  Popover,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Toolbar,
  Tooltip,
  format,
  toast,
  useDocumentTitle,
  usePhone,
  type MenuItem,
  type Option,
} from "../ui";
import { NewEntityDialog, InitialsDialog, OwnerDialog, PalmChecksDialog, PalmResultsDialog, type PalmChecksPlan, type PalmMode, type PalmRunResult } from "./assets-dialogs";
import {
  formedIn,
  inStates,
  initialsClash,
  isDissolved,
  isForming,
  missingGroups,
  missingLine,
  NO_STATE,
  ownerPhrase,
  ownersOf,
  recordsOf,
  sharedInitials,
  stateChoices,
  taxLabel,
  taxLine,
  trustPeople,
  TYPE_LABEL,
  type EntityRec,
  type Records,
  type TaxLine,
} from "./assets-model";
import { EstateMapView } from "./estate-map";

/** The state records an entity's sync reads, and what that costs (lib/state-reads.ts). */
const statesToRead = (a: Rec) => readsOf(a as unknown as StateReadable);
const stateReadCost = (a: Rec, mode: PalmMode | null, o: { freshMs: number }) => readCost(a as unknown as StateReadable, mode, o);

/** Kept in step with lib/palm-sync.ts SYNC_FRESH_MS (that module is server-only). */
const SYNC_FRESH_MS = 24 * 60 * 60 * 1000;
/** A state record older than this is stale (DESIGN.md §10.7). */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function meta() {
  return [{ title: "Entities · BFO" }];
}

/** The record as the page reads it, with the documents the scan would read. */
type Rec = EntityRec & {
  createdAt?: number;
  stateLink?: string;
  fileNumber?: string;
  documents?: Record<string, { storagePath?: string; contentType?: string; factsCheckedAt?: number; classReadAt?: number } | null>;
  stateRecord?: { mode?: string; checkedAt?: number };
};

type View = "list" | "cards" | "map";
type SortKey = "name" | "tax" | "owner" | "docs" | "records";

const VIEW_KEY = "bfo-entities-view";
function storedView(): View | null {
  try {
    const s = localStorage.getItem(VIEW_KEY);
    if (s === "list" || s === "cards" || s === "map") return s;
  } catch {
    /* private mode: the device default */
  }
  return null;
}

/** The four documents every company keeps, as Books and the cards count them. */
const CORE_DOCS = [
  { key: "articles", label: "Formation filing" },
  { key: "einLetter", label: "EIN letter" },
  { key: "operatingAgreement", label: "Operating agreement" },
  { key: "w9", label: "Form W-9" },
] as const;

const TONE_GLYPH: Record<Records["tone"], { icon: "check" | "warning" | "x" | null; cls: string; word: string }> = {
  positive: { icon: "check", cls: "text-positive", word: "complete" },
  neutral: { icon: null, cls: "", word: "" },
  warning: { icon: "warning", cls: "text-warning", word: "needs attention" },
  negative: { icon: "x", cls: "text-negative", word: "records disagree" },
};

// ── Page ─────────────────────────────────────────────────────────────────

export default function Assets() {
  // An invited entity owner sees only the entities shared with them.
  if (isPartner()) return <PartnerEntities />;
  return <StaffAssets />;
}

/** A partner's front page: the entities they've been given, each with what's on file. */
function PartnerEntities() {
  useDocumentTitle("Entities");
  const [list, setList] = useState<{ id: string; name: string; type: EntityType; state: string; files: number }[] | null>(null);
  const first = getUser()?.name?.trim().split(/\s+/)[0];
  useEffect(() => {
    let live = true;
    void (async () => {
      const { db, ref, get } = await import("../store");
      const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string; type?: string; state?: string; documents?: Record<string, unknown> }>;
      if (live)
        setList(
          Object.entries(all)
            .map(([id, a]) => ({ id, name: a?.name ?? "Entity", type: entityType(a ?? {}), state: formedIn(a ?? {}), files: Object.keys(a?.documents ?? {}).length }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
    })().catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Page width="reading" header={<PageHeader title="Entities" context={`${first ? `Welcome, ${first}. ` : ""}The entities you're part of. Open one to see its documents and who owns it.`} />}>
      {list === null ? (
        <Skeleton kind="card" rows={3} />
      ) : list.length === 0 ? (
        <Empty title="Nothing shared yet" size="page">
          When the office shares an entity with you, it appears here.
        </Empty>
      ) : (
        <Card flush>
          <List label="Your entities">
            {list.map((e) => (
              <ListRow key={e.id} to={`/assets/${e.id}`} title={e.name} secondary={[TYPE_LABEL[e.type], e.state, e.files ? format.count(e.files, "document") : ""].filter(Boolean).join(" · ")} />
            ))}
          </List>
        </Card>
      )}
    </Page>
  );
}

function StaffAssets() {
  useDocumentTitle("Entities");
  const navigate = useNavigate();
  const phone = usePhone();
  const writer = canWrite();
  const admin = isAdmin();
  const [assets, setAssets] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  // ── Dialogs ────────────────────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [ownerFor, setOwnerFor] = useState<{ id: string; proposed?: string } | null>(null);
  const [initialsFor, setInitialsFor] = useState<string | null>(null);
  const [recordsFor, setRecordsFor] = useState<string | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);
  const [run, setRun] = useState<{ title: string; results: PalmRunResult[]; error?: string; mode?: PalmMode } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  // "+ Entity" elsewhere lands here with ?new=1; the estate map's old address with ?view=map.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const wantNew = params.get("new") === "1";
    const wantView = params.get("view");
    if (!wantNew && !wantView) return;
    if (wantNew) setNewOpen(true);
    if (wantView === "map" || wantView === "list" || wantView === "cards") setChoice(wantView);
    const next = new URLSearchParams(params);
    next.delete("new");
    next.delete("view");
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const { db, ref, onValue } = await import("../store");
      if (!alive) return;
      unsubscribe = onValue(
        ref(db, "assets"),
        (snap) => {
          const data = (snap.val() ?? {}) as Record<string, Omit<Rec, "id">>;
          setAssets(
            Object.entries(data)
              .filter(([, v]) => v && typeof v.name === "string")
              .map(([id, v]) => ({ ...v, id, type: entityType(v) })),
          );
          setLoadError("");
          setLoading(false);
        },
        () => {
          setLoadError("Couldn't load the entities. Check your connection and try again.");
          setLoading(false);
        },
      );
    })().catch(() => {
      if (!alive) return;
      setLoadError("Couldn't load the entities. Check your connection and try again.");
      setLoading(false);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [reload]);

  // ── View, filters, sort ────────────────────────────────────────────────
  const [choice, setChoice] = useState<View | null>(storedView);
  const view: View = choice ?? (phone ? "list" : "map");
  const pickView = (v: View) => {
    setChoice(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just doesn't persist */
    }
  };
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<"all" | EntityType>("all");
  const [stateF, setStateF] = useState<string[]>([]);
  const [recordsF, setRecordsF] = useState<"all" | "incomplete" | "disagree">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ── Derived ────────────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const records = useMemo(() => new Map(assets.map((a) => [a.id, recordsOf(a, byId)])), [assets, byId]);
  const taxes = useMemo(() => new Map(assets.map((a) => [a.id, taxLine(a, byId)])), [assets, byId]);
  const owners = useMemo(() => new Map(assets.map((a) => [a.id, ownersOf(a, byId)])), [assets, byId]);
  const tagOf = (a: { name: string; initials?: string }) => a.initials || entityTag(a.name);
  const tags = assets.map((a) => ({ id: a.id, name: a.name, tag: tagOf(a) }));
  const shared = sharedInitials(tags);
  const live = assets.filter((a) => !isDissolved(a));
  const dissolved = assets.length - live.length;
  const choices = useMemo(() => stateChoices(assets), [assets]);
  const rec = (a: Rec) => records.get(a.id)!;

  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const matches = (a: Rec) => {
    if (typeF !== "all" && a.type !== typeF) return false;
    if (!inStates(a, stateF)) return false;
    if (recordsF === "incomplete" && rec(a).score >= 100) return false;
    if (recordsF === "disagree" && !rec(a).conflicts.length) return false;
    if (!needle) return true;
    return (
      a.name.toLowerCase().includes(needle) ||
      formedIn(a).toLowerCase().includes(needle) ||
      (a.state ?? "").toLowerCase().includes(needle) ||
      (digits.length >= 2 && (a.ein ?? "").replace(/\D/g, "").includes(digits)) ||
      tagOf(a).toLowerCase() === needle
    );
  };
  const matched = assets.filter(matches);
  const matchedIds = new Set(matched.map((a) => a.id));
  const filtered = !!needle || typeF !== "all" || stateF.length > 0 || recordsF !== "all";
  const clearFilters = () => {
    setQ("");
    setTypeF("all");
    setStateF([]);
    setRecordsF("all");
  };
  const incomplete = live.filter((a) => rec(a).score < 100).length;
  const disagree = live.filter((a) => rec(a).conflicts.length).length;

  const childrenOf = useMemo(() => {
    const m = new Map<string, Rec[]>();
    for (const a of assets) {
      if (!a.ownerId || a.ownerId === a.id || !byId.has(a.ownerId)) continue;
      m.set(a.ownerId, [...(m.get(a.ownerId) ?? []), a]);
    }
    return m;
  }, [assets, byId]);
  const descendants = (id: string) => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) for (const k of childrenOf.get(stack.pop()!) ?? []) if (!out.has(k.id)) (out.add(k.id), stack.push(k.id));
    return out;
  };

  const docsOn = (a: Rec) => CORE_DOCS.filter((d) => !!a[d.key as keyof Rec]).length;
  const sortText = (a: Rec): string | number => {
    switch (sort.key) {
      case "tax":
        return taxes.get(a.id)?.value ?? "";
      case "owner":
        return (owners.get(a.id)?.[0]?.name ?? trustPeople(a)) || "";
      case "docs":
        return docsOn(a);
      case "records":
        return rec(a).score;
      default:
        return a.name;
    }
  };
  const cmp = (a: Rec, b: Rec) => {
    const x = sortText(a);
    const y = sortText(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir || a.name.localeCompare(b.name);
    if (!x !== !y) return x ? -1 : 1;
    return String(x).localeCompare(String(y)) * sort.dir || a.name.localeCompare(b.name);
  };
  const tree = sort.key === "name";

  type Row = { a: Rec; depth: number; kids: number; context: boolean };
  // The tree: matches plus their owners (shown for context), in pre-order.
  // Cycles (A owns B owns A) fall back to roots so nothing hides.
  const buildRows = (respectCollapse: boolean): Row[] => {
    if (!tree) return [...matched].sort(cmp).map((a) => ({ a, depth: 0, kids: 0, context: false }));
    const visible = new Set<string>();
    for (const a of matched) {
      let cur: Rec | undefined = a;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        visible.add(cur.id);
        cur = cur.ownerId && cur.ownerId !== cur.id ? byId.get(cur.ownerId) : undefined;
      }
    }
    const kidsOf = (id: string) => (childrenOf.get(id) ?? []).filter((k) => visible.has(k.id)).sort(cmp);
    const out: Row[] = [];
    const seen = new Set<string>();
    const walk = (a: Rec, depth: number) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      const kids = kidsOf(a.id);
      out.push({ a, depth, kids: kids.length, context: !matchedIds.has(a.id) });
      if (respectCollapse && collapsed.has(a.id)) {
        for (const d of descendants(a.id)) seen.add(d);
        return;
      }
      for (const k of kids) walk(k, depth + 1);
    };
    const inSet = assets.filter((a) => visible.has(a.id)).sort(cmp);
    for (const r of inSet.filter((a) => !a.ownerId || a.ownerId === a.id || !visible.has(a.ownerId))) walk(r, 0);
    for (const a of inSet) if (!seen.has(a.id)) walk(a, 0);
    return out;
  };
  const rows = buildRows(true);
  const cardRows = buildRows(false).filter((r) => !r.context);
  const parentIds = [...childrenOf.keys()];
  const toggle = (id: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(id);
      if (open === undefined ? isOpen : !open) next.add(id);
      else next.delete(id);
      return next;
    });

  // ── EINs: masked; staff may show one for 30 seconds ────────────────────
  const [shown, setShown] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!shown.size) return;
    const t = window.setTimeout(() => setShown(new Map([...shown].filter(([, until]) => until > Date.now()))), 1000);
    return () => window.clearTimeout(t);
  }, [shown]);
  const reveal = (id: string) => setShown((m) => new Map(m).set(id, Date.now() + 30_000));
  const copyEin = (ein: string) =>
    void navigator.clipboard
      ?.writeText(ein)
      .then(() => toast({ message: "Copied the EIN" }))
      .catch(() => toast({ message: "Couldn't copy. Select the EIN and copy it instead." }));

  // ── Palm ───────────────────────────────────────────────────────────────
  const [palmMode, setPalmMode] = useState<PalmMode | null>(null);
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    palmCall<{ mode: PalmMode | null }>("status")
      .then((r) => alive && setPalmMode(r.mode))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [admin]);
  const palmPlan = useMemo(() => {
    const per = assets.map((a) => ({ a, cost: stateReadCost(a, palmMode, { freshMs: SYNC_FRESH_MS }) }));
    const states = per.flatMap((x) => x.cost.states.map((s) => ({ ...s, entity: x.a })));
    const withNumber = states.filter((s) => s.cents === stateRecordCents(true) && palmMode === "live").length;
    const skipped = assets.filter((a) => !statesToRead(a).length && !a.palm?.[palmMode ?? ""]);
    return {
      cents: per.reduce((n, x) => n + x.cost.cents, 0),
      states: states.length,
      withNumber,
      withoutNumber: states.length - withNumber,
      entities: per.filter((x) => x.cost.states.length || x.a.palm?.[palmMode ?? ""]).length,
      skipped,
    };
  }, [assets, palmMode]);
  const lastRead = useMemo(() => {
    const times = assets.map((a) => a.stateRecord?.checkedAt ?? 0).filter(Boolean);
    return times.length ? Math.max(...times) : null;
  }, [assets]);
  const readCount = assets.filter((a) => a.stateRecord?.checkedAt).length;
  const readable = assets.filter((a) => statesToRead(a).length).length;

  async function syncWithPalm() {
    if (!palmMode || running) return;
    const live = palmMode === "live";
    const why = (a: Rec) => (entityType(a) === "Trust" ? "a trust has no state record" : isDissolved(a) ? "dissolved" : isForming(a) ? "still being formed" : !formedIn(a) ? "no state on record" : "nothing to read");
    const skipped = palmPlan.skipped;
    const ok = await confirm({
      title: `Sync ${palmPlan.entities} of ${format.count(assets.length, "entity", "entities")} with Palm?`,
      message:
        "Reads each entity's state record in its home state and each state it's registered in. Nothing is filed. Blanks are filled and differences are flagged, with two updates: where Palm has become the agent, the agent changes to Palm, and Palm's copy of each name is set to ours.",
      details: [
        ...(skipped.length ? [`Not synced: ${format.list(skipped.slice(0, 4).map((a) => `${a.name} (${why(a)})`))}${skipped.length > 4 ? ` and ${skipped.length - 4} more` : ""}.`] : []),
        "Agent mail is saved to each entity's Documents, which anyone with access to that entity can see.",
        ...(lastRead ? [`State records last read ${format.dateTime(new Date(lastRead))}. Records read in the last day aren't read or billed again.`] : []),
        "It can take a few minutes.",
      ],
      receipt: live
        ? {
            lines: [
              ...(palmPlan.withNumber ? [{ label: `${palmPlan.withNumber} with a file number × ${format.money(stateRecordCents(true) / 100)}`, cents: palmPlan.withNumber * stateRecordCents(true), estimate: true }] : []),
              ...(palmPlan.withoutNumber ? [{ label: `${palmPlan.withoutNumber} without one × ${format.money(stateRecordCents(false) / 100)}`, cents: palmPlan.withoutNumber * stateRecordCents(false), estimate: true }] : []),
              ...(!palmPlan.states ? [{ label: "No state records to read", cents: 0 }] : []),
            ],
            mode: "live",
          }
        : { lines: [{ label: `${format.count(palmPlan.states, "state record")}`, cents: 0 }], mode: "test" },
      confirmLabel: live && palmPlan.cents ? `Sync for up to ${dollars(palmPlan.cents)}` : "Sync state records",
      tone: "commit",
    });
    if (!ok) return;
    setRunning("Syncing state records with Palm. This can take a few minutes.");
    try {
      // The mode and the approved amount travel with the request, so a switch to live (or a dearer plan) can be refused.
      const r = await authFetch("/api/palm-sync", { method: "POST", body: JSON.stringify({ mode: palmMode, maxCents: palmPlan.cents }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't sync with Palm.");
      setRun({ title: "Synced with Palm", results: j.entities ?? [], mode: j.mode });
    } catch (err) {
      setRun({ title: "Sync with Palm", results: [], error: (err as Error).message });
    } finally {
      setRunning(null);
    }
  }

  async function runPalmCheck(action: "monitor-all" | "ein-all", plan: PalmChecksPlan) {
    setChecksOpen(false);
    const title = action === "monitor-all" ? "Palm Monitor" : "EINs checked with the IRS";
    setRunning(action === "monitor-all" ? "Starting Palm Monitor on each registration." : "Checking EINs with the IRS through Palm.");
    try {
      const r = await authFetch("/api/palm-sync", { method: "POST", body: JSON.stringify({ action, mode: plan.mode, maxCents: action === "monitor-all" ? plan.monitor.cents : plan.ein.cents }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Palm didn't finish.");
      setRun({ title, results: j.entities ?? [], mode: j.mode });
    } catch (err) {
      setRun({ title, results: [], error: (err as Error).message });
    } finally {
      setRunning(null);
    }
  }

  // ── The document scan ──────────────────────────────────────────────────
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const stopScan = useRef(false);
  const unread = useMemo(() => {
    let docs = 0;
    let ents = 0;
    for (const a of assets) {
      const n = Object.values(a.documents ?? {}).filter((d) => d?.storagePath && /pdf|image\//i.test(d.contentType ?? "") && !(d.factsCheckedAt && d.classReadAt)).length;
      docs += n;
      if (n) ents++;
    }
    return { docs, ents };
  }, [assets]);

  async function scanAll() {
    const ok = await confirm({
      title: `Scan documents for ${format.count(assets.length, "entity", "entities")}?`,
      message:
        "Each document not read yet is sent to Anthropic (Claude) to be read. It's filed into its empty slot, and what it says fills blank facts; where it disagrees with the record, the difference is flagged, not written. Member lists read earlier from governing documents are read again.",
      details: [
        unread.docs ? `${format.count(unread.docs, "document")} not read yet, across ${format.count(unread.ents, "entity", "entities")}.` : "Every document has been read; only the operating agreements are checked again.",
        "It runs in this tab: keep it open until it finishes. You can stop it at any time.",
        "Each change shows in the entity's history as the document scan, started by you.",
      ],
      confirmLabel: "Scan documents",
      tone: "commit",
    });
    if (!ok) return;
    const { db, ref, get } = await import("../store");
    const all = ((await get(ref(db, "assets"))).val() ?? {}) as Parameters<typeof scanAllEntities>[0];
    stopScan.current = false;
    const extra: string[] = [];
    // The scan's writes are credited to the scan (api/tree.ts `source`), and an EIN that's
    // already another entity's (a W-9 carrying its owner's number) is left off, not written.
    const write = async (path: string, patch: Record<string, unknown>) => {
      if (stopScan.current) throw new Stopped();
      const send = (value: Record<string, unknown>) => authFetch("/api/tree", { method: "POST", body: JSON.stringify({ source: "scan", ops: [{ op: "update", path, value }] }) });
      let r = await send(patch);
      if (!r.ok && "ein" in patch) {
        const j = await r.json().catch(() => ({}));
        const { ein: _ein, ...rest } = patch;
        void _ein;
        extra.push(`${j.message ?? "An EIN read from a document wasn't recorded."} Not recorded; check the EIN letter.`);
        r = await send(rest);
      }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? "A change couldn't be saved.");
    };
    setScan({ entity: "", index: 0, total: Object.keys(all).length, step: "Starting", notes: [], done: false });
    try {
      const end = await scanAllEntities(all, write, (p) => {
        if (stopScan.current) throw new Stopped();
        setScan({ ...p, notes: [...p.notes, ...extra] });
      });
      setScan({ ...end, notes: [...end.notes, ...extra] });
    } catch (err) {
      setScan((s) => (s ? { ...s, done: true, paused: err instanceof Stopped ? "Stopped. Scan again to pick up where it left off." : `The scan stopped on an error: ${(err as Error).message} Scan again to pick up where it left off.` } : s));
    } finally {
      // The store learns of the scan's writes on its next poll; ask for it now.
      window.dispatchEvent(new Event("focus"));
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────
  const stateCount = new Set(live.map(formedIn).filter(Boolean)).size;
  const avg = live.length ? Math.round(live.reduce((s, a) => s + rec(a).score, 0) / live.length) : 0;
  const stale = lastRead != null && Date.now() - lastRead > STALE_MS;
  const context = loading ? undefined : (
    <>
      {format.count(live.length, "entity", "entities")}
      {stateCount ? ` in ${format.count(stateCount, "state")}` : ""} · records {avg}% complete on average
      {dissolved ? ` · ${dissolved} dissolved, not counted` : ""}
      {lastRead != null && (
        <span className={stale ? "text-warning" : undefined}>
          {" "}
          · state records read {format.date(new Date(lastRead))}
          {readable ? ` (${readCount} of ${readable})` : ""}
        </span>
      )}
    </>
  );
  const scanning = !!scan && !scan.done;
  const menu: MenuItem[] = [
    ...(admin && palmMode
      ? [
          {
            label: "Sync state records with Palm…",
            hint: palmMode === "test" ? "Free in test mode" : palmPlan.cents ? `About ${dollars(palmPlan.cents)}` : "Free",
            onSelect: () => void syncWithPalm(),
            disabled: !!running,
            disabledReason: "Running",
          },
          { label: "Monitor and verify with Palm…", onSelect: () => setChecksOpen(true), disabled: !!running, disabledReason: "Running" },
        ]
      : []),
    ...(writer ? [{ label: "Scan documents…", hint: unread.docs ? `${unread.docs} unread` : undefined, onSelect: () => void scanAll(), disabled: scanning, disabledReason: "Scanning" }] : []),
  ];

  // ── Row actions ────────────────────────────────────────────────────────
  const rowItems = (a: Rec): MenuItem[] => [
    ...(phone ? [{ label: "Open entity", onSelect: () => navigate(`/assets/${a.id}`) }, { label: `Records ${rec(a).score}%: what's missing`, onSelect: () => setRecordsFor(a.id) }] : []),
    ...(writer && a.ein ? [{ label: "Copy EIN", onSelect: () => copyEin(a.ein!) }] : []),
    ...(a.stateLink ? [{ label: "Open state filing", hint: "State's site", onSelect: () => window.open(a.stateLink, "_blank", "noopener,noreferrer") }] : []),
    { label: "History", onSelect: () => navigate(`/assets/${a.id}/activity`) },
    ...(writer
      ? [
          { divider: true as const },
          { label: "Edit initials…", onSelect: () => setInitialsFor(a.id) },
          ...(a.type !== "Trust" ? [{ label: "Change owner…", onSelect: () => setOwnerFor({ id: a.id }), disabled: !admin, disabledReason: "Owners and admins only" }] : []),
        ]
      : []),
  ];

  // ── Pieces ─────────────────────────────────────────────────────────────
  const mark = (a: Rec) => (
    <span aria-hidden="true" className="inline-flex h-6 min-w-[40px] shrink-0 items-center justify-center rounded-mark bg-sunken px-1 text-caption font-medium text-ink-2">
      {tagOf(a)}
    </span>
  );
  const sharedMark = (a: Rec) =>
    shared.has(a.id) ? (
      <Tooltip label={`Another entity also uses ${tagOf(a)}. Change one in ⋯ › Edit initials.`}>
        <span className="inline-flex shrink-0 text-warning" role="img" aria-label="Initials shared with another entity">
          <Icon name="warning" size={16} />
        </span>
      </Tooltip>
    ) : null;
  const exception = (a: Rec) => (isDissolved(a) ? "Dissolved" : isForming(a) ? "Forming" : null);

  const einCell = (a: Rec, t: TaxLine) => {
    if (!a.ein) return t.value === "Grantor trust" ? <span className="text-ink-3">Grantor&apos;s SSN</span> : null;
    const open = (shown.get(a.id) ?? 0) > Date.now();
    if (open) return <span className="font-mono text-small text-ink">{a.ein}</span>;
    return writer ? (
      <button type="button" onClick={() => reveal(a.id)} aria-label={`Show EIN for ${a.name}`} className="cursor-pointer rounded-control text-ink-2 tabular-nums hover:text-ink touch:min-h-[44px]">
        {format.maskEin(a.ein)}
      </button>
    ) : (
      <span className="text-ink-2 tabular-nums">{format.maskEin(a.ein)}</span>
    );
  };

  const ownerText = (a: Rec): { text: string; more: string; full: string; none: boolean } => {
    if (a.type === "Trust") {
      const people = trustPeople(a);
      return { text: people || "Trustees not recorded", more: "", full: people, none: !people };
    }
    const list = owners.get(a.id) ?? [];
    if (!list.length) return { text: "Owner not recorded", more: "", full: "", none: true };
    const changed = a.ownerChangedAt ? ` Recorded ${format.date(a.ownerChangedAt, "medium")}${a.ownerChangedBy?.name ? ` by ${a.ownerChangedBy.name}` : ""}${a.ownerEffective ? `, effective ${format.date(a.ownerEffective, "medium")}` : ""}.` : "";
    return { text: ownerPhrase(list[0]), more: list.length > 1 ? `and ${format.count(list.length - 1, "other owner")}` : "", full: list.map(ownerPhrase).join(" · ") + changed, none: false };
  };

  const recordsTip = (a: Rec, slot = true) => {
    const r = rec(a);
    const g = TONE_GLYPH[r.tone];
    return (
      <Popover
        label={`Records: ${a.name}`}
        width={340}
        trigger={
          <button
            type="button"
            aria-label={`Records ${r.score}%${g.word ? `, ${g.word}` : ""}`}
            className="inline-flex cursor-pointer items-center gap-[6px] rounded-control text-body text-ink tabular-nums hover:text-ink touch:min-h-[44px]"
          >
            {(slot || g.icon) && <span className={cx("inline-flex size-[16px] shrink-0", g.cls)}>{g.icon && <Icon name={g.icon} size={16} />}</span>}
            {r.score}%
          </button>
        }
      >
        <RecordsCard a={a} r={r} />
      </Popover>
    );
  };

  const docsCell = (a: Rec) => {
    if (a.type === "Trust") return null;
    const on = docsOn(a);
    const have = CORE_DOCS.filter((d) => !!a[d.key as keyof Rec]).map((d) => d.label);
    const lack = CORE_DOCS.filter((d) => !a[d.key as keyof Rec]).map((d) => d.label);
    return (
      <Tooltip label={[have.length ? `On file: ${format.list(have)}.` : "", lack.length ? `Missing: ${format.list(lack)}.` : ""].filter(Boolean).join(" ")}>
        <span tabIndex={0} className="rounded-control text-ink-2 tabular-nums">
          {on} of {CORE_DOCS.length}
        </span>
      </Tooltip>
    );
  };

  const taxCell = (t: TaxLine) => (
    <span className="flex min-w-0 flex-col" title={t.source ? `From ${t.source}` : undefined}>
      <span className="truncate text-ink">
        {taxLabel(t.value)}
        {t.value && t.isDefault && <span className="text-ink-3"> (default)</span>}
      </span>
      {t.files && <span className="line-clamp-2 text-small text-ink-2">{t.files}</span>}
    </span>
  );

  // ── Toolbar ────────────────────────────────────────────────────────────
  const typeOptions: Option<"all" | EntityType>[] = [
    { value: "all", label: "All types" },
    { value: "LLC", label: "LLC" },
    { value: "C-Corp", label: "Corporation" },
    { value: "LP", label: "LP" },
    { value: "Trust", label: "Trust" },
  ];
  const stateOptions: Option<string>[] = [
    ...[...choices.formed.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => ({ value: `formed:${n}`, label: n, short: `Formed in ${n}`, hint: String(c), group: "Formed in" })),
    ...[...choices.foreign.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => ({ value: `foreign:${n}`, label: n, short: `Registered in ${n}`, hint: String(c), group: "Registered in, as a foreign entity" })),
    ...(choices.none ? [{ value: NO_STATE, label: "No state on record", hint: String(choices.none), group: "Formed in" }] : []),
  ];
  const recordsOptions: Option<"all" | "incomplete" | "disagree">[] = [
    { value: "all", label: "All records" },
    { value: "incomplete", label: "Incomplete", hint: String(incomplete) },
    { value: "disagree", label: "Records disagree", hint: String(disagree) },
  ];
  const stateName = (v: string) => stateOptions.find((o) => o.value === v)?.short ?? stateOptions.find((o) => o.value === v)?.label ?? v;
  const active = [
    ...(typeF !== "all" ? [{ label: TYPE_LABEL[typeF], onRemove: () => setTypeF("all") }] : []),
    ...stateF.map((v) => ({ label: stateName(v), onRemove: () => setStateF(stateF.filter((x) => x !== v)) })),
    ...(recordsF !== "all" ? [{ label: recordsF === "incomplete" ? "Records incomplete" : "Records disagree", onRemove: () => setRecordsF("all") }] : []),
  ];
  const toolbar = (
    <Toolbar
      search={<SearchField value={q} onChange={setQ} placeholder="Search entities" label="Search entities by name, EIN, state or initials" />}
      filters={
        <>
          <Select size="sm" label="Type" value={typeF} onChange={setTypeF} options={typeOptions} />
          <MultiSelect size="sm" label="State" placeholder="All states" value={stateF} onChange={setStateF} options={stateOptions} footnote="Only states with entities on record are listed." />
          <Select size="sm" label="Records" value={recordsF} onChange={setRecordsF} options={recordsOptions} />
        </>
      }
      view={
        <Segmented
          label="View"
          value={view}
          onChange={pickView}
          options={[
            { value: "list", label: "List" },
            { value: "cards", label: "Cards" },
            { value: "map", label: "Map" },
          ]}
        />
      }
      activeFilters={active}
      onClearFilters={clearFilters}
    />
  );

  // ── Views ──────────────────────────────────────────────────────────────
  const sortHead = (label: string, key: SortKey, className = "") => {
    const on = sort.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cx("sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised px-3 text-left font-medium", className)}>
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}
          className={cx("inline-flex cursor-pointer items-center gap-1 rounded-control text-caption font-medium hover:text-ink", on ? "text-ink" : "text-ink-2")}
        >
          {label}
          {on && <Icon name={sort.dir === 1 ? "arrowUp" : "arrowDown"} size={12} />}
        </button>
      </th>
    );
  };

  const table = (
    <Card flush>
      <table className="w-full table-fixed border-separate border-spacing-0 text-body text-ink">
        <caption className="sr-only">Entities{tree ? ", by ownership" : ""}</caption>
        <colgroup>
          <col />
          <col className="hidden w-[232px] lg:table-column" />
          <col className="hidden w-[132px] xl:table-column" />
          <col className="w-[200px]" />
          <col className="hidden w-[124px] lg:table-column" />
          <col className="w-[96px]" />
          <col className="w-[52px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" aria-sort={tree ? "ascending" : "none"} className="sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised pr-3 pl-5 text-left font-medium">
              <span className="flex items-center gap-3">
                <button type="button" onClick={() => setSort({ key: "name", dir: 1 })} className={cx("inline-flex cursor-pointer items-center gap-1 text-caption font-medium hover:text-ink", tree ? "text-ink" : "text-ink-2")}>
                  Entity
                </button>
                {tree && parentIds.length > 0 && (
                  <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(parentIds))} className="cursor-pointer text-caption text-accent hover:underline">
                    {collapsed.size ? "Expand all" : "Collapse all"}
                  </button>
                )}
                {!tree && (
                  <button type="button" onClick={() => setSort({ key: "name", dir: 1 })} className="cursor-pointer text-caption text-accent hover:underline">
                    Show ownership tree
                  </button>
                )}
              </span>
            </th>
            {sortHead("Tax classification", "tax", "hidden lg:table-cell")}
            <th scope="col" className="sticky top-0 z-sticky hidden h-8 border-b border-line-strong bg-raised px-3 text-left text-caption font-medium text-ink-2 xl:table-cell">
              EIN
            </th>
            {sortHead("Owner", "owner")}
            {sortHead("Core documents", "docs", "hidden lg:table-cell")}
            {sortHead("Records", "records")}
            <th scope="col" className="sticky top-0 z-sticky h-8 border-b border-line-strong bg-raised pr-5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, depth, kids, context }) => {
            const t = taxes.get(a.id)!;
            const o = ownerText(a);
            const ex = exception(a);
            const shut = collapsed.has(a.id);
            return (
              <tr key={a.id} className="group">
                <td className="border-b border-line py-2 pr-3 pl-5 align-middle group-last:border-b-0">
                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
                    {tree && (
                      <span className="inline-flex w-6 shrink-0 justify-center">
                        {kids > 0 && (
                          <button
                            type="button"
                            onClick={() => toggle(a.id)}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                                e.preventDefault();
                                toggle(a.id, e.key === "ArrowRight");
                              }
                            }}
                            aria-expanded={!shut}
                            aria-label={`${shut ? "Expand" : "Collapse"} ${a.name}`}
                            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
                          >
                            <Icon name={shut ? "chevronRight" : "chevronDown"} size={16} />
                          </button>
                        )}
                      </span>
                    )}
                    {mark(a)}
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <Link to={`/assets/${a.id}`} className={cx("line-clamp-2 min-w-0 break-words hover:underline", context ? "text-ink-2" : "font-medium text-ink")} title={a.name}>
                          {a.name}
                        </Link>
                        {sharedMark(a)}
                        {shut && kids > 0 && <span className="shrink-0 text-small text-ink-2">+{kids}</span>}
                      </span>
                      <span className="truncate text-small text-ink-2">
                        {context ? "Shown as an owner" : [TYPE_LABEL[a.type as EntityType], formedIn(a), ex].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="hidden border-b border-line px-3 py-2 align-middle group-last:border-b-0 lg:table-cell">{!context && taxCell(t)}</td>
                <td className="hidden border-b border-line px-3 py-2 align-middle group-last:border-b-0 xl:table-cell">{!context && einCell(a, t)}</td>
                <td className="border-b border-line px-3 py-2 align-middle group-last:border-b-0">
                  {!context && (
                    <span className="flex min-w-0 flex-col" title={o.full || undefined}>
                      <span className={cx("line-clamp-2 break-words", o.none ? "text-ink-3" : "text-ink")}>{o.text}</span>
                      {o.more && <span className="truncate text-small text-ink-2">{o.more}</span>}
                    </span>
                  )}
                </td>
                <td className="hidden border-b border-line px-3 py-2 align-middle group-last:border-b-0 lg:table-cell">{!context && docsCell(a)}</td>
                <td className="border-b border-line px-3 py-2 align-middle group-last:border-b-0">{!context && recordsTip(a)}</td>
                <td className="border-b border-line py-2 pr-3 text-right align-middle group-last:border-b-0">
                  <Menu label={a.name} align="end" items={rowItems(a)} trigger={<IconButton icon="more" label={`Actions for ${a.name}`} />} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  // Phones: the tree as rows, 12px a level, names wrapping to two lines.
  const phoneList = (
    <Card flush>
      <ul aria-label="Entities" className="flex flex-col">
        {rows.map(({ a, depth, kids, context }) => {
          const r = rec(a);
          const g = TONE_GLYPH[r.tone];
          const shut = collapsed.has(a.id);
          const ex = exception(a);
          return (
            <li key={a.id} className="flex min-h-(--row-2) items-center border-b border-line last:border-b-0" style={{ paddingLeft: 8 + depth * 12 }}>
              {tree && (
                <span className="flex w-8 shrink-0 justify-center">
                  {kids > 0 && (
                    <IconButton icon={shut ? "chevronRight" : "chevronDown"} label={`${shut ? "Expand" : "Collapse"} ${a.name}`} noTooltip aria-expanded={!shut} className="-mx-[6px]" onClick={() => toggle(a.id)} />
                  )}
                </span>
              )}
              <Link to={`/assets/${a.id}`} className="flex min-w-0 flex-1 flex-col py-2 pr-2">
                <span className={cx("line-clamp-2 break-words", context ? "text-ink-2" : "font-medium text-ink")}>
                  {a.name}
                  {shut && kids > 0 ? <span className="font-normal text-ink-2"> +{kids}</span> : null}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-small text-ink-2">
                  {context ? (
                    "Shown as an owner"
                  ) : (
                    <>
                      <span className="truncate">{[TYPE_LABEL[a.type as EntityType], formedIn(a), ex].filter(Boolean).join(" · ")}</span>
                      <span aria-hidden="true">·</span>
                      <span className={cx("inline-flex shrink-0", g.cls)}>{g.icon && <Icon name={g.icon} size={12} />}</span>
                      <span className="shrink-0 tabular-nums">Records {r.score}%</span>
                    </>
                  )}
                </span>
              </Link>
              <span className="shrink-0 pr-1">
                <Menu label={a.name} align="end" items={rowItems(a)} trigger={<IconButton icon="more" label={`Actions for ${a.name}`} noTooltip />} />
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );

  const cards = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cardRows.map(({ a }) => {
        const t = taxes.get(a.id)!;
        const r = rec(a);
        const o = ownerText(a);
        const ex = exception(a);
        return (
          <Card
            key={a.id}
            title={
              <span className="flex items-center gap-2">
                {mark(a)}
                <Link to={`/assets/${a.id}`} className="hover:underline">
                  {a.name}
                </Link>
                {sharedMark(a)}
              </span>
            }
            menu={rowItems(a)}
          >
            <div className="flex flex-col gap-2 text-small text-ink-2">
              <p className="flex flex-wrap items-center gap-x-1">
                {[TYPE_LABEL[a.type as EntityType], formedIn(a), ex].filter(Boolean).join(" · ")}
                {(a.ein || t.value === "Grantor trust") && (
                  <>
                    <span aria-hidden="true">·</span>
                    {einCell(a, t)}
                  </>
                )}
              </p>
              <p>
                <span className="text-ink">{taxLabel(t.value)}</span>
                {t.value && t.isDefault ? " (default)" : ""}
                {t.files ? ` · ${t.files}` : ""}
              </p>
              <p className={o.none ? "text-ink-3" : undefined} title={o.full || undefined}>
                {a.type === "Trust" || o.none ? o.text : `Owner: ${o.text}${o.more ? `, ${o.more}` : ""}`}
              </p>
              <div className="mt-1 flex items-center gap-2 border-t border-line pt-3 text-body">
                {recordsTip(a, false)}
                <span className="min-w-0 truncate text-small text-ink-2">{r.conflicts.length ? "Records disagree" : missingLine(r)}</span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );

  const body = loading ? (
    view === "cards" ? (
      <Skeleton kind="card" rows={4} />
    ) : (
      <Card flush>
        <Skeleton kind="table" rows={8} columns={["44%", "20%", "20%", "16%"]} />
      </Card>
    )
  ) : assets.length === 0 ? (
    <Empty
      title="No entities yet"
      size="page"
      action={
        writer ? (
          <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
            New entity
          </Button>
        ) : undefined
      }
    >
      The family&apos;s LLCs, corporations, partnerships and trusts appear here with their owners, documents and records. Only the office team sees this list.
    </Empty>
  ) : matched.length === 0 ? (
    <Card>
      <Empty
        action={
          <Button variant="quiet" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      >
        {needle ? `No entities match “${q.trim()}”.` : "No entities match these filters."}
      </Empty>
    </Card>
  ) : view === "list" ? (
    phone ? (
      phoneList
    ) : (
      table
    )
  ) : (
    cards
  );

  const owning = ownerFor ? (byId.get(ownerFor.id) ?? null) : null;
  const tagging = initialsFor ? (byId.get(initialsFor) ?? null) : null;

  return (
    <Page
      width="workspace"
      header={<PageHeader title="Entities" context={context} menu={menu.length ? menu : undefined} create={writer ? { label: "New entity", onClick: () => setNewOpen(true) } : undefined} />}
    >
      {loadError && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => (setLoading(true), setLoadError(""), setReload((n) => n + 1))}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Banner>
      )}
      {running && <Banner tone="info">{running}</Banner>}
      {scan && <ScanBanner scan={scan} onStop={() => (stopScan.current = true)} onDismiss={() => setScan(null)} />}
      <div className="flex flex-col gap-4">
        {toolbar}
        {view === "map" ? (
          <EstateMapView
            embedded
            highlight={filtered ? matchedIds : null}
            onAddEntity={writer ? () => setNewOpen(true) : undefined}
            onChangeOwner={admin ? (id, to) => setOwnerFor({ id, proposed: to }) : undefined}
          />
        ) : (
          body
        )}
        {view !== "map" && !loading && filtered && matched.length > 0 && (
          <p role="status" className="text-small text-ink-2">
            Showing {matched.length} of {format.count(assets.length, "entity", "entities")}
            {view === "list" && tree && rows.some((r) => r.context) ? ". Their owners are shown too, for context." : "."}
          </p>
        )}
      </div>

      <NewEntityDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        entities={assets}
        onFormWithPalm={() => {
          setNewOpen(false);
          setWizard(true);
        }}
        onCreated={(id, name) => {
          setNewOpen(false);
          toast({ message: `Added ${name}`, action: id ? { label: "Open", run: () => navigate(`/assets/${id}`) } : undefined });
        }}
      />
      <FormEntityWizard
        open={wizard}
        onClose={() => setWizard(false)}
        entities={assets
          .filter((a) => a.type !== "Trust")
          .map((a) => ({ id: a.id, name: a.name, address: a.address }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        onCreated={(id) => {
          setWizard(false);
          navigate(`/assets/${id}`);
        }}
      />
      <OwnerDialog entity={owning} proposed={ownerFor?.proposed} all={assets} onClose={() => setOwnerFor(null)} />
      <InitialsDialog
        entity={tagging}
        current={tagging ? tagOf(tagging) : ""}
        check={(raw) => (tagging ? initialsClash(raw, tagging.id, tags) : null)}
        onClose={() => setInitialsFor(null)}
        onSaved={(initials) => {
          if (tagging) setEntityTagLocal(tagging.name, initials || null);
          toast({ message: `Saved the initials ${initials}` });
        }}
      />
      <PalmChecksDialog open={checksOpen} onClose={() => setChecksOpen(false)} onRun={(action, plan) => void runPalmCheck(action, plan)} />
      <PalmResultsDialog run={run} onClose={() => setRun(null)} />
      <Dialog open={!!recordsFor && byId.has(recordsFor)} onClose={() => setRecordsFor(null)} title={recordsFor ? `Records: ${byId.get(recordsFor)?.name ?? ""}` : "Records"}>
        {recordsFor && byId.get(recordsFor) && <RecordsCard a={byId.get(recordsFor)!} r={rec(byId.get(recordsFor)!)} />}
      </Dialog>
    </Page>
  );
}

class Stopped extends Error {}

/** What the records score is made of: the conflicts first, then what's missing, grouped, with the points each is worth. */
function RecordsCard({ a, r }: { a: Rec; r: Records }) {
  const groups = missingGroups(r);
  return (
    <div className="flex flex-col gap-3 text-body">
      <div>
        <p className="font-semibold text-ink">Records: {r.score} of 100</p>
        <p className="text-small text-ink-2">How much of {a.name}&apos;s facts and documents are on file.</p>
      </div>
      {r.conflicts.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-small font-medium text-ink-2">The records disagree</p>
          <ul className="flex flex-col gap-2">
            {r.conflicts.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span className={cx("mt-[2px] inline-flex shrink-0", c.severity === "high" ? "text-negative" : "text-warning")}>
                  <Icon name={c.severity === "high" ? "x" : "warning"} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-ink">{c.title}</span>
                  <span className="block text-small text-pretty text-ink-2">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <p className="text-small font-medium text-ink-2">{g.label}</p>
          <ul className="flex flex-col gap-1">
            {g.items.map((m) => (
              <li key={m.key} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 text-ink">{m.label}</span>
                <span className="shrink-0 text-small text-ink-3 tabular-nums">{r.points.get(m.key)} pts</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!r.missing.length && <p className="text-ink-2">Every fact and document its rules call for is on file.</p>}
      <p className="border-t border-line pt-3 text-small text-ink-2">
        State standing and deadlines are on{" "}
        <Link to="/tools/compliance" className="text-accent underline underline-offset-[3px] hover:text-accent-hover">
          Entity compliance
        </Link>
        .
      </p>
    </div>
  );
}

/** The document scan as it runs, and what it changed once it's done. */
function ScanBanner({ scan, onStop, onDismiss }: { scan: ScanProgress; onStop: () => void; onDismiss: () => void }) {
  const pct = Math.round(((scan.done ? scan.total : Math.max(0, scan.index - 1)) / Math.max(1, scan.total)) * 100);
  if (!scan.done) {
    return (
      <Banner
        tone="info"
        action={
          <Button variant="quiet" size="sm" onClick={onStop}>
            Stop
          </Button>
        }
      >
        <p>
          Reading documents: {scan.index} of {scan.total}
          {scan.entity ? ` · ${scan.entity}` : ""}
        </p>
        <p className="text-small text-ink-2">{scan.step}. Keep this tab open until it finishes.</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scan progress">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </Banner>
    );
  }
  return (
    <Banner tone={scan.paused ? "warning" : "positive"} onDismiss={onDismiss}>
      <p>{scan.paused ?? `Scan finished: ${format.count(scan.notes.length, "change")} across ${format.count(scan.total, "entity", "entities")}.`}</p>
      {scan.notes.length > 0 && (
        <Disclosure label="What changed" count={scan.notes.length} className="mt-1">
          <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto text-small text-ink-2">
            {scan.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Banner>
  );
}
