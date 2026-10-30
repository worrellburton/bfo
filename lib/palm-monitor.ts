import { logActivity } from "./activity.js";
import { sb } from "./auth.js";
import { normalizeEin, palm, PalmError, type PalmMode, type PalmUsage } from "./palm.js";
import { PALM_PRICES } from "./palm-pricing.js";
import { searchName } from "./registry.js";
import { applyOps, readCollection } from "./tree.js";
import { statesToRead, type StateReadable } from "./state-reads.js";

/**
 * Palm Monitor: Palm watches one registration (an entity's home state, or a
 * state it's registered in as a foreign entity) and tells us, by webhook,
 * when the state's record changes and when a filing is due or overdue.
 * Billed by Palm per registration per month while on, so it's opt-in, one
 * registration at a time, and started or stopped only by an owner or admin.
 *
 * Each monitor is kept in public.palm_monitors by the Palm business it
 * watches (the webhook's data.business.id), with the entity and state, so
 * an event finds its entity and the page lists what's on.
 */

const MONITOR_EVENTS = ["business.registration.updated", "business.filing.due", "business.filing.overdue"] as const;

export type MonitorRow = {
  business_id: string;
  mode: PalmMode;
  asset_id: string;
  state: string;
  subscription_id: string | null;
  status: string;
  started_at: string;
  started_by: string | null;
  ended_at: string | null;
};

type Subscription = { id: string; resource_id: string; status: string; mode?: PalmMode; business?: { id?: string } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Registration = { state: string; home: boolean; fileNumber: string | null; palmId: string | null };

type Monitorable = StateReadable & {
  stateRecord?: { mode: string; checkedAt: number; palmId?: string; registrationNumber?: string };
  foreign?: Record<string, { fileNumber?: string; notNeeded?: boolean; record?: { mode: string; checkedAt: number; palmId?: string; registrationNumber?: string } }>;
};

/** Each registration an entity has, and how Palm can find it on the state's registry. */
export function registrationsOf(a: Monitorable): Registration[] {
  return statesToRead(a).map(({ code, home }) => {
    const rec = home ? a.stateRecord : a.foreign?.[code]?.record;
    const number = (home ? a.fileNumber : a.foreign?.[code]?.fileNumber)?.trim() || rec?.registrationNumber?.trim() || null;
    return { state: code, home, fileNumber: number, palmId: rec?.palmId ?? null };
  });
}

/** The monitors on for an entity (or for several), in this mode. */
export async function monitorsFor(assetIds: string[], mode: PalmMode): Promise<MonitorRow[]> {
  const ids = assetIds.filter((id) => /^[\w-]{1,80}$/.test(id));
  if (!ids.length) return [];
  return sb<MonitorRow[]>(`palm_monitors?mode=eq.${mode}&ended_at=is.null&asset_id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=*&order=started_at.asc`);
}

/** The monitor a Palm business is, for a webhook to find its entity. */
export async function monitorByBusiness(businessId: string, mode: PalmMode): Promise<MonitorRow | null> {
  if (!UUID.test(businessId)) return null;
  const rows = await sb<MonitorRow[]>(`palm_monitors?business_id=eq.${businessId}&mode=eq.${mode}&select=*&limit=1`);
  return rows[0] ?? null;
}

export class MonitorError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Start Palm watching one registration. The home state of an entity already
 * in Palm's portfolio is watched through that business; any other
 * registration is found on the state's registry (by Palm's id for it, else
 * the file number) and Palm adds it to the portfolio to watch.
 */
export async function startMonitor(opts: {
  assetId: string;
  reg: Registration;
  linkedBusinessId: string | null;
  mode: PalmMode;
  by: { id: string; name: string | null };
}): Promise<MonitorRow> {
  const { assetId, reg, mode } = opts;
  const already = (await monitorsFor([assetId], mode)).find((m) => m.state === reg.state);
  if (already) return already;

  const usage: PalmUsage = { actorId: opts.by.id, actorName: opts.by.name, assetId, reason: `monitor ${reg.state}` };
  const body = { event_types: [...MONITOR_EVENTS], metadata: { bfo_asset_id: assetId, state: reg.state } };
  const viaPortfolio = reg.home && opts.linkedBusinessId && UUID.test(opts.linkedBusinessId) ? opts.linkedBusinessId : null;
  let sub: Subscription;
  try {
    if (viaPortfolio) {
      sub = await palm<Subscription>(`/v1/business/${viaPortfolio}/subscription`, { method: "POST", body, usage });
    } else {
      const where = reg.fileNumber
        ? { registration_jurisdiction: `US-${reg.state}`, registration_number: reg.fileNumber }
        : reg.palmId
          ? { palm_id: reg.palmId }
          : null;
      if (!where) throw new MonitorError(422, `Palm needs ${reg.state}'s file number to watch it. Read the state's record first, or add the file number under Edit.`);
      sub = await palm<Subscription>("/v1/business/subscription", { method: "POST", body: { ...body, ...where }, usage });
    }
  } catch (err) {
    if (!(err instanceof PalmError)) throw err;
    // Already watched at Palm (started in Palm Console, or a lost reply): take the one that's there.
    if (err.status === 409 && viaPortfolio) sub = await palm<Subscription>(`/v1/business/${viaPortfolio}/subscription`);
    else if (err.status === 409) throw new MonitorError(409, `Palm is already watching ${reg.state}'s registration, started outside BFO. Stop it in Palm Console, then turn it on here.`);
    else if (err.status === 404) throw new MonitorError(404, `${reg.state}'s registry has no entry with that file number. Check it under Edit.`);
    else if (err.status === 422) throw new MonitorError(422, `Palm couldn't pin down ${reg.state}'s registration: ${err.message}`);
    else if (err.status === 403) throw new MonitorError(403, `Palm doesn't monitor ${reg.state} for this account yet.`);
    else throw err;
  }
  const businessId = sub.resource_id || sub.business?.id || viaPortfolio;
  if (!businessId || !UUID.test(businessId)) throw new MonitorError(502, "Palm started watching but didn't say which business. Check Palm Console.");
  const row: MonitorRow = {
    business_id: businessId,
    mode,
    asset_id: assetId,
    state: reg.state,
    subscription_id: sub.id ?? null,
    status: sub.status || "active",
    started_at: new Date().toISOString(),
    started_by: opts.by.id,
    ended_at: null,
  };
  await sb("palm_monitors?on_conflict=business_id,mode", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" });
  return row;
}

/** Stop Palm watching (and billing for) a registration. Already stopped at Palm counts as stopped. */
export async function stopMonitor(row: MonitorRow): Promise<void> {
  try {
    await palm(`/v1/business/${row.business_id}/subscription`, { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof PalmError && err.status === 404)) throw err;
  }
  await sb(`palm_monitors?business_id=eq.${row.business_id}&mode=eq.${row.mode}`, {
    method: "PATCH",
    body: { status: "canceled", ended_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
}

/**
 * Each monitor's status as Palm has it now (paused, expired or ended at
 * Palm shows here). Reading a subscription isn't billed.
 */
export async function refreshMonitors(rows: MonitorRow[]): Promise<MonitorRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      try {
        const sub = await palm<Subscription>(`/v1/business/${row.business_id}/subscription`);
        if (sub?.status && sub.status !== row.status) {
          const ended = sub.status === "canceled" || sub.status === "expired";
          const patch = { status: sub.status, ...(ended ? { ended_at: new Date().toISOString() } : {}) };
          await sb(`palm_monitors?business_id=eq.${row.business_id}&mode=eq.${row.mode}`, { method: "PATCH", body: patch, prefer: "return=minimal" });
          return { ...row, ...patch };
        }
        return row;
      } catch (err) {
        if (err instanceof PalmError && err.status === 404) {
          const patch = { status: "canceled", ended_at: new Date().toISOString() };
          await sb(`palm_monitors?business_id=eq.${row.business_id}&mode=eq.${row.mode}`, { method: "PATCH", body: patch, prefer: "return=minimal" }).catch((err) => console.error(`palm-monitor: couldn't save monitor ${row.business_id}`, err));
          return { ...row, ...patch };
        }
        return row; // Palm unreachable: show what we last knew
      }
    }),
  );
}

/** What Palm's IRS check found for an entity's EIN, as kept on the entity (einCheck). */
export type EinCheck = { ein: string; name: string; matched: boolean | null; status: string; reason: string | null; at: number; mode: PalmMode; verificationId: string | null };

type TinVerification = { verification_id?: string; matched?: boolean | null; status?: string; unavailable_reason?: string | null };

/**
 * Ask Palm whether the IRS has this EIN under this legal name. 99¢ live; the
 * sandbox never asks the IRS (`simulate` picks its answer there).
 */
export async function checkEin(opts: { ein: string; name: string; mode: PalmMode; usage: PalmUsage; simulate?: "match" | "no_match" | "unavailable" }): Promise<EinCheck> {
  const r = await palm<TinVerification>("/v1/tin/verification", {
    method: "POST",
    body: {
      tin: opts.ein,
      tin_type: "ein",
      name: opts.name,
      ...(opts.usage.assetId ? { reference_id: `bfo_${opts.usage.assetId}`.slice(0, 64) } : {}),
      ...(opts.mode === "test" && opts.simulate ? { metadata: { _simulate: opts.simulate } } : {}),
    },
    usage: opts.usage,
  });
  return {
    ein: opts.ein,
    name: opts.name,
    matched: typeof r?.matched === "boolean" ? r.matched : null,
    status: r?.status ?? "failed",
    reason: r?.unavailable_reason ?? null,
    at: Date.now(),
    mode: opts.mode,
    verificationId: r?.verification_id ?? null,
  };
}

/** One line for an EIN check: what the IRS said. */
export function einCheckText(c: Pick<EinCheck, "matched" | "status">): string {
  if (c.matched === true) return "The IRS has this EIN under this legal name.";
  if (c.matched === false) return "The IRS doesn't match this EIN to this legal name. Check both against the IRS letter (CP 575).";
  return "The IRS couldn't answer just now. Check again later.";
}

type Line = { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string };
type EntityLines = { id: string; name: string; lines: Line[] };
type AssetData = Monitorable & { name?: string; ein?: string; palm?: Record<string, { businessId?: string | null } | undefined>; einCheck?: EinCheck; stateRecord?: Monitorable["stateRecord"] & { name?: string } };

/** The legal name the IRS is asked about: the state's spelling when it's been read live, else ours. */
export function einName(a: AssetData): string {
  return (a.stateRecord?.mode === "live" && a.stateRecord.name?.trim()) || searchName(a.name ?? "");
}

/** An entity whose EIN already checked out, under the same name, in this mode, isn't asked about again. */
function einSettled(a: AssetData, mode: PalmMode): boolean {
  const c = a.einCheck;
  return !!c && c.mode === mode && c.matched === true && c.ein === normalizeEin(a.ein) && c.name === einName(a);
}

/** What the Entities page's bulk actions would do now, and what they'd cost (live). */
export async function bulkPlan(mode: PalmMode): Promise<{ monitor: { count: number; cents: number; on: number; unidentified: number }; ein: { count: number; cents: number; settled: number } }> {
  const rows = await readCollection("assets");
  const on = await monitorsFor(rows.map((r) => r.id), mode);
  const watched = new Set(on.map((m) => `${m.asset_id}:${m.state}`));
  let toMonitor = 0;
  let unidentified = 0;
  let toCheck = 0;
  let settled = 0;
  for (const r of rows) {
    const a = (r.data ?? {}) as AssetData;
    if (!a.name) continue;
    for (const g of registrationsOf(a)) {
      if (watched.has(`${r.id}:${g.state}`)) continue;
      // Palm finds a registration by its file number or its registry id (or, at home, the business it holds).
      if (g.fileNumber || g.palmId || (g.home && a.palm?.[mode]?.businessId)) toMonitor++;
      else unidentified++;
    }
    if (normalizeEin(a.ein) && einName(a)) einSettled(a, mode) ? settled++ : toCheck++;
  }
  const live = mode === "live";
  return {
    monitor: { count: toMonitor, cents: live ? toMonitor * PALM_PRICES.monitor.cents : 0, on: on.length, unidentified },
    ein: { count: toCheck, cents: live ? toCheck * PALM_PRICES.verify_tin.cents : 0, settled },
  };
}

/** Palm watches every registration of every entity that isn't watched yet. */
export async function monitorAll(opts: { mode: PalmMode; by: { id: string; name: string | null } }): Promise<EntityLines[]> {
  const rows = await readCollection("assets");
  const on = await monitorsFor(rows.map((r) => r.id), opts.mode);
  const out: EntityLines[] = [];
  for (const r of rows) {
    const a = (r.data ?? {}) as AssetData;
    const regs = a.name ? registrationsOf(a) : [];
    if (!regs.length) continue;
    const entry: EntityLines = { id: r.id, name: a.name!, lines: [] };
    for (const reg of regs) {
      if (on.some((m) => m.asset_id === r.id && m.state === reg.state)) {
        entry.lines.push({ label: `${reg.state} monitor`, tone: "good", text: "Already on." });
        continue;
      }
      try {
        await startMonitor({ assetId: r.id, reg, linkedBusinessId: a.palm?.[opts.mode]?.businessId ?? null, mode: opts.mode, by: opts.by });
        entry.lines.push({ label: `${reg.state} monitor`, tone: "good", text: opts.mode === "live" ? "On ($1.99/month)." : "On (test)." });
        await logActivity(r.id, { id: opts.by.id, name: opts.by.name, source: "user" }, [{ kind: "palm", summary: `Palm is now monitoring ${reg.state}${opts.mode === "live" ? " ($1.99/month)" : " (test)"}` }]);
      } catch (err) {
        entry.lines.push({ label: `${reg.state} monitor`, tone: err instanceof MonitorError && err.status === 422 ? "warn" : "bad", text: (err as Error).message });
      }
    }
    out.push(entry);
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/** The IRS asked about every entity's EIN that hasn't already checked out. */
export async function checkAllEins(opts: { mode: PalmMode; by: { id: string; name: string | null } }): Promise<EntityLines[]> {
  const rows = await readCollection("assets");
  const out: EntityLines[] = [];
  const actor = { id: opts.by.id, name: opts.by.name, source: "user" as const };
  for (const r of rows) {
    const a = (r.data ?? {}) as AssetData;
    const ein = normalizeEin(a.ein);
    const name = einName(a);
    if (!a.name || !ein || !name) continue;
    const entry: EntityLines = { id: r.id, name: a.name, lines: [] };
    out.push(entry);
    if (einSettled(a, opts.mode)) {
      entry.lines.push({ label: "EIN", tone: "good", text: "Already confirmed with the IRS; not checked again." });
      continue;
    }
    try {
      const check = await checkEin({ ein, name, mode: opts.mode, usage: { actorId: opts.by.id, actorName: opts.by.name, assetId: r.id, reason: "EIN check (all)" } });
      await applyOps([{ op: "update", path: ["assets", r.id], value: { einCheck: check } as never }], actor);
      const verdict = check.matched === true ? "matches" : check.matched === false ? "doesn't match" : "couldn't be checked";
      await logActivity(r.id, actor, [{ kind: "palm", summary: `IRS check: the EIN ${verdict} ${name}${opts.mode === "test" ? " (test)" : ""}` }]);
      entry.lines.push({ label: "EIN", tone: check.matched === true ? "good" : check.matched === false ? "bad" : "warn", text: einCheckText(check) });
    } catch (err) {
      entry.lines.push({ label: "EIN", tone: "bad", text: (err as Error).message });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
