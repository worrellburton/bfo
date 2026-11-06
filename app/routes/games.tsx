import { Navigate } from "react-router";
import { getUser } from "../auth";
import { canPreviewGame } from "../sign/preview";
import { Card, LinkButton, Page, PageHeader, useDocumentTitle, useTouch } from "../ui";

export function meta() {
  return [{ title: "Signing games · BFO" }];
}

/**
 * The signing games: what each one is and what a signer will meet (length,
 * sound, motion, what it needs), and Play, which runs it as a signer sees it
 * on a sample document and signs nothing (app/routes/sign-preview.tsx). The
 * games need a keyboard and a mouse, so a phone or tablet says so instead of
 * offering Play. Shown to the accounts app/sign/preview.ts allows, the same
 * rule the preview itself applies.
 */
const GAMES = [
  {
    id: "game",
    name: "Anything Is Possible",
    kind: "A trip to the movie theater",
    line: "A floating island, a chain of blocks to the theater, Judy (the guide) at the ticket booth, the seat with the signer’s name on it, a short film, and the door to the room with the document.",
    facts: "A few minutes · computer with a keyboard and mouse · sound and motion · not usable with a screen reader",
    to: "/sign/preview",
  },
  {
    id: "race",
    name: "The Racetrack",
    kind: "Two laps against Judy, the guide",
    line: "The signer drives two laps of about a minute each while Judy talks and bumps into them. The music changes for the last lap, and the signing page is at the finish.",
    facts: "About 2 minutes of driving · computer with a keyboard and mouse · sound and fast motion · a cartoon crash in which Judy is hurt · not usable with a screen reader",
    to: "/sign/preview?game=race",
  },
];

export default function Games() {
  useDocumentTitle("Signing games");
  const user = getUser();
  const touch = useTouch();
  if (!canPreviewGame(user)) return <Navigate to="/home" replace />;
  return (
    <Page width="reading" header={<PageHeader title="Signing games" context="Try each one as a signer would, on a sample document. Nothing gets signed." />}>
      {GAMES.map((g) => (
        <Card
          key={g.id}
          title={g.name}
          footer={
            touch ? (
              <p className="text-body text-ink-2">Open on a computer to play.</p>
            ) : (
              <LinkButton to={g.to} aria-label={`Play ${g.name}`}>
                Play
              </LinkButton>
            )
          }
        >
          <p className="text-small text-ink-2">{g.kind}</p>
          <p className="mt-2 text-body text-pretty text-ink">{g.line}</p>
          <p className="mt-3 text-small text-pretty text-ink-2">{g.facts}</p>
        </Card>
      ))}
      <p className="text-small text-pretty text-ink-2">A game is chosen when a document is sent for signature. Signers on a phone or tablet can’t play it.</p>
    </Page>
  );
}
