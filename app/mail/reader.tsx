import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Dot, ErrorLine, Icon, IconButton, formatBytes, useTone } from "../entity/ui";
import { MailFrame } from "../mail-frame";
import { Orbit, ReaderLoader } from "../mail-loaders";
import { FileIcon } from "../file-icon";
import { fileKind } from "../../lib/file-kind";
import { attachmentUrl, type MailAddress, type MailAttachment, type MailMessage, type MailSummary } from "../mail-client";
import { Glyph, GlyphButton, Star } from "./glyphs";
import { fullAddress, fullDate, listDate, same, senderLabel } from "./helpers";
import { Avatar } from "./avatar";
import { ENVELOPE_MS } from "./constants";

// ── Reader ───────────────────────────────────────────────────────────────

export function Reader({
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
  const canReplyAll = !!m && (m.to?.length ?? 0) + (m.cc?.length ?? 0) > 1;
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

          {(m.attachments?.length ?? 0) > 0 && (
            <div className="mt-5 flex flex-wrap gap-2 max-md:mt-6">
              {(m.attachments ?? []).map((a) => (
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
          {(m.attachments?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {(m.attachments ?? []).map((a) => (
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
