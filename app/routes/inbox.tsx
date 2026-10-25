import { FormatBar, MailEditor, type MailEditorHandle } from "../mail-editor";
import { composeText, htmlFromPlain } from "../../lib/mail-compose";
import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useBlocker, useLocation, useNavigate, useSearchParams } from "react-router";
import { getUser, isAdmin } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import { Button, Dot, ErrorLine, Icon, IconButton, TextButton, buttonClass, formatBytes, useTone } from "../entity/ui";
import { MailFrame, htmlToText } from "../mail-frame";
import { MailAurora, mailboxHue } from "../mail-aurora";
import { BusyLabel, ListLoader, Orbit, ReaderLoader, SearchLoader } from "../mail-loaders";
import { PullToRefresh } from "../mail-pull";
import { FileIcon, FileKindIcons } from "../file-icon";
import { fileKind } from "../../lib/file-kind";
import { filterFlags, filterOf } from "../../lib/mail-filter";
import { useTheme } from "../theme";
import { haptic } from "../native";
import { phoneScreen, supportsViewTransitions, transition } from "../view-transition";
import {
  addAlias,
  attachmentUrl,
  deleteMail,
  getFaces,
  getMessage,
  getThread,
  listMail,
  markRead,
  moveMail,
  notifyMailChanged,
  removeAlias,
  removeMailPhoto,
  improveMail,
  sendMail,
  setMailPhoto,
  starMail,
  syncMail,
  useMailCount,
  type MailAddress,
  type MailAttachment,
  type MailFaces,
  type MailFilter,
  type MailFolder,
  type MailMessage,
  type MailSummary,
  type OutgoingAttachment,
} from "../mail-client";

export function meta() {
  return [{ title: "BFO - Mail" }];
}

// ── Small helpers ────────────────────────────────────────────────────────

const GLYPHS = {
  reply: "M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3",
  replyAll: "M7.5 15l-6-6 6-6M12 15L6 9l6-6M6 9h8.25a6 6 0 010 12H13.5",
  forward: "M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3",
  archive:
    "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z",
  unarchive:
    "M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M2.25 13.838V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z",
  clip: "M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13",
  star: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  rows: "M3.75 5.25h16.5M3.75 9.75h16.5M3.75 14.25h16.5M3.75 18.75h16.5",
  columns: "M9 4.5v15m6-15v15M3 6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v10.5a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 17.25V6.75z",
  chats:
    "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
  inbox:
    "M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3",
  send: "M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5",
  at: "M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364",
  unread: "M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z",
} as const;

function Glyph({ name, className = "h-3.5 w-3.5" }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={GLYPHS[name]} />
    </svg>
  );
}

/** IconButton with one of this page's glyphs. */
function GlyphButton({ glyph, label, tone = "ghost", className = "", glyphClassName, ...rest }: { glyph: keyof typeof GLYPHS; label: string; tone?: "ghost" | "danger"; glyphClassName?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { dark } = useTone();
  const t =
    tone === "danger"
      ? dark ? "text-gray-500 hover:bg-red-500/10 hover:text-red-400" : "text-gray-400 hover:bg-red-50 hover:text-red-600"
      : dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      // Added to the button's own classes, never in place of them (a caller's size only adds a phone size).
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-40 max-sm:h-[40px] max-sm:w-[40px] ${t} ${className}`}
    >
      <Glyph name={glyph} className={glyphClassName} />
    </button>
  );
}

const nameOf = (a: MailAddress) => a.name?.trim() || a.email;

/** Mailboxes where the part before @ is the person, not the company. */
const PERSONAL_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|fastmail|hey|comcast|att|verizon|sbcglobal)\.(com|net|me|ch|org)$/i;

/**
 * Who a message is from, as a person would say it: the display name, else the
 * person's handle for personal mailboxes, else the company from the domain
 * ("no-reply-3ksj…@mail.anthropic.com" → "Anthropic"). The full address is
 * always one tap away in the reader.
 */
function senderLabel(a: MailAddress): string {
  const name = a.name?.trim();
  if (name) return name;
  const [local = "", domain = ""] = a.email.toLowerCase().split("@");
  if (!domain) return a.email;
  if (PERSONAL_MAIL.test(domain)) return local.split("+")[0] || a.email;
  const parts = domain.split(".").filter(Boolean);
  // Drop the TLD (and a country second level like .co.uk), then any mail/email/mg subdomain.
  let labels = parts.slice(0, parts.length > 2 && parts[parts.length - 2].length <= 3 ? -2 : -1);
  labels = labels.filter((l) => !/^(mail|email|e|mg|smtp|mailer|send|notify|notifications?|news|info|m|em|bounce|bounces)\d*$/.test(l));
  const brand = labels[labels.length - 1] || parts[0];
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** A steady hue per sender, so the same person always gets the same colour. */
function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** The company's domain for a logo ("mail.anthropic.com" → "anthropic.com"), or null for a person. */
function brandDomain(a: MailAddress): string | null {
  const domain = a.email.toLowerCase().split("@")[1] ?? "";
  if (!domain || PERSONAL_MAIL.test(domain)) return null;
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Keep a country second level (co.uk); otherwise the last two labels.
  const keep = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/** Logos that loaded, and domains that have none — so a list doesn't flicker as it re-renders. */
const logoState = new Map<string, "ok" | "none">();

/** The pictures people here chose for their mail, by address (lowercase). */
const FacesContext = createContext<MailFaces>({});

/**
 * Who the message is from, at a glance: the picture they chose, when they're
 * one of us and picked one; a company's logo when the sender is a company
 * (fetched by domain; falls back to initials if there is none); else initials
 * in a colour that is always the same for that person.
 */
function Avatar({ a, size = "h-10 w-10 text-[13px]", trusted = true }: { a: MailAddress; size?: string; trusted?: boolean }) {
  // A From that SPF/DKIM don't vouch for could be forged: never dress it in a colleague's photo.
  const faces = useContext(FacesContext);
  const photo = trusted ? faces[a.email.toLowerCase()] : undefined;
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (photo && broken !== photo) {
    // The initials show until the picture has arrived; then it fades in over them.
    return (
      <span aria-hidden="true" className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${size}`}>
        {loaded !== photo && (
          <span className="absolute inset-0">
            <InitialsAvatar a={a} size={`h-full w-full ${size.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`} />
          </span>
        )}
        <img
          src={photo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`relative h-full w-full object-cover transition-opacity duration-300 ${loaded === photo ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(photo)}
          onError={() => setBroken(photo)}
        />
      </span>
    );
  }
  return <InitialsAvatar a={a} size={size} />;
}

function InitialsAvatar({ a, size }: { a: MailAddress; size: string }) {
  const { dark } = useTone();
  const domain = brandDomain(a);
  const [logo, setLogo] = useState<"ok" | "none" | "loading">(() => (domain ? (logoState.get(domain) ?? "loading") : "none"));
  useEffect(() => {
    setLogo(domain ? (logoState.get(domain) ?? "loading") : "none");
  }, [domain]);
  const hue = hueOf(a.email.toLowerCase());
  const label = senderLabel(a);
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
  const showLogo = domain && logo !== "none";
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${size} ${
        showLogo ? (dark ? "bg-white ring-1 ring-white/10" : "bg-white ring-1 ring-gray-200") : ""
      }`}
      style={showLogo ? undefined : { background: dark ? `hsl(${hue} 40% 22%)` : `hsl(${hue} 70% 92%)`, color: dark ? `hsl(${hue} 70% 80%)` : `hsl(${hue} 50% 32%)` }}
    >
      {showLogo ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`h-[62%] w-[62%] object-contain transition-opacity ${logo === "ok" ? "opacity-100" : "opacity-0"}`}
          onLoad={(e) => {
            // Google answers a tiny default globe when a site has no icon; treat that as none.
            const img = e.currentTarget;
            const none = img.naturalWidth <= 16;
            logoState.set(domain, none ? "none" : "ok");
            setLogo(none ? "none" : "ok");
          }}
          onError={() => {
            logoState.set(domain, "none");
            setLogo("none");
          }}
        />
      ) : (
        initials
      )}
      {showLogo && logo === "loading" && <span className="absolute inset-0 animate-pulse bg-gray-200/40" />}
    </span>
  );
}

const fullAddress = (a: MailAddress) => (a.name?.trim() ? `${a.name.trim()} <${a.email}>` : a.email);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Time today, "Oct 3" this year, else "3/4/25". */
/** A snippet stored before the server learned to leave out a help desk's wrapping: the same tidy, on the way in. */
function cleanSnippet(snippet: string): string {
  let out = snippet;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/^\s*(#+-?\s*please type your reply above this line\s*-?#+|[-_=*]{4,}|\[[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+\])\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s*(this (?:email|message) is a service from\b.*|delivered by zendesk.*|sent from my (?:iphone|ipad|android|galaxy|phone).*)$/i, "").trim();
}

/** "Today", "Yesterday", a weekday within the week, else the date: the phone list's separators. */
function dayGroup(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function listDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

const FOLDERS: { key: MailFolder; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inbox", label: "In" },
  { key: "sent", label: "Out" },
  { key: "archive", label: "Archive" },
  { key: "other", label: "Other" },
];

const EMPTY: Record<MailFolder, string> = {
  active: "No conversations yet.",
  inbox: "No mail yet.",
  sent: "Nothing sent yet.",
  archive: "Nothing archived.",
  other: "Nothing here.",
};

// ── My addresses ─────────────────────────────────────────────────────────

/**
 * The header's one control for whose mail is shown: "All mailboxes", or one
 * address. Its menu lists every address on the account (mail to each lands
 * here, and each can be sent from), with a copy on each; admins add and
 * remove extras from the same menu. With one address, the button is that
 * address and the menu holds copy and add.
 */
function MailboxPicker({ address, aliases, box, onChoose, canAdd, big = false, compact = false, unread = 0 }: { address: string; aliases: string[]; box: string; onChoose: (next: string) => void; canAdd: boolean; /** The phone's top: the mailbox is the title. */ big?: boolean; /** The title shrunk into a bar while the list scrolls under it. */ compact?: boolean; unread?: number }) {
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
              <span className="min-w-0 break-all">{current ?? (mine.length === 1 ? address : "All mailboxes")}</span>
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

// ── My picture ───────────────────────────────────────────────────────────

/** The side of the square picture we keep: sharp at every size the inbox shows. */
const PHOTO_PX = 256;

/**
 * A picture file as a small square JPEG (a data: URL): cropped from the middle,
 * or a little above it on a portrait, where a face usually is.
 */
async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That picture couldn't be read. Try a JPEG or PNG."));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("That picture couldn't be read. Try a JPEG or PNG.");
    const side = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PHOTO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare pictures.");
    ctx.imageSmoothingQuality = "high";
    // A transparent PNG goes on white, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PHOTO_PX, PHOTO_PX);
    ctx.drawImage(img, (w - side) / 2, h > w ? (h - side) * 0.25 : (h - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * My face beside the title: the picture shown with my mail in everyone's
 * inbox here. Click it to choose one, or to go back to initials.
 */
function MyPhoto({ address, name, onFaces }: { address: string; name: string | null; onFaces: (faces: MailFaces) => void }) {
  const t = useTone();
  const has = !!useContext(FacesContext)[address.toLowerCase()];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function save(work: () => Promise<{ faces: MailFaces }>) {
    setBusy(true);
    setError(null);
    try {
      onFaces((await work()).faces);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const item = `flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] disabled:cursor-default disabled:opacity-50 max-sm:min-h-[44px] ${t.dark ? "text-gray-200 hover:bg-white/[0.05]" : "text-gray-800 hover:bg-gray-50"}`;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="Your picture for mail"
        title="Your picture for mail"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className={`group/photo relative block cursor-pointer rounded-full transition-shadow focus-visible:outline-none ${t.dark ? "focus-visible:ring-2 focus-visible:ring-white/40" : "focus-visible:ring-2 focus-visible:ring-gray-400"}`}
      >
        <Avatar a={{ email: address, name }} size="h-11 w-11 text-[14px]" />
        <span
          aria-hidden="true"
          className={`absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover/photo:opacity-100"}`}
        >
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="upload" className="h-4 w-4" strokeWidth={2} />}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void save(async () => setMailPhoto(await squarePhoto(f)));
        }}
      />
      {open && (
        <div
          className={`absolute left-0 top-full z-30 mt-2 w-[240px] overflow-hidden rounded-xl border py-1 shadow-lg ${t.dark ? "border-white/10 bg-[#111114]" : "border-gray-200 bg-white"}`}
        >
          <p className={`px-3 pb-1.5 pt-2 text-[11.5px] leading-[1.45] ${t.muted}`}>Shown beside your mail in everyone's inbox here.</p>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={item}>
            <Icon name="upload" />
            {busy ? "Saving…" : has ? "Choose a new picture" : "Choose a picture"}
          </button>
          {has && (
            <button type="button" disabled={busy} onClick={() => void save(removeMailPhoto)} className={item}>
              <Icon name="trash" />
              Use my initials
            </button>
          )}
          {error && <p className={`px-3 pb-2 pt-1 text-[12px] ${t.dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Compose drafts ───────────────────────────────────────────────────────

type Draft = {
  title: string;
  /** Which of my addresses it goes out from; the main one when unset. */
  from?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  replyToId?: string;
  forwardId?: string;
  /** Forward: the original's files, re-attached by the server. */
  carried: MailAttachment[];
  /** Where the cursor starts. */
  focus: "to" | "body";
};

const prefixed = (prefix: "Re" | "Fwd", subject: string) => {
  const s = subject.trim();
  const has = prefix === "Re" ? /^re:/i.test(s) : /^(fwd?|fw):/i.test(s);
  return has ? s : `${prefix}: ${s}`;
};

function bodyText(m: MailMessage): string {
  return (m.text ?? (m.html ? htmlToText(m.html) : "")).replace(/\r\n/g, "\n").trimEnd();
}

function quoted(m: MailMessage): string {
  const lines = bodyText(m)
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`));
  return `\n\nOn ${fullDate(m.occurredAt)}, ${nameOf(m.from)} wrote:\n${lines.join("\n")}`;
}

function uniqueEmails(list: MailAddress[], exclude: string[]): string[] {
  const out: string[] = [];
  for (const a of list) {
    if (!a.email || exclude.some((e) => same(e, a.email)) || out.some((e) => same(e, a.email))) continue;
    out.push(a.email);
  }
  return out;
}

/** `mine`: every address of mine, main first. The reply goes out from the one the message reached me at. */
function replyDraft(m: MailMessage, mode: "reply" | "all", mine: string[]): Draft {
  // Replying to your own sent mail goes back to the people it went to.
  const targets = m.direction === "out" ? m.to : [m.from];
  const to = uniqueEmails(targets, m.direction === "out" ? mine : []);
  const cc = mode === "all" ? uniqueEmails([...(m.direction === "out" ? [] : m.to), ...m.cc], [...mine, ...to]) : [];
  const via = m.direction === "out" ? m.from.email : m.deliveredTo;
  const from = mine.find((a) => via && same(a, via));
  return {
    title: mode === "all" ? "Reply all" : "Reply",
    ...(from ? { from } : {}),
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: "",
    subject: prefixed("Re", m.subject),
    text: quoted(m),
    replyToId: m.id,
    carried: [],
    focus: "body",
  };
}

function forwardDraft(m: MailMessage): Draft {
  const head = [
    "---------- Forwarded message ----------",
    `From: ${fullAddress(m.from)}`,
    `Date: ${fullDate(m.occurredAt)}`,
    `Subject: ${m.subject}`,
    `To: ${m.to.map(fullAddress).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(fullAddress).join(", ")}`] : []),
  ].join("\n");
  return {
    title: "Forward",
    to: "",
    cc: "",
    bcc: "",
    subject: prefixed("Fwd", m.subject),
    text: `\n\n${head}\n\n${bodyText(m)}`,
    forwardId: m.id,
    carried: m.attachments.filter((a) => a.available),
    focus: "to",
  };
}

/** A new message. `from`: the mailbox being looked at, so it goes out from there; unset (All mailboxes), Compose asks. */
const blankDraft = (from?: string): Draft => ({ title: "New message", ...(from ? { from } : {}), to: "", cc: "", bcc: "", subject: "", text: "", carried: [], focus: "to" });

// ── Page ─────────────────────────────────────────────────────────────────

/** `pinned`: starred mail, shown above the rest whatever its date; `messages`: the rest, newest first, paged. */
type ListState = { folder: MailFolder; filter: MailFilter; q: string; to: string; pinned: MailSummary[]; messages: MailSummary[]; hasMore: boolean };

/** Every row a list shows: starred first, then the rest. */
const listRows = (l: ListState | null): MailSummary[] => (l ? [...l.pinned, ...l.messages] : []);

/** The same change to the starred rows and the rest. */
const eachRow = (l: ListState, fn: (rows: MailSummary[]) => MailSummary[]): ListState => ({ ...l, pinned: fn(l.pinned), messages: fn(l.messages) });

/** Table: one row per message, every field in its own column. Columns: the list beside the open message. */
type View = "table" | "columns";
const VIEW_KEY = "bfo-mail-view";

/**
 * How long each loader stays once shown, so its scene plays to the end rather
 * than being cut off by a quick answer: the list's constellation assembling,
 * a search's sweep, the envelope opening (its one-shot animation is 1.5 s).
 * A cached message skips the envelope altogether.
 */
const LIST_LOADER_MS = 1300;
const SEARCH_LOADER_MS = 1000;
/** The envelope: the message is revealed as the letter comes toward you (its animation is 1.5 s; the reveal starts at 1.25 s). */
const ENVELOPE_MS = 1250;
/** The loader's fade before the rows take its place. */
const LOADER_OUT_MS = 240;
const holdFor = (shownAt: number, min: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, min - (performance.now() - shownAt))));
const MAIL_THEME_KEY = "bfo-mail-theme";

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "columns" ? "columns" : "table";
  } catch {
    return "table";
  }
}

const FILTERS: { key: MailFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "starred", label: "Starred" },
  { key: "unread-starred", label: "Unread ★" },
];

const NOTHING: Record<MailFilter, string> = { all: "", unread: "Nothing unread.", starred: "Nothing starred.", "unread-starred": "Nothing both unread and starred." };

/** The appearance button: Mail's own light/dark switch. A sun in the dark, a moon in the light. */
function ThemeButton({ dark, onToggle, className = "", iconClassName = "h-5 w-5" }: { dark: boolean; onToggle: () => void; className?: string; iconClassName?: string }) {
  return (
    <button
      type="button"
      aria-label={dark ? "Appearance: dark. Switch to light" : "Appearance: light. Switch to dark"}
      title={dark ? "Switch to light" : "Switch to dark"}
      onClick={onToggle}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform active:scale-90 ${className}`}
    >
      <span key={dark ? "sun" : "moon"} className="theme-icon-in inline-flex">
      {dark ? (
        <svg viewBox="0 0 24 24" className={iconClassName} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className={iconClassName} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" />
        </svg>
      )}
      </span>
    </button>
  );
}

/** Open/closed with an exit: `shown` stays true for `ms` after closing so the exit animation can play; `leaving` marks that stretch. */
function useExit(open: boolean, ms: number): { shown: boolean; leaving: boolean } {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { shown, leaving };
}

const FOLDER_GLYPH: Record<MailFolder, keyof typeof GLYPHS> = { active: "chats", inbox: "inbox", sent: "send", archive: "archive", other: "at" };

/**
 * Phones: one control for what the list shows, reading only what's chosen
 * ("In", "In · Unread · Starred"). Tapping it opens a glass sheet where you
 * pick a folder (Active, In, Out, Archive), switch Unread and Starred on or
 * off in any combination, and Apply. "Other" (mail to addresses nobody has)
 * is a desktop tab; it appears here only while you're in it.
 */
function FolderMenu({ folders, folder, filter, count, onPick }: { folders: { key: MailFolder; label: string }[]; folder: MailFolder; filter: MailFilter; count: { unread: number; otherUnread: number } | null; onPick: (folder: MailFolder, filter: MailFilter) => void }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  const exit = useExit(open, 180);
  const wrap = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  // The sheet works on a draft; Apply makes it so.
  const flags = filterFlags(filter);
  const [dFolder, setDFolder] = useState<MailFolder>(folder);
  const [dUnread, setDUnread] = useState(flags.unread);
  const [dStarred, setDStarred] = useState(flags.starred);
  useEffect(() => {
    if (!open) return;
    setDFolder(folder);
    setDUnread(flags.unread);
    setDStarred(flags.starred);
    const measure = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (r) setTop(r.bottom + 8);
    };
    measure();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const n = (key: MailFolder) => (key === "inbox" || key === "active" ? count?.unread : key === "other" ? count?.otherUnread : 0) || 0;
  const shown = folders.filter((x) => x.key !== "other" || folder === "other");
  const cur = shown.find((x) => x.key === folder) ?? shown[0];
  const narrowed = flags.unread || flags.starred;
  const live = folder === "active" && !narrowed;
  const changed = dFolder !== folder || dUnread !== flags.unread || dStarred !== flags.starred;
  const apply = () => {
    onPick(dFolder, filterOf(dUnread, dStarred));
    setOpen(false);
  };
  const label = `text-[11px] font-semibold uppercase tracking-[0.14em] ${t.faint}`;
  const chip = `inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[12px] font-medium ${t.dark ? "bg-white/10 text-gray-100" : "bg-white text-gray-700 shadow-sm"}`;
  return (
    <div ref={wrap} className="flex min-w-0 flex-1 items-center">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Showing ${cur.label}${flags.unread ? ", unread" : ""}${flags.starred ? ", starred" : ""}. Change folder or filters`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-[48px] w-full min-w-0 cursor-pointer items-center gap-2 rounded-full pl-5 pr-4 text-[15px] font-semibold transition-colors active:scale-[0.99] ${
          live ? `pill-glass-live ${t.dark ? "text-(--mail-accent-pale)" : "text-(--mail-accent-ink)"}` : `pill-glass ${t.dark ? "text-white" : "text-gray-900"}`
        }`}
      >
        <Glyph name={FOLDER_GLYPH[folder]} className="h-4 w-4" />
        <span className="truncate">{cur.label}</span>
        {!narrowed && n(folder) > 0 && <span className={`min-w-[20px] rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5 ${live ? (t.dark ? "bg-(--mail-accent)/30 text-white" : "bg-(--mail-accent-deep) text-white") : t.dark ? "bg-white/15 text-white" : "bg-gray-900 text-white"}`}>{n(folder)}</span>}
        {flags.unread && (
          <span className={chip}>
            <span className="h-2 w-2 rounded-full bg-(--mail-accent)" />
            Unread
          </span>
        )}
        {flags.starred && (
          <span className={`${chip} ${t.dark ? "text-amber-200" : "text-amber-700"}`}>
            <Star on className="h-3 w-3" />
            Starred
          </span>
        )}
        <span className="flex-1" />
        <Icon name="chevronDown" className={`h-4 w-4 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.2} />
      </button>
      {exit.shown &&
        createPortal(
          <>
            <div className={`fixed inset-0 z-[64] bg-black/45 backdrop-blur-[2px] ${exit.leaving ? "backdrop-out" : "backdrop-in"}`} onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Folder and filters"
              style={{ position: "fixed", top, left: 12, width: "calc(100vw - 24px)" }}
              className={`${exit.leaving ? "menu-out" : "menu-down"} z-[65] overflow-hidden rounded-3xl border p-3 shadow-2xl mail-glass-top ${t.dark ? "border-white/10 bg-[#0f0f16]/85" : "border-gray-200 bg-white/90"}`}
            >
              <p className={`px-1.5 pb-2 pt-1 ${label}`}>Folder</p>
              <div className="grid grid-cols-2 gap-2">
                {shown.map((x) => {
                  const on = x.key === dFolder;
                  const isLive = x.key === "active";
                  const c = n(x.key);
                  const tone = on
                    ? isLive
                      ? t.dark ? "bg-(--mail-accent-deep)/30 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/60" : "bg-(--mail-accent-deep) text-white"
                      : t.dark ? "bg-white/[0.12] text-white ring-1 ring-inset ring-white/15" : "bg-gray-900 text-white"
                    : t.dark ? "bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]" : "bg-gray-50 text-gray-800 hover:bg-gray-100";
                  return (
                    <button
                      key={x.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDFolder(x.key)}
                      className={`flex h-[60px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left transition-colors active:scale-[0.98] ${isLive ? "col-span-2" : ""} ${tone}`}
                    >
                      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-white/15" : t.dark ? "bg-white/[0.06]" : "bg-white shadow-sm"}`}>
                        <Glyph name={FOLDER_GLYPH[x.key]} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{x.label}</span>
                      {c > 0 && <span className={`min-w-[22px] rounded-full px-1.5 text-center text-[12px] tabular-nums leading-[22px] ${on ? "bg-white/20" : t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>{c}</span>}
                      {on && <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
              <p className={`px-1.5 pb-2 pt-4 ${label}`}>Filters</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={dUnread}
                  onClick={() => setDUnread((v) => !v)}
                  className={`flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] font-semibold transition-colors active:scale-[0.98] ${
                    dUnread
                      ? t.dark ? "bg-(--mail-accent-deep)/30 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/60" : "bg-(--mail-accent-deep) text-white"
                      : t.dark ? "bg-white/[0.04] text-gray-200 ring-1 ring-inset ring-white/10" : "bg-gray-50 text-gray-800 ring-1 ring-inset ring-gray-200"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dUnread ? "bg-current" : "border-2 border-current opacity-60"}`} />
                  Unread
                  <span className="flex-1" />
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${dUnread ? "bg-white/25" : t.dark ? "bg-white/10" : "bg-white shadow-sm"}`}>{dUnread && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dStarred}
                  onClick={() => setDStarred((v) => !v)}
                  className={`flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] font-semibold transition-colors active:scale-[0.98] ${
                    dStarred
                      ? "bg-amber-400 text-gray-950"
                      : t.dark ? "bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-300/25" : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
                  }`}
                >
                  <Star on className="h-[18px] w-[18px] shrink-0" />
                  Starred
                  <span className="flex-1" />
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${dStarred ? "bg-white/40" : t.dark ? "bg-amber-400/15" : "bg-white shadow-sm"}`}>{dStarred && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}</span>
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {(dUnread || dStarred) && (
                  <button type="button" onClick={() => { setDUnread(false); setDStarred(false); }} className={`h-[48px] shrink-0 cursor-pointer rounded-2xl px-4 text-[14px] font-medium ${t.dark ? "text-gray-300 hover:bg-white/[0.06]" : "text-gray-600 hover:bg-gray-100"}`}>
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={apply}
                  className={`fab-glass h-[48px] flex-1 cursor-pointer rounded-2xl text-[15px] font-semibold transition-transform active:scale-[0.98] ${changed ? "" : "opacity-80"}`}
                >
                  {changed ? "Apply" : "Done"}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

export default function Inbox() {
  const t = useTone();
  const me = getUser();
  const count = useMailCount();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const canSeeOther = count ? count.canSeeOther : isAdmin(me);
  const f = params.get("f");
  // Active (in and out together, by conversation) unless the URL picks another.
  const folder: MailFolder = f === "inbox" || f === "sent" || f === "archive" || (f === "other" && canSeeOther) ? f : "active";
  const v = params.get("v");
  const filter: MailFilter = v === "unread" || v === "starred" || v === "unread-starred" ? v : "all";
  /** Search text from the URL; while set, every folder is searched. */
  const q = (params.get("q") ?? "").trim();
  const openId = params.get("m");
  // Until the count answers, the session's copy will do. null from the server: no address yet.
  const address = (count ? count.address : me?.mailAddress) || "";
  const noAddress = !!count && !count.address;
  const aliases = useMemo(() => (address ? (count?.aliases ?? []) : []), [address, count?.aliases]);
  const mine = useMemo(() => (address ? [address, ...aliases] : []), [address, aliases]);
  /** One mailbox (an address of mine) from the URL, or every one. */
  const a = (params.get("a") ?? "").toLowerCase();
  const box = mine.some((m) => m.toLowerCase() === a) ? a : "";

  const [view, setView] = useState<View>("table");
  useEffect(() => setView(savedView()), []);
  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A preference that doesn't stick is no loss.
    }
  }

  const [list, setList] = useState<ListState | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listReq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;

  const [draft, setDraft] = useState<Draft | null>(null);
  /** A short note after an action; with `undo`, a button (and "z") puts it back. */
  const [toast, setToastState] = useState<{ text: string; undo?: () => void } | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const setToast = (text: string | null, undo?: () => void) => {
    setToastLeaving(false);
    setToastState(text ? { text, undo } : null);
  };
  /** Mail's own light/dark setting: light unless switched, kept on the device, applied only while Mail is on screen. */
  const { setOverride } = useTheme();
  const themeFadeTimer = useRef<number | undefined>(undefined);
  const [mailTheme, setMailTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      setMailTheme(localStorage.getItem(MAIL_THEME_KEY) === "dark" ? "dark" : "light");
    } catch {
      // Private mode: light it is.
    }
  }, []);
  // Applied before paint, so the page never shows a frame of the other theme.
  useLayoutEffect(() => {
    setOverride(mailTheme);
  }, [mailTheme, setOverride]);
  useEffect(() => () => setOverride(null), [setOverride]);
  const mailThemeRef = useRef(mailTheme);
  mailThemeRef.current = mailTheme;
  function toggleMailTheme() {
    // Read from the ref, so two quick taps go there and back.
    const next = mailThemeRef.current === "dark" ? "light" : "dark";
    mailThemeRef.current = next;
    // Colours ease across for a moment (app.css, .theme-switching); the aurora eases its own underneath.
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.clearTimeout(themeFadeTimer.current);
    themeFadeTimer.current = window.setTimeout(() => root.classList.remove("theme-switching"), 420);
    setMailTheme(next);
    setOverride(next);
    try {
      localStorage.setItem(MAIL_THEME_KEY, next);
    } catch {
      // Then it lasts the visit.
    }
    tap();
  }
  /** Everyone's chosen pictures, by address; asked for once per visit. */
  const [faces, setFaces] = useState<MailFaces>({});
  useEffect(() => {
    let alive = true;
    getFaces()
      .then((r) => alive && setFaces(r.faces))
      .catch(() => {}); // Initials and logos will do.
    return () => {
      alive = false;
    };
  }, []);
  /** Messages picked for a bulk action, and the last one clicked (shift-click picks the range from it). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pickAnchor = useRef<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Newest first. "refresh" re-reads the first page and keeps any older pages already loaded.
  // "reset" re-reads the first page without blanking the list first, and drops older pages: after an action
  // that can move rows anywhere (a star, an archive in Active), merging would keep stale rows or lose moved ones.
  /** The loader on its way out, and rows that have just arrived (they animate in once, not again when the list comes back into view). */
  const [loaderLeaving, setLoaderLeaving] = useState(false);
  const [rowsFresh, setRowsFresh] = useState(false);
  const loadList = useCallback(async (which: MailFolder, narrow: MailFilter, term: string, to: string, mode: "replace" | "refresh" | "reset") => {
    const req = ++listReq.current;
    const shownAt = performance.now();
    if (mode === "replace") {
      setList(null);
      setListError(null);
    }
    try {
      const head = await listMail({ folder: which, filter: narrow, q: term, to: to || undefined });
      if (req !== listReq.current) return;
      setListError(null);
      if (mode === "replace") {
        // The loader plays through (the constellation assembles, the sonar sweeps), fades out in place, and the rows come in.
        await holdFor(shownAt, term ? SEARCH_LOADER_MS : LIST_LOADER_MS);
        if (req !== listReq.current) return;
        setLoaderLeaving(true);
        await new Promise((r) => setTimeout(r, LOADER_OUT_MS));
        if (req !== listReq.current) return;
        setLoaderLeaving(false);
        setList({ folder: which, filter: narrow, q: term, to, ...head, pinned: head.pinned ?? [] });
        setRowsFresh(true);
        window.setTimeout(() => setRowsFresh(false), 1500);
        return;
      }
      setList((prev) => {
        const fresh = { folder: which, filter: narrow, q: term, to, ...head, pinned: head.pinned ?? [] };
        if (mode === "reset" || !prev || prev.folder !== which || prev.filter !== narrow || prev.q !== term || prev.to !== to || !head.messages.length) return fresh;
        const ids = new Set([...head.messages, ...fresh.pinned].map((m) => m.id));
        // More than a page arrived since the last read: the head doesn't reach the old list, so keeping it would leave a hole.
        if (head.hasMore && !prev.messages.some((m) => ids.has(m.id))) return fresh;
        // Keep what sorts after the head's last row, in the server's order. Active has a row per
        // conversation: one that moved up is in the head now, under its newest message.
        const last = head.messages[head.messages.length - 1];
        const threads = new Set([...head.messages, ...fresh.pinned].map((m) => m.threadKey).filter(Boolean));
        const older = prev.messages.filter((m) =>
          which === "active" && !term
            ? !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)) && threadSortsAfter(m, last)
            : !ids.has(m.id) && sortsAfter(m, last)
        );
        return { ...fresh, messages: [...head.messages, ...older], hasMore: older.length ? prev.hasMore : head.hasMore };
      });
    } catch (e) {
      if (req === listReq.current && mode === "replace") setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList(folder, filter, q, box, "replace");
  }, [folder, filter, q, box, loadList]);

  // New mail shows up through the shared count; when it moves, re-read the list.
  const unreadKey = count ? `${count.unread}/${count.otherUnread}` : null;
  const lastKey = useRef(unreadKey);
  useEffect(() => {
    if (lastKey.current && unreadKey && lastKey.current !== unreadKey) void loadList(folder, filter, q, box, "refresh");
    lastKey.current = unreadKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey]);

  async function loadMore() {
    const cur = listRef.current;
    if (!cur || !cur.messages.length) return;
    setLoadingMore(true);
    try {
      const last = cur.messages[cur.messages.length - 1];
      // Active pages by conversation; everything else by message.
      const after =
        cur.folder === "active" && !cur.q && last.threadAt && last.threadKey
          ? { before: last.threadAt, beforeKey: last.threadKey }
          : { before: last.occurredAt, beforeId: last.id };
      const next = await listMail({ folder: cur.folder, filter: cur.filter, q: cur.q, to: cur.to || undefined, ...after });
      setList((prev) => {
        if (!prev || prev.folder !== cur.folder || prev.filter !== cur.filter || prev.q !== cur.q || prev.to !== cur.to) return prev;
        const ids = new Set(listRows(prev).map((m) => m.id));
        const threads = new Set(prev.folder === "active" && !prev.q ? listRows(prev).map((m) => m.threadKey).filter(Boolean) : []);
        const added = next.messages.filter((m) => !ids.has(m.id) && !(m.threadKey && threads.has(m.threadKey)));
        return { ...prev, messages: [...prev.messages, ...added], hasMore: next.hasMore };
      });
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Active shows each conversation under its newest message, so a reply, move or
   * delete can change a row or its place: read the list again. Reads the list
   * that's showing now, not the one when the action started.
   */
  function refreshActive() {
    const cur = listRef.current;
    if (cur?.folder === "active" && !cur.q) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
  }

  /** Change one row in the list (if it's there). */
  const patchRow = (id: string, patch: Partial<MailSummary>) =>
    setList((prev) => prev && eachRow(prev, (rows) => rows.map((m) => (m.id === id ? { ...m, ...patch } : m))));

  // ── The open message ──────────────────────────────────────────────────

  const cache = useRef(new Map<string, MailMessage>());
  const [open, setOpen] = useState<{ id: string; message: MailMessage | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!openId) {
      setOpen(null);
      return;
    }
    const hit = cache.current.get(openId) ?? null;
    const row = listRows(listRef.current).find((m) => m.id === openId);
    setOpen({ id: openId, message: hit, error: null });
    // A cached copy will do, unless the list says it's unread again (fetching marks it read).
    if (hit && (!row || row.read)) return;
    let alive = true;
    // From Active, the row stood for the whole conversation: opening it reads all of it.
    const cur = listRef.current;
    getMessage(openId, { conversation: cur?.folder === "active" && !cur.q })
      .then(({ message }) => {
        if (!alive) return;
        cache.current.set(openId, message);
        // The Reader has it at once: it renders under the envelope (so its pictures and frame load meanwhile)
        // and is revealed as the letter comes forward. A page already showing the message takes the fresh copy quietly.
        setOpen({ id: openId, message, error: null });
        if (!row || !row.read) {
          patchRow(openId, { read: true });
          notifyMailChanged();
        }
      })
      .catch((e) => alive && setOpen({ id: openId, message: null, error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [openId]);

  /** The open message's conversation (newest first), and the one just sent into it, which animates in. */
  const [thread, setThread] = useState<{ id: string; messages: MailMessage[] } | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => {
    setFreshId(null);
    if (!openId) return setThread(null);
    let alive = true;
    getThread(openId)
      .then(({ messages }) => alive && setThread({ id: openId, messages }))
      .catch(() => alive && setThread(null));
    return () => {
      alive = false;
    };
  }, [openId]);

  /** The page's own query string: folder and filter, plus the open message. */
  function query(extra: Record<string, string> = {}): Record<string, string> {
    const next: Record<string, string> = {};
    if (folder !== "active") next.f = folder;
    if (filter !== "all") next.v = filter;
    if (q) next.q = q;
    return { ...next, ...extra };
  }

  // The page's transitions (view-transition.ts) wait for the navigation to land: a location change settles them.
  const settle = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    settle.current?.();
    settle.current = null;
  }, [location.key]);
  /** Navigate inside a page transition on phones (list → message, message → list); plain on larger screens. */
  function go(dir: "forward" | "back", nav: () => void) {
    if (!phoneScreen() || !supportsViewTransitions()) return nav();
    void transition(
      "mail",
      dir,
      () =>
        new Promise<void>((resolve) => {
          settle.current = resolve;
          window.setTimeout(resolve, 800); // never hang on a navigation that didn't change the location
          nav();
        }),
    );
  }

  /** The finger is on a row: fetch its message now (without marking it read), so the open is instant when the tap lands. */
  const prefetching = useRef(new Set<string>());
  function prefetch(id: string) {
    if (cache.current.has(id) || prefetching.current.has(id)) return;
    prefetching.current.add(id);
    const cur = listRef.current;
    getMessage(id, { conversation: cur?.folder === "active" && !cur.q, peek: true })
      .then(({ message }) => cache.current.set(id, message))
      .catch(() => undefined)
      .finally(() => prefetching.current.delete(id));
  }
  /** Back from a message: its row glows for a moment, so the eye lands where it left. */
  const [returnedId, setReturnedId] = useState<string | null>(null);

  function select(id: string) {
    if (!openId) tap();
    // From the list: push, so Back returns to it. Between messages: replace. The message's page starts at its top.
    go("forward", () => {
      setParams(query({ m: id }), openId ? { replace: true, state: location.state } : { state: { fromList: true } });
      if (!openId) window.scrollTo(0, 0);
    });
  }

  // Read through refs, so a move/delete that resolves later acts on what's open now.
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const navStateRef = useRef(location.state);
  navStateRef.current = location.state;
  const queryRef = useRef(query);
  queryRef.current = query;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function closeMessage() {
    const was = openIdRef.current;
    if (was) {
      setReturnedId(was);
      window.setTimeout(() => setReturnedId((r) => (r === was ? null : r)), 1600);
    }
    go("back", () => {
      if ((navStateRef.current as { fromList?: boolean } | null)?.fromList) navigate(-1);
      else setParams(queryRef.current(), { replace: true });
    });
  }

  /** The phone menu: folder and filter in one step (Starred is a place there). Ends a search. */
  function choosePlace(nextFolder: MailFolder, nextFilter: MailFilter) {
    if (nextFolder === folder && nextFilter === filter && !openId && !q) return;
    const p: Record<string, string> = {};
    if (nextFolder !== "active") p.f = nextFolder;
    if (nextFilter !== "all") p.v = nextFilter;
    if (box) p.a = box;
    setParams(p);
  }

  /** Picking a folder ends a search; changing the filter narrows it. */
  function chooseFolder(next: MailFolder) {
    if (next === folder && !openId && !q) return;
    const p: Record<string, string> = {};
    if (next !== "active") p.f = next;
    if (filter !== "all") p.v = filter;
    if (box) p.a = box;
    setParams(p);
  }

  function chooseFilter(next: MailFilter) {
    if (next === filter && !openId) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (next !== "all") p.v = next;
    if (q) p.q = q;
    if (box) p.a = box;
    setParams(p);
  }

  /** Set the search text (the URL carries it, so Back and reload keep it). */
  function search(term: string) {
    const clean = term.trim();
    if (clean === q) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (filter !== "all") p.v = filter;
    if (clean) p.q = clean;
    if (box) p.a = box;
    setParams(p, { replace: true });
  }

  /** Show one mailbox (an address of mine), or all of them. */
  function chooseBox(next: string) {
    if (next === box) return;
    const p: Record<string, string> = {};
    if (folder !== "active") p.f = folder;
    if (filter !== "all") p.v = filter;
    if (q) p.q = q;
    if (next) p.a = next;
    setParams(p);
  }

  function dropFromList(id: string) {
    // The one after it (or before, at the end), to open in its place, as Gmail does after an archive.
    const all = listRows(listRef.current);
    const at = all.findIndex((m) => m.id === id);
    const next = at >= 0 ? (all[at + 1] ?? all[at - 1]) : undefined;
    setList((prev) => prev && eachRow(prev, (rows) => rows.filter((m) => m.id !== id)));
    // Only if it's still the one open (and the page is still here).
    if (!mountedRef.current || openIdRef.current !== id) return;
    if (next) setParams(queryRef.current({ m: next.id }), { replace: true, state: navStateRef.current });
    else closeMessage();
  }

  /** Read the list again from its first page, as it shows now (after an undo, say). */
  function resetList() {
    const cur = listRef.current;
    if (cur) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
  }

  const failOn = (id: string, e: unknown) => setOpen((o) => (o && o.id === id ? { ...o, error: (e as Error).message } : o));

  async function move(m: MailMessage, to: "inbox" | "archive") {
    try {
      // From Active, Archive takes the whole conversation out (sent copies stay in Out).
      const cur = listRef.current;
      const whole = cur?.folder === "active" && !cur.q;
      await moveMail([m.id], to, { conversation: to === "archive" && whole });
      cache.current.set(m.id, { ...m, folder: to });
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      const back = to === "archive" ? "inbox" : "archive";
      setToast(to === "archive" ? "Archived" : "Moved to inbox", () => undoWith(() => moveMail([m.id], back, { conversation: whole })));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Archive straight from a row (a swipe): the same as from the reader, with Undo. */
  async function archiveRow(m: MailSummary) {
    try {
      const cur = listRef.current;
      const whole = cur?.folder === "active" && !cur.q;
      await moveMail([m.id], "archive", { conversation: whole });
      cache.current.delete(m.id);
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      setToast("Archived", () => undoWith(() => moveMail([m.id], "inbox", { conversation: whole })));
    } catch (e) {
      setToast((e as Error).message || "Couldn't archive it.");
    }
  }

  async function remove(m: MailMessage) {
    const ok = await confirmDialog({ title: "Delete this message?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await deleteMail([m.id]);
      cache.current.delete(m.id);
      dropFromList(m.id);
      refreshActive();
      notifyMailChanged();
      setToast("Deleted");
    } catch (e) {
      failOn(m.id, e);
    }
  }

  /** Star or unstar, shown at once and undone if the server says no. */
  async function star(m: MailSummary, starred: boolean, fromList = true) {
    patchRow(m.id, { starred });
    const hit = cache.current.get(m.id);
    if (hit) cache.current.set(m.id, { ...hit, starred });
    setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, starred } } : o));
    try {
      // In Active a row is starred when any message in its conversation is: unstarring the row clears them all.
      // (Unstarring one message in the reader touches only that message.)
      const before = listRef.current;
      await starMail([m.id], starred, { conversation: fromList && before?.folder === "active" && !before.q });
      // Starred mail sits at the top: read the list again so it moves there (or back to its date) — the list
      // showing now, which may not be the one the click was in.
      const cur = listRef.current;
      if (cur && cur.filter === "all" && !cur.q) void loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
    } catch (e) {
      patchRow(m.id, { starred: !starred });
      if (hit) cache.current.set(m.id, { ...hit, starred: !starred });
      setOpen((o) => (o && o.id === m.id && o.message ? { ...o, message: { ...o.message, starred: !starred }, error: (e as Error).message } : o));
    }
  }

  /** Undo the last action: run its reverse, then read the list again. */
  async function undoWith(reverse: () => Promise<unknown>) {
    setToastState(null);
    try {
      await reverse();
      cache.current.clear();
      resetList();
      notifyMailChanged();
      setToast("Undone");
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  /** Back to unread: the list shows it bold again and the reader closes (opening marks it read). */
  async function markUnread(m: MailMessage) {
    try {
      await markRead([m.id], false);
      patchRow(m.id, { read: false });
      cache.current.delete(m.id);
      notifyMailChanged();
      if (mountedRef.current && openIdRef.current === m.id) closeMessage();
      setToast("Marked as unread", () => undoWith(() => markRead([m.id], true)));
    } catch (e) {
      failOn(m.id, e);
    }
  }

  function onSent(sent: MailSummary, about?: string) {
    setDraft(null);
    setToast("Sent");
    // A reply or forward on the conversation that's open: the sent message joins it at the top.
    const conv = thread;
    if (about && conv && (conv.id === about || conv.messages.some((m) => m.id === about))) {
      getMessage(sent.id)
        .then(({ message }) => {
          setThread((cur) => (cur && cur.id === conv.id ? { ...cur, messages: [message, ...cur.messages.filter((m) => m.id !== message.id)] } : cur));
          setFreshId(message.id);
        })
        .catch(() => {});
    }
    if (folder === "sent" && filter === "all" && !q) setList((prev) => prev && { ...prev, messages: [sent, ...prev.messages.filter((m) => m.id !== sent.id)] });
    // In Active, the conversation just replied to moves to the top.
    refreshActive();
    notifyMailChanged();
  }

  // ── Keys (Gmail's, listed on "?"): j/k next/previous, o open, e archive, # delete, r/a/f reply/all/forward,
  // s star, x select, U unread, c new, u back to the list, z undo. Never while typing or over a dialog.
  // Bound fresh each render, so every key acts on the list and message showing now.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (draft || document.querySelector('[aria-modal="true"]')) return;
      const all = listRows(listRef.current);
      const openRow = open?.message ?? null;
      const focusedId = (document.activeElement as HTMLElement | null)?.closest?.("[data-mail-row]")?.getAttribute("data-mail-row") ?? null;
      const focused = focusedId ? all.find((m) => m.id === focusedId) ?? null : null;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case "j":
        case "k": {
          const step = e.key === "j" ? 1 : -1;
          if (openId) {
            const next = all[all.findIndex((m) => m.id === openId) + step];
            if (next) act(() => select(next.id));
            return;
          }
          // In the list: move focus row by row (the visible list: table on desktop, rows on phones).
          const rowsShown = [...document.querySelectorAll<HTMLElement>("[data-mail-row]")].filter((r) => r.offsetParent !== null);
          const at = rowsShown.findIndex((r) => r.getAttribute("data-mail-row") === focusedId);
          const target = rowsShown[at < 0 ? 0 : Math.min(rowsShown.length - 1, Math.max(0, at + step))];
          if (target) act(() => {
            target.focus();
            target.scrollIntoView({ block: "nearest" });
          });
          return;
        }
        case "o":
          if (focused && !openId) act(() => select(focused.id));
          return;
        case "u":
          if (openId) act(() => closeMessage());
          return;
        case "e":
          if (openRow && (openRow.direction === "in" || folder === "active") && openRow.folder !== "archive") act(() => void move(openRow, "archive"));
          // Only where the bulk bar offers Archive: Active, and received mail in In.
          else if (!openId && picked.size && (folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in")))) act(() => void bulk("archive"));
          else if (!openId && !picked.size && focused && (folder === "active" || (folder === "inbox" && focused.direction === "in"))) act(() => void bulk("archive", [focused.id]));
          return;
        case "#":
          if (openRow) act(() => void remove(openRow));
          else if (picked.size) act(() => void bulk("delete"));
          else if (focused) act(() => void bulk("delete", [focused.id]));
          return;
        case "r":
        case "a":
        case "f":
          if (!openRow || noAddress) return;
          act(() => setDraft(e.key === "f" ? forwardDraft(openRow) : replyDraft(openRow, e.key === "a" ? "all" : "reply", mine)));
          return;
        case "s":
          if (openRow) act(() => void star(openRow, !openRow.starred, false));
          else if (focused) act(() => void star(focused, !focused.starred));
          return;
        case "x":
          if (focused) act(() => pick(focused.id, false));
          return;
        case "U":
          if (openRow && openRow.direction === "in") act(() => void markUnread(openRow));
          else if (!openId && picked.size) act(() => void bulk("unread"));
          return;
        case "c":
          if (!noAddress) act(() => setDraft(blankDraft(box || undefined)));
          return;
        case "z":
          if (toast?.undo) act(() => toast.undo?.());
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast) return;
    // Long enough to reach Undo when there is one.
    const total = toast.undo ? 6000 : 2200;
    const leave = setTimeout(() => setToastLeaving(true), total - 200);
    const id = setTimeout(() => {
      setToastState(null);
      setToastLeaving(false);
    }, total);
    return () => { clearTimeout(id); clearTimeout(leave); };
  }, [toast]);

  const syncError = isAdmin(me) ? count?.sync?.error : undefined;
  const folders = FOLDERS.filter((x) => x.key !== "other" || canSeeOther);
  const rows = list && list.folder === folder && list.filter === filter && list.q === q && list.to === box ? listRows(list) : null;

  // Another folder, filter, search or mailbox starts with nothing picked.
  useEffect(() => {
    setPicked(new Set());
    pickAnchor.current = null;
  }, [folder, filter, q, box]);

  // Esc lets go of the selection (when no message is open to close first).
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openIdRef.current && !draft) setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size, draft]);

  function pick(id: string, shift: boolean) {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => {
      const next = new Set(prev);
      const turnOn = !prev.has(id);
      const from = shift && pickAnchor.current ? ids.indexOf(pickAnchor.current) : -1;
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        // The whole range takes the clicked one's new state.
        for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) turnOn ? next.add(x) : next.delete(x);
      } else if (turnOn) next.add(id);
      else next.delete(id);
      return next;
    });
    pickAnchor.current = id;
  }

  function pickAll() {
    const ids = (rows ?? []).map((m) => m.id);
    setPicked((prev) => (ids.length && ids.every((x) => prev.has(x)) ? new Set() : new Set(ids)));
    pickAnchor.current = null;
  }

  /** Read or unread, archive or back to the inbox, or delete: for every picked message at once. */
  async function bulk(action: "read" | "unread" | "archive" | "inbox" | "delete", only?: string[]) {
    // The picked rows, or (from a key) just the one in focus.
    const ids = only ?? (rows ?? []).filter((m) => picked.has(m.id)).map((m) => m.id);
    if (!ids.length || bulkBusy) return;
    // In Active each row is a conversation: Archive and Delete take all of it.
    const whole = folder === "active" && !q;
    if (action === "delete") {
      const ok = await confirmDialog(
        whole
          ? { title: `Delete ${ids.length} conversation${ids.length === 1 ? "" : "s"}?`, message: "Every message in them, received and sent, is deleted for good.", confirmLabel: "Delete", tone: "danger" }
          : { title: `Delete ${ids.length} message${ids.length === 1 ? "" : "s"}?`, confirmLabel: "Delete", tone: "danger" }
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      if (action === "read" || action === "unread") {
        const read = action === "read";
        await markRead(ids, read);
        setList((prev) => prev && eachRow(prev, (rows) => rows.map((m) => (picked.has(m.id) ? { ...m, read } : m))));
        for (const id of ids) cache.current.delete(id);
        setToast(read ? `Marked ${ids.length} as read` : `Marked ${ids.length} as unread`, () => undoWith(() => markRead(ids, !read)));
      } else {
        if (action === "delete") await deleteMail(ids, { conversation: whole });
        else await moveMail(ids, action, { conversation: whole && action === "archive" });
        const gone = new Set(ids);
        setList((prev) => prev && eachRow(prev, (rows) => rows.filter((m) => !gone.has(m.id))));
        for (const id of ids) cache.current.delete(id);
        if (openIdRef.current && gone.has(openIdRef.current)) closeMessage();
        setPicked(new Set());
        refreshActive();
        if (action === "delete") setToast(`Deleted ${ids.length}`);
        else {
          const back = action === "archive" ? "inbox" : "archive";
          setToast(action === "archive" ? `Archived ${ids.length}` : `Moved ${ids.length} to the inbox`, () => undoWith(() => moveMail(ids, back, { conversation: whole })));
        }
      }
      notifyMailChanged();
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }
  const sent = folder === "sent";
  /** Active mixes both ways: each row says whether it came in or went out. */
  const mixed = folder === "active" && !q;
  // In the table, the open message takes the whole card; in columns, it sits beside the list.
  const tableReading = view === "table" && !!openId;

  const emptyText = () => {
    if (q) return `Nothing matches “${q}”.`;
    if ((folder === "inbox" || folder === "active") && noAddress) return "No address yet. Ask an admin.";
    return NOTHING[filter] || EMPTY[folder];
  };

  const reader = (
    <Reader
      key={openId ?? undefined}
      message={open?.message ?? null}
      error={open?.error ?? null}
      me={address}
      backAlways={view === "table"}
      onBack={closeMessage}
      onReply={(m, mode) => setDraft(replyDraft(m, mode, mine))}
      onForward={(m) => setDraft(forwardDraft(m))}
      onMove={move}
      onDelete={remove}
      onStar={(m, on) => star(m, on, false)}
      onUnread={markUnread}
      thread={thread && thread.id === open?.id ? thread.messages : []}
      wholeConversation={folder === "active" && !q}
      freshId={freshId}
      preview={openId ? (rows ?? []).find((r) => r.id === openId) ?? null : null}
    />
  );

  const pickedRows = (rows ?? []).filter((m) => picked.has(m.id));
  const bulkBar = pickedRows.length > 0 && rows && (
    <div
      role="toolbar"
      aria-label="Selected messages"
      className={`pick-bar-in sticky top-0 z-[2] flex flex-wrap items-center gap-1 border-b px-3 py-1.5 backdrop-blur-xl ${t.line} ${t.dark ? "bg-[#14152a]/95" : "bg-(--mail-accent-deep)/10/95"}`}
    >
      <SelectBox
        on={pickedRows.length === rows.length}
        mixed={pickedRows.length < rows.length}
        onToggle={() => pickAll()}
        label={pickedRows.length === rows.length ? "Unselect all" : "Select all"}
      />
      <span className={`mr-2 text-[12.5px] font-medium tabular-nums ${t.text}`}>{pickedRows.length} selected</span>
      {pickedRows.length < rows.length && (
        <button type="button" onClick={() => pickAll()} className={`mr-1 cursor-pointer text-[12px] hover:underline ${t.accent}`}>
          Select all {rows.length}
        </button>
      )}
      <span className="flex-1" />
      {pickedRows.some((m) => !m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("read")}>
          Mark read
        </Button>
      )}
      {pickedRows.some((m) => m.read) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("unread")}>
          Mark unread
        </Button>
      )}
      {(folder === "active" || (folder === "inbox" && pickedRows.some((m) => m.direction === "in"))) && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("archive")}>
          Archive
        </Button>
      )}
      {folder === "archive" && (
        <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("inbox")}>
          Move to inbox
        </Button>
      )}
      <Button kind="ghost" disabled={bulkBusy} onClick={() => void bulk("delete")}>
        Delete
      </Button>
      <IconButton icon="x" label="Clear selection (Esc)" onClick={() => setPicked(new Set())} />
    </div>
  );

  const listBody = !rows ? (
    listError ? <ErrorLine>{listError}</ErrorLine> : (
      <div className={loaderLeaving ? "loader-out" : ""}>{q ? <SearchLoader term={q} /> : <ListLoader table={view === "table"} label={folder === "sent" ? "Fetching sent mail" : folder === "archive" ? "Fetching the archive" : "Fetching mail"} />}</div>
    )
  ) : rows.length === 0 ? (
    <div className="px-5 py-10 text-center">
      <div className={`row-in mx-auto max-w-[320px] rounded-3xl border px-6 py-8 mail-glass-top ${t.dark ? "border-white/[0.08] bg-white/[0.03]" : "border-gray-200 bg-white/70"}`}>
        <span
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{ background: `linear-gradient(135deg, hsl(var(--mail-hue) var(--mail-sat) 60%), hsl(calc(var(--mail-hue) + 28) var(--mail-sat) 62%))`, boxShadow: `0 0 36px hsl(var(--mail-hue) var(--mail-sat) 60% / 0.45)` }}
        >
          <Icon name="mail" className="h-6 w-6" strokeWidth={1.6} />
        </span>
        <p className={`text-[14px] font-medium ${t.text}`}>{emptyText()}</p>
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && address && <p className={`mt-1 text-[12.5px] ${t.muted}`}>{address}</p>}
        {(folder === "inbox" || folder === "active") && filter === "all" && !q && <p className={`mt-3 text-[12px] ${t.faint}`}>Enjoy the quiet.</p>}
      </div>
    </div>
  ) : (
    <>
      {view === "table" ? (
        <>
          <MailTable rows={rows} sent={sent} mixed={mixed} me={address} onOpen={select} onStar={star} picked={picked} onPick={pick} onPickAll={pickAll} className="max-md:hidden" />
          <ul className="md:hidden">
            {rows.map((m, i) => {
              const pinnedIds = new Set((list?.pinned ?? []).map((p) => p.id));
              const groupOf = (x: MailSummary) => (pinnedIds.has(x.id) ? "Starred" : dayGroup(x.occurredAt));
              const group = groupOf(m);
              const first = i === 0 || groupOf(rows[i - 1]) !== group;
              return (
                <Fragment key={m.id}>
                  {first && !q && (
                    <li aria-hidden="true" className={`${rowsFresh ? "row-in" : ""} px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] first:pt-1 ${t.faint}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                      {group}
                    </li>
                  )}
                  <li className={`${rowsFresh ? "row-in" : ""} ${m.id === returnedId ? "row-return" : ""}`} style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                    <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={false} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} onArchive={m.folder === "archive" ? undefined : () => void archiveRow(m)} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className={`divide-y ${t.divide}`}>
          {rows.map((m) => (
            <li key={m.id}>
              <ListRow m={m} sent={sent || (mixed && m.direction === "out")} me={address} selected={m.id === openId} onOpen={() => select(m.id)} onPrefetch={() => prefetch(m.id)} onStar={(on) => star(m, on)} picked={picked.has(m.id)} picking={picked.size > 0} onPick={(shift) => pick(m.id, shift)} />
            </li>
          ))}
        </ul>
      )}
      {listError && <ErrorLine>{listError}</ErrorLine>}
      {list?.hasMore && (
        <div className={`border-t p-2 ${t.line}`}>
          <Button kind="ghost" className="w-full" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );

  const toolbar = (
    <div className={`flex shrink-0 items-center gap-2 border-b px-1.5 py-1.5 max-md:border-0 max-md:px-0 max-md:pb-2 max-md:pt-0 ${t.line}`}>
      {q ? (
        <div className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-[12.5px] max-md:px-1 max-md:text-[13.5px] ${t.muted}`}>
          <span className="truncate">
            {rows ? `${rows.length}${list?.hasMore ? "+" : ""} result${rows.length === 1 ? "" : "s"}` : "Searching"} in all mail
          </span>
          <TextButton onClick={() => search("")} className={`shrink-0 ${t.accent}`}>
            Clear
          </TextButton>
        </div>
      ) : (
      <>
      <div className="mx-1 flex min-w-0 flex-1 md:hidden">
        <FolderMenu folders={folders} folder={folder} filter={filter} count={count ? { unread: count.unread, otherUnread: count.otherUnread } : null} onPick={choosePlace} />
      </div>
      <nav aria-label="Folders" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:hidden">
        {folders.map((x) => {
          const on = x.key === folder;
          const n = x.key === "inbox" || x.key === "active" ? count?.unread : x.key === "other" ? count?.otherUnread : 0;
          // Active isn't a folder like the rest (it's In and Out together, as conversations): its own colour and mark, and a rule after it.
          const live = x.key === "active";
          const tone = live
            ? on
              ? t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/50" : "bg-(--mail-accent-deep) text-white"
              : t.dark ? "text-(--mail-accent) ring-1 ring-inset ring-(--mail-accent)/25 hover:bg-(--mail-accent-deep)/10 hover:text-(--mail-accent-pale)" : "text-(--mail-accent-ink) ring-1 ring-inset ring-(--mail-accent-deep)/30 hover:bg-(--mail-accent-deep)/10"
            : on
              ? t.dark ? "bg-white/[0.09] text-white" : "bg-gray-900 text-white"
              : t.dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-900";
          const badge = live
            ? on
              ? t.dark ? "bg-(--mail-accent)/30 text-white" : "bg-white/20 text-white"
              : t.dark ? "bg-(--mail-accent-deep)/20 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"
            : on
              ? "bg-white/15 text-white"
              : t.dark ? "bg-white/[0.07] text-gray-300" : "bg-gray-100 text-gray-600";
          return (
            <Fragment key={x.key}>
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => chooseFolder(x.key)}
                title={live ? "In (inbox) and Out (sent) together, a row per conversation, latest activity first" : undefined}
                className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium transition-colors max-md:h-[38px] max-md:rounded-[10px] max-md:px-3.5 max-md:text-[13.5px] ${live ? "font-semibold" : ""} ${tone}`}
              >
                {live && <Glyph name="chats" className="h-3.5 w-3.5" />}
                {x.label}
                {!!n && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] tabular-nums leading-[18px] ${badge}`}>{n}</span>}
              </button>
              {live && <span aria-hidden="true" className={`mx-1.5 my-1 w-px shrink-0 self-stretch max-md:hidden ${t.dark ? "bg-white/10" : "bg-gray-200"}`} />}
            </Fragment>
          );
        })}
      </nav>
      </>
      )}
      <Segmented
        label="Show"
        value={filter}
        onChange={chooseFilter}
        className="max-md:hidden"
        options={FILTERS.map((x) => ({ key: x.key, label: x.label, icon: x.key === "starred" ? <Star on className="h-3 w-3" /> : undefined }))}
      />
    </div>
  );

  // Phones: the title shrinks into a glass bar as the list scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Mail that arrived since the list was read: offer it, don't shuffle the list under a thumb.
  const seenUnread = useRef<number | null>(null);
  const [freshMail, setFreshMail] = useState(false);
  useEffect(() => {
    const n = count?.unread;
    if (n === undefined) return;
    if (seenUnread.current === null) seenUnread.current = n;
    else if (n > seenUnread.current && (folder === "active" || folder === "inbox") && !q) setFreshMail(true);
    seenUnread.current = n;
  }, [count?.unread, folder, q]);
  useEffect(() => setFreshMail(false), [list?.messages[0]?.id, folder, box, q]);
  /** Pulled down on a phone: ask Bird for new mail, then read the list and the count again. */
  async function refreshFromPull(): Promise<{ fresh: number }> {
    const r = await syncMail().catch(() => ({ ingested: 0 }));
    const cur = listRef.current;
    if (cur) await loadList(cur.folder, cur.filter, cur.q, cur.to, "reset");
    // What this pull brought in is already on screen: no "New mail" pill for it.
    seenUnread.current = Number.POSITIVE_INFINITY;
    notifyMailChanged();
    return { fresh: r.ingested ?? 0 };
  }

  return (
    <FacesContext.Provider value={faces}>
    <MailAurora hue={mailboxHue(box)} dark={t.dark} className="mail-aurora" />
    {openId && <ReadingProgress />}
    {freshMail && !openId && (
      <button
        type="button"
        onClick={() => {
          setFreshMail(false);
          resetList();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className={`pill-in fixed left-1/2 z-40 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-[13px] font-semibold shadow-xl mail-glass-top ${
          t.dark ? "border-white/15 bg-(--mail-accent-deep)/40 text-white" : "border-(--mail-accent-deep)/30 bg-white/90 text-(--mail-accent-ink)"
        }`}
        style={{ top: "calc(env(safe-area-inset-top) + 5.25rem)" }}
      >
        <span className="unread-glow h-1.5 w-1.5 rounded-full bg-(--mail-accent-pale)" />
        New mail
      </button>
    )}
    <div className="relative mx-auto flex max-w-[1400px] flex-col gap-3 sm:gap-4 lg:h-[calc(100dvh-4rem)]" style={{ ["--mail-hue" as string]: Math.round(mailboxHue(box) * 360) }}>
      {/* Phones: Mail is its own place. A way back to BFO, then the mailbox as the title, the way out to its menu. */}
      {!openId && (
        <div className="flex items-center gap-2 px-1 pt-1 md:hidden">
          <Link
            to="/home"
            aria-label="Back to BFO"
            className={`inline-flex h-[44px] shrink-0 items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] font-medium transition-colors ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2.2} />
            BFO
          </Link>
          <span className="flex-1" />
          {/* Your own photo is set from the desktop header; on a phone its menu had no room. */}
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`pill-glass h-[44px] w-[44px] ${t.dark ? "text-gray-100" : "text-gray-700"}`} iconClassName="h-[22px] w-[22px]" />
        </div>
      )}
      {!openId && address && !noAddress && (
        <div className={`sticky z-20 -mx-4 px-5 transition-[padding,background-color] duration-300 md:hidden ${scrolled ? `mail-glass-top border-b py-2 ${t.dark ? "border-white/[0.08] bg-[#0b0b10]/[0.92]" : "border-gray-200 bg-white/[0.92]"}` : "px-5 py-0"}`} style={{ top: "env(safe-area-inset-top)" }}>
          <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} big compact={scrolled} unread={count?.unread ?? 0} />
        </div>
      )}
      {!openId && noAddress && <p className={`px-2 text-[13px] md:hidden ${t.muted}`}>No address yet. Ask an admin for one.</p>}
      {/* Larger screens: the title, the addresses, search and the view switch on one line. */}
      <header className={`flex items-start justify-between gap-3 pt-1 max-md:hidden ${openId ? "max-lg:hidden" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          {address && !noAddress && <MyPhoto address={address} name={me?.name ?? null} onFaces={setFaces} />}
          <div className="min-w-0">
            <h1 className={`text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Mail</h1>
            {noAddress ? (
              <p className={`mt-1 text-[12.5px] ${t.muted}`}>No address yet</p>
            ) : address && (
              <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} />
            )}
          </div>
        </div>
        <SearchField value={q} onSearch={search} className="mx-6 hidden min-w-0 max-w-[460px] flex-1 self-center md:flex" />
        <div className="flex shrink-0 items-center gap-2">
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`h-8 w-8 ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`} />
          <Segmented
            label="View"
            value={view}
            onChange={chooseView}
            iconsOnly
            className="max-md:hidden"
            options={[
              { key: "table", label: "Table", icon: <Glyph name="rows" className="h-3.5 w-3.5" /> },
              { key: "columns", label: "Columns", icon: <Glyph name="columns" className="h-3.5 w-3.5" /> },
            ]}
          />
          <Button kind="primary" size="md" icon="edit" disabled={noAddress} title={noAddress ? "Ask an admin for an address" : undefined} onClick={() => setDraft(blankDraft(box || undefined))} className="max-sm:hidden">
            New
          </Button>
        </div>
      </header>

      {!openId && <SearchField value={q} onSearch={search} className="search-glow mx-1 md:hidden" />}

      {syncError && <p className={`-mt-1 text-[12px] ${t.muted}`}>Can't fetch new mail: {syncError}</p>}

      {view === "table" ? (
        /* One card: the table, or the open message in its place. */
        /* While reading, the card mustn't clip: the reader's toolbar sticks to the page, not to the card. */
        <section
          aria-label={tableReading ? "Message" : "Messages"}
          className={`mail-card flex min-h-0 flex-1 flex-col rounded-2xl border max-md:overflow-visible ${tableReading ? "lg:overflow-hidden" : "overflow-hidden"} ${t.surface}`}
        >
          {tableReading ? (
            <div className={`min-h-0 flex-1 lg:overflow-y-auto ${supportsViewTransitions() ? "" : "reader-in md:[animation:none]"}`}>{reader}</div>
          ) : (
            <>
              {toolbar}
              <PullToRefresh enabled={!openId} onRefresh={refreshFromPull} className="min-h-0 flex-1 overflow-y-auto max-md:overflow-visible max-sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
                {bulkBar}
                {listBody}
              </PullToRefresh>
            </>
          )}
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          {/* The list */}
          <section
            aria-label="Messages"
            className={`mail-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border max-md:overflow-visible lg:w-[400px] lg:flex-none ${t.surface} ${openId ? "max-lg:hidden" : ""}`}
          >
            {toolbar}
            <PullToRefresh enabled={!openId} onRefresh={refreshFromPull} className="min-h-0 flex-1 overflow-y-auto max-md:overflow-visible max-sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
              {bulkBar}
              {listBody}
            </PullToRefresh>
          </section>

          {/* The reader */}
          <section aria-label="Message" className={`mail-card min-w-0 flex-1 rounded-2xl border lg:overflow-y-auto ${t.surface} ${openId ? "" : "max-lg:hidden"}`}>
            {!open ? (
              <div className={`flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-[12.5px] ${t.faint}`}>
                <Icon name="mail" className="h-6 w-6" strokeWidth={1.4} />
                Nothing selected
              </div>
            ) : (
              reader
            )}
          </section>
        </div>
      )}

      {/* Phones: compose floats above the list, clear of the browser's bottom bar. */}
      {!openId && !draft && !noAddress &&
        createPortal(
          <button
            type="button"
            aria-label="New message"
            title="New message"
            onClick={() => setDraft(blankDraft(box || undefined))}
            className="mail-fab fab-in fab-glass fixed right-5 z-40 flex h-[58px] w-[58px] cursor-pointer items-center justify-center rounded-full transition-transform active:scale-90 sm:hidden"
            style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <Icon name="edit" className="h-[26px] w-[26px]" strokeWidth={1.9} />
          </button>,
          document.body
        )}

      {/* Portalled: <main> is its own stacking context, under the rail and the mobile header. */}
      {draft && createPortal(<Compose draft={draft} addresses={mine} onClose={() => setDraft(null)} onSent={(m) => onSent(m, draft.replyToId ?? draft.forwardId)} />, document.body)}

      {toast &&
        createPortal(
          <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4">
            <span className={`${toastLeaving ? "toast-out" : "toast-in"} pointer-events-auto inline-flex items-center gap-3 rounded-full px-4 py-2 text-[12.5px] font-medium shadow-lg ${t.dark ? "bg-white text-gray-950" : "bg-gray-900 text-white"}`}>
              {toast.text}
              {toast.undo && (
                <button
                  type="button"
                  onClick={() => toast.undo?.()}
                  title="Undo (z)"
                  className={`-my-1 cursor-pointer rounded-full px-2 py-1 font-semibold underline-offset-2 hover:underline ${t.dark ? "text-(--mail-accent-ink)" : "text-(--mail-accent-pale)"}`}
                >
                  Undo
                </button>
              )}
            </span>
          </div>,
          document.body
        )}
    </div>
    </FacesContext.Provider>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────

/** A row of pills where one is on. With `iconsOnly` the labels are tooltips. */
function Segmented<K extends string>({
  label,
  value,
  options,
  onChange,
  iconsOnly = false,
  stretch = false,
  className = "",
}: {
  label: string;
  value: K;
  options: { key: K; label: string; icon?: ReactNode }[];
  onChange: (next: K) => void;
  iconsOnly?: boolean;
  /** Fill the row, each choice the same width (phones). */
  stretch?: boolean;
  className?: string;
}) {
  const t = useTone();
  return (
    <div
      role="group"
      aria-label={label}
      className={`${stretch ? "flex w-full" : "inline-flex shrink-0"} items-center gap-0.5 rounded-xl p-0.5 ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"} ${className}`}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            aria-label={iconsOnly ? o.label : undefined}
            title={iconsOnly ? o.label : undefined}
            onClick={() => onChange(o.key)}
            className={`inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[9px] text-[12px] font-medium transition-colors max-sm:h-[38px] max-sm:text-[13.5px] ${
              stretch ? "flex-1 justify-center px-2" : iconsOnly ? "w-7 justify-center max-sm:w-[40px]" : "px-2.5 max-sm:px-3"
            } ${
              on ? (t.dark ? "bg-white/[0.1] text-white shadow-sm" : "bg-white text-gray-900 shadow-sm") : t.dark ? "text-gray-500 hover:text-gray-200" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            {o.icon}
            {!iconsOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The search box: what's typed is searched after a short pause (or at once on
 * Enter), and the URL keeps the term. Esc or the × clears it.
 */
function SearchField({ value, onSearch, className = "" }: { value: string; onSearch: (term: string) => void; className?: string }) {
  const t = useTone();
  const [term, setTerm] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  // Back/forward or a cleared search: the box follows the URL.
  useEffect(() => setTerm(value), [value]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  function change(next: string) {
    setTerm(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSearch(next), 350);
  }
  function submit(next: string) {
    if (timer.current) window.clearTimeout(timer.current);
    onSearch(next);
  }
  return (
    <div
      role="search"
      className={`flex items-center gap-2 rounded-full border px-3.5 transition-colors pill-glass max-md:h-[48px] max-md:px-5 md:h-9 md:rounded-xl md:px-3 ${
        t.dark ? "md:border-white/[0.08] md:bg-white/[0.04] md:focus-within:border-white/20 md:focus-within:bg-white/[0.06]" : "md:border-gray-200 md:bg-white md:focus-within:border-gray-400"
      } ${className}`}
    >
      <svg className={`h-[18px] w-[18px] shrink-0 md:h-4 md:w-4 ${t.muted}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search mail"
        placeholder="Search mail"
        data-page-search
        value={term}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(term);
          else if (e.key === "Escape") {
            setTerm("");
            submit("");
            ref.current?.blur();
          }
        }}
        style={{ outline: "none" }}
        className={`min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-gray-500 md:text-[13px] [&::-webkit-search-cancel-button]:hidden ${t.text}`}
      />
      {term && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setTerm("");
            submit("");
            ref.current?.focus();
          }}
          className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full max-md:-mr-2 max-md:h-[40px] max-md:w-[40px] ${t.dark ? "text-gray-400 hover:bg-white/[0.08] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
        >
          <Icon name="x" className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** The star: an outline, filled amber when on. */
function Star({ on, className = "h-3.5 w-3.5", strokeWidth = 1.6 }: { on: boolean; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`shrink-0 ${className} ${on ? "text-amber-400" : ""}`} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={GLYPHS.star} />
    </svg>
  );
}

/** Star toggle for a row: quiet until hovered, unless it's on. Stops the click reaching the row. */
/**
 * Picking a message: a round box that pops as it fills and draws its check
 * (a dash when only some are picked). Shift-click picks the range from the
 * last one picked.
 */
function SelectBox({ on, mixed = false, onToggle, label, className = "" }: { on: boolean; mixed?: boolean; onToggle: (shift: boolean) => void; label: string; className?: string }) {
  const t = useTone();
  const filled = on || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      title={label}
      // Shift-click shouldn't select the text between.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`group/pick inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full max-md:h-[40px] max-md:w-[40px] ${className}`}
    >
      <span
        key={filled ? "on" : "off"}
        className={`relative grid h-[17px] w-[17px] place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,box-shadow] duration-200 ${filled ? "pick-pop" : ""} ${
          filled
            ? "border-(--mail-accent) bg-(--mail-accent-deep) shadow-[0_0_0_3px_rgba(129,140,248,0.18)]"
            : t.dark
              ? "border-white/25 group-hover/pick:border-white/60"
              : "border-gray-300 group-hover/pick:border-gray-500"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-[9px] w-[9px]" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {mixed ? (
            <path d="M3 6h6" />
          ) : (
            <path d="M2.5 6.3l2.3 2.3 4.7-5" style={{ strokeDasharray: 12, strokeDashoffset: on ? 0 : 12, transition: "stroke-dashoffset 220ms ease 60ms" }} />
          )}
        </svg>
      </span>
    </button>
  );
}

function StarButton({ on, onToggle, className = "", alwaysOnPhones = false }: { on: boolean; onToggle: (next: boolean) => void; className?: string; alwaysOnPhones?: boolean }) {
  const t = useTone();
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      aria-label={on ? "Unstar" : "Star"}
      aria-pressed={on}
      title={on ? "Unstar" : "Star"}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) {
          setPop(true);
          setTimeout(() => setPop(false), 400);
          tap();
        }
        onToggle(!on);
      }}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors max-md:h-[40px] max-md:w-[40px] ${
        on ? "" : `${t.faint} md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 ${alwaysOnPhones ? "" : "max-md:hidden"} ${t.dark ? "hover:text-gray-200" : "hover:text-gray-700"}`
      } ${className}`}
    >
      <Star on={on} className={`h-3.5 w-3.5 max-md:h-[18px] max-md:w-[18px] ${pop ? "star-pop" : ""}`} strokeWidth={on ? 1.6 : 1.4} />
    </button>
  );
}

/** Phones: a thin line across the top that fills as you read down a message. */
function ReadingProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setPct(max > 40 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  if (pct <= 0) return null;
  return <div aria-hidden="true" className="read-progress md:hidden" style={{ width: `${pct}%`, top: "env(safe-area-inset-top)" }} />;
}

/** A tick of haptics on phones that have it (Android; iOS Safari ignores it). */
/** A light tap: native haptics in the iPhone app (app/native.ts). */
function tap() {
  haptic();
}

// ── List ─────────────────────────────────────────────────────────────────


/** Who a row is from — or, in Sent, who it went to. */
function whoOf(m: MailSummary, sent: boolean, me: string): string {
  if (!sent) return senderLabel(m.from);
  return m.to.map((a) => (same(a.email, me) ? "me" : senderLabel(a))).join(", ") || "—";
}

/** A small round mark for unread rows; invisible otherwise, so text lines up. */
function UnreadDot({ on }: { on: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-(--mail-accent)" : "bg-transparent"}`} />
      {on && <span className="sr-only">Unread. </span>}
    </>
  );
}

/** The spreadsheet: sender, subject, summary, attachment and time in columns, one line per message. */
function MailTable({
  rows,
  sent,
  mixed = false,
  me,
  onOpen,
  onStar,
  picked,
  onPick,
  onPickAll,
  className = "",
}: {
  rows: MailSummary[];
  sent: boolean;
  /** Active: in and out together, so each row says which. */
  mixed?: boolean;
  me: string;
  onOpen: (id: string) => void;
  onStar: (m: MailSummary, on: boolean) => void;
  picked: Set<string>;
  onPick: (id: string, shift: boolean) => void;
  onPickAll: () => void;
  className?: string;
}) {
  const all = rows.length > 0 && rows.every((m) => picked.has(m.id));
  const some = !all && rows.some((m) => picked.has(m.id));
  const t = useTone();
  const th = `px-2 pb-2 pt-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] ${t.faint}`;
  return (
    <table className={`w-full table-fixed border-collapse text-[12.5px] ${className}`}>
      <colgroup>
        <col className="w-[76px]" />
        <col className="w-[22%] lg:w-[200px] xl:w-[220px]" />
        <col className="w-[30%]" />
        <col />
        <col className="w-[32px]" />
        <col className="w-[84px]" />
      </colgroup>
      {/* While anything is picked, the action bar above takes the header's place. */}
      <thead className={`sticky top-0 z-[1] ${picked.size ? "hidden" : ""} ${t.dark ? "bg-[#0b0b0f]/95" : "bg-white/95"} backdrop-blur-xl`}>
        <tr className={`border-b ${t.line}`}>
          <th scope="col" className={`${th} py-1 pl-[14px]`}>
            <SelectBox on={all} mixed={some} onToggle={onPickAll} label={all ? "Unselect all" : "Select all"} />
          </th>
          <th scope="col" className={th}>
            {mixed ? "From / To" : sent ? "To" : "From"}
          </th>
          <th scope="col" className={th}>
            Subject
          </th>
          <th scope="col" className={th}>
            Summary
          </th>
          <th scope="col" className={th}>
            <span className="sr-only">Attachments</span>
          </th>
          <th scope="col" className={`${th} pr-4 text-right`}>
            Time
          </th>
        </tr>
      </thead>
      <tbody className={`divide-y ${t.divide}`}>
        {rows.map((m) => {
          const unread = !m.read;
          const out = sent || (mixed && m.direction === "out");
          const who = mixed && out ? `To ${whoOf(m, true, me)}` : whoOf(m, out, me);
          const on = picked.has(m.id);
          return (
            <tr
              aria-selected={on}
              key={m.id}
              data-mail-row={m.id}
              tabIndex={0}
              onClick={() => onOpen(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(m.id);
                }
              }}
              className={`group cursor-pointer transition-colors duration-150 ${
                on ? (t.dark ? "bg-(--mail-accent-deep)/[0.13] hover:bg-(--mail-accent-deep)/[0.17]" : "bg-(--mail-accent-deep)/10 hover:bg-(--mail-accent-deep)/15/70") : t.hover
              } focus-visible:outline-none ${t.dark ? "focus-visible:bg-white/[0.05]" : "focus-visible:bg-gray-50"}`}
            >
              <td className="py-1.5 pl-2 pr-0 align-middle">
                <div className="flex items-center gap-0.5">
                  <UnreadDot on={unread} />
                  <SelectBox on={on} onToggle={(shift) => onPick(m.id, shift)} label={on ? "Unselect" : "Select"} />
                  <StarButton on={m.starred} onToggle={(next) => onStar(m, next)} />
                </div>
              </td>
              <td className={`truncate px-2 py-2.5 align-middle ${unread ? `font-semibold ${t.text}` : `font-medium ${t.soft}`}`} title={out ? m.to.map(fullAddress).join(", ") : fullAddress(m.from)}>
                {who}
              </td>
              <td className={`truncate px-2 py-2.5 align-middle ${unread ? `font-medium ${t.text}` : t.soft}`}>{m.subject || "(no subject)"}</td>
              <td className={`truncate px-2 py-2.5 align-middle ${t.muted}`}>{m.snippet}</td>
              <td className={`px-1 py-2.5 align-middle ${t.muted}`}>
                {m.attachmentCount > 0 && <FileKindIcons kinds={m.attachmentKinds?.length ? m.attachmentKinds : ["file"]} count={m.attachmentCount} className="h-4 w-4" />}
              </td>
              <td className={`whitespace-nowrap py-2.5 pl-2 pr-4 text-right align-middle text-[11.5px] tabular-nums ${unread ? t.text : t.muted}`}>
                <time dateTime={m.occurredAt} title={fullDate(m.occurredAt)}>
                  {listDate(m.occurredAt)}
                </time>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListRow({
  m,
  sent,
  me,
  selected,
  onOpen,
  onPrefetch,
  onStar,
  picked = false,
  picking = false,
  onPick,
  onArchive,
}: {
  m: MailSummary;
  sent: boolean;
  me: string;
  selected: boolean;
  onOpen: () => void;
  /** The finger has landed on the row: fetch its message ahead of the tap. */
  onPrefetch?: () => void;
  onStar: (on: boolean) => void;
  /** Picked for a bulk action; `picking`: some message is, so every row shows its box. */
  picked?: boolean;
  picking?: boolean;
  onPick?: (shift: boolean) => void;
  /** Phones: a swipe left archives (when given). */
  onArchive?: () => void;
}) {
  const t = useTone();
  const unread = !m.read;
  // Phones: a finger across the row drags it; past the threshold it archives (left) or stars (right). A held finger picks it.
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const gesture = useRef<{ x: number; y: number; id: number; moved: boolean; held: boolean; timer: number } | null>(null);
  const THRESHOLD = 72;
  const onPointerDown = (e: React.PointerEvent) => {
    onPrefetch?.();
    if (e.pointerType === "mouse" || e.button !== 0) return;
    const g = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, held: false, timer: 0 };
    g.timer = window.setTimeout(() => {
      if (!g.moved && onPick) {
        g.held = true;
        tap();
        onPick(false);
      }
    }, 450);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.held) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.moved) {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
      window.clearTimeout(g.timer);
      if (Math.abs(ddy) > Math.abs(ddx)) {
        gesture.current = null; // a scroll, not a swipe
        return;
      }
      g.moved = true;
      setSwiping(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // a pointer the browser won't capture: the row still follows the finger while it stays over it
      }
    }
    // Only the ways that do something; the row resists past the threshold.
    const allowed = ddx < 0 ? !!onArchive : true;
    const raw = allowed ? ddx : ddx * 0.25;
    setDx(Math.max(-140, Math.min(140, Math.abs(raw) > THRESHOLD ? Math.sign(raw) * (THRESHOLD + (Math.abs(raw) - THRESHOLD) * 0.35) : raw)));
  };
  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    window.clearTimeout(g.timer);
    gesture.current = null;
    if (g.moved) {
      setSwiping(false);
      if (dx <= -THRESHOLD && onArchive) {
        tap();
        onArchive();
      } else if (dx >= THRESHOLD) {
        tap();
        onStar(!m.starred);
      }
      setDx(0);
    }
  };
  /** The click that follows a swipe or a hold isn't an open. */
  const swallowClick = useRef(false);
  const onClickRow = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    onOpen();
  };
  const who = sent ? `To ${whoOf(m, true, me)}` : whoOf(m, false, me);
  const face: MailAddress = sent ? (m.to.find((a) => !same(a.email, me)) ?? m.to[0] ?? m.from) : m.from;
  const past = Math.abs(dx) >= THRESHOLD;
  return (
    <div className={`swipe-track ${dx !== 0 ? "" : "md:contents"}`}>
      {dx < 0 && onArchive && (
        <div aria-hidden="true" className={`swipe-under justify-end ${past ? "bg-(--mail-accent-deep) text-white" : t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>
          <Glyph name="archive" className="mr-2 h-[18px] w-[18px]" />
          Archive
        </div>
      )}
      {dx > 0 && (
        <div aria-hidden="true" className={`swipe-under ${past ? "bg-amber-400 text-gray-950" : t.dark ? "bg-amber-400/20 text-amber-200" : "bg-amber-100 text-amber-800"}`}>
          <Star on className="mr-2 h-[18px] w-[18px]" />
          {m.starred ? "Unstar" : "Star"}
        </div>
      )}
    <div
      role="button"
      data-mail-row={m.id}
      tabIndex={0}
      onClick={onClickRow}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (g && (g.moved || g.held)) swallowClick.current = true;
        endGesture(e);
      }}
      onPointerCancel={endGesture}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-current={selected ? "true" : undefined}
      aria-selected={onPick ? picked : undefined}
      style={dx !== 0 ? { transform: `translateX(${dx}px)` } : undefined}
      className={`swipe-row group flex w-full cursor-pointer items-start gap-3 py-3 pl-4 pr-2 text-left transition-colors max-md:gap-3.5 max-md:rounded-2xl max-md:px-5 max-md:py-3.5 ${swiping ? "swiping" : "max-md:active:scale-[0.99]"} ${
        picked ? (t.dark ? "bg-(--mail-accent-deep)/[0.13]" : "bg-(--mail-accent-deep)/10") : selected ? (t.dark ? "bg-white/[0.06]" : "bg-gray-100/80") : dx !== 0 ? (t.dark ? "bg-[#0b0b0f]" : "bg-white") : t.hover
      } ${t.dark ? "active:bg-white/[0.05] focus-visible:bg-white/[0.05]" : "active:bg-gray-100 focus-visible:bg-gray-50"} focus-visible:outline-none`}
    >
      <span className="relative mt-0.5 shrink-0">
        {/* The avatar turns into its select box on hover, and stays one while anything is picked. Unread: it carries the light. */}
        <span className={`block rounded-full transition-opacity duration-150 ${unread && !picked ? "unread-ring" : ""} ${onPick && (picked || picking) ? "opacity-0" : onPick ? "md:group-hover:opacity-0" : ""}`}>
          <Avatar a={face} trusted={sent || !m.unverified} size="h-10 w-10 text-[13px] max-md:text-[12.5px]" />
        </span>
        {onPick && (
          <span className={`absolute inset-0 grid place-items-center transition-opacity duration-150 ${picked || picking ? "opacity-100" : "opacity-0 md:group-hover:opacity-100 max-md:opacity-0"}`}>
            <SelectBox on={picked} onToggle={onPick} label={picked ? "Unselect" : "Select"} className="!h-10 !w-10" />
          </span>
        )}
        {unread && (
          <span aria-hidden="true" className={`absolute -left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-(--mail-accent) ring-2 ${t.dark ? "ring-[#0b0b0f]" : "ring-white"}`} />
        )}
        {unread && <span className="sr-only">Unread. </span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] leading-5 max-md:text-[13px] max-md:leading-5 ${unread ? `font-semibold ${t.text}` : `font-medium ${t.soft}`}`}>{who}</span>
        <span className="flex items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-[12.5px] leading-5 max-md:text-[12px] max-md:leading-5 ${unread ? `font-semibold max-md:font-medium ${t.text}` : t.soft}`}>{m.subject || "(no subject)"}</span>
          {m.attachmentCount > 0 && (
            <span className="shrink-0">
              <FileKindIcons kinds={m.attachmentKinds?.length ? m.attachmentKinds : ["file"]} count={m.attachmentCount} className="h-[15px] w-[15px] max-md:h-4 max-md:w-4" />
            </span>
          )}
        </span>
        <span className={`block truncate text-[12px] leading-5 max-md:text-[11.5px] max-md:leading-5 ${t.muted}`}>{cleanSnippet(m.snippet) || "\u00a0"}</span>
      </span>
      {/* Right rail: when, and the star. Desktop shows the star on hover; phones always, as Gmail does. */}
      <span className="flex shrink-0 flex-col items-end justify-between self-stretch">
        <time dateTime={m.occurredAt} className={`pr-1 text-[11.5px] leading-5 tabular-nums max-md:text-[10.5px] max-md:leading-5 ${unread ? `font-semibold ${t.text}` : t.muted}`}>
          {listDate(m.occurredAt)}
        </time>
        <StarButton on={m.starred} onToggle={onStar} className="-mb-1.5 max-md:-mr-1" alwaysOnPhones />
      </span>
    </div>
    </div>
  );
}

// ── Reader ───────────────────────────────────────────────────────────────

function Reader({
  message: m,
  error,
  me,
  backAlways,
  onBack,
  onReply,
  onForward,
  onMove,
  onDelete,
  onStar,
  onUnread,
  thread,
  freshId,
  wholeConversation = false,
  preview = null,
}: {
  /** The whole conversation, newest first (the open message included). */
  thread: MailMessage[];
  /** A message just sent into it: it slides in at the top. */
  freshId: string | null;
  /** Opened from Active: Archive takes the whole conversation, whoever wrote this message. */
  wholeConversation?: boolean;
  /** The list's row for it, so the loader can open this very message (sender, subject, first words). */
  preview?: MailSummary | null;
  message: MailMessage | null;
  error: string | null;
  me: string;
  /** Show Back at every width (the table view gives the message the whole card). */
  backAlways: boolean;
  onBack: () => void;
  onReply: (m: MailMessage, mode: "reply" | "all") => void;
  onForward: (m: MailMessage) => void;
  onMove: (m: MailMessage, to: "inbox" | "archive") => void;
  onDelete: (m: MailMessage) => void;
  onStar: (m: MailMessage, on: boolean) => void;
  onUnread: (m: MailMessage) => void;
}) {
  const t = useTone();
  const [details, setDetails] = useState(false);
  // Opened without the message in hand: the envelope plays over the message, which renders underneath as soon as it
  // arrives (its frame and pictures load meanwhile), and lifts off to reveal it as the letter comes forward.
  const openedAt = useRef(performance.now());
  const [reveal, setReveal] = useState<"hold" | "go" | "done">(() => (m ? "done" : "hold"));
  useEffect(() => {
    if (!m || reveal === "done") return;
    const wait = Math.max(0, ENVELOPE_MS - (performance.now() - openedAt.current));
    const a = window.setTimeout(() => setReveal("go"), wait);
    const b = window.setTimeout(() => setReveal("done"), wait + 520);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [m, reveal]);
  const envelope = reveal !== "done";
  const toLine = (list: MailAddress[]) => list.map((a) => (same(a.email, me) ? "me" : senderLabel(a))).join(", ");
  const failed = m?.direction === "out" && /fail|bounce|reject|drop/i.test(m.status ?? "");
  const canReplyAll = !!m && m.to.length + m.cc.length > 1;
  const others = m ? thread.filter((x) => x.id !== m.id) : [];
  const newer = m ? others.filter((x) => x.occurredAt > m.occurredAt) : [];
  const older = m ? others.filter((x) => x.occurredAt <= m.occurredAt) : [];

  const starButton = (m: MailMessage, className = "") => (
    <button
      type="button"
      aria-label={m.starred ? "Unstar" : "Star"}
      aria-pressed={m.starred}
      title={m.starred ? "Unstar" : "Star"}
      onClick={() => onStar(m, !m.starred)}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors max-md:h-[44px] max-md:w-[44px] ${
        m.starred ? "hover:bg-amber-400/10" : t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      } ${className}`}
    >
      <Star on={m.starred} className="h-3.5 w-3.5 max-md:h-[22px] max-md:w-[22px]" strokeWidth={m.starred ? 1.6 : 1.4} />
    </button>
  );

  // Phones: the top bar's buttons are big and bright, with 24px icons; larger screens keep the small ones.
  const bar = `max-md:h-[48px] max-md:w-[48px] max-md:rounded-xl ${t.dark ? "max-md:text-gray-200" : "max-md:text-gray-700"}`;
  const barGlyph = "h-3.5 w-3.5 max-md:h-6 max-md:w-6";
  return (
    <article className="relative max-md:-mx-4 max-md:pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {/* Top bar. Phones: Back, then the message's housekeeping; Reply and Forward live in the bar at the bottom. */}
      <div
        className={`sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-1 border-b px-2 py-1.5 backdrop-blur-xl max-md:gap-1.5 max-md:px-3 max-md:py-2 md:rounded-t-2xl lg:top-0 ${t.line} ${
          t.dark ? "bg-[#0b0b0f]/90" : "bg-white/90"
        }`}
      >
        <button
          type="button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
          className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors max-md:h-[48px] max-md:w-auto max-md:gap-0.5 max-md:rounded-xl max-md:pl-1.5 max-md:pr-3.5 max-md:text-[16px] max-md:font-medium ${backAlways ? "" : "lg:hidden"} ${
            t.dark ? "text-gray-500 hover:bg-white/[0.06] hover:text-white max-md:text-gray-100" : "text-gray-400 hover:bg-gray-100 hover:text-gray-900 max-md:text-gray-900"
          }`}
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5 max-md:h-7 max-md:w-7" strokeWidth={2} />
          <span className="md:hidden">Back</span>
        </button>
        {m && (
          <>
            <Button kind="ghost" onClick={() => onReply(m, "reply")} aria-label="Reply" title="Reply" className="max-md:hidden">
              <Glyph name="reply" />
              Reply
            </Button>
            {canReplyAll && (
              <Button kind="ghost" onClick={() => onReply(m, "all")} aria-label="Reply all" title="Reply all" className="max-md:hidden">
                <Glyph name="replyAll" />
                Reply all
              </Button>
            )}
            <Button kind="ghost" onClick={() => onForward(m)} aria-label="Forward" title="Forward" className="max-md:hidden">
              <Glyph name="forward" />
              Forward
            </Button>
            <span className="flex-1" />
            {starButton(m, "max-md:hidden")}
            {m.direction === "in" && <GlyphButton glyph="unread" label="Mark as unread" onClick={() => onUnread(m)} className={bar} glyphClassName={barGlyph} />}
            {(m.direction === "in" || (wholeConversation && m.folder !== "archive")) &&
              (m.folder === "archive" ? (
                <GlyphButton glyph="unarchive" label="Move to inbox" onClick={() => onMove(m, "inbox")} className={bar} glyphClassName={barGlyph} />
              ) : (
                <GlyphButton glyph="archive" label="Archive" onClick={() => onMove(m, "archive")} className={bar} glyphClassName={barGlyph} />
              ))}
            <IconButton icon="trash" label="Delete" tone="danger" onClick={() => onDelete(m)} className={bar} iconClassName={barGlyph} />
          </>
        )}
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="relative">
      {envelope && !error && (
        <div className={`reader-envelope relative z-[5] ${m ? "pointer-events-none" : ""} ${reveal === "go" ? "env-out" : ""}`}>
          {preview ? (
            <ReaderLoader
              // Sent mail is sealed with who it went to.
              seal={<Avatar a={preview.direction === "out" && preview.to[0] ? preview.to[0] : preview.from} size="h-9 w-9 text-[12px]" trusted={!preview.unverified} />}
              subject={preview.subject || "(no subject)"}
              from={preview.direction === "out" ? `To ${preview.to.map((a) => senderLabel(a)).join(", ") || "—"}` : senderLabel(preview.from)}
              snippet={preview.snippet}
            />
          ) : (
            <ReaderLoader />
          )}
        </div>
      )}
      {m && (
        <div className={`px-5 pb-6 pt-4 sm:px-6 max-md:px-7 max-md:pt-6 ${envelope ? "absolute inset-x-0 top-0" : ""} ${reveal === "hold" ? "reader-under" : reveal === "go" ? "reader-reveal" : ""}`}>
          {/* Subject, with the star beside it on phones (as Gmail puts it). */}
          <div className="flex items-start gap-2">
            <h2 className={`min-w-0 flex-1 break-words text-[17px] font-semibold leading-snug tracking-[-0.01em] sm:text-[18px] max-md:text-[22px] max-md:font-medium max-md:leading-[1.3] max-md:tracking-[-0.015em] ${t.text}`}>
              {m.subject || "(no subject)"}
            </h2>
            {starButton(m, "md:hidden -mr-2 -mt-1.5")}
          </div>

          {/* Newer in the conversation (newest on top): the latest reads first, a reply just sent slides in. */}
          {newer.length > 0 && (
            <div className="mt-4 space-y-2.5">
              {newer.map((x, i) => (
                <ThreadCard key={x.id} m={x} me={me} open={i === 0 || x.id === freshId} fresh={x.id === freshId} />
              ))}
              <p className={`pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${t.faint}`}>The message you opened</p>
            </div>
          )}

          {/* The message itself; hovering it brings its Reply, Reply all and Forward up beside the date. */}
          <div className="group/main">
          <div className="mt-4 flex items-start gap-3 max-md:mt-6">
            <Avatar a={m.from} trusted={!m.unverifiedSender} size="h-9 w-9 text-[12px] max-md:h-11 max-md:w-11 max-md:text-[14px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`min-w-0 truncate text-[13px] font-semibold max-md:text-[15px] ${t.text}`}>{senderLabel(m.from)}</span>
                <time dateTime={m.occurredAt} className={`shrink-0 text-[12px] tabular-nums max-md:text-[13px] md:ml-auto md:pl-2 ${t.muted}`}>
                  <span className="md:hidden">{listDate(m.occurredAt)}</span>
                  <span className="max-md:hidden">{fullDate(m.occurredAt)}</span>
                </time>
                <span className="-my-1 hidden shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/main:opacity-100 focus-within:opacity-100 md:flex">
                  <GlyphButton glyph="reply" label="Reply" onClick={() => onReply(m, "reply")} />
                  {canReplyAll && <GlyphButton glyph="replyAll" label="Reply all" onClick={() => onReply(m, "all")} />}
                  <GlyphButton glyph="forward" label="Forward" onClick={() => onForward(m)} />
                </span>
              </div>
              {/* "To me ▾" opens every address. */}
              <button
                type="button"
                aria-expanded={details}
                onClick={() => setDetails((d) => !d)}
                className={`mt-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 text-left text-[12px] leading-snug max-md:min-h-[40px] max-md:text-[13.5px] ${t.muted} ${t.dark ? "hover:text-gray-300" : "hover:text-gray-700"}`}
              >
                <span className="truncate">
                  {m.to.length > 0 ? `To ${toLine(m.to)}` : "No recipients"}
                  {m.cc.length > 0 && <span className="max-md:hidden"> · Cc {toLine(m.cc)}</span>}
                </span>
                <Icon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${details ? "rotate-180" : ""}`} strokeWidth={2} />
              </button>
              {details && (
                <dl className={`mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-[12px] max-md:text-[13px] ${t.line} ${t.dark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                  {[
                    ["From", [fullAddress(m.from)]],
                    ["To", m.to.map(fullAddress)],
                    ["Cc", m.cc.map(fullAddress)],
                    ["Bcc", m.bcc.map(fullAddress)],
                    ["Date", [fullDate(m.occurredAt)]],
                  ]
                    .filter(([, v]) => (v as string[]).length)
                    .map(([k, v]) => (
                      <Fragment key={k as string}>
                        <dt className={t.muted}>{k}</dt>
                        <dd className={`min-w-0 break-words ${t.soft}`}>{(v as string[]).join(", ")}</dd>
                      </Fragment>
                    ))}
                </dl>
              )}
              {(m.unverifiedSender || failed) && (
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {m.unverifiedSender && <Dot tone="muted">Sender not verified</Dot>}
                  {failed && <Dot tone="bad">Not delivered</Dot>}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 max-md:mt-6">
            {m.html ? <MailFrame html={m.html} title={m.subject || "Message"} /> : <PlainBody text={m.text ?? ""} />}
          </div>

          {m.attachments.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2 max-md:mt-6">
              {m.attachments.map((a) => (
                <AttachmentChip key={a.id} messageId={m.id} a={a} />
              ))}
            </div>
          )}

          {/* Desktop: Reply, Reply all and Forward as big targets right under the message they answer, before anything earlier. */}
          <div className="mt-6 hidden md:block">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onReply(m, "reply")}
                className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-6 text-[14px] font-semibold shadow-sm transition-[transform,background-color] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] ${
                  t.dark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                <Glyph name="reply" className="h-[18px] w-[18px]" />
                Reply
              </button>
              {canReplyAll && (
                <button
                  type="button"
                  onClick={() => onReply(m, "all")}
                  className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-5 text-[14px] font-medium transition-[transform,background-color] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] ${
                    t.dark ? "border-white/[0.14] text-gray-100 hover:bg-white/[0.06]" : "border-gray-300 text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <Glyph name="replyAll" className="h-[18px] w-[18px]" />
                  Reply all
                </button>
              )}
              <button
                type="button"
                onClick={() => onForward(m)}
                className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-5 text-[14px] font-medium transition-[transform,background-color] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] ${
                  t.dark ? "border-white/[0.14] text-gray-100 hover:bg-white/[0.06]" : "border-gray-300 text-gray-800 hover:bg-gray-50"
                }`}
              >
                <Glyph name="forward" className="h-[18px] w-[18px]" />
                Forward
              </button>
            </div>
          </div>
          </div>

          {older.length > 0 && (
            <div className="mt-7 space-y-2">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${t.faint}`}>Earlier in this conversation · {older.length}</p>
              {older.map((x) => (
                <ThreadCard key={x.id} m={x} me={me} open={false} fresh={false} />
              ))}
            </div>
          )}

        </div>
      )}
      </div>

      {/* Phones: Reply and Forward within thumb's reach, above the browser's bottom bar. */}
      {m &&
        createPortal(
          <div
            className={`fixed inset-x-0 bottom-0 z-40 flex items-center gap-2.5 border-t px-4 pt-3 backdrop-blur-xl md:hidden ${reveal === "hold" ? "reader-under" : reveal === "go" ? "reader-reveal" : ""} ${t.line} ${t.dark ? "bg-black/80" : "bg-white/90"}`}
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              onClick={() => onReply(m, "reply")}
              className={`flex h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border text-[15px] font-medium transition-colors active:scale-[0.98] ${
                t.dark ? "border-white/[0.12] text-gray-100 active:bg-white/[0.06]" : "border-gray-300 text-gray-800 active:bg-gray-100"
              }`}
            >
              <Glyph name="reply" className="h-[18px] w-[18px]" />
              Reply
            </button>
            <button
              type="button"
              onClick={() => onForward(m)}
              className={`flex h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border text-[15px] font-medium transition-colors active:scale-[0.98] ${
                t.dark ? "border-white/[0.12] text-gray-100 active:bg-white/[0.06]" : "border-gray-300 text-gray-800 active:bg-gray-100"
              }`}
            >
              <Glyph name="forward" className="h-[18px] w-[18px]" />
              Forward
            </button>
            {canReplyAll && (
              <button
                type="button"
                aria-label="Reply all"
                title="Reply all"
                onClick={() => onReply(m, "all")}
                className={`flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors active:scale-[0.98] ${
                  t.dark ? "border-white/[0.12] text-gray-100 active:bg-white/[0.06]" : "border-gray-300 text-gray-800 active:bg-gray-100"
                }`}
              >
                <Glyph name="replyAll" className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>,
          document.body
        )}
    </article>
  );
}

/** One message in the conversation: who and when, opening to its body. */
function ThreadCard({ m, me, open: startOpen, fresh }: { m: MailMessage; me: string; open: boolean; fresh: boolean }) {
  const t = useTone();
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);
  const mine = same(m.from.email, me) || m.direction === "out";
  return (
    <section className={`overflow-hidden rounded-xl border ${t.line} ${t.dark ? "bg-white/[0.025]" : "bg-gray-50/70"} ${fresh ? "thread-fresh" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left ${t.hover}`}>
        <Avatar a={m.from} trusted={!m.unverifiedSender} size="h-7 w-7 text-[10.5px]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-[13px] font-semibold ${t.text}`}>{mine ? "You" : senderLabel(m.from)}</span>
            {fresh && <span className={`shrink-0 text-[11px] font-medium ${t.accent}`}>Just sent</span>}
          </span>
          {!open && <span className={`block truncate text-[12px] ${t.muted}`}>{m.snippet || (m.text ?? "").slice(0, 140)}</span>}
        </span>
        <time dateTime={m.occurredAt} className={`shrink-0 text-[11.5px] tabular-nums ${t.muted}`}>
          {listDate(m.occurredAt)}
        </time>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          {m.html ? <MailFrame html={m.html} title={m.subject || "Message"} /> : <PlainBody text={m.text ?? ""} />}
          {m.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <AttachmentChip key={a.id} messageId={m.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

/** Plain text with links made clickable. */
function Linkified({ text }: { text: string }) {
  const { accent } = useTone();
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    // Trailing punctuation belongs to the sentence, not the link.
    const trail = /[).,;:!?\]]+$/.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, -trail.length);
    const at = match.index ?? 0;
    out.push(text.slice(last, at));
    out.push(
      <a key={at} href={url} target="_blank" rel="noopener noreferrer" className={`underline-offset-2 hover:underline ${accent}`}>
        {url}
      </a>
    );
    last = at + url.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** A text message: quoted lines (">") sit in a quiet block. */
function PlainBody({ text, nested = false }: { text: string; nested?: boolean }) {
  const t = useTone();
  const blocks = useMemo(() => {
    const out: { quote: boolean; text: string }[] = [];
    for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
      const quote = line.startsWith(">");
      const body = quote ? line.replace(/^>\s?/, "") : line;
      const prev = out[out.length - 1];
      if (prev && prev.quote === quote) prev.text += `\n${body}`;
      else out.push({ quote, text: body });
    }
    return out;
  }, [text]);
  if (!nested && !text.trim()) return <p className={`text-[13px] ${t.faint}`}>No text.</p>;
  return (
    <div className={nested ? "" : `max-w-[75ch] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed max-md:text-[15.5px] max-md:leading-[1.6] ${t.text}`}>
      {blocks.map((b, i) =>
        b.quote ? (
          <div key={i} className={`my-1 border-l-2 pl-3 ${t.dark ? "border-white/10" : "border-gray-200"} ${t.muted}`}>
            <PlainBody text={b.text} nested />
          </div>
        ) : (
          <span key={i}>
            <Linkified text={b.text} />
            {i < blocks.length - 1 ? "\n" : ""}
          </span>
        )
      )}
    </div>
  );
}

function AttachmentChip({ messageId, a }: { messageId: string; a: MailAttachment }) {
  const t = useTone();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      const { url } = await attachmentUrl(messageId, a.id);
      // The link is signed with a download filename, so this saves the file in place.
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const off = !a.available;
  return (
    <button
      type="button"
      onClick={open}
      disabled={off || busy}
      title={off ? "No longer available" : `Download ${a.filename}`}
      className={`inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:cursor-default max-sm:min-h-[40px] ${
        t.dark ? "border-white/[0.08] hover:bg-white/[0.04]" : "border-gray-200 hover:bg-gray-50"
      } ${off ? "opacity-50" : ""}`}
    >
      <FileIcon kind={fileKind(a.filename, a.contentType)} className="h-5 w-5" />
      <span className={`min-w-0 truncate ${t.text}`}>{a.filename || "attachment"}</span>
      <span className={`shrink-0 tabular-nums ${failed ? (t.dark ? "text-red-300" : "text-red-600") : t.muted}`}>
        {failed ? "Failed" : off ? "Expired" : busy ? <Orbit className="h-3 w-3 align-[-2px]" /> : formatBytes(a.size)}
      </span>
    </button>
  );
}

// ── Compose ──────────────────────────────────────────────────────────────

const MAX_ATTACH = 3 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** "a@x.com, Name <b@y.com>; c@z.com" → addresses, plus anything that isn't one. */
/** True when `m` comes after `last` in the list's newest-first (time, id) order. */
/** Active's order: latest activity first, then the conversation's key (as the server sorts). */
function threadSortsAfter(m: MailSummary, last: MailSummary): boolean {
  if (!m.threadAt || !last.threadAt) return sortsAfter(m, last);
  const a = Date.parse(m.threadAt), b = Date.parse(last.threadAt);
  if (a !== b) return a < b;
  return (m.threadKey ?? "") > (last.threadKey ?? "");
}

function sortsAfter(m: MailSummary, last: MailSummary): boolean {
  const a = Date.parse(m.occurredAt), b = Date.parse(last.occurredAt);
  if (a !== b) return a < b;
  if (m.occurredAt !== last.occurredAt) return m.occurredAt < last.occurredAt;
  return m.id < last.id;
}

function parseRecipients(input: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  // Split on , ; or newline only outside "quoted names" and <addresses>.
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angled = false;
  for (const ch of input) {
    if (ch === '"' && !angled) quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    if (!quoted && !angled && /[,;\n]/.test(ch)) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!p) continue;
    // Outlook style "Smith, Jane <j@x.com>": a name-only piece belongs to the next bracketed address.
    if (!p.includes("@") && !p.includes("<") && parts[i + 1]?.includes("<")) continue;
    // Take a bracketed address only when it ends the piece; anything else is reported, never dropped.
    const pieces = p.includes("<") ? [p.match(/<([^>]*)>\s*$/)?.[1]?.trim() ?? p] : p.split(/\s+/);
    for (const e of pieces) (EMAIL_RE.test(e) ? ok : bad).push(e);
  }
  return { ok, bad };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * A From line that opens a menu of the account's addresses (the mailbox
 * picker's look), in place of the browser's own select.
 */
function AddressDropdown({ id, labelledBy, value, options, onChange, className = "" }: { id: string; labelledBy: string; value: string; options: string[]; onChange: (next: string) => void; className?: string }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const width = Math.min(Math.max(r.width, 300), vw - 24);
      setPlace({ top: r.bottom + 4, left: Math.max(12, Math.min(r.left, vw - 12 - width)), width });
    };
    measure();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const n = e.target as Node;
      if (!wrap.current?.contains(n) && !menuRef.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", measure);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const localPart = (a: string) => a.slice(0, a.indexOf("@"));
  const hueOf = (a: string) => `hsl(${Math.round(mailboxHue(a) * 360)} 70% ${t.dark ? 62 : 48}%)`;
  return (
    <div ref={wrap} className="flex min-w-0 flex-1 items-center">
      <button id={id} type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${labelledBy} ${id}`} onClick={() => setOpen((o) => !o)} className={`flex items-center gap-2 text-left ${className}`}>
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hueOf(value), boxShadow: `0 0 10px ${hueOf(value)}88` }} />
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <Icon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${t.muted}`} />
      </button>
      {open && place && createPortal(
        <div ref={menuRef} role="listbox" aria-label="Send from" style={{ position: "fixed", top: place.top, left: place.left, width: place.width }} className={`sheet-up z-[70] overflow-hidden rounded-2xl border py-1 shadow-2xl mail-glass-top ${t.dark ? "border-white/10 bg-[#0f0f16]/90" : "border-gray-200 bg-white/95"}`}>
          {options.map((a) => {
            const on = a === value;
            return (
              <button
                key={a}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(a);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors max-sm:min-h-[50px] ${on ? t.text : t.soft} ${t.dark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`}
              >
                <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${hueOf(a)}, ${hueOf(a + "x")})` }}>
                  {localPart(a).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{localPart(a)}</span>
                  <span className={`block truncate text-[12px] ${t.muted}`}>{a}</span>
                </span>
                {on && <Icon name="check" className={`h-4 w-4 shrink-0 ${t.accent}`} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

function Compose({ draft, addresses, onClose, onSent }: { draft: Draft; addresses: string[]; onClose: () => void; onSent: (m: MailSummary) => void }) {
  const t = useTone();
  const [sendId] = useState(() => crypto.randomUUID());
  // Several addresses and none named by the draft (composed from "All mailboxes"): ask which, before anything else.
  const [from, setFrom] = useState(() => addresses.find((a) => draft.from && same(a, draft.from)) ?? (addresses.length > 1 ? "" : addresses[0] ?? ""));
  const needsFrom = addresses.length > 1 && !from;
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(!!(draft.cc || draft.bcc));
  const [subject, setSubject] = useState(draft.subject);
  // The body is formatted: a reply's quote and a forward's header come in as paragraphs and a quote.
  // A reply or forward starts with blank lines above the quote: keep one, empty, for the caret to type in.
  const [initialHtml] = useState(() => (/^[ \t]*\n/.test(draft.text) ? "<p><br></p>" : "") + htmlFromPlain(draft.text));
  const [html, setHtml] = useState(initialHtml);
  const [improving, setImproving] = useState(false);
  /** The body before Improve design, so it can be put back. */
  const [beforeImprove, setBeforeImprove] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  /** The check after a send, shown for a moment before the panel goes. */
  const [sentOk, setSentOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<MailEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const asking = useRef(false);

  const dirty = to !== draft.to || cc !== draft.cc || bcc !== draft.bcc || subject !== draft.subject || html !== initialHtml || files.length > 0;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  // Leaving the page (Back, a palette jump) asks first; ?m and ?f changes inside the inbox don't.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !sending && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    // Already asking (Esc): that answer decides; stay here.
    if (asking.current) {
      blocker.reset();
      return;
    }
    asking.current = true;
    void confirmDialog({ title: "Discard this message?", confirmLabel: "Discard", tone: "danger" }).then((ok) => {
      asking.current = false;
      if (ok) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker]);

  // Reload or closing the tab: the browser's own prompt.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const [leaving, setLeaving] = useState(false);
  async function close() {
    if (sending || asking.current || leaving) return;
    if (dirty) {
      asking.current = true;
      const ok = await confirmDialog({ title: "Discard this message?", confirmLabel: "Discard", tone: "danger" });
      asking.current = false;
      if (!ok) return;
    }
    // The sheet goes the way it came, then unmounts.
    setLeaving(true);
    window.setTimeout(onClose, 200);
  }

  useEffect(() => {
    // New / Reply / Forward: focus goes back there on close.
    const opener = document.activeElement as HTMLElement | null;
    if (draft.focus === "body" && bodyRef.current) {
      bodyRef.current.focus(true);
    } else toRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keeps Tab inside the dialog. */
  function trapTab(e: React.KeyboardEvent) {
    const panel = panelRef.current;
    if (!panel) return;
    const list = [
      ...panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    ].filter((el) => el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const cur = document.activeElement;
    if (!panel.contains(cur)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && cur === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const next = [...files, ...picked];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_ATTACH) {
      setError("Attachments can total 3 MB.");
      return;
    }
    setError(null);
    setFiles(next);
  }

  /** Lay the message out better: the same words, clearer shape. Undo puts it back. */
  async function improveDesign() {
    if (improving) return;
    setImproving(true);
    setError(null);
    try {
      const before = html;
      const { html: better } = await improveMail(html, subject);
      bodyRef.current?.setHtml(better);
      setBeforeImprove(before);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImproving(false);
    }
  }

  async function send() {
    if (sending) return;
    if (needsFrom) return setError("Choose which mailbox it goes out from.");
    const lists = [parseRecipients(to), parseRecipients(cc), parseRecipients(bcc)];
    const bad = lists.flatMap((l) => l.bad);
    const total = lists.reduce((n, l) => n + l.ok.length, 0);
    if (bad.length) return setError(`Check ${bad[0]}.`);
    if (!total) return setError("Add a recipient.");
    if (total > MAX_RECIPIENTS) return setError(`Up to ${MAX_RECIPIENTS} recipients.`);
    if (totalBytes > MAX_ATTACH) return setError("Attachments can total 3 MB.");
    setSending(true);
    setError(null);
    try {
      const attachments: OutgoingAttachment[] = await Promise.all(
        files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", data: await readBase64(f) }))
      );
      const { message } = await sendMail({
        sendId,
        ...(from && addresses.length > 1 ? { from } : {}),
        to: lists[0].ok,
        ...(lists[1].ok.length ? { cc: lists[1].ok } : {}),
        ...(lists[2].ok.length ? { bcc: lists[2].ok } : {}),
        subject: subject.replace(/[\r\n]+/g, " ").trim(),
        text: composeText(html),
        html,
        ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
        ...(draft.forwardId ? { forwardId: draft.forwardId } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      setSentOk(true);
      window.setTimeout(() => onSent(message), 520);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  // The fields are borderless rows; the caret shows focus (the global focus ring would box them).
  const field = `min-w-0 flex-1 bg-transparent py-2.5 text-[13px] placeholder:text-gray-500 max-sm:text-[16px] ${t.text}`;
  const noRing = { outline: "none" } as const;
  const label = `w-[60px] shrink-0 text-[12px] ${t.muted}`;
  const row = `flex items-center gap-2 border-b px-4 max-sm:px-6 ${t.line}`;

  return (
    <div
      // Focusable, so a click on the title or backdrop keeps focus here and Esc / ⌘↵ still work.
      tabIndex={-1}
      style={{ outline: "none" }}
      className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-6"
      onKeyDown={(e) => {
        // The discard confirm is up: its keys are its own.
        if (asking.current) return;
        if (e.key === "Tab") trapTab(e);
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        } else if (e.key === "Escape") {
          // Stop here: the confirm dialog listens on window and would take this same keypress.
          e.preventDefault();
          e.stopPropagation();
          void close();
        }
      }}
    >
      <div className={`palette-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px] max-sm:hidden ${leaving ? "backdrop-out" : ""}`} onClick={() => !dirty && void close()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        className={`palette-panel ${leaving ? "sheet-down" : "sheet-up"} relative flex w-full flex-col overflow-hidden shadow-2xl sm:max-h-[min(760px,calc(100dvh-3rem))] sm:max-w-[680px] sm:rounded-2xl sm:border ${
          t.dark ? "border-white/10 bg-[#111113]" : "border-gray-200 bg-white"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <header className={`flex h-12 shrink-0 items-center gap-2 border-b pl-4 pr-2 max-sm:h-14 max-sm:pl-6 max-sm:pr-3 ${t.line}`}>
          <h2 id="compose-title" className={`flex-1 truncate text-[13.5px] font-semibold ${t.text}`}>
            {draft.title}
          </h2>
          <IconButton icon="x" label="Close" onClick={() => void close()} />
        </header>

        {needsFrom && (
          <div className={`absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col max-sm:top-14 ${t.dark ? "bg-[#111113]" : "bg-white"}`} style={{ top: "calc(env(safe-area-inset-top) + 3rem)" }}>
            <div className="px-5 pb-3 pt-6 sm:px-6">
              <p className={`text-[15px] font-semibold ${t.text}`}>Send from which mailbox?</p>
              <p className={`mt-1 text-[12.5px] ${t.muted}`}>You're looking at all your mail, so pick the address this goes out from. It can be changed in the From line after.</p>
            </div>
            <ul role="listbox" aria-label="Send from" className="px-3 sm:px-4">
              {addresses.map((a, i) => (
                <li key={a}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    autoFocus={i === 0}
                    onClick={() => {
                      setFrom(a);
                      setError(null);
                      setTimeout(() => toRef.current?.focus(), 0);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors max-sm:min-h-[52px] ${t.dark ? "hover:bg-white/[0.06]" : "hover:bg-gray-100"}`}
                  >
                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.dark ? "bg-white/[0.06]" : "bg-gray-100"}`}>
                      <Icon name="mail" className={`h-4 w-4 ${t.muted}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[14px] font-medium ${t.text}`}>{a.slice(0, a.indexOf("@"))}</span>
                      <span className={`block truncate text-[12px] ${t.muted}`}>{a}</span>
                    </span>
                    <Icon name="chevronRight" className={`h-4 w-4 shrink-0 ${t.faint}`} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {addresses.length > 1 && (
          <div className={row}>
            <span id="compose-from-label" className={label}>From</span>
            <AddressDropdown id="compose-from" labelledBy="compose-from-label" value={from} options={addresses} onChange={setFrom} className={`${field} cursor-pointer max-sm:min-h-[44px]`} />
          </div>
        )}
        <div className={row}>
          <label htmlFor="compose-to" className={label}>To</label>
          <input id="compose-to" ref={toRef} value={to} onChange={(e) => setTo(e.target.value)} className={field} style={noRing} autoComplete="email" inputMode="email" spellCheck={false} />
          {!showCc && (
            <TextButton onClick={() => setShowCc(true)} className={t.muted}>
              Cc/Bcc
            </TextButton>
          )}
        </div>
        {showCc && (
          <>
            <div className={row}>
              <label htmlFor="compose-cc" className={label}>Cc</label>
              <input id="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} className={field} style={noRing} autoComplete="email" inputMode="email" spellCheck={false} />
            </div>
            <div className={row}>
              <label htmlFor="compose-bcc" className={label}>Bcc</label>
              <input id="compose-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} className={field} style={noRing} autoComplete="email" inputMode="email" spellCheck={false} />
            </div>
          </>
        )}
        <div className={row}>
          <label htmlFor="compose-subject" className={label}>Subject</label>
          <input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} className={field} style={noRing} />
        </div>

        <MailEditor
          ref={bodyRef}
          initialHtml={initialHtml}
          onChange={(h) => {
            setHtml(h);
            setBeforeImprove(null);
          }}
          placeholder="Write your message…"
          className="min-h-[220px] w-full flex-1 max-sm:px-6 max-sm:py-5 sm:h-[340px] sm:min-h-[120px] sm:flex-initial"
        />

        {(draft.carried.length > 0 || files.length > 0) && (
          <div className={`flex shrink-0 flex-wrap gap-1.5 border-t px-4 py-2.5 max-sm:px-6 ${t.line}`}>
            {draft.carried.map((a) => (
              <span key={a.id} title="From the original" className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] ${t.dark ? "border-white/[0.08]" : "border-gray-200"}`}>
                <FileIcon kind={fileKind(a.filename, a.contentType)} className="h-4 w-4" />
                <span className={`min-w-0 truncate ${t.text}`}>{a.filename}</span>
                <span className={`shrink-0 ${t.muted}`}>{formatBytes(a.size)}</span>
              </span>
            ))}
            {files.map((file, i) => (
              <span key={`${file.name}-${i}`} className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border py-0.5 pl-2 pr-0.5 text-[12px] ${t.dark ? "border-white/[0.08]" : "border-gray-200"}`}>
                <FileIcon kind={fileKind(file.name, file.type)} className="h-4 w-4" />
                <span className={`min-w-0 truncate ${t.text}`}>{file.name}</span>
                <span className={`shrink-0 ${t.muted}`}>{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md max-sm:h-[40px] max-sm:w-[40px] ${t.dark ? "text-gray-500 hover:bg-white/[0.06] hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-900"}`}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className={`shrink-0 border-t ${t.line}`}>
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}

        <footer className={`flex shrink-0 items-center gap-1.5 border-t px-3 py-2.5 max-sm:px-5 max-sm:py-3 ${t.line}`} style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <GlyphButton glyph="clip" label="Attach files" onClick={() => fileRef.current?.click()} />
          {totalBytes > 0 && <span className={`text-[11.5px] tabular-nums ${t.muted}`}>{formatBytes(totalBytes)}</span>}
          <span className={`mx-1 h-4 w-px max-sm:hidden ${t.dark ? "bg-white/10" : "bg-gray-200"}`} aria-hidden />
          <span className="max-sm:hidden">
            <FormatBar disabled={sending || improving} onFormat={() => setHtml(document.activeElement?.innerHTML ?? html)} />
          </span>
          <span className="flex-1" />
          {beforeImprove !== null ? (
            <Button
              kind="ghost"
              onClick={() => {
                bodyRef.current?.setHtml(beforeImprove);
                setBeforeImprove(null);
              }}
            >
              Undo design
            </Button>
          ) : (
            <Button kind="ghost" icon="sparkle" disabled={sending || improving || !composeText(html).trim()} onClick={() => void improveDesign()}>
              <BusyLabel busy={improving}>{improving ? "Improving…" : "Improve design"}</BusyLabel>
            </Button>
          )}
          <span className={`mr-1 text-[11px] max-sm:hidden ${t.faint}`}>⌘↵</span>
          <Button kind="ghost" onClick={() => void close()} disabled={sending}>
            Discard
          </Button>
          <button type="button" onClick={() => void send()} disabled={sending || sentOk} className={`${buttonClass("primary", t.dark)} min-w-[72px]`}>
            <BusyLabel busy={sending} done={sentOk} doneLabel="Sent">
              {sending ? "Sending…" : "Send"}
            </BusyLabel>
          </button>
        </footer>
      </div>
    </div>
  );
}
