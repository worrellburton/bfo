import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser, fail, handleError, sb, type AppUser } from "../lib/auth.js";
import { speak, transcribe, VoiceError } from "../lib/voice.js";
import { mintRealtimeSecret, RealtimeError, spokenInstructions } from "../lib/realtime.js";
import { readCollection } from "../lib/tree.js";
import { ASK_MODEL, MAX_TOOL_ROUNDS, runTool, scopeFor, systemPrompt, titleFrom, toolLabel, toolsFor, transcript, type ChatMessageRow, type ChatRow } from "../lib/ask.js";

/**
 * Ask BFO (lib/ask.ts). Conversations belong to the person who had them.
 *
 *   GET  ?view=chats            → { chats: [{ id, title, updatedAt }] }
 *   GET  ?view=chat&id=         → { chat, messages: [{ role, text, at }] }
 *   POST { action: "send", chatId?, message }
 *        → a text/event-stream of JSON lines:
 *          { type: "chat", id, title }       the conversation (new or continued)
 *          { type: "tool", label }           what the assistant is looking up
 *          { type: "text", delta }           the answer, as it comes
 *          { type: "done" } | { type: "error", message }
 *   POST { action: "delete", chatId }
 *   POST { action: "rename", chatId, title }
 *   POST { action: "transcribe", audio (base64), mime, hint? } → { text }     spoken question → words (lib/voice.ts)
 *   POST { action: "speak", text }                             → audio/mpeg    an answer read aloud
 *
 * The live voice (lib/realtime.ts), run from the browser over WebRTC:
 *   POST { action: "realtime-secret" }          → { secret, model, voice, api, expiresAt } a short-lived key, with BFO's tools in the session
 *   POST { action: "tool", name, input }        → { label, output }  one lookup, run as this person
 *   POST { action: "log", chatId?, role, text } → { chatId }         a spoken turn, kept with the conversation
 */

// Vercel buffers a function's response unless told to stream it.
export const config = { supportsResponseStreaming: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_MAX = 8000;
/** A spoken question, as base64: about a minute of opus. */
const AUDIO_MAX = 3 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // currentUser throws PartnerRefused for a partner; handleError answers 403.
  let me: AppUser | null;
  try {
    me = await currentUser(req);
  } catch (err) {
    return handleError(res, err);
  }
  if (!me) return fail(res, 401, "unauthorized");
  try {
    if (req.method === "GET") {
      const view = String(req.query.view ?? "");
      if (view === "chats") {
        const rows = (await sb<ChatRow[]>(`chats?user_id=eq.${me.id}&select=id,title,updated_at&order=updated_at.desc&limit=100`)) ?? [];
        return res.status(200).json({ chats: rows.map((c) => ({ id: c.id, title: c.title ?? "New chat", updatedAt: c.updated_at })) });
      }
      if (view === "chat") {
        const id = String(req.query.id ?? "");
        const chat = await ownChat(me.id, id);
        if (!chat) return fail(res, 404, "not_found");
        const rows = (await sb<ChatMessageRow[]>(`chat_messages?chat_id=eq.${id}&select=role,content,created_at&order=id.asc&limit=400`)) ?? [];
        return res.status(200).json({
          chat: { id: chat.id, title: chat.title ?? "New chat", updatedAt: chat.updated_at },
          messages: rows.map((m) => ({ role: m.role, text: typeof m.content === "string" ? m.content : String((m.content as { text?: string })?.text ?? ""), at: m.created_at })),
        });
      }
      return fail(res, 400, "bad_view");
    }
    if (req.method !== "POST") return fail(res, 405, "method_not_allowed");
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {}) as Record<string, unknown>;
    switch (String(body.action ?? "")) {
      case "send":
        return send(res, me, body);
      case "delete": {
        const id = String(body.chatId ?? "");
        if (!(await ownChat(me.id, id))) return fail(res, 404, "not_found");
        await sb(`chats?id=eq.${id}`, { method: "DELETE" });
        return res.status(200).json({ ok: true });
      }
      case "rename": {
        const id = String(body.chatId ?? "");
        const title = String(body.title ?? "").trim().slice(0, 80);
        if (!(await ownChat(me.id, id))) return fail(res, 404, "not_found");
        if (!title) return fail(res, 400, "bad_title");
        await sb(`chats?id=eq.${id}`, { method: "PATCH", body: { title } });
        return res.status(200).json({ ok: true });
      }
      case "realtime-secret": {
        const scope = await scopeFor(me);
        const names = (await readCollection("assets").catch((err) => (console.error("ask: couldn't read entity names for the title", err), [] as Awaited<ReturnType<typeof readCollection>>)))
          .filter((r) => !scope.assetIds || scope.assetIds.has(r.id))
          .map((r) => String((r.data as { name?: string } | null)?.name ?? ""))
          .filter(Boolean);
        const made = await mintRealtimeSecret({ instructions: spokenInstructions(systemPrompt(scope)), tools: toolsFor(scope), names });
        return res.status(200).json(made);
      }
      case "tool": {
        const name = String(body.name ?? "");
        if (!/^[a-z_]{1,40}$/.test(name)) return fail(res, 400, "bad_tool");
        const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
        const scope = await scopeFor(me);
        const output = await runTool(name, input, scope);
        return res.status(200).json({ label: toolLabel(name, input), output });
      }
      case "log": {
        const role = body.role === "assistant" ? "assistant" : body.role === "user" ? "user" : null;
        const text = String(body.text ?? "").trim().slice(0, MESSAGE_MAX);
        if (!role || !text) return fail(res, 400, "bad_turn");
        let chat: ChatRow | null = body.chatId ? await ownChat(me.id, String(body.chatId)) : null;
        if (!chat) {
          const made = await sb<ChatRow[]>("chats", { method: "POST", body: { user_id: me.id, title: titleFrom(role === "user" ? text : "Voice conversation") }, prefer: "return=representation" });
          chat = made?.[0] ?? null;
          if (!chat) return fail(res, 500, "store_failed");
        }
        await sb("chat_messages", { method: "POST", body: { chat_id: chat.id, role, content: { text } }, prefer: "return=minimal" });
        await sb(`chats?id=eq.${chat.id}`, { method: "PATCH", body: { updated_at: new Date().toISOString() } }).catch((err) => console.error("ask: couldn't touch the chat", err));
        return res.status(200).json({ chatId: chat.id, title: chat.title ?? "New chat" });
      }
      case "transcribe": {
        const b64 = String(body.audio ?? "");
        if (!b64 || b64.length > AUDIO_MAX * 1.4) return fail(res, 400, "bad_audio", b64 ? "That recording is too long." : "No audio came through.");
        const mime = /^audio\/[\w.+-]+$/.test(String(body.mime ?? "")) ? String(body.mime) : "audio/webm";
        const text = await transcribe(new Uint8Array(Buffer.from(b64, "base64")), mime, typeof body.hint === "string" ? body.hint : undefined);
        return res.status(200).json({ text });
      }
      case "speak": {
        const text = String(body.text ?? "").trim();
        if (!text) return fail(res, 400, "empty");
        const bytes = await speak(text);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "private, max-age=3600");
        return res.status(200).send(Buffer.from(bytes));
      }
      default:
        return fail(res, 400, "bad_action");
    }
  } catch (err) {
    if (err instanceof VoiceError) return fail(res, err.status >= 500 ? 502 : err.status, "voice_failed", err.message);
    if (err instanceof RealtimeError) return fail(res, err.status >= 500 ? 502 : err.status, "realtime_failed", err.message);
    return handleError(res, err);
  }
}

async function ownChat(userId: string, id: string): Promise<ChatRow | null> {
  if (!UUID.test(id)) return null;
  const rows = await sb<ChatRow[]>(`chats?id=eq.${id}&user_id=eq.${userId}&select=*&limit=1`);
  return rows?.[0] ?? null;
}

async function send(res: VercelResponse, me: NonNullable<Awaited<ReturnType<typeof currentUser>>>, body: Record<string, unknown>) {
  const message = String(body.message ?? "").trim().slice(0, MESSAGE_MAX);
  if (!message) return fail(res, 400, "empty", "Ask something first.");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail(res, 503, "not_configured", "Ask BFO isn't set up (ANTHROPIC_API_KEY).");

  // The conversation: continued, or started with this message as its title.
  let chat: ChatRow | null = null;
  if (body.chatId) {
    chat = await ownChat(me.id, String(body.chatId));
    if (!chat) return fail(res, 404, "not_found", "That conversation is gone.");
  }
  if (!chat) {
    const made = await sb<ChatRow[]>("chats", { method: "POST", body: { user_id: me.id, title: titleFrom(message) }, prefer: "return=representation" });
    chat = made?.[0] ?? null;
    if (!chat) return fail(res, 500, "store_failed");
  }
  const earlier = (await sb<ChatMessageRow[]>(`chat_messages?chat_id=eq.${chat.id}&select=role,content&order=id.asc&limit=400`)) ?? [];
  await sb("chat_messages", { method: "POST", body: { chat_id: chat.id, role: "user", content: { text: message } }, prefer: "return=minimal" });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  const emit = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emit({ type: "chat", id: chat.id, title: chat.title ?? titleFrom(message) });
  res.flushHeaders?.();

  const scope = await scopeFor(me);
  const client = new Anthropic({ apiKey });
  const tools = toolsFor(scope);
  const messages: Anthropic.Messages.MessageParam[] = [...transcript(earlier), { role: "user", content: message }];
  let answer = "";
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const stream = client.messages.stream({
        model: ASK_MODEL,
        max_tokens: 2500,
        system: systemPrompt(scope),
        tools,
        messages,
      });
      stream.on("text", (delta) => {
        answer += delta;
        emit({ type: "text", delta });
      });
      const final = await stream.finalMessage();
      const uses = final.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      if (final.stop_reason !== "tool_use" || !uses.length) break;
      messages.push({ role: "assistant", content: final.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const input = (use.input ?? {}) as Record<string, unknown>;
        emit({ type: "tool", label: toolLabel(use.name, input) });
        results.push({ type: "tool_result", tool_use_id: use.id, content: await runTool(use.name, input, scope) });
      }
      messages.push({ role: "user", content: results });
      // Text from a round that went on to call tools reads as thinking aloud; a blank line sets the answer apart.
      if (answer && !answer.endsWith("\n\n")) {
        answer += "\n\n";
        emit({ type: "text", delta: "\n\n" });
      }
    }
    if (!answer.trim()) {
      answer = "I couldn't put an answer together. Try asking another way.";
      emit({ type: "text", delta: answer });
    }
    await sb("chat_messages", { method: "POST", body: { chat_id: chat.id, role: "assistant", content: { text: answer.trim() } }, prefer: "return=minimal" });
    await sb(`chats?id=eq.${chat.id}`, { method: "PATCH", body: { updated_at: new Date().toISOString() } }).catch((err) => console.error("ask: couldn't touch the chat", err));
    emit({ type: "done" });
  } catch (err) {
    console.error("ask:", err);
    const text = err instanceof Anthropic.APIError ? `The assistant couldn't answer (${err.status}).` : "Something went wrong while answering.";
    emit({ type: "error", message: text });
    if (answer.trim()) await sb("chat_messages", { method: "POST", body: { chat_id: chat.id, role: "assistant", content: { text: answer.trim() } }, prefer: "return=minimal" }).catch((e) => console.error("ask: couldn't save the partial answer", e));
  }
  res.end();
}
