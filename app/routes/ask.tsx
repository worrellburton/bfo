import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { deleteChat, getChat, listChats, logTurn, sendMessage, speakText, transcribeAudio, type ChatMessage, type ChatSummary } from "../ask-client";
import { canLive, LiveVoice, type LiveStatus } from "../realtime-voice";
import { canRecord, Player, Recorder } from "../ask-voice";
import { VoiceStage, type Caption, type VoiceStatus } from "../ask-voice-stage";
import { Markdown } from "../ask-markdown";
import { getUser } from "../auth";
import { confirmDialog } from "../confirm-dialog";
import { useTone } from "../entity/ui";

export function meta() {
  return [{ title: "BFO - Ask" }];
}

/**
 * Ask BFO: a conversation with the office's own records (lib/ask.ts).
 *
 * Voice first (app/ask-voice-stage.tsx): hold to talk, the words show as
 * they're said, the answer is spoken with its words keeping pace. "Type"
 * (?mode=text) gives the written layout: the answer streams in, a line says
 * what's being looked up, conversations are kept down the side.
 */

const SUGGESTIONS = [
  "What's due in the next 60 days?",
  "Which entities aren't in good standing?",
  "What came in the mail this week?",
  "How much cash do we have right now?",
  "Who are the owners of Ledger Louise?",
  "What did we spend on legal last quarter?",
];

type Live = { text: string; tools: string[]; done: boolean };

const SPEAK_KEY = "bfo-ask-speak";
function readSpeak(): boolean {
  try {
    return localStorage.getItem(SPEAK_KEY) === "1";
  } catch {
    return false;
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

export default function Ask() {
  const t = useTone();
  const [params, setParams] = useSearchParams();
  const chatId = params.get("c");
  const voiceMode = params.get("mode") !== "text";
  const me = getUser();
  function setMode(next: "voice" | "text") {
    const q: Record<string, string> = {};
    if (chatId) q.c = chatId;
    if (next === "text") q.mode = "text";
    setParams(q, { replace: true });
  }

  const [chats, setChats] = useState<ChatSummary[] | null>(null);
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
  /** The words on the voice stage: what was just said, or the answer being spoken. */
  const [caption, setCaption] = useState<Caption>(null);
  const [fetchingSpeech, setFetchingSpeech] = useState(false);
  // The live voice (OpenAI Realtime, app/realtime-voice.ts): one call for the whole conversation.
  // When it can't connect, the recorded path (mic → transcribe → answer → speech) takes over.
  const liveCall = useRef<LiveVoice | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const holdingRef = useRef(false);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const level = useCallback(() => (liveCall.current && liveStatus ? liveCall.current.level() : (recorder.current?.level() ?? 0)), [liveStatus]);
  const progress = useCallback(() => (liveCall.current ? 1 : (player.current?.progress() ?? 0)), []);
  useEffect(
    () => () => {
      liveCall.current?.close();
      liveCall.current = null;
    },
    []
  );
  // Leaving the voice stage hangs up.
  useEffect(() => {
    if (voiceMode) return;
    liveCall.current?.close();
    liveCall.current = null;
    setLiveStatus(null);
  }, [voiceMode]);

  /** A spoken turn into the transcript and the kept conversation. */
  function keepTurn(role: "user" | "assistant", text: string) {
    setMessages((m) => [...m, { role, text, at: new Date().toISOString() }]);
    logTurn(chatIdRef.current, role, text)
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
        keepTurn("user", text);
      },
      onAssistantDelta: (delta) => {
        spoken += delta;
        const text = spoken;
        setCaption({ role: "assistant", text });
      },
      onAssistantDone: (text) => {
        spoken = "";
        setCaption({ role: "assistant", text });
        keepTurn("assistant", text);
      },
      onTool: (label) => setLiveTools((t) => [...t, label]),
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
    const on = readSpeak();
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
    try {
      localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
    } catch {
      /* a preference that doesn't stick is no loss */
    }
    if (!next) {
      player.current?.stop();
      setSpeaking(false);
    } else (player.current ??= new Player()).unlock();
  }
  /** The conversation this page just started: its id lands in the address bar without a reload. */
  const started = useRef<string | null>(null);

  const refreshChats = useCallback(() => {
    listChats()
      .then((r) => setChats(r.chats))
      .catch(() => setChats((c) => c ?? []));
  }, []);
  useEffect(refreshChats, [refreshChats]);

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
      input.current?.focus();
      return;
    }
    let alive = true;
    setLoadingChat(true);
    getChat(chatId)
      .then((r) => {
        if (!alive) return;
        setMessages(r.messages);
      })
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

  /** The answer, read aloud: always on the voice stage, by choice in the written layout. */
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
    // Inside the tap, so the phone lets the answer sound later.
    if (speakRef.current || voiceRef.current) (player.current ??= new Player()).unlock();
    player.current?.stop();
    setSpeaking(false);
    setDraft("");
    setError(null);
    stickToBottom.current = true;
    setMessages((m) => [...m, { role: "user", text: message, at: new Date().toISOString() }]);
    setLive({ text: "", tools: [], done: false });
    const ctl = new AbortController();
    abort.current = ctl;
    let id = chatId;
    let answer = "";
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
          } else if (e.type === "error") setError(e.message);
        },
        ctl.signal
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      abort.current = null;
      setLive(null);
      if (answer.trim()) setMessages((m) => [...m, { role: "assistant", text: answer.trim(), at: new Date().toISOString() }]);
      if (id) setChats((list) => list && list.map((c) => (c.id === id ? { ...c, updatedAt: new Date().toISOString() } : c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      input.current?.focus();
      void readAloud(answer.trim());
    }
  }

  const micRef = useRef(mic);
  micRef.current = mic;
  const liveRef = useRef(live);
  liveRef.current = live;

  /** The mic opens (a tap in the written layout, a press on the voice stage). */
  const beginListening = useCallback(async () => {
    if (micRef.current !== "off" || liveRef.current) return;
    if (liveCall.current) return;
    try {
      // Inside the gesture, so the phone lets the answer sound later.
      if (speakRef.current || voiceRef.current) (player.current ??= new Player()).unlock();
      player.current?.stop();
      setSpeaking(false);
      const rec = new Recorder();
      await rec.start();
      recorder.current = rec;
      setError(null);
      setMic("listening");
    } catch {
      setError("The microphone isn't available. Allow it for this site and try again.");
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
        setError("I didn't catch that. Try again, a little closer to the mic.");
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

  /** The press on the voice stage: the live voice when it can be had, else the recorder. */
  async function holdStart() {
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
    else void beginListening();
  }

  function stop() {
    abort.current?.abort();
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
    const ok = await confirmDialog({ title: "Delete this conversation?", message: c.title, confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await deleteChat(c.id);
      setChats((list) => list && list.filter((x) => x.id !== c.id));
      if (chatId === c.id) newChat();
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
  const list = (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={newChat}
        className={`mx-3 mt-3 inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full text-[12.5px] font-medium transition-colors ${
          t.dark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-800"
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        New conversation
      </button>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats === null ? (
          <div className={`mx-1 mt-1 space-y-2 ${t.faint}`}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-8 animate-pulse rounded-lg ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`} />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className={`px-2 pt-2 text-[12px] ${t.muted}`}>Your conversations will be kept here.</p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => {
              const on = c.id === chatId;
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setParams(voiceMode ? { c: c.id } : { c: c.id, mode: "text" });
                      setHistoryOpen(false);
                    }}
                    className={`block w-full cursor-pointer rounded-lg px-2.5 py-2 pr-8 text-left transition-colors ${on ? (t.dark ? "bg-white/[0.07]" : "bg-gray-100") : t.hover}`}
                  >
                    <span className={`block truncate text-[12.5px] ${on ? t.text : t.soft}`}>{c.title}</span>
                    <span className={`block text-[10.5px] tabular-nums ${t.faint}`}>{when(c.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={() => void remove(c)}
                    className={`absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${
                      t.dark ? "text-gray-500 hover:bg-white/10 hover:text-red-300" : "text-gray-400 hover:bg-gray-200 hover:text-red-600"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-[1200px] flex-col md:h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:pointer-coarse:h-[calc(100dvh-76px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-3 pb-3 pt-1">
        <div className="min-w-0">
          <h1 className={`text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Ask BFO</h1>
          <p className={`mt-0.5 text-[12.5px] max-sm:hidden ${t.muted}`}>Answers from the office's own records: entities, filings, mail, treasury, books.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!voiceMode && (
            <button
              type="button"
              onClick={() => setMode("voice")}
              className={`inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${t.line} ${t.soft} ${t.hover}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
              Voice
            </button>
          )}
          {!voiceMode && (
          <button
            type="button"
            onClick={toggleSpeak}
            aria-pressed={speakOn}
            title={speakOn ? "Answers are read aloud" : "Read answers aloud"}
            className={`inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] max-sm:min-w-[44px] max-sm:justify-center cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
              speakOn ? (t.dark ? "border-[#818cf8]/40 bg-[#818cf8]/15 text-[#c7d2fe]" : "border-[#4f46e5]/30 bg-[#4f46e5]/[0.08] text-[#4338ca]") : `${t.line} ${t.soft} ${t.hover}`
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            <span className="max-sm:sr-only">{speaking ? <span className="ask-pulse">Speaking</span> : speakOn ? "Speaking on" : "Speak answers"}</span>
          </button>
          )}
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          className={`inline-flex h-9 max-md:h-[44px] md:pointer-coarse:h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${voiceMode ? "" : "lg:hidden"} ${t.line} ${t.soft} ${t.hover}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          History
        </button>
        </div>
      </header>

      <div className={`relative grid min-h-0 flex-1 overflow-hidden rounded-2xl border ${voiceMode ? "border-[#f4ede0]/10" : `lg:grid-cols-[240px_minmax(0,1fr)] ${t.surface} ${t.line}`}`}>
        {/* Conversations: a column on wide screens, a sheet over the thread on phones (and over the voice stage). */}
        {!voiceMode && <aside className={`hidden min-h-0 border-r lg:block ${t.line}`}>{list}</aside>}
        {historyOpen && (
          <div className={`absolute inset-0 z-20 ${voiceMode ? "" : "lg:hidden"}`}>
            <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-black/40" />
            <div className={`absolute inset-y-0 left-0 w-[280px] max-w-[85%] border-r shadow-2xl ${t.dark || voiceMode ? "bg-[#0d0d12]" : "bg-white"} ${t.line}`}>{list}</div>
          </div>
        )}

        {voiceMode ? (
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
            onType={() => setMode("text")}
          />
        ) : (
        <section className="flex min-h-0 flex-col">
          <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            {empty ? (
              <div className="mx-auto flex h-full max-w-[560px] flex-col justify-center">
                <p className={`font-brand text-[30px] leading-[1.15] sm:text-[34px] ${t.text}`}>{firstName ? `Hello, ${firstName}.` : "Hello."}</p>
                <p className={`mt-2 text-[14px] leading-relaxed ${t.soft}`}>
                  Ask about any entity, what's due, what came in the mail, what's in the bank, or what the books say. Nothing here changes a record; it reads them.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className={`cursor-pointer rounded-full border px-3.5 py-2 text-left text-[12.5px] transition-colors ${t.line} ${t.soft} ${t.dark ? "hover:border-white/20 hover:text-white" : "hover:border-gray-300 hover:text-gray-900"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-[720px] space-y-6">
                {loadingChat && !messages.length && (
                  <div className="space-y-3">
                    {[0, 1].map((i) => (
                      <div key={i} className={`h-12 animate-pulse rounded-2xl ${t.dark ? "bg-white/[0.05]" : "bg-gray-100"}`} style={{ width: i ? "70%" : "45%", marginLeft: i ? 0 : "auto" }} />
                    ))}
                  </div>
                )}
                {messages.map((m, i) => (
                  <Bubble key={i} m={m} />
                ))}
                {live && <Bubble m={{ role: "assistant", text: live.text }} tools={live.tools} streaming />}
                {error && (
                  <p role="alert" className={`text-[12.5px] ${t.dark ? "text-red-300/90" : "text-red-600"}`}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className={`border-t px-3 py-3 sm:px-5 ${t.line}`}
          >
            <div className={`mx-auto flex max-w-[720px] items-end gap-2 rounded-2xl border px-3 py-1.5 transition-colors ${t.dark ? "border-white/10 bg-white/[0.03] focus-within:border-white/25" : "border-gray-200 bg-white focus-within:border-gray-400"}`}>
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder={live ? "Answering…" : mic === "listening" ? "Listening… tap the square when you're done" : mic === "transcribing" ? "Writing down what you said…" : "Ask about the office…"}
                aria-label="Your question"
                style={{ outline: "none", boxShadow: "none", border: 0 }}
                className={`min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[14px] leading-relaxed placeholder:text-gray-500 max-sm:text-[16px] ${t.text}`}
              />
              {micAvailable && !live && (
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  disabled={mic === "transcribing"}
                  aria-label={mic === "listening" ? "Stop and send" : "Ask by voice"}
                  aria-pressed={mic === "listening"}
                  title={mic === "listening" ? "Tap when you're done" : "Ask by voice"}
                  className={`mb-1 grid h-9 w-9 max-md:mb-0 max-md:h-[44px] max-md:w-[44px] md:pointer-coarse:mb-0 md:pointer-coarse:h-[44px] md:pointer-coarse:w-[44px] shrink-0 cursor-pointer place-items-center rounded-full transition-all disabled:cursor-default ${
                    mic === "listening"
                      ? "ask-listening bg-red-500 text-white"
                      : mic === "transcribing"
                        ? t.dark
                          ? "bg-white/10 text-gray-300"
                          : "bg-gray-100 text-gray-500"
                        : t.dark
                          ? "text-gray-400 hover:bg-white/10 hover:text-white"
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {mic === "transcribing" ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : mic === "listening" ? (
                    <span className="h-3 w-3 rounded-[2px] bg-current" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>
              )}
              {live ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop"
                  className={`mb-1 grid h-9 w-9 max-md:mb-0 max-md:h-[44px] max-md:w-[44px] md:pointer-coarse:mb-0 md:pointer-coarse:h-[44px] md:pointer-coarse:w-[44px] shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${t.dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-gray-100 text-gray-900 hover:bg-gray-200"}`}
                >
                  <span className="h-3 w-3 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className={`mb-1 grid h-9 w-9 max-md:mb-0 max-md:h-[44px] max-md:w-[44px] md:pointer-coarse:mb-0 md:pointer-coarse:h-[44px] md:pointer-coarse:w-[44px] shrink-0 cursor-pointer place-items-center rounded-full transition-all disabled:cursor-default disabled:opacity-30 ${t.dark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-800"}`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
                  </svg>
                </button>
              )}
            </div>
            <p className={`mx-auto mt-1.5 max-w-[720px] text-[10.5px] ${t.faint}`}>Enter to send · Shift+Enter for a new line{micAvailable ? " · Tap the mic to ask by voice" : ""} · It reads the records and can be wrong; check anything that matters.</p>
          </form>
        </section>
        )}
      </div>
    </div>
  );
}

function Bubble({ m, tools = [], streaming = false }: { m: ChatMessage; tools?: string[]; streaming?: boolean }) {
  const t = useTone();
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed ${t.dark ? "bg-[#818cf8]/15 text-gray-100" : "bg-[#4f46e5]/[0.08] text-gray-900"}`}>{m.text}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className={`font-brand mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tracking-[0.04em] ${t.dark ? "border-[#f4ede0]/25 text-[#f4ede0]" : "border-gray-300 text-gray-800"}`} aria-hidden>
        BFO
      </span>
      <div className="min-w-0 flex-1">
        {tools.length > 0 && (
          <ul className="mb-2 space-y-0.5">
            {tools.map((label, i) => {
              const current = streaming && i === tools.length - 1 && !m.text;
              return (
                <li key={i} className={`flex items-center gap-2 text-[12px] ${t.muted}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${current ? "ask-pulse bg-[#818cf8]" : t.dark ? "bg-white/20" : "bg-gray-300"}`} />
                  {label}
                </li>
              );
            })}
          </ul>
        )}
        {m.text ? (
          <div className={`ask-prose text-[14px] leading-relaxed ${t.text}`}>
            <Markdown text={m.text} />
            {streaming && <span className="ask-caret" aria-hidden />}
          </div>
        ) : streaming && !tools.length ? (
          <div className={`flex items-center gap-1.5 py-2 ${t.muted}`} aria-label="Thinking">
            <span className="ask-dot" />
            <span className="ask-dot" style={{ animationDelay: "0.15s" }} />
            <span className="ask-dot" style={{ animationDelay: "0.3s" }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
