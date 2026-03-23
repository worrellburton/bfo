import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Agent Chat" }];
}

interface Agent {
  name: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

interface PdfAttachment {
  name: string;
  base64: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  pdf?: PdfAttachment;
}

export default function AgentChat() {
  const { id } = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingPdf, setPendingPdf] = useState<PdfAttachment | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadAgent() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, get } = await import("firebase/database");

      const snapshot = await get(ref(db, `agents/${id}`));
      if (snapshot.exists()) {
        const v = snapshot.val() as Record<string, unknown>;
        setAgent({
          name: (v.name as string) || "",
          model: (v.model as string) || "",
          systemPrompt: (v.systemPrompt as string) || "",
          apiKey: (v.apiKey as string) || "",
        });
      }
      setLoading(false);
    }

    loadAgent();
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }, [input]);

  function handleFile(file: File) {
    if (file.type !== "application/pdf") return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setPendingPdf({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !pendingPdf) || !agent || streaming) return;

    const userMessage: Message = { role: "user", content: input.trim() || (pendingPdf ? `[Attached: ${pendingPdf.name}]` : ""), pdf: pendingPdf || undefined };
    const currentPdf = pendingPdf;
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setPendingPdf(null);
    setStreaming(true);

    try {
      const apiMessages = newMessages.map((m) => {
        if (m.pdf) {
          const content: unknown[] = [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: m.pdf.base64 } },
          ];
          if (m.content && m.content !== `[Attached: ${m.pdf.name}]`) {
            content.push({ type: "text", text: m.content });
          }
          return { role: m.role, content };
        }
        return { role: m.role, content: m.content };
      });

      const body: Record<string, unknown> = {
        model: agent.model,
        max_tokens: 4096,
        messages: apiMessages,
        stream: true,
      };

      if (agent.systemPrompt) {
        body.system = agent.systemPrompt;
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": agent.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        setMessages([...newMessages, { role: "assistant", content: `Error: ${res.status} — ${err}` }]);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();

      let assistantContent = "";
      setMessages([...newMessages, { role: "assistant", content: "" }]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              assistantContent += parsed.delta.text;
              setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages([...newMessages, { role: "assistant", content: `Error: ${errMsg}` }]);
    }

    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  if (!agent) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">Agent not found.</p>
        <Link to="/agents" className="text-blue-400 hover:text-blue-300 text-sm">Back to Agents</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/10 mb-4 shrink-0">
        <Link to="/agents" className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-bold">{agent.name}</h1>
          <p className="text-gray-500 text-xs">{agent.model}</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-xs text-gray-500 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-white/5"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages — drop zone */}
      <div
        className={`flex-1 overflow-y-auto space-y-4 pb-4 relative rounded-xl transition-colors ${
          dragOver ? "bg-blue-500/5 ring-2 ring-blue-400/30 ring-inset" : ""
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-blue-500/10 border-2 border-dashed border-blue-400/40 rounded-xl px-8 py-6 text-center">
              <svg className="w-8 h-8 text-blue-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <p className="text-blue-400 text-sm font-medium">Drop PDF here</p>
            </div>
          </div>
        )}
        {messages.length === 0 && !dragOver && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-600 text-sm">Send a message to start chatting with {agent.name}</p>
              <p className="text-gray-700 text-xs mt-2">You can drag & drop PDFs into the chat</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-white/10 text-white rounded-br-md"
                  : "bg-white/5 text-gray-200 rounded-bl-md"
              }`}
            >
              {msg.pdf && (
                <div className="flex items-center gap-2 mb-1.5 px-2 py-1.5 bg-white/5 rounded-lg">
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-gray-300 truncate">{msg.pdf.name}</span>
                </div>
              )}
              {msg.content && msg.content !== `[Attached: ${msg.pdf?.name}]` && msg.content}
              {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                <span className="inline-block w-1.5 h-4 bg-white/50 ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Pending PDF indicator */}
      {pendingPdf && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg mt-2">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-gray-300 truncate flex-1">{pendingPdf.name}</span>
          <button onClick={() => setPendingPdf(null)} className="text-gray-500 hover:text-white cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={handleFileInput} className="hidden" />
      <form onSubmit={handleSend} className="shrink-0 flex gap-2 items-end pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          className="px-2.5 py-2.5 text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
          title="Attach PDF"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={streaming}
          className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 resize-none text-sm"
        />
        <button
          type="submit"
          disabled={streaming || (!input.trim() && !pendingPdf)}
          className="px-4 py-2.5 bg-white text-black font-medium rounded-xl hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {streaming ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
