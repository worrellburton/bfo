/**
 * The shell's rules, free of React and the DOM so they're tested on their own
 * (tests/shell.test.ts): which theme is on screen, how wide the sidebar is,
 * what the nav holds for each role, how Mail's counts foot, which places the
 * command palette can jump to, and which letters of a result matched.
 * docs/DESIGN.md §2.1, §9, §14.2.
 */

import type { Role } from "./auth";

// ── Theme (§2.1, §14.2) ──────────────────────────────────────────────────

/** The one theme setting, kept per device: Automatic follows the device. */
export type ThemeSetting = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "bfo-theme";

/** A stored value read back; anything unknown is Automatic. */
export function parseThemeSetting(raw: string | null | undefined): ThemeSetting {
  return raw === "light" || raw === "dark" ? raw : "auto";
}

/** What's on screen for a setting, given whether the device prefers dark. */
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): Theme {
  return setting === "auto" ? (prefersDark ? "dark" : "light") : setting;
}

/** The browser chrome's colour for a theme (§2.6). */
export const THEME_COLOR: Record<Theme | "door", string> = { light: "#f7f7f8", dark: "#0b0b0c", door: "#05060b" };

export const THEME_LABEL: Record<ThemeSetting, string> = { auto: "Automatic", light: "Light", dark: "Dark" };

// ── The sidebar (§9.1–9.3) ───────────────────────────────────────────────

export type SidebarMode = "expanded" | "collapsed";
export type ShellSize = "phone" | "tablet" | "desktop";

export const SIDEBAR_KEY = "bfo-sidebar";
export const SIDEBAR_EXPANDED = 240;
export const SIDEBAR_COLLAPSED = 64;

/** Phone under 768px, tablet 768–1023, desktop 1024 and up. */
export function shellSize(width: number): ShellSize {
  return width < 768 ? "phone" : width < 1024 ? "tablet" : "desktop";
}

/** The desktop sidebar's state: the person's choice, else expanded from 1280px and collapsed below. */
export function sidebarMode(saved: string | null | undefined, width: number): SidebarMode {
  if (saved === "expanded" || saved === "collapsed") return saved;
  return width >= 1280 ? "expanded" : "collapsed";
}

/** How far the content sits from the left edge: nothing on a phone, the rail on a tablet, the sidebar on a desktop. */
export function contentInset(size: ShellSize, mode: SidebarMode): number {
  if (size === "phone") return 0;
  if (size === "tablet") return SIDEBAR_COLLAPSED;
  return mode === "expanded" ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;
}

// ── The nav (§9) ─────────────────────────────────────────────────────────

/** The shell's glyphs (app/shell-icons.tsx draws them). */
export type Glyph =
  | "home"
  | "mail"
  | "phone"
  | "entities"
  | "treasury"
  | "investments"
  | "books"
  | "tools"
  | "people"
  | "settings"
  | "bell"
  | "notes"
  | "map"
  | "page"
  | "legal"
  | "sparkle"
  | "theme"
  | "keyboard"
  | "logout"
  | "search"
  | "clock"
  | "lab";

export type NavLeaf = {
  to: string;
  label: string;
  /** A count that needs the person (unread). Shown once, where the items live. */
  count?: number;
  /** For a group's pages that share a path (Mail's folders, told apart by ?f=). */
  match?: { path: string; param: string; value: string; fallback?: boolean };
};

export type NavEntry = NavLeaf & {
  id: string;
  glyph: Glyph;
  /** Pages under it (Mail, Books, Tools): a group. */
  children?: NavLeaf[];
  /** Starts a new block of the nav, after 16px of space. */
  gapBefore?: boolean;
};

export type MailCounts = {
  /** Unread in the inbox. */
  inbox: number;
  /** Unread mail to addresses nobody has yet (owners and admins). */
  other: number;
  /** Unread paper mail (staff). */
  paper: number;
};

export type NavViewer = {
  role: Role | null | undefined;
  /** Mail to unclaimed addresses: owners and admins, and anyone given access. */
  canSeeOther: boolean;
  /** A partner's own entities. */
  entities?: { id: string; name: string }[];
  mail?: Partial<MailCounts>;
  /** Unread texts to the office (owners and admins). */
  texts?: number;
};

const isStaff = (role: Role | null | undefined) => role === "owner" || role === "admin" || role === "member" || role === "viewer";
const isAdminRole = (role: Role | null | undefined) => role === "owner" || role === "admin";

const folder = (value: string, fallback = false) => ({ path: "/inbox", param: "f", value, fallback });

/** The nav for this viewer: staff see the office, partners their entities, email-only members Mail. */
export function buildNav(v: NavViewer): NavEntry[] {
  const m = { inbox: 0, other: 0, paper: 0, ...v.mail };
  const emailOnly = v.role === "email";
  const mailChildren: NavLeaf[] = [
    { to: "/inbox", label: "Active", match: folder("active", true) },
    { to: "/inbox?f=inbox", label: "Inbox", count: m.inbox, match: folder("inbox") },
    { to: "/inbox?f=sent", label: "Sent", match: folder("sent") },
    { to: "/inbox?f=archive", label: "Archive", match: folder("archive") },
    ...(v.canSeeOther ? [{ to: "/inbox?f=other", label: "Unclaimed", count: m.other, match: folder("other") }] : []),
    ...(emailOnly ? [] : [{ to: "/mailbox", label: "Paper mail", count: m.paper }]),
  ];
  const mail: NavEntry = { id: "mail", to: "/inbox", label: "Mail", glyph: "mail", children: mailChildren, count: groupCount(mailChildren) };
  if (emailOnly) return [mail];
  if (v.role === "partner") {
    return (v.entities ?? []).map((e) => ({ id: `entity:${e.id}`, to: `/assets/${e.id}`, label: e.name, glyph: "entities" as const }));
  }
  if (!isStaff(v.role)) return [];
  return [
    { id: "home", to: "/home", label: "Home", glyph: "home" },
    mail,
    ...(isAdminRole(v.role) ? [{ id: "phone", to: "/phone", label: "Phone", glyph: "phone" as const, count: v.texts ?? 0 }] : []),
    { id: "entities", to: "/assets", label: "Entities", glyph: "entities", gapBefore: true },
    { id: "treasury", to: "/treasury", label: "Treasury", glyph: "treasury" },
    { id: "investments", to: "/investments", label: "Investments", glyph: "investments" },
    {
      id: "books",
      to: "/books/transactions",
      label: "Books",
      glyph: "books",
      children: [
        { to: "/books/transactions", label: "Transactions" },
        { to: "/books/review", label: "Review" },
        { to: "/books/calendar", label: "Recurring" },
        { to: "/books/reports", label: "Reports" },
        { to: "/books/vendors", label: "Vendors" },
        { to: "/books/rules", label: "Rules" },
        { to: "/books/loans", label: "Loans" },
      ],
    },
    {
      id: "tools",
      to: "/msas",
      label: "Tools",
      glyph: "tools",
      children: [
        { to: "/msas", label: "MSAs" },
        { to: "/tools/signatures", label: "Signatures" },
        { to: "/tools/compliance", label: "Entity compliance" },
      ],
    },
  ];
}

/** A group's count is the sum of the counts on the pages it shows, so it foots. */
export function groupCount(children: NavLeaf[]): number {
  return children.reduce((s, c) => s + Math.max(0, c.count ?? 0), 0);
}

/** Whether a nav page is the one on screen. */
export function leafActive(leaf: NavLeaf, pathname: string, search: string): boolean {
  if (leaf.match) {
    if (pathname !== leaf.match.path) return false;
    const v = new URLSearchParams(search).get(leaf.match.param);
    return v === leaf.match.value || (!v && !!leaf.match.fallback);
  }
  const path = leaf.to.split("?")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The group holding the page on screen, if any. */
export function activeGroup(nav: NavEntry[], pathname: string, search: string): string | null {
  return nav.find((e) => e.children?.some((c) => leafActive(c, pathname, search)))?.id ?? null;
}

// ── The command palette's places (§8.19, §11.7, §12.3) ───────────────────

export type PlaceLink = { to: string; label: string; section?: string; keywords?: string; glyph?: Glyph };

/**
 * Every place the palette can jump to, in nav order, then the pages that
 * aren't in the nav. Keywords carry the words people type for them (an
 * accountant's "trial balance", "1099").
 */
export function buildPlaces(nav: NavEntry[], o: { role: Role | null | undefined; labs?: boolean }): PlaceLink[] {
  const words: Record<string, string> = {
    "/inbox": "email messages",
    "/inbox?f=inbox": "email messages unread",
    "/inbox?f=sent": "email messages outgoing",
    "/inbox?f=other": "email unowned addresses",
    "/mailbox": "post letters scans stable",
    "/phone": "texts sms verification codes",
    "/assets": "llc trust companies structure",
    "/treasury": "bank cash balances accounts",
    "/investments": "brokerage holdings positions cost basis",
    "/books/transactions": "ledger general ledger categorize",
    "/books/review": "reconciliation tie-out uncategorized",
    "/books/calendar": "recurring payments forecast schedule",
    "/books/reports": "p&l profit loss income statement",
    "/books/vendors": "1099 payee contractor w-9",
    "/books/rules": "categorization automatic",
    "/books/loans": "notes receivable payable amortization principal interest",
    "/tools/signatures": "e-sign docusign agreements",
    "/tools/compliance": "annual reports filings registered agent deadlines",
  };
  const list: PlaceLink[] = [];
  for (const e of nav) {
    if (e.children) for (const c of e.children) list.push({ to: c.to, label: c.label, section: e.label, keywords: words[c.to], glyph: e.glyph });
    else list.push({ to: e.to, label: e.label, keywords: words[e.to], glyph: e.glyph });
  }
  if (!isStaff(o.role)) return list;
  list.push(
    { to: "/books/reports", label: "Profit & loss", section: "Books", keywords: "p&l income statement reports", glyph: "books" },
    { to: "/books/reports?view=balance", label: "Balance sheet", section: "Books", keywords: "assets liabilities equity net worth reports", glyph: "books" },
    { to: "/books/reports?view=statements", label: "Statements", section: "Books", keywords: "trial balance cash flow 1099 general ledger reports", glyph: "books" },
    { to: "/estate-map", label: "Estate map", section: "Entities", keywords: "structure ownership tree", glyph: "map" },
    { to: "/treasury/mappings", label: "Account mappings", section: "Treasury", keywords: "bank accounts entities", glyph: "treasury" },
    { to: "/notes", label: "Notes", glyph: "notes" },
    { to: "/notifications", label: "Notifications", keywords: "alerts email report", glyph: "bell" },
    { to: "/settings", label: "Settings", keywords: "profile preferences account device", glyph: "settings" },
  );
  if (isAdminRole(o.role)) list.push({ to: "/users", label: "People", keywords: "users access approve invite roles", glyph: "people" });
  if (o.labs) {
    list.push(
      { to: "/games", label: "Games", section: "Labs", keywords: "signing preview play", glyph: "lab" },
      { to: "/home-animations", label: "Front-door gallery", section: "Labs", keywords: "landing backdrop animation", glyph: "lab" },
    );
  }
  list.push(
    { to: "/legal/terms", label: "Terms of use", keywords: "legal terms", glyph: "legal" },
    { to: "/legal/privacy", label: "Privacy policy", keywords: "legal privacy data delete", glyph: "legal" },
  );
  return list;
}

/** Where a place's recent visit is remembered: per account, so the next person on this browser doesn't see it. */
export const recentKey = (userId: string) => `bfo-recent:${userId}`;

// ── Matching (§8.19: emphasis by weight) ─────────────────────────────────

/** Score a label (and its hint and keywords) against a lower-cased query: prefix 4, word start 3, anywhere 2, every word 1; 0 is no match. */
export function scoreMatch(label: string, extra: string, q: string): number {
  if (!q) return 1;
  const l = label.toLowerCase();
  const hay = `${l} ${extra.toLowerCase()}`;
  if (l.startsWith(q)) return 4;
  if (l.split(/[\s,·/&-]+/).some((w) => w.startsWith(q))) return 3;
  if (hay.includes(q)) return 2;
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w)) ? 1 : 0;
}

/** The [start, end) spans of `text` that the query matched, for drawing them in 600: the whole query where it appears, else each word's first appearance. */
export function matchRanges(text: string, q: string): Array<[number, number]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const t = text.toLowerCase();
  const whole = t.indexOf(query);
  if (whole >= 0) return [[whole, whole + query.length]];
  const out: Array<[number, number]> = [];
  for (const w of query.split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(w);
    if (i >= 0 && !out.some(([a, b]) => i < b && i + w.length > a)) out.push([i, i + w.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ── App lock (lawyer and CPA findings) ───────────────────────────────────

/** Who may not turn the iPhone app's lock off: anyone who can see the office's codes or change the books. */
export function lockRequired(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

// ── Accounts ─────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  email: "Email only",
  partner: "Entity owner",
};
