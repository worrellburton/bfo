import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Contract PDF" }];
}

interface Asset {
  name: string;
  type: string;
  state: string;
}

interface OperatingContract {
  counterparty: string;
  role: string;
  services: string[];
  fee: string;
  frequency: string;
  effectiveDate: string;
  term: string;
  status: string;
}

interface SignatureRequest {
  id: string;
  email: string;
  signerName: string;
  status: "pending" | "signed" | "declined";
  sentAt: number;
  signedAt?: number;
}

export default function ContractPDF() {
  const { id, contractId } = useParams();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [asset, setAsset] = useState<Asset | null>(null);
  const [contract, setContract] = useState<OperatingContract | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pdfGenerated = useRef(false);
  const [sigRequests, setSigRequests] = useState<SignatureRequest[]>([]);
  const [showSigForm, setShowSigForm] = useState(false);
  const [sigEmail, setSigEmail] = useState("");
  const [sigName, setSigName] = useState("");
  const [sigSending, setSigSending] = useState(false);

  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    let unsub3: (() => void) | undefined;

    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");

      unsub1 = onValue(ref(db, `assets/${id}`), (snapshot) => {
        const data = snapshot.val();
        if (data) setAsset(data as Asset);
      });

      unsub2 = onValue(ref(db, `assets/${id}/contracts/${contractId}`), (snapshot) => {
        const data = snapshot.val();
        if (data) setContract(data as OperatingContract);
        setLoading(false);
      });

      unsub3 = onValue(ref(db, `assets/${id}/contracts/${contractId}/signatures`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([sigId, value]) => ({
            id: sigId,
            ...(value as Omit<SignatureRequest, "id">),
          }));
          arr.sort((a, b) => b.sentAt - a.sentAt);
          setSigRequests(arr);
        } else {
          setSigRequests([]);
        }
      });
    }

    setup();
    return () => {
      unsub1?.();
      unsub2?.();
      unsub3?.();
    };
  }, [id, contractId]);

  // Generate PDF once data is loaded
  useEffect(() => {
    if (!asset || !contract || pdfGenerated.current) return;
    pdfGenerated.current = true;

    (async () => {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const ml = 72;
      const mr = pw - 72;
      const tw = mr - ml;
      let y = 110; // leave room for branded header

      // BFO brand colors
      const brandNavy: [number, number, number] = [10, 23, 51];
      const brandAccent: [number, number, number] = [59, 130, 246];
      const brandMuted: [number, number, number] = [107, 114, 128];

      function drawBrandHeader() {
        // Navy band
        doc.setFillColor(...brandNavy);
        doc.rect(0, 0, pw, 56, "F");
        // Accent stripe
        doc.setFillColor(...brandAccent);
        doc.rect(0, 56, pw, 3, "F");
        // Wordmark
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text("BFO", ml, 36);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text("Burton Family Office", ml + 42, 36);
        // Document tag (right)
        doc.setFontSize(8);
        doc.setTextColor(200, 215, 240);
        doc.text("Management Services Agreement", mr, 30, { align: "right" });
        doc.text(`Effective ${contract.effectiveDate}`, mr, 42, { align: "right" });
        doc.setTextColor(0, 0, 0);
      }

      function drawBrandFooter(pageNum: number) {
        const fy = ph - 36;
        // Hairline rule
        doc.setDrawColor(...brandAccent);
        doc.setLineWidth(0.5);
        doc.line(ml, fy - 12, mr, fy - 12);
        doc.setDrawColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...brandMuted);
        doc.text("BFO — Burton Family Office", ml, fy);
        doc.text(`${asset.name} & ${contract.counterparty}`, pw / 2, fy, { align: "center" });
        doc.text(`Page ${pageNum}`, mr, fy, { align: "right" });
        doc.setTextColor(0, 0, 0);
      }

      drawBrandHeader();
      let pageNum = 1;
      drawBrandFooter(pageNum);

      function addText(text: string, opts?: { bold?: boolean; size?: number; center?: boolean; indent?: number; color?: [number, number, number] }) {
        const size = opts?.size || 10;
        doc.setFontSize(size);
        doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
        if (opts?.color) doc.setTextColor(...opts.color); else doc.setTextColor(0, 0, 0);
        const x = opts?.center ? pw / 2 : ml + (opts?.indent || 0);
        const align = opts?.center ? "center" : "left";
        const maxW = tw - (opts?.indent || 0);
        const lines = doc.splitTextToSize(text, maxW);
        for (const line of lines) {
          if (y > ph - 90) {
            doc.addPage();
            pageNum += 1;
            drawBrandHeader();
            drawBrandFooter(pageNum);
            y = 110;
          }
          doc.text(line, x, y, { align });
          y += size * 1.4;
        }
        doc.setTextColor(0, 0, 0);
      }

      function gap(n = 10) { y += n; }

      // Title
      addText("MANAGEMENT SERVICES AGREEMENT", { bold: true, size: 16, center: true, color: brandNavy });
      gap(8);
      // Brand-accent underline rule under title
      doc.setDrawColor(...brandAccent);
      doc.setLineWidth(1.2);
      doc.line(pw / 2 - 80, y, pw / 2 + 80, y);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
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
      addText("WHEREAS, Manager is engaged in the business of providing management, administrative, and advisory services to affiliated entities; and");
      gap(5);
      addText("WHEREAS, Client desires to retain Manager to provide certain management services as described herein; and");
      gap(5);
      addText("NOW, THEREFORE, in consideration of the mutual covenants and agreements set forth herein, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the parties agree as follows:");
      gap(15);

      // Article I
      addText("ARTICLE I — SCOPE OF SERVICES", { bold: true, size: 12 });
      gap(5);
      addText("1.1  Manager shall provide the following services to Client:");
      gap(5);
      contract.services.forEach((s: string, i: number) => {
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
      doc.line(ml, sigY, ml + 200, sigY);
      doc.text("Authorized Signature — Manager", ml, sigY + 15);
      doc.text(asset.name, ml, sigY + 30);

      doc.line(mr - 200, sigY, mr, sigY);
      doc.text("Authorized Signature — Client", mr - 200, sigY + 15);
      doc.text(contract.counterparty, mr - 200, sigY + 30);

      y = sigY + 50;
      doc.line(ml, y, ml + 200, y);
      doc.text("Date", ml, y + 15);
      doc.line(mr - 200, y, mr, y);
      doc.text("Date", mr - 200, y + 15);

      // Convert to blob URL for embedding
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    })();
  }, [asset, contract]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  function handleDownload() {
    if (!pdfUrl || !asset || !contract) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `MSA_${asset.name}_${contract.counterparty}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_");
    a.click();
  }

  async function handleSendSignatureRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!sigEmail.trim() || !sigName.trim()) return;
    setSigSending(true);
    try {
      const { db } = await import("../firebase");
      const { push, ref } = await import("firebase/database");
      await push(ref(db, `assets/${id}/contracts/${contractId}/signatures`), {
        email: sigEmail.trim(),
        signerName: sigName.trim(),
        status: "pending",
        sentAt: Date.now(),
      });
      setSigEmail("");
      setSigName("");
      setShowSigForm(false);
    } catch (err) {
      console.error("Signature request error:", err);
    } finally {
      setSigSending(false);
    }
  }

  async function updateSigStatus(sigId: string, status: "pending" | "signed" | "declined") {
    const { db } = await import("../firebase");
    const { ref, update } = await import("firebase/database");
    const updates: Record<string, unknown> = { status };
    if (status === "signed") updates.signedAt = Date.now();
    await update(ref(db, `assets/${id}/contracts/${contractId}/signatures/${sigId}`), updates);
  }

  async function removeSigRequest(sigId: string) {
    const { db } = await import("../firebase");
    const { ref, remove } = await import("firebase/database");
    await remove(ref(db, `assets/${id}/contracts/${contractId}/signatures/${sigId}`));
  }

  if (loading) {
    return <p className="text-gray-500">Loading...</p>;
  }

  if (!asset || !contract) {
    return (
      <div>
        <Link to={`/assets/${id}`} className={`${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm mb-4 inline-block`}>
          &larr; Back to Entity
        </Link>
        <p className="text-gray-500">Contract not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className={`flex items-center justify-between mb-4`}>
        <div className="flex items-center gap-4">
          <Link
            to={`/assets/${id}`}
            className={`${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} text-sm inline-flex items-center gap-1`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          <div>
            <h1 className="text-lg font-bold">MSA — {asset.name} &rarr; {contract.counterparty}</h1>
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              {contract.fee}/{contract.frequency} &middot; {contract.status}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSigForm(!showSigForm)}
            className={`px-4 py-2 font-medium rounded-lg transition-colors cursor-pointer text-sm inline-flex items-center gap-2 ${
              isDark ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Request Signature
          </button>
          <button
            onClick={handleDownload}
            disabled={!pdfUrl}
            className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm disabled:opacity-50 inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>

      {/* Signature request form */}
      {showSigForm && (
        <form
          onSubmit={handleSendSignatureRequest}
          className={`mb-4 p-4 rounded-lg border ${isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"}`}
        >
          <h3 className="text-sm font-semibold mb-3">Send for Signature</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className={`text-xs block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Signer Name</label>
              <input
                type="text"
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
                placeholder="Full name"
                required
                className={`w-full px-3 py-2 text-sm rounded-lg border ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-white border-gray-200 text-gray-900 focus:border-gray-400"} focus:outline-none`}
              />
            </div>
            <div className="flex-1">
              <label className={`text-xs block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>Email Address</label>
              <input
                type="email"
                value={sigEmail}
                onChange={(e) => setSigEmail(e.target.value)}
                placeholder="signer@email.com"
                required
                className={`w-full px-3 py-2 text-sm rounded-lg border ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-white border-gray-200 text-gray-900 focus:border-gray-400"} focus:outline-none`}
              />
            </div>
            <button
              type="submit"
              disabled={sigSending}
              className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer text-sm disabled:opacity-50 whitespace-nowrap"
            >
              {sigSending ? "Sending..." : "Send Request"}
            </button>
            <button
              type="button"
              onClick={() => setShowSigForm(false)}
              className={`px-3 py-2 text-sm ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"} cursor-pointer`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Signature requests list */}
      {sigRequests.length > 0 && (
        <div className={`mb-4 rounded-lg border overflow-hidden ${isDark ? "border-white/10" : "border-gray-200"}`}>
          <div className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${isDark ? "bg-white/[0.03] text-gray-400" : "bg-gray-50 text-gray-500"} border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
            Signature Requests
          </div>
          {sigRequests.map((sig) => (
            <div
              key={sig.id}
              className={`flex items-center justify-between px-4 py-3 border-b last:border-b-0 ${isDark ? "border-white/5" : "border-gray-100"} group`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  sig.status === "signed" ? "bg-green-400" : sig.status === "declined" ? "bg-red-400" : "bg-yellow-400"
                }`} />
                <div>
                  <p className="text-sm font-medium">{sig.signerName}</p>
                  <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>{sig.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded font-medium ${
                  sig.status === "signed"
                    ? "bg-green-500/20 text-green-400"
                    : sig.status === "declined"
                    ? "bg-red-500/20 text-red-400"
                    : isDark ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-50 text-yellow-700"
                }`}>
                  {sig.status}
                </span>
                <span className={`text-xs ${isDark ? "text-gray-600" : "text-gray-400"}`}>
                  {new Date(sig.sentAt).toLocaleDateString()}
                </span>
                {sig.status === "pending" && (
                  <button
                    onClick={() => updateSigStatus(sig.id, "signed")}
                    className="text-xs text-green-400 hover:text-green-300 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Mark Signed
                  </button>
                )}
                <button
                  onClick={() => removeSigRequest(sig.id)}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PDF Viewer */}
      {pdfUrl ? (
        <div className={`flex-1 rounded-lg overflow-hidden border ${isDark ? "border-white/10" : "border-gray-200"}`} style={{ minHeight: "700px" }}>
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            style={{ minHeight: "700px" }}
            title="Contract PDF"
          />
        </div>
      ) : (
        <div className={`flex-1 flex items-center justify-center rounded-lg border ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`} style={{ minHeight: "700px" }}>
          <p className="text-gray-500">Generating PDF...</p>
        </div>
      )}
    </div>
  );
}
