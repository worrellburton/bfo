import { useEffect, useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Assets" }];
}

interface Asset {
  id: string;
  name: string;
  type: "LLC" | "C-Corp";
  state: string;
  ein: string;
  createdAt: number;
}

export default function Assets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"LLC" | "C-Corp">("LLC");
  const [state, setState] = useState("");
  const [ein, setEin] = useState("");
  const [view, setView] = useState<"list" | "table">("list");

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<Asset, "id">),
          }));
          arr.sort((a, b) => a.name.localeCompare(b.name));
          setAssets(arr);
        } else {
          setAssets([]);
        }
        setLoading(false);
      });
    }

    setup();
    return () => unsubscribe?.();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");

    await push(ref(db, "assets"), {
      name: name.trim(),
      type,
      state: state.trim(),
      ein: ein.trim(),
      createdAt: Date.now(),
    });

    setName("");
    setState("");
    setEin("");
    setShowForm(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Assets</h1>
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 border border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "list" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              }`}
              title="Card view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "table" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              }`}
              title="Table view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6z" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm"
          >
            {showForm ? "Cancel" : "+ New Entity"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-8 p-6 bg-white/5 border border-white/10 rounded-xl max-w-lg space-y-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setType("LLC")}
              className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors cursor-pointer ${
                type === "LLC"
                  ? "bg-white text-black"
                  : "bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10"
              }`}
            >
              LLC
            </button>
            <button
              type="button"
              onClick={() => setType("C-Corp")}
              className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors cursor-pointer ${
                type === "C-Corp"
                  ? "bg-white text-black"
                  : "bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10"
              }`}
            >
              C-Corp
            </button>
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entity name"
            required
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            type="text"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="State of formation (e.g. Delaware)"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            type="text"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            placeholder="EIN (optional)"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />

          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Create {type}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : assets.length === 0 ? (
        <p className="text-gray-500">No entities yet. Create one to get started.</p>
      ) : view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs tracking-wider">
                <th className="py-3 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Type</th>
                <th className="py-3 pr-4 font-medium">State</th>
                <th className="py-3 pr-4 font-medium">EIN</th>
                <th className="py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 pr-4">
                    <Link to={`/assets/${asset.id}`} className="text-blue-400 hover:text-blue-300">
                      {asset.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-gray-300">
                      {asset.type}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-400">{asset.state || "—"}</td>
                  <td className="py-3 pr-4 text-gray-400">{asset.ein || "—"}</td>
                  <td className="py-3 text-gray-500">{new Date(asset.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {assets.map((asset) => (
            <div key={asset.id} className="group/card relative">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const info = [asset.name, asset.type, asset.state, asset.ein ? `EIN: ${asset.ein}` : ""].filter(Boolean).join("\n");
                  navigator.clipboard.writeText(info);
                }}
                className="absolute top-2 right-2 z-10 p-1.5 text-gray-500 hover:text-white transition-all cursor-pointer rounded-lg hover:bg-white/10 opacity-0 group-hover/card:opacity-100"
                title="Copy info"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth={2} />
                  <path strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
              <Link
                to={`/assets/${asset.id}`}
                className="p-5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors block"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{asset.name}</h3>
                    <p className="text-gray-400 text-sm mt-1">{asset.state || "No state"}</p>
                  </div>
                  <span className="text-xs font-mono bg-white/10 px-2 py-1 rounded text-gray-300">
                    {asset.type}
                  </span>
                </div>
                {asset.ein && (
                  <p className="text-gray-500 text-xs mt-3">EIN: {asset.ein}</p>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
