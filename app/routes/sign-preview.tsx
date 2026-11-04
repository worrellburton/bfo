import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { getUser } from "../auth";
import { GameStudio } from "../sign/game/studio";
import { canPreviewGame } from "../sign/preview";
import { SignPage } from "./sign";

export function meta() {
  return [{ title: "Preview the signing game · BFO" }];
}

/**
 * The whole game-mode sequence as a signer sees it, on a sample document,
 * for the one account whose menu offers it (app/sign/preview.ts): the theater,
 * or with ?game=race the racetrack. The final
 * Sign button is disabled: nothing is saved. The game studio sits on top:
 * it makes Judy's voice, the effects and the props on the server, and the
 * page restarts the game so they're heard and seen.
 */
export default function SignPreview() {
  const user = getUser();
  // Bumped when the studio made something: a fresh SignPage starts the game over with it.
  const [run, setRun] = useState(0);
  const [params] = useSearchParams();
  const mode = params.get("game") === "race" ? "race" : "game";
  if (!canPreviewGame(user)) return <Navigate to="/home" replace />;
  return (
    <>
      <SignPage key={`${mode}-${run}`} token="" preview={{ name: user?.name?.trim() || "Robert Burton", email: user?.email ?? "", mode }} />
      <GameStudio onChanged={() => setRun((n) => n + 1)} />
    </>
  );
}
