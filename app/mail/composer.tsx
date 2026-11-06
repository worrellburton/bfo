import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router";
import { AiNote, Banner, Button, Icon, IconButton, Select, TextLink, Tooltip, confirm, cx, isApple, useOverlay, usePhone } from "../ui";
import { overlayRoot } from "../ui/portal";
import { FormatBar, MailEditor, type MailEditorHandle } from "../mail-editor";
import { composeText, htmlFromPlain } from "../../lib/mail-compose";
import { isNoReply, mentionsAttachment } from "../../lib/mail-safety";
import { improveMail, type OutgoingAttachment } from "../mail-client";
import { Glyph, GlyphButton } from "./glyphs";
import { bytes, domainOf, same } from "./helpers";
import type { Draft } from "./drafts";

// ── Compose ──────────────────────────────────────────────────────────────

const MAX_ATTACH = 3 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
/** The first-use notice for Tidy layout (§11.4), kept on this device once accepted; the server records it too. */
const TIDY_VERSION = "mail-tidy-2026-11";
const TIDY_KEY = "bfo-mail-tidy-ack";

/** "a@x.com, Name <b@y.com>; c@z.com" → addresses, plus anything that isn't one. */
export function parseRecipients(input: string): { ok: string[]; bad: string[] } {
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
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}. Choose it again.`));
    reader.readAsDataURL(file);
  });
}

/** The visual viewport (the part of the screen the keyboard leaves), so a phone's composer keeps Send and its bar in view. */
function useVisualViewport(on: boolean): { top: number; height: number } | null {
  const [v, setV] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!on || !vv) return;
    const sync = () => setV({ top: vv.offsetTop, height: vv.height });
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [on]);
  return v;
}

/**
 * A recipient line: the addresses as chips once typed (a name when the mail
 * gave one, the address on hover), an invalid one in the negative tone, one
 * outside the office marked; typing goes back to the text.
 */
function RecipientField({
  id,
  label,
  value,
  onChange,
  names,
  officeDomain,
  inputRef,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  names: Record<string, string>;
  officeDomain: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  trailing?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const parsed = useMemo(() => parseRecipients(value), [value]);
  const showChips = !editing && !!value.trim() && parsed.ok.length + parsed.bad.length > 0;
  const chip = (text: string, title: string, kind: "ok" | "outside" | "bad") => (
    <span
      key={`${kind}:${title}`}
      title={title}
      className={cx(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-full border px-2 text-small",
        kind === "bad" ? "border-negative text-negative" : kind === "outside" ? "border-edge text-ink" : "border-line-strong text-ink",
      )}
    >
      {kind === "bad" && <Icon name="error" size={12} />}
      {kind === "outside" && (
        <span className="text-warning">
          <Icon name="warning" size={12} />
        </span>
      )}
      <span className="truncate">{text}</span>
    </span>
  );
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-line px-4 touch:min-h-[48px] md:px-5">
      <label htmlFor={id} className="w-[56px] shrink-0 text-small text-ink-2 touch:text-body">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <input
          id={id}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          aria-invalid={parsed.bad.length > 0 || undefined}
          className={cx("h-10 w-full min-w-0 bg-transparent text-field text-ink outline-none! placeholder:text-ink-3", showChips && "text-transparent")}
        />
        {showChips && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => ref.current?.focus()}
            className="absolute inset-0 flex cursor-text items-center gap-1 overflow-hidden bg-overlay text-left"
          >
            {parsed.ok.map((e) => chip(names[e.toLowerCase()] ?? e, e, officeDomain && domainOf(e) !== officeDomain ? "outside" : "ok"))}
            {parsed.bad.map((e) => chip(e, `“${e}” isn't an email address`, "bad"))}
          </button>
        )}
      </div>
      {trailing}
    </div>
  );
}

/** What Send hands the page: the request, less the ids the page adds. */
export type QueuedSend = { from?: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html: string; attachments: OutgoingAttachment[] };

/**
 * Writing a message (§8.19). Desktop: docked at the bottom right, beside the
 * inbox rather than over it, so the message being answered stays readable;
 * it can be made small. Phones: a full-screen sheet sized to the visible
 * screen, with Cancel and Send in its top bar and Attach in a bar that rides
 * above the keyboard. The quoted original is kept under the person's words,
 * collapsed. Before Send it checks what people miss: an attachment mentioned
 * but not attached, recipients outside the office, a no-reply address.
 * Send hands the message to the page, which holds it ten seconds for Undo.
 */
export function Compose({
  draft,
  addresses,
  onClose,
  onQueue,
}: {
  draft: Draft;
  addresses: string[];
  onClose: () => void;
  /** Send: the request, and the draft as it stands (to reopen on Undo or failure). */
  onQueue: (request: QueuedSend, restore: Draft) => void;
}) {
  const phone = usePhone();
  // Several addresses and none named by the draft (composed from "All mailboxes"): From starts unchosen.
  const [from, setFrom] = useState(() => addresses.find((a) => draft.from && same(a, draft.from)) ?? (addresses.length > 1 ? "" : (addresses[0] ?? "")));
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(!!(draft.cc || draft.bcc));
  const [subject, setSubject] = useState(draft.subject);
  const [initialHtml] = useState(() => draft.restore?.html ?? htmlFromPlain(draft.text));
  const [html, setHtml] = useState(initialHtml);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [improving, setImproving] = useState(false);
  /** The body before Tidy layout, so it can be put back; set while the AI's layout is showing. */
  const [beforeImprove, setBeforeImprove] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>(() => draft.restore?.files ?? []);
  const [error, setError] = useState<string | null>(draft.restore?.error ?? null);
  const [askAttach, setAskAttach] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [small, setSmall] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<MailEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const asking = useRef(false);
  const officeDomain = domainOf(from || addresses[0] || "");

  const dirty = to !== draft.to || cc !== draft.cc || bcc !== draft.bcc || subject !== draft.subject || html !== htmlFromPlain(draft.text) || files.length > 0;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const ownText = composeText(html).trim();

  // Phones: a modal full-screen sheet (the page behind is inert, focus is held, Escape closes). Desktop: docked, not modal.
  const overlay = useOverlay({ open: phone, onClose: () => void close(), kind: "sheet", modal: true });
  const vv = useVisualViewport(phone);

  // Leaving the page (Back, a palette jump) asks first; ?m and ?f changes inside the inbox don't.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (asking.current) {
      blocker.reset();
      return;
    }
    void askDiscard().then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker]);

  // Reload or closing the tab: the browser's own prompt.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // Focus: the body for a reply, else To (or From when it must be chosen). Back to the opener on close (desktop; the manager does it on phones).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    window.setTimeout(() => {
      if (draft.focus === "body") bodyRef.current?.focus(true);
      else toRef.current?.focus();
    }, 0);
    return () => {
      if (!phone && opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "Discard this message?": what's lost, and that nothing is kept as a draft (the explicit question for an implicit exit). */
  async function askDiscard(): Promise<boolean> {
    asking.current = true;
    const ok = await confirm({
      title: "Discard this message?",
      message: `What you've written${files.length ? " and the files you attached" : ""} will be lost. Nothing is saved as a draft.`,
      confirmLabel: "Discard message",
      cancelLabel: "Keep writing",
      tone: "danger",
    });
    asking.current = false;
    return !!ok;
  }

  async function close() {
    if (asking.current) return;
    if (dirty && !(await askDiscard())) return;
    onClose();
  }

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const next = [...files, ...picked];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_ATTACH) {
      setError("Attachments can be 3 MB in total. Remove one, or send the larger file in its own message.");
      return;
    }
    setError(null);
    setAskAttach(false);
    setFiles(next);
  }

  /** Tidy layout: the same words and figures, laid out by AI. Asked once (what's sent, to whom); Undo puts it back. */
  async function improveDesign() {
    if (improving || !ownText) return;
    let ack: string | undefined;
    let seen = false;
    try {
      seen = localStorage.getItem(TIDY_KEY) === TIDY_VERSION;
    } catch {
      // Not remembered on this device: ask.
    }
    if (!seen) {
      const ok = await confirm({
        title: "Tidy the layout with AI?",
        message: "Anthropic's Claude lays out what you've written: paragraphs, lists, spacing and spelling.",
        details: [
          "Only your own words go to Anthropic, never the quoted message under them.",
          "Your words and every figure stay as written. If any figure would change, the new layout isn't used.",
          "Check names, numbers and dates before you send.",
          <TextLink key="p" to="/legal/privacy#ai" inline>
            How AI is used in BFO
          </TextLink>,
        ],
        confirmLabel: "Tidy layout",
        cancelLabel: "Not now",
        version: TIDY_VERSION,
      });
      if (!ok) return;
      ack = TIDY_VERSION;
      try {
        localStorage.setItem(TIDY_KEY, TIDY_VERSION);
      } catch {
        // Asked again next time.
      }
    }
    setImproving(true);
    setError(null);
    try {
      const before = html;
      const { html: better } = await improveMail(html, subject, ack);
      bodyRef.current?.setHtml(better);
      setBeforeImprove(before);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImproving(false);
    }
  }

  async function send(force = false) {
    if (asking.current) return;
    if (addresses.length > 1 && !from) return setError("Choose which of your addresses it goes out from.");
    const lists = [parseRecipients(to), parseRecipients(cc), parseRecipients(bcc)];
    const bad = lists.flatMap((l) => l.bad);
    const total = lists.reduce((n, l) => n + l.ok.length, 0);
    if (bad.length) return setError(`“${bad[0]}” isn't an email address. Check it and try again.`);
    if (!total) return setError("Add who it's to.");
    if (total > MAX_RECIPIENTS) return setError(`Send to ${MAX_RECIPIENTS} people or fewer.`);
    if (totalBytes > MAX_ATTACH) return setError("Attachments can be 3 MB in total. Remove one and try again.");
    if (!force && !files.length && !draft.carried.length && mentionsAttachment(subject, ownText)) {
      setAskAttach(true);
      return;
    }
    setError(null);
    let attachments: OutgoingAttachment[];
    try {
      attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", data: await readBase64(f) })));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // The person's words, then the quoted original as it was.
    const full = draft.quote ? `${html}${htmlFromPlain(`\n${draft.quote}`)}` : html;
    onQueue(
      {
        ...(from && addresses.length > 1 ? { from } : {}),
        to: lists[0].ok,
        ...(lists[1].ok.length ? { cc: lists[1].ok } : {}),
        ...(lists[2].ok.length ? { bcc: lists[2].ok } : {}),
        subject: subject.replace(/[\r\n]+/g, " ").trim(),
        text: composeText(full),
        html: full,
        attachments,
      },
      { ...draft, from: from || draft.from, to, cc, bcc, subject, restore: { html, files } },
    );
  }

  // What to say before it goes.
  const allOk = [to, cc, bcc].flatMap((v) => parseRecipients(v).ok);
  const outside = officeDomain ? [...new Set(allOk.filter((e) => domainOf(e) !== officeDomain))] : [];
  const noReplies = parseRecipients(to).ok.filter(isNoReply);
  const sendKey = isApple() ? "⌘↵" : "Ctrl+Enter";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (asking.current) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && !phone) {
      e.preventDefault();
      e.stopPropagation();
      void close();
    }
  };

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => {
        addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
  const sendButton = (
    <Tooltip label={`Send (${sendKey})`}>
      <Button variant="primary" size={phone ? "sm" : "md"} onClick={() => void send()} className="min-w-[80px]">
        Send
      </Button>
    </Tooltip>
  );
  const tidyButton = ownText ? (
    beforeImprove !== null ? (
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          bodyRef.current?.setHtml(beforeImprove);
          setBeforeImprove(null);
        }}
      >
        Undo tidy
      </Button>
    ) : (
      <Button variant="quiet" size="sm" icon="sparkle" busy={improving} busyLabel="Tidying…" onClick={() => void improveDesign()}>
        Tidy layout
      </Button>
    )
  ) : null;

  const fields = (
    <>
      {addresses.length > 1 && (
        <div className="flex min-h-[44px] items-center gap-3 border-b border-line px-4 touch:min-h-[48px] md:px-5">
          <span id="compose-from-label" className="w-[56px] shrink-0 text-small text-ink-2 touch:text-body">
            From
          </span>
          <div className="min-w-0 flex-1 py-1">
            <Select label="Send from" placeholder="Choose an address" size="sm" value={from || null} onChange={(v) => {
                setFrom(v);
                setError(null);
              }} options={addresses.map((a) => ({ value: a, label: a }))} />
          </div>
        </div>
      )}
      <RecipientField
        id="compose-to"
        label="To"
        value={to}
        onChange={setTo}
        names={draft.names}
        officeDomain={officeDomain}
        inputRef={toRef}
        trailing={
          !showCc && (
            <Button variant="quiet" size="sm" onClick={() => setShowCc(true)}>
              Cc, Bcc
            </Button>
          )
        }
      />
      {showCc && (
        <>
          <RecipientField id="compose-cc" label="Cc" value={cc} onChange={setCc} names={draft.names} officeDomain={officeDomain} />
          <RecipientField id="compose-bcc" label="Bcc" value={bcc} onChange={setBcc} names={draft.names} officeDomain={officeDomain} />
        </>
      )}
      <div className="flex min-h-[44px] items-center gap-3 border-b border-line px-4 touch:min-h-[48px] md:px-5">
        <label htmlFor="compose-subject" className="w-[56px] shrink-0 text-small text-ink-2 touch:text-body">
          Subject
        </label>
        <input
          id="compose-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={300}
          className="h-10 min-w-0 flex-1 bg-transparent text-field text-ink outline-none! placeholder:text-ink-3"
        />
      </div>
    </>
  );

  const notes = (
    <>
      {draft.unverifiedOriginal && (
        <Banner tone="warning" title="The sender couldn't be verified." className="mx-4 mt-3 md:mx-5">
          Don't send payment or account details to them without calling a number you already have.
        </Banner>
      )}
      {(draft.replyToNote || noReplies.length > 0 || outside.length > 0) && (
        <div className="flex flex-col gap-1 px-4 pt-3 text-small text-ink-2 md:px-5">
          {draft.replyToNote && (
            <p className="flex items-start gap-2">
              <Icon name="info" size={16} className="mt-[1px] shrink-0" />
              <span>
                Going to {draft.replyToNote.to}, where the sender asked replies to go, not {draft.replyToNote.insteadOf}.
              </span>
            </p>
          )}
          {noReplies.length > 0 && (
            <p className="flex items-start gap-2">
              <Icon name="info" size={16} className="mt-[1px] shrink-0" />
              <span>No one reads replies at {noReplies.join(", ")}.</span>
            </p>
          )}
          {outside.length > 0 && (
            <p className="flex items-start gap-2">
              <span className="mt-[1px] shrink-0 text-warning">
                <Icon name="warning" size={16} />
              </span>
              <span className="text-ink">
                Going outside the office: <span className="break-all">{outside.slice(0, 3).join(", ")}</span>
                {outside.length > 3 ? ` and ${outside.length - 3} more` : ""}
              </span>
            </p>
          )}
        </div>
      )}
    </>
  );

  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {fields}
      {notes}
      {beforeImprove !== null && (
        <div className="flex flex-wrap items-center gap-x-2 px-4 pt-3 md:px-5">
          <AiNote kind="drafted" />
          <span className="text-small text-ink-2">Laid out by Anthropic's Claude; your figures were checked and are unchanged.</span>
        </div>
      )}
      <MailEditor
        ref={bodyRef}
        initialHtml={initialHtml}
        label="Message"
        onChange={(h) => {
          setHtml(h);
          setBeforeImprove(null);
        }}
        placeholder={draft.replyToId ? "Write your reply…" : "Write your message…"}
        className={cx("min-h-[160px] flex-1 px-4 py-4 md:px-5", !phone && "min-h-[200px]")}
      />
      {draft.quote && (
        <div className="px-4 pb-4 md:px-5">
          <Button variant="quiet" size="sm" aria-expanded={quoteOpen} onClick={() => setQuoteOpen((o) => !o)}>
            <Icon name="more" />
            {quoteOpen ? "Hide quoted text" : (draft.quoteLabel ?? "Show quoted text")}
          </Button>
          {quoteOpen && <div className="mt-2 max-h-[320px] overflow-y-auto border-l-2 border-line-strong pl-3 text-small whitespace-pre-wrap text-ink-2">{draft.quote.replace(/^> ?/gm, "")}</div>}
        </div>
      )}
      {(draft.carried.length > 0 || files.length > 0 || draft.missing.length > 0) && (
        <ul className="flex flex-wrap gap-2 border-t border-line px-4 py-3 md:px-5" aria-label="Attachments">
          {draft.carried.map((a) => (
            <li key={a.id} title="From the original message" className="inline-flex h-8 max-w-full items-center gap-2 rounded-control border border-line px-2 text-small text-ink">
              <Glyph name="clip" size={16} className="text-ink-3" />
              <span className="min-w-0 truncate">{a.filename}</span>
              <span className="shrink-0 text-ink-3 tabular-nums">{bytes(a.size)}</span>
            </li>
          ))}
          {draft.missing.map((name) => (
            <li key={`missing:${name}`} className="inline-flex h-8 max-w-full items-center gap-2 rounded-control border border-line px-2 text-small text-ink-2">
              <span className="min-w-0 truncate">{name}</span>
              <span className="shrink-0 text-ink-3">· not kept by BFO, can't be attached</span>
            </li>
          ))}
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="inline-flex h-8 max-w-full items-center gap-1 rounded-control border border-line pr-1 pl-2 text-small text-ink">
              <Glyph name="clip" size={16} className="text-ink-3" />
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="shrink-0 text-ink-3 tabular-nums">{bytes(file.size)}</span>
              <IconButton icon="x" label={`Remove ${file.name}`} noTooltip className="size-[28px]! touch:size-[40px]!" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
      {askAttach && (
        <Banner
          tone="warning"
          title="Nothing is attached."
          className="mx-4 mb-3 md:mx-5"
          action={
            <span className="flex flex-wrap gap-1">
              <Button variant="quiet" size="sm" onClick={() => fileRef.current?.click()}>
                Attach a file
              </Button>
              <Button variant="quiet" size="sm" onClick={() => void send(true)}>
                Send anyway
              </Button>
            </span>
          }
        >
          Your message mentions an attachment.
        </Banner>
      )}
      {error && (
        <Banner tone="negative" className="mx-4 mb-3 md:mx-5">
          {error}
        </Banner>
      )}
    </div>
  );

  // ── Phones: the full-screen sheet ──
  if (phone) {
    return createPortal(
      <div className="ds fixed inset-x-0 z-modal" style={vv ? { top: vv.top, height: vv.height } : { top: 0, bottom: 0 }}>
        <div
          ref={overlay.panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-title"
          onKeyDown={onKeyDown}
          className="ds-full-in flex h-full flex-col bg-overlay text-body text-ink outline-none"
        >
          <div className={cx("grid min-h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line px-2", (!vv || vv.top === 0) && "pt-[env(safe-area-inset-top)]")}>
            <div>
              <Button variant="quiet" size="sm" onClick={() => void close()}>
                Cancel
              </Button>
            </div>
            <h2 id="compose-title" className="max-w-[52vw] truncate text-center text-title text-ink">
              {draft.title}
            </h2>
            <div className="flex justify-end">{sendButton}</div>
          </div>
          {body}
          {/* The accessory bar: always just above the keyboard (the sheet is sized to what the keyboard leaves). */}
          <div className="shrink-0 border-t border-line bg-overlay px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))]">
            {formatting && <FormatBar onFormat={() => setHtml(document.activeElement?.innerHTML ?? html)} disabled={improving} />}
            <div className="flex items-center gap-1">
              {fileInput}
              <GlyphButton glyph="clip" label="Attach files" noTooltip onClick={() => fileRef.current?.click()} />
              <GlyphButton glyph="letters" label="Formatting" noTooltip pressed={formatting} onMouseDown={(e) => e.preventDefault()} onClick={() => setFormatting((f) => !f)} />
              {totalBytes > 0 && <span className="text-caption text-ink-3 tabular-nums">{bytes(totalBytes)}</span>}
              <span className="flex-1" />
              {tidyButton}
            </div>
          </div>
        </div>
      </div>,
      overlayRoot(),
    );
  }

  // ── Desktop: docked, not modal ──
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby="compose-title"
      onKeyDown={onKeyDown}
      className={cx(
        "ds ds-menu-in-up fixed right-[96px] bottom-0 flex w-[min(600px,calc(100vw-128px))] flex-col rounded-t-dialog border border-b-0 border-line-strong bg-overlay text-body text-ink shadow-(--elevation-2)",
        small ? "h-[52px]" : "h-[min(680px,calc(100dvh-48px))]",
      )}
    >
      <div className="flex min-h-[52px] shrink-0 items-center gap-1 border-b border-line pr-2 pl-5">
        <h2 id="compose-title" className="min-w-0 flex-1 truncate text-section text-ink">
          {draft.title}
        </h2>
        <IconButton icon={small ? "chevronUp" : "chevronDown"} label={small ? "Open the message" : "Make it small"} onClick={() => setSmall((s) => !s)} />
        <IconButton icon="x" label="Close" onClick={() => void close()} />
      </div>
      {!small && (
        <>
          {body}
          {formatting && (
            <div className="shrink-0 border-t border-line px-3 py-1">
              <FormatBar onFormat={() => setHtml(document.activeElement?.innerHTML ?? html)} disabled={improving} />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1 border-t border-line px-3 py-3">
            {fileInput}
            <GlyphButton glyph="clip" label="Attach files" onClick={() => fileRef.current?.click()} />
            <GlyphButton glyph="letters" label={formatting ? "Hide formatting" : "Formatting"} pressed={formatting} onMouseDown={(e) => e.preventDefault()} onClick={() => setFormatting((f) => !f)} />
            {totalBytes > 0 && <span className="ml-1 text-caption text-ink-3 tabular-nums">{bytes(totalBytes)}</span>}
            <span className="flex-1" />
            {tidyButton}
            <span className="ml-2">{sendButton}</span>
          </div>
        </>
      )}
    </div>,
    overlayRoot(),
  );
}
