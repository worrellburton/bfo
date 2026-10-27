import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmDialog } from "../confirm-dialog";
import { Button, Icon, TextButton, useTone } from "../entity/ui";
import { mailboxHue } from "../mail-aurora";
import { addAlias, notifyMailChanged, removeAlias } from "../mail-client";
import { useExit } from "./controls";

// ── My addresses ─────────────────────────────────────────────────────────

/**
 * The header's one control for whose mail is shown: "All mailboxes", or one
 * address. Its menu lists every address on the account (mail to each lands
 * here, and each can be sent from), with a copy on each; admins add and
 * remove extras from the same menu. With one address, the button is that
 * address and the menu holds copy and add.
 */
/** A long address on a narrow screen wraps after the @, not mid-word. */
function wrapAddress(a: string) {
  const at = a.indexOf("@");
  return at < 0 ? a : <>{a.slice(0, at + 1)}<wbr />{a.slice(at + 1)}</>;
}

export function MailboxPicker({ address, aliases, box, onChoose, canAdd, big = false, compact = false, unread = 0 }: { address: string; aliases: string[]; box: string; onChoose: (next: string) => void; canAdd: boolean; /** The phone's top: the mailbox is the title. */ big?: boolean; /** The title shrunk into a bar while the list scrolls under it. */ compact?: boolean; unread?: number }) {
  const t = useTone();
  const domain = address.slice(address.indexOf("@") + 1);
  // The server's answer to an add or remove shows at once; the shared count catches up after.
  const [shown, setShown] = useState<string[] | null>(null);
  const list = shown ?? aliases;
  useEffect(() => setShown(null), [aliases]);
  const mine = [address, ...list];
  const [open, setOpen] = useState(false);
  const exit = useExit(open, 180);
  const [copied, setCopied] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The menu sits under the button but inside the screen (a phone's header is narrow and the button sits well in from the left). */
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number; sheet: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      // Phones: a sheet rising from the bottom, within thumb's reach. Larger screens: a menu under the button.
      if (vw < 640) {
        setPlace({ top: r.bottom + 8, left: 12, width: vw - 24, sheet: true });
        return;
      }
      const width = Math.min(360, vw - 32);
      setPlace({ top: r.bottom + 6, left: Math.max(16, Math.min(r.left, vw - 16 - width)), width, sheet: false });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // Outside click or Esc closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const n = e.target as Node;
      if (wrap.current && !wrap.current.contains(n) && !menuRef.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copy(a: string) {
    try {
      await navigator.clipboard.writeText(a);
      setCopied(a);
      setTimeout(() => setCopied((c) => (c === a ? null : c)), 1500);
    } catch {
      // Clipboard refused; the address is on screen.
    }
  }

  async function add() {
    // "accounting" or the whole address; the server checks it's on our domain.
    const local = value.trim();
    if (!local || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { aliases: next } = await addAlias(local);
      setShown(next);
      setValue("");
      setAdding(false);
      notifyMailChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: string) {
    setOpen(false);
    const ok = await confirmDialog({
      title: `Remove ${a}?`,
      message: "Mail sent to it will stop arriving here. Mail already received stays.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { aliases: next } = await removeAlias(a);
      setShown(next);
      if (box === a.toLowerCase()) onChoose("");
      notifyMailChanged();
    } catch (e) {
      setError((e as Error).message);
      setOpen(true);
    }
  }

  const current = mine.find((m) => m.toLowerCase() === box) ?? null;
  const label = mine.length === 1 ? address : current ?? "All mailboxes";
  const localPart = (a: string) => a.slice(0, a.indexOf("@"));
  const hueOf = (a: string) => `hsl(${Math.round(mailboxHue(a) * 360)} 70% ${t.dark ? 62 : 48}%)`;
  /** The mailbox's mark: its initial on its own colour. */
  const bubble = (a: string, size = "h-7 w-7 text-[12px]") => (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${size}`} style={{ background: `linear-gradient(135deg, ${hueOf(a)}, ${hueOf(a + "x")})`, boxShadow: `0 0 18px ${hueOf(a).replace(/\)$/, " / 0.33)")}` }}>
      {a ? localPart(a).slice(0, 1).toUpperCase() : "∗"}
    </span>
  );
  const row = `flex w-full cursor-pointer items-center gap-2.5 px-3 text-left text-[13px] transition-colors max-sm:min-h-[52px] max-sm:gap-3 max-sm:px-3.5 max-sm:text-[14px] sm:h-9 ${t.dark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`;
  const copyBtn = (a: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy(a);
      }}
      aria-label={`Copy ${a}`}
      title="Copy address"
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md max-sm:h-[40px] max-sm:w-[40px] ${copied === a ? (t.dark ? "text-emerald-400" : "text-emerald-600") : t.dark ? "text-gray-500 hover:bg-white/[0.08] hover:text-white" : "text-gray-400 hover:bg-gray-200 hover:text-gray-900"}`}
    >
      <Icon name={copied === a ? "check" : "copy"} className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );

  return (
    <div ref={wrap} className={`relative min-w-0 ${big ? "" : "mt-1"}`}>
      {big ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Mailbox: ${label}. Change`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[44px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl py-1 pr-2 text-left transition-transform active:scale-[0.99]"
        >
          {bubble(current ?? (mine.length === 1 ? address : ""), compact ? "h-8 w-8 text-[13px] transition-all duration-300" : "h-11 w-11 text-[17px] transition-all duration-300")}
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1.5 font-semibold leading-[1.15] tracking-[-0.02em] transition-all duration-300 ${compact ? "text-[15px]" : "text-[19px]"} ${t.text}`}>
              <span className="min-w-0 break-words">{wrapAddress(current ?? (mine.length === 1 ? address : "All mailboxes"))}</span>
              <Icon name="chevronDown" className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${t.muted}`} strokeWidth={2.2} />
              {compact && unread > 0 && <span className={`ml-auto inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold tabular-nums ${t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>{unread}</span>}
            </span>
            <span className={`flex items-center gap-2 overflow-hidden text-[12.5px] transition-all duration-300 ${compact ? "max-h-0 opacity-0" : "mt-0.5 max-h-6 opacity-100"} ${t.muted}`}>
              <span className="truncate">{current ? `${localPart(current)} · ${mine.length > 1 ? `one of ${mine.length} addresses` : "your mailbox"}` : mine.length === 1 ? localPart(address) : `${address}${mine.length > 2 ? ` and ${mine.length - 1} more` : ` and ${mine[1]}`}`}</span>
              {unread > 0 && (
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-px text-[11px] font-semibold tabular-nums ${t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>
                  <span className="unread-glow h-1.5 w-1.5 rounded-full bg-(--mail-accent)" />
                  {unread} unread
                </span>
              )}
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`group/pick inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg py-0.5 pr-1 text-[13px] transition-colors max-sm:min-h-[36px] ${t.muted} ${t.dark ? "hover:text-gray-100" : "hover:text-gray-900"}`}
        >
          {mine.length > 1 && <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
          {mine.length > 1 && !current && <span className={`shrink-0 text-[12px] ${t.faint}`}>· {mine.length}</span>}
          <Icon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${t.faint}`} />
        </button>
      )}

      {exit.shown && place && createPortal(
        <>
          {place.sheet && <div className={`fixed inset-0 z-[64] bg-black/45 backdrop-blur-[2px] ${exit.leaving ? "backdrop-out" : "backdrop-in"}`} onClick={() => setOpen(false)} aria-hidden="true" />}
          <div
            ref={menuRef}
            role="menu"
            aria-label="Mailbox"
            style={{ position: "fixed", top: place.top, bottom: place.bottom !== undefined ? `calc(${place.bottom}px + env(safe-area-inset-bottom))` : undefined, left: place.left, width: place.width }}
            className={`z-[65] overflow-hidden border shadow-2xl ${exit.leaving ? "menu-out" : place.sheet ? "menu-down" : "menu-down"} ${place.sheet ? "rounded-3xl py-2 mail-glass-top" : "rounded-xl py-1"} ${
              t.dark ? (place.sheet ? "border-white/10 bg-[#0f0f16]/85" : "border-white/10 bg-[#101016]") : place.sheet ? "border-gray-200 bg-white/90" : "border-gray-200 bg-white"
            }`}
          >
          {place.sheet && (
            <div className="px-4 pb-2 pt-2">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${t.faint}`}>Show mail for</p>
            </div>
          )}
          {mine.length > 1 && (
            <button type="button" role="menuitemradio" aria-checked={!current} onClick={() => { onChoose(""); setOpen(false); }} className={`${row} ${!current ? t.text : t.soft}`}>
              {place.sheet ? bubble("", "h-9 w-9 text-[14px]") : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">All mailboxes</span>
                {place.sheet && <span className={`block truncate text-[12px] ${t.muted}`}>Everything, in one list</span>}
              </span>
              <span className={`inline-flex h-4 w-4 items-center justify-center ${!current ? t.accent : "opacity-0"}`}>
                <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />
              </span>
            </button>
          )}
          {mine.map((m) => {
            const on = mine.length > 1 ? current?.toLowerCase() === m.toLowerCase() : false;
            const extra = m !== address;
            return (
              <div key={m} className={`${row} ${on ? t.text : t.soft}`} role="none">
                {place.sheet ? bubble(m, "h-9 w-9 text-[14px]") : null}
                {mine.length > 1 ? (
                  <button type="button" role="menuitemradio" aria-checked={on} onClick={() => { onChoose(m.toLowerCase()); setOpen(false); }} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{place.sheet ? localPart(m) : m}</span>
                      {place.sheet && <span className={`block truncate text-[12px] ${t.muted}`}>{m}</span>}
                    </span>
                    <span className={`inline-flex h-4 w-4 items-center justify-center ${on ? t.accent : "opacity-0"}`}>
                      <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />
                    </span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{m}</span>
                )}
                {copyBtn(m)}
                {extra && canAdd && (
                  <button type="button" onClick={() => void remove(m)} aria-label={`Remove ${m}`} title="Remove address" className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md max-sm:h-[40px] max-sm:w-[40px] ${t.dark ? "text-gray-600 hover:bg-white/[0.08] hover:text-white" : "text-gray-400 hover:bg-gray-200 hover:text-gray-900"}`}>
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {canAdd && (
            <div className={`mt-1 border-t px-3 pb-2 pt-2 ${t.line}`}>
              {!adding ? (
                <TextButton onClick={() => { setAdding(true); setError(null); }} className="text-[12.5px]">
                  <Icon name="plus" className="h-3 w-3" strokeWidth={2} />
                  Add address
                </TextButton>
              ) : (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add();
                  }}
                >
                  <label className={`flex h-8 min-w-0 flex-1 items-center rounded-lg border pl-2.5 pr-2 text-[12.5px] max-sm:h-10 ${t.dark ? "border-white/10 bg-white/[0.03] focus-within:border-white/25" : "border-gray-200 bg-white focus-within:border-gray-400"}`}>
                    <span className="sr-only">New address</span>
                    <input
                      autoFocus
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="accounting"
                      spellCheck={false}
                      autoCapitalize="none"
                      autoComplete="off"
                      style={{ outline: "none" }}
                      className={`w-full min-w-0 bg-transparent text-right placeholder:text-gray-500 max-sm:text-[16px] ${t.text}`}
                    />
                    <span className={`shrink-0 ${t.muted}`}>@{domain}</span>
                  </label>
                  <Button kind="primary" type="submit" disabled={busy || !value.trim()}>
                    {busy ? "Adding…" : "Add"}
                  </Button>
                </form>
              )}
              {error && <p className={`mt-1.5 text-[12px] ${t.dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}
            </div>
          )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
