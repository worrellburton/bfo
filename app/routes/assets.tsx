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
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm"
        >
          {showForm ? "Cancel" : "+ New Entity"}
        </button>
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {assets.map((asset) => (
            <Link
              key={asset.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
