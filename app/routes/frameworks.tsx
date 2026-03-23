import { useEffect, useState, useRef } from "react";

export function meta() {
  return [{ title: "BFO - Frameworks" }];
}

interface Framework {
  id: string;
  title: string;
  url: string;
  assetId: string;
  order: number;
  createdAt: number;
}

interface Asset {
  id: string;
  name: string;
}

export default function Frameworks() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editAssetId, setEditAssetId] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Load frameworks
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsubscribe = onValue(ref(db, "frameworks"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => {
            const v = value as Record<string, unknown>;
            return {
              id,
              title: (v.title as string) || "",
              url: (v.url as string) || "",
              assetId: (v.assetId as string) || "",
              order: typeof v.order === "number" ? v.order : (v.createdAt as number) || 0,
              createdAt: (v.createdAt as number) || 0,
            };
          });
          arr.sort((a, b) => a.order - b.order);
          setFrameworks(arr);
        } else {
          setFrameworks([]);
        }
        setLoading(false);
      });
    }

    setup();
    return () => unsubscribe?.();
  }, []);

  // Load assets for the dropdown
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
            name: (value as Record<string, unknown>).name as string,
          }));
          arr.sort((a, b) => a.name.localeCompare(b.name));
          setAssets(arr);
        } else {
          setAssets([]);
        }
      });
    }

    setup();
    return () => unsubscribe?.();
  }, []);

  async function fetchTitle(inputUrl: string) {
    if (!inputUrl.trim()) return;
    setFetching(true);
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(inputUrl)}`;
      const res = await fetch(proxyUrl);
      const html = await res.text();
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match?.[1]) {
        setTitle(match[1].trim());
      }
    } catch {
      // ignore fetch errors
    }
    setFetching(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");

    const maxOrder = frameworks.length > 0 ? Math.max(...frameworks.map((f) => f.order)) : 0;

    await push(ref(db, "frameworks"), {
      title: title.trim() || url.trim(),
      url: url.trim(),
      assetId: "",
      order: maxOrder + 1,
      createdAt: Date.now(),
    });

    setUrl("");
    setTitle("");
  }

  async function handleDelete(id: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, "frameworks/" + id));
  }

  function startEdit(fw: Framework) {
    setEditingId(fw.id);
    setEditTitle(fw.title);
    setEditUrl(fw.url);
    setEditAssetId(fw.assetId);
  }

  async function saveEdit() {
    if (!editingId) return;
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `frameworks/${editingId}`), {
      title: editTitle.trim(),
      url: editUrl.trim(),
      assetId: editAssetId,
    });
    setEditingId(null);
  }

  async function updateAsset(fwId: string, assetId: string) {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `frameworks/${fwId}`), { assetId });
  }

  // Drag and drop reorder
  async function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const oldList = [...frameworks];
    const dragIndex = oldList.findIndex((f) => f.id === dragId);
    const targetIndex = oldList.findIndex((f) => f.id === targetId);
    if (dragIndex === -1 || targetIndex === -1) return;

    const [moved] = oldList.splice(dragIndex, 1);
    oldList.splice(targetIndex, 0, moved);

    // Update order values in Firebase
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    const updates: Record<string, number> = {};
    oldList.forEach((fw, i) => {
      updates[`frameworks/${fw.id}/order`] = i;
    });
    await update(ref(db), updates);

    setDragId(null);
    setDragOverId(null);
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Frameworks</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-6">
        <div className="flex gap-2 items-center">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => fetchTitle(url)}
            placeholder="Paste a URL to add..."
            required
            className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            Add
          </button>
        </div>
        {url && (
          <div className="mt-2 max-w-md">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={fetching ? "Detecting title..." : "Title (auto-detected)"}
              className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm"
            />
          </div>
        )}
      </form>

      {/* Table — always visible */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                <th className="py-3 w-8"></th>
                <th className="py-3 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Asset</th>
                <th className="py-3 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {frameworks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    No frameworks yet. Paste a URL above to add one.
                  </td>
                </tr>
              ) : (
                frameworks.map((fw) => (
                  <tr
                    key={fw.id}
                    draggable={editingId !== fw.id}
                    onDragStart={() => setDragId(fw.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverId(fw.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === fw.id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(fw.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOverId(null);
                    }}
                    className={`border-b group hover:bg-white/5 transition-colors ${
                      dragId === fw.id
                        ? "opacity-40 border-white/5"
                        : dragOverId === fw.id
                          ? "border-t-2 border-t-blue-400 border-b-white/5"
                          : "border-white/5"
                    }`}
                  >
                    {/* Drag handle */}
                    <td className="py-3 w-8 cursor-grab active:cursor-grabbing">
                      <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="9" cy="6" r="1.5" />
                        <circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" />
                        <circle cx="15" cy="18" r="1.5" />
                      </svg>
                    </td>

                    {/* Name */}
                    <td className="py-3 pr-4">
                      {editingId === fw.id ? (
                        <div className="space-y-1">
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                            className="px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm w-full focus:outline-none focus:border-white/40"
                          />
                          <input
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            placeholder="URL"
                            className="px-2 py-1 bg-white/5 border border-white/20 rounded text-gray-400 text-xs w-full focus:outline-none focus:border-white/40"
                          />
                        </div>
                      ) : (
                        <div>
                          <a
                            href={fw.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 truncate block"
                          >
                            {fw.title}
                          </a>
                          <span className="text-gray-600 text-xs truncate block">{fw.url}</span>
                        </div>
                      )}
                    </td>

                    {/* Asset */}
                    <td className="py-3 pr-4">
                      {editingId === fw.id ? (
                        <select
                          value={editAssetId}
                          onChange={(e) => setEditAssetId(e.target.value)}
                          className="px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm focus:outline-none focus:border-white/40"
                        >
                          <option value="">Unassigned</option>
                          {assets.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={fw.assetId || ""}
                          onChange={(e) => updateAsset(fw.id, e.target.value)}
                          className="px-2 py-1 bg-transparent border border-transparent hover:border-white/10 rounded text-sm cursor-pointer focus:outline-none focus:border-white/20 appearance-none"
                          style={{ color: fw.assetId ? undefined : "#6b7280" }}
                        >
                          <option value="">Unassigned</option>
                          {assets.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3">
                      {editingId === fw.id ? (
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={saveEdit}
                            className="text-green-400 hover:text-green-300 cursor-pointer"
                            title="Save"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-500 hover:text-gray-300 cursor-pointer"
                            title="Cancel"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(fw)}
                            className="text-gray-500 hover:text-white cursor-pointer"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(fw.id)}
                            className="text-gray-500 hover:text-red-400 cursor-pointer"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
