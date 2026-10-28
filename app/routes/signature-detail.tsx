import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { confirmDialog } from "../confirm-dialog";
import { FIELD_LABEL, isOpen, newField, PARTY_LABEL, signApi, when, type FieldType, type Party, type PartyKey, type SignField, type SignatureRequest } from "../sign/api";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import { usePoll } from "../sign/use-poll";
import { useTheme } from "../theme";
import { PartyDot, Small, StatusChip } from "./tools-signatures";

export function meta() {
  return [{ title: "Signature · BFO" }];
}

/**
 * One signature request: the document with its fields drawn over it (drag to
 * move, corner to resize, while it's still a draft), the two parties, and
 * the buttons that send it, remind, void, or hand out the signed copy.
 */
export default function SignatureDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [req, setReq] = useState<SignatureRequest | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ party: PartyKey; type: FieldType } | null>(null);
  const [frameRef, width] = useFitWidth(880);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t2 = isDark ? "text-gray-400" : "text-gray-600";
  const t3 = isDark ? "text-gray-500" : "text-gray-400";
  const card = `rounded-2xl border ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white glass-card"}`;
  const input = `h-9 w-full rounded-lg border px-2.5 text-[13px] focus:outline-none max-sm:h-[44px] max-sm:text-[16px] ${isDark ? "border-white/10 bg-white/[0.03] text-white focus:border-white/30" : "border-gray-200 bg-white text-gray-900 focus:border-gray-400"}`;

  const shownKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await signApi.get(id, shownKey.current);
      setReq(r.request);
      // Only a new version replaces the pages on screen (each signature stamps a new one).
      if (r.pdfUrl) {
        setPdfUrl(r.pdfUrl);
        shownKey.current = r.pdfKey;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load it.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // While it's out for signature, signatures show up here as they land.
  usePoll(load, 8000, isOpen(req?.status));

  const editable = req?.status === "draft";
  const parties = useMemo<Party[]>(() => {
    const got = req?.parties ?? [];
    return (["a", "b"] as PartyKey[]).map((key, i) => got.find((p) => p.key === key) ?? { key, role: i === 0 ? "Party A" : "Party B", name: "", email: "", status: "pending" });
  }, [req]);

  /** Saves fields and parties a moment after the last change. */
  function queueSave(next: SignatureRequest) {
    setReq(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      signApi.act("update", { id: next.id, title: next.title, fields: next.fields, parties: next.parties }).catch((err) => setError(err instanceof Error ? err.message : "Couldn't save."));
    }, 500);
  }

  function setParty(key: PartyKey, patch: Partial<Party>) {
    if (!req) return;
    const next = parties.map((p) => (p.key === key ? { ...p, ...patch } : p));
    queueSave({ ...req, parties: next });
  }
  function setFields(fields: SignField[]) {
    if (!req) return;
    queueSave({ ...req, fields });
  }
  function addField(party: PartyKey, type: FieldType, page: number, at?: { x: number; y: number }) {
    if (!req) return;
    const f = newField(party, type, page, at);
    setFields([...req.fields, f]);
    setSelected(f.id);
  }

  async function run(action: "send" | "remind" | "send-copy" | "void" | "delete" | "download") {
    if (!req) return;
    setBusy(action);
    setError("");
    setNote("");
    try {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await signApi.act("update", { id: req.id, title: req.title, fields: req.fields, parties: req.parties });
      }
      if (action === "download") {
        window.open(await signApi.download(req.id), "_blank", "noopener");
      } else if (action === "delete") {
        if (!(await confirmDialog({ title: `Delete "${req.title}"?`, message: "The document and its signatures are removed for good.", tone: "danger", confirmLabel: "Delete" }))) return;
        await signApi.remove(req.id);
        navigate("/tools/signatures");
        return;
      } else if (action === "void") {
        if (!(await confirmDialog({ title: "Void this request?", message: "The signing links stop working. Nobody is told.", tone: "danger", confirmLabel: "Void" }))) return;
        setReq(await signApi.act("void", { id: req.id }));
      } else {
        const next = await signApi.act(action, { id: req.id });
        setReq(next);
        setNote(
          action === "send"
            ? `Sent to ${next.parties.map((p) => `${p.name} (${p.email})`).join(" and ")}.`
            : action === "remind"
              ? `Reminded ${next.parties.filter((p) => p.status !== "signed").map((p) => p.name).join(" and ")}.`
              : `Sent the signed copy to ${next.parties.map((p) => p.email).join(" and ")}.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  if (error && !req) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <Link to="/tools/signatures" className={`text-[12.5px] ${t2} hover:underline`}>
          ← Signatures
        </Link>
        <p className="mt-6 text-red-400">{error}</p>
      </div>
    );
  }

  const partyTone = (k: PartyKey) => (k === "a" ? { bg: "rgba(99,102,241,0.18)", border: "#818cf8", text: isDark ? "#c7d2fe" : "#3730a3" } : { bg: "rgba(245,158,11,0.18)", border: "#f59e0b", text: isDark ? "#fde68a" : "#92400e" });

  return (
    <div className="mx-auto max-w-[1400px] pb-16">
      <header className="flex flex-col gap-3 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <Link to="/tools/signatures" className={`block text-[11px] font-medium uppercase tracking-[0.18em] ${t3} hover:underline`}>
            Tools · Signatures
          </Link>
          {req && editable ? (
            <input value={req.title} onChange={(e) => queueSave({ ...req, title: e.target.value })} aria-label="Document title" className={`mt-1 h-auto w-full max-w-[640px] border-0 bg-transparent p-0 text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] focus:outline-none sm:text-[22px] ${isDark ? "text-white" : "text-gray-900"}`} />
          ) : (
            <h1 className="mt-1 text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px]">{req?.title ?? "…"}</h1>
          )}
          {req && (
            <p className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] ${t2}`}>
              <StatusChip status={req.status} isDark={isDark} />
              {req.sent_at && <span>Sent {when(req.sent_at)}</span>}
              {req.completed_at && <span>Signed {when(req.completed_at)}</span>}
              {req.copy_sent_at && <span>Copy sent {when(req.copy_sent_at)}</span>}
              {req.pages.length > 0 && <span>{req.pages.length} page{req.pages.length === 1 ? "" : "s"}</span>}
            </p>
          )}
        </div>
        {req && (
          <div className="flex flex-wrap items-center gap-1.5">
            {editable && (
              <Small isDark={isDark} primary disabled={!!busy} onClick={() => run("send")}>
                {busy === "send" ? "Sending…" : "Send for signature"}
              </Small>
            )}
            {(req.status === "sent" || req.status === "partial") && (
              <Small isDark={isDark} disabled={!!busy} onClick={() => run("remind")}>
                Remind
              </Small>
            )}
            {req.status === "completed" && (
              <Small isDark={isDark} primary disabled={!!busy} onClick={() => run("send-copy")}>
                {busy === "send-copy" ? "Sending…" : "Send to both parties"}
              </Small>
            )}
            {req.original_path && (
              <Small isDark={isDark} disabled={!!busy} onClick={() => run("download")}>
                {req.status === "completed" ? "Download signed copy" : "Download"}
              </Small>
            )}
            {(req.status === "sent" || req.status === "partial" || req.status === "declined") && (
              <Small isDark={isDark} disabled={!!busy} onClick={() => run("void")}>
                Void
              </Small>
            )}
            <Small isDark={isDark} danger disabled={!!busy} onClick={() => run("delete")}>
              Delete
            </Small>
          </div>
        )}
      </header>

      {(error || note) && (
        <p role="status" className={`mt-3 text-[12.5px] ${error ? "text-red-400" : isDark ? "text-emerald-300" : "text-emerald-700"}`}>
          {error || note}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* The document */}
        <div ref={frameRef} className={`min-w-0 overflow-auto p-4 sm:p-6 ${card} ${isDark ? "bg-black/40" : "bg-gray-100"}`} style={{ maxHeight: "calc(100dvh - 12rem)" }}>
          {placing && (
            <p className={`mb-3 text-center text-[12.5px] ${isDark ? "text-amber-300" : "text-amber-700"}`}>
              Click where the {FIELD_LABEL[placing.type].toLowerCase()} for {parties.find((p) => p.key === placing.party)?.name || parties.find((p) => p.key === placing.party)?.role} goes.{" "}
              <button type="button" className="underline" onClick={() => setPlacing(null)}>
                Cancel
              </button>
            </p>
          )}
          {width > 0 && (
            <PdfPages
              src={pdfUrl}
              width={width - 8}
              overlay={(page, size) => (
                <div
                  className={`absolute inset-0 ${placing ? "cursor-crosshair" : ""}`}
                  onClick={(e) => {
                    if (!placing) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    addField(placing.party, placing.type, page, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
                    setPlacing(null);
                  }}
                >
                  {(req?.fields ?? [])
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <FieldBox
                        key={f.id}
                        field={f}
                        size={size}
                        tone={partyTone(f.party)}
                        label={`${parties.find((p) => p.key === f.party)?.name?.split(" ")[0] || parties.find((p) => p.key === f.party)?.role} · ${FIELD_LABEL[f.type]}`}
                        editable={!!editable}
                        selected={selected === f.id}
                        onSelect={() => setSelected(f.id)}
                        onChange={(nf) => setFields((req?.fields ?? []).map((x) => (x.id === nf.id ? nf : x)))}
                        onRemove={() => setFields((req?.fields ?? []).filter((x) => x.id !== f.id))}
                      />
                    ))}
                </div>
              )}
            />
          )}
        </div>

        {/* Parties and fields */}
        <aside className="space-y-4">
          {parties.map((p) => {
            const tone = partyTone(p.key);
            const mine = (req?.fields ?? []).filter((f) => f.party === p.key);
            return (
              <section key={p.key} className={`${card} p-4`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: tone.text }}>
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tone.border }} />
                    {p.key === "a" ? "First party" : "Second party"}
                  </span>
                  {!editable && (
                    <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${t2}`}>
                      <PartyDot status={p.status} />
                      {PARTY_LABEL[p.status]}
                      {p.signedAt ? ` ${when(p.signedAt)}` : ""}
                    </span>
                  )}
                </div>
                {editable ? (
                  <div className="mt-3 space-y-2">
                    <input value={p.role} onChange={(e) => setParty(p.key, { role: e.target.value })} placeholder="Role (Manager, Client…)" aria-label={`${p.key === "a" ? "First" : "Second"} party role`} className={input} />
                    <input value={p.name} onChange={(e) => setParty(p.key, { name: e.target.value })} placeholder="Full name" aria-label={`${p.key === "a" ? "First" : "Second"} party name`} className={input} />
                    <input type="email" value={p.email} onChange={(e) => setParty(p.key, { email: e.target.value })} placeholder="Email" aria-label={`${p.key === "a" ? "First" : "Second"} party email`} className={input} />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(["signature", "initials", "name", "date"] as FieldType[]).map((type) => (
                        <Small key={type} isDark={isDark} onClick={() => setPlacing({ party: p.key, type })} aria-pressed={placing?.party === p.key && placing.type === type}>
                          + {FIELD_LABEL[type]}
                        </Small>
                      ))}
                    </div>
                    <p className={`text-[11.5px] ${t3}`}>
                      {mine.length === 0 ? "No fields yet. Add a signature and click the page where it goes." : `${mine.length} field${mine.length === 1 ? "" : "s"}: ${mine.map((f) => `${FIELD_LABEL[f.type].toLowerCase()} p.${f.page}`).join(", ")}`}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 text-[13px]">
                    <p className="font-medium">{p.name || p.role}</p>
                    <p className={t2}>
                      {p.role}
                      {p.email ? ` · ${p.email}` : ""}
                    </p>
                    {p.signedAs && p.signedAs !== p.name && <p className={`text-[12px] ${t3}`}>Signed as {p.signedAs}</p>}
                    {p.declinedReason && <p className="mt-1 text-[12px] text-red-400">Declined: {p.declinedReason}</p>}
                    {(req?.status === "sent" || req?.status === "partial") && p.status !== "signed" && (
                      <Small isDark={isDark} className="mt-2" disabled={!!busy} onClick={() => signApi.act("remind", { id: req.id, party: p.key }).then(setReq).catch((e) => setError(e.message))}>
                        Remind {p.name.split(" ")[0] || p.role}
                      </Small>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {req && req.events.length > 0 && (
            <section className={`${card} p-4`}>
              <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>History</p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {[...req.events].reverse().map((e, i) => (
                  <li key={i} className={`flex justify-between gap-3 ${t2}`}>
                    <span>
                      {describe(e.kind)}
                      {e.party ? ` · ${parties.find((p) => p.key === e.party)?.name || parties.find((p) => p.key === e.party)?.role}` : ""}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className={`shrink-0 tabular-nums ${t3}`}>{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function describe(kind: string): string {
  return (
    {
      created: "Created",
      attached: "Document added",
      sent: "Sent for signature",
      emailed: "Emailed",
      reminded: "Reminded",
      viewed: "Opened",
      signed: "Signed",
      declined: "Declined",
      completed: "Signed by everyone",
      copy_sent: "Signed copy sent",
      voided: "Voided",
    }[kind] ?? kind
  );
}

/** A field on the page: dragged by its body, resized by its corner. */
function FieldBox({
  field,
  size,
  tone,
  label,
  editable,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  field: SignField;
  size: { w: number; h: number };
  tone: { bg: string; border: string; text: string };
  label: string;
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (f: SignField) => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ kind: "move" | "resize"; sx: number; sy: number; f: SignField } | null>(null);

  function start(kind: "move" | "resize") {
    return (e: React.PointerEvent) => {
      if (!editable) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { kind, sx: e.clientX, sy: e.clientY, f: field };
    };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / size.w;
    const dy = (e.clientY - d.sy) / size.h;
    if (d.kind === "move") {
      onChange({ ...d.f, x: Math.min(1 - d.f.w, Math.max(0, d.f.x + dx)), y: Math.min(1 - d.f.h, Math.max(0, d.f.y + dy)) });
    } else {
      onChange({ ...d.f, w: Math.min(1 - d.f.x, Math.max(0.03, d.f.w + dx)), h: Math.min(1 - d.f.y, Math.max(0.012, d.f.h + dy)) });
    }
  }
  function end() {
    drag.current = null;
  }

  return (
    <div
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : -1}
      aria-label={label}
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onRemove();
        }
      }}
      className={`absolute select-none rounded-[3px] text-[10px] font-medium leading-none ${editable ? "cursor-move touch-none" : ""}`}
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.w * 100}%`,
        height: `${field.h * 100}%`,
        background: tone.bg,
        border: `${selected ? 2 : 1}px ${selected ? "solid" : "dashed"} ${tone.border}`,
        color: tone.text,
      }}
    >
      <span className="absolute -top-[14px] left-0 whitespace-nowrap rounded-sm px-1 py-[1px]" style={{ background: tone.border, color: "#000" }}>
        {label}
      </span>
      {editable && selected && (
        <>
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -right-[9px] -top-[9px] flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full bg-black text-[11px] text-white shadow"
          >
            ×
          </button>
          <span aria-hidden onPointerDown={start("resize")} className="absolute -bottom-[6px] -right-[6px] h-3 w-3 cursor-nwse-resize rounded-sm bg-white" style={{ border: `2px solid ${tone.border}` }} />
        </>
      )}
    </div>
  );
}
