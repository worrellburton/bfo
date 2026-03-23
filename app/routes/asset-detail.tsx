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

  // Doc form
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let unsub3: (() => void) | undefined;
    let unsub4: (() => void) | undefined;

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
    }

    setup();
    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
      unsub4?.();
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
                <p className="text-gray-500 text-xs uppercase tracking-wider">{label}</p>
                <p className="text-sm mt-1">{value}</p>
              </div>
            ) : null
          )}
          {asset.notes && (
            <div className="col-span-2 p-3 bg-white/5 border border-white/10 rounded-lg">
              <p className="text-gray-500 text-xs uppercase tracking-wider">Notes</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{asset.notes}</p>
            </div>
          )}
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
