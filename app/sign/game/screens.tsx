// The screens the two signing games share (the theater, app/sign/game, and
// the racetrack, app/sign/kart): the title screen before a computer starts
// the game, and the screen a phone or tablet gets instead. Both are a dark
// region on the design system's tokens (docs/DESIGN.md §2.1: a game, like
// the media viewer, is always dark).
//
// The game is never a gate. From the first frame every signer can read the
// document, go straight to the signing page, or decline, on any device; the
// signing page, its consent and the record are the same whichever way they
// come (the certificate says which).
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, buttonClasses, cx, format } from "../../ui";

/** The document as the games describe it. */
export type GameDocument = { fileName: string; pages: number; sentBy: string | null; role: string; signPages: number[]; downloadUrl?: string | null };

/** The translucent chrome over a 3D scene (the media viewer's rule, §2.5): black at 60%, always. */
export const CHROME: CSSProperties = { background: "rgb(0 0 0 / 0.6)" };

/** The document: its title, length, sender and where the signature goes. */
function DocumentCard({ title, document }: { title: string; document?: GameDocument }) {
  return (
    <div className="flex w-full items-start gap-4 rounded-card border border-line bg-raised p-4 text-left">
      <span aria-hidden className="flex h-14 w-11 shrink-0 items-center justify-center rounded-mark bg-paper text-caption font-semibold text-brand-ink">
        PDF
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium break-words text-ink">{title}</span>
        {document && (
          <span className="mt-1 block text-small text-ink-2">
            {format.count(document.pages, "page")}
            {document.sentBy ? ` · from ${document.sentBy}` : ""} · you sign as {document.role}
            {document.signPages.length > 0 ? ` · your signature goes on page ${format.list(document.signPages.map(String))}` : ""}
          </span>
        )}
        {document && <span className="mt-1 block text-caption break-all text-ink-3">{document.fileName}</span>}
      </span>
    </div>
  );
}

/** The ways past the game, shown from the first frame: read, sign now, decline. */
function WaysOut({ document, onSkip, onDecline, primary }: { document?: GameDocument; onSkip: () => void; onDecline?: () => void; primary: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      {primary}
      <Button onClick={onSkip} size="lg">
        Read and sign now
      </Button>
      {document?.downloadUrl && (
        <a href={document.downloadUrl} className={cx(buttonClasses({ variant: "quiet", size: "lg" }), "hover:bg-hover hover:text-ink")}>
          Read the document
        </a>
      )}
      {onDecline && (
        <Button variant="quiet" size="lg" onClick={onDecline}>
          I’d rather not sign
        </Button>
      )}
    </div>
  );
}

/**
 * The title screen on a computer: who it's from, the document, what comes
 * first and how long, and the ways in and out. The button that starts the
 * game says so ("Start the film"); signing is a separate, plain step.
 */
export function TitleScreen({
  title,
  brand,
  document,
  preview,
  kind,
  loading,
  onStart,
  onSkip,
  onDecline,
}: {
  title: string;
  brand: string | null;
  document?: GameDocument;
  preview?: boolean;
  kind: "film" | "race";
  loading: "loading" | "ready" | "failed";
  onStart: () => void;
  onSkip: () => void;
  onDecline?: () => void;
}) {
  const what = kind === "film" ? "A short film comes first, about three minutes. Sound on." : "A two-lap race comes first, about three minutes. Sound on.";
  const start = kind === "film" ? "Start the film" : "Start the race";
  const getting = kind === "film" ? "Getting the theater ready…" : "Getting the track ready…";
  return (
    <div data-theme="dark" className="ds absolute inset-0 z-30 flex flex-col overflow-y-auto bg-page text-ink">
      {preview && <span className="absolute top-4 right-4 rounded-full bg-sunken px-3 py-1 text-caption font-medium text-ink-2">Preview · {kind === "film" ? "Theater" : "Race"}</span>}
      <div className="m-auto flex w-full max-w-[600px] flex-col items-center gap-6 px-6 py-12 text-center">
        <p className="text-small text-ink-2">{brand ? `A document from ${brand}` : "A document from Burton Family Office"}</p>
        <h1 className="font-brand text-balance text-ink" style={{ fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.08 }}>
          {title}
        </h1>
        <DocumentCard title={title} document={document} />
        <p className="text-body text-ink-2">{what} It’s optional: you can read and sign straight away.</p>
        <WaysOut
          document={document}
          onSkip={onSkip}
          onDecline={preview ? undefined : onDecline}
          primary={
            loading === "failed" ? null : (
              <Button variant="primary" size="lg" busy={loading === "loading"} busyLabel={getting} disabled={loading !== "ready"} onClick={onStart}>
                {start}
              </Button>
            )
          }
        />
        {loading === "failed" && <p className="text-body text-ink-2">This browser couldn’t run it. Read and sign the usual way instead.</p>}
      </div>
    </div>
  );
}

/**
 * What a phone or tablet gets instead of the game: the document by name, the
 * plain signing page as the first choice, and the game as something to see on
 * a computer if they'd like.
 */
export function PhoneScreen({
  title,
  brand,
  document,
  preview,
  kind = "film",
  onSkip,
  onDecline,
}: {
  title: string;
  brand: string | null;
  document?: GameDocument;
  preview?: boolean;
  kind?: "film" | "race";
  onSkip: () => void;
  onDecline?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the address bar still has it */
    }
  };
  return (
    <div data-theme="dark" className="ds min-h-dvh bg-page text-body text-ink">
      <div className="mx-auto flex max-w-[520px] flex-col gap-6 px-4 pt-6" style={{ paddingBottom: "max(32px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-small text-ink-2">{brand ? `A document from ${brand}` : "A document from Burton Family Office"}</p>
          {preview && <span className="rounded-full bg-sunken px-3 py-1 text-caption font-medium text-ink-2">Preview · {kind === "film" ? "Theater" : "Race"}</span>}
        </div>
        <DocumentCard title={title} document={document} />
        <div>
          <h1 className="text-heading text-balance">Read and sign it here</h1>
          <p className="mt-2 text-body text-ink-2 text-pretty">
            {kind === "film" ? "On a computer, a short film plays before the signing page." : "On a computer, a two-lap race comes before the signing page."} It’s optional. The document, the signing
            page and your signature are the same either way.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" full onClick={onSkip}>
            Read and sign now
          </Button>
          <Button size="lg" full onClick={copy}>
            {copied ? "Link copied" : `Copy the link to ${kind === "film" ? "watch the film" : "race"} on a computer`}
          </Button>
          {onDecline && !preview && (
            <Button variant="quiet" size="lg" full onClick={onDecline}>
              I’d rather not sign
            </Button>
          )}
        </div>
        <p className="text-center text-caption text-ink-2">{brand ? "Signed electronically" : "Signed through BFO, Burton Family Office"}</p>
      </div>
    </div>
  );
}

/** The way past the game once it's running, from the first frame, at a size and contrast anyone can read. */
export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button type="button" onClick={onSkip} className="ds absolute right-4 bottom-4 z-30 h-11 cursor-pointer rounded-full px-4 text-small font-medium text-ink hover:bg-hover" style={CHROME}>
      Skip to the signing page
    </button>
  );
}
