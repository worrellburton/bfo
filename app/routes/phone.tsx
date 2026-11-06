import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { canTextBack, codeMask, codeShown, FIRST_TEXT_GREETING, maskCode, MAX_SEGMENTS, MAX_TEXT, numberKey, optedOutAt, smsSegments, STOP_LINE, toE164, withStopLine } from "../../lib/sms-compose";
import { formatPhone } from "../../lib/sms-inbound";
import type { SmsSetup } from "../../lib/sms-setup";
import { authFetch, getUser, isAdmin } from "../auth";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  cx,
  Empty,
  format,
  Icon,
  IconButton,
  Input,
  List,
  ListRow,
  Page,
  PageHeader,
  Skeleton,
  TextLink,
  toast,
  useDocumentTitle,
  useMedia,
  useOverlay,
  usePresence,
} from "../ui";
import { overlayRoot } from "../ui/portal";

export function meta() {
  return [{ title: "Phone · BFO" }];
}

type Access = { action: "copy" | "show"; by: string; byId?: string | null; at: string };
type Text = {
  id: string;
  from: string;
  to: string | null;
  body: string;
  code: string | null;
  /** Newer servers: the code is past its ten minutes and masked (code is null). */
  codeMasked?: boolean;
  codeUntil?: string | null;
  codeAccess?: Access[];
  receivedAt: string;
  readAt: string | null;
  direction: "in" | "out";
  /** Sent ones: Bird's status (accepted, sent, delivered, undelivered, failed, rejected, expired). */
  status: string | null;
  error: string | null;
  /** Sent ones (newer servers): who in the office sent it. */
  sentBy?: string | null;
  sentById?: string | null;
};
/** A text on its way, shown at once; replaced by the stored one when the send answers. */
type Pending = { key: string; to: string; body: string; at: string; state: "sending" | "failed"; error?: string; reuseKey: boolean };
type Convo = { key: string; number: string; texts: Text[]; pending: Pending[]; lastAt: string; preview: string; unread: boolean; optedOut: string | null };
type Setup = { state: "checking" | "fixing" | "replaying" | "done"; result?: SmsSetup | null; error?: string };
/** A masked code someone asked to see, until it masks again. */
type Revealed = { code: string; until: number };

const changed = () => window.dispatchEvent(new Event("bfo-texts-changed"));
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const FAILED = new Set(["undelivered", "failed", "rejected", "expired"]);
/** Who the conversation is with: the sender of a text in, the recipient of one out. */
const counterpart = (x: Text) => (x.direction === "out" ? (x.to ?? "") : x.from);

/**
 * The full-screen view on a phone is a modal registered with the overlay
 * manager (useOverlay: focus in and trapped, Escape, the app inert, the Ask
 * button hidden, focus back to the row). app/ui has no push view yet
 * (docs/DESIGN.md lists one to define); these are its modal attributes.
 */
const MODAL = { role: "dialog", ["aria" + "-modal"]: true } as const;

/** A row's time: "2:14 PM" today, "Oct 21" before. */
function listTime(iso: string, now: number): string {
  return new Date(iso).toDateString() === new Date(now).toDateString() ? format.time(iso) : format.date(iso, "short");
}
/** "Sent by Jane", or "you". */
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "Someone";

/** What a sent text's status line says. */
function statusLine(x: { status: string | null; error: string | null }): string {
  if (x.status && FAILED.has(x.status)) return `Not delivered: ${x.error || "the carrier didn’t say why."}`;
  return x.status === "delivered" ? "Delivered" : "Sent";
}

/**
 * Phone: the office's own number and its texts, as conversations like
 * Messages. Sign-in codes for the office's accounts are pulled out with a
 * button to copy; each shows for ten minutes, then masks, and every copy (and
 * every later Show) is recorded with who and when. Replies go out from the
 * number with their delivery status and who sent them. A number that replied
 * STOP can't be texted, and a first text needs the person's agreement and
 * ends with how to stop. New texts show within seconds. Owners and admins
 * only.
 */
export default function PhonePage() {
  useDocumentTitle("Phone");
  const wide = useMedia("(min-width: 768px)");
  const me = getUser();
  const [texts, setTexts] = useState<Text[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  // The conversation open (its numberKey), or a new text being written.
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [toDraft, setToDraft] = useState("");
  const [announce, setAnnounce] = useState("");
  const seen = useRef(new Set<string>());
  // Where focus goes on the next render: a conversation the person opened, or the composer after a new text's first send.
  const focusThread = useRef<"thread" | "composer" | null>(null);
  // Sends under way, and a count bumped as each starts and ends: a poll that overlapped one would drop or double its text.
  const sends = useRef({ busy: 0, gen: 0 });
  // Can texts reach BFO at all? Asked of Bird once when the page opens (lib/sms-setup.ts).
  const [setup, setSetup] = useState<Setup>({ state: "checking" });

  const checkSetup = useCallback(async (action?: "fix-setup" | "replay") => {
    setSetup((s) => ({ ...s, state: action === "fix-setup" ? "fixing" : action === "replay" ? "replaying" : "checking" }));
    try {
      const r = action ? await authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action }) }) : await authFetch("/api/texts?view=setup");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn’t check with Bird.");
      setSetup({ state: "done", result: j.setup ?? null, error: j.error });
    } catch (err) {
      setSetup({ state: "done", result: null, error: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    if (isAdmin()) void checkSetup();
  }, [checkSetup]);

  const load = useCallback(async () => {
    const gen = sends.current.gen;
    try {
      const r = await authFetch("/api/texts");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn’t load texts.");
      // A send started or finished meanwhile: this list may predate its text. The next poll has it.
      if (sends.current.busy || sends.current.gen !== gen) return;
      const fresh = ((j.texts ?? []) as Text[]).map((x) => ({ ...x, direction: x.direction ?? "in" }));
      // Older pages the person loaded stay; the newest page is replaced.
      setTexts((list) => {
        const ids = new Set(fresh.map((x) => x.id));
        const oldest = fresh[fresh.length - 1]?.receivedAt ?? "";
        return [...fresh, ...(list ?? []).filter((x) => !ids.has(x.id) && x.receivedAt < oldest)];
      });
      setMore((m) => m || !!j.more);
      setNumber(j.number ?? null);
      setError("");
      setNow(Date.now());
    } catch (err) {
      setError((err as Error).message);
      setTexts((x) => x ?? []);
    }
  }, []);

  async function loadOlder() {
    const oldest = texts?.[texts.length - 1]?.receivedAt;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const r = await authFetch(`/api/texts?before=${encodeURIComponent(oldest)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn’t load older texts.");
      const older = ((j.texts ?? []) as Text[]).map((x) => ({ ...x, direction: x.direction ?? "in" }));
      setTexts((list) => {
        const ids = new Set((list ?? []).map((x) => x.id));
        return [...(list ?? []), ...older.filter((x) => !ids.has(x.id))];
      });
      setMore(!!j.more && older.length > 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  // New texts and receipts show up while the page is open (codes are only good for minutes); the clock masks codes on time.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), 8000);
    const tick = window.setInterval(() => setNow(Date.now()), 5000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Texts grouped by the other party's number, newest conversation first.
  const convos = useMemo(() => {
    const by = new Map<string, Convo>();
    const at = (key: string, n: string) => {
      let c = by.get(key);
      if (!c) by.set(key, (c = { key, number: n, texts: [], pending: [], lastAt: "", preview: "", unread: false, optedOut: null }));
      return c;
    };
    for (const x of texts ?? []) {
      const n = counterpart(x);
      if (!n) continue;
      const c = at(numberKey(n), n);
      c.texts.push(x);
      if (x.direction === "in" && !x.readAt && !seen.current.has(x.id)) c.unread = true;
    }
    for (const p of pending) at(numberKey(p.to), p.to).pending.push(p);
    for (const c of by.values()) {
      c.texts.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
      c.optedOut = optedOutAt(c.texts);
      const last = c.texts[c.texts.length - 1];
      const lastPending = c.pending[c.pending.length - 1];
      if (lastPending && (!last || lastPending.at >= last.receivedAt)) {
        c.lastAt = lastPending.at;
        c.preview = `You: ${lastPending.body}`;
      } else if (last) {
        c.lastAt = last.receivedAt;
        // The preview never shows a code: the body is masked wherever a code was found.
        const body = (last.code ? maskCode(last.body, last.code) : last.body) || "(no text)";
        const who = last.direction !== "out" ? "" : !last.sentById || last.sentById === me?.id ? "You: " : `${firstName(last.sentBy)}: `;
        c.preview = `${who}${body}`;
      }
    }
    return [...by.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [texts, pending, me?.id]);

  const typed = composing ? toE164(toDraft, number) : null;
  // A new text to a number already in the list goes on in that conversation.
  const current = composing ? (typed?.ok ? (convos.find((c) => c.key === numberKey(typed.e164)) ?? null) : null) : (convos.find((c) => c.key === open) ?? null);

  // iPad and desktop show a conversation beside the list: the newest, until one is picked.
  useEffect(() => {
    if (wide && !composing && !convos.some((c) => c.key === open) && convos[0]) setOpen(convos[0].key);
  }, [wide, composing, convos, open]);

  // What's on screen counts as read, a moment after it shows: the open conversation's texts.
  useEffect(() => {
    const showing = current && (wide || open || composing) ? current.texts : [];
    const fresh = showing.filter((x) => x.direction === "in" && !x.readAt && !seen.current.has(x.id));
    if (!fresh.length || document.visibilityState !== "visible") return;
    const timer = window.setTimeout(() => {
      fresh.forEach((x) => seen.current.add(x.id));
      void authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "read", ids: fresh.map((x) => x.id) }) })
        .then(changed)
        .catch(() => {});
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [current, wide, open, composing]);

  async function copyNumber() {
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      toast({ message: "Copied the number" });
    } catch {
      // It's on screen to copy by hand.
    }
  }

  /** Copies a code and records who did. */
  async function copyCode(x: Text, code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return; // Nothing was copied, so nothing to record.
    }
    const mine: Access = { action: "copy", by: "you", byId: me?.id ?? null, at: new Date().toISOString() };
    setTexts((list) => list?.map((t) => (t.id === x.id ? { ...t, codeAccess: [mine, ...(t.codeAccess ?? [])] } : t)) ?? list);
    toast({ message: "Copied the code" });
    try {
      const r = await authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "code-copied", id: x.id }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.access)) setTexts((list) => list?.map((t) => (t.id === x.id ? { ...t, codeAccess: j.access } : t)) ?? list);
    } catch {
      // The copy happened; the record is retried on the next copy.
    }
  }

  /** Shows a masked code again for a minute, recorded. */
  async function showCode(x: Text) {
    try {
      const r = await authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "show-code", id: x.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.code) throw new Error(j.message || "Couldn’t show the code.");
      setRevealed((m) => ({ ...m, [x.id]: { code: j.code, until: Date.parse(j.until) || Date.now() + 60_000 } }));
      if (Array.isArray(j.access)) setTexts((list) => list?.map((t) => (t.id === x.id ? { ...t, codeAccess: j.access } : t)) ?? list);
    } catch (err) {
      toast({ message: (err as Error).message });
    }
  }

  /** Shows the text at once, sends it, and swaps in the stored one (or keeps the reason it didn't go, with Retry). */
  const send = useCallback(
    async (to: string, body: string, opts: { retry?: Pending; consent?: boolean } = {}) => {
      const { retry, consent } = opts;
      // The same key only when the last try may have reached Bird: Bird then won't send twice.
      const key = retry?.reuseKey ? retry.key : newKey();
      const p: Pending = { key, to, body, at: retry?.at ?? new Date().toISOString(), state: "sending", reuseKey: false };
      setPending((list) => [...list.filter((x) => x.key !== retry?.key), p]);
      setAnnounce("Sending…");
      sends.current.busy++;
      sends.current.gen++;
      try {
        const r = await authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "send", to, text: body, key, ...(consent ? { consent: true } : {}) }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        if (!r || !r.ok) {
          // No answer, a 5xx (Bird's or a timeout), or Bird still on the last try (409): it may have gone, so the key stays.
          const reuseKey = !r || r.status >= 500 || r.status === 409;
          const why = !r ? "BFO couldn’t be reached. Check the connection and try again." : j.message || "It didn’t send. Try again.";
          setPending((list) => list.map((x) => (x.key === key ? { ...x, state: "failed", error: why, reuseKey } : x)));
          setAnnounce(`Not sent: ${why}`);
          return;
        }
        const stored = { ...(j.text as Text), direction: "out" as const, sentBy: (j.text as Text).sentBy ?? me?.name ?? null, sentById: (j.text as Text).sentById ?? me?.id ?? null };
        setTexts((list) => [stored, ...(list ?? []).filter((x) => x.id !== stored.id)]);
        setPending((list) => list.filter((x) => x.key !== key));
        setAnnounce("Sent");
      } catch (err) {
        setPending((list) => list.map((x) => (x.key === key ? { ...x, state: "failed", error: (err as Error).message, reuseKey: true } : x)));
      } finally {
        sends.current.busy--;
        sends.current.gen++;
      }
    },
    [me?.id, me?.name],
  );

  // Focus moves on the render the change causes; the one already open causes none, so focus goes there now (a ref left set would steal it later).
  function openConvo(key: string) {
    if (key === open && !composing) return void document.getElementById("thread-title")?.focus();
    setComposing(false);
    setOpen(key);
    focusThread.current = "thread";
  }
  function startNew() {
    if (composing && !toDraft) return void document.getElementById("new-text-to")?.focus();
    setComposing(true);
    setToDraft("");
    focusThread.current = "thread";
  }
  /** Leaves a new text, or (on a phone) the conversation, for the list. */
  function back() {
    setComposing(false);
    if (!wide) setOpen(null);
  }

  if (!isAdmin()) {
    return (
      <Page header={<PageHeader title="Phone" />}>
        <Empty size="page" title="Only owners and admins">
          The office’s texts, and the sign-in codes that arrive by text, are for owners and admins.
        </Empty>
      </Page>
    );
  }

  const shown = number ? formatPhone(number) : "";
  const threadShown = composing || (!!current && (wide || !!open));
  const thread = threadShown && (
    <Thread
      convo={current}
      convos={convos}
      composing={composing}
      toDraft={toDraft}
      setToDraft={setToDraft}
      typed={typed}
      wide={wide}
      now={now}
      ours={shown}
      meId={me?.id ?? null}
      revealed={revealed}
      onCopyCode={(x, code) => void copyCode(x, code)}
      onShowCode={(x) => void showCode(x)}
      onBack={back}
      onPick={openConvo}
      focusOnOpen={focusThread}
      announce={announce}
      onSend={(to, body, consent) => {
        const n = toE164(to, number);
        if (!n.ok) return n.why;
        if (composing) {
          setComposing(false);
          setOpen(numberKey(n.e164));
          focusThread.current = "composer";
        }
        void send(n.e164, body, { consent });
        return null;
      }}
      onRetry={(p) => void send(p.to, p.body, { retry: p })}
    />
  );

  const list = (
    <div className="flex min-h-0 min-w-0 flex-col md:border-r md:border-line">
      <div className="flex min-h-[52px] shrink-0 items-center border-b border-line px-5 touch:px-4">
        <h2 className="text-section text-ink">Texts</h2>
      </div>
      {texts === null ? (
        <Skeleton kind="rows" rows={4} />
      ) : convos.length === 0 && !composing ? (
        <div className="px-5 pb-6 touch:px-4">
          <Empty size="page" title="No texts yet">
            Texts to {shown || "the office’s number"} show up here within seconds. Send one from your phone to try it.
          </Empty>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {composing && wide && (
            <div className="flex min-h-(--row-1) items-center gap-2 bg-selected pr-2 pl-9">
              <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">New text{typed?.ok ? ` to ${formatPhone(typed.e164)}` : ""}</span>
              <IconButton icon="x" label="Cancel new text" onClick={back} />
            </div>
          )}
          <List label="Conversations">
            {convos.map((c) => (
              <ListRow
                key={c.key}
                title={<span className="tabular-nums">{formatPhone(c.number)}</span>}
                label={formatPhone(c.number)}
                secondary={c.optedOut ? `Opted out · ${c.preview}` : c.preview}
                meta={c.lastAt ? listTime(c.lastAt, now) : undefined}
                unread={c.unread}
                selected={!composing && c.key === open && wide}
                onClick={() => openConvo(c.key)}
              />
            ))}
          </List>
          {more && (
            <div className="border-t border-line px-5 py-3 touch:px-4">
              <Button variant="quiet" size="sm" busy={loadingOlder} busyLabel="Loading…" onClick={() => void loadOlder()}>
                Load older texts
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Page header={<PageHeader title="Phone" context="Texts to and from the office’s number" create={{ label: "New text", onClick: startNew }} />}>
      <SetupBanners setup={setup} onRetry={() => void checkSetup()} onFix={() => void checkSetup("fix-setup")} onReplay={() => void checkSetup("replay")} />
      {error && (
        <Banner
          tone="negative"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}

      <Card title="Our number">
        <div className="flex items-center gap-2">
          <p className="text-heading font-medium text-ink tabular-nums">{shown || "Not set up"}</p>
          {number && <IconButton icon="copy" label="Copy number" onClick={() => void copyNumber()} />}
        </div>
        <p className="mt-2 max-w-[68ch] text-small text-ink-2">
          Texts to this number arrive here within seconds, and replies go out from it. Use it to answer people who text the office, and to text people who’ve agreed to texts from it. Owners and admins
          see every text.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 text-caption text-ink-2">
          <TextLink to="/legal/terms#texts" inline>
            Text message terms
          </TextLink>
          <TextLink to="/legal/privacy#phone" inline>
            How texts are handled
          </TextLink>
        </p>
      </Card>

      <Card flush>
        <div className="md:grid md:h-[min(780px,calc(100dvh-280px))] md:min-h-[460px] md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
          {list}
          {/* iPad and desktop: the conversation beside the list. */}
          {wide && (
            <div
              className="flex min-h-0 min-w-0 flex-col"
              onKeyDown={(e) => {
                if (e.key === "Escape" && composing) {
                  e.stopPropagation();
                  back();
                }
              }}
            >
              {thread || <p className="m-auto px-6 text-center text-body text-ink-2">Choose a conversation, or start a new text.</p>}
            </div>
          )}
        </div>
      </Card>

      {/* Phones: the conversation full screen over the list. */}
      {!wide && (
        <PushView open={!!thread} onBack={back}>
          {thread}
        </PushView>
      )}
    </Page>
  );
}

/**
 * A phone's full-screen view over the list (a conversation, a new text): it
 * slides 24px in from the right and fades (240ms), and back out the same way;
 * under reduced motion it only fades. Registered with the overlay manager.
 */
function PushView({ open, onBack, children }: { open: boolean; onBack: () => void; children: ReactNode }) {
  const { mounted, leaving } = usePresence(open, 200);
  // Focus goes to the To field of a new text, else the conversation's title: never the text box, which would raise the keyboard.
  const initialFocus = useMemo(
    () => ({
      get current(): HTMLElement | null {
        return document.getElementById("new-text-to") ?? document.getElementById("thread-title");
      },
    }),
    [],
  );
  const handle = useOverlay({ open, onClose: onBack, kind: "sheet", initialFocus });
  const last = useRef<ReactNode>(null);
  if (open && children) last.current = children;
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  useLayoutEffect(() => {
    const el = handle.panelRef.current;
    if (!mounted || !el || typeof el.animate !== "function") return;
    const frames = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateX(24px)" },
          { opacity: 1, transform: "none" },
        ];
    el.animate(leaving ? [...frames].reverse() : frames, {
      duration: reduced ? 100 : leaving ? 200 : 240,
      easing: leaving ? "cubic-bezier(0.4, 0, 1, 1)" : "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "both",
    });
  }, [mounted, leaving, reduced, handle.panelRef]);
  if (!mounted) return null;
  return createPortal(
    <div className="ds fixed inset-0">
      <div ref={handle.panelRef} {...MODAL} aria-labelledby="thread-title" className="absolute inset-0 flex flex-col bg-page pt-[env(safe-area-inset-top)] text-body text-ink outline-none">
        {last.current}
      </div>
    </div>,
    overlayRoot(),
  );
}

type ThreadProps = {
  convo: Convo | null;
  convos: Convo[];
  composing: boolean;
  toDraft: string;
  setToDraft: (v: string) => void;
  typed: ReturnType<typeof toE164> | null;
  wide: boolean;
  now: number;
  ours: string;
  meId: string | null;
  revealed: Record<string, Revealed>;
  onCopyCode: (x: Text, code: string) => void;
  onShowCode: (x: Text) => void;
  onBack: () => void;
  onPick: (key: string) => void;
  focusOnOpen: React.MutableRefObject<"thread" | "composer" | null>;
  announce: string;
  /** Sends to that number; returns why it can't, or null. */
  onSend: (to: string, body: string, consent: boolean) => string | null;
  onRetry: (p: Pending) => void;
};

/** One conversation: bubbles (in on the left, out on the right), and the composer under them. */
function Thread({
  convo,
  convos,
  composing,
  toDraft,
  setToDraft,
  typed,
  wide,
  now,
  ours,
  meId,
  revealed,
  onCopyCode,
  onShowCode,
  onBack,
  onPick,
  focusOnOpen,
  announce,
  onSend,
  onRetry,
}: ThreadProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [toError, setToError] = useState("");
  const number = convo?.number ?? (typed?.ok ? typed.e164 : "");
  const count = (convo?.texts.length ?? 0) + (convo?.pending.length ?? 0);

  // Opened by the person: focus goes to the new text's To field, or the conversation's title (or its composer, after a new text's first send).
  useEffect(() => {
    const to = focusOnOpen.current;
    if (!to) return;
    focusOnOpen.current = null;
    (to === "composer" ? composerRef.current : composing ? toRef.current : titleRef.current)?.focus({ preventScroll: true });
  });

  // The newest text in view: on opening, and as texts arrive or go out.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convo?.key, count]);

  const items: ({ kind: "text"; x: Text; at: string } | { kind: "pending"; p: Pending; at: string })[] = [
    ...(convo?.texts ?? []).map((x) => ({ kind: "text" as const, x, at: x.receivedAt })),
    ...(convo?.pending ?? []).map((p) => ({ kind: "pending" as const, p, at: p.at })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const optedOut = convo?.optedOut ?? null;
  // A first text: nobody at this number has texted with the office.
  const first = !convo || convo.texts.length + convo.pending.length === 0;
  const sendable = (composing ? !typed || typed.ok || !toDraft.trim() : canTextBack(number)) && !optedOut;
  const sending = !!convo?.pending.some((p) => p.state === "sending");
  const digits = toDraft.replace(/\D/g, "");
  const suggestions = composing && !(typed?.ok && convo) ? convos.filter((c) => !digits || numberKey(c.number).includes(digits.replace(/^1(?=\d{10}$)/, ""))).slice(0, 6) : [];

  const back = !wide && (
    <button
      type="button"
      onClick={onBack}
      className="-ml-2 inline-flex h-[44px] shrink-0 cursor-pointer items-center gap-1 rounded-control pr-2 pl-1 text-body text-ink hover:bg-hover"
      aria-label="Back to texts"
    >
      <Icon name="chevronLeft" size={20} />
      Texts
    </button>
  );

  return (
    <>
      <header className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-line px-4 py-2 md:px-5">
        {back}
        <div className={cx("min-w-0 flex-1", !wide && "text-center")}>
          <h2 id="thread-title" ref={titleRef} tabIndex={-1} className="truncate text-title text-ink tabular-nums outline-none">
            {composing ? "New text" : formatPhone(number)}
          </h2>
          {!composing && ours && <p className="truncate text-small text-ink-2">Replies go from {ours}</p>}
        </div>
        {!wide && <span className="w-[72px] shrink-0" aria-hidden="true" />}
      </header>

      {composing && (
        <div className="shrink-0 border-b border-line px-4 py-3 md:px-5">
          <label htmlFor="new-text-to" className="sr-only">
            To
          </label>
          <Input
            ref={toRef}
            id="new-text-to"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            prefix="To"
            value={toDraft}
            onChange={(e) => {
              setToDraft(e.target.value);
              setToError("");
            }}
            onBlur={() => toDraft.trim() && typed && !typed.ok && setToError(typed.why)}
            placeholder="(555) 010-0142"
            invalid={!!toError}
            aria-describedby="new-text-to-hint"
          />
          <p id="new-text-to-hint" className={cx("mt-2 text-small", toError ? "text-negative" : "text-ink-2")}>
            {toError || (optedOut ? `They replied STOP on ${format.date(optedOut, "medium")}. BFO can’t text them until they reply START.` : `Texts go out from ${ours || "the office’s number"}.`)}
          </p>
        </div>
      )}

      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={composing ? "Earlier texts with this number" : `Texts with ${formatPhone(number)}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 outline-offset-[-2px]! md:px-5"
      >
        {suggestions.length > 0 && (
          <div className="-mx-4 md:-mx-5">
            <p className="px-4 pb-1 text-small font-medium text-ink-2 md:px-5">Recent</p>
            <List label="Recent conversations">
              {suggestions.map((c) => (
                <ListRow
                  key={c.key}
                  title={<span className="tabular-nums">{formatPhone(c.number)}</span>}
                  label={formatPhone(c.number)}
                  secondary={c.preview}
                  meta={c.lastAt ? listTime(c.lastAt, now) : undefined}
                  onClick={() => onPick(c.key)}
                />
              ))}
            </List>
          </div>
        )}
        {composing && !convo && !suggestions.length && (
          <p className="mt-6 text-center text-body text-ink-2">{typed?.ok ? `No texts with ${formatPhone(typed.e164)} yet.` : "Type the number to text."}</p>
        )}
        <ol className="flex flex-col gap-1">
          {items.map((it, i) => {
            const prev = items[i - 1];
            const gap = !prev || Date.parse(it.at) - Date.parse(prev.at) > 60 * 60_000;
            const stamp = gap && (
              <li aria-hidden="true" className="pt-4 pb-1 text-center text-caption text-ink-3 tabular-nums">
                {format.dateTime(it.at, { zone: true })}
              </li>
            );
            const row = (li: ReactNode) => (
              <Fragment key={it.kind === "pending" ? it.p.key : it.x.id}>
                {stamp}
                {li}
              </Fragment>
            );
            if (it.kind === "pending") {
              const p = it.p;
              return row(
                <li className="flex flex-col items-end">
                  <Bubble out failed={p.state === "failed"} at={p.at}>
                    {p.body}
                  </Bubble>
                  {p.state === "sending" ? (
                    <span className="mt-1 px-1 text-caption text-ink-3">Sending…</span>
                  ) : (
                    <span className="mt-1 flex max-w-[85%] flex-wrap items-baseline justify-end gap-x-2 px-1 text-right text-caption text-negative">
                      <span>Not sent: {p.error}</span>
                      <button type="button" onClick={() => onRetry(p)} className="cursor-pointer font-medium text-accent hover:underline touch:min-h-[44px]">
                        Retry
                      </button>
                    </span>
                  )}
                </li>,
              );
            }
            const x = it.x;
            const out = x.direction === "out";
            const failed = out && !!x.status && FAILED.has(x.status);
            const body = x.code ? maskCode(x.body, x.code) : x.body;
            const by = out ? (x.sentById && x.sentById === meId ? "you" : x.sentBy ? firstName(x.sentBy) : null) : null;
            return row(
              <li className={cx("flex flex-col", out ? "items-end" : "items-start")}>
                <Bubble out={out} failed={failed} at={x.receivedAt}>
                  {body || <span className="text-ink-3">(no text)</span>}
                </Bubble>
                {!out && (x.code || x.codeMasked) && <CodeChip x={x} now={now} revealed={revealed[x.id]} meId={meId} onCopy={onCopyCode} onShow={onShowCode} />}
                {out && (
                  <span className={cx("mt-1 max-w-[85%] px-1 text-right text-caption", failed ? "text-negative" : "text-ink-3")}>
                    {[by ? `Sent by ${by}` : null, statusLine(x)].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>,
            );
          })}
        </ol>
      </div>
      <p className="sr-only" aria-live="polite" role="status">
        {announce}
      </p>

      {optedOut && !composing ? (
        <p className="shrink-0 border-t border-line px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))] text-body text-ink-2">
          Opted out: they replied STOP on {format.date(optedOut, "medium")}. BFO can’t text them until they reply START.
        </p>
      ) : sendable ? (
        <Composer
          key={composing ? "new" : convo?.key}
          label={composing ? "Text" : `Text to ${formatPhone(number)}`}
          sending={sending}
          first={first}
          onSend={(body, consent) => {
            const why = onSend(composing ? toDraft : number, body, consent);
            if (why) {
              setToError(why);
              toRef.current?.focus();
              return false;
            }
            return true;
          }}
          inputRef={composerRef}
        />
      ) : (
        !composing && (
          <p className="shrink-0 border-t border-line px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))] text-body text-ink-2">
            {formatPhone(number)} can’t be texted back: short codes and named senders only send.
          </p>
        )
      )}
    </>
  );
}

function Bubble({ out, failed, at, children }: { out: boolean; failed?: boolean; at: string; children: ReactNode }) {
  return (
    <p
      title={format.dateTime(at, { zone: true })}
      className={cx(
        "max-w-[85%] rounded-[18px] px-4 py-2 text-body break-words whitespace-pre-wrap",
        out ? "rounded-br-[6px] bg-accent text-on-accent" : "rounded-bl-[6px] border border-line bg-sunken text-ink",
        failed && "ring-2 ring-negative ring-offset-2 ring-offset-raised",
      )}
    >
      <span className="sr-only">
        {out ? "Sent" : "Received"} {format.dateTime(at, { zone: true })}:{" "}
      </span>
      {children}
    </p>
  );
}

/**
 * A sign-in code, pulled out of its text: in full for ten minutes after it
 * arrived, then masked. Copy records who copied it; Show (once masked)
 * records who asked and shows it for a minute. Under it: who has copied or
 * shown it, and when.
 */
function CodeChip({ x, now, revealed, meId, onCopy, onShow }: { x: Text; now: number; revealed?: Revealed; meId: string | null; onCopy: (x: Text, code: string) => void; onShow: (x: Text) => void }) {
  const live = !!x.code && !x.codeMasked && codeShown(x.receivedAt, now);
  const again = revealed && revealed.until > now ? revealed.code : null;
  const code = again ?? (live ? x.code : null);
  const until = x.codeUntil ? Date.parse(x.codeUntil) : Date.parse(x.receivedAt) + 10 * 60_000;
  const access = x.codeAccess ?? [];
  const who = (a: Access) => (a.byId && a.byId === meId ? "you" : a.by === "you" ? "you" : firstName(a.by));
  const line = (a: Access) => `${a.action === "copy" ? "Copied" : "Shown"} by ${who(a)}, ${format.dateTime(a.at, { zone: true })}`;
  return (
    <div className="mt-2 flex max-w-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-control border border-line bg-raised px-3 py-1 font-mono text-title tracking-[0.12em] text-ink tabular-nums"
          aria-label={code ? `Code ${code.split("").join(" ")}` : "Code masked"}
        >
          {code ?? codeMask(x.code)}
        </span>
        {code ? (
          <Button size="sm" icon="copy" onClick={() => onCopy(x, code)}>
            Copy code
          </Button>
        ) : (
          <Button size="sm" variant="quiet" icon="eye" onClick={() => onShow(x)}>
            Show
          </Button>
        )}
      </div>
      <p className="text-caption text-ink-3">
        {again
          ? "Shown again for a minute; this is recorded."
          : code
            ? `Shown until ${format.time(new Date(until).toISOString())}, then masked. Copies are recorded.`
            : "Masked 10 minutes after it arrived. Showing it again is recorded."}
      </p>
      {access.length > 0 && (
        <ul className="text-caption text-ink-2">
          {access.slice(0, 3).map((a, i) => (
            <li key={`${a.at}${i}`}>{line(a)}</li>
          ))}
          {access.length > 3 && <li>and {format.count(access.length - 3, "more time")}</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * The text box: grows with the text; Enter sends on a keyboard (Shift+Enter is
 * a new line), the button on a phone. A first text to a number starts with
 * the office's name, ends with the STOP line, and needs the sender to confirm
 * the person agreed to texts.
 */
function Composer({
  label,
  sending,
  first,
  onSend,
  inputRef: box,
}: {
  label: string;
  sending: boolean;
  first: boolean;
  onSend: (body: string, consent: boolean) => boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const [body, setBody] = useState(first ? FIRST_TEXT_GREETING : "");
  const [consent, setConsent] = useState(false);
  // A keyboard and a pointer, wider than a phone: Enter sends. On a phone, the return key makes a new line, as in Messages.
  const keyboard = useMedia("(hover: hover) and (pointer: fine) and (min-width: 640px)");
  const outgoing = first ? withStopLine(body) : body;
  const seg = smsSegments(outgoing);
  const tooLong = seg.segments > MAX_SEGMENTS || outgoing.length > MAX_TEXT;
  const written = body.trim() && body.trim() !== FIRST_TEXT_GREETING.trim();
  const reason = !written ? "Write a text to send" : first && !consent ? "Confirm they’ve agreed to texts first" : tooLong ? "Shorten the text to send it" : null;
  const canSend = !reason && !sending;

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(grow, [body, box]);

  function submit() {
    if (!canSend) return;
    if (onSend(body.trim(), first && consent)) {
      setBody("");
      setConsent(false);
      box.current?.focus();
    }
  }

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {first && <p className="text-small text-ink-2">Only text people who’ve asked to hear from the office by text.</p>}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          id={id}
          rows={1}
          value={body}
          maxLength={MAX_TEXT}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && keyboard && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Text message"
          aria-describedby={`${id}-hint`}
          className="min-h-(--control-md) flex-1 resize-none rounded-[18px] border border-edge bg-field px-4 py-2 text-field text-ink placeholder:text-ink-3"
        />
        <Button
          type="submit"
          variant="primary"
          icon="arrowUp"
          disabled={!canSend}
          disabledReason={reason ?? undefined}
          busy={sending}
          className="size-(--control-md) shrink-0 rounded-full px-0"
          aria-label="Send"
        >
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <div id={`${id}-hint`} className="flex flex-col gap-1">
        {first && <p className="text-caption text-ink-3">Ends with “{STOP_LINE}”</p>}
        {outgoing.length > 100 && (
          <p className={cx("text-caption tabular-nums", tooLong ? "text-negative" : "text-ink-3")}>
            {tooLong
              ? `Too long: ${seg.segments} parts, and Bird sends at most ${MAX_SEGMENTS}. Shorten it.`
              : `${seg.segments > 1 ? `${seg.segments} texts · ` : ""}${seg.remaining} characters left${seg.encoding === "UCS2" ? ". An emoji or curly quote makes each text shorter." : ""}`}
          </p>
        )}
      </div>
      {first && <Checkbox checked={consent} onChange={setConsent} label="They’ve agreed to texts from the office" />}
    </form>
  );
}

/**
 * The setup check, said only when something needs someone: texts can't
 * reach BFO, replies can't go out, delivery receipts are missing, or texts
 * Bird couldn't deliver lately (with a button to bring them in). When all is
 * well, nothing shows.
 */
function SetupBanners({ setup, onRetry, onFix, onReplay }: { setup: Setup; onRetry: () => void; onFix: () => void; onReplay: () => void }) {
  if (setup.state === "fixing" || setup.state === "replaying") {
    return <Banner tone="info">{setup.state === "fixing" ? "Updating Bird’s webhook…" : "Asking Bird to send the missed texts again…"}</Banner>;
  }
  if (setup.state !== "done") return null;
  const r = setup.result;
  if (!r) {
    return (
      <Banner
        tone="warning"
        action={
          <Button variant="quiet" size="sm" onClick={onRetry}>
            Check again
          </Button>
        }
      >
        BFO couldn’t check that texts reach it{setup.error ? `: ${setup.error}` : "."}
      </Banner>
    );
  }
  const fixable = r.problems.some((p) => p.fixable);
  const missed = r.missed ?? 0;
  // A paused webhook redelivers nothing: the fix comes first.
  const paused = r.webhook?.status === "paused";
  const notes = r.notes ?? [];
  const problems = (
    <ul className="mt-1 flex flex-col gap-1">
      {r.problems.map((p) => (
        <li key={p.code}>{p.message}</li>
      ))}
    </ul>
  );
  return (
    <>
      {r.problems.length > 0 && (
        <Banner
          tone="warning"
          title={r.ok ? undefined : "Texts can’t reach BFO yet."}
          action={
            <span className="flex flex-wrap gap-2">
              {fixable && (
                <Button variant="quiet" size="sm" onClick={onFix}>
                  Fix it in Bird
                </Button>
              )}
              <Button variant="quiet" size="sm" onClick={onRetry}>
                Check again
              </Button>
            </span>
          }
        >
          {problems}
        </Banner>
      )}
      {r.sending && !r.sending.ready && (
        <Banner tone="warning" title="Replies can’t go out yet.">
          {r.sending.message || "Bird hasn’t cleared the number to send texts."}
        </Banner>
      )}
      {r.replayed ? (
        <Banner tone="info">Asked Bird to send the missed texts again. Any to the office’s number will show up here in a moment.</Banner>
      ) : (
        missed > 0 && (
          <Banner
            tone="info"
            action={
              !paused ? (
                <Button variant="quiet" size="sm" onClick={onReplay}>
                  Bring in missed texts
                </Button>
              ) : undefined
            }
          >
            {/* Bird's attempts name no number, and the workspace is shared: some may be another site's texts. */}
            Bird couldn’t deliver {missed === 1 ? "an incoming text" : `${missed} incoming texts`} to BFO in the last day; some may be for another site in the same Bird workspace.
          </Banner>
        )
      )}
      {notes.length > 0 && r.problems.length > 0 && (
        <ul className="-mt-4 flex flex-col gap-1 text-small text-ink-2">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}
