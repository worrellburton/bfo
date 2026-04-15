import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Taxes" }];
}

type ReportRow = {
  label: string;
  values: string[];
  depth: number;
  bold?: boolean;
};

type Entity = { realm_id: string; company_name: string };

type ReportKind = "balance-sheet-detail" | "profit-loss-detail" | "trial-balance" | "general-ledger";

const REPORT_META: Record<
  ReportKind,
  { title: string; fileLabel: string; useDateRange: boolean }
> = {
  "balance-sheet-detail": { title: "Balance Sheet", fileLabel: "BalanceSheet", useDateRange: false },
  "profit-loss-detail": { title: "Profit & Loss", fileLabel: "ProfitLoss", useDateRange: true },
  "trial-balance": { title: "Trial Balance", fileLabel: "TrialBalance", useDateRange: false },
  "general-ledger": { title: "General Ledger", fileLabel: "GeneralLedger", useDateRange: true },
};

const YEARS = [2024, 2025];
const REPORTS: ReportKind[] = [
  "balance-sheet-detail",
  "profit-loss-detail",
  "trial-balance",
  "general-ledger",
];

function safeFilename(s: string) {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseReport(data: any): { title: string; columns: string[]; rows: ReportRow[] } {
  if (!data?.Header) return { title: "", columns: [], rows: [] };
  const title = data.Header.ReportName || "";
  const columns = (data.Columns?.Column || []).slice(1).map((c: any) => c.ColTitle || "");
  const rows: ReportRow[] = [];

  function walkRows(rowData: any[], depth: number) {
    if (!rowData) return;
    for (const row of rowData) {
      if (row.Header?.ColData) {
        rows.push({
          label: row.Header.ColData[0]?.value || "",
          values: row.Header.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
          bold: true,
        });
      }
      if (row.Rows?.Row) walkRows(row.Rows.Row, depth + 1);
      if (row.ColData) {
        rows.push({
          label: row.ColData[0]?.value || "",
          values: row.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
        });
      }
      if (row.Summary?.ColData) {
        rows.push({
          label: row.Summary.ColData[0]?.value || "",
          values: row.Summary.ColData.slice(1).map((c: any) => c.value || ""),
          depth,
          bold: true,
        });
      }
    }
  }

  walkRows(data.Rows?.Row || [], 0);
  return { title, columns, rows };
}

async function fetchReport(kind: ReportKind, year: number, realmId: string) {
  const realmParam = `&realm_id=${encodeURIComponent(realmId)}`;
  const meta = REPORT_META[kind];
  let url: string;
  if (meta.useDateRange) {
    url = `/api/quickbooks/data?report=${kind}&start_date=${year}-01-01&end_date=${year}-12-31${realmParam}`;
  } else {
    url = `/api/quickbooks/data?report=${kind}&as_of=${year}-12-31${realmParam}`;
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data?.error) throw new Error(`${kind} ${year}: ${data.error}`);
  return parseReport(data);
}

async function renderPdf(
  entity: Entity,
  kind: ReportKind,
  year: number,
  report: { title: string; columns: string[]; rows: ReportRow[] },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 40;
  const mr = pw - 40;
  const tw = mr - ml;

  // Header
  function drawHeader(pageNum: number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setCharSpace(2);
    doc.setTextColor(0, 0, 0);
    doc.text("B F O", ml, 32);
    doc.setCharSpace(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setCharSpace(1.2);
    doc.setTextColor(120, 120, 120);
    doc.text("BURTON FAMILY OFFICE", ml + 38, 32);
    doc.setCharSpace(0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${pageNum}`, mr, 32, { align: "right" });
    doc.setTextColor(0, 0, 0);

    // Hairline
    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.line(ml, 40, mr, 40);
  }

  function drawFooter() {
    const fy = ph - 24;
    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.line(ml, fy - 10, mr, fy - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(1.2);
    doc.setTextColor(120, 120, 120);
    const displayName = entity.company_name?.trim() || `Entity ${entity.realm_id}`;
    doc.text(
      `${displayName.toUpperCase()}   /   ${REPORT_META[kind].title.toUpperCase()}   /   FY${year}`,
      pw / 2,
      fy,
      { align: "center" },
    );
    doc.setCharSpace(0);
    doc.setTextColor(0, 0, 0);
  }

  let pageNum = 1;
  drawHeader(pageNum);
  drawFooter();

  let y = 64;

  // Title block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(report.title || REPORT_META[kind].title, ml, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(entity.company_name?.trim() || `Entity ${entity.realm_id}`, ml, y);
  y += 12;
  const period = REPORT_META[kind].useDateRange
    ? `For the year ended December 31, ${year}`
    : `As of December 31, ${year}`;
  doc.text(period, ml, y);
  y += 20;
  doc.setTextColor(0, 0, 0);

  // Table layout
  const labelWidth = Math.min(260, tw * 0.5);
  const colCount = Math.max(1, report.columns.length);
  const valueWidth = (tw - labelWidth) / colCount;

  // Column headers
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setCharSpace(1.0);
  doc.setTextColor(0, 0, 0);
  doc.text("ACCOUNT", ml, y);
  report.columns.forEach((col, i) => {
    doc.text(
      (col || "").toUpperCase(),
      ml + labelWidth + valueWidth * (i + 1) - 4,
      y,
      { align: "right" },
    );
  });
  doc.setCharSpace(0);
  y += 4;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(ml, y, mr, y);
  y += 10;

  // Rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const rowH = 12;

  for (const row of report.rows) {
    if (y > ph - 60) {
      doc.addPage();
      pageNum += 1;
      drawHeader(pageNum);
      drawFooter();
      y = 64;
    }
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    const indent = Math.min(row.depth, 6) * 10;
    const label = row.label || "";
    const labelLines = doc.splitTextToSize(label, labelWidth - indent - 4);
    doc.text(labelLines[0] || "", ml + indent, y);
    // Values
    row.values.forEach((v, i) => {
      if (i >= colCount) return;
      const text = v || "";
      doc.text(text, ml + labelWidth + valueWidth * (i + 1) - 4, y, { align: "right" });
    });
    y += rowH;
    // Underline separator for bold summary rows
    if (row.bold && row.values.some((v) => v)) {
      doc.setDrawColor(160, 160, 160);
      doc.setLineWidth(0.25);
      doc.line(ml + labelWidth, y - 10, mr, y - 10);
    }
  }

  return doc.output("blob");
}

export default function Taxes() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(true);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set(YEARS));
  const [selectedReports, setSelectedReports] = useState<Set<ReportKind>>(new Set(REPORTS));

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/quickbooks/data?report=list");
        const data = await res.json();
        if (data?.error) {
          setEntitiesError(
            data.error === "not_connected"
              ? "QuickBooks is not connected. Connect at least one company in Finance first."
              : data.error,
          );
          return;
        }
        const list: Entity[] = (data?.companies || []).filter(
          (e: Entity) => e.realm_id && !e.realm_id.startsWith("__"),
        );
        setEntities(list);
        setSelectedEntities(new Set(list.map((e) => e.realm_id)));
      } catch (err: any) {
        setEntitiesError(err?.message || "Failed to load entities");
      } finally {
        setLoadingEntities(false);
      }
    })();
  }, []);

  function toggleEntity(id: string) {
    setSelectedEntities((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleYear(y: number) {
    setSelectedYears((s) => {
      const next = new Set(s);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }
  function toggleReport(r: ReportKind) {
    setSelectedReports((s) => {
      const next = new Set(s);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  const selectedEntityList = entities.filter((e) => selectedEntities.has(e.realm_id));
  const totalJobs = selectedEntityList.length * selectedYears.size * selectedReports.size;

  async function handleExport() {
    if (totalJobs === 0) return;
    setExporting(true);
    setErrors([]);
    setProgress({ done: 0, total: totalJobs, message: "Preparing…" });

    try {
      const [{ default: JSZip }] = await Promise.all([import("jszip")]);
      const zip = new JSZip();
      const root = zip.folder("BFO-Tax-Package") as any;

      let done = 0;
      const failures: string[] = [];

      for (const entity of selectedEntityList) {
        const displayName = entity.company_name?.trim() || `Entity_${entity.realm_id}`;
        const folderSlug =
          safeFilename(entity.company_name) || `Entity_${entity.realm_id}`;
        const entityFolder = root.folder(folderSlug) as any;
        for (const year of selectedYears) {
          const yearFolder = entityFolder.folder(`FY${year}`) as any;
          for (const kind of selectedReports) {
            const meta = REPORT_META[kind];
            setProgress({
              done,
              total: totalJobs,
              message: `${displayName} — ${meta.title} FY${year}`,
            });
            try {
              const report = await fetchReport(kind, year, entity.realm_id);
              const blob = await renderPdf(entity, kind, year, report);
              const filename = `BFO_${folderSlug}_${meta.fileLabel}_FY${year}.pdf`;
              yearFolder.file(filename, blob);
            } catch (err: any) {
              failures.push(
                `${displayName} — ${meta.title} FY${year}: ${err?.message || "failed"}`,
              );
            } finally {
              done += 1;
              setProgress({
                done,
                total: totalJobs,
                message: `${displayName} — ${meta.title} FY${year}`,
              });
            }
          }
        }
      }

      setProgress({ done, total: totalJobs, message: "Zipping package…" });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const ts = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `BFO_Tax_Package_BleichFleishman_${ts}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      setErrors(failures);
      setProgress({ done, total: totalJobs, message: "Done" });
    } catch (err: any) {
      setErrors([err?.message || "Export failed"]);
    } finally {
      setExporting(false);
    }
  }

  const cardCls = isDark
    ? "bg-white/[0.02] border border-white/10 rounded-xl"
    : "bg-white border border-gray-200 rounded-xl";
  const subtleText = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold">Taxes</h1>
      </div>
      <p className={`text-sm ${subtleText} mb-8`}>
        Central package for annual tax prep. Export a ZIP with every report your accountant needs.
      </p>

      {/* Accountant export card */}
      <div className={`${cardCls} p-6 mb-8`}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-50 text-blue-700"
              }`}>Accountant package</span>
            </div>
            <h2 className="text-lg font-bold">Export for Bleich Fleishman</h2>
            <p className={`text-xs mt-1 ${subtleText}`}>
              Bundles Balance Sheets, P&amp;L, Trial Balance and General Ledger for each entity and each
              selected fiscal year into a single ZIP of branded PDFs.
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || totalJobs === 0}
            className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors cursor-pointer inline-flex items-center gap-2 ${
              isDark
                ? "bg-white text-black hover:bg-gray-200 disabled:opacity-40"
                : "bg-black text-white hover:bg-gray-800 disabled:opacity-40"
            }`}
          >
            {exporting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" />
                </svg>
                Exporting…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export ZIP ({totalJobs} PDF{totalJobs === 1 ? "" : "s"})
              </>
            )}
          </button>
        </div>

        {/* Selectors grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Years */}
          <div>
            <p className={`text-[10px] uppercase tracking-wider mb-2 ${subtleText}`}>Fiscal years</p>
            <div className="flex flex-wrap gap-1.5">
              {YEARS.map((y) => {
                const on = selectedYears.has(y);
                return (
                  <button
                    key={y}
                    onClick={() => toggleYear(y)}
                    disabled={exporting}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                      on
                        ? isDark ? "bg-blue-500/20 border-blue-400/50 text-blue-300" : "bg-blue-50 border-blue-400 text-blue-700"
                        : isDark ? "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200" : "bg-white border-gray-300 text-gray-500 hover:text-gray-800"
                    } disabled:opacity-50`}
                  >
                    {on ? "✓ " : ""}FY{y}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reports */}
          <div>
            <p className={`text-[10px] uppercase tracking-wider mb-2 ${subtleText}`}>Reports</p>
            <div className="flex flex-wrap gap-1.5">
              {REPORTS.map((r) => {
                const on = selectedReports.has(r);
                return (
                  <button
                    key={r}
                    onClick={() => toggleReport(r)}
                    disabled={exporting}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                      on
                        ? isDark ? "bg-blue-500/20 border-blue-400/50 text-blue-300" : "bg-blue-50 border-blue-400 text-blue-700"
                        : isDark ? "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200" : "bg-white border-gray-300 text-gray-500 hover:text-gray-800"
                    } disabled:opacity-50`}
                  >
                    {on ? "✓ " : ""}{REPORT_META[r].title}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Entities */}
          <div>
            <p className={`text-[10px] uppercase tracking-wider mb-2 ${subtleText}`}>
              Entities
              {entities.length > 0 && (
                <button
                  onClick={() =>
                    setSelectedEntities(
                      selectedEntities.size === entities.length
                        ? new Set()
                        : new Set(entities.map((e) => e.realm_id)),
                    )
                  }
                  className={`ml-2 text-[10px] ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"} cursor-pointer normal-case tracking-normal`}
                >
                  {selectedEntities.size === entities.length ? "clear" : "select all"}
                </button>
              )}
            </p>
            {loadingEntities ? (
              <p className={`text-xs ${subtleText}`}>Loading…</p>
            ) : entitiesError ? (
              <p className="text-xs text-red-500">{entitiesError}</p>
            ) : entities.length === 0 ? (
              <p className={`text-xs ${subtleText}`}>
                No connected QuickBooks companies.{" "}
                <Link to="/tools/quickbooks" className={isDark ? "text-blue-400" : "text-blue-600"}>
                  Connect one
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {entities.map((e) => {
                  const on = selectedEntities.has(e.realm_id);
                  return (
                    <button
                      key={e.realm_id}
                      onClick={() => toggleEntity(e.realm_id)}
                      disabled={exporting}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
                        on
                          ? isDark ? "bg-blue-500/20 border-blue-400/50 text-blue-300" : "bg-blue-50 border-blue-400 text-blue-700"
                          : isDark ? "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200" : "bg-white border-gray-300 text-gray-500 hover:text-gray-800"
                      } disabled:opacity-50`}
                    >
                      {on ? "✓ " : ""}{e.company_name?.trim() || `Entity ${e.realm_id}`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Progress */}
        {progress && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs">{progress.message}</p>
              <p className={`text-xs tabular-nums ${subtleText}`}>
                {progress.done} / {progress.total}
              </p>
            </div>
            <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
              <div
                className={`h-full transition-all ${isDark ? "bg-blue-400" : "bg-blue-500"}`}
                style={{ width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className={`mt-4 p-3 rounded-lg text-xs ${isDark ? "bg-red-500/10 border border-red-500/20 text-red-300" : "bg-red-50 border border-red-200 text-red-700"}`}>
            <p className="font-semibold mb-1">Completed with {errors.length} issue{errors.length === 1 ? "" : "s"}:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Contents preview */}
      <div className={`${cardCls} p-5`}>
        <h3 className="text-sm font-bold mb-3">What&rsquo;s in the package</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {REPORTS.map((r) => (
            <div key={r} className="flex items-start gap-2">
              <svg className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isDark ? "text-green-400" : "text-green-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-semibold">{REPORT_META[r].title}</p>
                <p className={subtleText}>
                  {REPORT_META[r].useDateRange
                    ? "Jan 1 – Dec 31 of each selected year"
                    : "As of Dec 31 of each selected year"}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className={`text-[11px] mt-4 ${subtleText}`}>
          Folder structure: <code>BFO-Tax-Package / &lt;Entity&gt; / FY&lt;Year&gt; / &lt;Report&gt;.pdf</code>
        </p>
      </div>
    </div>
  );
}
