import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CommandPalette, ShortcutSheet, useGlobalShortcuts, useTrackRecent, type PageLink, type PaletteAction } from "../command-palette";
import { OfflineBanner, RouteProgress } from "../shell-status";
import {
  authFetch,
  beginAddAccount,
  displayName,
  getUser,
  homePath,
  isAdmin,
  isAuthenticated,
  isEmailOnly,
  isPartner,
  loginPath,
  logout,
  logoutAll,
  otherAccounts,
  profileComplete,
  revalidate,
  switchTo,
  SWITCH_IDLE_MS,
  type User,
} from "../auth";
import { useMailCount } from "../mail-client";
import { resetStore } from "../store";
import { useTheme } from "../theme";
import { lockupOf, useBrandLogo } from "../brand";
import { Wordmark } from "../brand-lockup";
import { NavList, RailNav } from "../sidebar-nav";
import { AccountRow, type AccountActions } from "../account-menu";
import { AppearancePanel } from "../appearance-panel";
import { AppLock, confirmIdentity } from "../app-lock";
import { forgetPushDevice, usePush } from "../push";
import { canPreviewGame } from "../sign/preview";
import { Glyph } from "../shell-icons";
import { buildNav, buildPlaces, contentInset, ROLE_LABEL, sidebarMode, SIDEBAR_KEY, THEME_LABEL, type NavEntry, type ShellSize, type SidebarMode } from "../shell-model";
import { Icon, IconButton, Keycap, Tooltip, cx, toast, useMedia, useOverlay, usePresence } from "../ui";
import { overlayRoot } from "../ui/portal";
import { modalAria } from "../shell-overlay";

/**
 * The signed-in shell (docs/DESIGN.md §9): the sidebar, the tablet rail, the
 * phone's top bar and drawer, the account row and menu, the Ask button, and
 * <main>, which every page renders into.
 *
 * - Desktop (1024px and up): a sidebar the person expands (240px) or
 *   collapses (64px), remembered on this device; expanded by default from
 *   1280px. Width and labels change together, with no hover expansion.
 * - Tablet (768–1023): the 64px rail; expanding opens the full sidebar as a
 *   drawer over the content.
 * - Phone: a 52px top bar (menu, the wordmark, search) on every page, and
 *   the drawer from the left.
 * - <main> pads by the gutter (16/24/32), 16 or 32px at the top and 96px at
 *   the bottom, so nothing sits under the Ask button. It makes no stacking
 *   context, so a page's own legacy pop-ups can rise above the shell.
 * - --content-inset on <html> is the sidebar's width: toasts and floating
 *   bars centre on the content with it. --shell-top is the phone top bar's
 *   height (0 elsewhere), for a page's sticky headers.
 *
 * Partners see their entities and email-only members Mail; both can reach
 * Settings (their account) and nothing else. Neither gets search or Ask.
 */

const PHONE = "(width < 48rem)";
const SWITCHED_KEY = "bfo-switched";
const DESKTOP = "(width >= 64rem)";
const WIDE = "(width >= 80rem)";

/** The palette's shortcuts and recents: mounted only for staff. */
function ShellShortcuts({ pages, openPalette, openSheet, toggleSidebar }: { pages: PageLink[]; openPalette: () => void; openSheet: () => void; toggleSidebar: () => void }) {
  useGlobalShortcuts({ openPalette, openSheet, toggleSidebar });
  useTrackRecent(pages);
  return null;
}

/** Remembers the desktop sidebar's state; until the person chooses, it follows the window's width. */
function useSidebarMode(wide: boolean): [SidebarMode, (m: SidebarMode) => void] {
  const [saved, setSaved] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY);
    } catch {
      return null;
    }
  });
  const mode = sidebarMode(saved, wide ? 1280 : 1024);
  const set = useCallback((m: SidebarMode) => {
    setSaved(m);
    try {
      localStorage.setItem(SIDEBAR_KEY, m);
    } catch {
      // Kept for this visit.
    }
  }, []);
  return [mode, set];
}

/** A row that opens the palette, in the expanded sidebar and the tablet's drawer. */
function SearchRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-(--row-menu) w-full cursor-pointer items-center gap-2 rounded-control px-3 text-left text-body text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
    >
      <Icon name="search" />
      <span className="flex-1">Search</span>
      <Keycap keys={["mod", "K"]} />
    </button>
  );
}

/**
 * The drawer: the phone's whole nav, and the tablet's expanded sidebar. From
 * the left, min(85vw, 320px), over the scrim; it follows the theme. Closes
 * on ×, the scrim, a leftward swipe, Escape or choosing a page, and keeps
 * focus inside while it's open.
 */
function Drawer({ open, onClose, nav, header, search, account }: { open: boolean; onClose: () => void; nav: NavEntry[]; header: React.ReactNode; search: React.ReactNode; account: React.ReactNode }) {
  const { mounted, leaving } = usePresence(open, 200);
  const current = useMemo(
    () => ({
      get current() {
        return handle.panelRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? handle.panelRef.current?.querySelector<HTMLElement>("button") ?? null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const handle = useOverlay({ open, onClose, kind: "drawer", initialFocus: current });
  const [shown, setShown] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const t = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(t);
  }, [open]);
  if (!mounted) return null;
  const inView = shown && !leaving;
  return createPortal(
    <div className="ds fixed inset-0">
      {handle.ownsScrim && <div aria-hidden="true" className={cx("absolute inset-0 bg-scrim", leaving ? "ds-scrim-out" : "ds-scrim-in")} onClick={() => handle.requestClose("scrim")} />}
      <aside
        ref={handle.panelRef as unknown as React.RefObject<HTMLElement>}
        {...modalAria("Navigation")}
        inert={handle.covered}
        onTouchStart={(e) => {
          const t = e.touches[0];
          swipe.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const t = e.changedTouches[0];
          if (s.x - t.clientX > 60 && Math.abs(t.clientY - s.y) < 50) handle.requestClose("close");
        }}
        style={{ transform: inView ? "translateX(0)" : "translateX(-100%)", transition: `transform ${leaving ? "var(--dur-3) var(--ease-in)" : "var(--dur-4) var(--ease-out)"}` }}
        className="absolute inset-y-0 left-0 flex w-[min(85vw,320px)] flex-col border-r border-line-strong bg-overlay pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] text-ink shadow-(--elevation-2) outline-none motion-reduce:transition-none!"
      >
        <div className="flex h-[56px] shrink-0 items-center gap-2 pr-2 pl-6">
          {header}
          <IconButton icon="x" label="Close menu" noTooltip className="ml-auto" onClick={() => handle.requestClose("close")} />
        </div>
        {search && <div className="shrink-0 px-3 pb-2">{search}</div>}
        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          <NavList nav={nav} remember={false} onNavigate={onClose} />
        </nav>
        <div className="shrink-0 border-t border-line px-3 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]">{account}</div>
      </aside>
    </div>,
    overlayRoot(),
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const font = lockupOf(useBrandLogo()).font;
  const { setting } = useTheme();

  const [user, setUser] = useState(() => getUser());
  usePush(user?.id ?? null, navigate);
  const partner = isPartner(user);
  const emailOnly = isEmailOnly(user);
  const staff = !partner && !emailOnly;

  // ── Size and the sidebar ──
  const phone = useMedia(PHONE);
  const desktop = useMedia(DESKTOP);
  const wide = useMedia(WIDE);
  const size: ShellSize = phone ? "phone" : desktop ? "desktop" : "tablet";
  const [mode, setMode] = useSidebarMode(wide);
  const expanded = size === "desktop" && mode === "expanded";
  const inset = contentInset(size, mode);
  useLayoutEffect(() => {
    const html = document.documentElement.style;
    html.setProperty("--content-inset", `${inset}px`);
    html.setProperty("--shell-top", size === "phone" ? "calc(52px + env(safe-area-inset-top))" : "0px");
  }, [inset, size]);
  const toggleSidebar = useCallback(() => {
    if (size === "desktop") setMode(mode === "expanded" ? "collapsed" : "expanded");
  }, [size, mode, setMode]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // The drawer belongs to phones and tablets; a desktop-sized window closes it.
  useEffect(() => {
    if (size === "desktop") setDrawerOpen(false);
  }, [size]);
  // The phone's top bar takes a hairline once the page has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 0);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // ── Counts ──
  const mail = useMailCount();
  const [paperUnread, setPaperUnread] = useState(0);
  useEffect(() => {
    if (!staff) return;
    const load = () =>
      authFetch("/api/stable?view=all")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setPaperUnread((j.mail ?? []).filter((m: { readAt: string | null }) => !m.readAt).length))
        .catch(() => {});
    void load();
    const id = window.setInterval(load, 5 * 60_000);
    window.addEventListener("bfo-paper-mail-changed", load);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("bfo-paper-mail-changed", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unread texts to the office's number, for Phone (owners and admins only).
  const [textsUnread, setTextsUnread] = useState(0);
  useEffect(() => {
    if (!isAdmin(user)) return;
    const load = () =>
      authFetch("/api/texts?view=count")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setTextsUnread(j.unread ?? 0))
        .catch(() => {});
    void load();
    // Often enough that a verification code is noticed while it's still good.
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    window.addEventListener("bfo-texts-changed", load);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("bfo-texts-changed", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Partners (invited entity owners) see their entities and nothing else.
  const [myEntities, setMyEntities] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!partner) return;
    let live = true;
    void (async () => {
      const { db, ref, get, authReady } = await import("../store");
      await authReady;
      const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string }>;
      if (live)
        setMyEntities(
          Object.entries(all)
            .map(([id, a]) => ({ id, name: a?.name ?? "Entity" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [partner]);

  useEffect(() => {
    // Refresh the custom entity-initials cache once per session.
    if (!staff) return;
    void import("../books-shared").then((m) => m.hydrateEntityTags());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Signed out: to sign-in, replacing this entry (so Back doesn't bounce
    // straight back to /login) and carrying this page to come back to.
    if (!isAuthenticated()) {
      navigate(loginPath(), { replace: true });
      return;
    }
    // Confirm the session is still good server-side: an owner may have
    // revoked access, or the role may have changed, since the last sign-in.
    void revalidate().then((ok) => {
      if (!ok) {
        navigate(loginPath(), { replace: true });
        return;
      }
      const fresh = getUser();
      setUser(fresh);
      // Collect whatever the profile is missing (see profileComplete).
      if (fresh && !profileComplete(fresh)) navigate("/complete-profile", { replace: true });
    });
  }, [navigate]);

  // Access requests waiting on an owner or admin: a quiet dot on the account and a row in its menu.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!isAdmin(user)) return;
    void (async () => {
      try {
        const res = await authFetch("/api/auth/users");
        if (!res.ok) return;
        const data = (await res.json()) as { users?: { status?: string }[] };
        setPending((data.users ?? []).filter((u) => u.status === "incoming").length);
      } catch {
        // A missing count is not worth surfacing.
      }
    })();
  }, [user]);

  // ── The nav and the palette's places ──
  const nav = useMemo(
    () =>
      buildNav({
        role: user?.role,
        canSeeOther: mail ? mail.canSeeOther : isAdmin(user),
        entities: myEntities,
        mail: { inbox: mail?.unread ?? 0, other: mail?.otherUnread ?? 0, paper: paperUnread },
        texts: textsUnread,
      }),
    [user, mail, myEntities, paperUnread, textsUnread],
  );
  const places = useMemo(() => buildPlaces(nav, { role: user?.role, labs: canPreviewGame(user) }), [nav, user]);
  const pages = useMemo<PageLink[]>(() => places.map((p) => ({ to: p.to, label: p.label, section: p.section, keywords: p.keywords, glyph: p.glyph })), [places]);
  // With nothing typed, the palette offers the nav's sections, then Notes and Settings.
  const goTo = useMemo<PageLink[]>(
    () => [
      ...nav.map((e) => ({ to: e.to, label: e.label, glyph: e.glyph })),
      { to: "/notes", label: "Notes", glyph: "notes" as const },
      { to: "/settings", label: "Settings", glyph: "settings" as const },
    ],
    [nav],
  );

  // After a switch of accounts: who is signed in now.
  useEffect(() => {
    try {
      const who = sessionStorage.getItem(SWITCHED_KEY);
      if (!who) return;
      sessionStorage.removeItem(SWITCHED_KEY);
      toast({ message: `Now signed in as ${who}` });
    } catch {
      // Nothing to say.
    }
  }, []);

  const openPalette = useCallback(() => {
    setDrawerOpen(false);
    setSheetOpen(false);
    setPaletteOpen(true);
  }, []);
  const togglePalette = useCallback(() => {
    if (paletteOpen) setPaletteOpen(false);
    else openPalette();
  }, [paletteOpen, openPalette]);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  // The error page's "Search BFO", and anything else that asks.
  useEffect(() => {
    if (!staff) return;
    window.addEventListener("bfo:open-palette", openPalette);
    return () => window.removeEventListener("bfo:open-palette", openPalette);
  }, [staff, openPalette]);

  if (!isAuthenticated()) return null;

  // ── Accounts ──
  // Switching and signing out reload the app, so nothing one account loaded lingers for the next.
  async function switchToAccount(u: User) {
    // In the iPhone app, Face ID first: a phone left unlocked shouldn't be a tap away from another account.
    if (!(await confirmIdentity("Switch account"))) return;
    const r = switchTo(u.id, { maxIdleMs: SWITCH_IDLE_MS });
    if (r === "ok") {
      // Said once the app has reloaded as them, so nobody acts under the wrong name without knowing.
      try {
        sessionStorage.setItem(SWITCHED_KEY, `${displayName(u)}, ${ROLE_LABEL[u.role]}`);
      } catch {
        // The menu still shows who's signed in.
      }
      window.location.assign(homePath(u));
    } else {
      beginAddAccount();
      resetStore();
      toast({ message: `Sign in again to use ${displayName(u)}’s account.` });
      navigate("/login");
    }
  }
  function addAccount() {
    setDrawerOpen(false);
    beginAddAccount();
    resetStore();
    navigate("/login");
  }
  function signOut(all = false) {
    forgetPushDevice();
    if (all) logoutAll();
    else logout();
    resetStore();
    // The sign-in page, fresh: no other account takes over on its own.
    window.location.assign("/login");
  }
  function go(to: string) {
    setDrawerOpen(false);
    navigate(to);
  }
  const accountActions: AccountActions = {
    others: otherAccounts(),
    switchTo: (u) => void switchToAccount(u),
    addAccount,
    openAppearance: () => {
      setDrawerOpen(false);
      setAppearanceOpen(true);
    },
    themeLabel: THEME_LABEL[setting],
    go,
    logout: () => signOut(false),
    logoutAll: () => signOut(true),
    staff,
    pending: isAdmin(user) ? pending : 0,
  };

  const home = homePath(user);
  const wordmark = (px: number, onClick?: () => void) => (
    <Link to={home} onClick={onClick} aria-label="BFO, Home" className="inline-flex items-center rounded-control text-ink">
      <Wordmark font={font} size={px} />
    </Link>
  );
  const askHere = location.pathname.startsWith("/ask");
  const mailHere = location.pathname.startsWith("/inbox");
  const allowed =
    staff ||
    location.pathname === "/settings" ||
    (emailOnly && location.pathname === "/inbox") ||
    (partner && (location.pathname.startsWith("/assets") || /^\/mailbox\/[^/]+$/.test(location.pathname)));

  return (
    <div className="min-h-dvh bg-page text-ink">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <RouteProgress />

      {/* Tablets and desktops: the sidebar, expanded or as the rail. */}
      {size !== "phone" && (
        <aside aria-label="Sidebar" className="ds fixed inset-y-0 left-0 z-shell flex flex-col border-r border-line bg-page pt-[env(safe-area-inset-top)]" style={{ width: inset }}>
          {expanded ? (
            <>
              <div className="flex h-[56px] shrink-0 items-center gap-2 pr-3 pl-6">
                {wordmark(22)}
                <IconButton icon="sidebar" label="Collapse sidebar" className="ml-auto" onClick={() => setMode("collapsed")} />
              </div>
              {staff && (
                <div className="shrink-0 px-3 pb-2">
                  <SearchRow onOpen={openPalette} />
                </div>
              )}
              <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
                <NavList nav={nav} />
              </nav>
              <div className="shrink-0 border-t border-line px-3 py-2">
                <AccountRow user={user} layout="expanded" actions={accountActions} />
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 flex-col items-center gap-1 pt-3 pb-2">
                <span className="flex h-[32px] items-center">{wordmark(16)}</span>
                <IconButton
                  icon="sidebar"
                  label="Expand sidebar"
                  onClick={() => (size === "desktop" ? setMode("expanded") : setDrawerOpen(true))}
                  aria-expanded={size === "tablet" ? drawerOpen : false}
                />
                {staff && (
                  <Tooltip label="Search">
                    <button
                      type="button"
                      aria-label="Search and jump to"
                      onClick={openPalette}
                      className="flex size-[44px] cursor-pointer items-center justify-center rounded-control text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
                    >
                      <Glyph name="search" size={20} />
                    </button>
                  </Tooltip>
                )}
              </div>
              <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
                <RailNav nav={nav} />
              </nav>
              <div className="flex shrink-0 justify-center border-t border-line py-2">
                <AccountRow user={user} layout="collapsed" actions={accountActions} />
              </div>
            </>
          )}
        </aside>
      )}

      {/* Phones: the top bar on every page, Mail included. */}
      {size === "phone" && (
        <header className={cx("ds fixed inset-x-0 top-0 z-shell border-b bg-page pt-[env(safe-area-inset-top)]", scrolled ? "border-line" : "border-transparent")}>
          <div className="relative flex h-[52px] items-center justify-between px-1">
            <IconButton icon="menu" label="Open menu" noTooltip aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} />
            <span className="absolute left-1/2 -translate-x-1/2">{wordmark(22)}</span>
            {staff ? <IconButton icon="search" label="Search and jump to" noTooltip onClick={openPalette} /> : <span className="size-(--control-sm)" />}
          </div>
        </header>
      )}

      <Drawer
        open={drawerOpen && size !== "desktop"}
        onClose={() => setDrawerOpen(false)}
        nav={nav}
        header={wordmark(22, () => setDrawerOpen(false))}
        search={size === "tablet" && staff ? <SearchRow onOpen={openPalette} /> : null}
        account={<AccountRow user={user} layout="drawer" actions={accountActions} />}
      />

      <main
        id="main"
        tabIndex={-1}
        className={cx(
          "min-w-0 px-(--gutter) outline-none",
          size === "phone" ? "pt-[calc(68px+env(safe-area-inset-top))]" : "pt-[calc(32px+env(safe-area-inset-top))]",
          askHere ? "pb-[calc(16px+env(safe-area-inset-bottom))]" : "pb-[calc(96px+env(safe-area-inset-bottom))]",
        )}
        style={{ marginLeft: inset }}
      >
        {allowed ? <Outlet context={{ pages }} /> : <Navigate to={home} replace />}
      </main>

      {/* Ask BFO, from every page but Ask itself; Mail's Compose has the corner on phones. */}
      {staff && !askHere && (
        <Link
          to="/ask"
          aria-label="Ask BFO"
          title="Ask BFO"
          data-floating
          className={cx(
            "ask-fab ds fixed z-fab flex size-[48px] items-center justify-center rounded-full border border-line-strong bg-overlay! text-ink! shadow-(--elevation-2)! transition-colors duration-(--dur-1) animate-none! hover:bg-hover!",
            mailHere && "max-md:hidden",
          )}
          style={phone ? { right: "calc(16px + env(safe-area-inset-right))", bottom: "calc(16px + env(safe-area-inset-bottom))" } : { right: 24, bottom: 24 }}
        >
          <Icon name="sparkle" size={20} />
        </Link>
      )}

      {staff && (
        <>
          <ShellShortcuts pages={pages} openPalette={togglePalette} openSheet={openSheet} toggleSidebar={toggleSidebar} />
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            pages={pages}
            goTo={goTo}
            onShortcuts={openSheet}
            actions={
              [
                { id: "ask", label: "Ask BFO", hint: "A question about the office", glyph: "sparkle", run: () => navigate("/ask") },
                { id: "appearance", label: "Appearance", hint: THEME_LABEL[setting], glyph: "theme", keywords: "theme dark light mode", run: () => setAppearanceOpen(true) },
                { id: "shortcuts", label: "Keyboard shortcuts", keys: ["?"], glyph: "keyboard", run: () => setSheetOpen(true) },
                { id: "logout", label: `Log out of ${(user?.name?.trim().split(/\s+/)[0] || displayName(user)).trim()}`, glyph: "logout", keywords: "sign out", run: () => signOut(false) },
              ] satisfies PaletteAction[]
            }
          />
          <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
        </>
      )}
      <AppearancePanel open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <AppLock />
      <OfflineBanner />
    </div>
  );
}
