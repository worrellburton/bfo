import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTheme } from "../theme";

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
  ownerId?: string;
  llcType?: "Disregarded Entity" | "Partnership" | "C Corporation" | "";
  stateLink?: string;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
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

interface OperatingContract {
  id: string;
  counterparty: string;
  role: "manager" | "managed";
  services: string[];
  fee: string;
  frequency: string;
  effectiveDate: string;
  term: string;
  status: "draft" | "active" | "terminated";
  createdAt: number;
}

const MSA_SERVICES = [
  "Financial Management & Oversight",
  "AI & Technology Management",
  "SEO & Digital Marketing",
  "Bookkeeping & Accounting",
  "Tax Coordination & Planning",
  "Bank Account Management",
  "Compliance & Regulatory Oversight",
  "Strategic Planning & Advisory",
];

const LEDGER_LOUISE_SUBS = [
  "Swisshelm Mountain Ventures, LLC",
  "Sundown Investments, LLC",
  "Ledger Burton, LLC",
  "Worrell Burton, LLC",
];

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const inputCls = `${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-black/5 border-gray-200 text-gray-900 focus:border-gray-400"} border rounded-lg placeholder-gray-500 focus:outline-none`;
  const cardCls = `${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-lg`;
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<AssetDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Asset>>({});

  // Corp management
  const [corpData, setCorpData] = useState<CorpData>({});
  const [corpTab, setCorpTab] = useState<"board" | "officers" | "shareholders" | "stock" | "compliance">("board");
  const [addingDirector, setAddingDirector] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [addingShareholder, setAddingShareholder] = useState(false);
  const [dirForm, setDirForm] = useState({ name: "", title: "Director", since: "" });
  const [offForm, setOffForm] = useState({ name: "", title: "", since: "" });
  const [shForm, setShForm] = useState({ name: "", shares: "", class: "Common", percentage: "" });

  // Operating contracts
  const [contracts, setContracts] = useState<OperatingContract[]>([]);
  const [addingContract, setAddingContract] = useState(false);
  const [contractForm, setContractForm] = useState({
    counterparty: "",
    fee: "$500",
    frequency: "Quarterly",
    effectiveDate: new Date().toISOString().slice(0, 10),
    term: "Annual, auto-renewing",
    status: "draft" as "draft" | "active" | "terminated",
  });

  // Doc form
  const [docName, setDocName] = useState("");
  const [docUrl, setDocUrl] = useState("");

  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let unsub5: (() => void) | undefined;
    let unsub6: (() => void) | undefined;

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

      // Corp data
      unsub5 = onValue(ref(db, `assets/${id}/corp`), (snapshot) => {
        const data = snapshot.val();
        setCorpData(data ? (data as CorpData) : {});
      });

      // Operating contracts
      unsub6 = onValue(ref(db, `assets/${id}/contracts`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([cId, value]) => ({
            id: cId,
            ...(value as Omit<OperatingContract, "id">),
          }));
          arr.sort((a, b) => a.counterparty.localeCompare(b.counterparty));
          setContracts(arr);
        } else {
          setContracts([]);
        }
      });
    }

    setup();
    return () => {
      unsub1?.();
      unsub2?.();
      unsub5?.();
      unsub6?.();
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
      llcType: form.llcType || "",
      stateLink: form.stateLink || "",
      operatingAgreementDate: form.operatingAgreementDate || "",
      articlesOfOrgDate: form.articlesOfOrgDate || "",
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

  async function generateMSATemplates() {
    if (!asset) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    const existingCounterparties = new Set(contracts.map((c) => c.counterparty.toLowerCase()));
    for (const sub of LEDGER_LOUISE_SUBS) {
      if (existingCounterparties.has(sub.toLowerCase())) continue;
      await push(ref(db, `assets/${id}/contracts`), {
        counterparty: sub,
        role: "manager",
        services: MSA_SERVICES,
        fee: "$500",
        frequency: "Quarterly",
        effectiveDate: "2025-01-01",
        term: "Annual, auto-renewing",
        status: "draft",
        createdAt: Date.now(),
      });
    }
  }

  async function addContract() {
    if (!contractForm.counterparty.trim()) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/contracts`), {
      counterparty: contractForm.counterparty.trim(),
      role: "manager",
      services: MSA_SERVICES,
      fee: contractForm.fee.trim() || "$0",
      frequency: contractForm.frequency,
      effectiveDate: contractForm.effectiveDate,
      term: contractForm.term.trim() || "Annual, auto-renewing",
      status: contractForm.status,
      createdAt: Date.now(),
    });
    setContractForm({
      counterparty: "",
      fee: "$500",
      frequency: "Quarterly",
      effectiveDate: new Date().toISOString().slice(0, 10),
      term: "Annual, auto-renewing",
      status: "draft",
    });
    setAddingContract(false);
  }

  async function deleteContract(contractId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/contracts/${contractId}`));
  }

  async function updateContractStatus(contractId: string, status: "draft" | "active" | "terminated") {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    await update(ref(db, `assets/${id}/contracts/${contractId}`), { status });
  }

  const directors = corpData.directors ? Object.entries(corpData.directors).map(([k, v]) => ({ id: k, ...v })) : [];
  const officers = corpData.officers ? Object.entries(corpData.officers).map(([k, v]) => ({ id: k, ...v })) : [];
  const shareholders = corpData.shareholders ? Object.entries(corpData.shareholders).map(([k, v]) => ({ id: k, ...v })) : [];

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  if (!asset) {
    return (
      <div>
        <Link to="/assets" className={`${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm mb-4 inline-block`}>
          &larr; Back to Assets
        </Link>
        <p className="text-gray-500">Entity not found.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Back nav */}
      <Link to="/assets" className={`${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm mb-6 inline-flex items-center gap-1`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Assets
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">{asset.name}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className={`text-xs font-mono ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"} px-2 py-1 rounded`}>
              {asset.type}
            </span>
            {asset.llcType && (
              <span className={`text-xs ${isDark ? "bg-indigo-500/20 text-indigo-300" : "bg-indigo-50 text-indigo-700"} px-2 py-1 rounded`}>
                {asset.llcType}
              </span>
            )}
            <span className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>{asset.state || "No state"}</span>
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
            className={`px-4 py-2 text-sm ${isDark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-black/5 border-gray-200 hover:bg-gray-100"} border rounded-lg transition-colors cursor-pointer`}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={handleDeleteAsset}
            className={`px-4 py-2 text-sm text-red-400 ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer`}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Details / Edit form */}
      {editing ? (
        <div className={`max-w-lg space-y-3 mb-10 p-6 ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-xl`}>
          <input
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Entity name"
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, type: "LLC" })}
              className={`flex-1 py-2 rounded-lg text-sm cursor-pointer ${form.type === "LLC" ? "bg-white text-black" : `${isDark ? "bg-white/5 text-gray-400 border-white/10" : "bg-black/5 text-gray-500 border-gray-200"} border`}`}
            >
              LLC
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, type: "C-Corp" })}
              className={`flex-1 py-2 rounded-lg text-sm cursor-pointer ${form.type === "C-Corp" ? "bg-white text-black" : `${isDark ? "bg-white/5 text-gray-400 border-white/10" : "bg-black/5 text-gray-500 border-gray-200"} border`}`}
            >
              C-Corp
            </button>
          </div>
          <input
            value={form.state || ""}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
            placeholder="State of formation"
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <input
            value={form.ein || ""}
            onChange={(e) => setForm({ ...form, ein: e.target.value })}
            placeholder="EIN"
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <input
            value={form.registeredAgent || ""}
            onChange={(e) => setForm({ ...form, registeredAgent: e.target.value })}
            placeholder="Registered agent"
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <input
            value={form.address || ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Principal address"
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <input
            type="date"
            value={form.formationDate || ""}
            onChange={(e) => setForm({ ...form, formationDate: e.target.value })}
            className={`w-full px-4 py-2 ${inputCls}`}
          />
          <select
            value={form.status || "Active"}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className={`w-full px-4 py-2 ${inputCls}`}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Dissolved">Dissolved</option>
            <option value="Pending">Pending</option>
          </select>

          {/* New fields */}
          <div className={`pt-3 border-t ${isDark ? "border-white/10" : "border-gray-200"}`}>
            <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>Entity Classification</p>
            <select
              value={form.llcType || ""}
              onChange={(e) => setForm({ ...form, llcType: e.target.value as Asset["llcType"] })}
              className={`w-full px-4 py-2 ${inputCls}`}
            >
              <option value="">Select LLC Type...</option>
              <option value="Disregarded Entity">Disregarded Entity</option>
              <option value="Partnership">Partnership</option>
              <option value="C Corporation">C Corporation</option>
            </select>
          </div>

          <div>
            <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>State Filing Link</p>
            <input
              value={form.stateLink || ""}
              onChange={(e) => setForm({ ...form, stateLink: e.target.value })}
              placeholder="https://..."
              type="url"
              className={`w-full px-4 py-2 ${inputCls}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>Operating Agreement</p>
              <input
                type="date"
                value={form.operatingAgreementDate || ""}
                onChange={(e) => setForm({ ...form, operatingAgreementDate: e.target.value })}
                className={`w-full px-4 py-2 ${inputCls}`}
              />
            </div>
            <div>
              <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>Articles of Organization</p>
              <input
                type="date"
                value={form.articlesOfOrgDate || ""}
                onChange={(e) => setForm({ ...form, articlesOfOrgDate: e.target.value })}
                className={`w-full px-4 py-2 ${inputCls}`}
              />
            </div>
          </div>

          <textarea
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes"
            rows={3}
            className={`w-full px-4 py-2 ${inputCls} resize-none`}
          />
          <button
            onClick={handleSave}
            className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mb-10">
          {[
            ["EIN", asset.ein],
            ["Registered Agent", asset.registeredAgent],
            ["Address", asset.address],
            ["Formation Date", asset.formationDate],
            ["LLC Type", asset.llcType],
            ["Operating Agreement", asset.operatingAgreementDate],
            ["Articles of Org", asset.articlesOfOrgDate],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className={`p-3 ${cardCls}`}>
                <p className="text-gray-500 text-xs tracking-wider">{label}</p>
                <p className="text-sm mt-1">{value}</p>
              </div>
            ) : null
          )}
          {asset.stateLink && (
            <div className={`p-3 ${cardCls}`}>
              <p className="text-gray-500 text-xs tracking-wider">State Link</p>
              <a href={asset.stateLink} target="_blank" rel="noopener noreferrer" className="text-sm mt-1 text-blue-400 hover:text-blue-300 block truncate">
                View Filing
              </a>
            </div>
          )}
          {asset.notes && (
            <div className={`col-span-2 sm:col-span-3 p-3 ${cardCls}`}>
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
          <div className={`flex gap-1 mb-6 ${isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200"} border rounded-lg p-1 max-w-2xl`}>
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
                  corpTab === key ? "bg-white text-black" : `${isDark ? "text-gray-400 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`
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
                      <div key={d.id} className={`flex items-center justify-between p-3 ${cardCls} group`}>
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
                  <div className={`p-4 ${cardCls} space-y-2`}>
                    <input value={dirForm.name} onChange={(e) => setDirForm({ ...dirForm, name: e.target.value })} placeholder="Name" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <input value={dirForm.title} onChange={(e) => setDirForm({ ...dirForm, title: e.target.value })} placeholder="Title (e.g. Director, Chairman)" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <input type="date" value={dirForm.since} onChange={(e) => setDirForm({ ...dirForm, since: e.target.value })} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <div className="flex gap-2">
                      <button onClick={addDirector} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingDirector(false)} className={`px-4 py-2 ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm cursor-pointer`}>Cancel</button>
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
                      <div key={o.id} className={`flex items-center justify-between p-3 ${cardCls} group`}>
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
                  <div className={`p-4 ${cardCls} space-y-2`}>
                    <input value={offForm.name} onChange={(e) => setOffForm({ ...offForm, name: e.target.value })} placeholder="Name" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <input value={offForm.title} onChange={(e) => setOffForm({ ...offForm, title: e.target.value })} placeholder="Title (CEO, CFO, Secretary, etc.)" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <input type="date" value={offForm.since} onChange={(e) => setOffForm({ ...offForm, since: e.target.value })} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <div className="flex gap-2">
                      <button onClick={addOfficer} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingOfficer(false)} className={`px-4 py-2 ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm cursor-pointer`}>Cancel</button>
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
                        <tr className={`border-b ${isDark ? "border-white/10 text-gray-400" : "border-gray-200 text-gray-500"} text-xs tracking-wider`}>
                          <th className="py-2 pr-3 font-medium">Name</th>
                          <th className="py-2 pr-3 font-medium">Shares</th>
                          <th className="py-2 pr-3 font-medium">Class</th>
                          <th className="py-2 pr-3 font-medium">%</th>
                          <th className="py-2 w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {shareholders.map((s) => (
                          <tr key={s.id} className={`border-b ${isDark ? "border-white/5" : "border-gray-100"} group`}>
                            <td className="py-2 pr-3">{s.name}</td>
                            <td className={`py-2 pr-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}>{s.shares.toLocaleString()}</td>
                            <td className={`py-2 pr-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}>{s.class}</td>
                            <td className={`py-2 pr-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}>{s.percentage}%</td>
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
                  <div className={`p-4 ${cardCls} space-y-2`}>
                    <input value={shForm.name} onChange={(e) => setShForm({ ...shForm, name: e.target.value })} placeholder="Shareholder name" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                    <div className="flex gap-2">
                      <input type="number" value={shForm.shares} onChange={(e) => setShForm({ ...shForm, shares: e.target.value })} placeholder="Shares" className={`flex-1 px-3 py-2 ${inputCls} text-sm`} />
                      <select value={shForm.class} onChange={(e) => setShForm({ ...shForm, class: e.target.value })} className={`px-3 py-2 ${inputCls} text-sm`}>
                        <option value="Common">Common</option>
                        <option value="Preferred A">Preferred A</option>
                        <option value="Preferred B">Preferred B</option>
                      </select>
                      <input type="number" value={shForm.percentage} onChange={(e) => setShForm({ ...shForm, percentage: e.target.value })} placeholder="%" step="0.01" className={`w-20 px-3 py-2 ${inputCls} text-sm`} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addShareholder} className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer">Add</button>
                      <button onClick={() => setAddingShareholder(false)} className={`px-4 py-2 ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm cursor-pointer`}>Cancel</button>
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
                  <input type="number" value={corpData.authorizedShares || ""} onChange={(e) => updateCorpField("authorizedShares", Number(e.target.value) || 0)} placeholder="e.g. 10,000,000" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Issued Shares</label>
                  <input type="number" value={corpData.issuedShares || ""} onChange={(e) => updateCorpField("issuedShares", Number(e.target.value) || 0)} placeholder="e.g. 1,000,000" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Par Value</label>
                  <input value={corpData.parValue || ""} onChange={(e) => updateCorpField("parValue", e.target.value)} placeholder="e.g. $0.001" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                </div>
                <div>
                  <label className="text-gray-500 text-xs tracking-wider block mb-1">Stock Classes</label>
                  <input value={corpData.stockClasses || ""} onChange={(e) => updateCorpField("stockClasses", e.target.value)} placeholder="e.g. Common, Preferred A" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                </div>
              </div>
            )}

            {/* Compliance */}
            {corpTab === "compliance" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Fiscal Year End</label>
                    <input value={corpData.fiscalYearEnd || ""} onChange={(e) => updateCorpField("fiscalYearEnd", e.target.value)} placeholder="e.g. December 31" className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">State Filing Status</label>
                    <select value={corpData.stateFilingStatus || ""} onChange={(e) => updateCorpField("stateFilingStatus", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`}>
                      <option value="">Select...</option>
                      <option value="Current">Current</option>
                      <option value="Due Soon">Due Soon</option>
                      <option value="Overdue">Overdue</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Annual Report Due</label>
                    <input type="date" value={corpData.annualReportDue || ""} onChange={(e) => updateCorpField("annualReportDue", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Next Board Meeting</label>
                    <input type="date" value={corpData.nextBoardMeeting || ""} onChange={(e) => updateCorpField("nextBoardMeeting", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Incorporation Date</label>
                    <input type="date" value={corpData.incorporationDate || ""} onChange={(e) => updateCorpField("incorporationDate", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Last Annual Report</label>
                    <input type="date" value={corpData.lastAnnualReport || ""} onChange={(e) => updateCorpField("lastAnnualReport", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs tracking-wider block mb-1">Last Board Meeting</label>
                    <input type="date" value={corpData.lastBoardMeeting || ""} onChange={(e) => updateCorpField("lastBoardMeeting", e.target.value)} className={`w-full px-3 py-2 ${inputCls} text-sm`} />
                  </div>
                </div>

                {/* Compliance status summary */}
                {(corpData.annualReportDue || corpData.nextBoardMeeting) && (
                  <div className={`mt-4 p-4 ${cardCls}`}>
                    <h3 className="text-sm font-medium mb-2">Upcoming Deadlines</h3>
                    <div className="space-y-1">
                      {corpData.annualReportDue && (
                        <div className="flex justify-between text-xs">
                          <span className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>Annual Report</span>
                          <span className={new Date(corpData.annualReportDue) < new Date() ? "text-red-400" : "text-green-400"}>
                            {corpData.annualReportDue}
                          </span>
                        </div>
                      )}
                      {corpData.nextBoardMeeting && (
                        <div className="flex justify-between text-xs">
                          <span className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>Board Meeting</span>
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

      {/* Operating Contracts */}
      {asset.type === "LLC" && (() => {
        const headerCls = isDark
          ? "bg-white/[0.04] text-gray-400 border-white/10"
          : "bg-gray-50 text-gray-600 border-gray-200";
        const rowBorder = isDark ? "border-white/5" : "border-gray-100";
        const rowHover = isDark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50";
        const cellInputCls = `w-full px-2 py-1 text-xs ${inputCls}`;
        return (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Operating Contracts</h2>
              <div className="flex items-center gap-2">
                {asset.name.toLowerCase().includes("ledger louise") && contracts.length < LEDGER_LOUISE_SUBS.length && (
                  <button
                    onClick={generateMSATemplates}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer border ${
                      isDark ? "bg-white/5 border-white/10 hover:bg-white/10 text-gray-200" : "bg-black/5 border-gray-200 hover:bg-gray-100 text-gray-800"
                    }`}
                  >
                    Generate MSA Templates
                  </button>
                )}
                <button
                  onClick={() => setAddingContract((v) => !v)}
                  className="px-3 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm inline-flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {addingContract ? "Cancel" : "New Contract"}
                </button>
              </div>
            </div>

            <div className={`rounded-lg border overflow-hidden ${isDark ? "border-white/10" : "border-gray-200"}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`text-[11px] uppercase tracking-wider border-b ${headerCls}`}>
                      <th className="text-left font-semibold px-3 py-2.5 w-[28%]">Counterparty</th>
                      <th className="text-left font-semibold px-3 py-2.5">Fee</th>
                      <th className="text-left font-semibold px-3 py-2.5">Frequency</th>
                      <th className="text-left font-semibold px-3 py-2.5">Effective</th>
                      <th className="text-left font-semibold px-3 py-2.5">Term</th>
                      <th className="text-left font-semibold px-3 py-2.5">Status</th>
                      <th className="text-right font-semibold px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.length === 0 && !addingContract && (
                      <tr>
                        <td colSpan={7} className={`px-3 py-6 text-center text-sm ${isDark ? "text-gray-500" : "text-gray-500"}`}>
                          No operating contracts yet. Click <span className="font-semibold">New Contract</span> to add one.
                        </td>
                      </tr>
                    )}
                    {contracts.map((contract) => (
                      <tr key={contract.id} className={`border-b last:border-b-0 ${rowBorder} ${rowHover} transition-colors`}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium leading-tight">{contract.counterparty}</p>
                          <p className={`text-[11px] mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                            MSA — {asset.name} &rarr; {contract.counterparty}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{contract.fee}</td>
                        <td className="px-3 py-2.5">{contract.frequency}</td>
                        <td className="px-3 py-2.5 tabular-nums">{contract.effectiveDate}</td>
                        <td className={`px-3 py-2.5 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>{contract.term}</td>
                        <td className="px-3 py-2.5">
                          <select
                            value={contract.status}
                            onChange={(e) => updateContractStatus(contract.id, e.target.value as "draft" | "active" | "terminated")}
                            className={`text-xs px-2 py-1 rounded font-medium cursor-pointer border-0 outline-none ${
                              contract.status === "active"
                                ? "bg-green-500/20 text-green-400"
                                : contract.status === "terminated"
                                ? "bg-red-500/20 text-red-400"
                                : isDark ? "bg-white/10 text-gray-300" : "bg-gray-200 text-gray-700"
                            }`}
                          >
                            <option value="draft">draft</option>
                            <option value="active">active</option>
                            <option value="terminated">terminated</option>
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => navigate(`/assets/${id}/contract/${contract.id}`)}
                              className={`text-xs px-2 py-1 rounded font-medium cursor-pointer inline-flex items-center gap-1 ${
                                isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                              } transition-colors`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                              View PDF
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete the MSA with ${contract.counterparty}?`)) deleteContract(contract.id);
                              }}
                              className={`text-xs px-2 py-1 rounded font-medium cursor-pointer text-red-400 ${isDark ? "hover:bg-red-500/10" : "hover:bg-red-50"} transition-colors`}
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {addingContract && (
                      <tr className={`border-t ${rowBorder} ${isDark ? "bg-white/[0.02]" : "bg-blue-50/40"}`}>
                        <td className="px-3 py-2">
                          <input
                            value={contractForm.counterparty}
                            onChange={(e) => setContractForm({ ...contractForm, counterparty: e.target.value })}
                            placeholder="Counterparty (e.g. Acme Holdings, LLC)"
                            autoFocus
                            className={cellInputCls}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={contractForm.fee}
                            onChange={(e) => setContractForm({ ...contractForm, fee: e.target.value })}
                            placeholder="$500"
                            className={cellInputCls}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={contractForm.frequency}
                            onChange={(e) => setContractForm({ ...contractForm, frequency: e.target.value })}
                            className={cellInputCls}
                          >
                            <option value="Monthly">Monthly</option>
                            <option value="Quarterly">Quarterly</option>
                            <option value="Annually">Annually</option>
                            <option value="One-time">One-time</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={contractForm.effectiveDate}
                            onChange={(e) => setContractForm({ ...contractForm, effectiveDate: e.target.value })}
                            className={cellInputCls}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={contractForm.term}
                            onChange={(e) => setContractForm({ ...contractForm, term: e.target.value })}
                            placeholder="Annual, auto-renewing"
                            className={cellInputCls}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={contractForm.status}
                            onChange={(e) => setContractForm({ ...contractForm, status: e.target.value as "draft" | "active" | "terminated" })}
                            className={cellInputCls}
                          >
                            <option value="draft">draft</option>
                            <option value="active">active</option>
                            <option value="terminated">terminated</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={addContract}
                              disabled={!contractForm.counterparty.trim()}
                              className="text-xs px-2.5 py-1 rounded font-medium cursor-pointer bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-40"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setAddingContract(false)}
                              className={`text-xs px-2 py-1 ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} cursor-pointer`}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Documents */}
      <div>
        <h2 className="text-xl font-bold mb-4">Documents</h2>

        <form onSubmit={handleAddDoc} className="flex gap-2 mb-4 max-w-lg">
          <input
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Document name"
            required
            className={`flex-1 px-4 py-2 ${inputCls} text-sm`}
          />
          <input
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            placeholder="URL"
            type="url"
            required
            className={`flex-1 px-4 py-2 ${inputCls} text-sm`}
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
                className={`flex items-center justify-between p-3 ${cardCls} group`}
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
