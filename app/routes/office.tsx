import { useEffect, useState, useRef } from "react";

export function meta() {
  return [{ title: "BFO - Office" }];
}

interface Agent {
  id: string;
  name: string;
  jobTitle: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AgentPos {
  x: number; y: number;
  targetX: number; targetY: number;
  deskX: number; deskY: number;
  state: "working" | "walking" | "water" | "idle";
  stateTimer: number;
  facing: "left" | "right";
  walkFrame: number;
}

interface Toast {
  id: number;
  text: string;
  agent: string;
}

const FEMALE_NAMES = new Set([
  "mary","patricia","jennifer","linda","barbara","elizabeth","susan","jessica",
  "sarah","karen","lisa","nancy","betty","margaret","sandra","ashley","dorothy",
  "kimberly","emily","donna","michelle","carol","amanda","melissa","deborah",
  "stephanie","rebecca","sharon","laura","cynthia","kathleen","amy","angela",
  "shirley","anna","brenda","pamela","emma","nicole","helen","samantha","katherine",
  "christine","debra","rachel","carolyn","janet","catherine","maria","heather",
  "diane","ruth","julie","olivia","joyce","virginia","victoria","kelly","lauren",
  "christina","joan","evelyn","judith","megan","andrea","cheryl","hannah","jacqueline",
  "martha","gloria","teresa","ann","sara","madison","frances","kathryn","janice",
  "jean","abigail","alice","judy","sophia","grace","denise","amber","doris",
  "marilyn","danielle","beverly","isabella","theresa","diana","natalie","brittany",
  "charlotte","marie","kayla","alexis","lori","chloe","ava","mia","zoe","lily",
  "ella","aria","luna","nora","stella","hazel","violet","aurora","savannah",
  "audrey","brooklyn","bella","claire","skylar","lucy","paisley","everly",
  "caroline","nova","genesis","emilia","kennedy","maya","willow","kinsley","naomi",
  "aaliyah","elena","ariana","allison","gabriella","madelyn","cora",
  "ruby","eva","serenity","autumn","adeline","hailey","gianna","valentina","isla",
  "eliana","quinn","nevaeh","ivy","sadie","piper","lydia","alexa","josephine",
  "emery","julia","delilah","arianna","vivian","kaylee","sophie","brielle","madeline",
  "debbie","tina","jenny","kate","meg","rosa","lena","nina","gina","deb",
]);

function isFemale(name: string): boolean {
  return FEMALE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase());
}

function MaleSprite({ color, frame, facing }: { color: string; frame: number; facing: string }) {
  const flip = facing === "left";
  return (
    <svg viewBox="0 0 16 22" className="w-8 h-11" style={{ imageRendering: "pixelated", transform: flip ? "scaleX(-1)" : "" }}>
      <rect x="5" y="0" width="6" height="2" fill="#3b2f1e" />
      <rect x="4" y="1" width="8" height="1" fill="#3b2f1e" />
      <rect x="5" y="2" width="6" height="5" fill="#f5c6a0" />
      <rect x="6" y="4" width="1" height="1" fill="#222" />
      <rect x="9" y="4" width="1" height="1" fill="#222" />
      <rect x="4" y="7" width="8" height="5" fill={color} />
      <rect x="7" y="7" width="2" height="1" fill="#fff" opacity="0.4" />
      <rect x="2" y={frame % 2 === 0 ? "8" : "9"} width="2" height="4" fill={color} />
      <rect x="12" y={frame % 2 === 0 ? "9" : "8"} width="2" height="4" fill={color} />
      <rect x="2" y={frame % 2 === 0 ? "12" : "13"} width="2" height="1" fill="#f5c6a0" />
      <rect x="12" y={frame % 2 === 0 ? "13" : "12"} width="2" height="1" fill="#f5c6a0" />
      <rect x="5" y="12" width="6" height="4" fill="#2d4a7a" />
      <rect x="5" y="16" width="2" height={frame % 2 === 0 ? "3" : "2"} fill="#2d4a7a" />
      <rect x="9" y="16" width="2" height={frame % 2 === 0 ? "2" : "3"} fill="#2d4a7a" />
      <rect x="4" y={frame % 2 === 0 ? "19" : "18"} width="3" height="2" fill="#333" />
      <rect x="9" y={frame % 2 === 0 ? "18" : "19"} width="3" height="2" fill="#333" />
    </svg>
  );
}

function FemaleSprite({ color, frame, facing }: { color: string; frame: number; facing: string }) {
  const flip = facing === "left";
  return (
    <svg viewBox="0 0 16 22" className="w-8 h-11" style={{ imageRendering: "pixelated", transform: flip ? "scaleX(-1)" : "" }}>
      <rect x="4" y="0" width="8" height="2" fill="#6b3a2a" />
      <rect x="3" y="1" width="10" height="2" fill="#6b3a2a" />
      <rect x="3" y="3" width="2" height="4" fill="#6b3a2a" />
      <rect x="11" y="3" width="2" height="4" fill="#6b3a2a" />
      <rect x="5" y="2" width="6" height="5" fill="#f5c6a0" />
      <rect x="6" y="4" width="1" height="1" fill="#222" />
      <rect x="9" y="4" width="1" height="1" fill="#222" />
      <rect x="7" y="6" width="2" height="1" fill="#d4758a" />
      <rect x="4" y="7" width="8" height="4" fill={color} />
      <rect x="7" y="7" width="2" height="1" fill="#f5c6a0" />
      <rect x="2" y={frame % 2 === 0 ? "8" : "9"} width="2" height="3" fill={color} />
      <rect x="12" y={frame % 2 === 0 ? "9" : "8"} width="2" height="3" fill={color} />
      <rect x="2" y={frame % 2 === 0 ? "11" : "12"} width="2" height="1" fill="#f5c6a0" />
      <rect x="12" y={frame % 2 === 0 ? "12" : "11"} width="2" height="1" fill="#f5c6a0" />
      <rect x="3" y="11" width="10" height="3" fill={color} />
      <rect x="4" y="14" width="8" height="1" fill={color} />
      <rect x="5" y="15" width="2" height={frame % 2 === 0 ? "3" : "2"} fill="#f5c6a0" />
      <rect x="9" y="15" width="2" height={frame % 2 === 0 ? "2" : "3"} fill="#f5c6a0" />
      <rect x="4" y={frame % 2 === 0 ? "18" : "17"} width="3" height="1" fill="#c44" />
      <rect x="9" y={frame % 2 === 0 ? "17" : "18"} width="3" height="1" fill="#c44" />
    </svg>
  );
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const WATER_COOLER = { x: 8, y: 55 };

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadConversation(agentId: string): Message[] {
  const key = `bfo-chat-${agentId}-${getTodayKey()}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConversation(agentId: string, messages: Message[]) {
  const key = `bfo-chat-${agentId}-${getTodayKey()}`;
  localStorage.setItem(key, JSON.stringify(messages));
}

export default function Office() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [positions, setPositions] = useState<Record<string, AgentPos>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number>(0);
  const posRef = useRef<Record<string, AgentPos>>({});
  const toastIdRef = useRef(0);

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
              jobTitle: (v.jobTitle as string) || "",
              model: (v.model as string) || "",
              systemPrompt: (v.systemPrompt as string) || "",
              apiKey: (v.apiKey as string) || "",
            };
          });
          setAgents(arr);
        } else { setAgents([]); }
        setLoading(false);
      });
    }
    setup();
    return () => unsubscribe?.();
  }, []);

  // Initialize positions
  useEffect(() => {
    if (agents.length === 0) return;
    const newPos: Record<string, AgentPos> = {};
    const maxPerRow = Math.ceil(agents.length / 2);
    agents.forEach((agent, i) => {
      const row = i < maxPerRow ? 0 : 1;
      const col = row === 0 ? i : i - maxPerRow;
      const rowCount = row === 0 ? maxPerRow : agents.length - maxPerRow;
      const xStep = 70 / (rowCount + 1);
      const deskX = 15 + xStep * (col + 1);
      const deskY = row === 0 ? 38 : 68;
      if (posRef.current[agent.id]) {
        newPos[agent.id] = { ...posRef.current[agent.id], deskX, deskY };
      } else {
        newPos[agent.id] = {
          x: deskX, y: deskY, targetX: deskX, targetY: deskY,
          deskX, deskY, state: "working",
          stateTimer: 200 + Math.random() * 300,
          facing: "right", walkFrame: 0,
        };
      }
    });
    posRef.current = newPos;
    setPositions({ ...newPos });
  }, [agents]);

  // Animation loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    function tick() {
      const now = performance.now();
      const dt = (now - lastTime) / 16.67;
      lastTime = now;
      frameCount++;
      const pos = posRef.current;
      let changed = false;
      for (const id of Object.keys(pos)) {
        const p = pos[id];
        p.stateTimer -= dt;
        if (p.state === "working" && p.stateTimer <= 0) {
          const roll = Math.random();
          if (roll < 0.25) {
            p.state = "walking";
            p.targetX = WATER_COOLER.x + Math.random() * 6;
            p.targetY = WATER_COOLER.y + Math.random() * 6 - 3;
          } else if (roll < 0.45) {
            p.state = "walking";
            p.targetX = Math.max(5, Math.min(85, p.deskX + (Math.random() - 0.5) * 20));
            p.targetY = Math.max(25, Math.min(90, p.deskY + (Math.random() - 0.5) * 15));
          } else {
            p.stateTimer = 150 + Math.random() * 250;
          }
          changed = true;
        }
        if (p.state === "walking") {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) {
            p.x = p.targetX; p.y = p.targetY;
            const atWater = Math.abs(p.x - WATER_COOLER.x) < 10 && Math.abs(p.y - WATER_COOLER.y) < 10;
            p.state = atWater ? "water" : "idle";
            p.stateTimer = (atWater ? 80 : 40) + Math.random() * 60;
          } else {
            const speed = 0.25 * dt;
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
            p.facing = dx > 0 ? "right" : "left";
            if (frameCount % 8 === 0) p.walkFrame++;
          }
          changed = true;
        }
        if ((p.state === "water" || p.state === "idle") && p.stateTimer <= 0) {
          p.state = "walking";
          p.targetX = p.deskX;
          p.targetY = p.deskY;
          changed = true;
        }
      }
      if (changed || frameCount % 4 === 0) setPositions({ ...pos });
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addToast(text: string, agentName: string) {
    const id = ++toastIdRef.current;
    setToasts((t) => [...t, { id, text, agent: agentName }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  function openChat(agent: Agent) {
    setChatAgent(agent);
    const saved = loadConversation(agent.id);
    setMessages(saved);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function closeChat() {
    setChatAgent(null);
    setMessages([]);
    setInput("");
    setStreaming(false);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !chatAgent || streaming) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    saveConversation(chatAgent.id, newMessages);
    setInput("");
    setStreaming(true);
    addToast(`You: ${userMessage.content.slice(0, 60)}${userMessage.content.length > 60 ? "..." : ""}`, chatAgent.name);

    try {
      const body: Record<string, unknown> = {
        model: chatAgent.model,
        max_tokens: 4096,
        messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };
      if (chatAgent.systemPrompt) body.system = chatAgent.systemPrompt;

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
        const errMsg = `Error: ${res.status}`;
        const withErr = [...newMessages, { role: "assistant" as const, content: errMsg }];
        setMessages(withErr);
        saveConversation(chatAgent.id, withErr);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let content = "";
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
              content += parsed.delta.text;
              const updated = [...newMessages, { role: "assistant" as const, content }];
              setMessages(updated);
            }
          } catch { /* skip */ }
        }
      }

      const final = [...newMessages, { role: "assistant" as const, content }];
      setMessages(final);
      saveConversation(chatAgent.id, final);
      addToast(`${chatAgent.name}: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`, chatAgent.name);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const withErr = [...newMessages, { role: "assistant" as const, content: `Error: ${errMsg}` }];
      setMessages(withErr);
      saveConversation(chatAgent.id, withErr);
    }
    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); }
    if (e.key === "Escape") closeChat();
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="flex gap-4 h-[calc(100vh-4rem)]">
      {/* Left: Office room */}
      <div className="flex-1 flex flex-col min-w-0">
        <h1 className="text-2xl font-bold mb-4 shrink-0">Office</h1>

        <div className="relative flex-1 max-h-[600px] rounded-xl border border-white/10 overflow-visible" style={{
          background: "linear-gradient(180deg, #1a1c2e 0%, #12141f 100%)",
          aspectRatio: "4/3",
        }}>
          {/* Carpet */}
          <div className="absolute inset-0 rounded-xl" style={{
            background: "repeating-conic-gradient(rgba(255,255,255,0.015) 0% 25%, transparent 0% 50%) 0 0 / 48px 48px",
          }} />

          {/* Wall */}
          <div className="absolute top-0 left-0 right-0 h-[20%] rounded-t-xl" style={{
            background: "linear-gradient(180deg, #252840 0%, #1e2035 100%)",
          }}>
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#3a3520]" />
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-[65%] border border-white/10 rounded-sm overflow-hidden bg-gradient-to-b from-[#1a2a4a] to-[#0f1a30]">
              <div className="absolute inset-0 border-r border-white/5 w-1/2" />
              <div className="absolute inset-0 border-b border-white/5 h-1/2" />
            </div>
            <div className="absolute top-2 left-[10%] w-16 h-[70%] rounded-sm border border-white/10 bg-white/5">
              <div className="m-1 h-0.5 bg-white/10 w-3/4" />
              <div className="m-1 h-0.5 bg-white/10 w-1/2" />
            </div>
          </div>

          {/* Desks */}
          {agents.map((agent, i) => {
            const maxPerRow = Math.ceil(agents.length / 2);
            const row = i < maxPerRow ? 0 : 1;
            const col = row === 0 ? i : i - maxPerRow;
            const rowCount = row === 0 ? maxPerRow : agents.length - maxPerRow;
            const xStep = 70 / (rowCount + 1);
            const deskX = 15 + xStep * (col + 1);
            const deskY = row === 0 ? 38 : 68;
            return (
              <div key={`desk-${agent.id}`} className="absolute -translate-x-1/2" style={{ left: `${deskX}%`, top: `${deskY + 4}%` }}>
                <svg viewBox="0 0 48 20" className="w-20 h-8" style={{ imageRendering: "pixelated" }}>
                  <rect x="0" y="0" width="48" height="5" fill="#7a5c34" />
                  <rect x="0" y="0" width="48" height="2" fill="#8b6a3a" />
                  <rect x="2" y="5" width="3" height="14" fill="#5a4020" />
                  <rect x="43" y="5" width="3" height="14" fill="#5a4020" />
                  <rect x="16" y="-10" width="16" height="10" fill="#1a1a2e" rx="1" />
                  <rect x="17" y="-9" width="14" height="8" fill="#2a3a5a" />
                  <rect x="22" y="0" width="4" height="2" fill="#333" />
                </svg>
              </div>
            );
          })}

          {/* Water cooler */}
          <div className="absolute" style={{ left: `${WATER_COOLER.x}%`, top: `${WATER_COOLER.y}%` }}>
            <svg viewBox="0 0 14 28" className="w-5 h-9" style={{ imageRendering: "pixelated" }}>
              <rect x="4" y="0" width="6" height="10" fill="#90caf9" opacity="0.5" />
              <rect x="3" y="10" width="8" height="2" fill="#bbb" />
              <rect x="4" y="12" width="6" height="12" fill="#e0e0e0" />
              <rect x="3" y="24" width="8" height="2" fill="#999" />
              <rect x="4" y="26" width="2" height="2" fill="#777" />
              <rect x="8" y="26" width="2" height="2" fill="#777" />
            </svg>
          </div>

          {/* Plant */}
          <div className="absolute" style={{ right: "5%", bottom: "6%" }}>
            <svg viewBox="0 0 16 24" className="w-5 h-7" style={{ imageRendering: "pixelated" }}>
              <rect x="5" y="16" width="6" height="8" fill="#8b6a3a" />
              <rect x="6" y="6" width="4" height="11" fill="#2d7a2d" />
              <rect x="3" y="3" width="4" height="7" fill="#3a9a3a" />
              <rect x="9" y="4" width="4" height="6" fill="#3a9a3a" />
              <rect x="5" y="1" width="3" height="4" fill="#45b045" />
            </svg>
          </div>

          {/* Agents */}
          {agents.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-600 text-xs">No agents yet. Create agents in the Agents page.</p>
            </div>
          ) : agents.map((agent, i) => {
            const pos = positions[agent.id];
            if (!pos) return null;
            const color = COLORS[i % COLORS.length];
            const isActive = chatAgent?.id === agent.id;
            const female = isFemale(agent.name);
            const isWalking = pos.state === "walking";
            return (
              <div
                key={agent.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                style={{
                  left: `${pos.x}%`, top: `${pos.y}%`,
                  zIndex: isActive ? 30 : Math.round(pos.y),
                  transition: "left 100ms linear, top 100ms linear",
                }}
              >
                {/* Name + job title always visible */}
                <div className={`mb-0.5 text-center transition-opacity ${hoveredId === agent.id || isActive ? "opacity-100" : "opacity-50"}`}>
                  <div className="text-[9px] font-bold whitespace-nowrap" style={{ color }}>{agent.name}</div>
                  {agent.jobTitle && (
                    <div className="text-[7px] text-gray-500 whitespace-nowrap">{agent.jobTitle}</div>
                  )}
                </div>

                {/* Character */}
                <div
                  className={`cursor-pointer transition-transform ${isActive ? "scale-125" : "hover:scale-110"}`}
                  onMouseEnter={() => setHoveredId(agent.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => isActive ? closeChat() : openChat(agent)}
                >
                  {female
                    ? <FemaleSprite color={color} frame={isWalking ? pos.walkFrame : 0} facing={pos.facing} />
                    : <MaleSprite color={color} frame={isWalking ? pos.walkFrame : 0} facing={pos.facing} />
                  }
                </div>
                <div className="w-6 h-1.5 rounded-full bg-black/20 -mt-0.5" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Conversation panel */}
      {chatAgent && (
        <div className="w-80 shrink-0 flex flex-col border-l border-white/10 pl-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 shrink-0">
            <div>
              <h2 className="font-bold text-sm">{chatAgent.name}</h2>
              {chatAgent.jobTitle && <p className="text-gray-500 text-[10px]">{chatAgent.jobTitle}</p>}
            </div>
            <div className="flex gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); saveConversation(chatAgent.id, []); }}
                  className="text-[10px] text-gray-500 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5"
                >
                  Clear
                </button>
              )}
              <button onClick={closeChat} className="text-gray-500 hover:text-white cursor-pointer p-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {messages.length === 0 && (
              <p className="text-gray-600 text-xs text-center mt-8">Start a conversation with {chatAgent.name}</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-white/10 text-white rounded-br-sm"
                    : "bg-white/5 text-gray-200 rounded-bl-sm"
                }`}>
                  {msg.content}
                  {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                    <span className="inline-block w-1 h-3 bg-white/40 ml-0.5 animate-pulse rounded-sm" />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="flex gap-2 items-center pt-3 border-t border-white/10 mt-2 shrink-0">
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
          </form>
        </div>
      )}

      {/* Toast notifications — fixed bottom center, liquid glass */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-toast-in pointer-events-auto rounded-2xl px-5 py-3 text-xs text-white/90 max-w-sm shadow-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.07) 100%)",
              backdropFilter: "blur(24px) saturate(1.5)",
              WebkitBackdropFilter: "blur(24px) saturate(1.5)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <span className="font-medium text-white/70">{toast.agent}</span>{" "}
            <span className="text-white/60">{toast.text.split(": ").slice(1).join(": ")}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toast-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toast-out {
          0% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-8px); }
        }
        .animate-toast-in {
          animation: toast-in 0.3s ease-out, toast-out 0.5s ease-in 3.5s forwards;
        }
      `}</style>
    </div>
  );
}
