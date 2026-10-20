import type { FormationOwner } from "../app/formation";

/**
 * The owners of an entity being formed: shared by the wizard (app/formation.ts
 * re-exports these) and the server, which stores them on the new record.
 */

export const emptyOwner = (kind: FormationOwner["kind"], percent = ""): FormationOwner => ({ kind, entityId: "", entityName: "", first: "", last: "", address: null, percent });

/** An owner's name as the filing and the record write it. (Picking an entity in BFO fills in its name.) */
export const ownerName = (o: FormationOwner) => (o.kind === "person" ? `${o.first.trim()} ${o.last.trim()}`.trim() : o.entityName.trim());

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
