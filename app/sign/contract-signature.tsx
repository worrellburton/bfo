import { useState } from "react";
import { Link } from "react-router";
import { isOpen, PARTY_LABEL, signApi, when, type SignField, type SignatureRequest } from "./api";
import { usePoll } from "./use-poll";
import { PartyDot, Small, StatusChip } from "../routes/tools-signatures";

/**
 * The contract page's signature card. Before a request exists: who signs for
 * each side, then one button that uploads the generated PDF, places the
 * fields on its signature block, and sends it. After: how far it has got,
 * with the same buttons Tools › Signatures has.
 */

/** Where the generated contract's signature block sits (jsPDF points, y from the top). */
export type SigGeometry = {
  page: number;
  pw: number;
  ph: number;
  left: { x: number; line: number; date: number };
  right: { x: number; line: number; date: number };
  colW: number;
};

/** The fields a contract's signature block needs, from where the generator drew it. */
export function contractFields(g: SigGeometry): SignField[] {
  const f = (party: "a" | "b", type: SignField["type"], x: number, yTop: number, w: number, h: number, id: string): SignField => ({
    id,
    party,
    type,
    page: g.page,
    x: x / g.pw,
    y: yTop / g.ph,
    w: w / g.pw,
    h: h / g.ph,
  });
  const sigH = 40;
  const lineW = g.colW - 20;
  return [
    f("a", "signature", g.left.x, g.left.line - sigH + 2, lineW, sigH, "a-sig"),
    f("b", "signature", g.right.x, g.right.line - sigH + 2, lineW, sigH, "b-sig"),
    f("a", "date", g.left.x + 34, g.left.date - 11, lineW - 34, 13, "a-date"),
    f("b", "date", g.right.x + 34, g.right.date - 11, lineW - 34, 13, "b-date"),
    // The client's name line is blank in the contract; their typed name fills it.
    f("b", "name", g.right.x + 34, g.right.date - 32 - 11, lineW - 34, 13, "b-name"),
  ];
}

export function ContractSignature({
  isDark,
  request,
  open,
  onClose,
  onChange,
  title,
  assetId,
  contractId,
  manager,
  client,
  pdf,
  geometry,
  brand,
}: {
  isDark: boolean;
  request: SignatureRequest | null;
  open: boolean;
  onClose: () => void;
  onChange: (r: SignatureRequest | null) => void;
  title: string;
  assetId: string;
  contractId: string;
  manager: { name: string; email: string; entity: string };
  client: { name: string };
  pdf: () => Blob | null;
  geometry: () => SigGeometry | null;
  /** Send under this name and never BFO's (the contract's "Entity name only"). */
  brand?: string | null;
}) {
  const [a, setA] = useState({ name: manager.name, email: manager.email });
  const [b, setB] = useState({ name: client.name, email: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const box = `mb-4 rounded-lg border p-4 ${isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"}`;
  const label = `text-xs block mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`;
  const input = `w-full px-3 py-2 text-sm max-sm:min-h-[44px] max-sm:text-[16px] rounded-lg border ${isDark ? "bg-white/5 border-white/10 text-white focus:border-white/30" : "bg-white border-gray-200 text-gray-900 focus:border-gray-400"} focus:outline-none`;
  const t2 = isDark ? "text-gray-400" : "text-gray-500";

  // Progress arrives as the other side signs.
  usePoll(
    async () => {
      if (request) onChange((await signApi.get(request.id, "unchanged")).request);
    },
    10000,
    isOpen(request?.status)
  );

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const blob = pdf();
    const g = geometry();
    if (!blob || !g) {
      setError("The PDF isn't ready yet. Give it a second.");
      return;
    }
    setBusy("send");
    setError("");
    try {
      const created = await signApi.act("create", {
        title,
        assetId,
        contractId,
        brand: brand || undefined,
        parties: [
          { role: "Manager", name: a.name.trim(), email: a.email.trim() },
          { role: "Client", name: b.name.trim(), email: b.email.trim() },
        ],
      });
      await signApi.attach(created.id, blob);
      await signApi.act("update", { id: created.id, fields: contractFields(g) });
      const sent = await signApi.act("send", { id: created.id });
      onChange(sent);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it.");
    } finally {
      setBusy("");
    }
  }

  async function act(action: "remind" | "send-copy" | "download" | "void") {
    if (!request) return;
    setBusy(action);
    setError("");
    setNote("");
    try {
      if (action === "download") {
        window.open(await signApi.download(request.id), "_blank", "noopener");
        return;
      }
      const next = await signApi.act(action, { id: request.id });
      onChange(next);
      setNote(action === "remind" ? "Reminder sent." : action === "send-copy" ? `Signed copy sent to ${next.parties.map((p) => p.email).join(" and ")}.` : "Voided.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  if (!request) {
    if (!open) return null;
    return (
      <form onSubmit={send} className={box}>
        <h3 className="text-sm font-semibold">Send for signature</h3>
        <p className={`mt-0.5 text-xs ${t2}`}>Each signer gets an email with a private link. Their signature and the date land on the agreement's signature block.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t2}`}>Manager · {manager.entity}</p>
            <label className="block">
              <span className={label}>Signer</span>
              <input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} required className={input} placeholder="Full name" />
            </label>
            <label className="block">
              <span className={label}>Email</span>
              <input type="email" value={a.email} onChange={(e) => setA({ ...a, email: e.target.value })} required className={input} placeholder="signer@email.com" />
            </label>
          </div>
          <div className="space-y-2">
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t2}`}>Client · {client.name}</p>
            <label className="block">
              <span className={label}>Signer</span>
              <input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required className={input} placeholder="Full name" />
            </label>
            <label className="block">
              <span className={label}>Email</span>
              <input type="email" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} required className={input} placeholder="signer@email.com" />
            </label>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button type="submit" disabled={!!busy} className={`px-4 py-2 max-sm:min-h-[40px] font-medium rounded-lg text-sm disabled:opacity-50 ${isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700"}`}>
            {busy ? "Sending…" : "Send to both parties"}
          </button>
          <button type="button" onClick={onClose} className={`px-3 py-2 max-sm:min-h-[40px] text-sm ${isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={box}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Signatures <StatusChip status={request.status} isDark={isDark} />
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(request.status === "sent" || request.status === "partial") && (
            <Small isDark={isDark} disabled={!!busy} onClick={() => act("remind")}>
              Remind
            </Small>
          )}
          {request.status === "completed" && (
            <>
              <Small isDark={isDark} primary disabled={!!busy} onClick={() => act("send-copy")}>
                Send to both parties
              </Small>
              <Small isDark={isDark} disabled={!!busy} onClick={() => act("download")}>
                Download signed copy
              </Small>
            </>
          )}
          <Link to={`/tools/signatures/${request.id}`} className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-medium ${isDark ? "bg-white/[0.06] text-gray-200 hover:bg-white/10" : "bg-black/[0.04] text-gray-700 hover:bg-black/[0.08]"}`}>
            Open in Tools
          </Link>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {request.parties.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center gap-2">
            <PartyDot status={p.status} />
            <span className="font-medium">{p.name}</span>
            <span className={`text-xs ${t2}`}>{p.role}</span>
            <span className={`text-xs ${t2}`}>· {PARTY_LABEL[p.status]}{p.signedAt ? ` ${when(p.signedAt)}` : p.viewedAt ? ` ${when(p.viewedAt)}` : ""}</span>
          </li>
        ))}
      </ul>
      {(error || note) && <p className={`mt-2 text-xs ${error ? "text-red-400" : isDark ? "text-emerald-300" : "text-emerald-700"}`}>{error || note}</p>}
    </div>
  );
}
