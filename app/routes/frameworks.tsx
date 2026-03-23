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

  // Group frameworks into category > subcategory tree
  const tree: CategoryTree = {};
  for (const fw of frameworks) {
    if (!tree[fw.category]) tree[fw.category] = {};
    if (!tree[fw.category][fw.subcategory]) tree[fw.category][fw.subcategory] = [];
    tree[fw.category][fw.subcategory].push(fw);
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Frameworks</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-10 space-y-3 max-w-lg">
        <div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => fetchTitle(url)}
            placeholder="Paste URL..."
            required
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={fetching ? "Detecting title..." : "Title (auto-detected)"}
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
        </div>

        <div className="flex gap-2">
          {categories.length > 0 ? (
            <select
              value={newCategory ? "__new__" : category}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setCategory("");
                  setNewCategory("");
                } else {
                  setCategory(e.target.value);
                  setNewCategory("");
                }
                setSubcategory("");
                setNewSubcategory("");
              }}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__new__">+ New category</option>
            </select>
          ) : null}

          {(newCategory !== "" || !categories.length) && (
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category"
              required={!category}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
            />
          )}
        </div>

        <div className="flex gap-2">
          {subcategories.length > 0 && activeCategory ? (
            <select
              value={newSubcategory ? "__new__" : subcategory}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setSubcategory("");
                  setNewSubcategory("");
                } else {
                  setSubcategory(e.target.value);
                  setNewSubcategory("");
                }
              }}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
            >
              <option value="">Select subcategory</option>
              {subcategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__new__">+ New subcategory</option>
            </select>
          ) : null}

          {(newSubcategory !== "" || !subcategories.length || !activeCategory) && (
            <input
              type="text"
              value={newSubcategory}
              onChange={(e) => setNewSubcategory(e.target.value)}
              placeholder="New subcategory"
              required={!subcategory}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
            />
          )}
        </div>

        <button
          type="submit"
          className="px-5 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
        >
          Add Framework
        </button>
      </form>

      {/* Framework list grouped by category/subcategory */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : Object.keys(tree).length === 0 ? (
        <p className="text-gray-500">No frameworks yet.</p>
      ) : (
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
                              <a
                                href={fw.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-sm truncate flex-1"
                              >
                                {fw.title}
                              </a>
                              <button
                                onClick={() => handleDelete(fw.id)}
                                className="text-gray-600 hover:text-red-400 text-sm ml-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                Delete
                              </button>
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
