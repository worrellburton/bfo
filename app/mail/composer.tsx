import { FormatBar, MailEditor, type MailEditorHandle } from "../mail-editor";
import { composeText, htmlFromPlain } from "../../lib/mail-compose";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router";
import { confirmDialog } from "../confirm-dialog";
import { Button, ErrorLine, Icon, IconButton, TextButton, buttonClass, formatBytes, useTone } from "../entity/ui";
import { mailboxHue } from "../mail-aurora";
import { BusyLabel } from "../mail-loaders";
import { FileIcon } from "../file-icon";
import { fileKind } from "../../lib/file-kind";
import { improveMail, sendMail, type MailSummary, type OutgoingAttachment } from "../mail-client";
import { GlyphButton } from "./glyphs";
import { same } from "./helpers";
import type { Draft } from "./drafts";

// ── Compose ──────────────────────────────────────────────────────────────

const MAX_ATTACH = 3 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** "a@x.com, Name <b@y.com>; c@z.com" → addresses, plus anything that isn't one. */
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

export function Compose({ draft, addresses, onClose, onSent }: { draft: Draft; addresses: string[]; onClose: () => void; onSent: (m: MailSummary) => void }) {
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
        className={`palette-panel ${leaving ? "sheet-down" : "sheet-up"} relative flex w-full flex-col overflow-hidden shadow-2xl max-sm:pt-[env(safe-area-inset-top)] sm:max-h-[min(760px,calc(100dvh-3rem))] sm:max-w-[680px] sm:rounded-2xl sm:border ${
          t.dark ? "border-white/10 bg-[#111113]" : "border-gray-200 bg-white"
        }`}
      >
        <header className={`flex h-12 shrink-0 items-center gap-2 border-b pl-4 pr-2 max-sm:h-14 max-sm:pl-6 max-sm:pr-3 ${t.line}`}>
          <h2 id="compose-title" className={`flex-1 truncate text-[13.5px] font-semibold ${t.text}`}>
            {draft.title}
          </h2>
          <IconButton icon="x" label="Close" onClick={() => void close()} />
        </header>

        {needsFrom && (
          <div className={`absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col max-sm:top-[calc(env(safe-area-inset-top)+3.5rem)] ${t.dark ? "bg-[#111113]" : "bg-white"}`}>
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
