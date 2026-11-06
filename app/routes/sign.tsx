import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { FIELD_LABEL, isGameMode, shortSha, type SignField, type SignMode } from "../sign/api";
import { consentPoints, DISCLOSURE_EFFECTIVE, DISCLOSURE_VERSION, disclosureSections } from "../sign/disclosure";
import { GameGate } from "../sign/game";
import { RaceGate } from "../sign/kart";
import { PdfPages, useFitWidth } from "../sign/pdf-pages";
import { PREVIEW_TITLE, samplePdf } from "../sign/preview";
import { SignaturePad, type SignMethod } from "../sign/signature-pad";
import { usePoll } from "../sign/use-poll";
import { Banner, Button, buttonClasses, Checkbox, cx, Dialog, Disclosure, Field, Icon, Input, Textarea, confirm, format, usePhone } from "../ui";

export function meta() {
  return [{ title: "Sign · BFO" }];
}

type View = {
  title: string;
  /** Sent under this name instead of BFO's. */
  brand: string | null;
  /** The plain page, or a game in front of it (app/sign/game, app/sign/kart). */
  mode?: SignMode;
  status: string;
  completed?: boolean;
  completedAt?: string | null;
  you: { key: "a" | "b"; role?: string; name: string; email?: string; status: string; entity?: string | null; title?: string | null; signedAt?: string | null };
  parties?: Array<{ key: "a" | "b"; role: string; name: string; status: string }>;
  fields?: SignField[];
  pages?: Array<{ w: number; h: number }>;
  pdfKey?: string | null;
  pdfUrl?: string | null;
  /** The same PDF as a download, named after the document. */
  downloadUrl?: string | null;
  sentBy: string | null;
  /** The original's SHA-256 (the document ID the signer sees), and the signed copy's once complete. */
  documentId?: string | null;
  signedSha?: string | null;
  expiresAt?: string | null;
  /** A withdrawn request: when, and whether a new request replaced it. */
  voidedAt?: string | null;
  replaced?: boolean;
};

/** The office looking at the page on a sample document: nothing is fetched or saved. `mode` picks which game comes first. */
type Preview = { name: string; email: string; mode?: SignMode };

export default function SignRoute() {
  const { token = "" } = useParams();
  return <SignPage token={token} />;
}

/**
 * The signing page follows the signer's device, light or dark, whatever a
 * staff member chose in BFO on this browser (docs/DESIGN.md §2.1): it sets
 * the theme on <html> while it's open and puts back what was there after.
 */
function useDeviceTheme() {
  useEffect(() => {
    const html = document.documentElement;
    const before = { theme: html.getAttribute("data-theme"), light: html.classList.contains("light"), dark: html.classList.contains("dark") };
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const metaBefore = meta?.content;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mq.matches;
      html.setAttribute("data-theme", dark ? "dark" : "light");
      // The legacy `light` class drives the old repaint layer; it must match, or a dark page turns half light.
      html.classList.toggle("dark", dark);
      html.classList.toggle("light", !dark);
      if (meta) meta.content = dark ? "#0b0b0c" : "#f7f7f8";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      if (before.theme === null) html.removeAttribute("data-theme");
      else html.setAttribute("data-theme", before.theme);
      html.classList.toggle("light", before.light);
      html.classList.toggle("dark", before.dark);
      if (meta && metaBefore !== undefined) meta.content = metaBefore;
    };
  }, []);
}

/** Two names that agree on their first and last words ("Alex Rivera" and "Alex J. Rivera"). */
function sameName(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  return x.length === 1 || y.length === 1 || x[x.length - 1] === y[y.length - 1];
}

/** A download link that looks like a Button (anchors don't match :enabled, so hover is set here). */
const linkButton = (variant: "primary" | "secondary") => cx(buttonClasses({ variant }), variant === "primary" ? "hover:bg-primary-hover" : "hover:bg-hover");

/**
 * The signer's page (/sign/<token>): the document with their places marked,
 * their name, their signature, and one button. No account and no app shell;
 * the token in the link, sent to their email, is who they are. Before the
 * signature is taken they agree to use electronic records and signatures
 * (the disclosure's version is recorded with it). Once they sign, the page
 * says so, shows their signature on the page, and keeps up as the others sign.
 *
 * A request sent in a game mode puts a game in front of this on a computer:
 * the Anything Is Possible theater (app/sign/game) or the racetrack
 * (app/sign/kart). It's always optional: every device can read and sign at
 * once, and the page, the consent and the record are the same either way.
 */
export function SignPage({ token, preview }: { token: string; preview?: Preview }) {
  useDeviceTheme();
  const phone = usePhone();
  const [view, setView] = useState<View | null>(null);
  // The game has been played through (or skipped) this visit, and which.
  const [played, setPlayed] = useState(false);
  const [via, setVia] = useState<"page" | "game">("page");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<{ title: string; message: string } | null>(null);
  const [name, setName] = useState("");
  const [png, setPng] = useState<string | null>(null);
  const [method, setMethod] = useState<SignMethod>("drawn");
  const [address, setAddress] = useState("");
  // The e-signature consent is the last step, after "Sign".
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [reading, setReading] = useState(false);
  const [formInView, setFormInView] = useState(false);
  const [frameRef, width] = useFitWidth(760);
  // The PDF on screen. A new link replaces it only for a newer version (a signature was stamped), so polling doesn't redraw it.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const shownKey = useRef<string | null>(null);
  const opened = useRef(false);
  const formRef = useRef<HTMLElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const introRef = useRef<HTMLParagraphElement | null>(null);

  const load = useCallback(
    async (first = false) => {
      if (preview) {
        if (!first) return;
        const sample = await samplePdf(preview.name);
        setView({
          title: PREVIEW_TITLE,
          brand: null,
          mode: preview.mode ?? "game",
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
      const body = (await res.json().catch(() => ({}))) as View & { message?: string; error?: string };
      if (!res.ok) {
        if (first)
          setLoadError(
            res.status === 410
              ? { title: "This link has expired", message: body.message || "Ask the sender to send a new one." }
              : { title: "This link doesn’t work", message: body.message || "This signing link isn’t valid any more." },
          );
        return;
      }
      setView(body);
      if (first) setName(body.you.name);
      if (body.pdfUrl) {
        setPdfUrl(body.pdfUrl);
        setDownloadUrl(body.downloadUrl ?? body.pdfUrl);
        shownKey.current = body.pdfKey ?? null;
      }
    },
    [token, preview],
  );

  useEffect(() => {
    load(true).catch(() => setLoadError({ title: "The document didn’t open", message: "Check your connection and reload the page." }));
  }, [load]);

  // The email's "Electronic records disclosure" link lands here with #disclosure.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#disclosure") setReading(true);
  }, []);

  useEffect(() => {
    if (view?.title) document.title = `${view.title} · Sign`;
  }, [view?.title]);

  // Until everyone has signed, the document follows along.
  const waiting = !!view && !preview && (view.status === "sent" || view.status === "partial");
  usePoll(() => load(), 8000, waiting);

  const fields = useMemo(() => view?.fields ?? [], [view]);
  const pages = view?.pages ?? [];
  const mine = view ? fields.filter((f) => f.party === view.you.key) : [];
  const signedNow = view?.you.status === "signed" || done === "signed";
  const closed = view?.status === "completed" || view?.status === "declined" || view?.status === "voided";
  const canSign = !!view && !signedNow && !closed && !done;
  const others = view?.parties?.filter((p) => p.key !== view.you.key) ?? [];
  const brand = view?.brand ?? null;
  const sender = brand || view?.sentBy || "the sender";
  const needsAddress = mine.some((f) => f.type === "address");
  const signPages = [...new Set(mine.filter((f) => f.type === "signature").map((f) => f.page))].sort((a, b) => a - b);
  const what = format.list([...new Set(mine.map((f) => FIELD_LABEL[f.type].toLowerCase()))].map((l, i) => (i === 0 ? `your ${l}` : `the ${l}`)));
  const whereText = signPages.length ? ` on page ${format.list(signPages.map(String))}` : "";
  const capacity = view?.you.entity ? `for ${view.you.entity} as its ${view.you.title || "signer"}` : view ? `as ${view.you.name}${view.you.role ? `, ${view.you.role}` : ""}` : "";
  const differs = !!view && !!name.trim() && !sameName(name, view.you.name);
  const missing = !name.trim() ? "Type your full legal name to continue" : needsAddress && !address.trim() ? "Type your address to continue" : !png ? "Draw or type your signature to continue" : "";

  // The signing form in view hides the phone's bottom bar (it would repeat the button that's on screen).
  useEffect(() => {
    const el = formRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFormInView(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [canSign, view]);

  /** Scrolls the page to the signer's first field of a type (their signature by default). */
  const goToField = useCallback(
    (type: SignField["type"] = "signature") => {
      if (!view) return;
      const field = fields.find((f) => f.party === view.you.key && f.type === type) ?? fields.find((f) => f.party === view.you.key);
      const pageEl = field ? document.querySelector<HTMLElement>(`[data-page="${field.page}"]`) : null;
      if (!field || !pageEl) return;
      const rect = pageEl.getBoundingClientRect();
      const top = window.scrollY + rect.top + field.y * rect.height - window.innerHeight / 3;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    },
    [view, fields],
  );

  // Once signed, bring their signature into view on the freshly stamped page.
  useEffect(() => {
    if (done !== "signed" || !pdfUrl) return;
    const t = setTimeout(() => goToField("signature"), 500);
    return () => clearTimeout(t);
  }, [done, pdfUrl, goToField]);

  /** The first opening, counted once the document is on screen (a mail scanner fetching the link doesn't count). */
  const markOpened = useCallback(() => {
    if (preview || opened.current || !token) return;
    opened.current = true;
    void fetch("/api/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "opened", token }) }).catch(() => {});
  }, [preview, token]);

  async function post(action: "sign" | "decline") {
    if (preview) return;
    setBusy(true);
    setError("");
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "sign" ? { action, token, name, signature: png, address, consent: true, consentVersion: DISCLOSURE_VERSION, method, via, timeZone } : { action, token, reason },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message || "That didn’t go through. Check your connection and try again.");
      setConfirming(false);
      setDone(action === "sign" ? "signed" : "declined");
      window.scrollTo({ top: 0 });
      // The document as it now reads, with this signature on it.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    const ok = await confirm({
      title: "Decline to sign?",
      object: { name: view?.title ?? "", detail: reason.trim() ? `Your reason: ${reason.trim()}` : undefined },
      message: `This closes the request for everyone, and ${sender} is told. They would need to send a new request.`,
      irreversible: true,
      confirmLabel: "Decline and close",
      cancelLabel: "Keep the request",
      tone: "danger",
    });
    if (ok) await post("decline");
  }

  // A game mode: the theater or the racetrack comes first on a computer, every visit, until they sign. Always skippable.
  const inGame = !!view && isGameMode(view.mode) && canSign && !played;
  if (view && inGame) {
    const Gate = view.mode === "race" ? RaceGate : GameGate;
    return (
      <div data-theme="dark" className="ds min-h-dvh bg-page text-ink">
        <Gate
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
            pages: pages.length,
            sentBy: brand ? null : view.sentBy,
            role: view.you.entity ? `${view.you.title || "signer"} for ${view.you.entity}` : view.you.role || "a party",
            signPages,
            downloadUrl,
          }}
          preview={!!preview}
          onDone={() => {
            setVia("game");
            setPlayed(true);
          }}
          onSkip={() => {
            setVia("page");
            setPlayed(true);
          }}
          onDecline={() => {
            setVia("page");
            setPlayed(true);
            setDeclining(true);
            setTimeout(() => formRef.current?.scrollIntoView({ block: "start" }), 50);
          }}
        />
      </div>
    );
  }

  const today = format.date(new Date(), "long");
  const footerNote = brand ? "Signed electronically" : "Signed through BFO, Burton Family Office";

  return (
    <div className="ds min-h-dvh bg-page text-body text-ink">
      <div className="mx-auto w-full max-w-[880px] px-4 pt-6 pb-32 sm:px-8 sm:pt-10">
        <header className="flex items-center justify-between gap-4">
          {brand ? (
            <p className="min-w-0 truncate text-section text-ink">{brand}</p>
          ) : (
            <p className="font-brand leading-none text-ink" style={{ fontSize: 20 }} aria-label="BFO, Burton Family Office">
              BFO
            </p>
          )}
          {view?.sentBy && !brand && <p className="text-right text-small text-ink-2">Sent by {view.sentBy}</p>}
        </header>

        {loadError && !view && (
          <main className="mt-16 max-w-[480px]">
            <h1 className="text-heading text-balance">{loadError.title}</h1>
            <p className="mt-2 text-body text-ink-2 text-pretty">{loadError.message}</p>
          </main>
        )}

        {!view && !loadError && (
          <div className="mt-10 flex flex-col gap-3" aria-busy>
            <div className="h-[22px] w-2/3 rounded-mark bg-sunken" />
            <div className="h-[14px] w-1/3 rounded-mark bg-sunken" />
          </div>
        )}

        {view && view.status === "voided" && (
          <main className="mt-10">
            <h1 className="text-heading text-balance">{view.title}</h1>
            <Banner tone="info" className="mt-6" title="This request was withdrawn.">
              {`${view.sentBy || "The sender"} withdrew it${view.voidedAt ? ` on ${format.date(view.voidedAt, "medium")}` : ""}. `}
              {view.replaced ? "A new request replaced it: look for a newer email, and sign that one instead." : "Nothing more is needed from you."}
            </Banner>
          </main>
        )}

        {view && view.status !== "voided" && (
          <main>
            <h1 className="mt-8 text-heading text-balance">{view.title}</h1>
            <p className="mt-1 text-body text-ink-2">
              {format.count(pages.length, "page")}
              {view.documentId ? (
                <>
                  {" · "}
                  <span title={`SHA-256 ${view.documentId}`}>Document ID {shortSha(view.documentId)}</span>
                </>
              ) : null}
            </p>

            {/* Where they stand. */}
            <div className="mt-6">
              {view.status === "completed" ? (
                <Banner tone="positive" title="Signed by everyone.">
                  {view.completedAt ? `Completed ${format.date(view.completedAt, "medium")}. ` : ""}
                  The signed copy, with its certificate, is below and in your email.
                </Banner>
              ) : signedNow ? (
                <Banner tone="positive" title="Signed. Thank you.">
                  {`Waiting on ${format.list(others.filter((p) => p.status !== "signed").map((p) => p.name || p.role)) || "the other party"}. This page updates when they sign, and the signed copy will be emailed to you.`}
                </Banner>
              ) : view.status === "declined" || done === "declined" ? (
                <Banner tone="info" title={view.you.status === "declined" || done === "declined" ? "You declined to sign this." : "This request is closed."}>
                  {view.you.status === "declined" || done === "declined"
                    ? `${sender} has been told. Nothing more is needed from you.`
                    : `${others.find((p) => p.status === "declined")?.name || "Another party"} declined to sign, so nobody signs it. Nothing more is needed from you.`}
                </Banner>
              ) : (
                <p className="text-body text-pretty">
                  You’re signing {capacity}. {mine.length ? `${what.charAt(0).toUpperCase()}${what.slice(1)} ${mine.length === 1 ? "goes" : "go"} where the page is marked${whereText}.` : ""}
                </p>
              )}
            </div>

            {/* The document, and the ways to keep it. */}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {view.completed && downloadUrl ? (
                <a href={downloadUrl} className={linkButton("primary")}>
                  <Icon name="download" />
                  Download the signed copy
                </a>
              ) : downloadUrl ? (
                <a href={downloadUrl} download={`${view.title.replace(/[^\w .&-]+/g, " ").trim() || "Document"}.pdf`} className={linkButton("secondary")}>
                  <Icon name="download" />
                  Download as PDF
                </a>
              ) : null}
              {canSign && signPages.length > 0 && (
                <Button variant="quiet" onClick={() => goToField("signature")}>
                  Go to your signature
                </Button>
              )}
            </div>
            {view.completed && view.signedSha && (
              <p className="mt-2 text-small break-all text-ink-2">
                Signed copy SHA-256: <span className="tabular-nums">{view.signedSha}</span>
              </p>
            )}

            <section ref={frameRef} aria-label="The document" className="mt-4 rounded-card bg-sunken p-2 sm:p-6">
              {width > 0 && (
                <PdfPages
                  src={pdfUrl}
                  pages={pages}
                  width={width - 4}
                  onDrawn={markOpened}
                  overlay={(page) =>
                    canSign
                      ? fields
                          .filter((f) => f.page === page)
                          .map((f) => {
                            const yours = f.party === view.you.key;
                            return (
                              <div
                                key={f.id}
                                aria-hidden
                                className={cx("absolute rounded-mark", yours ? "border-2 border-accent bg-accent-tint" : "border border-dashed border-edge")}
                                style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, opacity: yours ? 0.85 : 0.6 }}
                              >
                                {yours && (
                                  <span className="absolute bottom-full left-0 mb-[2px] rounded-mark bg-accent px-1 text-caption font-medium whitespace-nowrap text-on-accent">
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
            </section>

            {canSign && (
              <section ref={formRef} id="sign" aria-labelledby="sign-title" className="mt-6 scroll-mt-4 rounded-card border border-line bg-raised p-4 sm:p-5">
                <h2 id="sign-title" className="text-section">
                  Sign
                </h2>
                <div className="mt-4 flex flex-col gap-4">
                  <Field
                    label="Your full legal name"
                    hint={
                      differs
                        ? `This isn’t the name the request was sent to (${view.you.name}). It’s recorded as you type it.`
                        : view.you.entity
                          ? `Stamped as “${view.you.entity}, by: ${name.trim() || "your name"}${view.you.title ? `, ${view.you.title}` : ""}”.`
                          : undefined
                    }
                  >
                    <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  </Field>
                  {needsAddress && (
                    <Field label="Your address" hint="It goes in the address box on the document, with your signature.">
                      <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Street, city, state, ZIP" autoComplete="street-address" />
                    </Field>
                  )}
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-small font-medium text-ink">Your signature</span>
                    <SignaturePad
                      name={name}
                      onChange={(p, m) => {
                        setPng(p);
                        setMethod(m);
                      }}
                    />
                  </div>
                </div>
                {error && !confirming && (
                  <Banner tone="negative" className="mt-4">
                    {error}
                  </Banner>
                )}
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    variant="primary"
                    size={phone ? "lg" : "md"}
                    full={phone}
                    disabled={busy || !!missing || !!preview}
                    disabledReason={preview ? "This is a preview: nothing is signed or saved" : missing || undefined}
                    onClick={() => {
                      setAgreed(false);
                      setError("");
                      setConfirming(true);
                    }}
                  >
                    Sign
                  </Button>
                  {(preview || missing) && <p className="text-small text-ink-2">{preview ? "This is a preview: nothing is signed or saved." : missing}.</p>}
                </div>

                {!preview && (
                  <div className="mt-4 border-t border-line pt-4">
                    {!declining ? (
                      <Button
                        variant="quiet"
                        className="-ml-3"
                        onClick={() => {
                          setDeclining(true);
                          setTimeout(() => reasonRef.current?.focus(), 30);
                        }}
                      >
                        I’d rather not sign
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-4">
                        <Field label="Reason" optional hint={`${sender} sees it.`}>
                          <Textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Tell them why" />
                        </Field>
                        <p className="text-body text-ink-2 text-pretty">
                          Declining closes this request for everyone. {sender} will be told, with your reason. You can’t undo this; they would need to send a new request.
                        </p>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                          <Button
                            variant="quiet"
                            onClick={() => {
                              setDeclining(false);
                              setReason("");
                            }}
                          >
                            Never mind
                          </Button>
                          <Button busy={busy} busyLabel="Declining…" onClick={decline}>
                            Decline and close this request
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </main>
        )}

        <footer className="mt-12 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption text-ink-2">
          <span>{footerNote}</span>
          <span aria-hidden>·</span>
          <button type="button" className="cursor-pointer underline-offset-[3px] hover:text-ink hover:underline" onClick={() => setReading(true)}>
            Electronic records disclosure
          </button>
          <span aria-hidden>·</span>
          <Link to="/legal/privacy" className="underline-offset-[3px] hover:text-ink hover:underline">
            Privacy
          </Link>
        </footer>
      </div>

      {/* The phone's bar: where to sign, and a way there, until the form is on screen. */}
      {phone && canSign && !formInView && !confirming && (
        <div
          data-floating
          className="ds fixed inset-x-0 bottom-0 z-fab flex items-center gap-3 border-t border-line bg-raised px-4 pt-3"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <p className="min-w-0 flex-1 text-small text-ink-2">{signPages.length ? `Your signature goes on page ${format.list(signPages.map(String))}` : "Read it, then sign"}</p>
          <Button variant="primary" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            Go to sign
          </Button>
        </div>
      )}

      {view && (
        <Dialog
          open={confirming}
          onClose={() => !busy && setConfirming(false)}
          title={`Sign ${view.title}?`}
          size="md"
          initialFocus={introRef}
          footer={
            <>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                Go back
              </Button>
              <Button variant="primary" disabled={!agreed} disabledReason={!agreed ? "Tick the box to agree first" : undefined} busy={busy} busyLabel="Signing…" onClick={() => post("sign")}>
                Agree and sign
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 text-pretty">
            <p ref={introRef} tabIndex={-1} className="outline-none">
              You’re signing as <span className="font-medium">{name.trim()}</span>
              {view.you.entity ? `, for ${view.you.entity} as its ${view.you.title || "signer"}` : ""}. Your signature and the date ({today}) go on the document{whereText}.
            </p>
            {differs && (
              <p className="text-body text-ink-2">
                The request was sent to {view.you.name}. If {name.trim()} is the right name, carry on; it’s recorded as you typed it.
              </p>
            )}
            {png && (
              <div className="flex h-[84px] items-center justify-center rounded-card border border-line bg-paper px-4">
                <img src={png} alt="Your signature" className="max-h-[64px] max-w-full" />
              </div>
            )}
            <div>
              <h3 className="text-small font-medium text-ink">Use electronic records and signatures</h3>
              <ul className="mt-2 flex flex-col gap-1 text-body text-ink-2">
                {consentPoints(sender).map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" />
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
              <Disclosure label="Read the full disclosure" className="mt-2">
                <DisclosureText sender={sender} />
              </Disclosure>
            </div>
            <Checkbox checked={agreed} onChange={setAgreed} label="I agree to use electronic records and signatures for this document" />
            {error && <Banner tone="negative">{error}</Banner>}
          </div>
        </Dialog>
      )}

      <Dialog
        open={reading}
        onClose={() => setReading(false)}
        title="Electronic records and signatures disclosure"
        description={`Effective ${DISCLOSURE_EFFECTIVE}`}
        size="lg"
        footer={<Button onClick={() => setReading(false)}>Close</Button>}
      >
        <DisclosureText sender={sender === "the sender" ? "the sender" : sender} />
      </Dialog>
    </div>
  );
}

/** The full disclosure, in reading type. */
function DisclosureText({ sender }: { sender: string }) {
  return (
    <div className="flex max-w-[68ch] flex-col gap-4 pt-2 text-body text-ink">
      {disclosureSections(sender).map((s) => (
        <section key={s.heading}>
          <h4 className="text-small font-semibold text-ink">{s.heading}</h4>
          {s.paragraphs.map((p) => (
            <p key={p} className="mt-1 text-ink-2 text-pretty">
              {p}
            </p>
          ))}
        </section>
      ))}
      <p className="text-small text-ink-2">Version {DISCLOSURE_VERSION}. Questions about how your information is handled are answered above; BFO’s general privacy notice is on the Privacy page.</p>
    </div>
  );
}
