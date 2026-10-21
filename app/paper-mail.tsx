import { useCallback, useEffect, useState } from "react";
import { authFetch } from "./auth";
import { Icon, Select, useTone } from "./entity/ui";

/**
 * Paper mail from Stable (api/stable.ts): the list both the Paper mail page
 * and each entity's Documents tab show. Each piece: the envelope, who it's
 * from and to, the scan when there is one, and what Stable did with it.
 */

export type PaperMail = {
  id: string;
  assetId: string | null;
  assigned: "auto" | "hand";
  from: string | null;
  recipient: string | null;
  recipient2: string | null;
  receivedAt: string | null;
  envelopeUrl: string | null;
  scanUrl: string | null;
  scanStatus: string | null;
  summary: string | null;
  checks: number;
  forwardStatus: string | null;
  shredStatus: string | null;
  returnedToSender: boolean;
  archivedAt: string | null;
  readAt: string | null;
};

export const STABLE_ADDRESS = "5227 N 7th St STE 48575, Phoenix, AZ 85014";
export const STABLE_DASHBOARD = "https://dashboard.usestable.com/dashboard";

/** The pieces for one entity, or (no id) all of them. */
export function usePaperMail(assetId?: string) {
  const [mail, setMail] = useState<PaperMail[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await authFetch(assetId ? `/api/stable?assetId=${encodeURIComponent(assetId)}` : "/api/stable?view=all");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load paper mail.");
      setMail(j.mail ?? []);
      if (typeof j.configured === "boolean") setConfigured(j.configured);
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setMail((m) => m ?? []);
    }
  }, [assetId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { mail, setMail, configured, error, reload: load };
}

export async function paperAction(body: Record<string, unknown>) {
  const r = await authFetch("/api/stable", { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Something went wrong.");
  return j;
}

const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

/** What happened to a piece, as a few words. */
function statusOf(m: PaperMail): { text: string; tone: "good" | "warn" | "muted" | "accent" }[] {
  const out: { text: string; tone: "good" | "warn" | "muted" | "accent" }[] = [];
  if (m.returnedToSender) out.push({ text: "Returned to sender", tone: "warn" });
  if (m.checks) out.push({ text: m.checks === 1 ? "Check inside" : `${m.checks} checks inside`, tone: "accent" });
  if (m.scanUrl) out.push({ text: "Scanned", tone: "good" });
  else if (m.scanStatus === "processing") out.push({ text: "Scanning…", tone: "muted" });
  if (m.forwardStatus) out.push({ text: m.forwardStatus === "completed" ? "Forwarded" : "Forwarding…", tone: "muted" });
  if (m.shredStatus) out.push({ text: m.shredStatus === "completed" ? "Shredded" : "Shredding…", tone: "muted" });
  return out;
}

export function PaperMailList({
  mail,
  entities,
  onAssign,
  onOpen,
  empty,
}: {
  mail: PaperMail[];
  /** Given: each piece gets an entity picker (staff, on the Paper mail page). */
  entities?: { id: string; name: string }[];
  onAssign?: (m: PaperMail, assetId: string | null) => void;
  onOpen?: (m: PaperMail) => void;
  empty: string;
}) {
  const t = useTone();
  if (!mail.length) return <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>{empty}</p>;
  const toneCls = (tone: string) =>
    tone === "good" ? (t.dark ? "text-emerald-300" : "text-emerald-700") : tone === "warn" ? (t.dark ? "text-amber-300" : "text-amber-700") : tone === "accent" ? t.accent : t.muted;
  return (
    <div className={`divide-y ${t.divide}`}>
      {mail.map((m) => {
        const unread = !m.readAt;
        return (
          <div key={m.id} className="flex items-start gap-4 px-5 py-4">
            <a
              href={m.envelopeUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpen?.(m)}
              className={`relative block h-[64px] w-[96px] shrink-0 overflow-hidden rounded-lg border ${t.line} ${t.dark ? "bg-white/[0.03]" : "bg-gray-50"}`}
              aria-label="Envelope"
            >
              {m.envelopeUrl ? (
                <img src={m.envelopeUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className={`flex h-full items-center justify-center ${t.faint}`}>
                  <Icon name="mail" className="h-5 w-5" />
                </span>
              )}
              {unread && <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-[#818cf8] ring-2 ring-black/40" aria-label="Unread" />}
            </a>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={`truncate text-[13.5px] ${unread ? "font-semibold" : "font-medium"} ${t.text}`}>{m.from || "Unknown sender"}</p>
                <span className={`shrink-0 text-[12px] tabular-nums ${t.muted}`}>{when(m.receivedAt)}</span>
              </div>
              <p className={`mt-0.5 truncate text-[12px] ${t.muted}`}>
                To {[m.recipient, m.recipient2].filter(Boolean).join(" · ") || "—"}
              </p>
              {m.summary && <p className={`mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed ${t.soft}`}>{m.summary}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
                {statusOf(m).map((s) => (
                  <span key={s.text} className={`inline-flex items-center gap-1 ${toneCls(s.tone)}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {s.text}
                  </span>
                ))}
                {m.scanUrl && (
                  <a href={m.scanUrl} target="_blank" rel="noopener noreferrer" onClick={() => onOpen?.(m)} className={`inline-flex items-center gap-1 font-medium hover:underline ${t.accent}`}>
                    Open scan <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
                {!m.scanUrl && m.scanStatus !== "processing" && (
                  <a href={STABLE_DASHBOARD} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 hover:underline ${t.muted}`}>
                    Scan, forward or shred in Stable <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            {entities && onAssign && (
              <div className="w-[200px] shrink-0 max-md:hidden">
                <Select
                  value={m.assetId ?? ""}
                  onChange={(e) => onAssign(m, e.target.value || null)}
                  aria-label="Entity"
                  className={!m.assetId ? (t.dark ? "!border-amber-400/40" : "!border-amber-300") : ""}
                >
                  <option value="">Which entity?</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
                {m.assetId && m.assigned === "auto" && <p className={`mt-1 text-[11px] ${t.faint}`}>Matched from the envelope</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
