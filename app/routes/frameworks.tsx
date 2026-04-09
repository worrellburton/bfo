import { useEffect, useState, useRef } from "react";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Frameworks" }];
}

function UrlIcon({ url }: { url: string }) {
  if (url.includes("docs.google.com/spreadsheets")) {
    // Google Sheets icon
    return (
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="1" width="18" height="22" rx="2" fill="#0f9d58" />
        <rect x="6" y="8" width="12" height="10" rx="1" fill="white" />
        <line x1="6" y1="11.5" x2="18" y2="11.5" stroke="#0f9d58" strokeWidth="0.8" />
        <line x1="6" y1="14.5" x2="18" y2="14.5" stroke="#0f9d58" strokeWidth="0.8" />
        <line x1="11" y1="8" x2="11" y2="18" stroke="#0f9d58" strokeWidth="0.8" />
      </svg>
    );
  }
  if (url.includes("docs.google.com/document")) {
    // Google Docs icon
    return (
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="1" width="18" height="22" rx="2" fill="#4285f4" />
        <rect x="7" y="7" width="10" height="1" rx="0.5" fill="white" />
        <rect x="7" y="10" width="10" height="1" rx="0.5" fill="white" />
        <rect x="7" y="13" width="7" height="1" rx="0.5" fill="white" />
        <rect x="7" y="16" width="10" height="1" rx="0.5" fill="white" />
      </svg>
    );
  }
  if (url.includes("docs.google.com/presentation")) {
    // Google Slides icon
    return (
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="1" width="18" height="22" rx="2" fill="#f4b400" />
        <rect x="6" y="7" width="12" height="10" rx="1" fill="white" />
        <rect x="8" y="10" width="8" height="4" rx="0.5" fill="#f4b400" opacity="0.5" />
      </svg>
    );
  }
  if (url.includes("drive.google.com")) {
    // Google Drive icon
    return (
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
        <path d="M8 2l8 0 4 7H4L8 2z" fill="#f4b400" />
        <path d="M4 9l4 7h12l-4-7H4z" fill="#4285f4" />
        <path d="M16 2l4 7-4 7-4-7 4-7z" fill="#0f9d58" />
      </svg>
    );
  }
  // Generic link icon
  return (
    <svg className="w-4 h-4 shrink-0 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
            className={`flex-1 px-4 py-2.5 ${isDark ? "bg-white/5" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-lg ${isDark ? "text-white" : "text-gray-900"} placeholder-gray-500 focus:outline-none focus:border-white/30`}
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
              className={`w-full px-3 py-1.5 ${isDark ? "bg-white/5" : "bg-black/5"} border ${isDark ? "border-white/10" : "border-gray-200"} rounded-lg ${isDark ? "text-white" : "text-gray-900"} placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm`}
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
              <tr className={`border-b ${isDark ? "border-white/10" : "border-gray-200"} ${isDark ? "text-gray-400" : "text-gray-500"} text-xs tracking-wider`}>
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
                    className={`border-b group ${isDark ? "hover:bg-white/5" : "hover:bg-gray-100"} transition-colors ${
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
                            className={`px-2 py-1 ${isDark ? "bg-white/5" : "bg-black/5"} border border-white/20 rounded ${isDark ? "text-white" : "text-gray-900"} text-sm w-full focus:outline-none focus:border-white/40`}
                          />
                          <input
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            placeholder="URL"
                            className={`px-2 py-1 ${isDark ? "bg-white/5" : "bg-black/5"} border border-white/20 rounded ${isDark ? "text-gray-400" : "text-gray-500"} text-xs w-full focus:outline-none focus:border-white/40`}
                          />
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5">
                            <UrlIcon url={fw.url} />
                          </div>
                          <div className="min-w-0">
                            <a
                              href={fw.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 truncate block"
                            >
                              {fw.title}
                            </a>
                            <span className="text-gray-600 text-xs truncate block opacity-0 group-hover:opacity-100 transition-opacity">{fw.url}</span>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Asset */}
                    <td className="py-3 pr-4">
                      {editingId === fw.id ? (
                        <select
                          value={editAssetId}
                          onChange={(e) => setEditAssetId(e.target.value)}
                          className={`px-2 py-1 ${isDark ? "bg-white/5" : "bg-black/5"} border border-white/20 rounded ${isDark ? "text-white" : "text-gray-900"} text-sm focus:outline-none focus:border-white/40`}
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
                          className={`px-2 py-1 bg-transparent border border-transparent ${isDark ? "hover:border-white/10" : "hover:border-gray-200"} rounded text-sm cursor-pointer focus:outline-none focus:border-white/20 appearance-none`}
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
                            className={`text-gray-500 ${isDark ? "hover:text-white" : "hover:text-gray-900"} cursor-pointer`}
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
