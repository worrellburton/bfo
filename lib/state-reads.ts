import { hostState, stateCode } from "../app/entity-paperwork.js";
import { stateRecordCents } from "./palm-pricing.js";

/**
 * Which states' records to read for an entity, and what reading them costs.
 * Pure, so the daily check (lib/state-records.ts) and the entity page's
 * "Sync everything with Palm" agree on the states and the price.
 */

export type StateReadable = {
  name?: string;
  status?: string;
  type?: string;
  state?: string;
  address?: string;
  fileNumber?: string;
  foreign?: Record<string, { fileNumber?: string; notNeeded?: boolean }>;
  palm?: Record<string, { businessId?: string | null; formation?: { status?: string } | null } | undefined>;
};

/** The states to read for one entity: home first, then each foreign one. */
export function statesToRead(a: StateReadable): { code: string; home: boolean }[] {
  if (a.type === "Trust" || /\btrust\b/i.test(a.name ?? "") || a.status === "Dissolved") return [];
  const home = stateCode(a.state);
  if (!home) return [];
  // Still being formed: the state has nothing to read yet.
  if (Object.values(a.palm ?? {}).some((p) => p?.formation && p.formation.status !== "completed" && p.formation.status !== "canceled")) return [];
  const foreign = new Set(Object.entries(a.foreign ?? {}).filter(([c, f]) => c !== home && !f?.notNeeded).map(([c]) => c));
  const host = hostState(a);
  if (host && host !== home) foreign.add(host);
  return [{ code: home, home: true }, ...[...foreign].sort().map((code) => ({ code, home: false }))];
}


/**
 * What reading every state's record costs, state by state: the record alone
 * when its file number is on file, a name search first when it isn't. The
 * sandbox (test mode) isn't billed.
 */
export function stateReadCost(a: StateReadable, mode: "test" | "live" | null): { states: { code: string; home: boolean; cents: number }[]; cents: number } {
  const states = statesToRead(a).map(({ code, home }) => {
    const hasNumber = !!(home ? a.fileNumber : a.foreign?.[code]?.fileNumber)?.trim();
    return { code, home, cents: mode === "live" ? stateRecordCents(hasNumber) : 0 };
  });
  return { states, cents: states.reduce((n, s) => n + s.cents, 0) };
}


