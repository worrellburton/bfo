import { useEffect, useState, useRef } from "react";

export function meta() {
  return [{ title: "BFO - Office" }];
}

interface Agent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

function PersonSvg({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 64 64" className="w-12 h-12" fill="none">
      <circle cx="32" cy="18" r="10" fill={color} />
      <path d="M16 58V42a16 16 0 0132 0v16" fill={color} opacity="0.85" />
    </svg>
  );
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export default function Office() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [chatPos, setChatPos] = useState<{ left: string; top: string }>({ left: "50%", top: "50%" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [lastBubble, setLastBubble] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsubscribe = onValue(ref(db, "agents"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => {
            const v = value as Record<string, unknown>;
            return {
              id,
              name: (v.name as string) || "",
              model: (v.model as string) || "",
              systemPrompt: (v.systemPrompt as string) || "",
              apiKey: (v.apiKey as string) || "",
            };
          });
          setAgents(arr);
        } else {
          setAgents([]);
        }
        setLoading(false);
      });
    }

    setup();
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function getPosition(index: number, total: number) {
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / cols);
    const col = index % cols;
    const xStep = 100 / (cols + 1);
    const rows = Math.ceil(total / cols);
    const yStep = 100 / (rows + 1);
    return {
      left: `${xStep * (col + 1)}%`,
      top: `${yStep * (row + 1)}%`,
    };
  }

  function openChat(agent: Agent, pos: { left: string; top: string }) {
    setChatAgent(agent);
    setChatPos(pos);
    setMessages([]);
    setInput("");
    setLastBubble("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function closeChat() {
    setChatAgent(null);
    setMessages([]);
    setInput("");
    setStreaming(false);
    setLastBubble("");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !chatAgent || streaming) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setLastBubble("");

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const body: Record<string, unknown> = {
        model: chatAgent.model,
        max_tokens: 4096,
        messages: apiMessages,
        stream: true,
      };

      if (chatAgent.systemPrompt) {
        body.system = chatAgent.systemPrompt;
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": chatAgent.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        const errMsg = `Error: ${res.status}`;
        setMessages([...newMessages, { role: "assistant", content: errMsg }]);
        setLastBubble(errMsg);
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
              setLastBubble(assistantContent);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages([...newMessages, { role: "assistant", content: `Error: ${errMsg}` }]);
      setLastBubble(`Error: ${errMsg}`);
    }

    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
    if (e.key === "Escape") {
      closeChat();
    }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Office</h1>

      {/* The office room */}
      <div
        ref={roomRef}
        className="relative w-full max-w-2xl aspect-square border-2 border-white/10 rounded-xl bg-white/[0.02] mx-auto overflow-visible"
      >
        {/* Floor grid */}
        <div className="absolute inset-0 rounded-xl opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />

        {agents.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-gray-600 text-xs">No agents yet. Create agents in the Agents page.</p>
          </div>
        ) : (
          agents.map((agent, i) => {
            const pos = getPosition(i, agents.length);
            const color = COLORS[i % COLORS.length];
            const isActive = chatAgent?.id === agent.id;
            return (
              <div
                key={agent.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                style={{ left: pos.left, top: pos.top, zIndex: isActive ? 20 : 1 }}
              >
                {/* Speech bubble from agent */}
                {isActive && lastBubble && (
                  <div className="absolute bottom-full mb-2 w-56 max-h-32 overflow-y-auto">
                    <div className="bg-[#1a1a1a] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 whitespace-pre-wrap relative">
                      {lastBubble}
                      {streaming && (
                        <span className="inline-block w-1 h-3 bg-white/50 ml-0.5 animate-pulse" />
                      )}
                      {/* Speech bubble tail */}
                      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1a1a1a] border-r border-b border-white/10 rotate-45" />
                    </div>
                  </div>
                )}

                {/* Person */}
                <div
                  className={`cursor-pointer transition-transform ${isActive ? "scale-110" : "hover:scale-110"}`}
                  onMouseEnter={() => setHoveredId(agent.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => isActive ? closeChat() : openChat(agent, pos)}
                >
                  <PersonSvg color={color} />
                </div>

                {/* Name label */}
                <div className={`mt-1 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-all ${
                  hoveredId === agent.id || isActive ? "opacity-100" : "opacity-0"
                }`} style={{ backgroundColor: color, color: "#fff" }}>
                  {agent.name}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Chat input bar — appears below room when agent is selected */}
      {chatAgent && (
        <div className="max-w-2xl mx-auto mt-4">
          <form onSubmit={handleSend} className="flex gap-2 items-center">
            <div className="text-xs text-gray-500 shrink-0">To <span className="text-white font-medium">{chatAgent.name}</span>:</div>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={streaming}
              className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-xs"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="px-3 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0 text-xs"
            >
              {streaming ? "..." : "Send"}
            </button>
            <button
              type="button"
              onClick={closeChat}
              className="text-gray-500 hover:text-white cursor-pointer p-1"
              title="Close chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </form>

          {/* Conversation history */}
          {messages.length > 1 && (
            <div className="mt-3 max-h-40 overflow-y-auto space-y-2 px-1">
              {messages.slice(0, -1).map((msg, i) => (
                <div key={i} className={`text-xs ${msg.role === "user" ? "text-gray-400" : "text-gray-300"}`}>
                  <span className="text-gray-600 font-medium">{msg.role === "user" ? "You" : chatAgent.name}:</span>{" "}
                  {msg.content.length > 150 ? msg.content.slice(0, 150) + "..." : msg.content}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
