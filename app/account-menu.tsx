import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { displayName, type User } from "./auth";
import { Avatar, Count, Icon, Tooltip, cx, useAnchor, useOverlay, usePresence, useTouch } from "./ui";
import { BottomSheetFrame } from "./ui/overlay";
import { overlayRoot } from "./ui/portal";
import { Glyph } from "./shell-icons";
import { ROLE_LABEL, type Glyph as GlyphName } from "./shell-model";

/**
 * The account row at the foot of the sidebar and the drawer, and the menu it
 * opens (docs/DESIGN.md §9.4, §11.7).
 *
 * The menu: who you are (name, role and address) and the other accounts on
 * this device, with a check on the current one; "Add another account";
 * Settings, Appearance and Notifications; "Log out of <name>" (and of every
 * account, when there are others), in ink; and Terms · Privacy at the foot,
 * for every role. 280px above the row on desktop; a bottom sheet on touch.
 * It is a real menu: focus opens on the current account, the arrow keys,
 * Home, End and type-ahead move, Escape and Tab close it and give focus back.
 */

export type AccountActions = {
  /** Other accounts signed in on this device. */
  others: User[];
  switchTo: (u: User) => void;
  addAccount: () => void;
  openAppearance: () => void;
  /** The theme setting's name, as the Appearance row's hint ("Automatic"). */
  themeLabel: string;
  go: (to: string) => void;
  logout: () => void;
  logoutAll: () => void;
  /** Staff see Notifications. */
  staff: boolean;
  /** Access requests waiting on an owner or admin (0 hides the row). */
  pending: number;
};

const firstName = (u: User | null) => (u?.name?.trim().split(/\s+/)[0] || displayName(u)).trim();
/** The address, allowed to break before its "@" so a long one wraps cleanly in the 280px menu. */
const address = (u: User) => u.mailAddress || u.email || u.phoneFormatted || "";

type Item = { key: string; label: string; onSelect: () => void; lead?: ReactNode; hint?: ReactNode; sub?: string; role?: string; checked?: boolean; strong?: boolean };

export function AccountRow({
  user,
  layout,
  actions,
}: {
  user: User | null;
  /** expanded: the 240px sidebar; drawer: the phone and tablet drawer; collapsed: the 64px rail. */ layout: "expanded" | "drawer" | "collapsed";
  actions: AccountActions;
}) {
  const [open, setOpen] = useState(false);
  const touch = useTouch();
  const sheet = touch;
  const trigger = useRef<HTMLButtonElement | null>(null);
  const { mounted, leaving } = usePresence(open, sheet ? 200 : 120);
  const handle = useOverlay({ open, onClose: () => setOpen(false), kind: "menu", modal: sheet, trigger });
  const pos = useAnchor(open && !sheet, trigger, handle.panelRef);
  const typed = useRef({ text: "", at: 0 });
  const name = displayName(user);
  const others = open ? actions.others : [];

  const run = (fn: () => void) => () => {
    handle.requestClose("action");
    setOpen(false);
    fn();
  };

  const accounts: Item[] = [
    ...(user
      ? [{ key: `acct:${user.id}`, label: name, role: ROLE_LABEL[user.role], sub: address(user), lead: <Avatar name={name} size={24} />, checked: true, strong: true, onSelect: () => {} }]
      : []),
    ...others.map((u) => ({
      key: `acct:${u.id}`,
      label: displayName(u),
      role: ROLE_LABEL[u.role],
      sub: address(u),
      lead: <Avatar name={displayName(u)} size={24} />,
      checked: false,
      onSelect: () => actions.switchTo(u),
    })),
  ];
  const glyph = (g: GlyphName) => <Glyph name={g} />;
  const add: Item = { key: "add", label: "Add another account", lead: <Icon name="plus" />, onSelect: actions.addAccount };
  const pendingRow: Item[] =
    actions.pending > 0
      ? [
          {
            key: "pending",
            label: actions.pending === 1 ? "1 person waiting for access" : `${actions.pending} people waiting for access`,
            lead: glyph("people"),
            hint: <Count n={actions.pending} tone="attention" />,
            onSelect: () => actions.go("/users"),
          },
        ]
      : [];
  const places: Item[] = [
    { key: "settings", label: "Settings", lead: glyph("settings"), onSelect: () => actions.go("/settings") },
    { key: "appearance", label: "Appearance", lead: glyph("theme"), hint: actions.themeLabel, onSelect: actions.openAppearance },
    ...(actions.staff ? [{ key: "notifications", label: "Notifications", lead: glyph("bell"), onSelect: () => actions.go("/notifications") }] : []),
  ];
  const leave: Item[] = [
    { key: "logout", label: `Log out of ${firstName(user)}`, lead: glyph("logout"), onSelect: actions.logout },
    ...(actions.others.length ? [{ key: "logout-all", label: "Log out of all accounts", lead: <span className="size-(--icon)" />, onSelect: actions.logoutAll }] : []),
  ];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nodes = [...(handle.panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % nodes.length;
    else if (e.key === "ArrowUp") next = i <= 0 ? nodes.length - 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const from = typed.current.text.length > 1 ? Math.max(0, i) : i + 1;
      const order = [...nodes.slice(from), ...nodes.slice(0, from)];
      const hit = order.find((n) => (n.dataset.label ?? n.textContent ?? "").toLowerCase().startsWith(typed.current.text));
      if (hit) next = nodes.indexOf(hit);
    } else return;
    e.preventDefault();
    if (next >= 0) nodes[next]?.focus();
  };

  const row = (it: Item) => (
    <button
      key={it.key}
      type="button"
      role={it.key.startsWith("acct:") ? "menuitemradio" : "menuitem"}
      aria-checked={it.key.startsWith("acct:") ? !!it.checked : undefined}
      tabIndex={-1}
      data-label={it.label}
      onClick={run(it.onSelect)}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left text-ink outline-offset-[-2px]! hover:bg-hover focus:bg-hover",
        it.sub ? "min-h-(--row-2) py-2" : sheet ? "min-h-[48px]" : "min-h-(--row-menu)",
        sheet ? "text-body" : "text-small touch:text-body",
      )}
    >
      <span className="flex w-6 shrink-0 justify-center text-ink-2">{it.lead}</span>
      <span className="min-w-0 flex-1 py-[2px]">
        <span className="block break-words">
          <span className={cx(it.strong && "font-semibold")}>{it.label}</span>
          {it.role && <span className="text-ink-2"> · {it.role}</span>}
        </span>
        {it.sub && <span className="block text-small break-words text-ink-2">{it.sub.split("@").map((part, i) => (i ? [<wbr key={i} />, `@${part}`] : part))}</span>}
      </span>
      {it.hint && (typeof it.hint === "string" ? <span className="shrink-0 text-caption text-ink-3">{it.hint}</span> : it.hint)}
      {it.checked && <Icon name="check" className="text-accent" />}
    </button>
  );
  const divider = (k: string) => <div key={k} role="separator" className="my-1 h-px bg-line" />;
  const legal =
    "rounded-mark px-1 text-caption text-ink-2 outline-offset-[-2px]! hover:text-ink hover:underline focus:underline underline-offset-[3px] touch:inline-flex touch:min-h-[44px] touch:items-center";

  const body = (
    <div role="menu" aria-label="Account" onKeyDown={onKeyDown} className={sheet ? "pb-2" : ""}>
      {accounts.map(row)}
      {row(add)}
      {divider("d1")}
      {pendingRow.map(row)}
      {places.map(row)}
      {divider("d2")}
      {leave.map(row)}
      <div role="none" className="flex items-center gap-1 pt-2 pr-2 pb-1 pl-[36px] text-caption text-ink-2">
        <Link to="/legal/terms" role="menuitem" tabIndex={-1} data-label="Terms" onClick={run(() => {})} className={legal}>
          Terms
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/legal/privacy" role="menuitem" tabIndex={-1} data-label="Privacy" onClick={run(() => {})} className={legal}>
          Privacy
        </Link>
      </div>
    </div>
  );

  let panel: ReactNode = null;
  if (mounted) {
    panel = sheet ? (
      <BottomSheetFrame handle={handle} leaving={leaving} title="Account">
        {body}
      </BottomSheetFrame>
    ) : (
      <div
        ref={handle.panelRef}
        style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
        className={cx(
          "ds fixed w-[280px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-card border border-line-strong bg-overlay p-1 text-ink shadow-(--elevation-2)",
          leaving ? "pointer-events-none ds-menu-out" : pos?.above ? "ds-menu-in-up" : "ds-menu-in",
        )}
      >
        {body}
      </div>
    );
  }

  const triggerProps = {
    ref: trigger,
    type: "button" as const,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-label": `${name}: account menu`,
    onClick: () => setOpen((v) => !v),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
    },
  };
  const dot = actions.pending > 0 && <span aria-hidden="true" className="absolute top-0 right-0 size-2 rounded-full bg-warning ring-2 ring-page" />;

  return (
    <>
      {layout === "collapsed" ? (
        <Tooltip label={name}>
          <button {...triggerProps} className="relative flex size-[44px] cursor-pointer items-center justify-center rounded-control hover:bg-hover">
            <span className="relative inline-flex">
              <Avatar name={name} size={32} />
              {dot}
            </span>
          </button>
        </Tooltip>
      ) : (
        <button {...triggerProps} className={cx("flex w-full cursor-pointer items-center gap-3 rounded-control px-3 text-left hover:bg-hover", layout === "drawer" ? "min-h-[56px]" : "min-h-[44px]")}>
          <span className="relative inline-flex">
            <Avatar name={name} size={32} />
            {dot}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-ink">{name}</span>
            {layout === "drawer" && user && <span className="block truncate text-small text-ink-2">{ROLE_LABEL[user.role]}</span>}
          </span>
          <Icon name="chevronUp" size={16} className="text-ink-3" />
        </button>
      )}
      {panel && createPortal(panel, overlayRoot())}
    </>
  );
}
