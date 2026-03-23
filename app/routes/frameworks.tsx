import { useEffect, useState } from "react";

export function meta() {
  return [{ title: "BFO - Frameworks" }];
}

interface Framework {
  id: string;
  title: string;
  url: string;
  category: string;
  subcategory: string;
  createdAt: number;
}

interface CategoryTree {
  [category: string]: {
    [subcategory: string]: Framework[];
  };
}

export default function Frameworks() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSubcategory, setNewSubcategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [view, setView] = useState<"list" | "table">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");

  const categories = [...new Set(frameworks.map((f) => f.category))].sort();
  const subcategories = [
    ...new Set(
      frameworks
        .filter((f) => f.category === (newCategory || category))
        .map((f) => f.subcategory)
    ),
  ].sort();

  const activeCategory = newCategory || category;
  const activeSubcategory = newSubcategory || subcategory;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      const frameworksRef = ref(db, "frameworks");
      unsubscribe = onValue(frameworksRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<Framework, "id">),
          }));
          arr.sort((a, b) => b.createdAt - a.createdAt);
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
    if (!url.trim() || !activeCategory.trim() || !activeSubcategory.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");

    await push(ref(db, "frameworks"), {
      title: title.trim() || url.trim(),
      url: url.trim(),
      category: activeCategory.trim(),
      subcategory: activeSubcategory.trim(),
      createdAt: Date.now(),
    });

    setUrl("");
    setTitle("");
    setNewCategory("");
    setNewSubcategory("");
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
  }

  async function saveEdit() {
    if (!editingId) return;
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `frameworks/${editingId}`), {
      title: editTitle.trim(),
      url: editUrl.trim(),
    });
    setEditingId(null);
  }

  // Group frameworks into category > subcategory tree
  const tree: CategoryTree = {};
  for (const fw of frameworks) {
    if (!tree[fw.category]) tree[fw.category] = {};
    if (!tree[fw.category][fw.subcategory]) tree[fw.category][fw.subcategory] = [];
    tree[fw.category][fw.subcategory].push(fw);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Frameworks</h1>
        <div className="flex bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
              view === "list" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="List view"
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
      </div>

      {/* Quick add — just paste a URL */}
      <form onSubmit={handleAdd} className="mb-8">
        <div className="flex gap-2 items-center max-w-2xl">
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

        {/* Expandable details — only show when URL is entered */}
        {url && (
          <div className="flex gap-2 mt-2 max-w-2xl flex-wrap">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={fetching ? "Detecting title..." : "Title (auto-detected)"}
              className="flex-1 min-w-[150px] px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm"
            />

            <div className="relative">
              <input
                list="categories-list"
                value={newCategory || category}
                onChange={(e) => {
                  const val = e.target.value;
                  if (categories.includes(val)) {
                    setCategory(val);
                    setNewCategory("");
                  } else {
                    setNewCategory(val);
                    setCategory("");
                  }
                  setSubcategory("");
                  setNewSubcategory("");
                }}
                placeholder="Category"
                required
                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm w-[150px]"
              />
              <datalist id="categories-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="relative">
              <input
                list="subcategories-list"
                value={newSubcategory || subcategory}
                onChange={(e) => {
                  const val = e.target.value;
                  if (subcategories.includes(val)) {
                    setSubcategory(val);
                    setNewSubcategory("");
                  } else {
                    setNewSubcategory(val);
                    setSubcategory("");
                  }
                }}
                placeholder="Subcategory"
                required
                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm w-[150px]"
              />
              <datalist id="subcategories-list">
                {subcategories.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>
        )}
      </form>

      {/* Framework display */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : frameworks.length === 0 ? (
        <p className="text-gray-500">No frameworks yet.</p>
      ) : view === "table" ? (
        /* Table view */
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                <th className="py-3 pr-4 font-medium">Title</th>
                <th className="py-3 pr-4 font-medium">Category</th>
                <th className="py-3 pr-4 font-medium">Subcategory</th>
                <th className="py-3 pr-4 font-medium">Date</th>
                <th className="py-3 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {frameworks.map((fw) => (
                <tr key={fw.id} className="border-b border-white/5 group hover:bg-white/5">
                  <td className="py-3 pr-4">
                    {editingId === fw.id ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm w-full focus:outline-none focus:border-white/40"
                      />
                    ) : (
                      <a
                        href={fw.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 truncate block max-w-xs"
                      >
                        {fw.title}
                      </a>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-gray-400">{fw.category}</td>
                  <td className="py-3 pr-4 text-gray-400">{fw.subcategory}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    {editingId === fw.id ? (
                      <input
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        className="px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm w-full focus:outline-none focus:border-white/40"
                      />
                    ) : (
                      new Date(fw.createdAt).toLocaleDateString()
                    )}
                  </td>
                  <td className="py-3">
                    {editingId === fw.id ? (
                      <div className="flex gap-1">
                        <button onClick={saveEdit} className="text-green-400 hover:text-green-300 text-xs cursor-pointer">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 text-xs cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(fw)} className="text-gray-500 hover:text-white text-xs cursor-pointer">Edit</button>
                        <button onClick={() => handleDelete(fw.id)} className="text-gray-600 hover:text-red-400 text-xs cursor-pointer">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* List view — grouped by category/subcategory */
        <div className="space-y-8">
          {Object.entries(tree)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cat, subs]) => (
              <div key={cat}>
                <h2 className="text-xl font-bold mb-3 text-white">{cat}</h2>
                <div className="space-y-4 ml-4">
                  {Object.entries(subs)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([sub, items]) => (
                      <div key={sub}>
                        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          {sub}
                        </h3>
                        <div className="space-y-2 ml-4">
                          {items.map((fw) => (
                            <div
                              key={fw.id}
                              className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg group"
                            >
                              {editingId === fw.id ? (
                                <div className="flex-1 flex gap-2 items-center">
                                  <input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="flex-1 px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm focus:outline-none"
                                  />
                                  <input
                                    value={editUrl}
                                    onChange={(e) => setEditUrl(e.target.value)}
                                    className="flex-1 px-2 py-1 bg-white/5 border border-white/20 rounded text-white text-sm focus:outline-none"
                                  />
                                  <button onClick={saveEdit} className="text-green-400 hover:text-green-300 text-xs cursor-pointer">Save</button>
                                  <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 text-xs cursor-pointer">Cancel</button>
                                </div>
                              ) : (
                                <>
                                  <a
                                    href={fw.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 text-sm truncate flex-1"
                                  >
                                    {fw.title}
                                  </a>
                                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity ml-3">
                                    <button onClick={() => startEdit(fw)} className="text-gray-500 hover:text-white text-xs cursor-pointer">Edit</button>
                                    <button onClick={() => handleDelete(fw.id)} className="text-gray-600 hover:text-red-400 text-xs cursor-pointer">Delete</button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
