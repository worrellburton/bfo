import { useEffect, useState } from "react";
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
  referralCredit?: boolean;
  letterhead?: "bfo" | "robert";
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
  const [brand, setBrand] = useState<"bfo" | "robert">("bfo");
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

  // Seed the letterhead toggle from the contract's saved choice
  useEffect(() => {
    if (contract) setBrand(contract.letterhead ?? "bfo");
  }, [contract?.letterhead]);

  // Generate PDF once data is loaded
  useEffect(() => {
    if (!asset || !contract) return;

    (async () => {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const ml = 78;
      const mr = pw - 78;
      const tw = mr - ml;

      // Editorial palette — warm ink on ivory
      const ink: [number, number, number] = [34, 30, 26];
      const muted: [number, number, number] = [148, 140, 128];
      const paper: [number, number, number] = [250, 248, 242];

      const topY = 116;
      const bottomLimit = ph - 84;
      let y = topY;
      let pageNum = 1;

      // Manager (Ledger Louise) is a Nevada LLC d/b/a Burton Family Office;
      // reconcile the party block, governing law, venue, and signatory to the
      // Nevada operating agreement when Ledger Louise is the Manager.
      const isLedgerLouise = String(asset.name).toLowerCase().includes("ledger louise");
      const managerState = isLedgerLouise ? "Nevada" : asset.state || "Arizona";
      const dba = isLedgerLouise ? " doing business as Burton Family Office" : "";
      const officeSentence = isLedgerLouise
        ? "Manager's principal office is 401 Ryland Street, Suite 200-A, Reno, NV 89502; its notice address is 11201 N Tatum Blvd, Ste 300, PMB 44879, Phoenix, AZ 85028."
        : "Manager's notice address is 11201 N Tatum Blvd, Ste 300, PMB 44879, Phoenix, AZ 85028.";
      const venue = isLedgerLouise
        ? "the state or federal courts located in Washoe County, Nevada"
        : `the state or federal courts located in ${managerState}`;

      // Letterhead identity — toggled in the UI: present as BFO or Robert Burton
      const isRobert = brand === "robert";
      const wordmark = isRobert ? "Robert Burton" : "BFO";
      const brandLine = isRobert ? "ROBERT BURTON" : "BURTON FAMILY OFFICE";

      function paintPage() {
        doc.setFillColor(...paper);
        doc.rect(0, 0, pw, ph, "F");
      }

      function header() {
        doc.setTextColor(...ink);
        doc.setFont("times", "bold");
        doc.setFontSize(13);
        doc.text(wordmark, ml, 60);
        const wmW = doc.getTextWidth(wordmark);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setCharSpace(2);
        doc.setTextColor(...muted);
        doc.text("MANAGEMENT SERVICES AGREEMENT", ml + wmW + 10, 60);
        doc.text(String(pageNum).padStart(2, "0"), mr, 60, { align: "right" });
        doc.setCharSpace(0);
        doc.setDrawColor(...ink);
        doc.setLineWidth(0.5);
        doc.line(ml, 74, mr, 74);
        doc.setTextColor(...ink);
      }

      function footer() {
        const fy = ph - 50;
        doc.setDrawColor(...ink);
        doc.setLineWidth(0.5);
        doc.line(ml, fy, mr, fy);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setCharSpace(1.4);
        doc.setTextColor(...muted);
        doc.text(`${String(asset.name).toUpperCase()}  ·  ${String(contract.counterparty).toUpperCase()}`, ml, fy + 14);
        doc.text(brandLine, mr, fy + 14, { align: "right" });
        doc.setCharSpace(0);
        doc.setTextColor(...ink);
      }

      function newPage() {
        doc.addPage();
        pageNum += 1;
        paintPage();
        header();
        footer();
        y = topY;
      }

      function ensure(space: number) {
        if (y + space > bottomLimit) newPage();
      }

      // Tracked uppercase section kicker with a hairline rule beneath
      function kicker(text: string) {
        ensure(48);
        y += 10;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setCharSpace(1.6);
        doc.setTextColor(...ink);
        doc.text(text.toUpperCase(), ml, y);
        doc.setCharSpace(0);
        y += 9;
        doc.setDrawColor(...ink);
        doc.setLineWidth(0.5);
        doc.line(ml, y, mr, y);
        y += 18;
      }

      // Serif body paragraph
      function body(text: string, opts?: { indent?: number; size?: number }) {
        const size = opts?.size ?? 10.5;
        const indent = opts?.indent ?? 0;
        const lead = size * 1.6;
        doc.setFont("times", "normal");
        doc.setFontSize(size);
        doc.setTextColor(...ink);
        const lines = doc.splitTextToSize(text, tw - indent);
        for (const line of lines) {
          ensure(lead);
          doc.text(line, ml + indent, y);
          y += lead;
        }
      }

      function gap(n = 10) { y += n; }

      // ── Page 1 ───────────────────────────────────────────────
      paintPage();
      header();
      footer();

      // Title block — tracked kicker + serif display title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setCharSpace(2);
      doc.setTextColor(...muted);
      doc.text("SERVICE AGREEMENT", ml, y);
      doc.setCharSpace(0);
      y += 32;

      doc.setFont("times", "bold");
      doc.setTextColor(...ink);
      let titleSize = 30;
      doc.setFontSize(titleSize);
      while (titleSize > 16 && doc.getTextWidth("Management Services Agreement") > tw) {
        titleSize -= 1;
        doc.setFontSize(titleSize);
      }
      doc.text("Management Services Agreement", ml, y);
      y += 28;

      doc.setFont("times", "italic");
      doc.setFontSize(12);
      doc.setTextColor(...muted);
      doc.text(`${asset.name}  &  ${contract.counterparty}`, ml, y);
      y += 16;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setCharSpace(1.3);
      doc.text(
        `EFFECTIVE ${String(contract.effectiveDate).toUpperCase()}     ${String(contract.fee).toUpperCase()} / ${String(contract.frequency).toUpperCase()}     TERM ${String(contract.term).toUpperCase()}`,
        ml, y
      );
      doc.setCharSpace(0);
      y += 14;
      doc.setDrawColor(...ink);
      doc.setLineWidth(1.4);
      doc.line(ml, y, mr, y);
      doc.setLineWidth(0.5);
      y += 30;

      // Recitals — drop-cap opening paragraph
      const recital = `This Management Services Agreement ("Agreement") is made and entered into as of ${contract.effectiveDate} (the "Effective Date") by and between ${asset.name}, a ${managerState} limited liability company${dba} ("Manager"), and ${contract.counterparty} ("Client"). ${officeSentence} Manager is engaged in the business of providing management, administrative, and advisory services to affiliated entities, and Client desires to retain Manager to provide the services described herein. In consideration of the mutual covenants set forth below, the parties agree as follows.`;

      {
        ensure(90);
        const cap = recital.charAt(0);
        const rest = recital.slice(1).replace(/^\s+/, "");
        doc.setFont("times", "bold");
        doc.setFontSize(38);
        doc.setTextColor(...ink);
        const capW = doc.getTextWidth(cap) + 8;
        doc.text(cap, ml, y + 27);
        doc.setFont("times", "normal");
        doc.setFontSize(10.5);
        const lead = 10.5 * 1.6;
        const narrow = doc.splitTextToSize(rest, tw - capW);
        const head = narrow.slice(0, 3);
        for (let i = 0; i < head.length; i++) {
          doc.text(head[i], ml + capW, y + (i + 1) * lead);
        }
        let yy = y + Math.max(head.length, 1) * lead;
        const leftover = narrow.slice(3).join(" ");
        if (leftover) {
          const wide = doc.splitTextToSize(leftover, tw);
          for (const line of wide) {
            yy += lead;
            doc.text(line, ml, yy);
          }
        }
        y = yy + 16;
      }

      // ── Articles ─────────────────────────────────────────────
      kicker("Article I · Scope of Services");
      body("1.1  Manager shall provide the following services to Client:");
      gap(6);
      contract.services.forEach((s: string) => {
        body(`—   ${s}`, { indent: 16 });
      });
      gap(6);
      body("1.2  Manager shall perform the Services in a professional and workmanlike manner consistent with generally accepted industry standards.");

      kicker("Article II · Compensation");
      body(`2.1  Client shall pay Manager a management fee of ${contract.fee} per ${contract.frequency.toLowerCase()} (the "Management Fee") for services rendered under this Agreement.`);
      gap(6);
      body("2.2  Payment shall be due within thirty (30) days following the end of each billing period.");
      if (contract.referralCredit) {
        gap(6);
        body("2.3  Referral Credit. If Client refers a prospective client to Manager and such referral results in an executed engagement between Manager and the referred party, Manager shall credit the referral fee otherwise payable in respect of that referral against Client’s Management Fee, in lieu of any cash payment. The credit shall be applied to successive Management Fee invoices until the full amount of the referral fee has been exhausted. By way of illustration, if Client’s Management Fee is $5,000 per month and a qualifying referral generates a $10,000 referral fee, Manager shall waive Client’s Management Fee for the period(s) necessary to apply the full $10,000 credit (e.g., two (2) months), after which the Management Fee shall resume.");
      }

      kicker("Article III · Term and Termination");
      const autoRenew = String(contract.term || "").toLowerCase().includes("auto-renew");
      body(autoRenew
        ? "3.1  This Agreement shall commence on the Effective Date and shall continue for an initial term of one (1) year (the \"Initial Term\"), and shall automatically renew for successive periods of equal duration unless either party provides written notice of non-renewal at least thirty (30) days prior to the expiration of the then-current term."
        : "3.1  This Agreement shall commence on the Effective Date and shall continue for an initial term of one (1) year (the \"Initial Term\"). This Agreement shall not automatically renew; any renewal shall require the written agreement of both parties prior to the expiration of the Initial Term.");
      gap(6);
      body("3.2  Either party may terminate this Agreement for cause upon thirty (30) days’ written notice to the other party specifying the nature of the breach, provided that the breaching party fails to cure such breach within such thirty-day period.");
      gap(6);
      body("3.3  Upon termination, Manager shall deliver to Client all documents, records, and materials relating to Client’s business within fifteen (15) business days.");

      kicker("Article IV · Confidentiality");
      body("4.1  Each party acknowledges that in the course of performing its obligations under this Agreement, it may receive or have access to confidential and proprietary information of the other party. Each party agrees to maintain the confidentiality of such information and not to disclose it to any third party without the prior written consent of the disclosing party.");

      kicker("Article V · Indemnification");
      body("5.1  Each party shall indemnify, defend, and hold harmless the other party from and against any and all claims, damages, losses, and expenses arising out of or resulting from any breach of this Agreement or any negligent or wrongful act or omission of the indemnifying party.");

      kicker("Article VI · Governing Law");
      body(`6.1  This Agreement shall be governed by and construed in accordance with the laws of the State of ${managerState}, without regard to its conflict of law provisions.`);
      gap(6);
      body(`6.2  Any dispute arising under this Agreement shall be resolved in ${venue}.`);

      kicker("Article VII · Miscellaneous");
      body("7.1  This Agreement constitutes the entire agreement between the parties and supersedes all prior agreements and understandings, whether written or oral.");
      gap(6);
      body("7.2  This Agreement may not be amended or modified except by a written instrument signed by both parties.");
      gap(6);
      body("7.3  Neither party may assign this Agreement without the prior written consent of the other party.");

      // ── Signature block ──────────────────────────────────────
      ensure(190);
      gap(24);
      doc.setFont("times", "italic");
      doc.setFontSize(10.5);
      doc.setTextColor(...ink);
      {
        const lines = doc.splitTextToSize(
          "IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.",
          tw
        );
        for (const line of lines) {
          doc.text(line, ml, y);
          y += 10.5 * 1.6;
        }
      }
      gap(26);

      const colW = 220;
      const leftX = ml;
      const rightX = mr - colW;
      const rowY = y;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setCharSpace(1.4);
      doc.setTextColor(...muted);
      doc.text("MANAGER", leftX, rowY);
      doc.text("CLIENT", rightX, rowY);
      doc.setCharSpace(0);

      doc.setFont("times", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...ink);
      doc.text(asset.name, leftX, rowY + 18);
      doc.text(contract.counterparty, rightX, rowY + 18);
      if (isLedgerLouise) {
        doc.setFont("times", "italic");
        doc.setFontSize(9);
        doc.setTextColor(...muted);
        doc.text("d/b/a Burton Family Office", leftX, rowY + 32);
        doc.setTextColor(...ink);
      }

      const sigLineY = rowY + 68;
      doc.setDrawColor(...ink);
      doc.setLineWidth(0.5);
      doc.line(leftX, sigLineY, leftX + colW - 20, sigLineY);
      doc.line(rightX, sigLineY, rightX + colW - 20, sigLineY);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setCharSpace(1.4);
      doc.setTextColor(...muted);
      doc.text("AUTHORIZED SIGNATURE", leftX, sigLineY + 11);
      doc.text("AUTHORIZED SIGNATURE", rightX, sigLineY + 11);
      doc.setCharSpace(0);

      doc.setFont("times", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...ink);
      // Manager side is pre-filled from the operating agreement (executed by
      // Robert W. Burton, Manager). Client side stays blank for fill-in.
      const managerFill = isLedgerLouise ? ["Robert W. Burton", "Manager", ""] : ["", "", ""];
      ["Name:", "Title:", "Date:"].forEach((f, i) => {
        const fyy = sigLineY + 30 + i * 16;
        doc.setFont("times", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...ink);
        doc.text(f, leftX, fyy);
        doc.text(f, rightX, fyy);
        doc.setDrawColor(...muted);
        doc.setLineWidth(0.4);
        doc.line(leftX + 30, fyy + 1, leftX + colW - 20, fyy + 1);
        doc.line(rightX + 30, fyy + 1, rightX + colW - 20, fyy + 1);
        if (managerFill[i]) {
          doc.text(managerFill[i], leftX + 34, fyy - 1);
        }
      });

      doc.setTextColor(...ink);
      doc.setDrawColor(...ink);
      doc.setLineWidth(0.5);

      // Convert to blob URL for embedding
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    })();
  }, [asset, contract, brand]);

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
          <div className={`flex rounded-lg overflow-hidden border mr-1 ${isDark ? "border-white/10" : "border-gray-200"}`}>
            <button
              onClick={() => setBrand("bfo")}
              title="Present the document as Burton Family Office"
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${brand === "bfo" ? (isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900") : (isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}`}
            >
              BFO
            </button>
            <button
              onClick={() => setBrand("robert")}
              title="Present the document as Robert Burton"
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${brand === "robert" ? (isDark ? "bg-white/10 text-white" : "bg-black/10 text-gray-900") : (isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}`}
            >
              Robert Burton
            </button>
          </div>
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
