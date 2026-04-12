import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";
import { INITIAL_ENTITIES } from "./estate-map";

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
  ownerId?: string;
  llcType?: "Disregarded Entity" | "Partnership" | "C Corporation" | "";
  stateLink?: string;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
}

type SortKey = "name" | "type" | "state" | "ein" | "ownerId" | "llcType";
type SortDir = "asc" | "desc";

export default function Assets() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"LLC" | "C-Corp">("LLC");
  const [state, setState] = useState("");
  const [ein, setEin] = useState("");
  const [view, setView] = useState<"list" | "table">("list");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Ownership hierarchy from estate map
  const OWNERSHIP_MAP: Record<string, string> = {};
  for (const ent of INITIAL_ENTITIES) {
    if (ent.parentId) {
      const parent = INITIAL_ENTITIES.find((e) => e.id === ent.parentId);
      if (parent) {
        OWNERSHIP_MAP[ent.name.toLowerCase()] = parent.name;
      }
    }
  }

  // LLC type mapping based on known entity data
  const LLC_TYPE_MAP: Record<string, "Disregarded Entity" | "Partnership" | "C Corporation"> = {
    "ledger louise, llc": "Disregarded Entity",
    "swisshelm mountain ventures, llc": "Disregarded Entity",
    "sundown investments, llc": "Disregarded Entity",
    "ledger burton, llc": "Disregarded Entity",
    "worrell burton, llc": "Disregarded Entity",
    "fdj hesperia, llc (100%)": "Disregarded Entity",
    "fdj cfs, llc (100%)": "Disregarded Entity",
    "palomino ranch on the bend, llc (100%)": "Disregarded Entity",
    "persons lodge llc (100%)": "Disregarded Entity",
    "breezewood (100%)": "Disregarded Entity",
    "arizona center for recovery - a new direction, llc": "Disregarded Entity",
    "quail lakes apartments, llc": "Partnership",
    "hsl tp hotel, llc": "Partnership",
    "hsl placita west ltd partnership": "Partnership",
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, get, update, push } = await import("firebase/database");

      // One-time seed: create any Estate Map entities that don't exist yet
      if (!localStorage.getItem("bfo-assets-seeded-v1")) {
        try {
          const snap = await get(ref(db, "assets"));
          const existing = snap.val() || {};
          const existingNames = new Set<string>(
            Object.values(existing).map((a: any) => (a?.name || "").toLowerCase())
          );
          for (const ent of INITIAL_ENTITIES) {
            if (!existingNames.has(ent.name.toLowerCase())) {
              const lower = ent.name.toLowerCase();
              const type = lower.includes("inc") && !lower.includes("llc") ? "C-Corp" : "LLC";
              await push(ref(db, "assets"), {
                name: ent.name,
                type,
                state: "",
                ein: "",
                createdAt: Date.now(),
              });
            }
          }
          localStorage.setItem("bfo-assets-seeded-v1", "1");
        } catch (err) {
          console.error("Estate seed error:", err);
        }
      }

      // One-time seed: populate entity details from spreadsheet data
      if (!localStorage.getItem("bfo-entity-details-seeded-v1")) {
        try {
          const snap2 = await get(ref(db, "assets"));
          const all = snap2.val() || {};
          const entityData: Record<string, { state?: string; ein?: string; type?: string; address?: string; formationDate?: string }> = {
            "burton family revocable trust": { type: "LLC", state: "", address: "" },
            "ledger burton, llc": { state: "Delaware", ein: "93-3749778", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-17" },
            "ledger louise, llc": { state: "Nevada", ein: "93-3776895", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-11" },
            "sundown investments, llc": { state: "Arizona", ein: "93-3965064", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-16" },
            "swisshelm mountain ventures, llc": { state: "Arizona", ein: "93-3788576", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-30" },
            "worrell burton, llc": { state: "Nevada", ein: "93-3856277", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2023-08-28" },
            "arizona center for recovery - a new direction, llc": { state: "Arizona", ein: "85-3388398", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2019-06-25" },
            "fdj hesperia, llc (100%)": { state: "Arizona", ein: "81-0625880", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2016-06-09" },
            "palomino ranch on the bend, llc (100%)": { state: "Arizona", ein: "45-2077575", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2011-05-11" },
            "breezewood (100%)": { state: "Arizona", ein: "27-0298583", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2000-06-04" },
            "persons lodge llc (100%)": { state: "Arizona", ein: "83-0788287", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", formationDate: "2016-06-09" },
            "vq national": { state: "Arizona", ein: "86-0278038", type: "C-Corp", address: "11201 N Tatum Blvd Ste 300, PMB, Phoenix, AZ 85028" },
            "catalog digital, inc": { state: "Delaware", ein: "92-3587849", type: "C-Corp", address: "540 Hudson #6, New York, NY 10014", formationDate: "2023-04-12" },
            "quail lakes apartments, llc": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "hsl tp hotel, llc": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "hsl placita west ltd partnership": { state: "Arizona", address: "11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028" },
            "fdj cfs, llc (100%)": { state: "Delaware", formationDate: "2017-01-24" },
            "atlas hydration, inc": { type: "C-Corp" },
          };
          for (const [fbId, fbVal] of Object.entries(all)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            const seed = entityData[name];
            if (seed) {
              const updates: Record<string, string> = {};
              if (seed.state && !(fbVal as any).state) updates.state = seed.state;
              if (seed.ein && !(fbVal as any).ein) updates.ein = seed.ein;
              if (seed.type && (fbVal as any).type !== seed.type) updates.type = seed.type;
              if (seed.address && !(fbVal as any).address) updates.address = seed.address;
              if (seed.formationDate && !(fbVal as any).formationDate) updates.formationDate = seed.formationDate;
              if (Object.keys(updates).length > 0) {
                await update(ref(db, `assets/${fbId}`), updates);
              }
            }
          }
          localStorage.setItem("bfo-entity-details-seeded-v1", "1");
        } catch (err) {
          console.error("Entity details seed error:", err);
        }
      }

      // One-time seed: populate ownership and LLC type
      if (!localStorage.getItem("bfo-ownership-seeded-v1")) {
        try {
          const snap3 = await get(ref(db, "assets"));
          const all3 = snap3.val() || {};
          // Build name-to-id lookup
          const nameToId: Record<string, string> = {};
          for (const [fbId, fbVal] of Object.entries(all3)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            nameToId[name] = fbId;
          }
          for (const [fbId, fbVal] of Object.entries(all3)) {
            const name = ((fbVal as any)?.name || "").toLowerCase();
            const updates: Record<string, string> = {};
            // Set ownerId from estate map hierarchy
            const ownerName = OWNERSHIP_MAP[name];
            if (ownerName && !(fbVal as any).ownerId) {
              const ownerId = nameToId[ownerName.toLowerCase()];
              if (ownerId) updates.ownerId = ownerId;
            }
            // Set llcType
            const llcType = LLC_TYPE_MAP[name];
            if (llcType && !(fbVal as any).llcType) {
              updates.llcType = llcType;
            }
            if (Object.keys(updates).length > 0) {
              await update(ref(db, `assets/${fbId}`), updates);
            }
          }
          localStorage.setItem("bfo-ownership-seeded-v1", "1");
        } catch (err) {
          console.error("Ownership seed error:", err);
        }
      }

      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => ({
            id,
            ...(value as Omit<Asset, "id">),
          }));
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

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function updateOwner(assetId: string, ownerId: string) {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${assetId}`), { ownerId: ownerId || "" });
  }

  // Build ownership tree
  function getOwnerName(ownerId: string | undefined) {
    if (!ownerId) return "";
    const owner = assets.find((a) => a.id === ownerId);
    return owner?.name || "";
  }

  // Sort assets
  const sorted = [...assets].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return dir * a.name.localeCompare(b.name);
      case "type":
        return dir * a.type.localeCompare(b.type);
      case "state":
        return dir * (a.state || "").localeCompare(b.state || "");
      case "ein":
        return dir * (a.ein || "").localeCompare(b.ein || "");
      case "ownerId":
        return dir * getOwnerName(a.ownerId).localeCompare(getOwnerName(b.ownerId));
      case "llcType":
        return dir * (a.llcType || "").localeCompare(b.llcType || "");
      default:
        return 0;
    }
  });

  // Build tree structure: root entities first, then children nested under parents
  function buildTree(items: Asset[]): { asset: Asset; depth: number }[] {
    const result: { asset: Asset; depth: number }[] = [];
    const roots = items.filter((a) => !a.ownerId || !items.find((p) => p.id === a.ownerId));
    const children = (parentId: string, depth: number) => {
      const kids = items.filter((a) => a.ownerId === parentId);
      kids.sort((a, b) => a.name.localeCompare(b.name));
      for (const kid of kids) {
        result.push({ asset: kid, depth });
        children(kid.id, depth + 1);
      }
    };
    roots.sort((a, b) => a.name.localeCompare(b.name));
    for (const root of roots) {
      result.push({ asset: root, depth: 0 });
      children(root.id, 1);
    }
    return result;
  }

  const treeRows = buildTree(sorted);

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return (
        <svg className="w-3 h-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDir === "asc" ? (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  }

  const inputCls = `${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-black/5 border-gray-200 text-gray-900 focus:border-gray-400"} border rounded-lg placeholder-gray-500 focus:outline-none`;
  const cellBorder = isDark ? "border-white/10" : "border-gray-200";
  const hdrBg = isDark ? "bg-white/[0.03]" : "bg-gray-50";
  const hoverBg = isDark ? "hover:bg-white/[0.04]" : "hover:bg-gray-50";
  const columns: { key: SortKey; label: string; w: string }[] = [
    { key: "name", label: "Entity Name", w: "min-w-[220px]" },
    { key: "type", label: "Type", w: "w-[80px]" },
    { key: "llcType", label: "LLC Type", w: "w-[140px]" },
    { key: "state", label: "State", w: "w-[100px]" },
    { key: "ein", label: "EIN", w: "w-[120px]" },
    { key: "ownerId", label: "Owned By", w: "w-[180px]" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Entities</h1>
        <div className="flex items-center gap-3">
          <div className={`flex ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-lg overflow-hidden`}>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "list" ? `${isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900"}` : `${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`
              }`}
              title="Spreadsheet view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6z" />
              </svg>
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "table" ? `${isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900"}` : `${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`
              }`}
              title="Card view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
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
        <form onSubmit={handleCreate} className={`mb-6 p-6 ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-xl max-w-lg space-y-4`}>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setType("LLC")}
              className={`flex-1 py-3 rounded-lg font-medium text-sm transition-colors cursor-pointer ${
                type === "LLC"
                  ? "bg-white text-black"
                  : `${isDark ? "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10" : "bg-black/5 text-gray-500 border-gray-200 hover:bg-gray-100"} border`
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
                  : `${isDark ? "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10" : "bg-black/5 text-gray-500 border-gray-200 hover:bg-gray-100"} border`
              }`}
            >
              C-Corp
            </button>
          </div>

          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Entity name" required className={`w-full px-4 py-2 ${inputCls}`} />
          <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="State of formation (e.g. Delaware)" className={`w-full px-4 py-2 ${inputCls}`} />
          <input type="text" value={ein} onChange={(e) => setEin(e.target.value)} placeholder="EIN (optional)" className={`w-full px-4 py-2 ${inputCls}`} />

          <button type="submit" className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer">
            Create {type}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : assets.length === 0 ? (
        <p className="text-gray-500">No entities yet. Create one to get started.</p>
      ) : view === "list" ? (
        /* ── Spreadsheet view with tree hierarchy ── */
        <div className={`border rounded-lg overflow-hidden ${cellBorder}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`${hdrBg} border-b ${cellBorder}`}>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wider cursor-pointer select-none ${col.w} border-r last:border-r-0 ${cellBorder} ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} transition-colors`}
                      onClick={() => handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        <SortIcon col={col.key} />
                      </div>
                    </th>
                  ))}
                  {/* Static columns */}
                  <th className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wider w-[110px] border-r ${cellBorder} ${isDark ? "text-gray-400" : "text-gray-500"}`}>State Link</th>
                  <th className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wider w-[120px] border-r ${cellBorder} ${isDark ? "text-gray-400" : "text-gray-500"}`}>Op. Agreement</th>
                  <th className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wider w-[120px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>Articles of Org</th>
                </tr>
              </thead>
              <tbody>
                {treeRows.map(({ asset, depth }) => {
                  const hasChildren = assets.some((a) => a.ownerId === asset.id);
                  const isExpanded = expandedId === asset.id;
                  return (
                    <tr
                      key={asset.id}
                      className={`border-b last:border-b-0 ${cellBorder} ${hoverBg} transition-colors group`}
                    >
                      {/* Name with tree indentation */}
                      <td className={`px-3 py-2 border-r ${cellBorder} font-medium`}>
                        <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
                          {hasChildren && (
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : asset.id)}
                              className={`mr-1.5 p-0.5 rounded cursor-pointer ${isDark ? "text-gray-500 hover:text-white" : "text-gray-400 hover:text-gray-900"}`}
                            >
                              <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          )}
                          {depth > 0 && !hasChildren && (
                            <span className={`mr-1.5 ${isDark ? "text-gray-600" : "text-gray-300"}`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                          )}
                          <Link
                            to={`/assets/${asset.id}`}
                            className={`${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"} truncate`}
                          >
                            {asset.name}
                          </Link>
                        </div>
                      </td>
                      {/* Type */}
                      <td className={`px-3 py-2 border-r ${cellBorder}`}>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          asset.type === "C-Corp"
                            ? isDark ? "bg-purple-500/20 text-purple-300" : "bg-purple-50 text-purple-700"
                            : isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-50 text-blue-700"
                        }`}>
                          {asset.type}
                        </span>
                      </td>
                      {/* LLC Type */}
                      <td className={`px-3 py-2 border-r ${cellBorder} ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {asset.llcType || "—"}
                      </td>
                      {/* State */}
                      <td className={`px-3 py-2 border-r ${cellBorder} ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {asset.state || "—"}
                      </td>
                      {/* EIN */}
                      <td className={`px-3 py-2 border-r ${cellBorder} font-mono ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {asset.ein || "—"}
                      </td>
                      {/* Owned By dropdown */}
                      <td className={`px-3 py-2 border-r ${cellBorder}`}>
                        <select
                          value={asset.ownerId || ""}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateOwner(asset.id, e.target.value);
                          }}
                          className={`w-full text-xs py-1 px-1.5 rounded border ${isDark ? "bg-transparent border-white/10 text-gray-300 focus:border-white/30" : "bg-transparent border-gray-200 text-gray-600 focus:border-gray-400"} focus:outline-none cursor-pointer`}
                        >
                          <option value="">None</option>
                          {assets
                            .filter((a) => a.id !== asset.id)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      {/* State Link */}
                      <td className={`px-3 py-2 border-r ${cellBorder}`}>
                        {asset.stateLink ? (
                          <a href={asset.stateLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                            View
                          </a>
                        ) : (
                          <span className={`${isDark ? "text-yellow-500/60" : "text-yellow-600/60"} italic`}>Missing</span>
                        )}
                      </td>
                      {/* Operating Agreement */}
                      <td className={`px-3 py-2 border-r ${cellBorder} ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {asset.operatingAgreementDate || <span className={`${isDark ? "text-yellow-500/60" : "text-yellow-600/60"} italic`}>Missing</span>}
                      </td>
                      {/* Articles of Org */}
                      <td className={`px-3 py-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {asset.articlesOfOrgDate || <span className={`${isDark ? "text-yellow-500/60" : "text-yellow-600/60"} italic`}>Missing</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`px-3 py-2 text-xs ${isDark ? "text-gray-500 bg-white/[0.02]" : "text-gray-400 bg-gray-50"} border-t ${cellBorder}`}>
            {assets.length} entities
          </div>
        </div>
      ) : (
        /* ── Card view ── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((asset) => (
            <Link
              key={asset.id}
              to={`/assets/${asset.id}`}
              className={`p-5 ${isDark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-black/5 border-gray-200 hover:bg-gray-100"} border rounded-xl transition-colors block`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{asset.name}</h3>
                  <p className={`${isDark ? "text-gray-400" : "text-gray-500"} text-sm mt-1`}>{asset.state || "No state"}</p>
                </div>
                <span className={`text-xs font-mono ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"} px-2 py-1 rounded`}>
                  {asset.type}
                </span>
              </div>
              {asset.ein && (
                <p className="text-gray-500 text-xs mt-3">EIN: {asset.ein}</p>
              )}
              {asset.ownerId && (
                <p className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  Owned by: {getOwnerName(asset.ownerId)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
