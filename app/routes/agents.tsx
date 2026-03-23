import { useEffect, useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Agents" }];
}

interface Agent {
  id: string;
  name: string;
  jobTitle: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
  createdAt: number;
}

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4", provider: "anthropic" },
  { value: "claude-haiku-4-20250506", label: "Claude Haiku 4", provider: "anthropic" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", provider: "anthropic" },
  { value: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  { value: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai" },
  { value: "o3-mini", label: "o3-mini", provider: "openai" },
];

const DOG_BREEDS = [
  "Golden Retriever", "Labrador", "German Shepherd", "Poodle", "Bulldog",
  "Beagle", "Rottweiler", "Dachshund", "Corgi", "Husky",
  "Shiba Inu", "Pomeranian", "Chihuahua", "Great Dane", "Dalmatian",
  "Border Collie", "Boxer", "Doberman", "Akita", "Samoyed",
  "Australian Shepherd", "Bernese Mountain Dog", "Cavalier King Charles",
  "French Bulldog", "Maltese", "Papillon", "Pug", "Shih Tzu",
  "Whippet", "Weimaraner", "Vizsla", "Basenji", "Bichon Frise",
];

const DOG_NAMES = [
  "Buddy", "Max", "Charlie", "Cooper", "Rocky", "Bear", "Duke",
  "Tucker", "Jack", "Buster", "Milo", "Rex", "Scout", "Zeus",
  "Luna", "Bella", "Daisy", "Sadie", "Molly", "Coco", "Rosie",
];

const DOG_SYSTEM_PROMPT = `You are an office dog. You can ONLY respond with dog sounds and actions. You must NEVER use human words or sentences. Your entire vocabulary is:
- "Woof!" "Woof woof!" "WOOF!"
- "Bark!" "Bark bark!" "BARK!"
- "Arf!" "Yip!" "Ruff!"
- "*wags tail*" "*tilts head*" "*pants happily*" "*sniffs around*" "*rolls over*" "*zoomies*" "*sits*" "*drops ball at feet*" "*happy wiggle*" "*licks face*"

Mix these up naturally. If someone talks to you, respond with enthusiasm. If another agent says something interesting, bark at them. Keep responses short (1-3 actions/sounds). You are a very good dog.`;

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showDogForm, setShowDogForm] = useState(false);
  const [dogApiKey, setDogApiKey] = useState("");
  const [dogModel, setDogModel] = useState(MODELS[0].value);

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
              model: (v.model as string) || MODELS[0].value,
              systemPrompt: (v.systemPrompt as string) || "",
              apiKey: (v.apiKey as string) || "",
              createdAt: (v.createdAt as number) || 0,
            };
          });
          arr.sort((a, b) => b.createdAt - a.createdAt);
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

  function resetForm() {
    setName("");
    setJobTitle("");
    setModel(MODELS[0].value);
    setSystemPrompt("");
    setApiKey("");
    setShowKey(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(agent: Agent) {
    setEditingId(agent.id);
    setName(agent.name);
    setJobTitle(agent.jobTitle);
    setModel(agent.model);
    setSystemPrompt(agent.systemPrompt);
    setApiKey(agent.apiKey);
    setShowKey(false);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !apiKey.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref, update } = await import("firebase/database");

    const data = {
      name: name.trim(),
      jobTitle: jobTitle.trim(),
      model,
      systemPrompt: systemPrompt.trim(),
      apiKey: apiKey.trim(),
    };

    if (editingId) {
      await update(ref(db, `agents/${editingId}`), data);
    } else {
      await push(ref(db, "agents"), {
        ...data,
        createdAt: Date.now(),
      });
    }

    resetForm();
  }

  async function handleDelete(id: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `agents/${id}`));
  }

  async function handleAddDog(e: React.FormEvent) {
    e.preventDefault();
    if (!dogApiKey.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");

    const breed = DOG_BREEDS[Math.floor(Math.random() * DOG_BREEDS.length)];
    const dogName = DOG_NAMES[Math.floor(Math.random() * DOG_NAMES.length)];

    await push(ref(db, "agents"), {
      name: dogName,
      jobTitle: `Office Dog (${breed})`,
      model: dogModel,
      systemPrompt: DOG_SYSTEM_PROMPT,
      apiKey: dogApiKey.trim(),
      createdAt: Date.now(),
    });

    setDogApiKey("");
    setShowDogForm(false);
  }

  function maskKey(key: string) {
    if (key.length <= 12) return "****";
    return key.slice(0, 7) + "..." + key.slice(-4);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Agents</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowDogForm(!showDogForm); if (showForm) resetForm(); }}
            className={`px-4 py-2 font-medium rounded-lg transition-colors cursor-pointer text-sm ${
              showDogForm
                ? "bg-white/10 text-white border border-white/10"
                : "bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10"
            }`}
          >
            {showDogForm ? "Cancel" : "Add Dog"}
          </button>
          <button
            onClick={() => { showForm ? resetForm() : setShowForm(true); setShowDogForm(false); }}
            className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm"
          >
            {showForm ? "Cancel" : "+ New Agent"}
          </button>
        </div>
      </div>

      {showDogForm && (
        <form onSubmit={handleAddDog} className="mb-8 p-6 bg-white/5 border border-white/10 rounded-xl max-w-lg space-y-4">
          <div className="text-center mb-2">
            <span className="text-3xl">🐕</span>
            <p className="text-sm text-gray-400 mt-1">Add an office dog! You'll get a surprise breed.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">Model</label>
            <select
              value={dogModel}
              onChange={(e) => setDogModel(e.target.value)}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
            >
              <optgroup label="Anthropic">
                {MODELS.filter((m) => m.provider === "anthropic").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="OpenAI">
                {MODELS.filter((m) => m.provider === "openai").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">API Key</label>
            <input
              type="password"
              value={dogApiKey}
              onChange={(e) => setDogApiKey(e.target.value)}
              placeholder={MODELS.find((m) => m.value === dogModel)?.provider === "openai" ? "sk-..." : "sk-ant-..."}
              required
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Adopt a Dog
          </button>
        </form>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="mb-8 p-6 bg-white/5 border border-white/10 rounded-xl max-w-lg space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Debbie"
                required
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">Job Title</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Research Analyst"
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
            >
              <optgroup label="Anthropic">
                {MODELS.filter((m) => m.provider === "anthropic").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="OpenAI">
                {MODELS.filter((m) => m.provider === "openai").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={MODELS.find((m) => m.value === model)?.provider === "openai" ? "sk-..." : "sk-ant-..."}
                required
                className="w-full px-4 py-2 pr-16 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white cursor-pointer px-2 py-1"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1.5">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant that..."
              rows={4}
              className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 resize-none"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            {editingId ? "Save Changes" : "Create Agent"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : agents.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <p className="text-gray-500 mb-4">No agents yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {agents.map((agent) => (
            <div key={agent.id} className="p-5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/[0.07] transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate">{agent.name}</h3>
                  {agent.jobTitle && (
                    <p className="text-gray-400 text-xs">{agent.jobTitle}</p>
                  )}
                  <p className="text-gray-500 text-xs mt-0.5">
                    {MODELS.find((m) => m.value === agent.model)?.label || agent.model}
                  </p>
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  <button onClick={() => startEdit(agent)} className="p-1.5 text-gray-500 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/5" title="Edit">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(agent.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors cursor-pointer rounded-lg hover:bg-white/5" title="Delete">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {agent.systemPrompt && (
                <p className="text-gray-400 text-sm mb-3 line-clamp-2">{agent.systemPrompt}</p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-xs font-mono">{maskKey(agent.apiKey)}</span>
                <Link to={`/agents/${agent.id}`} className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white text-xs font-medium rounded-lg transition-colors">
                  Chat
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
