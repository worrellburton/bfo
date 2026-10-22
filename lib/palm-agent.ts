import { formatAddress, sameAddressText, type PalmAddress, type PalmMode } from "./registry.js";

/**
 * Palm's registered agent service for one business, and what it means for the
 * entity's record. Pure, and shared: the entity page applies it when it reads
 * the service, and the webhook when Palm reports a change (registered_agent.*),
 * so the record follows the agent even when nobody has the page open.
 */

export type RaStatus = "pending" | "active" | "termination_requested" | "terminated" | "failed" | "canceled";

/** The service as Palm returns it (GET /v1/business/{id}/registered-agent, or a webhook's object). */
export type RaServiceLike = {
  provider?: "palm" | "external" | null;
  status?: RaStatus | null;
  jurisdiction?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  rejection_reason?: string | null;
  name?: string | null;
  address?: PalmAddress;
};

/** What BFO keeps of it, per mode (palm/<mode>/ra). */
export type RaSnapshot = {
  status: RaStatus | null;
  name: string | null;
  address: string | null;
  provider: "palm" | "external" | null;
  jurisdiction: string | null;
  startedAt: string | null;
  endedAt: string | null;
  rejectionReason: string | null;
  checkedAt: number;
};

type AgentFacts = {
  registeredAgent?: string;
  registeredAgentSource?: string;
  registeredAgentAddress?: string;
  palm?: Record<string, { ra?: { status?: RaStatus | null } | null } | undefined>;
};

export function raSnapshot(service: RaServiceLike | null, now = Date.now()): RaSnapshot {
  return {
    status: service?.status ?? null,
    name: service?.name ?? null,
    address: formatAddress(service?.address) ?? null,
    provider: service?.provider ?? null,
    jurisdiction: service?.jurisdiction ?? null,
    startedAt: service?.started_at ?? null,
    endedAt: service?.ended_at ?? null,
    rejectionReason: service?.rejection_reason ?? null,
    checkedAt: now,
  };
}

/**
 * The entity's update for the service as it is now: the snapshot always; in
 * live mode, the agent on record when Palm becomes it, Palm's address while
 * it is, and a note to confirm the agent when Palm stops. Only on the change
 * itself, so a later hand edit isn't overwritten on every read.
 */
export function raPatch(current: AgentFacts, service: RaServiceLike | null, mode: PalmMode, now = Date.now()): Record<string, unknown> {
  const before = current.palm?.[mode]?.ra?.status ?? null;
  const patch: Record<string, unknown> = { [`palm/${mode}/ra`]: raSnapshot(service, now) };
  if (mode !== "live") return patch;
  const day = (iso: string | null | undefined) => (iso ?? new Date(now).toISOString()).slice(0, 10);
  if (service?.status === "active" && before !== "active" && service.name) {
    patch.registeredAgent = service.name;
    patch.registeredAgentSource = `Palm, active since ${day(service.started_at)}`;
  }
  // Palm's street address, once Palm reports it, while Palm is the agent on record.
  const palmAddress = formatAddress(service?.address);
  const palmOnRecord = (service?.status === "active" && before !== "active") || /^Palm, active/.test(current.registeredAgentSource ?? "");
  if (service?.status === "active" && palmAddress && palmOnRecord && !sameAddressText(palmAddress, current.registeredAgentAddress)) patch.registeredAgentAddress = palmAddress;
  if ((service?.status === "terminated" || service?.status === "canceled") && before === "active" && current.registeredAgentSource?.startsWith("Palm")) {
    patch.registeredAgentSource = `Palm stopped serving ${day(service.ended_at)} — confirm the current agent`;
  }
  return patch;
}
