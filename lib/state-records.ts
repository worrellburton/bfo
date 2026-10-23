import { palm, palmMode, type PalmUsage } from "./palm.js";
import { baseName, normalizeName, peoplePatch, pickRegistryMatch, searchName, toStateRecord, type RegistryRecord, type StateRecord } from "./registry.js";
import { applyOps, readCollection, readRows, type TreeOp } from "./tree.js";
import { statesToRead } from "./state-reads.js";

export { statesToRead } from "./state-reads.js";

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
  members?: unknown[] | Record<string, unknown> | null;
  ownerId?: string | null;
  stateRecord?: StateRecord;
  /** A state whose registry had no entry (or several) for it, and when that was found. */
  registryMiss?: Record<string, { outcome: "not_found" | "ambiguous"; at: number; mode?: "test" | "live" }>;
  foreign?: Record<string, { agent?: string; agentAddress?: string; fileNumber?: string; record?: StateRecord; notNeeded?: boolean }>;
  palm?: Record<string, { formation?: { status?: string } | null } | undefined>;
};

/** "later": not read because the run's time was up (the next run reads it). */
export type CheckResult = { id: string; name: string; state: string; outcome: "read" | "fresh" | "not_found" | "ambiguous" | "error" | "later"; detail?: string };

/** One state's record for one entity, or why not. */
async function read(name: string, code: string, fileNumber: string | undefined, mode: "test" | "live", usage: PalmUsage): Promise<StateRecord | "not_found" | "ambiguous"> {
  const jurisdiction = `US-${code}`;
  let number = fileNumber?.trim();
  let where = jurisdiction;
  if (!number) {
    const r = await palm<{ data: RegistryRecord[] }>("/v1/business/registry/search", { method: "POST", body: { name: searchName(name), registration_jurisdiction: jurisdiction }, usage });
    const results = r?.data ?? [];
    const match = pickRegistryMatch(results, name, jurisdiction);
    if (!match) return results.some((x) => baseName(x.name) === baseName(name)) ? "ambiguous" : "not_found";
    number = match.registration_number;
    where = match.registration_jurisdiction || jurisdiction;
    if (!number) return "not_found";
  }
  const record = await palm<RegistryRecord>(`/v1/business/registry/${where}/${encodeURIComponent(number)}`, { usage });
  return toStateRecord(record, mode);
}

/** What to write once a state's record is in: the record, and our blanks filled (People too, from the home state). */
export function patchFor(a: Rec, code: string, home: boolean, rec: StateRecord, live: boolean, ownerName?: string | null): Record<string, unknown> {
  const snap = JSON.parse(JSON.stringify(rec));
  if (home) {
    const p: Record<string, unknown> = { stateRecord: snap };
    if (!live) return p;
    Object.assign(p, peoplePatch(a, ownerName, rec, live));
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
/**
 * `freshMs`: how recent a record must be to be kept rather than read again (a week by default; `force` reads
 * everything). `deadline`: a time (ms) after which no more reads start, so a run inside a time-limited
 * function ends cleanly; what's left reports "later".
 */
export async function checkStateRecords(opts: { ids?: string[]; force?: boolean; freshMs?: number; deadline?: number; now?: number; by?: { id: string; name: string | null } } = {}): Promise<CheckResult[]> {
  const mode = palmMode();
  if (!mode) throw new Error("Palm isn't connected.");
  const now = opts.now ?? Date.now();
  const all = await readCollection("assets");
  const names = new Map(all.map((r) => [r.id, ((r.data ?? {}) as Rec).name ?? null]));
  const rows = all.filter((r) => !opts.ids || opts.ids.includes(r.id));
  const out: CheckResult[] = [];
  for (const row of rows) {
    const a = (row.data ?? {}) as Rec;
    if (!a.name) continue;
    for (const { code, home } of statesToRead(a)) {
      const prior = home ? a.stateRecord : a.foreign?.[code]?.record;
      const base = { id: row.id, name: a.name, state: code };
      // A miss found in the other mode (a sandbox search, say) says nothing about this one.
      const miss = a.registryMiss?.[code];
      const missHere = miss && (miss.mode ?? mode) === mode ? miss : undefined;
      const fresh = opts.freshMs ?? FRESH_MS;
      if (!opts.force && ((prior && prior.mode === mode && now - prior.checkedAt < fresh) || (!prior && missHere && now - missHere.at < fresh))) {
        out.push({ ...base, outcome: "fresh" });
        continue;
      }
      if (opts.deadline && Date.now() > opts.deadline) {
        out.push({ ...base, outcome: "later" });
        continue;
      }
      try {
        const usage: PalmUsage = opts.by
          ? { actorId: opts.by.id, actorName: opts.by.name, assetId: row.id, reason: `State record (${code}), check all` }
          : { actorName: "Daily check", assetId: row.id, reason: `State record (${code})` };
        const got = await read(a.name, code, home ? a.fileNumber : a.foreign?.[code]?.fileNumber, mode, usage);
        if (typeof got === "string") {
          await applyOps([{ op: "update", path: ["assets", row.id], value: { [`registryMiss/${code}`]: { outcome: got, at: now, mode } } }]);
          out.push({ ...base, outcome: got });
          continue;
        }
        // Blanks are filled against the entity as it is now, not as the run first read it: someone may have
        // typed in People or the agent while the state answered.
        const current = (((await readRows("assets", [row.id]))[0]?.data ?? a) as Rec);
        const patch = { ...patchFor(current, code, home, got, mode === "live", current.ownerId ? names.get(current.ownerId) : null), ...(miss ? { [`registryMiss/${code}`]: null } : {}) };
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
