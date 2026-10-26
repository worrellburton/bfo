import { authFetch } from "./auth";

/**
 * The browser's side of /api/ask: the conversations list, one conversation,
 * and sending a message, which streams the answer back as it's written.
 */

export type ChatSummary = { id: string; title: string; updatedAt: string };
export type ChatMessage = { role: "user" | "assistant"; text: string; at?: string };

export type AskEvent =
  | { type: "chat"; id: string; title: string }
  | { type: "tool"; label: string }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? (res.status === 404 ? "That conversation is gone." : "Something went wrong."));
  return data as T;
}

export const listChats = () => call<{ chats: ChatSummary[] }>("/api/ask?view=chats");
export const getChat = (id: string) => call<{ chat: ChatSummary; messages: ChatMessage[] }>(`/api/ask?view=chat&id=${encodeURIComponent(id)}`);
export const deleteChat = (chatId: string) => call<{ ok: true }>("/api/ask", { method: "POST", body: JSON.stringify({ action: "delete", chatId }) });
export const renameChat = (chatId: string, title: string) => call<{ ok: true }>("/api/ask", { method: "POST", body: JSON.stringify({ action: "rename", chatId, title }) });

export type RealtimeSecret = { secret: string; model: string; voice: string; api: "ga" | "beta"; expiresAt: number };
/** A short-lived key for the live voice (OpenAI Realtime), with BFO's lookups in the session. */
export const realtimeSecret = () => call<RealtimeSecret>("/api/ask", { method: "POST", body: JSON.stringify({ action: "realtime-secret" }) });
/** One lookup the live voice asked for, run as this person. */
export const runAskTool = (name: string, input: Record<string, unknown>) => call<{ label: string; output: string }>("/api/ask", { method: "POST", body: JSON.stringify({ action: "tool", name, input }) });
/** A spoken turn, kept with the conversation (started here when there's none yet). */
export const logTurn = (chatId: string | null, role: "user" | "assistant", text: string) => call<{ chatId: string; title: string }>("/api/ask", { method: "POST", body: JSON.stringify({ action: "log", chatId: chatId ?? undefined, role, text }) });

/** What was said, as text. `hint` steers spelling (names the office uses). */
export async function transcribeAudio(blob: Blob, hint?: string): Promise<string> {
  const audio = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Couldn't read the recording."));
    r.readAsDataURL(blob);
  });
  const r = await call<{ text: string }>("/api/ask", { method: "POST", body: JSON.stringify({ action: "transcribe", audio, mime: blob.type || "audio/webm", hint }) });
  return r.text;
}

/** An answer read aloud: mp3 bytes to play. */
export async function speakText(text: string): Promise<Blob> {
  const res = await authFetch("/api/ask", { method: "POST", body: JSON.stringify({ action: "speak", text }) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message ?? "Couldn't read that aloud.");
  }
  return res.blob();
}

/**
 * Send a message and hand each event to `onEvent` as it arrives. Resolves
 * when the stream ends; rejects when the request itself fails.
 */
export async function sendMessage(input: { chatId?: string | null; message: string }, onEvent: (e: AskEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await authFetch("/api/ask", { method: "POST", body: JSON.stringify({ action: "send", chatId: input.chatId ?? undefined, message: input.message }), signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message ?? "Couldn't send that.");
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No answer came back.");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as AskEvent);
        } catch {
          // a torn frame: skip it
        }
      }
    }
  }
}
