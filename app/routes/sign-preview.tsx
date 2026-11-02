import { Navigate } from "react-router";
import { getUser } from "../auth";
import { canPreviewGame } from "../sign/preview";
import { SignPage } from "./sign";

export function meta() {
  return [{ title: "Preview the signing game · BFO" }];
}

/**
 * The whole game-mode sequence as a signer sees it, on a sample document,
 * for the one account whose menu offers it (app/sign/preview.ts). The final
 * Sign button is disabled: nothing is saved.
 */
export default function SignPreview() {
  const user = getUser();
  if (!canPreviewGame(user)) return <Navigate to="/home" replace />;
  return <SignPage token="" preview={{ name: user?.name?.trim() || "Robert Burton", email: user?.email ?? "" }} />;
}
