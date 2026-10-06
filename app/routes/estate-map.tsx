import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useTheme } from "../theme";
import { entityCompleteness, type CompletenessInput } from "../entity-completeness";

export function meta() {
  return [{ title: "BFO - Estate Map" }];
}

type Entity = {
  id: string;
  name: string;
  parentId: string | null;
  // Hand-placed coordinates from the old free-form canvas. The map now lays
  // itself out, but x still orders siblings left to right.
  x: number;
  y: number;
  color?: string;
  quickBooksRealmId?: string;
  quickBooksName?: string;
};

type QBCompany = { realm_id: string; company_name: string };

/** The `assets` record an estate-map entity matches by (lowercased) name. */
type AssetRec = { id: string; data: CompletenessInput };
type Compliance = { score: number; missing: string[] };

// Compliance ring colours — the entity page's scale: emerald ≥ 90, indigo ≥ 60, amber below.
function complianceColor(score: number, isDark: boolean): string {
  if (score >= 90) return isDark ? "#34d399" : "#059669";
  if (score >= 60) return isDark ? "#818cf8" : "#4f46e5";
  return isDark ? "#fbbf24" : "#d97706";
}

function complianceTitle(c: Compliance): string {
  return c.missing.length ? `Compliance ${c.score} — missing: ${c.missing.join(", ")}` : `Compliance ${c.score} — every requirement on file`;
}

/**
 * A compliance score as a small ring with the number inside. Without a
 * matching entity record it is a dashed, muted ring with a dash, so every
 * card keeps the same right-hand column.
 */
function ComplianceRing({ c, size, isDark }: { c: Compliance | null; size: number; isDark: boolean }) {
  const stroke = size >= 30 ? 2.5 : 2;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const track = isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb";
  const font = size >= 30 ? 10.5 : size >= 26 ? 9.5 : 8.5;
  if (!c) {
    return (
      <span
        className="relative grid shrink-0 place-items-center"
        style={{ width: size, height: size }}
        title="No entity record with this name, so no compliance score"
      >
        <svg width={size} height={size} className="absolute inset-0" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={1.25} strokeDasharray="2 2.5" />
        </svg>
        <span className={isDark ? "text-gray-600" : "text-gray-400"} style={{ fontSize: font }} aria-label="No compliance score">
          —
        </span>
      </span>
    );
  }
  const color = complianceColor(c.score, isDark);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} title={complianceTitle(c)}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {c.score > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={len}
            strokeDashoffset={len * (1 - Math.min(100, c.score) / 100)}
          />
        )}
      </svg>
      <span
        className="relative font-semibold tabular-nums leading-none tracking-[-0.02em]"
        style={{ fontSize: font, color: c.score >= 90 || c.score < 60 ? color : undefined }}
        aria-label={`Compliance ${c.score}`}
      >
        {c.score}
      </span>
    </span>
  );
}

export const INITIAL_ENTITIES: Entity[] = [
  // Root
  { id: "bfrt", name: "Burton Family Revocable Trust", parentId: null, x: 600, y: 40, color: "#6366f1" },
  // Level 1
  { id: "ll", name: "Ledger Louise, LLC", parentId: "bfrt", x: 600, y: 160 },
  // Level 2 - Main holding companies
  { id: "smv", name: "Swisshelm Mountain Ventures, LLC", parentId: "ll", x: 150, y: 300 },
  { id: "si", name: "Sundown Investments, LLC", parentId: "ll", x: 450, y: 300 },
  { id: "lb", name: "Ledger Burton, LLC", parentId: "ll", x: 750, y: 300 },
  { id: "wb", name: "Worrell Burton, LLC", parentId: "ll", x: 1050, y: 300 },
  // SMV children
  { id: "acr", name: "Arizona Center for Recovery - A New Direction, LLC", parentId: "smv", x: 80, y: 440 },
  { id: "pl", name: "Persons Lodge LLC (100%)", parentId: "smv", x: 80, y: 520 },
  { id: "bw", name: "Breezewood (100%)", parentId: "smv", x: 80, y: 600 },
  // SI children
  { id: "fdj", name: "FDJ Hesperia, LLC (100%)", parentId: "si", x: 400, y: 440 },
  { id: "cfs", name: "FDJ CFS, LLC (100%)", parentId: "si", x: 400, y: 520 },
  { id: "prb", name: "Palomino Ranch on the Bend, LLC (100%)", parentId: "si", x: 400, y: 600 },
  // LB children
  { id: "vq", name: "VQ National", parentId: "lb", x: 720, y: 440 },
  // WB children
  { id: "cd", name: "Catalog Digital, Inc", parentId: "wb", x: 1020, y: 440 },
  { id: "ah", name: "Atlas Hydration, Inc", parentId: "wb", x: 1020, y: 520 },
  // Unconnected
  { id: "qla", name: "Quail Lakes Apartments, LLC", parentId: null, x: 550, y: 720, color: "#f59e0b" },
  { id: "hsl", name: "HSL TP Hotel, LLC", parentId: null, x: 780, y: 720, color: "#ef4444" },
  { id: "hslp", name: "HSL Placita West Ltd Partnership", parentId: null, x: 1010, y: 720, color: "#8b5cf6" },
];

// ── Geometry (scene px — the whole scene is scaled to fit the canvas) ─────
const CARD_W = 264; // room for the name, the QuickBooks chip and the compliance ring
const ROOT_W = 344; // the trust gets room for its full name
const CARD_H = 60;
const LEAF_H = 46;
const INDENT = 26; // stacked children sit this far right of their parent
const RAIL = 14; // x of the stack rail, from the parent's left edge
const STACK_TOP = 14;
const STACK_GAP = 8;
const COL_GAP = 28;
const LEVEL_GAP = 60;
const TREE_GAP = 72;
const R = 9; // elbow corner radius
const TRAY_GAP = 56;
const TRAY_HEAD = 36;
const TRAY_PAD = 16;
const TRAY_ROW_GAP = 12;

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;

// ── Branch colours: each holding company's subtree gets its own ──────────
type Tone = { dark: string; light: string };
const TONES: Tone[] = [
  { dark: "#38bdf8", light: "#0284c7" }, // sky
  { dark: "#34d399", light: "#059669" }, // emerald
  { dark: "#fbbf24", light: "#d97706" }, // amber
  { dark: "#f472b6", light: "#db2777" }, // pink
  { dark: "#a78bfa", light: "#7c3aed" }, // violet
  { dark: "#22d3ee", light: "#0891b2" }, // cyan
  { dark: "#fb923c", light: "#ea580c" }, // orange
];
const TRUNK: Tone = { dark: "#818cf8", light: "#4f46e5" };
const NEUTRAL: Tone = { dark: "#94a3b8", light: "#64748b" };

function toneColor(tone: number, isDark: boolean): string {
  const t = tone === -1 ? TRUNK : tone < -1 ? NEUTRAL : TONES[tone % TONES.length];
  return isDark ? t.dark : t.light;
}

// ── Layout ───────────────────────────────────────────────────────────────
type Kind = "root" | "node" | "leaf" | "orphan";
type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Kind;
  tone: number;
  kids: number;
  desc: number;
};
type Edge = { id: string; parentId: string; d: string; tone: number; mx: number; my: number };
type Layout = {
  boxes: Box[];
  byId: Map<string, Box>;
  edges: Edge[];
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
  width: number;
  height: number;
  tray: { x: number; y: number; w: number; h: number; count: number } | null;
  branches: number;
  levels: number;
};

/** Orthogonal connector: down from the parent, along a bus, down into the child. */
function elbow(px: number, py: number, busY: number, cx: number, cy: number): string {
  const dx = cx - px;
  if (Math.abs(dx) < 0.5) return `M ${px} ${py} V ${cy}`;
  const s = Math.sign(dx);
  const r = Math.min(R, Math.abs(dx) / 2, busY - py);
  return `M ${px} ${py} V ${busY - r} Q ${px} ${busY} ${px + s * r} ${busY} H ${cx - s * r} Q ${cx} ${busY} ${cx} ${busY + r} V ${cy}`;
}

/**
 * A tidy org-chart layout derived purely from the ownership links. A parent
 * whose children are all leaves lists them in an indented stack (compact, one
 * column per holding company); otherwise children spread out in a row under
 * a shared bus. Roots with nothing beneath them go to the "Unlinked" tray.
 */
function layoutEstate(entities: Entity[], compact = false): Layout {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const order = new Map(entities.map((e, i) => [e.id, i]));
  const kidsOf = new Map<string, Entity[]>();
  for (const e of entities) {
    if (!e.parentId || e.parentId === e.id || !byId.has(e.parentId)) continue;
    const list = kidsOf.get(e.parentId) ?? [];
    list.push(e);
    kidsOf.set(e.parentId, list);
  }
  for (const list of kidsOf.values()) {
    list.sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || order.get(a.id)! - order.get(b.id)!);
  }
  const kids = (id: string) => kidsOf.get(id) ?? [];

  const descMemo = new Map<string, number>();
  const reached = new Set<string>();

  type Sub = { w: number; h: number; stack: boolean; own: number; cardH: number };
  const subs = new Map<string, Sub>();

  // `own` is the entity's card width, `cardH` its card height. Stacked
  // children are indented one step and listed top to bottom; on a narrow
  // (compact) canvas every parent stacks, giving a vertical outline.
  function measure(id: string, own: number, cardH: number): Sub {
    reached.add(id);
    const ch = kids(id);
    let m: Sub;
    if (!ch.length) {
      m = { w: own, h: cardH, stack: false, own, cardH };
    } else if (compact || ch.every((c) => !kids(c.id).length)) {
      const childOwn = Math.max(224, own - INDENT);
      let cursor = cardH + STACK_TOP;
      let w = own;
      for (const c of ch) {
        const cm = measure(c.id, childOwn, kids(c.id).length ? CARD_H : LEAF_H);
        cursor += cm.h + STACK_GAP;
        w = Math.max(w, INDENT + cm.w);
      }
      m = { w, h: cursor - STACK_GAP, stack: true, own, cardH };
    } else {
      const ms = ch.map((c) => measure(c.id, CARD_W, CARD_H));
      const w = ms.reduce((s, x) => s + x.w, 0) + COL_GAP * (ms.length - 1);
      m = { w: Math.max(own, w), h: cardH + LEVEL_GAP + Math.max(...ms.map((x) => x.h)), stack: false, own, cardH };
    }
    descMemo.set(id, ch.reduce((s, c) => s + 1 + (descMemo.get(c.id) ?? 0), 0));
    subs.set(id, m);
    return m;
  }

  // A root is anything without a (valid) parent. Entities caught in a parent
  // cycle are never reached from a root, and land in the tray too.
  const roots = entities.filter((e) => !e.parentId || e.parentId === e.id || !byId.has(e.parentId));
  const trees = roots.filter((r) => kids(r.id).length);
  for (const t of trees) measure(t.id, ROOT_W, CARD_H);
  trees.sort((a, b) => (descMemo.get(b.id) ?? 0) - (descMemo.get(a.id) ?? 0));
  const orphans = entities.filter((e) => !reached.has(e.id));

  const forestW = trees.length
    ? trees.reduce((s, t) => s + subs.get(t.id)!.w, 0) + TREE_GAP * (trees.length - 1)
    : 0;
  const forestH = trees.length ? Math.max(...trees.map((t) => subs.get(t.id)!.h)) : 0;

  // Tray geometry first, so the scene width (and the forest's centring) is known.
  let tray: Layout["tray"] = null;
  let cols = 1;
  let innerW = 0;
  if (orphans.length) {
    const avail = compact ? Math.max(forestW, CARD_W + TRAY_PAD * 2) : Math.max(forestW, CARD_W * 3 + COL_GAP * 2 + TRAY_PAD * 2);
    cols = Math.max(1, Math.min(orphans.length, Math.floor((avail - 2 * TRAY_PAD + COL_GAP) / (CARD_W + COL_GAP))));
    const rows = Math.ceil(orphans.length / cols);
    innerW = cols * CARD_W + (cols - 1) * COL_GAP;
    tray = {
      x: 0,
      y: trees.length ? forestH + TRAY_GAP : 0,
      w: innerW + TRAY_PAD * 2,
      h: TRAY_HEAD + rows * CARD_H + (rows - 1) * TRAY_ROW_GAP + TRAY_PAD,
      count: orphans.length,
    };
  }
  const width = Math.max(forestW, tray?.w ?? 0, CARD_W);
  const height = tray ? tray.y + tray.h : forestH;
  if (tray) tray.x = (width - tray.w) / 2;

  const boxes: Box[] = [];
  const edges: Edge[] = [];
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  let toneCounter = 0;
  let levels = 0;

  function link(parent: string, child: string) {
    parentOf.set(child, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
  }

  /** Places a subtree with its box's left edge at x; returns the card's centre x. */
  function place(id: string, x: number, y: number, depth: number, tone: number, kind: Kind): number {
    levels = Math.max(levels, depth + 1);
    const m = subs.get(id)!;
    const ch = kids(id);
    const desc = descMemo.get(id) ?? 0;
    const cw = m.own;
    const chH = m.cardH;
    if (m.stack || !ch.length) {
      boxes.push({ id, x, y, w: cw, h: chH, kind, tone, kids: ch.length, desc });
      if (m.stack) {
        const branching = tone === -1 && ch.length > 1;
        const rx = x + RAIL;
        let cursor = y + chH + STACK_TOP;
        ch.forEach((c) => {
          const t = branching ? toneCounter++ : tone;
          const cs = subs.get(c.id)!;
          const my = cursor + cs.cardH / 2;
          place(c.id, x + INDENT, cursor, depth + 1, t, kids(c.id).length ? "node" : "leaf");
          edges.push({
            id: c.id,
            parentId: id,
            d: `M ${rx} ${y + chH} V ${my - R} Q ${rx} ${my} ${rx + R} ${my} H ${x + INDENT}`,
            // Branches fanning off a shared rail keep the rail in the parent's colour.
            tone: branching ? tone : t,
            mx: rx,
            my: cursor - STACK_GAP / 2,
          });
          link(id, c.id);
          cursor += cs.h + STACK_GAP;
        });
      }
      return x + cw / 2;
    }
    const ms = ch.map((c) => subs.get(c.id)!);
    const total = ms.reduce((s, c) => s + c.w, 0) + COL_GAP * (ms.length - 1);
    let cx = x + (m.w - total) / 2;
    const childY = y + chH + LEVEL_GAP;
    const branching = tone === -1 && ch.length > 1;
    const placed = ch.map((c, i) => {
      const t = branching ? toneCounter++ : tone;
      const center = place(c.id, cx, childY, depth + 1, t, "node");
      cx += ms[i].w + COL_GAP;
      return { id: c.id, center, tone: t };
    });
    const pcx = (placed[0].center + placed[placed.length - 1].center) / 2;
    boxes.push({ id, x: pcx - cw / 2, y, w: cw, h: chH, kind, tone, kids: ch.length, desc });
    const busY = y + chH + LEVEL_GAP / 2;
    for (const p of placed) {
      edges.push({
        id: p.id,
        parentId: id,
        d: elbow(pcx, y + chH, busY, p.center, childY),
        tone: p.tone,
        mx: p.center,
        my: busY + (childY - busY) / 2,
      });
      link(id, p.id);
    }
    return pcx;
  }

  let fx = (width - forestW) / 2;
  for (const t of trees) {
    place(t.id, fx, 0, 0, -1, "root");
    fx += subs.get(t.id)!.w + TREE_GAP;
  }

  if (tray) {
    const rows = Math.ceil(orphans.length / cols);
    orphans.forEach((o, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = row === rows - 1 ? orphans.length - row * cols : cols;
      const offset = (innerW - (inRow * CARD_W + (inRow - 1) * COL_GAP)) / 2;
      boxes.push({
        id: o.id,
        x: tray!.x + TRAY_PAD + offset + col * (CARD_W + COL_GAP),
        y: tray!.y + TRAY_HEAD + row * (CARD_H + TRAY_ROW_GAP),
        w: CARD_W,
        h: CARD_H,
        kind: "orphan",
        tone: -2,
        kids: 0,
        desc: 0,
      });
    });
  }

  return {
    boxes,
    byId: new Map(boxes.map((b) => [b.id, b])),
    edges,
    parentOf,
    childrenOf,
    width,
    height,
    tray,
    branches: toneCounter,
    levels,
  };
}

/** Pulls the legal form and ownership share out of a display name. */
function describe(name: string) {
  const pct = name.match(/\((\d{1,3}(?:\.\d+)?%)\)\s*$/)?.[1] ?? null;
  let display = name.replace(/\s*\(\d{1,3}(?:\.\d+)?%\)\s*$/, "").trim();
  let label = "Entity";
  let abbr = "ENT";
  if (/\btrust\b/i.test(display)) {
    label = "Trust";
    abbr = "TR";
  } else if (/\b(ltd\.?\s+partnership|l\.?p\.?)$/i.test(display)) {
    label = "Partnership";
    abbr = "LP";
    display = display.replace(/,?\s*(ltd\.?\s+partnership|l\.?p\.?)$/i, "");
  } else if (/\b(inc\.?|corp\.?|corporation)$/i.test(display)) {
    label = "Corporation";
    abbr = "INC";
    display = display.replace(/,?\s*(inc\.?|corp\.?|corporation)$/i, "");
  } else if (/\bl\.?l\.?c\.?$/i.test(display)) {
    label = "LLC";
    abbr = "LLC";
    display = display.replace(/,?\s*l\.?l\.?c\.?$/i, "");
  }
  return { display: display || name, label, abbr, pct };
}

type DragState = { id: string; x: number; y: number; target: string | null };

/**
 * The /estate-map route. React Router wraps a route's default export and
 * hands it route props only, so the Entities page embeds the named
 * `EstateMapView` below to pass its own.
 */
export default function EstateMapRoute() {
  return <EstateMapView />;
}

export function EstateMapView({
  embedded = false,
  highlight = null,
}: {
  embedded?: boolean;
  /** Lowercased entity names to light (the Entities page's state filter); the rest dim. */
  highlight?: Set<string> | null;
} = {}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [entities, setEntities] = useState<Entity[]>(INITIAL_ENTITIES);
  const loaded = useRef(false);
  const skipNextSave = useRef(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [qbCompanies, setQbCompanies] = useState<QBCompany[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [assetByName, setAssetByName] = useState<Record<string, AssetRec>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panning, setPanning] = useState(false);

  const [canvasH, setCanvasH] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [smooth, setSmooth] = useState(false);
  const autoFit = useRef(true);

  // Subscribe to Firebase for real-time shared estate map
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, get, set } = await import("firebase/database");

      // Seed initial entities if nothing exists yet
      try {
        const snap = await get(ref(db, "estate-map/entities"));
        if (!snap.exists()) {
          await set(ref(db, "estate-map/entities"), INITIAL_ENTITIES);
        }
      } catch (err) {
        console.error("Estate map seed error:", err);
      }

      unsubscribe = onValue(ref(db, "estate-map/entities"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Firebase may return an array or object — normalize to array
          const arr: Entity[] = Array.isArray(data)
            ? data.filter(Boolean)
            : Object.values(data);
          skipNextSave.current = true;
          setEntities(arr);
        }
        loaded.current = true;
      });
    }
    setup().catch((err) => console.error("Estate map load error:", err));
    return () => unsubscribe?.();
  }, []);

  // Debounced save to Firebase — skip when echoing a remote update
  useEffect(() => {
    if (!loaded.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { db } = await import("../firebase");
        const { ref, set } = await import("firebase/database");
        await set(ref(db, "estate-map/entities"), entities);
      } catch (err) {
        console.error("Estate map save error:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [entities]);

  // Fetch connected QuickBooks companies
  useEffect(() => {
    async function loadQB() {
      try {
        const res = await fetch("/api/quickbooks/data?report=list");
        const data = await res.json();
        const list: { realm_id: string; company_name: string }[] = data?.companies || [];
        // Resolve company names for each
        const resolved = await Promise.all(
          list.map(async (c) => {
            if (c.company_name) return c;
            try {
              const infoRes = await fetch(`/api/quickbooks/data?report=company-info&realm_id=${c.realm_id}`);
              const info = await infoRes.json();
              return { realm_id: c.realm_id, company_name: info?.CompanyInfo?.CompanyName || c.realm_id };
            } catch {
              return { realm_id: c.realm_id, company_name: c.realm_id };
            }
          })
        );
        setQbCompanies(resolved);
      } catch {
        setQbCompanies([]);
      }
    }
    loadQB();
  }, []);

  // Subscribe to Firebase assets and build a name -> record lookup (the id
  // opens the entity page; the record scores the paperwork).
  // Seed any Estate Map entities that don't exist as assets yet.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let seeded = false;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, push, get } = await import("firebase/database");

      // One-time seed: create any missing entities as assets
      if (!seeded && !localStorage.getItem("bfo-assets-seeded-v1")) {
        seeded = true;
        try {
          const snap = await get(ref(db, "assets"));
          const existing = snap.val() || {};
          const existingNames = new Set<string>(
            Object.values(existing).map((a: any) => (a?.name || "").toLowerCase())
          );
          for (const ent of INITIAL_ENTITIES) {
            if (!existingNames.has(ent.name.toLowerCase())) {
              const lower = ent.name.toLowerCase();
              const type = /\btrust\b/.test(lower) ? "Trust" : lower.includes("inc") && !lower.includes("llc") ? "C-Corp" : "LLC";
              await push(ref(db, "assets"), {
                name: ent.name,
                type,
                state: "",
                ein: "",
                createdAt: Date.now(),
              });
            }
          }
          localStorage.setItem("bfo-assets-seeded-v1", "1");
        } catch (err) {
          console.error("Estate seed error:", err);
        }
      }

      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        const data = snapshot.val();
        const map: Record<string, AssetRec> = {};
        if (data) {
          for (const [id, value] of Object.entries(data)) {
            const name = (value as any)?.name;
            if (typeof name === "string" && name) map[name.toLowerCase()] = { id, data: value as CompletenessInput };
          }
        }
        setAssetByName(map);
      });
    }
    setup().catch((err) => console.error("Estate map load error:", err));
    return () => unsubscribe?.();
  }, []);

  // Narrow canvases (phones) get the vertical outline instead of the org chart.
  const compact = size.w > 0 && size.w < 640;
  const layout = useMemo(() => layoutEstate(entities, compact), [entities, compact]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  // Refs so window-level pointer handlers always see the current frame.
  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ── Canvas sizing: fill the viewport below the header ─────────────────
  useLayoutEffect(() => {
    function measure() {
      const el = canvasRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottom = window.innerWidth >= 1024 ? 32 : 24;
      setCanvasH(Math.max(440, window.innerHeight - top - bottom));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [embedded]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    if (!size.w || !size.h) return;
    const padX = Math.min(56, size.w * 0.04);
    const padTop = compact ? 68 : 76;
    const padBottom = 56;
    if (compact) {
      // Phones: fill the width and scroll (pan) down the outline.
      const k = Math.max(ZOOM_MIN, Math.min((size.w - padX * 2) / layout.width, 1.1));
      const free = size.h - padTop - padBottom - layout.height * k;
      setView({ k, x: (size.w - layout.width * k) / 2, y: padTop + Math.max(0, free / 2) });
      return;
    }
    const k = Math.max(
      ZOOM_MIN,
      Math.min((size.w - padX * 2) / layout.width, (size.h - padTop - padBottom) / layout.height, 1.35)
    );
    setView({
      k,
      x: (size.w - layout.width * k) / 2,
      y: padTop + (size.h - padTop - padBottom - layout.height * k) / 2,
    });
  }, [size.w, size.h, layout.width, layout.height, compact]);

  // Stay fitted until the person pans or zooms themselves.
  useEffect(() => {
    if (autoFit.current) fitView();
  }, [fitView]);

  function refit() {
    autoFit.current = true;
    setSmooth(true);
    fitView();
  }

  function zoomBy(factor: number) {
    autoFit.current = false;
    setSmooth(true);
    setView((v) => {
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * factor));
      const mx = size.w / 2;
      const my = size.h / 2;
      return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
    });
  }

  // Wheel / trackpad zoom around the cursor. Gentle: a full mouse-wheel notch
  // (deltaY ≈ 100) is ~8%; pinch gestures arrive as ctrl+wheel with small deltas.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.006 : 0.0008));
      autoFit.current = false;
      setSmooth(false);
      setView((v) => {
        const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * factor));
        return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function toScene(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  }

  function subtreeOf(id: string): Set<string> {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      for (const c of layoutRef.current.childrenOf.get(stack.pop()!) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }

  // ── Pan the canvas ─────────────────────────────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-entity],[data-hud],[data-edge]")) return;
    setSelectedEdge(null);
    if (e.pointerType === "touch") setHoveredId(null);
    const start = { x: e.clientX, y: e.clientY };
    const v0 = viewRef.current;
    let moved = false;
    function move(ev: PointerEvent) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && dx * dx + dy * dy < 9) return;
      if (!moved) {
        moved = true;
        autoFit.current = false;
        setSmooth(false);
        setPanning(true);
      }
      setView({ ...v0, x: v0.x + dx, y: v0.y + dy });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setPanning(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ── Drag an entity onto another to re-parent it ────────────────────────
  function handleCardPointerDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || editingId === id) return;
    if ((e.target as HTMLElement).closest("[data-hud]")) return;
    e.stopPropagation();
    setSelectedEdge(null);
    const start = { x: e.clientX, y: e.clientY };
    const blocked = subtreeOf(id);
    const currentParent = entityById.get(id)?.parentId ?? null;
    let active = false;
    let target: string | null = null;

    function hitTest(p: { x: number; y: number }): string | null {
      const L = layoutRef.current;
      for (const b of L.boxes) {
        if (blocked.has(b.id)) continue;
        if (p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6) {
          return b.id === currentParent ? null : b.id;
        }
      }
      const t = L.tray;
      if (t && currentParent && p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h) return "tray";
      return null;
    }
    function move(ev: PointerEvent) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!active && dx * dx + dy * dy < 25) return;
      active = true;
      const p = toScene(ev.clientX, ev.clientY);
      target = hitTest(p);
      setDrag({ id, x: p.x, y: p.y, target });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!active) {
        // A tap on a touch screen has no hover: keep the card's actions open.
        if (e.pointerType === "touch") setHoveredId(id);
        return;
      }
      if (target === "tray") handleUnlink(id);
      else if (target) handleReparent(id, target);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // Compliance per matched record, scored once per assets snapshot.
  const complianceByName = useMemo(() => {
    const m = new Map<string, Compliance>();
    for (const [name, rec] of Object.entries(assetByName)) {
      const r = entityCompleteness(rec.data);
      m.set(name, { score: r.score, missing: r.missing.map((i) => i.label) });
    }
    return m;
  }, [assetByName]);

  function assetIdFor(id: string): string | undefined {
    const ent = entityById.get(id);
    return ent ? assetByName[ent.name.toLowerCase()]?.id : undefined;
  }

  function complianceFor(id: string): Compliance | null {
    const ent = entityById.get(id);
    return (ent && complianceByName.get(ent.name.toLowerCase())) ?? null;
  }

  function openEntity(id: string) {
    const assetId = assetIdFor(id);
    if (assetId) navigate(`/assets/${assetId}`);
  }

  function handleReparent(id: string, parentId: string) {
    setEntities((prev) => {
      // Join the new parent's children at the end of the row.
      const lastX = Math.max(0, ...prev.filter((e) => e.parentId === parentId).map((e) => e.x ?? 0));
      return prev.map((e) => (e.id === id ? { ...e, parentId, x: lastX + 1 } : e));
    });
  }

  function handleUnlink(id: string) {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, parentId: null } : e)));
    setSelectedEdge(null);
  }

  function handleAttachQB(entityId: string, realmId: string | null) {
    const company = realmId ? qbCompanies.find((c) => c.realm_id === realmId) : null;
    setEntities((prev) =>
      prev.map((e) =>
        e.id === entityId
          ? {
              ...e,
              quickBooksRealmId: realmId || undefined,
              quickBooksName: company?.company_name || undefined,
            }
          : e
      )
    );
    setAttachingId(null);
  }

  function startRename(id: string) {
    const ent = entityById.get(id);
    if (!ent) return;
    setEditingId(id);
    setEditName(ent.name);
  }

  function handleEditSubmit() {
    if (editingId && editName.trim()) {
      setEntities((prev) =>
        prev.map((e) => (e.id === editingId ? { ...e, name: editName.trim() } : e))
      );
    }
    setEditingId(null);
  }

  function handleAddEntity() {
    const id = `entity-${Date.now()}`;
    setEntities((prev) => [...prev, { id, name: "New Entity", parentId: null, x: 0, y: 0 }]);
    setEditingId(id);
    setEditName("New Entity");
  }

  function handleDeleteEntity(id: string) {
    const ent = entityById.get(id);
    if (!ent) return;
    const kids = layout.childrenOf.get(id)?.length ?? 0;
    const note = kids ? ` Its ${kids} ${kids === 1 ? "subsidiary" : "subsidiaries"} will move to Unlinked.` : "";
    if (!confirm(`Remove ${ent.name} from the estate map?${note}`)) return;
    setEntities((prev) =>
      prev.filter((e) => e.id !== id).map((e) => (e.parentId === id ? { ...e, parentId: null } : e))
    );
    setHoveredId(null);
  }

  function handleReset() {
    if (confirm("Reset the estate map to the default structure? This replaces the current links and names for everyone.")) {
      setEntities(INITIAL_ENTITIES);
      refit();
    }
  }

  // Keyboard: F fits, +/- zoom, Delete unlinks the selected connector, Esc clears.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge) {
        e.preventDefault();
        handleUnlink(selectedEdge);
      } else if (e.key === "Escape") {
        setSelectedEdge(null);
      } else if (e.key === "f" || e.key === "F" || e.key === "0") {
        refit();
      } else if (e.key === "+" || e.key === "=") {
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        zoomBy(1 / ZOOM_STEP);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Hovering an entity lights its chain of ownership: up to the trust, and
  // everything it owns below.
  const lit = useMemo(() => {
    const focus = drag ? null : hoveredId;
    if (!focus || !layout.byId.has(focus)) return null;
    const s = subtreeOf(focus);
    let cur = layout.parentOf.get(focus);
    let guard = 0;
    while (cur && guard++ < 100) {
      s.add(cur);
      cur = layout.parentOf.get(cur);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredId, drag, layout]);

  const stats = useMemo(() => {
    const qb = entities.filter((e) => e.quickBooksRealmId).length;
    return { entities: entities.length, branches: layout.branches, levels: layout.levels, qb, unlinked: layout.tray?.count ?? 0 };
  }, [entities, layout]);

  // ── Skins ───────────────────────────────────────────────────────────────
  const ink = isDark ? "text-gray-100" : "text-gray-900";
  const muted = isDark ? "text-gray-500" : "text-gray-500";
  const hudChip = isDark
    ? "border-white/[0.08] bg-[#0b0d14]/80 text-gray-400"
    : "border-gray-200 bg-white/85 text-gray-500";
  const hudBtn = isDark
    ? "border-white/[0.08] bg-[#0b0d14]/80 text-gray-300 hover:text-white hover:border-white/20 hover:bg-white/[0.06]"
    : "border-gray-200 bg-white/90 text-gray-600 hover:text-gray-900 hover:border-gray-300 hover:bg-white";
  const btnClass = isDark
    ? "border border-white/10 hover:border-white/20 text-gray-400 hover:text-white"
    : "border border-gray-200 hover:border-gray-400 text-gray-500 hover:text-gray-900";
  const coarse = "[@media(pointer:coarse)]:h-[40px] [@media(pointer:coarse)]:min-w-[40px]";
  const toolBtn = `${coarse} h-7 min-w-7 px-1.5 inline-flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
    isDark ? "text-gray-400 hover:text-white hover:bg-white/10" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
  }`;

  function metaFor(box: Box, info: ReturnType<typeof describe>): string {
    if (box.kind === "orphan") return `${info.label} · Unlinked`;
    if (box.kind === "root") return `${info.label} · ${box.desc} ${box.desc === 1 ? "entity" : "entities"}`;
    if (box.kids) return `${info.label} · ${box.kids} ${box.kids === 1 ? "subsidiary" : "subsidiaries"}`;
    return info.pct ? `${info.label} · ${info.pct} owned` : info.label;
  }

  function renderCardBody(box: Box, opts: { ghost?: boolean } = {}) {
    const ent = entityById.get(box.id);
    if (!ent) return null;
    const info = describe(ent.name);
    const c = toneColor(box.tone, isDark);
    const leaf = box.kind === "leaf";
    const root = box.kind === "root";
    const orphan = box.kind === "orphan";
    const hovered = hoveredId === box.id && !drag;
    const isTarget = drag?.target === box.id;
    const on = !!lit?.has(box.id);
    const unlit = !!highlight && !highlight.has(ent.name.toLowerCase());
    const dim = (lit ? !on : unlit && !opts.ghost) || (drag && drag.id === box.id && !opts.ghost);
    const glyph = leaf ? 24 : root ? 34 : 30;
    const editing = editingId === box.id && !opts.ghost;
    const qb = !!ent.quickBooksRealmId;
    const ringSize = leaf ? 24 : root ? 32 : 28;

    const ring = isTarget
      ? `0 0 0 1.5px ${c}, 0 0 28px -2px ${c}aa`
      : hovered || on || opts.ghost
        ? `0 0 0 1px ${c}66, 0 0 26px -6px ${c}88${isDark ? "" : ", 0 10px 24px -14px rgba(15,23,42,0.35)"}`
        : root
          ? `0 0 0 1px ${c}40, 0 0 40px -12px ${c}80`
          : undefined;

    return (
      <div
        className={`relative flex h-full items-center gap-2.5 overflow-hidden rounded-xl border px-3 transition-[opacity,box-shadow,border-color] duration-200 ${
          isDark
            ? `${root ? "bg-[#10122a]" : "bg-[#0b0d15]"} border-white/[0.09] ${ink}`
            : `bg-white border-gray-200 ${ink} shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_20px_-16px_rgba(15,23,42,0.3)]`
        } ${orphan ? "border-dashed" : ""}`}
        style={{
          boxShadow: ring,
          borderColor: isTarget || hovered || on ? `${c}80` : undefined,
          opacity: dim ? 0.35 : 1,
        }}
      >
        {/* Hairline accent along the top edge */}
        <span
          className="pointer-events-none absolute inset-x-3 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${c}${root ? "" : "b0"}, transparent)` }}
        />
        {root && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(120% 140% at 50% -40%, ${c}${isDark ? "26" : "14"}, transparent 60%)` }}
          />
        )}
        <span
          className="relative grid shrink-0 place-items-center rounded-lg font-mono font-semibold tracking-tight"
          style={{
            width: glyph,
            height: glyph,
            fontSize: leaf ? 8 : 9.5,
            color: c,
            background: `${c}${isDark ? "1a" : "12"}`,
            boxShadow: `inset 0 0 0 1px ${c}40`,
          }}
        >
          {info.abbr}
        </span>
        <div className="relative min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleEditSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEditSubmit();
                if (e.key === "Escape") setEditingId(null);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              className={`w-full bg-transparent text-[12.5px] font-semibold outline-none border-b ${
                isDark ? "border-white/30 text-white" : "border-gray-400 text-gray-900"
              }`}
            />
          ) : (
            <div
              className={`truncate font-semibold tracking-[-0.01em] ${root ? "text-[14px]" : leaf ? "text-[12px]" : "text-[13px]"}`}
              title={ent.name}
            >
              {info.display}
            </div>
          )}
          <div className={`mt-0.5 truncate text-[10.5px] ${muted}`}>
            {metaFor(box, info)}
          </div>
        </div>
        {qb && (
          <span
            className={`relative inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider ring-1 ${
              isDark ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
            }`}
            title={`QuickBooks: ${ent.quickBooksName || "connected"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            QB
          </span>
        )}
        <ComplianceRing c={complianceFor(box.id)} size={ringSize} isDark={isDark} />
      </div>
    );
  }

  const hoverBox = hoveredId && !drag && !editingId ? layout.byId.get(hoveredId) : undefined;
  const selEdge = selectedEdge ? layout.edges.find((e) => e.id === selectedEdge) : undefined;
  const dragBox = drag ? layout.byId.get(drag.id) : undefined;
  const targetBox = drag?.target && drag.target !== "tray" ? layout.byId.get(drag.target) : undefined;
  const gridSize = 24 * view.k;

  return (
    <div>
      <style>{`
        @keyframes estate-flow { to { stroke-dashoffset: -32; } }
        .estate-flow { animation: estate-flow 1.8s linear infinite; }
        @keyframes estate-live { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
        .estate-live { animation: estate-live 2.4s ease-in-out infinite; }
        @keyframes estate-in { from { opacity: 0; transform: translateY(4px) scale(.98); } to { opacity: 1; transform: none; } }
        .estate-in { animation: estate-in 140ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .estate-flow { animation: none; opacity: 0; }
          .estate-live, .estate-in { animation: none; }
        }
      `}</style>

      {/* Header */}
      {!embedded && (
        <div className="mb-4 flex items-center gap-3">
          <Link
            to="/home"
            aria-label="Back"
            className={`grid h-[40px] w-[40px] lg:h-8 lg:w-8 place-items-center rounded-lg border transition-colors ${
              isDark ? "border-white/10 text-gray-500 hover:text-white hover:border-white/25" : "border-gray-200 text-gray-400 hover:text-gray-900 hover:border-gray-300"
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <div className={`text-[11.5px] font-medium ${muted}`}>Burton Family Office</div>
            <h1 className={`text-[22px] font-semibold leading-tight tracking-[-0.02em] ${ink}`}>Estate Map</h1>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`relative select-none overflow-hidden rounded-2xl border touch-none ${
          panning ? "cursor-grabbing" : "cursor-grab"
        } ${isDark ? "border-white/[0.08] bg-[#05060b]" : "border-gray-200 bg-[#f6f7fb]"}`}
        style={{ height: canvasH ?? (embedded ? "calc(100vh - 240px)" : "calc(100vh - 140px)") }}
        onPointerDown={handleCanvasPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Dot grid that moves with the scene, plus a soft glow behind the trust */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(${isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.09)"} 1px, transparent 1.2px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isDark
              ? "radial-gradient(60% 45% at 50% 0%, rgba(99,102,241,0.12), transparent 70%), radial-gradient(80% 60% at 50% 120%, rgba(56,189,248,0.05), transparent 70%)"
              : "radial-gradient(60% 45% at 50% 0%, rgba(99,102,241,0.08), transparent 70%)",
          }}
        />

        {/* Scene */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: "0 0",
            transition: smooth ? "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
          }}
        >
          {/* Unlinked tray */}
          {layout.tray && (
            <div
              className={`absolute rounded-2xl border border-dashed transition-colors ${
                drag?.target === "tray"
                  ? isDark ? "border-amber-400/70 bg-amber-400/[0.06]" : "border-amber-500/70 bg-amber-50"
                  : isDark ? "border-white/[0.1] bg-white/[0.015]" : "border-gray-300 bg-white/40"
              }`}
              style={{ left: layout.tray.x, top: layout.tray.y, width: layout.tray.w, height: layout.tray.h }}
            >
              <div className={`absolute left-4 top-3 flex items-center gap-2 text-[11px] font-medium ${muted}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Unlinked · {layout.tray.count}
                <span className="normal-case tracking-normal opacity-70">— drag onto an entity to place it in the structure</span>
              </div>
            </div>
          )}

          {/* Connectors */}
          <svg
            className="absolute left-0 top-0 overflow-visible"
            width={layout.width}
            height={layout.height}
            style={{ pointerEvents: "none" }}
          >
            {layout.edges.map((edge) => {
              const c = toneColor(edge.tone, isDark);
              const on = !!lit && lit.has(edge.id) && lit.has(edge.parentId);
              const faded = !!lit && !on;
              const sel = selectedEdge === edge.id;
              return (
                <g key={edge.id} data-edge>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedEdge(edge.id);
                    }}
                  />
                  <path
                    d={edge.d}
                    fill="none"
                    stroke={sel ? (isDark ? "#ffffff" : "#0f172a") : c}
                    strokeOpacity={sel || on ? 0.95 : faded ? 0.1 : isDark ? 0.34 : 0.45}
                    strokeWidth={sel || on ? 1.75 : 1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      pointerEvents: "none",
                      transition: "stroke-opacity 200ms",
                      filter: on && isDark ? `drop-shadow(0 0 3px ${c})` : undefined,
                    }}
                  />
                  {!faded && !sel && (
                    <path
                      className="estate-flow"
                      d={edge.d}
                      fill="none"
                      stroke={c}
                      strokeOpacity={on ? 1 : isDark ? 0.75 : 0.6}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeDasharray="1.5 14.5"
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                </g>
              );
            })}
            {/* Link preview while dragging onto a new parent */}
            {drag && targetBox && dragBox && (
              <path
                d={`M ${targetBox.x + (targetBox.kind === "leaf" ? RAIL : targetBox.w / 2)} ${targetBox.y + targetBox.h} L ${drag.x} ${drag.y - dragBox.h / 2}`}
                fill="none"
                stroke={toneColor(targetBox.tone, isDark)}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                className="estate-flow"
              />
            )}
          </svg>

          {/* Entities */}
          {layout.boxes.map((box) => (
            <div
              key={box.id}
              data-entity
              className={`absolute ${drag?.id === box.id ? "z-10" : "z-20"} ${editingId === box.id ? "cursor-text" : "cursor-grab active:cursor-grabbing"}`}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              onPointerDown={(e) => handleCardPointerDown(e, box.id)}
              onPointerEnter={(e) => e.pointerType !== "touch" && setHoveredId(box.id)}
              onPointerLeave={(e) => e.pointerType !== "touch" && setHoveredId((h) => (h === box.id ? null : h))}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(box.id);
              }}
            >
              {renderCardBody(box)}

              {/* Hover actions */}
              {hoverBox?.id === box.id && (
                // The wrapper's bottom padding bridges the gap to the card, so
                // moving the pointer up onto the toolbar keeps it open.
                <div
                  data-hud
                  className="absolute bottom-full right-0 z-30 w-max pb-1.5"
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                <div
                  className={`estate-in flex items-center gap-0.5 rounded-lg border p-0.5 shadow-lg backdrop-blur-md ${
                    isDark ? "border-white/10 bg-[#11131c]/95 shadow-black/50" : "border-gray-200 bg-white/95 shadow-gray-900/10"
                  }`}
                >
                  {(() => {
                    const c = complianceFor(box.id);
                    if (!c) return null;
                    return (
                      <span
                        title={complianceTitle(c)}
                        className={`h-7 pl-2 pr-2.5 mr-0.5 [@media(pointer:coarse)]:hidden inline-flex items-center gap-1.5 rounded-md text-[11.5px] font-medium tabular-nums whitespace-nowrap ${
                          isDark ? "bg-white/[0.04] text-gray-300" : "bg-gray-50 text-gray-700"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: complianceColor(c.score, isDark) }} />
                        {c.missing.length ? `${c.missing.length} missing` : "All on file"}
                      </span>
                    );
                  })()}
                  <button
                    onClick={() => openEntity(box.id)}
                    disabled={!assetIdFor(box.id)}
                    title={assetIdFor(box.id) ? "Go to the entity page" : "No entity page with this name yet"}
                    className={`h-7 ${coarse} px-2.5 inline-flex items-center gap-1.5 rounded-md text-[11.5px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                      isDark ? "bg-white text-gray-900 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"
                    }`}
                  >
                    Go to entity page
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M7 17L17 7M9 7h8v8" /></svg>
                  </button>
                  <button
                    className={toolBtn}
                    onClick={() => setAttachingId(box.id)}
                    title={entityById.get(box.id)?.quickBooksRealmId ? `QuickBooks: ${entityById.get(box.id)?.quickBooksName ?? ""}` : "Attach QuickBooks"}
                  >
                    <span className="font-mono text-[9px] font-bold">QB</span>
                  </button>
                  <button className={toolBtn} onClick={() => startRename(box.id)} title="Rename">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4L18.5 9.5a2.5 2.5 0 00-3.536-3.536L4.5 16.5 4 20z" /></svg>
                  </button>
                  {layout.parentOf.has(box.id) && (
                    <button className={toolBtn} onClick={() => handleUnlink(box.id)} title="Unlink from parent">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-1 1a4 4 0 105.656 5.656M10.172 13.828a4 4 0 005.656 0l1-1a4 4 0 00-5.656-5.656M4 4l16 16" /></svg>
                    </button>
                  )}
                  {box.kind !== "root" && (
                    <button
                      className={`h-7 min-w-7 ${coarse} px-1.5 inline-flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                        isDark ? "text-gray-400 hover:text-red-400 hover:bg-red-500/10" : "text-gray-500 hover:text-red-600 hover:bg-red-50"
                      }`}
                      onClick={() => handleDeleteEntity(box.id)}
                      title="Remove from map"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5h6v2m-7 0l1 12h6l1-12" /></svg>
                    </button>
                  )}
                </div>
                </div>
              )}
            </div>
          ))}

          {/* Ghost card following the pointer while re-parenting */}
          {drag && dragBox && (
            <div
              className="pointer-events-none absolute z-40"
              style={{
                left: drag.x - dragBox.w / 2,
                top: drag.y - dragBox.h / 2,
                width: dragBox.w,
                height: dragBox.h,
                transform: "rotate(-1.5deg)",
              }}
            >
              {renderCardBody(dragBox, { ghost: true })}
            </div>
          )}

          {/* Selected connector: unlink chip */}
          {selEdge && (
            <button
              data-hud
              className={`estate-in absolute z-30 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg cursor-pointer ${
                isDark ? "border-red-400/40 bg-[#1a0d10] text-red-300 hover:bg-[#2a1015]" : "border-red-200 bg-white text-red-600 hover:bg-red-50"
              }`}
              style={{ left: selEdge.mx, top: selEdge.my }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => handleUnlink(selEdge.id)}
              title="Unlink (Delete)"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" /></svg>
              Unlink
            </button>
          )}
        </div>

        {/* HUD: status + stats */}
        <div data-hud className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 backdrop-blur-md ${hudChip}`}>
            <span className="estate-live h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            Live
          </span>
          <span className={`hidden h-7 items-center gap-3 rounded-lg border px-2.5 backdrop-blur-md sm:inline-flex ${hudChip}`}>
            <span><b className={`font-semibold ${ink}`}>{stats.entities}</b> entities</span>
            <span className="opacity-40">/</span>
            <span><b className={`font-semibold ${ink}`}>{stats.branches}</b> branches</span>
            <span className="opacity-40">/</span>
            <span><b className={`font-semibold ${ink}`}>{stats.levels}</b> levels</span>
            {stats.qb > 0 && (
              <>
                <span className="opacity-40">/</span>
                <span><b className={`font-semibold ${ink}`}>{stats.qb}</b> on QuickBooks</span>
              </>
            )}
          </span>
        </div>

        {/* HUD: controls */}
        <div data-hud className="absolute right-3 top-3 flex items-center gap-1.5">
          <button
            onClick={handleAddEntity}
            aria-label="Add entity"
            className={`inline-flex h-7 ${coarse} justify-center items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium backdrop-blur-md transition-colors cursor-pointer ${hudBtn}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" /></svg>
            <span className="hidden sm:inline">Entity</span>
          </button>
          <div className={`inline-flex h-7 [@media(pointer:coarse)]:h-[42px] items-center rounded-lg border backdrop-blur-md ${hudChip}`}>
            <button
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              className={`grid h-full w-7 [@media(pointer:coarse)]:w-[40px] place-items-center rounded-l-lg transition-colors cursor-pointer ${isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"}`}
              aria-label="Zoom out"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.2} d="M5 12h14" /></svg>
            </button>
            <span className={`w-11 text-center font-mono text-[10.5px] tabular-nums ${ink}`}>{Math.round(view.k * 100)}%</span>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              className={`grid h-full w-7 [@media(pointer:coarse)]:w-[40px] place-items-center rounded-r-lg transition-colors cursor-pointer ${isDark ? "hover:bg-white/[0.06] hover:text-white" : "hover:bg-gray-100 hover:text-gray-900"}`}
              aria-label="Zoom in"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.2} d="M12 5v14m7-7H5" /></svg>
            </button>
          </div>
          <button
            onClick={refit}
            title="Fit to screen (F)"
            aria-label="Fit to screen"
            className={`inline-flex h-7 ${coarse} justify-center items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium backdrop-blur-md transition-colors cursor-pointer ${hudBtn}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" /></svg>
            <span className="hidden sm:inline">Fit</span>
          </button>
          <button
            onClick={handleReset}
            title="Reset to the default structure"
            aria-label="Reset to the default structure"
            className={`grid h-7 w-7 ${coarse} place-items-center rounded-lg border backdrop-blur-md transition-colors cursor-pointer ${hudBtn}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 15a7 7 0 0011.9 2.5M18.5 9A7 7 0 006.6 6.5" /></svg>
          </button>
        </div>

        {/* HUD: hint */}
        <div
          data-hud
          className={`absolute bottom-3 left-3 hidden items-center gap-3 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur-md md:inline-flex ${hudChip}`}
        >
          <span>Hover · actions</span>
          <span className="opacity-40">/</span>
          <span>Drag onto entity · re-parent</span>
          <span className="opacity-40">/</span>
          <span>Double-click · rename</span>
          <span className="opacity-40">/</span>
          <span>Scroll · zoom</span>
          <span className="opacity-40">/</span>
          <span>F · fit</span>
        </div>

        {/* HUD corner brackets */}
        {(["left-2 top-2 border-l border-t", "right-2 top-2 border-r border-t", "left-2 bottom-2 border-l border-b", "right-2 bottom-2 border-r border-b"] as const).map((pos) => (
          <span
            key={pos}
            className={`pointer-events-none absolute h-3 w-3 ${pos} ${isDark ? "border-white/25" : "border-gray-400/50"}`}
          />
        ))}
      </div>

      {/* Attach QuickBooks modal */}
      {attachingId && (() => {
        const entity = entityById.get(attachingId);
        if (!entity) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAttachingId(null)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              onClick={(e) => e.stopPropagation()}
              className={`relative w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl ${
                isDark ? "bg-[#0d0f17] border-white/10" : "bg-white border-gray-200"
              }`}
            >
              <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
              <div className={`p-5 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                <div className={`text-[11px] font-medium ${muted}`}>QuickBooks</div>
                <h3 className={`mt-1 font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Attach a company file</h3>
                <p className={`text-xs mt-1 ${muted}`}>{entity.name}</p>
              </div>
              <div className="p-5">
                {qbCompanies.length === 0 ? (
                  <div className={`text-center py-6 ${muted}`}>
                    <p className="text-xs">No QuickBooks accounts connected.</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {qbCompanies.map((c) => {
                      const isCurrent = entity.quickBooksRealmId === c.realm_id;
                      return (
                        <button
                          key={c.realm_id}
                          onClick={() => handleAttachQB(entity.id, c.realm_id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
                            isCurrent
                              ? isDark ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-green-50 text-green-700 border border-green-300"
                              : isDark ? "hover:bg-white/5 text-gray-300 border border-white/5" : "hover:bg-gray-50 text-gray-700 border border-gray-200"
                          }`}
                        >
                          <span className="truncate">{c.company_name}</span>
                          {isCurrent && (
                            <svg className="w-4 h-4 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className={`p-4 border-t flex items-center justify-between ${isDark ? "border-white/10" : "border-gray-200"}`}>
                {entity.quickBooksRealmId ? (
                  <button
                    onClick={() => handleAttachQB(entity.id, null)}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      isDark ? "text-red-400 hover:bg-red-500/10 border border-red-500/20" : "text-red-600 hover:bg-red-50 border border-red-200"
                    }`}
                  >
                    Detach
                  </button>
                ) : <span />}
                <button
                  onClick={() => setAttachingId(null)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${btnClass}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
