import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { confirmDialog } from "../confirm-dialog";
import { isOpen, PARTY_LABEL, STATUS_LABEL, signApi, when, type RequestStatus, type SignatureRequest } from "../sign/api";
import { usePoll } from "../sign/use-poll";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "Signatures · BFO" }];
}

type Filter = "all" | "waiting" | "signed" | "draft";

/**
 * Tools › Signatures: every document sent out for signature, as a sheet.
 * Drop a PDF to start a new one; open a row to place fields and send it.
 */
export default function ToolsSignatures() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [rows, setRows] = useState<SignatureRequest[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await signApi.list());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load signatures.");
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Statuses change as people sign; refresh while anything is still out.
  usePoll(load, 15000, (rows ?? []).some((r) => isOpen(r.status)));

  const t2 = isDark ? "text-gray-400" : "text-gray-600";
  const t3 = isDark ? "text-gray-500" : "text-gray-400";
  const card = `rounded-2xl border ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white glass-card"}`;
  const line = isDark ? "border-white/[0.06]" : "border-gray-100";

  const shown = useMemo(() => {
    const list = rows ?? [];
    if (filter === "waiting") return list.filter((r) => r.status === "sent" || r.status === "partial");
    if (filter === "signed") return list.filter((r) => r.status === "completed");
    if (filter === "draft") return list.filter((r) => r.status === "draft");
    return list;
  }, [rows, filter]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      all: list.length,
      waiting: list.filter((r) => r.status === "sent" || r.status === "partial").length,
      signed: list.filter((r) => r.status === "completed").length,
      draft: list.filter((r) => r.status === "draft").length,
    };
  }, [rows]);

  async function startFrom(file: File) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("Only PDFs can be sent for signature.");
      return;
    }
    setBusy("new");
    setError("");
    try {
      const title = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Document";
      const created = await signApi.act("create", { title, parties: [{ role: "Party A" }, { role: "Party B" }] });
      await signApi.attach(created.id, file);
      navigate(`/tools/signatures/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
      setBusy(null);
    }
  }

  async function act(r: SignatureRequest, action: "remind" | "send-copy" | "download" | "delete" | "void") {
    setBusy(r.id);
    setNote("");
    try {
      if (action === "download") {
        const url = await signApi.download(r.id);
        window.open(url, "_blank", "noopener");
      } else if (action === "delete") {
        if (!(await confirmDialog({ title: `Delete "${r.title}"?`, message: "The document and its signatures are removed for good.", tone: "danger", confirmLabel: "Delete" }))) return;
        await signApi.remove(r.id);
        setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
      } else {
        const next = await signApi.act(action, { id: r.id });
        setRows((cur) => (cur ?? []).map((x) => (x.id === next.id ? next : x)));
        setNote(action === "remind" ? `Reminded ${next.parties.filter((p) => p.status !== "signed").map((p) => p.name).join(" and ")}.` : action === "send-copy" ? `Sent the signed copy to ${next.parties.map((p) => p.name).join(" and ")}.` : "Voided.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] pb-16">
      <header className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${t3}`}>Tools</p>
          <h1 className="mt-1 text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px]">Signatures</h1>
          <p className={`mt-1 text-[12.5px] ${t2}`}>Everything sent out to be signed, who has signed, and the signed copies.</p>
        </div>
      </header>

      <DropZone isDark={isDark} busy={busy === "new"} onFile={startFrom} />

      {(error || note) && (
        <p role="status" className={`mt-3 text-[12.5px] ${error ? "text-red-400" : isDark ? "text-emerald-300" : "text-emerald-700"}`}>
          {error || note}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["all", "waiting", "signed", "draft"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors ${
              filter === f ? (isDark ? "bg-white text-black" : "bg-gray-900 text-white") : isDark ? "bg-white/[0.05] text-gray-300 hover:bg-white/10" : "bg-black/[0.04] text-gray-600 hover:bg-black/[0.08]"
            }`}
          >
            {f === "all" ? "All" : f === "waiting" ? "Waiting" : f === "signed" ? "Signed" : "Drafts"} {counts[f]}
          </button>
        ))}
      </div>

      <section className={`mt-3 overflow-hidden ${card}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-[12.5px]">
            <thead>
              <tr className={`text-left text-[11px] font-medium uppercase tracking-[0.12em] ${t3}`}>
                <th className="px-4 py-2.5 font-medium">Document</th>
                <th className="px-3 py-2.5 font-medium">Parties</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Sent</th>
                <th className="px-3 py-2.5 font-medium">Signed</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan={6} className={`px-4 py-8 text-center ${t3}`}>
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`px-4 py-10 text-center ${t3}`}>
                    {rows.length === 0 ? "Nothing sent for signature yet. Drop a PDF above, or open an MSA and request a signature." : "Nothing here."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className={`border-t ${line} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-3 align-top">
                      <Link to={`/tools/signatures/${r.id}`} className="block max-w-[320px] truncate font-medium hover:underline">
                        {r.title}
                      </Link>
                      <span className={`block text-[11.5px] ${t3}`}>
                        {r.source === "contract" ? "MSA" : "Uploaded"}
                        {r.asset_id ? (
                          <>
                            {" · "}
                            <Link to={`/assets/${r.asset_id}/agreements`} className="hover:underline">
                              entity
                            </Link>
                          </>
                        ) : null}
                        {r.created_by_name ? ` · by ${r.created_by_name}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {r.parties.length === 0 ? (
                        <span className={t3}>No parties yet</span>
                      ) : (
                        <ul className="space-y-1">
                          {r.parties.map((p) => (
                            <li key={p.key} className="flex items-center gap-2">
                              <PartyDot status={p.status} />
                              <span className="truncate">{p.name || <span className={t3}>{p.role}</span>}</span>
                              <span className={`text-[11px] ${t3}`}>{PARTY_LABEL[p.status]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusChip status={r.status} isDark={isDark} />
                    </td>
                    <td className={`px-3 py-3 align-top tabular-nums ${t2}`}>{when(r.sent_at) || "—"}</td>
                    <td className={`px-3 py-3 align-top tabular-nums ${t2}`}>{when(r.completed_at) || "—"}</td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Small isDark={isDark} onClick={() => navigate(`/tools/signatures/${r.id}`)}>
                          {r.status === "draft" ? "Set up" : "Open"}
                        </Small>
                        {(r.status === "sent" || r.status === "partial") && (
                          <Small isDark={isDark} disabled={busy === r.id} onClick={() => act(r, "remind")}>
                            Remind
                          </Small>
                        )}
                        {r.status === "completed" && (
                          <>
                            <Small isDark={isDark} primary disabled={busy === r.id} onClick={() => act(r, "send-copy")}>
                              Send to both parties
                            </Small>
                            <Small isDark={isDark} disabled={busy === r.id} onClick={() => act(r, "download")}>
                              Download
                            </Small>
                          </>
                        )}
                        {r.status !== "completed" && r.status !== "draft" && r.status !== "voided" && (
                          <Small isDark={isDark} disabled={busy === r.id} onClick={() => act(r, "void")}>
                            Void
                          </Small>
                        )}
                        <Small isDark={isDark} danger disabled={busy === r.id} onClick={() => act(r, "delete")}>
                          Delete
                        </Small>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function StatusChip({ status, isDark }: { status: RequestStatus; isDark: boolean }) {
  const tone =
    status === "completed"
      ? isDark
        ? "bg-emerald-500/15 text-emerald-300"
        : "bg-emerald-50 text-emerald-700"
      : status === "declined" || status === "voided"
        ? isDark
          ? "bg-red-500/15 text-red-300"
          : "bg-red-50 text-red-700"
        : status === "draft"
          ? isDark
            ? "bg-white/[0.06] text-gray-300"
            : "bg-gray-100 text-gray-600"
          : isDark
            ? "bg-amber-500/15 text-amber-300"
            : "bg-amber-50 text-amber-700";
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function PartyDot({ status }: { status: SignatureRequest["parties"][number]["status"] }) {
  const c = status === "signed" ? "bg-emerald-400" : status === "declined" ? "bg-red-400" : status === "pending" ? "bg-gray-400" : "bg-amber-400";
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}

export function Small({ children, isDark, primary, danger, ...rest }: { children: React.ReactNode; isDark: boolean; primary?: boolean; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const tone = primary
    ? isDark
      ? "bg-white text-black hover:bg-gray-200"
      : "bg-gray-900 text-white hover:bg-gray-700"
    : danger
      ? isDark
        ? "text-red-300 hover:bg-red-500/10"
        : "text-red-600 hover:bg-red-50"
      : isDark
        ? "bg-white/[0.06] text-gray-200 hover:bg-white/10"
        : "bg-black/[0.04] text-gray-700 hover:bg-black/[0.08]";
  return (
    <button type="button" {...rest} className={`h-7 cursor-pointer whitespace-nowrap rounded-lg px-2.5 text-[12px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${tone}`}>
      {children}
    </button>
  );
}

export function DropZone({ isDark, busy, onFile, compact = false }: { isDark: boolean; busy: boolean; onFile: (file: File) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const pick = (list: FileList | null) => {
    const f = list?.[0];
    if (f) onFile(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      className={`mt-5 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-colors ${compact ? "px-4 py-5" : "px-4 py-8"} ${
        over ? (isDark ? "border-white/40 bg-white/[0.05]" : "border-gray-500 bg-gray-50") : isDark ? "border-white/15 bg-white/[0.02]" : "border-gray-300 bg-white"
      }`}
    >
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Choose a PDF to send for signature" onChange={(e) => pick(e.target.files)} />
      <p className="text-[13.5px] font-medium">{busy ? "Uploading…" : "Drop a PDF here to send it for signature"}</p>
      <p className={`text-[12px] ${isDark ? "text-gray-500" : "text-gray-500"}`}>You'll place the signature fields and say who signs on the next screen.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`mt-1 h-9 cursor-pointer rounded-lg px-4 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`}
      >
        Choose a PDF
      </button>
    </div>
  );
}
