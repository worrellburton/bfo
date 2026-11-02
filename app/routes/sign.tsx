import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { FIELD_LABEL, type SignField, type SignMode } from "../sign/api";
import { GameGate } from "../sign/game";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import { PREVIEW_TITLE, samplePdf } from "../sign/preview";
import { SignaturePad } from "../sign/signature-pad";
import { usePoll } from "../sign/use-poll";

export function meta() {
  return [{ title: "Sign" }];
}

type View = {
  title: string;
  /** Sent under this name instead of BFO's. */
  brand: string | null;
  /** The plain page, or the Anything Is Possible game in front of it (app/sign/game). */
  mode?: SignMode;
  status: string;
  completed: boolean;
  you: { key: "a" | "b"; role: string; name: string; email: string; status: string };
  parties: Array<{ key: "a" | "b"; role: string; name: string; status: string }>;
  fields: SignField[];
  pages: Array<{ w: number; h: number }>;
  pdfKey: string | null;
  pdfUrl: string | null;
  /** The same PDF as a download, named after the document. */
  downloadUrl?: string | null;
  sentBy: string | null;
};

/** The office looking at the page on a sample document: nothing is fetched or saved. */
type Preview = { name: string; email: string };

export default function SignRoute() {
  const { token = "" } = useParams();
  return <SignPage token={token} />;
}

/**
 * The signer's page (/sign/<token>): the document with their places marked,
 * their name, their signature, and one button. No account; the token in the
 * link, sent to their email, is who they are. Once they sign, the document
 * shows their signature, and it keeps up as the other party signs.
 *
 * A request sent in game mode puts the Anything Is Possible game in front of
 * all this (app/sign/game): the page appears once the game's desk is reached.
 * Every visit starts the game over until they sign.
 */
export function SignPage({ token, preview }: { token: string; preview?: Preview }) {
  const [view, setView] = useState<View | null>(null);
  // The game has been played through (or skipped) this visit.
  const [played, setPlayed] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [png, setPng] = useState<string | null>(null);
  // The e-signature consent is asked after "Sign", as the last step.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [frameRef, width] = useFitWidth(760);
  // The PDF on screen. A new link replaces it only for a newer version (a signature was stamped), so polling doesn't redraw it.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const shownKey = useRef<string | null>(null);
  const frameEl = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (first = false) => {
      if (preview) {
        if (!first) return;
        const sample = await samplePdf(preview.name);
        setView({
          title: PREVIEW_TITLE,
          brand: null,
          mode: "game",
          status: "sent",
          completed: false,
          you: { key: "a", role: "Signer", name: preview.name, email: preview.email, status: "viewed" },
          parties: [{ key: "a", role: "Signer", name: preview.name, status: "viewed" }],
          fields: sample.fields,
          pages: sample.pages,
          pdfKey: "preview",
          pdfUrl: sample.url,
          downloadUrl: sample.url,
          sentBy: "Burton Family Office",
        });
        setName(preview.name);
        setPdfUrl(sample.url);
        setDownloadUrl(sample.url);
        shownKey.current = "preview";
        return;
      }
      const have = shownKey.current ? `&have=${encodeURIComponent(shownKey.current)}` : "";
      const res = await fetch(`/api/sign?token=${encodeURIComponent(token)}${have}`);
      const body = (await res.json().catch(() => ({}))) as View & { message?: string };
      if (!res.ok) {
        if (first) throw new Error(body.message || "This signing link isn't valid any more.");
        return;
      }
      setView(body);
      if (first) setName(body.you.name);
      if (body.pdfUrl) {
        setPdfUrl(body.pdfUrl);
        setDownloadUrl(body.downloadUrl ?? body.pdfUrl);
        shownKey.current = body.pdfKey;
      }
    },
    [token, preview],
  );

  useEffect(() => {
    document.documentElement.classList.add("dark");
    load(true).catch((err) => setError(err instanceof Error ? err.message : "Couldn't open the document."));
  }, [load]);

  // Until everyone has signed, the document follows along.
  const waiting = !!view && !preview && (view.status === "sent" || view.status === "partial");
  usePoll(() => load(), 8000, waiting);

  useEffect(() => {
    if (!confirming) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && !busy && setConfirming(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [confirming, busy]);

  async function post(action: "sign" | "decline") {
    if (preview) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "sign" ? { action, token, name, signature: png, consent: true } : { action, token, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message || "That didn't go through. Try again.");
      setConfirming(false);
      setDone(action === "sign" ? "signed" : "declined");
      // The document as it now reads, with this signature on it.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  // Once signed, bring their signature into view on the freshly stamped page.
  useEffect(() => {
    if (done !== "signed" || !view || !width) return;
    const field = view.fields.find((f) => f.party === view.you.key && f.type === "signature");
    const page = field ? view.pages[field.page - 1] : null;
    const box = frameEl.current;
    if (!field || !page || !box) return;
    const w = width - 8;
    const pageH = (w * page.h) / page.w;
    const above = view.pages.slice(0, field.page - 1).reduce((sum, p) => sum + (w * p.h) / p.w + 16, 0);
    const t = setTimeout(() => box.scrollTo({ top: Math.max(0, above + field.y * pageH - box.clientHeight / 2), behavior: "smooth" }), 400);
    return () => clearTimeout(t);
  }, [done, pdfUrl, view, width]);

  const mine = view?.fields.filter((f) => f.party === view.you.key) ?? [];
  const signedNow = view?.you.status === "signed" || done === "signed";
  const closed = view?.status === "completed" || view?.status === "declined" || view?.status === "voided";
  const canSign = !!view && !signedNow && !closed && !done;
  const others = view?.parties.filter((p) => p.key !== view.you.key) ?? [];
  const brand = view?.brand ?? null;
  // Game mode: the theater comes first, every visit, until they sign.
  const inGame = !!view && view.mode === "game" && canSign && !played;

  if (view && inGame) {
    return (
      <div className="min-h-dvh bg-black text-white">
        <GameGate
          signerName={view.you.name}
          title={view.title}
          brand={brand}
          document={{
            fileName: `${
              view.title
                .replace(/[^\w .&-]+/g, " ")
                .replace(/\s+/g, " ")
                .trim() || "Document"
            }.pdf`,
            pages: view.pages.length,
            sentBy: brand ? null : view.sentBy,
            role: view.you.role,
            signPages: [...new Set(view.fields.filter((f) => f.party === view.you.key && f.type === "signature").map((f) => f.page))].sort((a, b) => a - b),
          }}
          preview={!!preview}
          onDone={() => setPlayed(true)}
          onSkip={() => setPlayed(true)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="mx-auto max-w-[900px] px-4 pb-24 pt-8 sm:px-6">
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {brand ? (
              <p className="font-[var(--font-brand)] text-[22px] leading-tight">{brand}</p>
            ) : (
              <>
                <p className="auth-eyebrow text-[11px] uppercase tracking-[0.28em] text-white/50">Burton Family Office</p>
                <p className="mt-1 font-[var(--font-brand)] text-[28px] leading-none">BFO</p>
              </>
            )}
          </div>
          {preview ? (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="rounded-full border border-amber-300/50 bg-amber-300/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200">Preview</span>
              {view?.mode === "game" && (
                <button type="button" onClick={() => setPlayed(false)} className="h-[32px] rounded-full border border-white/15 px-3 text-white/80 hover:bg-white/10">
                  Play again
                </button>
              )}
              <Link to="/tools/signatures" className="h-[32px] rounded-full border border-white/15 px-3 leading-[30px] text-white/80 hover:bg-white/10">
                Exit preview
              </Link>
            </div>
          ) : (
            view?.sentBy && !brand && <p className="text-right text-[12px] text-white/50">Sent by {view.sentBy}</p>
          )}
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
              {view.status === "completed"
                ? "Signed by everyone."
                : signedNow
                  ? `You signed this as ${name || view.you.name}.`
                  : view.status === "voided"
                    ? "This request was withdrawn."
                    : view.status === "declined" || done === "declined"
                      ? view.you.status === "declined" || done === "declined"
                        ? "You declined to sign this. The sender has been told."
                        : `${others.find((p) => p.status === "declined")?.name || "The other party"} declined to sign, so this request is closed. Nothing more is needed from you.`
                      : `You're signing as ${view.you.name}, ${view.you.role}. ${mine.length ? `Your ${mine.map((f) => FIELD_LABEL[f.type].toLowerCase()).join(", ")} ${mine.length === 1 ? "goes" : "go"} where the page is marked.` : ""}`}
            </p>

            {view.completed && pdfUrl && (
              <a href={downloadUrl ?? pdfUrl} className="mt-4 inline-flex h-[44px] items-center rounded-xl bg-white px-4 text-[13.5px] font-semibold text-black">
                Download the signed copy
              </a>
            )}
            {!view.completed && downloadUrl && (
              <a
                href={downloadUrl}
                download={`${view.title.replace(/[^\w .&-]+/g, " ").trim() || "Document"}.pdf`}
                className="mt-4 inline-flex h-[44px] items-center gap-2 rounded-xl border border-white/15 px-4 text-[13.5px] font-medium text-white/85 hover:bg-white/10"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
                </svg>
                Download as PDF
              </a>
            )}
            {signedNow && !view.completed && (
              <p className="mt-3 flex items-center gap-2 text-[13px] text-white/60">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Waiting on{" "}
                {others
                  .filter((p) => p.status !== "signed")
                  .map((p) => p.name || p.role)
                  .join(" and ") || "the other party"}
                . This page updates when they sign, and we'll email you the signed copy.
              </p>
            )}

            <div
              ref={(el) => {
                frameRef(el);
                frameEl.current = el;
              }}
              className="mt-6 overflow-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-6"
              style={{ maxHeight: "70dvh" }}
            >
              {width > 0 && (
                <PdfPages
                  src={pdfUrl}
                  width={width - 8}
                  overlay={(page) =>
                    canSign
                      ? view.fields
                          .filter((f) => f.page === page)
                          .map((f) => {
                            const yours = f.party === view.you.key;
                            return (
                              <div
                                key={f.id}
                                aria-hidden
                                className={`absolute rounded-[3px] ${yours ? "border-2 border-amber-400 bg-amber-300/25" : "border border-dashed border-black/20 bg-black/[0.03]"}`}
                                style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                              >
                                {yours && (
                                  <span className="absolute -top-[15px] left-0 whitespace-nowrap rounded-sm bg-amber-400 px-1 py-[1px] text-[10px] font-semibold leading-none text-black">
                                    {FIELD_LABEL[f.type]} here
                                  </span>
                                )}
                              </div>
                            );
                          })
                      : null
                  }
                />
              )}
            </div>

            {canSign && (
              <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] text-white/60">Your full name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[16px] text-white focus:border-white/30 focus:outline-none"
                    autoComplete="name"
                  />
                </label>
                <div className="mt-4">
                  <span className="mb-1.5 block text-[12px] text-white/60">Your signature</span>
                  <SignaturePad name={name} onChange={setPng} dark />
                </div>
                {error && !confirming && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy || !png || !name.trim() || !!preview}
                    onClick={() => setConfirming(true)}
                    className="h-[44px] rounded-xl bg-white px-6 text-[14px] font-semibold text-black transition-opacity disabled:opacity-40"
                  >
                    Sign
                  </button>
                  {preview ? (
                    <span className="text-[13px] text-white/50">This is a preview: nothing is signed or saved.</span>
                  ) : !declining ? (
                    <button type="button" onClick={() => setDeclining(true)} className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-white/50 hover:text-white">
                      I'd rather not sign
                    </button>
                  ) : (
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why not? (optional)"
                        aria-label="Why you're declining (optional)"
                        className="h-[44px] flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[14px] text-white focus:outline-none"
                      />
                      <button type="button" disabled={busy} onClick={() => post("decline")} className="h-[44px] rounded-xl border border-white/15 px-4 text-[13px] text-white/80 hover:bg-white/10">
                        Decline to sign
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
        <p className="mt-10 text-center text-[11px] text-white/30">{brand ? "Signed electronically" : "Signed through BFO · burtonfamilyoffice.com"}</p>
      </div>

      {confirming && view && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" role="presentation" onClick={() => !busy && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="esign-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#0b0b0f] p-5 shadow-2xl sm:p-6"
          >
            <h2 id="esign-title" className="text-[17px] font-semibold">
              Sign electronically?
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/70">
              You're signing <span className="text-white">{view.title}</span> as <span className="text-white">{name.trim()}</span>. You agree to sign this document electronically, and that your
              electronic signature is as binding as one in ink.
            </p>
            {png && (
              <div className="mt-4 flex h-[84px] items-center justify-center rounded-xl bg-[#faf8f2] px-4">
                <img src={png} alt="Your signature" className="max-h-[64px] max-w-full" />
              </div>
            )}
            {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="h-[44px] rounded-xl px-4 text-[14px] text-white/70 hover:bg-white/10">
                Go back
              </button>
              <button type="button" autoFocus disabled={busy} onClick={() => post("sign")} className="h-[44px] rounded-xl bg-white px-6 text-[14px] font-semibold text-black disabled:opacity-50">
                {busy ? "Signing…" : "I agree, sign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
