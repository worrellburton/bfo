import { hostState, stateCode } from "../app/entity-paperwork.js";
import { palm, palmMode } from "./palm.js";
import { baseName, normalizeName, pickRegistryMatch, searchName, toStateRecord, type RegistryRecord, type StateRecord } from "./registry.js";
import { applyOps, readCollection, type TreeOp } from "./tree.js";

/**
 * Every entity's record as its states have it, read through Palm: the home
 * state's and each state it's registered in as a foreign entity. Run by the
 * daily cron (api/cron/state-records.ts) and on demand. What the state has
 * fills our blanks (file number, agent, agent's address) and never overwrites
 * what's there; the differences are flagged on the entity page instead.
 */

/** A record read more recently than this isn't read again. */
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const ACTOR = { id: null, name: "BFO", source: "system" } as const;

type Rec = {
  name?: string;
  status?: string;
  type?: string;
  state?: string;
  address?: string;
  fileNumber?: string;
  registeredAgent?: string;
  registeredAgentAddress?: string;
  stateRecord?: StateRecord;
  /** A state whose registry had no entry (or several) for it, and when that was found. */
  registryMiss?: Record<string, { outcome: "not_found" | "ambiguous"; at: number }>;
  foreign?: Record<string, { agent?: string; agentAddress?: string; fileNumber?: string; record?: StateRecord; notNeeded?: boolean }>;
  palm?: Record<string, { formation?: { status?: string } | null } | undefined>;
};

export type CheckResult = { id: string; name: string; state: string; outcome: "read" | "fresh" | "not_found" | "ambiguous" | "error"; detail?: string };

/** The states to read for one entity: home first, then each foreign one. */
export function statesToRead(a: Rec): { code: string; home: boolean }[] {
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

/** One state's record for one entity, or why not. */
async function read(name: string, code: string, fileNumber: string | undefined, mode: "test" | "live"): Promise<StateRecord | "not_found" | "ambiguous"> {
  const jurisdiction = `US-${code}`;
  let number = fileNumber?.trim();
  let where = jurisdiction;
  if (!number) {
    const r = await palm<{ data: RegistryRecord[] }>("/v1/business/registry/search", { method: "POST", body: { name: searchName(name), registration_jurisdiction: jurisdiction } });
    const results = r?.data ?? [];
    const match = pickRegistryMatch(results, name, jurisdiction);
    if (!match) return results.some((x) => baseName(x.name) === baseName(name)) ? "ambiguous" : "not_found";
    number = match.registration_number;
    where = match.registration_jurisdiction || jurisdiction;
    if (!number) return "not_found";
  }
  const record = await palm<RegistryRecord>(`/v1/business/registry/${where}/${encodeURIComponent(number)}`);
  return toStateRecord(record, mode);
}

/** What to write once a state's record is in: the record, and our blanks filled. */
export function patchFor(a: Rec, code: string, home: boolean, rec: StateRecord, live: boolean): Record<string, unknown> {
  const snap = JSON.parse(JSON.stringify(rec));
  if (home) {
    const p: Record<string, unknown> = { stateRecord: snap };
    if (!live) return p;
    if (!a.fileNumber && rec.registrationNumber) p.fileNumber = rec.registrationNumber;
    const sameAgent = !a.registeredAgent || normalizeName(a.registeredAgent) === normalizeName(rec.agent ?? "");
    // "Secretary of State" as agent means there isn't one: never copy it in.
    const real = !!rec.agent && !/secretary of state/i.test(rec.agent);
    if (real && !a.registeredAgent?.trim()) p.registeredAgent = rec.agent;
    if (real && sameAgent && !a.registeredAgentAddress?.trim() && rec.agentAddress) p.registeredAgentAddress = rec.agentAddress;
    return p;
  }
  const f = a.foreign?.[code] ?? {};
  const p: Record<string, unknown> = { [`foreign/${code}/record`]: snap };
  if (!live) return p;
  const real = !!rec.agent && !/secretary of state/i.test(rec.agent);
  if (!f.fileNumber && rec.registrationNumber) p[`foreign/${code}/fileNumber`] = rec.registrationNumber;
  if (real && !f.agent?.trim()) p[`foreign/${code}/agent`] = rec.agent;
  if (real && !f.agentAddress?.trim() && rec.agentAddress && (!f.agent || normalizeName(f.agent) === normalizeName(rec.agent))) p[`foreign/${code}/agentAddress`] = rec.agentAddress;
  return p;
}

/** Read every entity's state records that aren't fresh (or all of `ids`, fresh or not). */
export async function checkStateRecords(opts: { ids?: string[]; force?: boolean; now?: number } = {}): Promise<CheckResult[]> {
  const mode = palmMode();
  if (!mode) throw new Error("Palm isn't connected.");
  const now = opts.now ?? Date.now();
  const rows = (await readCollection("assets")).filter((r) => !opts.ids || opts.ids.includes(r.id));
  const out: CheckResult[] = [];
  for (const row of rows) {
    const a = (row.data ?? {}) as Rec;
    if (!a.name) continue;
    for (const { code, home } of statesToRead(a)) {
      const prior = home ? a.stateRecord : a.foreign?.[code]?.record;
      const base = { id: row.id, name: a.name, state: code };
      const miss = a.registryMiss?.[code];
      if (!opts.force && ((prior && prior.mode === mode && now - prior.checkedAt < FRESH_MS) || (!prior && miss && now - miss.at < FRESH_MS))) {
        out.push({ ...base, outcome: "fresh" });
        continue;
      }
      try {
        const got = await read(a.name, code, home ? a.fileNumber : a.foreign?.[code]?.fileNumber, mode);
        if (typeof got === "string") {
          await applyOps([{ op: "update", path: ["assets", row.id], value: { [`registryMiss/${code}`]: { outcome: got, at: now } } }]);
          out.push({ ...base, outcome: got });
          continue;
        }
        const patch = { ...patchFor(a, code, home, got, mode === "live"), ...(miss ? { [`registryMiss/${code}`]: null } : {}) };
        const ops: TreeOp[] = [{ op: "update", path: ["assets", row.id], value: patch as never }];
        await applyOps(ops, ACTOR);
        out.push({ ...base, outcome: "read", detail: [got.status, got.agent].filter(Boolean).join(" · ") });
      } catch (err) {
        out.push({ ...base, outcome: "error", detail: (err as Error).message.slice(0, 200) });
      }
    }
  }
  return out;
}
