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
}

type SortKey = "name" | "type" | "state" | "ein" | "createdAt";
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
  const [view, setView] = useState<"list" | "grid">("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, push, get, update } = await import("firebase/database");

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

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

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
      case "createdAt":
        return dir * (a.createdAt - b.createdAt);
      default:
        return 0;
    }
  });

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

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Entities</h1>
        <div className="flex items-center gap-3">
          <div className={`flex ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-lg overflow-hidden`}>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "list" ? `${isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900"}` : `${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`
              }`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setView("grid")}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                view === "grid" ? `${isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900"}` : `${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`
              }`}
              title="Grid view"
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
        <form onSubmit={handleCreate} className={`mb-8 p-6 ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-xl max-w-lg space-y-4`}>
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

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entity name"
            required
            className={`w-full px-4 py-2 ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-black/5 border-gray-200 text-gray-900 focus:border-gray-400"} border rounded-lg placeholder-gray-500 focus:outline-none`}
          />
          <input
            type="text"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="State of formation (e.g. Delaware)"
            className={`w-full px-4 py-2 ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-black/5 border-gray-200 text-gray-900 focus:border-gray-400"} border rounded-lg placeholder-gray-500 focus:outline-none`}
          />
          <input
            type="text"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            placeholder="EIN (optional)"
            className={`w-full px-4 py-2 ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-black/5 border-gray-200 text-gray-900 focus:border-gray-400"} border rounded-lg placeholder-gray-500 focus:outline-none`}
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
      ) : view === "list" ? (
        /* ── List view: sortable table with expandable rows ── */
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className={`border-b ${isDark ? "border-white/10 text-gray-400" : "border-gray-200 text-gray-500"} text-xs tracking-wider`}>
                {([
                  ["name", "Name"],
                  ["type", "Type"],
                  ["state", "State"],
                  ["ein", "EIN"],
                  ["createdAt", "Created"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className="py-3 pr-4 font-medium cursor-pointer select-none hover:text-white transition-colors"
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center gap-1.5">
                      {label}
                      <SortIcon col={key} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((asset) => {
                const isExpanded = expandedId === asset.id;
                return (
                  <tr
                    key={asset.id}
                    className={`border-b cursor-pointer transition-colors ${
                      isDark
                        ? `border-white/5 ${isExpanded ? "bg-white/5" : "hover:bg-white/[0.03]"}`
                        : `border-gray-100 ${isExpanded ? "bg-gray-50" : "hover:bg-gray-50/50"}`
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : asset.id)}
                  >
                    <td className="py-3 pr-4" colSpan={isExpanded ? 5 : undefined}>
                      {isExpanded ? (
                        /* ── Expanded row ── */
                        <div className="py-2">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="text-lg font-semibold">{asset.name}</h3>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className={`text-xs font-mono ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"} px-2 py-0.5 rounded`}>
                                  {asset.type}
                                </span>
                                <span className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                  {asset.state || "No state"}
                                </span>
                                {asset.ein && (
                                  <span className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                    EIN: {asset.ein}
                                  </span>
                                )}
                                <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                                  Created {new Date(asset.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <Link
                              to={`/assets/${asset.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors text-sm whitespace-nowrap"
                            >
                              Go to Entity Page &rarr;
                            </Link>
                          </div>
                        </div>
                      ) : (
                        asset.name
                      )}
                    </td>
                    {!isExpanded && (
                      <>
                        <td className="py-3 pr-4">
                          <span className={`text-xs font-mono ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"} px-2 py-0.5 rounded`}>
                            {asset.type}
                          </span>
                        </td>
                        <td className={`py-3 pr-4 ${isDark ? "text-gray-400" : "text-gray-500"}`}>{asset.state || "—"}</td>
                        <td className={`py-3 pr-4 ${isDark ? "text-gray-400" : "text-gray-500"}`}>{asset.ein || "—"}</td>
                        <td className="py-3 text-gray-500">{new Date(asset.createdAt).toLocaleDateString()}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Grid view: cards ── */
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
              <p className={`text-xs mt-2 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
                Created {new Date(asset.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
