/**
 * Which entity may send the "Anything Is Possible" game (app/sign/game) in
 * front of its signing page: only TallulahMD LLC. Shared by api/sign.ts,
 * which refuses the game on any other request and serves every other signer
 * the plain page, and by the office's request page, which offers the game
 * only on that entity's requests. The entity is matched by name, written any
 * way, because that is how its record names it.
 *
 * Pure (no I/O, no HTTP surface, no env); the browser and the API both import it.
 */

export const GAME_ENTITY = "TallulahMD LLC";

/** True for TallulahMD LLC however it's spaced, cased or punctuated ("Tallulah MD, LLC"). */
export function isGameEntity(name: string | null | undefined): boolean {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .includes("tallulahmd");
}

/** The refusal when a request for any other entity, or for none, is set to the game. */
export const GAME_ONLY_MESSAGE = `The Anything Is Possible game is only for ${GAME_ENTITY}'s documents.`;
