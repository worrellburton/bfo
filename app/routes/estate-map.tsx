/**
 * The ownership map, shown as Entities › Map: each entity under the entity
 * that owns it, with its records score, laid out as a tidy org chart from
 * the ownership on record (layoutEstate). Changing an owner from the map
 * asks the page, which confirms with an effective date; nothing is written
 * here. The old /estate-map address sends people to Entities › Map. Pure
 * pieces (mapEntities, layoutEstate) are tested in tests/estate-map.test.ts.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { entityTag } from "../books-shared";
import { entityType, type EntityType, type PaperworkInput } from "../entity-paperwork";
import { Button, Card, cx, format, Icon, IconButton, Popover, Segmented, Skeleton, usePhone, useTouch } from "../ui";
import { isDissolved, isTrusteeLine, recordsOf, share, type EntityRec } from "./assets-model";

type Entity = {
  id: string;
  name: string;
  parentId: string | null;
  // Hand-placed coordinates from the old free-form canvas. The map now lays
  // itself out, but x still orders siblings left to right.
  x: number;
  y: number;
  /** Owners outside the family's entities (a person, an outside company), with their share. */
  partners?: { name: string; percent: number | null }[];
  /** This entity's own share in its parent's hands, when it isn't 100%. */
  share?: number | null;
  /** A person (or outside company) who owns part of an entity (`of`): shown above it with owners on. */
  person?: { percent: number | null; of: string };
  /** Its legal form as the record has it (entityType), so the card never guesses from the name. */
  type?: EntityType;
};

/** What the map reads from an entity's record. */
type MapAsset = PaperworkInput & { name?: string; ownerId?: string; status?: string; members?: { name: string; percent: number | null; role: string | null }[] };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The map's nodes, from the entities' own records: each under the entity
 * that owns it (ownerId), ordered among its siblings as the old hand-drawn
 * map had them. Owners on its member list that aren't one of the entities
 * (a person, an outside company) show on its card as its other owners; a
 * line naming the owning trust's trustees is the trust itself. Dissolved
 * entities are left off (the map says how many).
 */
export function mapEntities(assets: Record<string, MapAsset>, order: Record<string, number> = {}, opts: { people?: boolean } = {}): Entity[] {
  // `people` is the Owners switch (the storage key keeps its old name).
  const live = Object.entries(assets).filter(([, a]) => a && typeof a.name === "string" && a.name.trim() && !isDissolved(a));
  const ids = new Set(live.map(([id]) => id));
  const names = new Set(live.map(([, a]) => norm(a.name!)));
  return live
    .map(([id, a]) => {
      const owner = a.ownerId && ids.has(a.ownerId) && a.ownerId !== id ? a.ownerId : null;
      const ownerName = owner ? norm(assets[owner].name!) : "";
      const ownerRec = owner ? ({ ...assets[owner], id: owner, name: assets[owner].name! } as EntityRec) : undefined;
      // A member line that is the owning trust's trustees holding title is the trust, not an outside owner.
      const isOwner = (m: { name: string; percent: number | null; role: string | null }) => norm(m.name) === ownerName || isTrusteeLine(m, ownerRec);
      const members = (a.members ?? []).filter((m) => (m?.name && !/manager|director|officer/i.test(m.role ?? "")) || (m?.name && m.percent != null));
      const partners = members.filter((m) => !names.has(norm(m.name)) && !isOwner(m)).map((m) => ({ name: m.name, percent: m.percent ?? null }));
      const mine = members.find(isOwner);
      return {
        id,
        name: a.name!.trim(),
        parentId: owner,
        x: order[norm(a.name!)] ?? 100_000,
        y: 0,
        type: entityType(a),
        ...(partners.length ? { partners } : {}),
        ...(mine && mine.percent != null && mine.percent < 100 ? { share: mine.percent } : {}),
      };
    })
    .sort((x, y) => x.x - y.x || x.name.localeCompare(y.name))
    .flatMap((e) =>
      // With Owners on, each partner is its own card above the entity they own a share of; an
      // entity's owner that is itself an entity is simply its parent, so that line goes up to it.
      opts.people && e.partners?.length ? [e, ...e.partners.map((p, i) => ({ id: `person:${e.id}:${i}`, name: p.name, parentId: null, x: i, y: 0, person: { percent: p.percent, of: e.id } }))] : [e],
    );
}

export const isPerson = (id: string) => id.startsWith("person:");

// ── Geometry (scene px — the whole scene is scaled to fit the canvas) ─────
const CARD_W = 272; // room for a two-line name and the records score
const ROOT_W = 344; // the trust gets room for its full name
const CARD_H = 72;
const LEAF_H = 64;
const INDENT = 26; // stacked children sit this far right of their parent
const RAIL = 14; // x of the stack rail, from the parent's left edge
const STACK_TOP = 14;
const STACK_GAP = 8;
const COL_GAP = 28;
const LEVEL_GAP = 60;
const TREE_GAP = 72;
const R = 9; // elbow corner radius
// An owner's card (a person, an outside company) sits above the entity it owns a share of.
const OWNER_W = 176;
const OWNER_H = 48;
const OWNER_GAP = 16; // the line from the owner down into the entity
const OWNER_STACK = 6; // between two owners of one entity
const TRAY_GAP = 56;
const TRAY_HEAD = 36;
const TRAY_PAD = 16;
const TRAY_ROW_GAP = 12;


// ── Layout ───────────────────────────────────────────────────────────────
type Kind = "root" | "node" | "leaf" | "orphan" | "owner";
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
type Edge = { id: string; parentId: string; d: string; tone: number; mx: number; my: number; /** An owner's line down into an entity: not an ownership link that can be unlinked. */ owner?: boolean };
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
 * A tidy org-chart layout derived purely from the ownership links. The top
 * two levels (the trust, and the holding company under it) spread their
 * children in a row under a shared bus; from the companies in that row down,
 * everything is a vertical outline: each parent lists its children in an
 * indented stack, a subsidiary's own subsidiaries indented one step further
 * under it, so a column stays a column however deep it goes. A parent whose
 * children are all leaves stacks them at any level. Roots with nothing
 * beneath them go to the "Unlinked" tray.
 */
export function layoutEstate(all: Entity[], compact: boolean | number = false, rootW = ROOT_W): Layout {
  // How many levels spread their children in a row: 2 normally, none on a phone-narrow canvas.
  const spread = compact === true ? 0 : compact === false ? 2 : compact;
  // Owners (people, outside companies) aren't part of the tree: each is drawn above the entity it
  // owns a share of, in a band the entity's row or stack leaves for it.
  const ownersOf = new Map<string, Entity[]>();
  for (const e of all) if (e.person) ownersOf.set(e.person.of, [...(ownersOf.get(e.person.of) ?? []), e]);
  const entities = all.filter((e) => !e.person);
  const band = (id: string) => {
    const n = ownersOf.get(id)?.length ?? 0;
    return n ? n * (OWNER_H + OWNER_STACK) - OWNER_STACK + OWNER_GAP : 0;
  };
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

  type Sub = { w: number; h: number; stack: boolean; own: number; cardH: number; /** The owners' band above the children of a row, the tallest any of them needs. */ rowBand: number };
  const subs = new Map<string, Sub>();

  // `own` is the entity's card width, `cardH` its card height, `depth` 0 at
  // a root. Stacked children are indented one step and listed top to bottom,
  // their own children stacked under them in turn; only the top two levels
  // spread children in a row (and on a narrow, compact canvas not even they do).
  function measure(id: string, own: number, cardH: number, depth: number): Sub {
    reached.add(id);
    const ch = kids(id);
    let m: Sub;
    if (!ch.length) {
      m = { w: own, h: cardH, stack: false, own, cardH, rowBand: 0 };
    } else if (depth >= spread || ch.every((c) => !kids(c.id).length)) {
      const childOwn = Math.max(224, own - INDENT);
      let cursor = cardH + STACK_TOP;
      let w = own;
      for (const c of ch) {
        const cm = measure(c.id, childOwn, kids(c.id).length ? CARD_H : LEAF_H, depth + 1);
        // A stacked child with owners has its band above it, inside the stack.
        cursor += band(c.id) + cm.h + STACK_GAP;
        w = Math.max(w, INDENT + cm.w);
      }
      m = { w, h: cursor - STACK_GAP, stack: true, own, cardH, rowBand: 0 };
    } else {
      const ms = ch.map((c) => measure(c.id, CARD_W, CARD_H, depth + 1));
      const w = ms.reduce((s, x) => s + x.w, 0) + COL_GAP * (ms.length - 1);
      // A row's children share a top edge, so the row leaves the tallest band any of them needs.
      const rowBand = Math.max(0, ...ch.map((c) => band(c.id)));
      m = { w: Math.max(own, w), h: cardH + LEVEL_GAP + rowBand + Math.max(...ms.map((x) => x.h)), stack: false, own, cardH, rowBand };
    }
    descMemo.set(
      id,
      ch.reduce((s, c) => s + 1 + (descMemo.get(c.id) ?? 0), 0),
    );
    subs.set(id, m);
    return m;
  }

  // A root is anything without a (valid) parent. Entities caught in a parent
  // cycle are never reached from a root, and land in the tray too.
  const roots = entities.filter((e) => !e.parentId || e.parentId === e.id || !byId.has(e.parentId));
  const trees = roots.filter((r) => kids(r.id).length);
  for (const t of trees) measure(t.id, rootW, CARD_H, 0);
  trees.sort((a, b) => (descMemo.get(b.id) ?? 0) - (descMemo.get(a.id) ?? 0));
  const orphans = entities.filter((e) => !reached.has(e.id));

  const forestW = trees.length ? trees.reduce((s, t) => s + subs.get(t.id)!.w, 0) + TREE_GAP * (trees.length - 1) : 0;
  const forestH = trees.length ? Math.max(...trees.map((t) => subs.get(t.id)!.h + band(t.id))) : 0;

  // Tray geometry first, so the scene width (and the forest's centring) is known. In the
  // single outline its cards are as wide as the outline's top card.
  const OW = spread === 0 ? Math.max(CARD_W, rootW - TRAY_PAD * 2) : CARD_W;
  let tray: Layout["tray"] = null;
  let cols = 1;
  let innerW = 0;
  if (orphans.length) {
    const avail = spread === 0 ? Math.max(forestW, OW + TRAY_PAD * 2) : Math.max(forestW, CARD_W * 3 + COL_GAP * 2 + TRAY_PAD * 2);
    cols = Math.max(1, Math.min(orphans.length, Math.floor((avail - 2 * TRAY_PAD + COL_GAP) / (OW + COL_GAP))));
    const rows = Math.ceil(orphans.length / cols);
    innerW = cols * OW + (cols - 1) * COL_GAP;
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

  /**
   * An entity's owners, stacked above its card (its top edge at cardY), each with a short line
   * down into it. In a row the parent's own line drops into the card's left part, so the owners
   * keep to the right of it; in a stack the parent's rail comes in from the left, so the owners
   * sit over the card, a step in from its left edge.
   */
  function placeOwners(id: string, cardX: number, cardY: number, cardW: number, inRow: boolean) {
    const list = ownersOf.get(id);
    if (!list?.length) return;
    const ox = inRow ? cardX + cardW / 2 - 48 : cardX + 16;
    let y = cardY - OWNER_GAP;
    for (const o of list) {
      y -= OWNER_H;
      boxes.push({ id: o.id, x: ox, y, w: OWNER_W, h: OWNER_H, kind: "owner", tone: -2, kids: 0, desc: 0 });
      const cx = ox + OWNER_W / 2;
      edges.push({ id: o.id, parentId: id, d: `M ${cx} ${y + OWNER_H} V ${cardY}`, tone: -2, mx: cx, my: (y + OWNER_H + cardY) / 2, owner: true });
      y -= OWNER_STACK;
    }
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
          // The child's owners take the band above its card; the rail's elbow comes into the card.
          const top = cursor + band(c.id);
          const my = top + cs.cardH / 2;
          place(c.id, x + INDENT, top, depth + 1, t, kids(c.id).length ? "node" : "leaf");
          placeOwners(c.id, x + INDENT, top, cs.own, false);
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
          cursor = top + cs.h + STACK_GAP;
        });
      }
      return x + cw / 2;
    }
    const ms = ch.map((c) => subs.get(c.id)!);
    const total = ms.reduce((s, c) => s + c.w, 0) + COL_GAP * (ms.length - 1);
    let cx = x + (m.w - total) / 2;
    // The row's children start below the band their owners need (none, when none has owners).
    const childY = y + chH + LEVEL_GAP + m.rowBand;
    const branching = tone === -1 && ch.length > 1;
    const placed = ch.map((c, i) => {
      const t = branching ? toneCounter++ : tone;
      const center = place(c.id, cx, childY, depth + 1, t, "node");
      const owned = !!ownersOf.get(c.id)?.length;
      placeOwners(c.id, center - ms[i].own / 2, childY, ms[i].own, true);
      cx += ms[i].w + COL_GAP;
      // A child with owners takes the parent's line into the left part of its card, leaving the
      // middle to the owners' lines.
      return { id: c.id, center, drop: owned ? center - 72 : center, tone: t };
    });
    const pcx = (placed[0].center + placed[placed.length - 1].center) / 2;
    boxes.push({ id, x: pcx - cw / 2, y, w: cw, h: chH, kind, tone, kids: ch.length, desc });
    const busY = y + chH + LEVEL_GAP / 2;
    for (const p of placed) {
      edges.push({
        id: p.id,
        parentId: id,
        d: elbow(pcx, y + chH, busY, p.drop, childY),
        tone: p.tone,
        mx: p.drop,
        my: busY + (childY - busY) / 2,
      });
      link(id, p.id);
    }
    return pcx;
  }

  let fx = (width - forestW) / 2;
  for (const t of trees) {
    // A root with owners starts below their band.
    const center = place(t.id, fx, band(t.id), 0, -1, "root");
    placeOwners(t.id, center - subs.get(t.id)!.own / 2, band(t.id), subs.get(t.id)!.own, true);
    fx += subs.get(t.id)!.w + TREE_GAP;
  }

  if (tray) {
    const rows = Math.ceil(orphans.length / cols);
    orphans.forEach((o, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = row === rows - 1 ? orphans.length - row * cols : cols;
      const offset = (innerW - (inRow * OW + (inRow - 1) * COL_GAP)) / 2;
      boxes.push({
        id: o.id,
        x: tray!.x + TRAY_PAD + offset + col * (OW + COL_GAP),
        y: tray!.y + TRAY_HEAD + row * (CARD_H + TRAY_ROW_GAP),
        w: OW,
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

/** How a card names each recorded legal form. */
const TYPE_WORD: Record<EntityType, string> = { LLC: "LLC", "C-Corp": "Corporation", LP: "LP", Trust: "Trust" };
/** What an owner of each form is called. */
const OWNER_WORD: Record<EntityType, string> = { LLC: "Member", "C-Corp": "Shareholder", LP: "Partner", Trust: "Beneficiary" };

/** The display name without its designator, and never with a share someone typed into it. */
function shortName(name: string): string {
  return name.replace(/\s*\(\d{1,3}(?:\.\d+)?%\)\s*$/, "").trim() || name;
}

type DragState = { id: string; x: number; y: number; target: string | null };

/** The old /estate-map address: the ownership map lives on Entities now. */
export default function EstateMapRoute() {
  return <Navigate to="/assets?view=map" replace />;
}

export function meta() {
  return [{ title: "Entities · BFO" }];
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
/** The text stays at 12px or more when the map opens: it doesn't fit itself below this. */
const FIT_FLOOR = 0.9;
/** The outline's top card: wide enough that names don't wrap. */
const OUTLINE_W = 480;

/**
 * The ownership map: each entity under the entity that owns it, with its
 * records score. Changing an owner (a drag onto another entity, or "Remove
 * owner") never writes here: it asks the page (`onChangeOwner`), which
 * confirms with an effective date. Without it the map is read-only. On a
 * phone the map is an indented outline in the page, not a canvas.
 */
export function EstateMapView({
  embedded = false,
  highlight = null,
  onAddEntity,
  onChangeOwner,
}: {
  embedded?: boolean;
  /** Entity ids to light (the page's filters); the rest are muted. */
  highlight?: Set<string> | null;
  /** "+ Entity": open the new-entity form. */
  onAddEntity?: () => void;
  /** Change an owner on record, after the page has confirmed it ("" removes the owner). */
  onChangeOwner?: (id: string, ownerId: string) => void;
} = {}) {
  const navigate = useNavigate();
  const phone = usePhone();
  const touch = useTouch();
  const canvasRef = useRef<HTMLDivElement>(null);
  const canChange = !!onChangeOwner;

  const [assets, setAssets] = useState<Record<string, MapAsset> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  /** Sibling order as it was hand-arranged on the old map (by name); new entities go last. */
  const [order, setOrder] = useState<Record<string, number>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panning, setPanning] = useState(false);
  const [canvasH, setCanvasH] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [smooth, setSmooth] = useState(false);
  const autoFit = useRef(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const { db, ref, onValue, get } = await import("../store");
      if (!alive) return;
      // The old hand-drawn map, for the left-to-right order people arranged.
      get(ref(db, "estate-map/entities"))
        .then((snap) => {
          const raw = snap.val();
          const nodes: Entity[] = raw ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean) : [];
          setOrder(Object.fromEntries(nodes.map((n) => [n.name.trim().toLowerCase(), n.x ?? 0])));
        })
        .catch(() => {});
      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        setAssets((snapshot.val() ?? {}) as Record<string, MapAsset>);
        setUpdatedAt(new Date());
      });
    })();
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const [people, setPeople] = useState(() => {
    try {
      return localStorage.getItem("bfo-map-people") === "1";
    } catch {
      return false;
    }
  });
  function showPeople(on: boolean) {
    setPeople(on);
    try {
      localStorage.setItem("bfo-map-people", on ? "1" : "0");
    } catch {
      // The map still works; it just won't remember.
    }
  }
  const entities = useMemo(() => (assets ? mapEntities(assets, order, { people }) : []), [assets, order, people]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const recs = useMemo(
    () =>
      new Map(
        Object.entries(assets ?? {})
          .filter(([, a]) => a && typeof a.name === "string")
          .map(([id, a]) => [id, { ...a, id, name: a.name!, type: entityType(a) } as EntityRec]),
      ),
    [assets],
  );
  const records = useMemo(() => new Map([...recs.values()].map((r) => [r.id, recordsOf(r, recs)])), [recs]);
  const dissolved = [...recs.values()].filter(isDissolved).length;
  const ready = !!assets;

  // The org chart (the top two levels spread in rows, or one) when it fits the window with its
  // text legible; otherwise a single wide outline in a canvas as tall as it needs, so the page
  // scrolls to the end of it and nothing sits out of view.
  const layouts = useMemo(() => ({ wide: layoutEstate(entities, 2), mid: layoutEstate(entities, 1), outline: layoutEstate(entities, 0, OUTLINE_W) }), [entities]);
  const room = size.w - 48;
  const windowH = (canvasH ?? 560) - (touch ? 72 : 56) - 24;
  const fits = (L: Layout) => room >= L.width * FIT_FLOOR && windowH >= L.height * FIT_FLOOR;
  const layout = size.w > 0 && size.w < 640 ? layouts.outline : fits(layouts.wide) ? layouts.wide : fits(layouts.mid) ? layouts.mid : layouts.outline;
  const grown = layout === layouts.outline && size.w > 0;
  const grownH = grown ? Math.ceil((touch ? 72 : 56) + 24 + layout.height * Math.min(1, room / layout.width)) : null;
  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ── Canvas sizing: fill the window below the toolbar ─────────────────
  useLayoutEffect(() => {
    function measure() {
      const el = canvasRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setCanvasH(Math.max(480, Math.min(900, window.innerHeight - Math.min(top, window.innerHeight * 0.4) - 32)));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [embedded, phone, ready]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone, ready]);

  /** Room above the scene for the controls, so no card starts under them. */
  const band = touch ? 72 : 56;
  const fitView = useCallback(
    (all = false) => {
      if (!size.w || !size.h || !layout.width) return;
      const pad = 24;
      const kw = (size.w - pad * 2) / layout.width;
      const kh = (size.h - band - pad) / Math.max(1, layout.height);
      let k = Math.min(kw, kh, grown ? 1 : 1.1);
      if (!all) k = Math.max(k, Math.min(kw, FIT_FLOOR, 1.1));
      k = Math.max(ZOOM_MIN, k);
      const w = layout.width * k;
      const h = layout.height * k;
      setView({ k, x: w <= size.w - pad * 2 ? (size.w - w) / 2 : pad, y: h <= size.h - band - pad ? band + (size.h - band - pad - h) / 2 : band });
    },
    [size.w, size.h, layout.width, layout.height, band, grown],
  );

  // Stay fitted (after the view switch, the data's arrival, a resize) until the person pans or zooms.
  useEffect(() => {
    if (autoFit.current) fitView();
  }, [fitView]);

  function refit() {
    autoFit.current = true;
    setSmooth(true);
    fitView(true);
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

  // Zoom with a pinch or ⌘/Ctrl and the wheel; a plain wheel scrolls the page, as everywhere else.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      const factor = Math.exp(-delta * 0.006);
      autoFit.current = false;
      setSmooth(false);
      setView((v) => {
        const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.k * factor));
        return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [phone, ready]);

  // Two fingers on a tablet: zoom around them, and pan with them.
  const pinching = useRef(false);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let start: { d: number; m: { x: number; y: number }; v: typeof viewRef.current } | null = null;
    const two = (e: TouchEvent) => {
      const rect = el.getBoundingClientRect();
      const [a, b] = [e.touches[0], e.touches[1]];
      return {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        m: { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top },
      };
    };
    function onStart(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      pinching.current = true;
      autoFit.current = false;
      setSmooth(false);
      start = { ...two(e), v: viewRef.current };
    }
    function onMove(e: TouchEvent) {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const { d, m } = two(e);
      const v0 = start.v;
      const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v0.k * (d / start.d)));
      const px = (start.m.x - v0.x) / v0.k;
      const py = (start.m.y - v0.y) / v0.k;
      setView({ k, x: m.x - px * k, y: m.y - py * k });
    }
    function onEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        start = null;
        if (!e.touches.length) pinching.current = false;
      }
    }
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [phone, ready]);

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

  // ── Pan ────────────────────────────────────────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-entity],[data-hud],[data-edge]")) return;
    setSelectedEdge(null);
    if (e.pointerType === "touch") setHoveredId(null);
    const start = { x: e.clientX, y: e.clientY };
    const v0 = viewRef.current;
    let moved = false;
    function move(ev: PointerEvent) {
      if (pinching.current) return;
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

  // ── Drag an entity onto another: the page confirms the new owner ───────
  function handleCardPointerDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || isPerson(id)) return;
    if ((e.target as HTMLElement).closest("[data-hud]")) return;
    e.stopPropagation();
    setSelectedEdge(null);
    if (!canChange) {
      if (e.pointerType === "touch") setHoveredId(id);
      return;
    }
    const start = { x: e.clientX, y: e.clientY };
    const blocked = subtreeOf(id);
    const currentParent = entityById.get(id)?.parentId ?? null;
    let active = false;
    let target: string | null = null;
    function hitTest(p: { x: number; y: number }): string | null {
      const L = layoutRef.current;
      for (const b of L.boxes) {
        if (blocked.has(b.id) || isPerson(b.id)) continue;
        if (p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6) return b.id === currentParent ? null : b.id;
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
        if (e.pointerType === "touch") setHoveredId(id);
        return;
      }
      if (target === "tray") onChangeOwner?.(id, "");
      else if (target) onChangeOwner?.(id, target);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const openEntity = (id: string) => !isPerson(id) && navigate(`/assets/${id}`);

  // Keys, while the map has focus: F fits, + and − zoom, Delete asks to remove the selected owner link.
  function onCanvasKey(e: React.KeyboardEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedEdge && canChange) {
      e.preventDefault();
      onChangeOwner?.(selectedEdge, "");
    } else if (e.key === "Escape") setSelectedEdge(null);
    else if (e.key === "f" || e.key === "F" || e.key === "0") refit();
    else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
  }

  // Hovering (or focusing) an entity lights its chain: up to the top, and everything it owns.
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
  }, [hoveredId, drag, layout]);

  // The share each entity's chain holds from the top (effective ownership), where every link's share is known.
  const effective = useMemo(() => {
    const out = new Map<string, number | null>();
    const visit = (id: string, above: number | null) => {
      out.set(id, above);
      for (const c of layout.childrenOf.get(id) ?? []) {
        if (isPerson(c)) continue;
        const e = entityById.get(c);
        const share = e?.share ?? (e?.partners?.length ? null : 100);
        visit(c, above == null || share == null ? null : (above * share) / 100);
      }
    };
    for (const b of layout.boxes) if (b.kind === "root") visit(b.id, 100);
    return out;
  }, [layout, entityById]);

  const stats = { entities: entities.filter((e) => !e.person).length, levels: layout.levels, unlinked: layout.tray?.count ?? 0 };

  function metaFor(box: Box): string {
    const ent = entityById.get(box.id)!;
    if (ent.person) {
      const owned = entityById.get(ent.person.of);
      const word = owned ? OWNER_WORD[owned.type ?? "LLC"] : "Owner";
      return `${word} · ${ent.person.percent != null ? `${share(ent.person.percent)} of ` : "share not recorded in "}${owned ? shortName(owned.name) : "it"}`;
    }
    const type = TYPE_WORD[ent.type ?? "LLC"];
    if (box.kind === "orphan") return type;
    if (box.kind === "root") {
      const all = [...subtreeOf(box.id)].filter((id) => id !== box.id && !isPerson(id));
      const whole = all.filter((id) => effective.get(id) === 100).length;
      return `${type} · ${format.count(all.length, "entity", "entities")}${whole < all.length ? `, ${whole} wholly owned` : ""}`;
    }
    const parts = [type];
    const others = ent.partners?.length ?? 0;
    if (ent.share != null) parts.push(`${share(ent.share)} held`);
    else if (others) parts.push("share not recorded");
    if (others) parts.push(`${format.count(others, "other owner")}`);
    if (!others) {
      const subs = (layout.childrenOf.get(box.id) ?? []).filter((c) => !isPerson(c)).length;
      if (subs) parts.push(format.count(subs, "subsidiary", "subsidiaries"));
    }
    return parts.join(" · ");
  }

  function scoreOf(id: string) {
    const r = records.get(id);
    if (!r) return null;
    const g = r.tone === "positive" ? { icon: "check" as const, cls: "text-positive" } : r.tone === "warning" ? { icon: "warning" as const, cls: "text-warning" } : r.tone === "negative" ? { icon: "x" as const, cls: "text-negative" } : null;
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-small text-ink tabular-nums" title={r.conflicts.length ? `Records disagree: ${r.conflicts.map((c) => c.title).join("; ")}` : `Records ${r.score}%`}>
        {g && (
          <span className={cx("inline-flex", g.cls)}>
            <Icon name={g.icon} size={16} />
          </span>
        )}
        {r.score}%
      </span>
    );
  }

  function markOf(ent: Entity) {
    const rec = recs.get(ent.id);
    const text = ent.person ? format.initials(ent.name) : rec?.initials || entityTag(ent.name);
    return (
      <span aria-hidden="true" className={cx("inline-flex h-6 min-w-[40px] shrink-0 items-center justify-center bg-sunken px-1 text-caption font-medium text-ink-2", ent.person ? "rounded-full" : "rounded-mark")}>
        {text}
      </span>
    );
  }

  function renderCard(box: Box, ghost = false) {
    const ent = entityById.get(box.id);
    if (!ent) return null;
    const hovered = hoveredId === box.id && !drag;
    const target = drag?.target === box.id;
    const on = !!lit?.has(box.id);
    const unlit = !!highlight && !ent.person && !highlight.has(box.id);
    const quiet = (lit ? !on : unlit) && !ghost;
    return (
      <div
        className={cx(
          "flex h-full items-center gap-3 rounded-card border px-3",
          box.kind === "orphan" ? "border-dashed" : "",
          target || hovered || ghost ? "border-accent" : on ? "border-edge" : box.kind === "orphan" ? "border-edge" : "border-line",
          quiet ? "bg-sunken" : "bg-raised",
          ghost && "shadow-(--elevation-2)",
        )}
      >
        {markOf(ent)}
        <div className="min-w-0 flex-1">
          <div className={cx("line-clamp-2 break-words", box.kind === "root" ? "text-section" : "text-body font-medium", quiet ? "text-ink-2" : "text-ink")} title={ent.name}>
            {shortName(ent.name)}
          </div>
          <div className={cx("truncate text-small", quiet ? "text-ink-3" : "text-ink-2")}>{metaFor(box)}</div>
        </div>
        {!ent.person && scoreOf(box.id)}
      </div>
    );
  }

  const hoverBox = hoveredId && !drag ? layout.byId.get(hoveredId) : undefined;
  const selEdge = selectedEdge ? layout.edges.find((e) => e.id === selectedEdge) : undefined;
  const dragBox = drag ? layout.byId.get(drag.id) : undefined;
  const targetBox = drag?.target && drag.target !== "tray" ? layout.byId.get(drag.target) : undefined;
  // Part of the scene past the canvas's edge: say so, so nobody counts short.
  const outOfView =
    size.w > 0 && (view.x < -2 || view.y < band - 40 || view.x + layout.width * view.k > size.w + 2 || view.y + layout.height * view.k > size.h + 2);

  // The structure as a nested list, for screen readers (and the phone outline).
  const tree = useMemo(() => {
    type Node = { id: string; depth: number };
    const out: Node[] = [];
    const walk = (id: string, depth: number) => {
      out.push({ id, depth });
      for (const c of layout.childrenOf.get(id) ?? []) if (!isPerson(c)) walk(c, depth + 1);
    };
    for (const b of layout.boxes) if (b.kind === "root") walk(b.id, 0);
    const orphans = layout.boxes.filter((b) => b.kind === "orphan").map((b) => ({ id: b.id, depth: 0 }));
    return { rows: out, orphans };
  }, [layout]);

  const describe = (id: string) => {
    const box = layout.byId.get(id);
    const r = records.get(id);
    return box ? `${entityById.get(id)?.name ?? ""}, ${metaFor(box)}${r ? `, records ${r.score}%` : ""}` : "";
  };

  if (!assets) {
    return phone ? <Skeleton kind="card" rows={6} /> : <div className="ds h-[480px] rounded-card border border-line bg-sunken" aria-busy="true" />;
  }

  // ── Phones: the outline in the page ────────────────────────────────────
  if (phone) {
    const row = (id: string, depth: number) => (
      <li key={id} className="border-b border-line last:border-b-0">
        <Link to={`/assets/${id}`} className="flex min-h-(--row-2) items-center gap-3 py-2 pr-4" style={{ paddingLeft: 16 + depth * 12 }}>
          {markOf(entityById.get(id)!)}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 break-words text-ink">{shortName(entityById.get(id)!.name)}</span>
            <span className="truncate text-small text-ink-2">{layout.byId.get(id) ? metaFor(layout.byId.get(id)!) : ""}</span>
          </span>
          {scoreOf(id)}
        </Link>
      </li>
    );
    return (
      <div className="ds flex flex-col gap-4">
        <Card title="Ownership" flush>
          <ul aria-label="Ownership">{tree.rows.map((r) => row(r.id, r.depth))}</ul>
        </Card>
        {tree.orphans.length > 0 && (
          <Card title="Owner not recorded" count={tree.orphans.length} flush>
            <ul aria-label="Owner not recorded">{tree.orphans.map((r) => row(r.id, 0))}</ul>
          </Card>
        )}
        {dissolved > 0 && <p className="text-small text-ink-2">{format.count(dissolved, "dissolved entity", "dissolved entities")} not shown.</p>}
      </div>
    );
  }

  return (
    <div className="ds flex flex-col gap-2">
      {!embedded && <h2 className="sr-only">Ownership map</h2>}
      <div
        ref={canvasRef}
        role="application"
        aria-label="Ownership map. Use the outline that follows to read it by keyboard."
        tabIndex={-1}
        onKeyDown={onCanvasKey}
        className={cx("relative overflow-hidden rounded-card border border-line bg-sunken select-none", grown ? "touch-pan-y" : "touch-none", panning ? "cursor-grabbing" : "cursor-grab")}
        style={{ height: grownH ?? canvasH ?? 560 }}
        onPointerDown={handleCanvasPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Scene */}
        <div
          className="absolute top-0 left-0"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: "0 0",
            transition: smooth ? "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)" : undefined,
          }}
        >
          {layout.tray && (
            <div
              className={cx("absolute rounded-card border border-dashed", drag?.target === "tray" ? "border-accent bg-accent-tint" : "border-edge")}
              style={{ left: layout.tray.x, top: layout.tray.y, width: layout.tray.w, height: layout.tray.h }}
            >
              <div className="absolute top-2 right-4 left-4 flex min-w-0 items-center gap-2 text-small text-ink-2">
                <span className="shrink-0 font-medium whitespace-nowrap text-ink">Owner not recorded · {layout.tray.count}</span>
                {canChange && <span className="min-w-0 truncate">Drag one onto its owner to record it</span>}
              </div>
            </div>
          )}

          <svg className="absolute top-0 left-0 overflow-visible" width={layout.width} height={layout.height} style={{ pointerEvents: "none" }} aria-hidden="true">
            {layout.edges.map((edge) => {
              const on = !!lit && lit.has(edge.id) && lit.has(edge.parentId);
              const sel = selectedEdge === edge.id;
              const child = entityById.get(edge.id);
              const unknown = !edge.owner && !!child?.partners?.length && child.share == null;
              return (
                <g key={edge.id} data-edge>
                  {!edge.owner && canChange && (
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
                  )}
                  <path
                    d={edge.d}
                    fill="none"
                    className={sel ? "stroke-accent" : on ? "stroke-ink-3" : "stroke-edge"}
                    strokeWidth={sel || on ? 2 : 1}
                    strokeDasharray={unknown || edge.owner ? "4 4" : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
            {drag && targetBox && dragBox && (
              <path
                d={`M ${targetBox.x + (targetBox.kind === "leaf" ? RAIL : targetBox.w / 2)} ${targetBox.y + targetBox.h} L ${drag.x} ${drag.y - dragBox.h / 2}`}
                fill="none"
                className="stroke-accent"
                strokeWidth={1.5}
                strokeDasharray="5 5"
              />
            )}
          </svg>

          {layout.boxes.map((box) => (
            <div
              key={box.id}
              data-entity
              role={isPerson(box.id) ? undefined : "link"}
              tabIndex={isPerson(box.id) ? undefined : 0}
              aria-label={isPerson(box.id) ? undefined : describe(box.id)}
              className={cx("absolute rounded-card", drag?.id === box.id ? "z-10" : "z-20", canChange && !isPerson(box.id) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              onPointerDown={(e) => handleCardPointerDown(e, box.id)}
              onPointerEnter={(e) => e.pointerType !== "touch" && setHoveredId(box.id)}
              onPointerLeave={(e) => e.pointerType !== "touch" && setHoveredId((h) => (h === box.id ? null : h))}
              onFocus={() => setHoveredId(box.id)}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHoveredId((h) => (h === box.id ? null : h))}
              onDoubleClick={() => openEntity(box.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) openEntity(box.id);
              }}
            >
              {renderCard(box)}
              {hoverBox?.id === box.id && !isPerson(box.id) && (
                // The wrapper's padding bridges the gap to the card, so moving up onto the actions keeps them open.
                <div data-hud className="absolute right-0 bottom-full z-30 w-max pb-2" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 rounded-card border border-line-strong bg-overlay p-1 shadow-(--elevation-2)">
                    <Button size="sm" variant="quiet" onClick={() => openEntity(box.id)}>
                      Open entity
                    </Button>
                    {canChange && (
                      <Button size="sm" variant="quiet" onClick={() => onChangeOwner?.(box.id, entityById.get(box.id)?.parentId ?? "")}>
                        Change owner…
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {drag && dragBox && (
            <div className="pointer-events-none absolute z-40" style={{ left: drag.x - dragBox.w / 2, top: drag.y - dragBox.h / 2, width: dragBox.w, height: dragBox.h }}>
              {renderCard(dragBox, true)}
            </div>
          )}

          {selEdge && canChange && (
            <div data-hud className="absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: selEdge.mx, top: selEdge.my }} onPointerDown={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => onChangeOwner?.(selEdge.id, "")}>
                Remove owner…
              </Button>
            </div>
          )}
        </div>

        {/* Controls: what's shown, and when it's from; then the view. */}
        <div data-hud className="absolute top-3 left-3 flex flex-wrap items-center gap-2 text-small text-ink-2">
          <span className="inline-flex h-(--control-sm) items-center rounded-control border border-line bg-raised px-3 tabular-nums">
            {format.count(stats.entities, "entity", "entities")} · {format.count(stats.levels, "level")}
            {dissolved ? ` · ${dissolved} dissolved not shown` : ""}
            {updatedAt ? ` · updated ${format.time(updatedAt)}` : ""}
          </span>
        </div>
        <div data-hud className="absolute top-3 right-3 flex items-center gap-2">
          <Segmented
            label="Show"
            value={people ? "owners" : "entities"}
            onChange={(v) => showPeople(v === "owners")}
            options={[
              { value: "entities", label: "Entities" },
              { value: "owners", label: "With owners" },
            ]}
          />
          <span className="inline-flex items-center rounded-control border border-line bg-raised">
            <IconButton icon="minus" label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} />
            <span className="w-12 text-center text-small text-ink tabular-nums" aria-live="polite">
              {Math.round(view.k * 100)}%
            </span>
            <IconButton icon="plus" label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} />
          </span>
          <Button size="sm" onClick={refit}>
            Fit
          </Button>
          {onAddEntity && !embedded && (
            <Button size="sm" icon="plus" onClick={onAddEntity}>
              Entity
            </Button>
          )}
          <Popover label="Using the map" align="end" trigger={<IconButton icon="info" label="Using the map" variant="secondary" />}>
            <ul className="flex flex-col gap-2 text-body text-ink-2">
              <li>{touch ? "Tap an entity" : "Point at an entity"} to light the chain that owns it and what it owns; open it from there.</li>
              <li>{touch ? "Drag the background to move around; pinch to zoom." : "Drag the background to move around. Pinch, or hold ⌘ or Ctrl and scroll, to zoom. F fits the map."}</li>
              {canChange && <li>To change an owner, drag the entity onto its new owner, or choose a line and Remove owner. You confirm it, with an effective date, before anything is recorded.</li>}
              <li>A dashed line is an owner whose share isn&apos;t on record.</li>
            </ul>
          </Popover>
        </div>
        {outOfView && (
          <div data-hud className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <Button size="sm" onClick={refit}>
              Part of the map is out of view · Fit
            </Button>
          </div>
        )}
      </div>

      {/* The same structure as a nested list, for keyboards and screen readers. */}
      <div className="sr-only">
        <h3>Ownership outline</h3>
        <ul>
          {tree.rows.map((r) => (
            <li key={r.id} style={{ marginLeft: r.depth * 12 }}>
              <Link to={`/assets/${r.id}`}>{describe(r.id)}</Link>
            </li>
          ))}
        </ul>
        {tree.orphans.length > 0 && (
          <>
            <h3>Owner not recorded</h3>
            <ul>
              {tree.orphans.map((r) => (
                <li key={r.id}>
                  <Link to={`/assets/${r.id}`}>{describe(r.id)}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
