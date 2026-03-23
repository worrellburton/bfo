import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

export function meta() {
  return [{ title: "BFO - Asset" }];
}

interface Asset {
  name: string;
  type: "LLC" | "C-Corp";
  state: string;
  ein: string;
  createdAt: number;
  registeredAgent?: string;
  address?: string;
  formationDate?: string;
  status?: string;
  notes?: string;
}

interface CorpData {
  // Board of Directors
  directors?: Record<string, { name: string; title: string; since: string }>;
  // Officers
  officers?: Record<string, { name: string; title: string; since: string }>;
  // Shareholders
  shareholders?: Record<string, { name: string; shares: number; class: string; percentage: number }>;
  // Stock info
  authorizedShares?: number;
  issuedShares?: number;
  parValue?: string;
  stockClasses?: string;
  // Compliance
  fiscalYearEnd?: string;
  annualReportDue?: string;
  nextBoardMeeting?: string;
  stateFilingStatus?: string;
  // Key dates
  incorporationDate?: string;
  lastAnnualReport?: string;
  lastBoardMeeting?: string;
}

interface AssetDoc {
  id: string;
  name: string;
  url: string;
  createdAt: number;
}

interface Framework {
  id: string;
  title: string;
  url: string;
  category: string;
  subcategory: string;
}

export default function AssetDetail() {
  const { id } = useParams();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Asset>>({});

  // Frameworks
  const [allFrameworks, setAllFrameworks] = useState<Framework[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);

  // Corp management
  const [corpData, setCorpData] = useState<CorpData>({});
  const [corpTab, setCorpTab] = useState<"board" | "officers" | "shareholders" | "stock" | "compliance">("board");
  const [addingDirector, setAddingDirector] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [addingShareholder, setAddingShareholder] = useState(false);
  const [dirForm, setDirForm] = useState({ name: "", title: "Director", since: "" });
  const [offForm, setOffForm] = useState({ name: "", title: "", since: "" });
  const [shForm, setShForm] = useState({ name: "", shares: "", class: "Common", percentage: "" });

  // Doc form
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let unsub3: (() => void) | undefined;
    let unsub4: (() => void) | undefined;
    let unsub5: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsub1 = onValue(ref(db, `assets/${id}`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setAsset(data as Asset);
          setForm(data as Asset);
        }
        setLoading(false);
      });

      unsub2 = onValue(ref(db, `assets/${id}/documents`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([docId, value]) => ({
            id: docId,
            ...(value as Omit<AssetDoc, "id">),
          }));
          arr.sort((a, b) => b.createdAt - a.createdAt);
          setDocs(arr);
        } else {
          setDocs([]);
        }
      });

      // All frameworks
      unsub3 = onValue(ref(db, "frameworks"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([fwId, value]) => ({
            id: fwId,
            ...(value as Omit<Framework, "id">),
          }));
          setAllFrameworks(arr);
        } else {
          setAllFrameworks([]);
        }
      });

      // Assigned framework IDs
      unsub4 = onValue(ref(db, `assets/${id}/frameworks`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setAssignedIds(Object.keys(data));
        } else {
          setAssignedIds([]);
        }
      });

      // Corp data
      unsub5 = onValue(ref(db, `assets/${id}/corp`), (snapshot) => {
        const data = snapshot.val();
        setCorpData(data ? (data as CorpData) : {});
      });
    }

    setup();
    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
      unsub4?.();
      unsub5?.();
    };
  }, [id]);

  async function handleSave() {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}`), {
      name: form.name,
      type: form.type,
      state: form.state,
      ein: form.ein,
      registeredAgent: form.registeredAgent || "",
      address: form.address || "",
      formationDate: form.formationDate || "",
      status: form.status || "Active",
      notes: form.notes || "",
    });
    setEditing(false);
  }

  async function handleAddDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docName.trim() || !docUrl.trim()) return;

    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/documents`), {
      name: docName.trim(),
      url: docUrl.trim(),
      createdAt: Date.now(),
    });
    setDocName("");
    setDocUrl("");
  }

  async function handleDeleteDoc(docId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/documents/${docId}`));
  }

  async function handleDeleteAsset() {
    if (!confirm("Delete this entity? This cannot be undone.")) return;
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}`));
    window.location.href = "/bfo/assets";
  }

  async function handleAssignFramework(fwId: string) {
    const { db } = await import("../firebase");
    const { ref, set } = await import("firebase/database");
    await set(ref(db, `assets/${id}/frameworks/${fwId}`), true);
  }

  async function handleUnassignFramework(fwId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/frameworks/${fwId}`));
  }

  async function updateCorpField(field: string, value: unknown) {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}/corp`), { [field]: value });
  }

  async function addDirector() {
    if (!dirForm.name.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/directors`), { ...dirForm, name: dirForm.name.trim() });
    setDirForm({ name: "", title: "Director", since: "" });
    setAddingDirector(false);
  }

  async function removeDirector(dirId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/directors/${dirId}`));
  }

  async function addOfficer() {
    if (!offForm.name.trim() || !offForm.title.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/officers`), { ...offForm, name: offForm.name.trim(), title: offForm.title.trim() });
    setOffForm({ name: "", title: "", since: "" });
    setAddingOfficer(false);
  }

  async function removeOfficer(offId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/officers/${offId}`));
  }

  async function addShareholder() {
    if (!shForm.name.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/corp/shareholders`), {
      name: shForm.name.trim(),
      shares: Number(shForm.shares) || 0,
      class: shForm.class,
      percentage: Number(shForm.percentage) || 0,
    });
    setShForm({ name: "", shares: "", class: "Common", percentage: "" });
    setAddingShareholder(false);
  }

  async function removeShareholder(shId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/corp/shareholders/${shId}`));
  }

  const directors = corpData.directors ? Object.entries(corpData.directors).map(([k, v]) => ({ id: k, ...v })) : [];
  const officers = corpData.officers ? Object.entries(corpData.officers).map(([k, v]) => ({ id: k, ...v })) : [];
  const shareholders = corpData.shareholders ? Object.entries(corpData.shareholders).map(([k, v]) => ({ id: k, ...v })) : [];

  const assignedFrameworks = allFrameworks.filter((f) => assignedIds.includes(f.id));
  const unassignedFrameworks = allFrameworks.filter((f) => !assignedIds.includes(f.id));

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  if (!asset) {
    return (
      <div>
        <Link to="/assets" className="text-gray-400 hover:text-white text-sm mb-4 inline-block">
          &larr; Back to Assets
        </Link>
        <p className="text-gray-500">Entity not found.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Back nav */}
      <Link to="/assets" className="text-gray-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Assets
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">{asset.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs font-mono bg-white/10 px-2 py-1 rounded text-gray-300">
              {asset.type}
            </span>
            <span className="text-sm text-gray-400">{asset.state || "No state"}</span>
            {asset.status && (
              <span className={`text-xs px-2 py-1 rounded ${
                asset.status === "Active" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
              }`}>
                {asset.status}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="px-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={handleDeleteAsset}
            className="px-4 py-2 text-sm text-red-400 bg-white/5 border border-white/10 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Details / Edit form */}
      {editing ? (
        <div className="max-w-lg space-y-3 mb-10 p-6 bg-white/5 border border-white/10 rounded-xl">
          <input
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Entity name"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, type: "LLC" })}
              className={`flex-1 py-2 rounded-lg text-sm cursor-pointer ${form.type === "LLC" ? "bg-white text-black" : "bg-white/5 text-gray-400 border border-white/10"}`}
            >
              LLC
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, type: "C-Corp" })}
              className={`flex-1 py-2 rounded-lg text-sm cursor-pointer ${form.type === "C-Corp" ? "bg-white text-black" : "bg-white/5 text-gray-400 border border-white/10"}`}
            >
              C-Corp
            </button>
          </div>
          <input
            value={form.state || ""}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
            placeholder="State of formation"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            value={form.ein || ""}
            onChange={(e) => setForm({ ...form, ein: e.target.value })}
            placeholder="EIN"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            value={form.registeredAgent || ""}
            onChange={(e) => setForm({ ...form, registeredAgent: e.target.value })}
            placeholder="Registered agent"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            value={form.address || ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Principal address"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
          />
          <input
            type="date"
            value={form.formationDate || ""}
            onChange={(e) => setForm({ ...form, formationDate: e.target.value })}
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
          />
          <select
            value={form.status || "Active"}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Dissolved">Dissolved</option>
            <option value="Pending">Pending</option>
          </select>
          <textarea
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes"
            rows={3}
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 resize-none"
          />
          <button
            onClick={handleSave}
            className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 max-w-lg mb-10">
          {[
            ["EIN", asset.ein],
            ["Registered Agent", asset.registeredAgent],
            ["Address", asset.address],
            ["Formation Date", asset.formationDate],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-gray-500 text-xs tracking-wider">{label}</p>
                <p className="text-sm mt-1">{value}</p>
              </div>
            ) : null
          )}
          {asset.notes && (
            <div className="col-span-2 p-3 bg-white/5 border border-white/10 rounded-lg">
              <p className="text-gray-500 text-xs tracking-wider">Notes</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{asset.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* C-Corp Management */}
      {asset.type === "C-Corp" && (
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">Corporate Management</h2>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-white/5 border border-white/10 rounded-lg p-1 max-w-2xl">
            {([
              ["board", "Board of Directors"],
              ["officers", "Officers"],
              ["shareholders", "Shareholders"],
              ["stock", "Stock"],
              ["compliance", "Compliance"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setCorpTab(key)}
                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  corpTab === key ? "bg-white text-black" : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="max-w-2xl">
            {/* Board of Directors */}
            {corpTab === "board" && (
              <div className="space-y-3">
                {directors.length > 0 ? (
                  <div className="space-y-2">
                    {directors.map((d) => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg group">
                        <div>
                          <p className="text-sm font-medium">{d.name}</p>
                          <p className="text-xs text-gray-500">{d.title}{d.since ? ` — Since ${d.since}` : ""}</p>
                        </div>
                        <button onClick={() => removeDirector(d.id)} className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No directors added yet.</p>
                )}
                {addingDirector ? (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-2">
                    <input value={dirForm.name} onChange={(e) => setDirForm({ ...dirForm, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    <input value={dirForm.title} onChange={(e) => setDirForm({ ...dirForm, title: e.target.value })} placeholder="Title (e.g. Director, Chairman)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    <input type="date" value={dirForm.since} onChange={(e) => setDirForm({ ...dirForm, since: e.target.value })} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={addDirector} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingDirector(false)} className="px-4 py-2 text-gray-400 text-sm hover:text-white cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingDirector(true)} className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">+ Add Director</button>
                )}
              </div>
            )}

            {/* Officers */}
            {corpTab === "officers" && (
              <div className="space-y-3">
                {officers.length > 0 ? (
                  <div className="space-y-2">
                    {officers.map((o) => (
                      <div key={o.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg group">
                        <div>
                          <p className="text-sm font-medium">{o.name}</p>
                          <p className="text-xs text-gray-500">{o.title}{o.since ? ` — Since ${o.since}` : ""}</p>
                        </div>
                        <button onClick={() => removeOfficer(o.id)} className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No officers added yet.</p>
                )}
                {addingOfficer ? (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-2">
                    <input value={offForm.name} onChange={(e) => setOffForm({ ...offForm, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    <input value={offForm.title} onChange={(e) => setOffForm({ ...offForm, title: e.target.value })} placeholder="Title (CEO, CFO, Secretary, etc.)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    <input type="date" value={offForm.since} onChange={(e) => setOffForm({ ...offForm, since: e.target.value })} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={addOfficer} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingOfficer(false)} className="px-4 py-2 text-gray-400 text-sm hover:text-white cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingOfficer(true)} className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">+ Add Officer</button>
                )}
              </div>
            )}

            {/* Shareholders */}
            {corpTab === "shareholders" && (
              <div className="space-y-3">
                {shareholders.length > 0 ? (
                  <div>
                    <table className="w-full text-sm text-left mb-3">
                      <thead>
                        <tr className="border-b border-white/10 text-gray-400 text-xs tracking-wider">
                          <th className="py-2 pr-3 font-medium">Name</th>
                          <th className="py-2 pr-3 font-medium">Shares</th>
                          <th className="py-2 pr-3 font-medium">Class</th>
                          <th className="py-2 pr-3 font-medium">%</th>
                          <th className="py-2 w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {shareholders.map((s) => (
                          <tr key={s.id} className="border-b border-white/5 group">
                            <td className="py-2 pr-3">{s.name}</td>
                            <td className="py-2 pr-3 text-gray-400">{s.shares.toLocaleString()}</td>
                            <td className="py-2 pr-3 text-gray-400">{s.class}</td>
                            <td className="py-2 pr-3 text-gray-400">{s.percentage}%</td>
                            <td className="py-2">
                              <button onClick={() => removeShareholder(s.id)} className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">Remove</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No shareholders added yet.</p>
                )}
                {addingShareholder ? (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-2">
                    <input value={shForm.name} onChange={(e) => setShForm({ ...shForm, name: e.target.value })} placeholder="Shareholder name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    <div className="flex gap-2">
                      <input type="number" value={shForm.shares} onChange={(e) => setShForm({ ...shForm, shares: e.target.value })} placeholder="Shares" className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                      <select value={shForm.class} onChange={(e) => setShForm({ ...shForm, class: e.target.value })} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-white/30">
                        <option value="Common">Common</option>
                        <option value="Preferred A">Preferred A</option>
                        <option value="Preferred B">Preferred B</option>
                      </select>
                      <input type="number" value={shForm.percentage} onChange={(e) => setShForm({ ...shForm, percentage: e.target.value })} placeholder="%" step="0.01" className="w-20 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addShareholder} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingShareholder(false)} className="px-4 py-2 text-gray-400 text-sm hover:text-white cursor-pointer">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingShareholder(true)} className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">+ Add Shareholder</button>
                )}
              </div>
            )}

            {/* Stock */}
            {corpTab === "stock" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Authorized Shares</label>
                  <input type="number" value={corpData.authorizedShares || ""} onChange={(e) => updateCorpField("authorizedShares", Number(e.target.value) || 0)} placeholder="e.g. 10,000,000" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Issued Shares</label>
                  <input type="number" value={corpData.issuedShares || ""} onChange={(e) => updateCorpField("issuedShares", Number(e.target.value) || 0)} placeholder="e.g. 1,000,000" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Par Value</label>
                  <input value={corpData.parValue || ""} onChange={(e) => updateCorpField("parValue", e.target.value)} placeholder="e.g. $0.001" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Stock Classes</label>
                  <input value={corpData.stockClasses || ""} onChange={(e) => updateCorpField("stockClasses", e.target.value)} placeholder="e.g. Common, Preferred A" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                </div>
              </div>
            )}

            {/* Compliance */}
            {corpTab === "compliance" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Fiscal Year End</label>
                    <input value={corpData.fiscalYearEnd || ""} onChange={(e) => updateCorpField("fiscalYearEnd", e.target.value)} placeholder="e.g. December 31" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">State Filing Status</label>
                    <select value={corpData.stateFilingStatus || ""} onChange={(e) => updateCorpField("stateFilingStatus", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-white/30">
                      <option value="">Select...</option>
                      <option value="Current">Current</option>
                      <option value="Due Soon">Due Soon</option>
                      <option value="Overdue">Overdue</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Annual Report Due</label>
                    <input type="date" value={corpData.annualReportDue || ""} onChange={(e) => updateCorpField("annualReportDue", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Next Board Meeting</label>
                    <input type="date" value={corpData.nextBoardMeeting || ""} onChange={(e) => updateCorpField("nextBoardMeeting", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Incorporation Date</label>
                    <input type="date" value={corpData.incorporationDate || ""} onChange={(e) => updateCorpField("incorporationDate", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Last Annual Report</label>
                    <input type="date" value={corpData.lastAnnualReport || ""} onChange={(e) => updateCorpField("lastAnnualReport", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Last Board Meeting</label>
                    <input type="date" value={corpData.lastBoardMeeting || ""} onChange={(e) => updateCorpField("lastBoardMeeting", e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-white/30 text-sm" />
                  </div>
                </div>

                {/* Compliance status summary */}
                {(corpData.annualReportDue || corpData.nextBoardMeeting) && (
                  <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-lg">
                    <h3 className="text-sm font-medium mb-2">Upcoming Deadlines</h3>
                    <div className="space-y-1">
                      {corpData.annualReportDue && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">Annual Report</span>
                          <span className={new Date(corpData.annualReportDue) < new Date() ? "text-red-400" : "text-green-400"}>
                            {corpData.annualReportDue}
                          </span>
                        </div>
                      )}
                      {corpData.nextBoardMeeting && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">Board Meeting</span>
                          <span className={new Date(corpData.nextBoardMeeting) < new Date() ? "text-red-400" : "text-green-400"}>
                            {corpData.nextBoardMeeting}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assigned Frameworks */}
      <div className="mb-10">
        <h2 className="text-xl font-bold mb-4">Frameworks</h2>

        {assignedFrameworks.length > 0 && (
          <div className="space-y-2 max-w-lg mb-4">
            {assignedFrameworks.map((fw) => (
              <div
                key={fw.id}
                className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg group"
              >
                <div className="flex-1 min-w-0">
                  <a
                    href={fw.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm truncate block"
                  >
                    {fw.title}
                  </a>
                  <span className="text-gray-600 text-xs">
                    {fw.category} / {fw.subcategory}
                  </span>
                </div>
                <button
                  onClick={() => handleUnassignFramework(fw.id)}
                  className="text-gray-600 hover:text-red-400 text-xs ml-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {unassignedFrameworks.length > 0 ? (
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAssignFramework(e.target.value);
                e.target.value = "";
              }
            }}
            defaultValue=""
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-white/30 max-w-lg w-full"
          >
            <option value="" disabled>
              + Assign a framework...
            </option>
            {unassignedFrameworks.map((fw) => (
              <option key={fw.id} value={fw.id}>
                {fw.title} ({fw.category} / {fw.subcategory})
              </option>
            ))}
          </select>
        ) : assignedFrameworks.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No frameworks available.{" "}
            <Link to="/frameworks" className="text-blue-400 hover:text-blue-300">
              Create one first.
            </Link>
          </p>
        ) : null}
      </div>

      {/* Documents */}
      <div>
        <h2 className="text-xl font-bold mb-4">Documents</h2>

        <form onSubmit={handleAddDoc} className="flex gap-2 mb-4 max-w-lg">
          <input
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Document name"
            required
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm"
          />
          <input
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="URL"
            type="url"
            required
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm whitespace-nowrap"
          >
            Add
          </button>
        </form>

        {docs.length === 0 ? (
          <p className="text-gray-500 text-sm">No documents yet.</p>
        ) : (
          <div className="space-y-2 max-w-lg">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg group"
              >
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm truncate flex-1"
                >
                  {doc.name}
                </a>
                <button
                  onClick={() => handleDeleteDoc(doc.id)}
                  className="text-gray-600 hover:text-red-400 text-sm ml-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
