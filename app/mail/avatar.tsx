import { createContext, useContext } from "react";
import { Avatar } from "../ui";
import type { MailAddress, MailFaces } from "../mail-client";
import { senderLabel } from "./helpers";

/** The pictures people here chose for their mail, by address (lowercase). */
export const FacesContext = createContext<MailFaces>({});

/**
 * Who a message is from, at a glance (§8.17): neutral initials, and the
 * picture a colleague chose for their mail fading in over them. Nothing else
 * is fetched: no company logos, so no correspondent's domain is sent to an
 * outside service, and the list stays one calm column. A From that SPF and
 * DKIM don't vouch for could be forged, so it never wears a colleague's
 * photo.
 */
export function MailAvatar({ a, size = 40, trusted = true, className }: { a: MailAddress; size?: 24 | 32 | 40; trusted?: boolean; className?: string }) {
  const faces = useContext(FacesContext);
  const photo = trusted ? faces[a.email.toLowerCase()] : undefined;
  return <Avatar name={senderLabel(a)} src={photo} size={size} className={className} />;
}
