import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
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

const AVAILABLE_SERVICES = [
  "Financial Management & Oversight",
  "Bookkeeping & Accounting",
  "Tax Coordination & Planning",
  "Bank Account Management",
  "AI & Technology Solutions",
  "Software Development & IT",
  "Digital Marketing & SEO",
  "Strategic Planning & Advisory",
  "Compliance & Regulatory Oversight",
  "HR & Payroll Administration",
  "Legal Coordination",
  "Insurance & Risk Management",
];

const LEDGER_LOUISE_SUBS = [
  "Swisshelm Mountain Ventures, LLC",
  "Sundown Investments, LLC",
  "Ledger Burton, LLC",
  "Worrell Burton, LLC",
];

export default function AssetDetail() {
  const { id } = useParams();
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
  const [expandedContract, setExpandedContract] = useState<string | null>(null);
  const [showNewContract, setShowNewContract] = useState(false);
  const [newCounterparty, setNewCounterparty] = useState("");
  const [newFee, setNewFee] = useState("$500");
  const [newFrequency, setNewFrequency] = useState<"Monthly" | "Quarterly" | "Annually">("Quarterly");
  const [newServices, setNewServices] = useState<string[]>([]);
  const [newEffectiveDate, setNewEffectiveDate] = useState(new Date().toISOString().split("T")[0]);

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
        services: AVAILABLE_SERVICES,
        fee: "$500",
        frequency: "Quarterly",
        effectiveDate: "2025-01-01",
        term: "Annual, auto-renewing",
        status: "draft",
        createdAt: Date.now(),
      });
    }
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

  async function createContract(e: React.FormEvent) {
    e.preventDefault();
    if (!newCounterparty.trim() || newServices.length === 0) return;
    const { db } = await import("../firebase");
    const { push, ref } = await import("firebase/database");
    await push(ref(db, `assets/${id}/contracts`), {
      counterparty: newCounterparty.trim(),
      role: "manager",
      services: newServices,
      fee: newFee.trim() || "$500",
      frequency: newFrequency,
      effectiveDate: newEffectiveDate,
      term: newFrequency === "Monthly" ? "Month-to-month" : "Annual, auto-renewing",
      status: "draft" as const,
      createdAt: Date.now(),
    });
    setNewCounterparty("");
    setNewFee("$500");
    setNewFrequency("Quarterly");
    setNewServices([]);
    setNewEffectiveDate(new Date().toISOString().split("T")[0]);
    setShowNewContract(false);
  }

  function toggleService(service: string) {
    setNewServices((prev) =>
      prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service]
    );
  }

  async function generatePDF(contract: OperatingContract) {
    if (!asset) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const pw = doc.internal.pageSize.getWidth();
    const ml = 72; // 1-inch margin
    const mr = pw - 72;
    const tw = mr - ml; // text width
    let y = 72;

    function addText(text: string, opts?: { bold?: boolean; size?: number; center?: boolean; indent?: number }) {
      const size = opts?.size || 10;
      doc.setFontSize(size);
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      const x = opts?.center ? pw / 2 : ml + (opts?.indent || 0);
      const align = opts?.center ? "center" : "left";
      const maxW = tw - (opts?.indent || 0);
      const lines = doc.splitTextToSize(text, maxW);
      for (const line of lines) {
        if (y > 700) { doc.addPage(); y = 72; }
        doc.text(line, x, y, { align });
        y += size * 1.4;
      }
    }

    function gap(n = 10) { y += n; }

    // Title
    addText("MANAGEMENT SERVICES AGREEMENT", { bold: true, size: 16, center: true });
    gap(20);

    // Preamble
    addText(`This Management Services Agreement ("Agreement") is made and entered into as of ${contract.effectiveDate} ("Effective Date"),`);
    gap();
    addText("BY AND BETWEEN:", { bold: true });
    gap(5);
    addText(`${asset.name} ("Manager")`);
    addText("11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", { indent: 20 });
    gap(5);
    addText("AND", { center: true });
    gap(5);
    addText(`${contract.counterparty} ("Client")`);
    addText("11201 N Tatum Blvd Ste 300, PMB 44879, Phoenix, AZ 85028", { indent: 20 });
    gap(15);

    // Recitals
    addText("RECITALS", { bold: true, size: 12 });
    gap(5);
    addText(`WHEREAS, Manager is engaged in the business of providing management, administrative, and advisory services to affiliated entities; and`);
    gap(5);
    addText(`WHEREAS, Client desires to retain Manager to provide certain management services as described herein; and`);
    gap(5);
    addText(`NOW, THEREFORE, in consideration of the mutual covenants and agreements set forth herein, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the parties agree as follows:`);
    gap(15);

    // Article I
    addText("ARTICLE I — SCOPE OF SERVICES", { bold: true, size: 12 });
    gap(5);
    addText("1.1  Manager shall provide the following services to Client:");
    gap(5);
    contract.services.forEach((s, i) => {
      addText(`     (${String.fromCharCode(97 + i)})  ${s}`, { indent: 20 });
    });
    gap(5);
    addText("1.2  Manager shall perform the Services in a professional and workmanlike manner consistent with generally accepted industry standards.");
    gap(15);

    // Article II
    addText("ARTICLE II — COMPENSATION", { bold: true, size: 12 });
    gap(5);
    addText(`2.1  Client shall pay Manager a management fee of ${contract.fee} per ${contract.frequency.toLowerCase()} ("Management Fee") for services rendered under this Agreement.`);
    gap(5);
    addText("2.2  Payment shall be due within thirty (30) days following the end of each billing period. Late payments shall accrue interest at the rate of 1.5% per month.");
    gap(5);
    addText("2.3  Manager shall be entitled to reimbursement for all reasonable out-of-pocket expenses incurred in connection with the performance of the Services, subject to prior written approval by Client for any single expense exceeding $500.");
    gap(15);

    // Article III
    addText("ARTICLE III — TERM AND TERMINATION", { bold: true, size: 12 });
    gap(5);
    addText(`3.1  This Agreement shall commence on the Effective Date and shall continue for an initial term of one (1) year ("Initial Term"), and shall automatically renew for successive periods of equal duration unless either party provides written notice of non-renewal at least thirty (30) days prior to the expiration of the then-current term.`);
    gap(5);
    addText("3.2  Either party may terminate this Agreement for cause upon thirty (30) days' written notice to the other party specifying the nature of the breach, provided that the breaching party fails to cure such breach within such thirty-day period.");
    gap(5);
    addText("3.3  Upon termination, Manager shall deliver to Client all documents, records, and materials relating to Client's business within fifteen (15) business days.");
    gap(15);

    // Article IV
    addText("ARTICLE IV — CONFIDENTIALITY", { bold: true, size: 12 });
    gap(5);
    addText("4.1  Each party acknowledges that in the course of performing its obligations under this Agreement, it may receive or have access to confidential and proprietary information of the other party. Each party agrees to maintain the confidentiality of such information and not to disclose it to any third party without the prior written consent of the disclosing party.");
    gap(15);

    // Article V
    addText("ARTICLE V — INDEMNIFICATION", { bold: true, size: 12 });
    gap(5);
    addText("5.1  Each party shall indemnify, defend, and hold harmless the other party from and against any and all claims, damages, losses, and expenses arising out of or resulting from any breach of this Agreement or any negligent or wrongful act or omission of the indemnifying party.");
    gap(15);

    // Article VI
    addText("ARTICLE VI — GOVERNING LAW", { bold: true, size: 12 });
    gap(5);
    const state = asset.state || "Arizona";
    addText(`6.1  This Agreement shall be governed by and construed in accordance with the laws of the State of ${state}, without regard to its conflict of law provisions.`);
    gap(5);
    addText(`6.2  Any dispute arising under this Agreement shall be resolved in the state or federal courts located in Maricopa County, ${state}.`);
    gap(15);

    // Article VII
    addText("ARTICLE VII — MISCELLANEOUS", { bold: true, size: 12 });
    gap(5);
    addText("7.1  This Agreement constitutes the entire agreement between the parties and supersedes all prior agreements and understandings, whether written or oral.");
    gap(5);
    addText("7.2  This Agreement may not be amended or modified except by a written instrument signed by both parties.");
    gap(5);
    addText("7.3  Neither party may assign this Agreement without the prior written consent of the other party.");
    gap(25);

    // Signature block
    addText("IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.", { bold: true });
    gap(30);

    const sigY = y;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    // Left signature
    doc.line(ml, sigY, ml + 200, sigY);
    doc.text(asset.name, ml, sigY + 14);
    doc.text("Manager", ml, sigY + 28);
    doc.text("Date: _______________", ml, sigY + 48);

    // Right signature
    doc.line(mr - 200, sigY, mr, sigY);
    doc.text(contract.counterparty, mr - 200, sigY + 14);
    doc.text("Client", mr - 200, sigY + 28);
    doc.text("Date: _______________", mr - 200, sigY + 48);

    const fileName = `MSA_${asset.name.replace(/[^a-zA-Z0-9]/g, "_")}_${contract.counterparty.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    doc.save(fileName);
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
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-mono ${isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-700"} px-2 py-1 rounded`}>
              {asset.type}
            </span>
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
        <div className="grid grid-cols-2 gap-4 max-w-lg mb-10">
          {[
            ["EIN", asset.ein],
            ["Registered Agent", asset.registeredAgent],
            ["Address", asset.address],
            ["Formation Date", asset.formationDate],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className={`p-3 ${cardCls}`}>
                <p className="text-gray-500 text-xs tracking-wider">{label}</p>
                <p className="text-sm mt-1">{value}</p>
              </div>
            ) : null
          )}
          {asset.notes && (
            <div className={`col-span-2 p-3 ${cardCls}`}>
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
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Operating Contracts</h2>
          <div className="flex items-center gap-2">
            {asset.name.toLowerCase().includes("ledger louise") && contracts.length < LEDGER_LOUISE_SUBS.length && (
              <button
                onClick={generateMSATemplates}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer ${isDark ? "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10" : "bg-black/5 border-gray-200 text-gray-700 hover:bg-gray-100"} border`}
              >
                Generate Templates
              </button>
            )}
            <button
              onClick={() => setShowNewContract(!showNewContract)}
              className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm"
            >
              {showNewContract ? "Cancel" : "+ New Contract"}
            </button>
          </div>
        </div>

        {/* New Contract Form */}
        {showNewContract && (
          <form onSubmit={createContract} className={`mb-6 p-5 ${cardCls} max-w-2xl space-y-4`}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Counterparty</label>
                <input
                  value={newCounterparty}
                  onChange={(e) => setNewCounterparty(e.target.value)}
                  placeholder="Entity name"
                  required
                  className={`w-full px-3 py-2 text-sm ${inputCls}`}
                />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Fee</label>
                <input
                  value={newFee}
                  onChange={(e) => setNewFee(e.target.value)}
                  placeholder="$500"
                  className={`w-full px-3 py-2 text-sm ${inputCls}`}
                />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Frequency</label>
                <select
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value as typeof newFrequency)}
                  className={`w-full px-3 py-2 text-sm ${inputCls}`}
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annually">Annually</option>
                </select>
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Effective Date</label>
                <input
                  type="date"
                  value={newEffectiveDate}
                  onChange={(e) => setNewEffectiveDate(e.target.value)}
                  className={`w-full px-3 py-2 text-sm ${inputCls}`}
                />
              </div>
            </div>

            <div>
              <label className={`text-xs font-medium block mb-2 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Services</label>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_SERVICES.map((service) => (
                  <label
                    key={service}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                      newServices.includes(service)
                        ? isDark ? "bg-blue-500/15 text-blue-400 border border-blue-500/30" : "bg-blue-50 text-blue-700 border border-blue-300"
                        : isDark ? "bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10" : "bg-black/5 text-gray-600 border border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={newServices.includes(service)}
                      onChange={() => toggleService(service)}
                      className="sr-only"
                    />
                    <svg className={`w-3.5 h-3.5 flex-shrink-0 ${newServices.includes(service) ? "" : "opacity-30"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {newServices.includes(service) ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth={2} />
                      )}
                    </svg>
                    {service}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newCounterparty.trim() || newServices.length === 0}
                className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Contract
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewServices([...AVAILABLE_SERVICES]);
                }}
                className={`px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${isDark ? "text-gray-400 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}
              >
                Select All Services
              </button>
            </div>
          </form>
        )}

        {contracts.length === 0 && !showNewContract ? (
          <div className={`p-6 ${cardCls} text-center`}>
            <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>No operating contracts yet.</p>
            {asset.name.toLowerCase().includes("ledger louise") && (
              <button
                onClick={generateMSATemplates}
                className="mt-3 text-sm text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Generate MSA templates for subsidiaries
              </button>
            )}
          </div>
        ) : contracts.length > 0 && (
          <div className="space-y-3 max-w-3xl">
            {contracts.map((contract) => (
              <div key={contract.id} className={`${cardCls} overflow-hidden`}>
                {/* Contract header */}
                <button
                  onClick={() => setExpandedContract(expandedContract === contract.id ? null : contract.id)}
                  className={`w-full flex items-center justify-between p-4 text-left cursor-pointer transition-colors ${
                    isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <svg className={`w-4 h-4 transition-transform ${expandedContract === contract.id ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold">
                        MSA — {asset.name} &rarr; {contract.counterparty}
                      </p>
                      <p className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        {contract.fee}/{contract.frequency} &middot; {contract.services.length} services &middot; {contract.term}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    contract.status === "active"
                      ? "bg-green-500/20 text-green-400"
                      : contract.status === "terminated"
                      ? "bg-red-500/20 text-red-400"
                      : isDark ? "bg-white/10 text-gray-400" : "bg-gray-200 text-gray-600"
                  }`}>
                    {contract.status}
                  </span>
                </button>

                {/* Expanded details */}
                {expandedContract === contract.id && (
                  <div className={`px-4 pb-4 border-t ${isDark ? "border-white/5" : "border-gray-100"}`}>
                    <div className="pt-4 space-y-4">
                      {/* Contract preview */}
                      <div className={`p-4 rounded-lg text-xs leading-relaxed font-mono ${
                        isDark ? "bg-white/5 text-gray-300" : "bg-gray-50 text-gray-700"
                      }`}>
                        <p className="font-bold text-sm mb-3">MANAGEMENT SERVICES AGREEMENT</p>
                        <p className="mb-2">
                          Effective {contract.effectiveDate} between <span className="font-semibold">{asset.name}</span> (Manager) and <span className="font-semibold">{contract.counterparty}</span> (Client).
                        </p>
                        <p className="font-bold mb-1 mt-3">Services:</p>
                        <ul className="list-disc pl-5 space-y-0.5 mb-3">
                          {contract.services.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                        <p><span className="font-semibold">Fee:</span> {contract.fee} / {contract.frequency}</p>
                        <p><span className="font-semibold">Term:</span> {contract.term}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => generatePDF(contract)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                            isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          View as PDF
                        </button>
                        {contract.status === "draft" && (
                          <button
                            onClick={() => updateContractStatus(contract.id, "active")}
                            className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors cursor-pointer"
                          >
                            Activate
                          </button>
                        )}
                        {contract.status === "active" && (
                          <button
                            onClick={() => updateContractStatus(contract.id, "terminated")}
                            className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-colors cursor-pointer"
                          >
                            Terminate
                          </button>
                        )}
                        {contract.status === "terminated" && (
                          <button
                            onClick={() => updateContractStatus(contract.id, "active")}
                            className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors cursor-pointer"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          onClick={() => deleteContract(contract.id)}
                          className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
