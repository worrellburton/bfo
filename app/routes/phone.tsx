import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canTextBack, MAX_SEGMENTS, MAX_TEXT, numberKey, smsSegments, toE164 } from "../../lib/sms-compose";
import { formatPhone } from "../../lib/sms-inbound";
import type { SmsSetup } from "../../lib/sms-setup";
import { authFetch, isAdmin } from "../auth";
import { Button, buttonClass, Icon, IconButton, TextButton, useTone } from "../entity/ui";

export function meta() {
  return [{ title: "BFO - Phone" }];
}

type Text = {
  id: string;
  from: string;
  to: string | null;
  body: string;
  code: string | null;
  receivedAt: string;
  readAt: string | null;
  direction: "in" | "out";
  /** Sent ones: Bird's status (accepted, sent, delivered, undelivered, failed, rejected, expired). */
  status: string | null;
  error: string | null;
};
/** A text on its way, shown at once; replaced by the stored one when the send answers. */
type Pending = { key: string; to: string; body: string; at: string; state: "sending" | "failed"; error?: string; reuseKey: boolean };
type Convo = { key: string; number: string; texts: Text[]; pending: Pending[]; lastAt: string; preview: string; unread: boolean };
type Setup = { state: "checking" | "fixing" | "replaying" | "done"; result?: SmsSetup | null; error?: string };

const changed = () => window.dispatchEvent(new Event("bfo-texts-changed"));
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const FAILED = new Set(["undelivered", "failed", "rejected", "expired"]);
/** Who the conversation is with: the sender of a text in, the recipient of one out. */
const counterpart = (x: Text) => (x.direction === "out" ? x.to ?? "" : x.from);

/** True while the viewport matches `query`. */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

/** "just now", "4 min ago", "2:14 PM", "Oct 21, 2:14 PM". */
function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) })}, ${time}`;
}

/** What a sent text's status line says. */
function statusLine(x: { status: string | null; error: string | null }): string {
  if (x.status && FAILED.has(x.status)) return `Not delivered: ${x.error || "the carrier didn't say why."}`;
  return x.status === "delivered" ? "Delivered" : "Sent";
}

/**
 * Phone: BFO's own number (Bird, toll-free) and its texts, as conversations
 * like Messages: verification codes for the office's accounts above all,
 * pulled out with a button to copy, and replies sent from the number
 * (lib/sms-send.ts) with Bird's delivery status. New ones show within
 * seconds. Owners and admins only.
 */
export default function PhonePage() {
  const t = useTone();
  const wide = useMedia("(min-width: 768px)");
  const [texts, setTexts] = useState<Text[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The conversation open (its numberKey), or a new text being written.
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [toDraft, setToDraft] = useState("");
  const [announce, setAnnounce] = useState("");
  const seen = useRef(new Set<string>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
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
      if (!r.ok) throw new Error(j.message || "Couldn't check with Bird.");
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
      if (!r.ok) throw new Error(j.message || "Couldn't load texts.");
      // A send started or finished meanwhile: this list may predate its text. The next poll has it.
      if (sends.current.busy || sends.current.gen !== gen) return;
      setTexts(((j.texts ?? []) as Text[]).map((x) => ({ ...x, direction: x.direction ?? "in" })));
      setNumber(j.number ?? null);
      setError("");
      setNow(Date.now());
    } catch (err) {
      setError((err as Error).message);
      setTexts((x) => x ?? []);
    }
  }, []);

  // New texts and receipts show up while the page is open (codes are only good for minutes).
  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), 8000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Texts grouped by the other party's number, newest conversation first.
  const convos = useMemo(() => {
    const by = new Map<string, Convo>();
    const at = (key: string, n: string) => {
      let c = by.get(key);
      if (!c) by.set(key, (c = { key, number: n, texts: [], pending: [], lastAt: "", preview: "", unread: false }));
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
      const last = c.texts[c.texts.length - 1];
      const lastPending = c.pending[c.pending.length - 1];
      if (lastPending && (!last || lastPending.at >= last.receivedAt)) {
        c.lastAt = lastPending.at;
        c.preview = `You: ${lastPending.body}`;
      } else if (last) {
        c.lastAt = last.receivedAt;
        c.preview = `${last.direction === "out" ? "You: " : ""}${last.body || "(no text)"}`;
      }
    }
    return [...by.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [texts, pending]);

  const typed = composing ? toE164(toDraft, number) : null;
  // A new text to a number already in the list goes on in that conversation.
  const current = composing ? (typed?.ok ? convos.find((c) => c.key === numberKey(typed.e164)) ?? null : null) : convos.find((c) => c.key === open) ?? null;

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

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // It's on screen to copy by hand.
    }
  }

  /** Shows the text at once, sends it, and swaps in the stored one (or keeps the reason it didn't go, with Retry). */
  const send = useCallback(async (to: string, body: string, retry?: Pending) => {
    // The same key only when the last try may have reached Bird: Bird then won't send twice.
    const key = retry?.reuseKey ? retry.key : newKey();
    const p: Pending = { key, to, body, at: retry?.at ?? new Date().toISOString(), state: "sending", reuseKey: false };
    setPending((list) => [...list.filter((x) => x.key !== retry?.key), p]);
    setAnnounce("Sending…");
    sends.current.busy++;
    sends.current.gen++;
    try {
      const r = await authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "send", to, text: body, key }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (!r || !r.ok) {
        // No answer, a 5xx (Bird's or a timeout), or Bird still on the last try (409): it may have gone, so the key stays.
        const reuseKey = !r || r.status >= 500 || r.status === 409;
        const why = !r ? "BFO couldn't be reached. Check the connection and try again." : j.message || "It didn't send. Try again.";
        setPending((list) => list.map((x) => (x.key === key ? { ...x, state: "failed", error: why, reuseKey } : x)));
        setAnnounce(`Not sent: ${why}`);
        return;
      }
      const stored = { ...(j.text as Text), direction: "out" as const };
      setTexts((list) => [stored, ...(list ?? []).filter((x) => x.id !== stored.id)]);
      setPending((list) => list.filter((x) => x.key !== key));
      setAnnounce("Sent");
    } catch (err) {
      setPending((list) => list.map((x) => (x.key === key ? { ...x, state: "failed", error: (err as Error).message, reuseKey: true } : x)));
    } finally {
      sends.current.busy--;
      sends.current.gen++;
    }
  }, []);

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
  function back() {
    const key = composing ? null : open;
    setComposing(false);
    setOpen(null);
    // Back on the list: focus where the person left it.
    window.setTimeout(() => (key ? rowRefs.current.get(key)?.focus() : document.getElementById("new-text")?.focus()), 0);
  }

  if (!isAdmin()) {
    return (
      <div className="mx-auto max-w-[900px]">
        <p className={`rounded-2xl border px-5 py-5 text-[13px] ${t.surface} ${t.muted}`}>Only an owner or admin sees the office's texts.</p>
      </div>
    );
  }

  const shown = number ? formatPhone(number) : "";
  const threadShown = composing || (!!current && (wide || !!open));
  const thread = threadShown && (
    <Thread
      convo={current}
      composing={composing}
      toDraft={toDraft}
      setToDraft={setToDraft}
      typed={typed}
      wide={wide}
      now={now}
      copied={copied}
      onCopy={copy}
      onBack={back}
      focusOnOpen={focusThread}
      announce={announce}
      onSend={(to, body) => {
        const n = toE164(to, number);
        if (!n.ok) return n.why;
        if (composing) {
          setComposing(false);
          setOpen(numberKey(n.e164));
          focusThread.current = "composer";
        }
        void send(n.e164, body);
        return null;
      }}
      onRetry={(p) => void send(p.to, p.body, p)}
    />
  );

  return (
    // iPad and desktop: a column as tall as the window less <main>'s padding (an iPad's is wider, app.css), so the texts fill what the number card leaves.
    <div className="mx-auto max-w-[1100px] space-y-4 md:flex md:min-h-[calc(100dvh-4rem)] md:flex-col [@media(hover:none)_and_(pointer:coarse)_and_(min-width:768px)]:min-h-[calc(100dvh-76px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      <h1 className={`pt-1 text-[20px] font-semibold tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Phone</h1>

      <section className={`rounded-2xl border p-5 sm:p-6 ${t.surface}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.muted}`}>Our number</p>
            <p className={`mt-1.5 font-brand text-[24px] tabular-nums sm:text-[28px] ${t.text}`}>{shown || "—"}</p>
            <p className={`mt-1 text-[12.5px] ${t.muted}`}>Texts to this number show up here within seconds, and replies go out from it. Toll-free, through Bird.</p>
            <SetupStatus setup={setup} onRetry={() => void checkSetup()} onFix={() => void checkSetup("fix-setup")} onReplay={() => void checkSetup("replay")} />
          </div>
          {number && (
            <Button icon={copied === "number" ? "check" : "copy"} onClick={() => void copy("number", number)}>
              {copied === "number" ? "Copied" : "Copy number"}
            </Button>
          )}
        </div>
      </section>

      {/* Clear of the Ask button in the corner when scrolled to the end. */}
      <section className={`overflow-hidden rounded-2xl border md:mb-[56px] md:grid md:max-h-[780px] md:min-h-[400px] md:grow md:basis-0 md:grid-cols-[230px_1fr] lg:grid-cols-[300px_1fr] xl:grid-cols-[340px_1fr] ${t.surface}`}>
        <div className={`flex min-h-0 min-w-0 flex-col md:border-r ${t.line}`}>
          <header className={`flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b px-5 py-2 ${t.line}`}>
            <h2 className={`text-[13.5px] font-semibold ${t.text}`}>Texts</h2>
            <Button id="new-text" icon="edit" onClick={startNew} aria-pressed={composing}>
              New text
            </Button>
          </header>
          {texts === null ? (
            <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Loading…</p>
          ) : convos.length === 0 ? (
            <div className={`px-5 py-6 text-[13px] leading-relaxed ${t.muted}`}>
              {error || (
                <>
                  <p className={`font-medium ${t.text}`}>No texts yet.</p>
                  <p className="mt-1">Each text to {shown || "the number"} shows up here within seconds. Send one from your phone to try it.</p>
                </>
              )}
            </div>
          ) : (
            <ul className={`min-h-0 flex-1 divide-y overflow-y-auto ${t.divide}`} aria-label="Conversations">
              {convos.map((c) => {
                const selected = !composing && c.key === open && (wide || !!open);
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) rowRefs.current.set(c.key, el);
                        else rowRefs.current.delete(c.key);
                      }}
                      onClick={() => openConvo(c.key)}
                      aria-current={selected ? "true" : undefined}
                      className={`flex min-h-[64px] w-full cursor-pointer items-start gap-3 px-5 py-3 text-left transition-colors ${selected ? (t.dark ? "bg-white/[0.06]" : "bg-indigo-50/70") : t.hover}`}
                    >
                      <span aria-hidden="true" className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${c.unread ? "bg-[#818cf8]" : "bg-transparent"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`truncate text-[13.5px] tabular-nums ${c.unread ? "font-semibold" : "font-medium"} ${t.text}`}>{formatPhone(c.number)}</span>
                          <span className={`shrink-0 text-[11.5px] tabular-nums ${t.muted}`}>{c.lastAt ? when(c.lastAt, now) : ""}</span>
                        </span>
                        <span className={`mt-0.5 line-clamp-2 text-[12.5px] [overflow-wrap:anywhere] leading-snug ${c.unread ? t.text : t.muted}`}>{c.preview}</span>
                        {c.unread && <span className="sr-only">Unread</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error && texts && texts.length > 0 && (
            <p className={`flex items-center gap-1.5 border-t px-5 py-2 text-[12px] ${t.line} ${t.muted}`}>
              <Icon name="refresh" className="h-3 w-3" />
              {error}
            </p>
          )}
        </div>
        {/* iPad and desktop: the conversation beside the list. */}
        {wide && (
          <div className="flex min-h-0 min-w-0 flex-col">
            {thread || <p className={`m-auto px-6 text-center text-[12.5px] ${t.muted}`}>Pick a conversation, or start a new text.</p>}
          </div>
        )}
      </section>

      {/* Phones: the conversation full screen over the list. Portalled: <main> is its own stacking context, under the mobile header. */}
      {!wide &&
        thread &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="thread-title"
            className={`fixed inset-0 z-[60] flex flex-col ${t.dark ? "bg-black" : "bg-gray-50"}`}
            style={{ paddingTop: "env(safe-area-inset-top)" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                back();
              }
            }}
          >
            {thread}
          </div>,
          document.body
        )}
    </div>
  );
}

type ThreadProps = {
  convo: Convo | null;
  composing: boolean;
  toDraft: string;
  setToDraft: (v: string) => void;
  typed: ReturnType<typeof toE164> | null;
  wide: boolean;
  now: number;
  copied: string | null;
  onCopy: (key: string, value: string) => void;
  onBack: () => void;
  focusOnOpen: React.MutableRefObject<"thread" | "composer" | null>;
  announce: string;
  /** Sends to that number; returns why it can't, or null. */
  onSend: (to: string, body: string) => string | null;
  onRetry: (p: Pending) => void;
};

/** One conversation: bubbles (in on the left, out on the right), and the composer under them. */
function Thread({ convo, composing, toDraft, setToDraft, typed, wide, now, copied, onCopy, onBack, focusOnOpen, announce, onSend, onRetry }: ThreadProps) {
  const t = useTone();
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

  const sendable = composing || canTextBack(number);
  const sending = !!convo?.pending.some((p) => p.state === "sending");

  return (
    <>
      <header className={`flex min-h-[52px] shrink-0 gap-2 border-b ${composing ? "items-start" : "items-center"} px-3 py-1.5 sm:px-4 ${t.line} ${wide ? "" : t.dark ? "bg-black" : "bg-gray-50"}`}>
        {!wide && <IconButton icon="chevronLeft" label="Back to texts" onClick={onBack} className="-ml-1 !h-[44px] !w-[44px]" iconClassName="h-5 w-5" />}
        {composing ? (
          <div className="flex min-w-0 flex-1 items-start gap-2 py-1 max-sm:py-0">
            <h2 id="thread-title" className="sr-only">
              New text
            </h2>
            <label htmlFor="new-text-to" className={`shrink-0 text-[12.5px] leading-[36px] max-sm:leading-[44px] ${t.muted}`}>
              To
            </label>
            <div className="min-w-0 flex-1">
              <input
                ref={toRef}
                id="new-text-to"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={toDraft}
                onChange={(e) => {
                  setToDraft(e.target.value);
                  setToError("");
                }}
                onBlur={() => toDraft.trim() && typed && !typed.ok && setToError(typed.why)}
                placeholder="(480) 555-1234"
                aria-invalid={!!toError}
                aria-describedby={toError ? "new-text-to-error" : undefined}
                className={`h-[36px] w-full px-2.5 text-[13.5px] max-sm:h-[44px] ${t.input}`}
              />
              {toError && (
                <p id="new-text-to-error" className={`mt-1 text-[12px] ${t.dark ? "text-amber-300" : "text-amber-700"}`}>
                  {toError}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 px-1">
            <h2 id="thread-title" ref={titleRef} tabIndex={-1} className={`truncate text-[14px] font-semibold tabular-nums outline-none ${t.text}`}>
              {formatPhone(number)}
            </h2>
          </div>
        )}
      </header>

      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={composing ? "Earlier texts with this number" : `Texts with ${formatPhone(number)}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none sm:px-5"
      >
        {composing && !convo && <p className={`mt-6 text-center text-[12.5px] ${t.muted}`}>{typed?.ok ? `No texts with ${formatPhone(typed.e164)} yet.` : "Type a number to text from BFO's number."}</p>}
        <ol className="space-y-1.5">
          {items.map((it, i) => {
            const prev = items[i - 1];
            const gap = !prev || Date.parse(it.at) - Date.parse(prev.at) > 60 * 60_000;
            const stamp = gap && (
              <li aria-hidden="true" className={`pb-1 pt-3 text-center text-[11px] tabular-nums ${t.muted}`}>
                {when(it.at, now)}
              </li>
            );
            const row = (li: React.ReactNode) => (
              <Fragment key={it.kind === "pending" ? it.p.key : it.x.id}>
                {stamp}
                {li}
              </Fragment>
            );
            if (it.kind === "pending") {
              const p = it.p;
              return row(
                <li className="flex flex-col items-end">
                  <Bubble out tone={t} failed={p.state === "failed"} title={new Date(p.at).toLocaleString()}>
                    {p.body}
                  </Bubble>
                  {p.state === "sending" ? (
                    <span className={`mt-0.5 px-1 text-[11px] ${t.muted}`}>Sending…</span>
                  ) : (
                    <span className={`mt-0.5 flex max-w-[85%] flex-wrap items-baseline justify-end gap-x-2 px-1 text-right text-[11.5px] ${t.dark ? "text-red-300" : "text-red-700"}`}>
                      <span>Not sent: {p.error}</span>
                      <TextButton onClick={() => onRetry(p)}>Retry</TextButton>
                    </span>
                  )}
                </li>
              );
            }
            const x = it.x;
            const out = x.direction === "out";
            const failed = out && !!x.status && FAILED.has(x.status);
            return row(
              <li className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
                <Bubble out={out} tone={t} failed={failed} title={new Date(x.receivedAt).toLocaleString()}>
                  {x.body || <span className="opacity-60">(no text)</span>}
                </Bubble>
                {!out && x.code && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg border px-2.5 py-1 font-mono text-[17px] font-semibold tracking-[0.12em] tabular-nums ${t.line} ${t.text}`}>{x.code}</span>
                    <Button icon={copied === x.id ? "check" : "copy"} onClick={() => onCopy(x.id, x.code!)}>
                      {copied === x.id ? "Copied" : "Copy code"}
                    </Button>
                  </div>
                )}
                {out && <span className={`mt-0.5 max-w-[85%] px-1 text-right text-[11.5px] ${failed ? (t.dark ? "text-red-300" : "text-red-700") : t.muted}`}>{statusLine(x)}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="sr-only" aria-live="polite" role="status">
        {announce}
      </p>

      {sendable ? (
        <Composer
          key={composing ? "new" : convo?.key}
          label={composing ? "Text" : `Text to ${formatPhone(number)}`}
          sending={sending}
          onSend={(body) => {
            const why = onSend(composing ? toDraft : number, body);
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
        <p className={`shrink-0 border-t px-5 py-3.5 text-[12.5px] ${t.line} ${t.muted}`} style={{ paddingBottom: wide ? undefined : "max(0.875rem, env(safe-area-inset-bottom))" }}>
          {formatPhone(number)} can't be texted back: short codes and named senders only send.
        </p>
      )}
    </>
  );
}

function Bubble({ out, failed, tone: t, title, children }: { out: boolean; failed?: boolean; tone: ReturnType<typeof useTone>; title: string; children: React.ReactNode }) {
  const look = out
    ? failed
      ? t.dark
        ? "bg-[#4f46e5]/45 text-white ring-1 ring-red-400/50"
        : "bg-[#4f46e5]/70 text-white ring-1 ring-red-500/50"
      : "bg-[#4f46e5] text-white"
    : t.dark
      ? "bg-white/[0.08] text-gray-100"
      : "bg-white text-gray-900 ring-1 ring-gray-200";
  return (
    <p title={title} className={`max-w-[85%] whitespace-pre-wrap rounded-[18px] [overflow-wrap:anywhere] px-3.5 py-2 text-[13.5px] leading-[1.4] ${out ? "rounded-br-md" : "rounded-bl-md"} ${look}`}>
      {children}
    </p>
  );
}

/** The text box: grows with the text; Enter sends on a keyboard (Shift+Enter is a new line), the button on a phone. */
function Composer({ label, sending, onSend, inputRef: box }: { label: string; sending: boolean; onSend: (body: string) => boolean; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const t = useTone();
  const id = useId();
  const [body, setBody] = useState("");
  // A keyboard and a pointer, wider than a phone: Enter sends. On a phone, the return key makes a new line, as in Messages.
  const keyboard = useMedia("(hover: hover) and (pointer: fine) and (min-width: 640px)");
  const seg = smsSegments(body);
  const tooLong = seg.segments > MAX_SEGMENTS;
  const canSend = !!body.trim() && !sending && !tooLong;

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(grow, [body, box]);

  function submit() {
    if (!canSend) return;
    if (onSend(body)) {
      setBody("");
      box.current?.focus();
    }
  }

  return (
    <form
      className={`shrink-0 border-t px-3 py-2.5 sm:px-4 ${t.line}`}
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
          aria-describedby={body.length > 100 ? `${id}-count` : undefined}
          className={`min-h-[36px] flex-1 resize-none px-3 py-[7px] text-[13.5px] leading-[1.45] max-sm:min-h-[44px] max-sm:py-[10px] ${t.input}`}
        />
        <button type="submit" disabled={!canSend} className={`${buttonClass("primary", t.dark, "md")} !h-[36px] shrink-0 px-4 max-sm:!h-[44px]`}>
          Send
        </button>
      </div>
      {body.length > 100 && (
        <p id={`${id}-count`} className={`mt-1 px-1 text-[11px] tabular-nums ${tooLong ? (t.dark ? "text-red-300" : "text-red-700") : t.muted}`}>
          {tooLong
            ? `Too long: ${seg.segments} parts, and Bird sends at most ${MAX_SEGMENTS}. Shorten it.`
            : `${seg.segments > 1 ? `${seg.segments} texts · ` : ""}${seg.remaining} characters left${seg.encoding === "UCS2" ? " (an emoji or curly quote makes each text shorter)" : ""}`}
        </p>
      )}
    </form>
  );
}

/**
 * Under the number: texts reach BFO, or what's in the way and, when it's safe
 * to change from here, a button that fixes it; whether replies can go out;
 * and texts Bird couldn't deliver here lately, with a button to bring them in.
 */
function SetupStatus({ setup, onRetry, onFix, onReplay }: { setup: Setup; onRetry: () => void; onFix: () => void; onReplay: () => void }) {
  const t = useTone();
  if (setup.state !== "done") {
    return (
      <p role="status" className={`mt-3 inline-flex items-center gap-2 text-[12.5px] ${t.muted}`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        {setup.state === "fixing" ? "Updating Bird's webhook…" : setup.state === "replaying" ? "Asking Bird to send the missed texts again…" : "Checking with Bird that texts reach BFO…"}
      </p>
    );
  }
  const r = setup.result;
  if (!r) {
    return (
      <div role="status" className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] ${t.muted}`}>
        <span>Couldn't check with Bird{setup.error ? `: ${setup.error}` : "."}</span>
        <Button icon="refresh" onClick={onRetry}>
          Check again
        </Button>
      </div>
    );
  }
  const green = `inline-flex items-start gap-1.5 text-[12.5px] font-medium ${t.dark ? "text-emerald-300" : "text-emerald-700"}`;
  const amber = `rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed ${t.dark ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-100" : "border-amber-300 bg-amber-50 text-amber-900"}`;
  const notes = (r.notes ?? []).map((n) => (
    <p key={n} className={`mt-1 text-[12px] ${t.muted}`}>
      {n}
    </p>
  ));
  const fixable = r.problems.some((p) => p.fixable);
  const fix = fixable && (
    <Button kind="primary" icon="check" onClick={onFix}>
      Fix it in Bird
    </Button>
  );
  const missed = r.missed ?? 0;
  // A paused webhook redelivers nothing: the fix comes first.
  const paused = r.webhook?.status === "paused";
  return (
    <div role="status" className="mt-3 space-y-2.5">
      {r.ok ? (
        <p className={green}>
          <Icon name="check" className="mt-[2px] h-3.5 w-3.5" strokeWidth={2.4} />
          Texts reach BFO: Bird sends them here, and a test text just now was accepted.
        </p>
      ) : (
        <div className={amber}>
          <p className="font-semibold">Texts can't reach BFO yet</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {r.problems.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {fix}
            <Button icon="refresh" onClick={onRetry}>
              Check again
            </Button>
          </div>
        </div>
      )}
      {/* Texts arrive, but something smaller is missing (delivery receipts): fixable from here. */}
      {r.ok && r.problems.length > 0 && (
        <div className={amber}>
          <ul className="space-y-1">
            {r.problems.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
          {fix && <div className="mt-2.5">{fix}</div>}
        </div>
      )}
      {r.sending &&
        (r.sending.ready ? (
          <p className={green}>
            <Icon name="check" className="mt-[2px] h-3.5 w-3.5" strokeWidth={2.4} />
            Replies go out: {r.sending.message}
          </p>
        ) : (
          <p className={`flex items-start gap-1.5 text-[12.5px] leading-relaxed ${t.dark ? "text-amber-200" : "text-amber-800"}`}>
            <Icon name="info" className="mt-[2px] h-3.5 w-3.5" />
            <span>
              <span className="font-semibold">Replies can't go out yet.</span> {r.sending.message}
            </span>
          </p>
        ))}
      {r.replayed ? (
        <p className={`text-[12.5px] ${t.soft}`}>Asked Bird to send the missed texts again. Any to BFO's number will show up here in a moment.</p>
      ) : (
        missed > 0 && (
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] ${t.soft}`}>
            {/* Bird's attempts name no number, and the workspace is shared: some may be another site's texts. */}
            <span>
              Bird couldn't deliver {missed === 1 ? "an incoming text" : `${missed} incoming texts`} to BFO's webhook in the last day; some may be for another site in the same Bird workspace.
            </span>
            {!paused && (
              <Button icon="download" onClick={onReplay}>
                Bring in missed texts
              </Button>
            )}
          </div>
        )
      )}
      {notes.length > 0 && <div>{notes}</div>}
    </div>
  );
}
