import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import {
  deleteAllChats,
  deleteChat,
  getChat,
  listChats,
  logTurn,
  NOTICE_VERSION,
  recordNotice,
  sendMessage,
  speakText,
  transcribeAudio,
  type ChatMessage,
  type ChatSummary,
  type Source,
} from "../ask-client";
import { Markdown } from "../ask-markdown";
import { canRecord, Player, Recorder } from "../ask-voice";
import { VoiceStage, type Caption, type VoiceStatus } from "../ask-voice-stage";
import { getUser } from "../auth";
import { canLive, LiveVoice, type LiveStatus } from "../realtime-voice";
import {
  Banner,
  Button,
  confirm,
  cx,
  Dialog,
  format,
  Icon,
  IconButton,
  List,
  ListRow,
  Page,
  Segmented,
  Sheet,
  Skeleton,
  Spinner,
  TextLink,
  useDocumentTitle,
  useFinePointer,
  useMedia,
  usePhone,
} from "../ui";

export function meta() {
  return [{ title: "Ask BFO · BFO" }];
}

/**
 * Ask BFO: a conversation with the office's own records (lib/ask.ts).
 *
 * Voice (the default) and Text are one segmented choice in the header, in
 * the same place in both. The voice room is a full-bleed dark scene
 * (app/ask-voice-stage.tsx); Text is the written layout, with conversations
 * down the side on wide screens. History is one sheet with a title and a
 * way out; deleting a conversation is a row's action, confirmed.
 *
 * Disclosures sit where they apply: under the composer and the hold button,
 * one line saying answers come from BFO's records, can be wrong and aren't
 * legal or tax advice, and who processes what (Anthropic for typed answers,
 * OpenAI for voice). The first question asked on a device shows the notice
 * once, and the choice is recorded with its version.
 */

const SUGGESTIONS = [
  "What's due in the next 60 days?",
  "What does the state show for each entity's standing, and as of when?",
  "What came in the mail this week?",
  "How much cash do we have right now?",
  "Who are the owners of each entity?",
  "What did we pay in professional fees last quarter?",
];

type Live = { text: string; tools: string[]; sources: Source[] };

const SPEAK_KEY = "bfo-ask-speak";
const NOTICE_KEY = "bfo-ask-notice";
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* a preference that doesn't stick is no loss */
  }
};

/** "3:14 PM" today, "Nov 2" this year, else with the year. */
function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? format.time(iso) : format.date(iso);
}

/**
 * Fills the content area: the page's own height from the window, less where
 * <main> starts, with <main>'s bottom padding (kept for the Ask button,
 * which hides here) given back, so the page never scrolls behind itself. In
 * voice mode it also takes <main>'s side and top padding, edge to edge.
 */
function useFill(voice: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    const main = el?.closest("main");
    if (!el || !main) return;
    const measure = () => {
      const cs = getComputedStyle(main);
      const px = (v: string) => parseFloat(v) || 0;
      const [pt, pr, pb, pl] = [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)];
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = Math.max(0, main.getBoundingClientRect().top + window.scrollY);
      if (voice) setStyle({ margin: `-${pt}px -${pr}px -${pb}px -${pl}px`, padding: `${pt}px ${pr}px 16px ${pl}px`, height: vh - top });
      else setStyle({ marginBottom: -pb + 16, height: vh - top - pt - 16 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [voice]);
  return { ref, style };
}

export default function Ask() {
  useDocumentTitle("Ask BFO");
  const [params, setParams] = useSearchParams();
  const chatId = params.get("c");
  const voiceMode = params.get("mode") !== "text";
  const me = getUser();
  const phone = usePhone();
  const wide = useMedia("(width >= 64rem)");
  const fine = useFinePointer();
  const { ref: rootRef, style: fill } = useFill(voiceMode);
  // Modes don't push history: switching is a view of the same conversation.
  function setMode(next: "voice" | "text") {
    const q: Record<string, string> = {};
    if (chatId) q.c = chatId;
    if (next === "text") q.mode = "text";
    setParams(q, { replace: true });
  }

  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [moreChats, setMoreChats] = useState(false);
  const [chatsFailed, setChatsFailed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Voice: the mic while a question is spoken, and the speaker for answers (app/ask-voice.ts).
  const [mic, setMic] = useState<"off" | "listening" | "transcribing">("off");
  const [speakOn, setSpeakOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const player = useRef<Player | null>(null);
  const speakRef = useRef(false);
  const voiceRef = useRef(voiceMode);
  voiceRef.current = voiceMode;
  const [caption, setCaption] = useState<Caption>(null);
  const [fetchingSpeech, setFetchingSpeech] = useState(false);
  // The live voice (OpenAI Realtime): one call for the whole conversation; the recorded path takes over when it can't connect.
  const liveCall = useRef<LiveVoice | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const liveSources = useRef<Source[]>([]);
  const holdingRef = useRef(false);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const level = useCallback(() => (liveCall.current && liveStatus ? liveCall.current.level() : (recorder.current?.level() ?? 0)), [liveStatus]);
  const progress = useCallback(() => (liveCall.current ? 1 : (player.current?.progress() ?? 0)), []);

  // ── The first-use notice ───────────────────────────────────────────────
  const [noticeOpen, setNoticeOpen] = useState(false);
  const afterNotice = useRef<(() => void) | null>(null);
  /** Runs `go` now if the notice was seen on this device, else after the person chooses Continue. */
  function withNotice(go: () => void): boolean {
    if (read(NOTICE_KEY) === NOTICE_VERSION) return true;
    afterNotice.current = go;
    setNoticeOpen(true);
    return false;
  }
  function answerNotice(choice: "continue" | "not-now") {
    setNoticeOpen(false);
    void recordNotice(choice).catch(() => undefined);
    if (choice === "continue") {
      write(NOTICE_KEY, NOTICE_VERSION);
      const go = afterNotice.current;
      afterNotice.current = null;
      go?.();
    } else afterNotice.current = null;
  }

  useEffect(
    () => () => {
      liveCall.current?.close();
      liveCall.current = null;
    },
    [],
  );
  // Leaving the voice room hangs up.
  useEffect(() => {
    if (voiceMode) return;
    liveCall.current?.close();
    liveCall.current = null;
    setLiveStatus(null);
  }, [voiceMode]);

  /** A spoken turn into the transcript and the kept conversation, with what an answer read. */
  function keepTurn(role: "user" | "assistant", text: string, sources?: Source[]) {
    setMessages((m) => [...m, { role, text, at: new Date().toISOString(), sources }]);
    logTurn(chatIdRef.current, role, text, sources)
      .then((r) => {
        if (chatIdRef.current) return;
        started.current = r.chatId;
        chatIdRef.current = r.chatId;
        setParams({ c: r.chatId }, { replace: true });
        setChats((list) => (list && !list.some((c) => c.id === r.chatId) ? [{ id: r.chatId, title: r.title, updatedAt: new Date().toISOString() }, ...list] : list));
      })
      .catch(() => undefined);
  }

  async function startLive(): Promise<LiveVoice | null> {
    if (liveCall.current) return liveCall.current;
    let spoken = "";
    const call = new LiveVoice({
      onStatus: setLiveStatus,
      onUserText: (text) => {
        setCaption({ role: "user", text });
        setLiveTools([]);
        liveSources.current = [];
        keepTurn("user", text);
      },
      onAssistantDelta: (delta) => {
        spoken += delta;
        setCaption({ role: "assistant", text: spoken });
      },
      onAssistantDone: (text) => {
        spoken = "";
        setCaption({ role: "assistant", text });
        keepTurn("assistant", text, liveSources.current);
        liveSources.current = [];
      },
      onTool: (label, source) => {
        setLiveTools((t) => [...t, label]);
        if (source) liveSources.current = [...liveSources.current, source];
      },
      onError: (message) => setError(message),
    });
    liveCall.current = call;
    try {
      await call.connect();
      setError(null);
      return call;
    } catch (e) {
      call.close();
      liveCall.current = null;
      setLiveStatus(null);
      setLiveFailed(true);
      setError(`${(e as Error).message} Using the recorded voice instead.`);
      return null;
    }
  }
  useEffect(() => {
    setMicAvailable(canRecord());
    const on = read(SPEAK_KEY) === "1";
    setSpeakOn(on);
    speakRef.current = on;
    return () => {
      recorder.current?.cancel();
      player.current?.stop();
    };
  }, []);
  function toggleSpeak() {
    const next = !speakOn;
    setSpeakOn(next);
    speakRef.current = next;
    write(SPEAK_KEY, next ? "1" : "0");
    if (!next) {
      player.current?.stop();
      setSpeaking(false);
    } else (player.current ??= new Player()).unlock();
  }
  /** The conversation this page just started: its id lands in the address bar without a reload. */
  const started = useRef<string | null>(null);

  const refreshChats = useCallback(() => {
    listChats()
      .then((r) => {
        setChats(r.chats);
        setMoreChats(!!r.more);
        setChatsFailed(false);
      })
      .catch(() => {
        setChats((c) => c ?? []);
        setChatsFailed(true);
      });
  }, []);
  useEffect(refreshChats, [refreshChats]);
  function olderChats() {
    const last = chats?.[chats.length - 1];
    if (!last) return;
    listChats(last.updatedAt)
      .then((r) => {
        setChats((c) => [...(c ?? []), ...r.chats.filter((x) => !(c ?? []).some((y) => y.id === x.id))]);
        setMoreChats(!!r.more);
      })
      .catch(() => setChatsFailed(true));
  }

  // Open the conversation in the address bar; none means a fresh one.
  useEffect(() => {
    if (chatId && started.current === chatId) return;
    started.current = null;
    abort.current?.abort();
    setLive(null);
    setError(null);
    setCaption(null);
    if (!chatId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setLoadingChat(true);
    getChat(chatId)
      .then((r) => alive && setMessages(r.messages))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoadingChat(false));
    return () => {
      alive = false;
    };
  }, [chatId]);

  // Follow the answer as it grows, unless the reader has scrolled up to look at something.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  /** The answer, read aloud: always in the voice room, by choice in the written layout. */
  async function readAloud(text: string) {
    if (!(speakRef.current || voiceRef.current) || !text.trim()) return;
    try {
      const p = (player.current ??= new Player());
      setFetchingSpeech(true);
      const clip = await speakText(text);
      setFetchingSpeech(false);
      setCaption({ role: "assistant", text });
      setSpeaking(true);
      await p.play(clip, () => setSpeaking(false));
    } catch {
      setFetchingSpeech(false);
      setCaption({ role: "assistant", text });
      setSpeaking(false);
    }
  }

  function hush() {
    liveCall.current?.hush();
    player.current?.stop();
    setSpeaking(false);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || live) return;
    if (!withNotice(() => void send(message))) return;
    // Inside the tap, so the phone lets the answer sound later.
    if (speakRef.current || voiceRef.current) (player.current ??= new Player()).unlock();
    player.current?.stop();
    setSpeaking(false);
    setDraft("");
    setError(null);
    stickToBottom.current = true;
    setMessages((m) => [...m, { role: "user", text: message, at: new Date().toISOString() }]);
    setLive({ text: "", tools: [], sources: [] });
    const ctl = new AbortController();
    abort.current = ctl;
    let id = chatId;
    let answer = "";
    let sources: Source[] = [];
    try {
      await sendMessage(
        { chatId, message },
        (e) => {
          if (e.type === "chat") {
            id = e.id;
            if (!chatId) {
              started.current = e.id;
              setParams(voiceRef.current ? { c: e.id } : { c: e.id, mode: "text" }, { replace: true });
            }
            setChats((list) => (list && !list.some((c) => c.id === e.id) ? [{ id: e.id, title: e.title, updatedAt: new Date().toISOString() }, ...list] : list));
          } else if (e.type === "tool") setLive((l) => (l ? { ...l, tools: [...l.tools, e.label] } : l));
          else if (e.type === "text") {
            answer += e.delta;
            setLive((l) => (l ? { ...l, text: answer } : l));
          } else if (e.type === "sources") sources = e.sources;
          else if (e.type === "error") setError(e.message);
        },
        ctl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      abort.current = null;
      setLive(null);
      if (answer.trim()) setMessages((m) => [...m, { role: "assistant", text: answer.trim(), at: new Date().toISOString(), sources }]);
      if (id) setChats((list) => list && list.map((c) => (c.id === id ? { ...c, updatedAt: new Date().toISOString() } : c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      void readAloud(answer.trim());
    }
  }

  const micRef = useRef(mic);
  micRef.current = mic;
  const liveRef = useRef(live);
  liveRef.current = live;

  /** The mic opens (a tap in the written layout, a press in the voice room). */
  const beginListening = useCallback(async () => {
    if (micRef.current !== "off" || liveRef.current) return;
    if (liveCall.current) return;
    try {
      if (speakRef.current || voiceRef.current) (player.current ??= new Player()).unlock();
      player.current?.stop();
      setSpeaking(false);
      const rec = new Recorder();
      await rec.start();
      recorder.current = rec;
      setError(null);
      setMic("listening");
    } catch {
      setError("The microphone isn’t available. Allow it for this site and try again.");
    }
  }, []);

  /** The mic closes: what was said becomes the question and goes. */
  async function finishListening() {
    if (micRef.current !== "listening") return;
    const rec = recorder.current;
    if (!rec) return setMic("off");
    setMic("transcribing");
    try {
      const clip = await rec.stop();
      const short = Date.now() - rec.startedAt < 600;
      if (short || clip.size < 1500) {
        setMic("off");
        return;
      }
      const lastAsked = [...messages].reverse().find((m) => m.role === "user")?.text;
      const text = await transcribeAudio(clip, lastAsked);
      setMic("off");
      if (!text) {
        setError("I didn’t catch that. Try again, a little closer to the mic.");
        return;
      }
      setCaption({ role: "user", text });
      await send(text);
    } catch (e) {
      setMic("off");
      setError((e as Error).message);
    }
  }
  const finishRef = useRef(finishListening);
  finishRef.current = finishListening;

  /** The press in the voice room: the live voice when it can be had, else the recorder. */
  async function holdStart() {
    if (read(NOTICE_KEY) !== NOTICE_VERSION) {
      // The notice first; the person presses again once they've chosen.
      withNotice(() => undefined);
      return;
    }
    holdingRef.current = true;
    if (!liveFailed && canLive()) {
      const call = await startLive();
      if (call) {
        if (holdingRef.current) call.holdStart();
        return;
      }
    }
    if (holdingRef.current) await beginListening();
  }
  const holdStartRef = useRef(holdStart);
  holdStartRef.current = holdStart;
  const onHoldStart = useCallback(() => void holdStartRef.current(), []);
  const onHoldEnd = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    const call = liveCall.current;
    if (call && call.status !== "connecting") {
      call.holdEnd();
      return;
    }
    if (call) return; // still connecting: the press ended before the mic opened
    void finishRef.current();
  }, []);

  /** Tap: the mic opens. Tap again: what was said becomes the question and goes. */
  function toggleMic() {
    if (mic === "listening") void finishListening();
    else if (withNotice(() => void beginListening())) void beginListening();
  }

  function newChat() {
    abort.current?.abort();
    hush();
    setCaption(null);
    setParams(voiceMode ? {} : { mode: "text" }, { replace: false });
    setHistoryOpen(false);
    setTimeout(() => input.current?.focus(), 0);
  }

  async function remove(c: ChatSummary) {
    const ok = await confirm({
      title: "Delete this conversation?",
      object: { name: `“${c.title}”`, detail: `Last used ${when(c.updatedAt)}` },
      message: "This deletes the conversation and its transcript from BFO. What was already sent to the AI services stays under their own terms.",
      irreversible: true,
      tone: "danger",
      confirmLabel: "Delete conversation",
    });
    if (!ok) return;
    try {
      await deleteChat(c.id);
      setChats((list) => list && list.filter((x) => x.id !== c.id));
      if (chatId === c.id) newChat();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeAll() {
    const n = chats?.length ?? 0;
    const ok = await confirm({
      title: "Delete all your conversations?",
      message: `This deletes every conversation you’ve had with Ask BFO${moreChats ? "" : `, ${format.count(n, "conversation")}`}, and their transcripts. Other people’s aren’t affected.`,
      irreversible: true,
      tone: "danger",
      confirmLabel: "Delete all conversations",
    });
    if (!ok) return;
    try {
      await deleteAllChats();
      setChats([]);
      setMoreChats(false);
      newChat();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  // The box grows with what's typed, to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
  }, [draft]);

  const firstName = me?.name?.split(" ")[0];
  const empty = !chatId && !messages.length && !live;
  const voiceStatus: VoiceStatus =
    liveCall.current && liveStatus
      ? liveStatus === "ready"
        ? "idle"
        : liveStatus
      : mic === "listening"
        ? "listening"
        : mic === "transcribing"
          ? "transcribing"
          : live || fetchingSpeech
            ? "thinking"
            : speaking
              ? "speaking"
              : "idle";

  const conversations = (
    <div className="flex flex-col">
      <div className="px-4 pt-3 pb-2">
        <Button variant="quiet" size="sm" icon="plus" onClick={newChat} disabled={empty} disabledReason={empty ? "This conversation is new" : undefined}>
          New conversation
        </Button>
      </div>
      {chats === null ? (
        <Skeleton kind="rows" rows={3} />
      ) : chats.length === 0 ? (
        <p className="px-4 py-2 text-body text-ink-2">{chatsFailed ? "Couldn’t load your conversations." : "No conversations yet. Each one you have is kept here until you delete it."}</p>
      ) : (
        <List label="Conversations">
          {chats.map((c) => (
            <ListRow
              key={c.id}
              title={c.title}
              label={c.title}
              meta={when(c.updatedAt)}
              selected={c.id === chatId}
              onClick={() => {
                setParams(voiceMode ? { c: c.id } : { c: c.id, mode: "text" });
                setHistoryOpen(false);
              }}
              action={
                fine ? (
                  <span className="opacity-60 group-hover/row:opacity-100 focus-within:opacity-100">
                    <IconButton icon="trash" label="Delete conversation" onClick={() => void remove(c)} />
                  </span>
                ) : undefined
              }
              menu={fine ? undefined : [{ label: "Delete conversation", danger: true, onSelect: () => void remove(c) }]}
            />
          ))}
        </List>
      )}
      {moreChats && (
        <div className="px-4 py-2">
          <Button variant="quiet" size="sm" onClick={olderChats}>
            Load older conversations
          </Button>
        </div>
      )}
      <p className="px-4 pt-3 pb-4 text-small text-pretty text-ink-2">
        Kept until you delete them. Spoken conversations are saved as text.
        {chats && chats.length > 0 && (
          <>
            {" "}
            <button type="button" onClick={() => void removeAll()} className="cursor-pointer text-negative underline underline-offset-[3px] touch:min-h-[44px]">
              Delete all conversations
            </button>
          </>
        )}
      </p>
    </div>
  );

  const disclosure = (
    <p className={cx("text-caption text-pretty", voiceMode ? "text-door-ink-2" : "text-ink-3")}>
      Answers come from BFO’s records and can be wrong. Not legal or tax advice. Typed answers by Anthropic’s Claude; voice and read-aloud by OpenAI.{" "}
      <TextLink to="/legal/privacy" inline>
        Privacy
      </TextLink>
    </p>
  );

  return (
    <Page width="full">
      <div ref={rootRef} data-theme={voiceMode ? "dark" : undefined} className={cx("flex min-h-0 flex-col", voiceMode && "bg-page")} style={fill}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-heading text-ink">Ask BFO</h1>
            <p className="text-small text-ink-2">{phone ? "Answers from BFO’s own records." : "Answers from BFO’s own records: entities, filings, mail, treasury and books."}</p>
          </div>
          <Segmented
            label="How to ask"
            value={voiceMode ? "voice" : "text"}
            onChange={(v) => setMode(v)}
            options={[
              { value: "voice", label: "Voice" },
              { value: "text", label: "Text" },
            ]}
          />
          {(voiceMode || !wide) && (
            <Button size="sm" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)} className={historyOpen ? "bg-selected" : undefined}>
              History
            </Button>
          )}
        </header>

        <Sheet
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          title="Conversations"
          side="right"
          footer={
            <Button onClick={() => setHistoryOpen(false)} full={phone}>
              Close history
            </Button>
          }
        >
          <div className="ds -mx-6 text-body text-ink touch:-mx-4">{conversations}</div>
        </Sheet>

        {voiceMode ? (
          <div className="min-h-0 flex-1">
            <VoiceStage
              status={voiceStatus}
              tools={liveCall.current ? liveTools : (live?.tools ?? [])}
              caption={caption}
              messages={messages}
              micAvailable={micAvailable}
              error={error}
              firstName={firstName}
              level={level}
              progress={progress}
              onHoldStart={onHoldStart}
              onHoldEnd={onHoldEnd}
              onHush={hush}
            />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 overflow-hidden rounded-card border border-line bg-raised lg:grid-cols-[260px_minmax(0,1fr)]">
            {wide && (
              <aside aria-label="Conversations" className="min-h-0 overflow-y-auto border-r border-line">
                {conversations}
              </aside>
            )}
            <section className="flex min-h-0 flex-col">
              <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
                {empty ? (
                  <div className="mx-auto flex max-w-[560px] flex-col">
                    <p className="text-heading text-ink">{firstName ? `Hello, ${firstName}.` : "Hello."}</p>
                    <p className="mt-2 text-reading text-pretty text-ink-2">
                      Ask about any entity, what’s due, what came in the mail, what’s in the bank, or what the books say. It doesn’t change any record. Your conversations are saved to History.
                    </p>
                    <List label="Suggestions" className="-mx-4 mt-6">
                      {SUGGESTIONS.map((s) => (
                        <ListRow key={s} title={s} onClick={() => void send(s)} />
                      ))}
                    </List>
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-[720px] flex-col gap-6">
                    {loadingChat && !messages.length && <Skeleton kind="rows" rows={2} />}
                    {messages.map((m, i) => (
                      <Bubble key={i} m={m} />
                    ))}
                    {live && <Bubble m={{ role: "assistant", text: live.text }} tools={live.tools} streaming />}
                    {error && <Banner tone="negative">{error}</Banner>}
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(draft);
                }}
                className="border-t border-line px-3 pt-3 pb-3 sm:px-5"
              >
                <div className="mx-auto flex max-w-[720px] items-end gap-1 rounded-card border border-edge bg-field py-1 pr-1 pl-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent focus-within:outline-solid">
                  <textarea
                    ref={input}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    rows={1}
                    placeholder={
                      live ? "Answering…" : mic === "listening" ? "Listening… choose Stop when you’re done" : mic === "transcribing" ? "Writing down what you said…" : "Ask about the office"
                    }
                    aria-label="Your question"
                    className="min-h-[44px] flex-1 resize-none bg-transparent py-3 text-field text-ink outline-none! placeholder:text-ink-3"
                  />
                  <button
                    type="button"
                    onClick={toggleSpeak}
                    aria-pressed={speakOn}
                    aria-label="Read answers aloud"
                    title="Read answers aloud"
                    className={cx(
                      "grid size-8 shrink-0 cursor-pointer place-items-center rounded-control touch:size-11",
                      speakOn ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                    )}
                  >
                    <svg className="size-(--icon)" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                      />
                    </svg>
                  </button>
                  {micAvailable && !live && (
                    <button
                      type="button"
                      onClick={() => void toggleMic()}
                      disabled={mic === "transcribing"}
                      aria-label={mic === "listening" ? "Stop and send" : "Ask by voice"}
                      aria-pressed={mic === "listening"}
                      title={mic === "listening" ? "Stop and send" : "Ask by voice"}
                      className={cx(
                        "grid size-8 shrink-0 cursor-pointer place-items-center rounded-control disabled:cursor-default touch:size-11",
                        mic === "listening" ? "bg-danger text-on-danger" : "text-ink-2 hover:bg-hover hover:text-ink",
                      )}
                    >
                      {mic === "transcribing" ? (
                        <Spinner />
                      ) : mic === "listening" ? (
                        <span className="size-[10px] rounded-[2px] bg-current" />
                      ) : (
                        <svg className="size-(--icon)" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                          />
                        </svg>
                      )}
                    </button>
                  )}
                  {live ? (
                    <button
                      type="button"
                      onClick={() => abort.current?.abort()}
                      aria-label="Stop answering"
                      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-control bg-selected text-ink hover:bg-hover touch:size-11"
                    >
                      <span className="size-[10px] rounded-[2px] bg-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!draft.trim()}
                      aria-label="Send"
                      className={cx(
                        "grid size-8 shrink-0 place-items-center rounded-control touch:size-11",
                        draft.trim() ? "cursor-pointer bg-ink text-ink-inverse hover:bg-primary-hover" : "cursor-default border border-line text-ink-disabled",
                      )}
                    >
                      <Icon name="arrowUp" />
                    </button>
                  )}
                </div>
                <div className="mx-auto mt-2 flex max-w-[720px] flex-col gap-1">
                  {disclosure}
                  {fine && <p className="text-caption text-ink-3">Shift+Enter for a new line</p>}
                </div>
              </form>
            </section>
          </div>
        )}
        {voiceMode && <div className="px-4 pt-2 text-center">{disclosure}</div>}

        <Dialog
          open={noticeOpen}
          onClose={() => answerNotice("not-now")}
          title="Before you ask"
          size="sm"
          footer={
            <>
              <Button onClick={() => answerNotice("not-now")}>Not now</Button>
              <Button variant="primary" onClick={() => answerNotice("continue")}>
                Continue
              </Button>
            </>
          }
        >
          <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink">
            <li>Your question, and the BFO records it looks up to answer, go to Anthropic (typed answers) or OpenAI (voice and read-aloud), which process them to answer.</li>
            <li>Answers come from BFO’s records and can be wrong. They aren’t legal or tax advice.</li>
            <li>Conversations are saved to your History until you delete them. Spoken ones are saved as text.</li>
          </ul>
          <p className="mt-3 text-small text-ink-2">
            <TextLink to="/legal/privacy" inline>
              How BFO handles your information
            </TextLink>
          </p>
        </Dialog>
      </div>
    </Page>
  );
}

function Bubble({ m, tools = [], streaming = false }: { m: ChatMessage; tools?: string[]; streaming?: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-card bg-sunken px-4 py-3 text-reading whitespace-pre-wrap text-ink">
          <span className="sr-only">You: </span>
          {m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <span className="sr-only">BFO: </span>
      {tools.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {tools.map((label, i) => {
            const current = streaming && i === tools.length - 1 && !m.text;
            return (
              <li key={i} className="flex items-center gap-2 text-small text-ink-2">
                {current ? <Spinner /> : <Icon name="check" size={16} className="text-ink-3" />}
                {label}
              </li>
            );
          })}
        </ul>
      )}
      {m.text ? (
        <div className="ask-prose text-reading text-ink">
          <Markdown text={m.text} />
          {streaming && <span className="ask-caret" aria-hidden />}
        </div>
      ) : streaming && !tools.length ? (
        <p className="flex items-center gap-2 py-2 text-small text-ink-2">
          <Spinner />
          Thinking…
        </p>
      ) : null}
      {!streaming && m.text && (
        <p className="mt-2 flex items-start gap-1 text-small text-ink-2">
          <Icon name="sparkle" size={16} className="mt-[1px]" />
          <span>
            Answer by AI from BFO’s records
            {m.sources && m.sources.length > 0 ? ` · Read: ${[...new Set(m.sources.map((s) => s.detail ?? s.label))].join(" · ")}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}
