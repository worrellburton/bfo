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
