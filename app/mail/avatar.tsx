import { createContext, useContext, useEffect, useState } from "react";
import { useTone } from "../entity/ui";
import type { MailAddress, MailFaces } from "../mail-client";
import { brandDomain, hueOf, senderLabel } from "./helpers";

/** Logos that loaded, and domains that have none — so a list doesn't flicker as it re-renders. */
const logoState = new Map<string, "ok" | "none">();

/** The pictures people here chose for their mail, by address (lowercase). */
export const FacesContext = createContext<MailFaces>({});

/**
 * Who the message is from, at a glance: the picture they chose, when they're
 * one of us and picked one; a company's logo when the sender is a company
 * (fetched by domain; falls back to initials if there is none); else initials
 * in a colour that is always the same for that person.
 */
export function Avatar({ a, size = "h-10 w-10 text-[13px]", trusted = true }: { a: MailAddress; size?: string; trusted?: boolean }) {
  // A From that SPF/DKIM don't vouch for could be forged: never dress it in a colleague's photo.
  const faces = useContext(FacesContext);
  const photo = trusted ? faces[a.email.toLowerCase()] : undefined;
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (photo && broken !== photo) {
    // The initials show until the picture has arrived; then it fades in over them.
    return (
      <span aria-hidden="true" className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${size}`}>
        {loaded !== photo && (
          <span className="absolute inset-0">
            <InitialsAvatar a={a} size={`h-full w-full ${size.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`} />
          </span>
        )}
        <img
          src={photo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`relative h-full w-full object-cover transition-opacity duration-300 ${loaded === photo ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(photo)}
          onError={() => setBroken(photo)}
        />
      </span>
    );
  }
  return <InitialsAvatar a={a} size={size} />;
}

function InitialsAvatar({ a, size }: { a: MailAddress; size: string }) {
  const { dark } = useTone();
  const domain = brandDomain(a);
  const [logo, setLogo] = useState<"ok" | "none" | "loading">(() => (domain ? (logoState.get(domain) ?? "loading") : "none"));
  useEffect(() => {
    setLogo(domain ? (logoState.get(domain) ?? "loading") : "none");
  }, [domain]);
  const hue = hueOf(a.email.toLowerCase());
  const label = senderLabel(a);
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
  const showLogo = domain && logo !== "none";
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${size} ${
        showLogo ? (dark ? "bg-white ring-1 ring-white/10" : "bg-white ring-1 ring-gray-200") : ""
      }`}
      style={showLogo ? undefined : { background: dark ? `hsl(${hue} 40% 22%)` : `hsl(${hue} 70% 92%)`, color: dark ? `hsl(${hue} 70% 80%)` : `hsl(${hue} 50% 32%)` }}
    >
      {showLogo ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`h-[62%] w-[62%] object-contain transition-opacity ${logo === "ok" ? "opacity-100" : "opacity-0"}`}
          onLoad={(e) => {
            // Google answers a tiny default globe when a site has no icon; treat that as none.
            const img = e.currentTarget;
            const none = img.naturalWidth <= 16;
            logoState.set(domain, none ? "none" : "ok");
            setLogo(none ? "none" : "ok");
          }}
          onError={() => {
            logoState.set(domain, "none");
            setLogo("none");
          }}
        />
      ) : (
        initials
      )}
      {showLogo && logo === "loading" && <span className="absolute inset-0 animate-pulse bg-gray-200/40" />}
    </span>
  );
}

