import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { FIELD_LABEL, type SignField } from "../sign/api";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import { SignaturePad } from "../sign/signature-pad";

export function meta() {
  return [{ title: "Sign · BFO" }];
}

type View = {
  title: string;
  status: string;
  completed: boolean;
  you: { key: "a" | "b"; role: string; name: string; email: string; status: string };
  parties: Array<{ key: "a" | "b"; role: string; name: string; status: string }>;
  fields: SignField[];
  pages: Array<{ w: number; h: number }>;
  pdfUrl: string | null;
  sentBy: string | null;
};

/**
 * The signer's page (/sign/<token>): the document with their places marked,
 * their name, their signature, and one button. No account; the token in the
 * link, sent to their email, is who they are.
 */
export default function SignPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [frameRef, width] = useFitWidth(760);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    (async () => {
      try {
        const res = await fetch(`/api/sign?token=${encodeURIComponent(token)}`);
        const body = (await res.json().catch(() => ({}))) as View & { message?: string; error?: string };
        if (!res.ok) throw new Error(body.message || "This signing link isn't valid any more.");
        setView(body);
        setName(body.you.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't open the document.");
      }
    })();
  }, [token]);

  async function post(action: "sign" | "decline") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "sign" ? { action, token, name, signature: png, consent } : { action, token, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; completed?: boolean };
      if (!res.ok) throw new Error(body.message || "That didn't go through. Try again.");
      setDone(action === "sign" ? "signed" : "declined");
      if (action === "sign" && body.completed) {
        // The signed copy is ready: reload the view for its download link.
        const again = await fetch(`/api/sign?token=${encodeURIComponent(token)}`);
        if (again.ok) setView((await again.json()) as View);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const mine = view?.fields.filter((f) => f.party === view.you.key) ?? [];
  const alreadySigned = view?.you.status === "signed";
  const closed = view?.status === "completed" || view?.status === "declined" || view?.status === "voided";
  const canSign = !!view && !alreadySigned && !closed && !done;

  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="mx-auto max-w-[900px] px-4 pb-24 pt-8 sm:px-6">
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="auth-eyebrow text-[11px] uppercase tracking-[0.28em] text-white/50">Burton Family Office</p>
            <p className="mt-1 font-[var(--font-brand)] text-[28px] leading-none">BFO</p>
          </div>
          {view && <p className="text-right text-[12px] text-white/50">{view.sentBy ? `Sent by ${view.sentBy}` : ""}</p>}
        </header>

        {error && !view && (
          <div className="mt-16 text-center">
            <h1 className="text-[20px] font-semibold">This link doesn't work</h1>
            <p className="mt-2 text-[13.5px] text-white/60">{error}</p>
          </div>
        )}

        {view && (
          <>
            <h1 className="mt-10 text-[24px] font-semibold leading-tight tracking-[-0.015em] sm:text-[28px]">{view.title}</h1>
            <p className="mt-2 text-[14px] text-white/60">
              {alreadySigned || done === "signed"
                ? `You signed this as ${view.you.name}.`
                : view.status === "completed"
                  ? "Signed by everyone."
                  : view.status === "voided"
                    ? "This request was withdrawn."
                    : `You're signing as ${view.you.name}, ${view.you.role}. ${mine.length ? `Your ${mine.map((f) => FIELD_LABEL[f.type].toLowerCase()).join(", ")} ${mine.length === 1 ? "goes" : "go"} where the page is marked.` : ""}`}
            </p>

            {(view.completed || done === "signed") && view.pdfUrl && view.completed && (
              <a href={view.pdfUrl} className="mt-4 inline-flex h-10 items-center rounded-xl bg-white px-4 text-[13.5px] font-semibold text-black">
                Download the signed copy
              </a>
            )}
            {done === "signed" && !view.completed && <p className="mt-3 text-[13px] text-white/50">We'll email you the signed copy once everyone has signed.</p>}
            {done === "declined" && <p className="mt-3 text-[13px] text-white/50">You declined to sign. The office has been told.</p>}

            <div ref={frameRef} className="mt-6 overflow-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-6" style={{ maxHeight: "70dvh" }}>
              {width > 0 && (
                <PdfPages
                  src={view.pdfUrl}
                  width={width - 8}
                  overlay={(page) =>
                    view.fields
                      .filter((f) => f.page === page && !(alreadySigned || done))
                      .map((f) => {
                        const yours = f.party === view.you.key;
                        return (
                          <div
                            key={f.id}
                            aria-hidden
                            className={`absolute rounded-[3px] ${yours ? "border-2 border-amber-400 bg-amber-300/25" : "border border-dashed border-white/40 bg-white/10"}`}
                            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                          >
                            {yours && <span className="absolute -top-[15px] left-0 whitespace-nowrap rounded-sm bg-amber-400 px-1 py-[1px] text-[10px] font-semibold leading-none text-black">{FIELD_LABEL[f.type]} here</span>}
                          </div>
                        );
                      })
                  }
                />
              )}
            </div>

            {canSign && (
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] text-white/60">Your full name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[16px] text-white focus:border-white/30 focus:outline-none" autoComplete="name" />
                </label>
                <div className="mt-4">
                  <span className="mb-1.5 block text-[12px] text-white/60">Your signature</span>
                  <SignaturePad name={name} onChange={setPng} dark />
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 text-[13px] text-white/70">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>I agree to sign this document electronically, and that my signature here is as binding as one in ink.</span>
                </label>
                {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" disabled={busy || !png || !consent || !name.trim()} onClick={() => post("sign")} className="h-11 rounded-xl bg-white px-6 text-[14px] font-semibold text-black transition-opacity disabled:opacity-40">
                    {busy ? "Signing…" : "Sign"}
                  </button>
                  {!declining ? (
                    <button type="button" onClick={() => setDeclining(true)} className="text-[13px] text-white/50 hover:text-white">
                      I'd rather not sign
                    </button>
                  ) : (
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not? (optional)" className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[14px] text-white focus:outline-none" />
                      <button type="button" disabled={busy} onClick={() => post("decline")} className="h-10 rounded-xl border border-white/15 px-4 text-[13px] text-white/80 hover:bg-white/10">
                        Decline to sign
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
        <p className="mt-10 text-center text-[11px] text-white/30">Signed through BFO · burtonfamilyoffice.com</p>
      </div>
    </div>
  );
}
