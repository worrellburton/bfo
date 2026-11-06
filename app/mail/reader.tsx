import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge, Banner, Button, Icon, IconButton, Menu, Skeleton, Spinner, Status, cx, format, usePhone, type MenuItem } from "../ui";
import { MailFrame, useDarkTheme } from "../mail-frame";
import { attachmentUrl, type MailAttachment, type MailMessage, type MailSummary } from "../mail-client";
import { Glyph, GlyphButton, Star } from "./glyphs";
import { bytes, fullAddress, fullStamp, listDate, recipientLabel, same, senderLabel } from "./helpers";
import { MailAvatar } from "./avatar";
import { UnverifiedTag } from "./list-row";

// ── Pictures: who may load them ──────────────────────────────────────────

const ALWAYS_KEY = "bfo-mail-images";

function alwaysShown(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ALWAYS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function alwaysShow(email: string) {
  try {
    const next = [email.toLowerCase(), ...alwaysShown().filter((x) => x !== email.toLowerCase())].slice(0, 500);
    localStorage.setItem(ALWAYS_KEY, JSON.stringify(next));
  } catch {
    // Then it lasts the visit.
  }
}

/** Pictures load for a sender the mailbox has written to, one chosen to always show, and our own sent mail. */
function picturesByDefault(m: MailMessage): boolean {
  if (m.direction === "out") return true;
  if (m.unverifiedSender || m.impersonation) return false;
  return m.knownSender === true || alwaysShown().includes(m.from.email.toLowerCase());
}

// ── Reader ───────────────────────────────────────────────────────────────

type Actions = {
  onReply: (m: MailMessage, mode: "reply" | "all") => void;
  onForward: (m: MailMessage) => void;
  onMove: (m: MailMessage, to: "inbox" | "archive") => void;
  onDelete: (m: MailMessage) => void;
  onRestore: (m: MailMessage) => void;
  onPurge: (m: MailMessage) => void;
  onHold: (m: MailMessage, on: boolean) => void;
  onStar: (m: MailMessage, on: boolean) => void;
  onUnread: (m: MailMessage) => void;
};

/**
 * One message, and the conversation it's in (§8.19, §11). The top bar holds
 * Back and what the message can have done to it: Reply as the one primary,
 * Reply all and Forward beside it, then star, unread, archive and delete as
 * labelled icons, and "…" for the rest. Warnings sit above the body, in
 * words: an unverified sender, a name copied from the office, payment
 * instructions. On a phone, Reply and Forward are in a bar at the bottom.
 */
export function Reader({
  message: m,
  error,
  mine,
  backLabel,
  backAlways,
  onBack,
  thread,
  freshId,
  wholeConversation = false,
  preview = null,
  canHold = false,
  canRelease = false,
  noAddress = false,
  ...act
}: Actions & {
  /** The whole conversation, newest first (the open message included). */
  thread: MailMessage[];
  /** A message just sent into it: it opens at the top. */
  freshId: string | null;
  /** Opened from Inbox (conversations): Archive and Delete take the whole conversation. */
  wholeConversation?: boolean;
  /** The list's row for it, shown at once while the message itself is read. */
  preview?: MailSummary | null;
  message: MailMessage | null;
  error: string | null;
  /** Every address of mine (the main one and the extra ones): mail to any of them is "To me". */
  mine: string[];
  /** The place Back returns to ("Inbox", "Trash"). */
  backLabel: string;
  /** Show Back at every width (the table view gives the message the whole card). */
  backAlways: boolean;
  onBack: () => void;
  /** Owners and admins keep mail for records; only owners stop keeping it. */
  canHold?: boolean;
  canRelease?: boolean;
  /** No address yet: nothing can be sent. */
  noAddress?: boolean;
}) {
  const phone = usePhone();
  const [details, setDetails] = useState(false);
  const [images, setImages] = useState(() => (m ? picturesByDefault(m) : false));
  const [hasPictures, setHasPictures] = useState(false);
  const [original, setOriginal] = useState(false);
  const dark = useDarkTheme();
  // A fresher copy (knownSender arrives with the full message) may allow pictures it didn't before.
  useEffect(() => {
    if (m) setImages((on) => on || picturesByDefault(m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id, m?.knownSender]);
  const onRemote = useCallback((has: boolean) => setHasPictures(has), []);

  const failed = m?.direction === "out" && /fail|bounce|reject|drop/i.test(m.status ?? "");
  const canReplyAll = !!m && (m.to?.length ?? 0) + (m.cc?.length ?? 0) > 1;
  const inTrash = !!m?.deletedAt;
  const others = m ? thread.filter((x) => x.id !== m.id) : [];
  const newer = m ? others.filter((x) => x.occurredAt > m.occurredAt) : [];
  const older = m ? others.filter((x) => x.occurredAt <= m.occurredAt) : [];
  const toLine = (list: MailMessage["to"]) => list.map((a) => recipientLabel(a, mine)).join(", ");

  const more: MenuItem[] = [];
  if (m && !inTrash) {
    if (m.html && hasPictures) more.push(images ? { label: "Hide pictures", onSelect: () => setImages(false) } : { label: "Show pictures", onSelect: () => setImages(true) });
    if (m.html && dark) more.push({ label: original ? "Show in dark colours" : "Show original colours", onSelect: () => setOriginal((o) => !o) });
    more.push({ label: details ? "Hide details" : "Show details", onSelect: () => setDetails((d) => !d) });
    if (m.kept === "message" && canRelease) more.push({ divider: true }, { label: "Stop keeping for records", onSelect: () => act.onHold(m, false) });
    else if (m.kept !== "message" && canHold) more.push({ divider: true }, { label: "Keep for records…", hint: "Can't be deleted", onSelect: () => act.onHold(m, true) });
  }

  const sticky = "sticky top-[calc(52px+env(safe-area-inset-top))] z-sticky md:top-0";
  return (
    <article className="relative pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-6" aria-label={m?.subject || preview?.subject || "Message"}>
      {/* The top bar. */}
      <div className={cx(sticky, "flex min-h-[52px] items-center gap-1 border-b border-line bg-raised px-2 md:rounded-t-card md:px-3")}>
        <button
          type="button"
          onClick={onBack}
          className={cx(
            "inline-flex h-(--control-sm) shrink-0 cursor-pointer items-center gap-1 rounded-control pr-3 pl-1 text-small font-medium text-ink-2 hover:bg-hover hover:text-ink",
            !backAlways && "lg:hidden",
          )}
        >
          <Icon name="chevronLeft" />
          {backLabel}
        </button>
        {m && !phone && !inTrash && !noAddress && (
          <span className="ml-2 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => act.onReply(m, "reply")} title="Reply (r)">
              <Glyph name="reply" />
              Reply
            </Button>
            {canReplyAll && (
              <Button variant="quiet" size="sm" onClick={() => act.onReply(m, "all")} title="Reply all (a)">
                <Glyph name="replyAll" />
                Reply all
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={() => act.onForward(m)} title="Forward (f)">
              <Glyph name="forward" />
              Forward
            </Button>
          </span>
        )}
        <span className="flex-1" />
        {m && inTrash && (
          <span className="flex items-center gap-2">
            <Button size="sm" onClick={() => act.onRestore(m)}>
              <Glyph name="restore" />
              Restore
            </Button>
            {!m.kept && (
              <Button variant="quiet" size="sm" className="text-negative enabled:hover:text-negative" onClick={() => act.onPurge(m)}>
                Delete forever
              </Button>
            )}
          </span>
        )}
        {m && !inTrash && (
          <>
            <GlyphButton glyph="star" label={m.starred ? "Unstar (s)" : "Star (s)"} pressed={m.starred} onClick={() => act.onStar(m, !m.starred)} icon={<Star on={m.starred} />} />
            {m.direction === "in" && <GlyphButton glyph="unread" label="Mark as unread (⇧U)" onClick={() => act.onUnread(m)} />}
            {(m.direction === "in" || (wholeConversation && m.folder !== "archive")) &&
              (m.folder === "archive" ? (
                <GlyphButton glyph="unarchive" label="Move to inbox" onClick={() => act.onMove(m, "inbox")} />
              ) : (
                <GlyphButton glyph="archive" label="Archive (e)" onClick={() => act.onMove(m, "archive")} />
              ))}
            {m.kept === "message" ? (
              <Badge icon="lock" className="mx-1">
                Kept for records
              </Badge>
            ) : (
              <GlyphButton glyph="trash" danger label={wholeConversation ? "Delete conversation (#)" : "Delete (#)"} onClick={() => act.onDelete(m)} />
            )}
            {more.length > 0 && <Menu label="More actions" align="end" items={more} trigger={<IconButton icon="more" label="More actions" />} />}
          </>
        )}
      </div>

      {error && (
        <div className="px-4 pt-4 md:px-6">
          <Banner tone="negative">{error}</Banner>
        </div>
      )}

      {!m && !error && <LoadingMessage preview={preview} mine={mine} />}

      {m && (
        <div className="px-4 pt-6 md:px-6">
          {inTrash && m.purgeAt && (
            <Banner tone="info" className="mb-6">
              {m.kept
                ? "In Trash, and kept for records: it won't be removed while it's kept."
                : `In Trash. It will be deleted for good on ${format.date(m.purgeAt, "medium")}, with its attachments, unless you restore it.`}
            </Banner>
          )}

          <h1 className="text-heading text-balance break-words text-ink">{m.subject || "(no subject)"}</h1>

          {/* Newer in the conversation (newest on top): the latest reads first; a reply just sent opens at the top. */}
          {newer.length > 0 && (
            <div className="mt-6 flex flex-col gap-2">
              {newer.map((x, i) => (
                <ThreadCard key={x.id} m={x} mine={mine} open={i === 0 || x.id === freshId} fresh={x.id === freshId} />
              ))}
              <p className="pt-2 text-small font-medium text-ink-2">The message you opened</p>
            </div>
          )}

          {/* Who and when. */}
          <div className="mt-6 flex items-start gap-3">
            <MailAvatar a={m.from} trusted={!m.unverifiedSender} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="min-w-0 truncate text-body font-semibold text-ink" title={fullAddress(m.from)}>
                  {m.direction === "out" && mine.some((x) => same(x, m.from.email)) ? "You" : senderLabel(m.from)}
                </span>
                {(m.unverifiedSender || m.impersonation) && <UnverifiedTag />}
                <span className="flex-1" />
                <time dateTime={m.occurredAt} title={fullStamp(m.occurredAt)} className="shrink-0 text-small text-ink-2 tabular-nums">
                  {phone ? listDate(m.occurredAt) : format.dateTime(m.occurredAt)}
                </time>
              </div>
              <button
                type="button"
                aria-expanded={details}
                onClick={() => setDetails((d) => !d)}
                className="-mx-1 inline-flex max-w-full cursor-pointer items-start gap-1 rounded-control px-1 text-left text-small text-ink-2 hover:text-ink touch:min-h-[44px] touch:items-center"
              >
                <span className="truncate">
                  {m.to.length > 0 ? `To ${toLine(m.to)}` : "No recipients"}
                  {m.cc.length > 0 && ` · Cc ${toLine(m.cc)}`}
                </span>
                <Icon name="chevronDown" size={16} className={cx("mt-[1px] shrink-0 text-ink-3", details && "rotate-180")} />
              </button>
              {details && <Details m={m} />}
              {m.kept && !inTrash && (
                <p className="mt-1 flex items-center gap-2 text-small text-ink-2">
                  <Icon name="lock" size={16} />
                  {m.kept === "message" ? "Kept for records. It can't be deleted until an owner releases it." : "Mail is on hold for records. Delete archives it instead."}
                </p>
              )}
            </div>
          </div>

          <Warnings m={m} failed={failed} />

          {/* Pictures held back: said plainly, with the way to show them. */}
          {m.html && hasPictures && !images && (
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
              <span>Pictures are hidden, so the sender can't tell you opened it.</span>
              <button type="button" className="cursor-pointer text-accent hover:text-accent-hover hover:underline touch:min-h-[44px]" onClick={() => setImages(true)}>
                Show pictures
              </button>
              {!m.unverifiedSender && !m.impersonation && (
                <button
                  type="button"
                  className="cursor-pointer text-accent hover:text-accent-hover hover:underline touch:min-h-[44px]"
                  onClick={() => {
                    alwaysShow(m.from.email);
                    setImages(true);
                  }}
                >
                  Always show from {senderLabel(m.from)}
                </button>
              )}
            </p>
          )}

          <div className="mt-6 border-t border-line pt-4">
            {m.html ? <MailFrame html={m.html} title={m.subject || "Message"} images={images} original={original} onRemoteImages={onRemote} /> : <PlainBody text={m.text ?? ""} />}
          </div>

          {(m.attachments?.length ?? 0) > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-small font-medium text-ink-2">
                {m.attachments.length} {m.attachments.length === 1 ? "attachment" : "attachments"}
              </p>
              <ul className="flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <li key={a.id} className="max-w-full">
                    <AttachmentChip messageId={m.id} a={a} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Desktop: Reply, Reply all and Forward again under a long message, before anything earlier. */}
          {!phone && !inTrash && !noAddress && (
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <Button onClick={() => act.onReply(m, "reply")}>
                <Glyph name="reply" />
                Reply
              </Button>
              {canReplyAll && (
                <Button onClick={() => act.onReply(m, "all")}>
                  <Glyph name="replyAll" />
                  Reply all
                </Button>
              )}
              <Button onClick={() => act.onForward(m)}>
                <Glyph name="forward" />
                Forward
              </Button>
            </div>
          )}

          {older.length > 0 && (
            <div className="mt-8 flex flex-col gap-2">
              <p className="text-small font-medium text-ink-2">Earlier in this conversation · {older.length}</p>
              {older.map((x) => (
                <ThreadCard key={x.id} m={x} mine={mine} open={false} fresh={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phones: Reply and Forward within thumb's reach, above the bottom edge. */}
      {m &&
        phone &&
        !inTrash &&
        !noAddress &&
        createPortal(
          <div
            data-floating
            className="ds fixed inset-x-0 bottom-0 z-fab flex items-center gap-2 border-t border-line bg-page px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
          >
            <Button variant="primary" className="flex-1" onClick={() => act.onReply(m, "reply")}>
              <Glyph name="reply" />
              Reply
            </Button>
            <Button className="flex-1" onClick={() => act.onForward(m)}>
              <Glyph name="forward" />
              Forward
            </Button>
            {canReplyAll && <GlyphButton glyph="replyAll" label="Reply all" noTooltip className="border border-edge" onClick={() => act.onReply(m, "all")} />}
          </div>,
          document.body,
        )}
    </article>
  );
}

/** While the message is read: what the row already says (subject, who), then a skeleton for the body. */
function LoadingMessage({ preview, mine }: { preview: MailSummary | null; mine: string[] }) {
  return (
    <div className="px-4 pt-6 md:px-6">
      {preview ? (
        <>
          <h1 className="text-heading text-balance break-words text-ink">{preview.subject || "(no subject)"}</h1>
          <div className="mt-6 flex items-center gap-3">
            <MailAvatar a={preview.direction === "out" && preview.to[0] ? preview.to[0] : preview.from} trusted={!preview.unverified} size={40} />
            <span className="text-body font-semibold text-ink">
              {preview.direction === "out" ? `To ${preview.to.map((a) => recipientLabel(a, mine)).join(", ")}` : senderLabel(preview.from)}
            </span>
            <span className="ml-auto text-ink-3">
              <Spinner />
            </span>
          </div>
        </>
      ) : null}
      <div className="mt-6 border-t border-line pt-4">
        <Skeleton kind="line" />
      </div>
    </div>
  );
}

/** The warnings a message earns, above its body, each saying what to do. */
function Warnings({ m, failed }: { m: MailMessage; failed: boolean }) {
  const items: { tone: "warning" | "negative"; title: string; body: ReactNode }[] = [];
  if (failed) items.push({ tone: "negative", title: "Not delivered.", body: "The receiving server refused this message. Check the address and send it again." });
  if (m.direction === "in" && m.unverifiedSender)
    items.push({
      tone: "warning",
      title: "This sender couldn't be verified.",
      body: "The From address may be forged. Don't act on payment or account changes in it without calling a number you already have.",
    });
  if (m.direction === "in" && m.impersonation)
    items.push({
      tone: "warning",
      title: `${senderLabel(m.from)} is writing from outside the office.`,
      body: `The name matches someone here, but the address is ${m.from.email}. Check with them another way before you reply or act on it.`,
    });
  if (m.direction === "in" && m.paymentRisk)
    items.push({
      tone: "warning",
      title: "Payment instructions.",
      body: "Before sending money or changing bank details, confirm by phone on a number you already have, not one in this message.",
    });
  if (!items.length) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.map((w) => (
        <Banner key={w.title} tone={w.tone} title={w.title}>
          {w.body}
        </Banner>
      ))}
    </div>
  );
}

/** Every address and the full date, with the year and the zone (§10.5 audit). */
function Details({ m }: { m: MailMessage }) {
  const rows: [string, string][] = [
    ["From", fullAddress(m.from)],
    ["To", m.to.map(fullAddress).join(", ")],
    ["Cc", m.cc.map(fullAddress).join(", ")],
    ["Bcc", m.bcc.map(fullAddress).join(", ")],
    ["Reply to", (m.replyTo ?? []).map(fullAddress).join(", ")],
    ["Date", fullStamp(m.occurredAt)],
    ...(m.deletedAt ? ([["Deleted", fullStamp(m.deletedAt)]] as [string, string][]) : []),
  ];
  return (
    <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-card bg-sunken px-4 py-3 text-small">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-ink-2">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{v}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

/** One message in the conversation: who and when, opening to its body. */
function ThreadCard({ m, mine, open: startOpen, fresh }: { m: MailMessage; mine: string[]; open: boolean; fresh: boolean }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);
  const [images, setImages] = useState(() => picturesByDefault(m));
  const [hasPictures, setHasPictures] = useState(false);
  const onRemote = useCallback((has: boolean) => setHasPictures(has), []);
  const own = m.direction === "out" || mine.some((x) => same(x, m.from.email));
  return (
    <section className="rounded-card border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 rounded-card px-4 py-3 text-left hover:bg-hover">
        <MailAvatar a={m.from} trusted={!m.unverifiedSender} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-body font-medium text-ink">{own ? "You" : senderLabel(m.from)}</span>
            {fresh && <Status tone="positive">Just sent</Status>}
          </span>
          {!open && <span className="block truncate text-small text-ink-2">{m.snippet || (m.text ?? "").slice(0, 140)}</span>}
        </span>
        <time dateTime={m.occurredAt} title={fullStamp(m.occurredAt)} className="shrink-0 text-caption text-ink-3 tabular-nums">
          {listDate(m.occurredAt)}
        </time>
      </button>
      {open && (
        <div className="border-t border-line px-4 pt-3 pb-4">
          {m.html && hasPictures && !images && (
            <p className="mb-2 text-small text-ink-2">
              Pictures are hidden.{" "}
              <button type="button" className="cursor-pointer text-accent hover:underline" onClick={() => setImages(true)}>
                Show pictures
              </button>
            </p>
          )}
          {m.html ? <MailFrame html={m.html} title={m.subject || "Message"} images={images} onRemoteImages={onRemote} /> : <PlainBody text={m.text ?? ""} />}
          {(m.attachments?.length ?? 0) > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <li key={a.id} className="max-w-full">
                  <AttachmentChip messageId={m.id} a={a} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

/** Plain text with links made clickable. */
function Linkified({ text }: { text: string }) {
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
      <a key={at} href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-1 underline-offset-[3px] hover:text-accent-hover">
        {url}
      </a>,
    );
    last = at + url.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** A text message, at reading size: quoted lines (">") sit in a quiet block. */
function PlainBody({ text, nested = false }: { text: string; nested?: boolean }) {
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
  if (!nested && !text.trim()) return <p className="text-body text-ink-2">This message has no text.</p>;
  return (
    <div className={nested ? "" : "max-w-[68ch] text-reading whitespace-pre-wrap break-words text-ink"}>
      {blocks.map((b, i) =>
        b.quote ? (
          <div key={i} className="my-1 border-l-2 border-line-strong pl-3 text-ink-2">
            <PlainBody text={b.text} nested />
          </div>
        ) : (
          <span key={i}>
            <Linkified text={b.text} />
            {i < blocks.length - 1 ? "\n" : ""}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * A file that came with the message: its name and size, saved on a click. A
 * file BFO doesn't have (the mail service had deleted it before it was
 * copied, or the copy failed) says so, rather than looking expired.
 */
function AttachmentChip({ messageId, a }: { messageId: string; a: MailAttachment }) {
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
  if (!a.available) {
    return (
      <span className="inline-flex max-w-full items-center gap-2 rounded-control border border-line px-3 py-2 text-small text-ink-2" title="BFO doesn't have this file: it wasn't kept when the message arrived.">
        <Icon name="doc" size={16} />
        <span className="min-w-0 truncate">{a.filename || "attachment"}</span>
        <span className="shrink-0 text-ink-3">· Not kept by BFO</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={`Download ${a.filename}`}
      className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-control border border-edge px-3 py-2 text-left text-small text-ink hover:bg-hover disabled:cursor-progress touch:min-h-[44px]"
    >
      <Icon name="doc" size={16} className="text-ink-2" />
      <span className="min-w-0 truncate">{a.filename || "attachment"}</span>
      <span className={cx("shrink-0 tabular-nums", failed ? "text-negative" : "text-ink-3")}>{failed ? "Couldn't download. Try again" : busy ? <Spinner /> : bytes(a.size)}</span>
      {!busy && !failed && <Icon name="download" size={16} className="text-ink-3" />}
    </button>
  );
}
