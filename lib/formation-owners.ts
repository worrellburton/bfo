import type { FormationOwner, PersonName } from "../app/formation";

/**
 * The owners of an entity being formed: shared by the wizard (app/formation.ts
 * re-exports these) and the server, which stores them on the new record.
 *
 * HTTP surface: none; pure functions.
 * Who may call it: the wizard and server code.
 * Env: none.
 */

export const emptyOwner = (kind: FormationOwner["kind"], percent = ""): FormationOwner => ({
  kind,
  entityKind: "company",
  entityId: "",
  entityName: "",
  trustee: "",
  trustDate: "",
  signer: "",
  signerTitle: "",
  name: { first: "", middle: "", last: "", suffix: "" },
  percent,
  contribution: "",
  contributionKind: "cash",
  contributionDate: "",
  contributionNote: "",
  title: "Member",
  address: null,
  email: "",
  phone: "",
  ssn: "",
});

/** "Jane A. Doe Jr." */
export const personName = (n: PersonName) =>
  [n.first, n.middle, n.last, n.suffix]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");

/** An owner's name as the record and the screens write it: the person, the company or the trust. */
export const ownerName = (o: FormationOwner) => (o.kind === "person" ? personName(o.name) : o.entityName.trim());

/** "2020-05-01" → "May 1, 2020" (the long form legal documents use), or "" for anything else. */
function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/**
 * The owner as a filing or an agreement names it. A trust holds title
 * through its trustee: "Jane Doe, Trustee of the Doe Family Trust dated May
 * 1, 2020". Everyone else, as ownerName.
 */
export function ownerFilingName(o: FormationOwner): string {
  if (o.kind !== "entity" || o.entityKind !== "trust") return ownerName(o);
  const trust = o.entityName.trim().replace(/^the\s+/i, "");
  const trustee = (o.trustee ?? "").trim();
  if (!trust) return "";
  const dated = longDate(o.trustDate ?? "");
  return `${trustee ? `${trustee}, Trustee of ` : ""}the ${trust}${dated ? ` dated ${dated}` : ""}`;
}

/** "60", "60%", "33.33" → the number; anything else → NaN. */
export const ownerPercent = (o: FormationOwner) => (/^\s*\d+(\.\d+)?\s*%?\s*$/.test(o.percent) ? Number.parseFloat(o.percent) : Number.NaN);

/** The owners' shares added up, to the hundredth. */
export const ownersTotal = (owners: FormationOwner[]) => Math.round(owners.reduce((n, o) => n + (ownerPercent(o) || 0), 0) * 100) / 100;

/** Where the entity sits on the estate map: its largest owner that's already in BFO. */
export function parentOwnerId(owners: FormationOwner[]): string {
  let best: FormationOwner | null = null;
  for (const o of owners) if (o.kind === "entity" && o.entityId && (!best || (ownerPercent(o) || 0) > (ownerPercent(best) || 0))) best = o;
  return best?.entityId ?? "";
}
