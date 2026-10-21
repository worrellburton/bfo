import type { FormationOwner, PersonName } from "../app/formation";

/**
 * The owners of an entity being formed: shared by the wizard (app/formation.ts
 * re-exports these) and the server, which stores them on the new record.
 */

export const emptyOwner = (kind: FormationOwner["kind"], percent = ""): FormationOwner => ({
  kind,
  entityId: "",
  entityName: "",
  name: { first: "", middle: "", last: "", suffix: "" },
  percent,
  title: "Member",
  address: null,
  email: "",
  phone: "",
  ssn: "",
});

/** "Jane A. Doe Jr." */
export const personName = (n: PersonName) => [n.first, n.middle, n.last, n.suffix].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

/** An owner's name as the filing and the record write it. */
export const ownerName = (o: FormationOwner) => (o.kind === "person" ? personName(o.name) : o.entityName.trim());

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
