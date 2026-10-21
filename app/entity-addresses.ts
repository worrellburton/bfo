/**
 * An entity's addresses, each with what it's for and whether it holds up:
 *
 *   principal office  where the business is: the address the state lists
 *   mailing address   where its mail goes (blank: the principal office)
 *   registered agent  one per state it's registered in: the person or company
 *                     that accepts legal papers there, at a street address in
 *                     that state. The home state's, then each state it's
 *                     registered (or must register) in as a foreign entity.
 *
 * Each is checked on its own terms (an agent can't be a PO box or out of
 * state) and against the state's own record when it's been read through Palm.
 */

import { addressState, agentTerm, entityType, hostState, stateCode, stateName } from "./entity-paperwork";
import { sameAddressText, type StateRecord } from "./palm";

/** A state the entity is registered in as a foreign entity, keyed by its two-letter code. */
export type ForeignRegistration = {
  agent?: string;
  agentAddress?: string;
  fileNumber?: string;
  /** The state's record, read through Palm. */
  record?: StateRecord;
  /** Someone said it doesn't do business here (its address is here, nothing more). */
  notNeeded?: boolean;
  /** Someone said it does business here, so it must register. */
  confirmed?: boolean;
};

export type AddressInput = {
  name?: string;
  type?: string;
  state?: string;
  address?: string;
  mailingAddress?: string;
  registeredAgent?: string;
  registeredAgentAddress?: string;
  registeredAgentSource?: string;
  stateRecord?: StateRecord;
  foreign?: Record<string, ForeignRegistration>;
  palm?: Partial<Record<"live" | "test", { ra?: { status?: string | null; address?: string | null } | null; formation?: { status?: string; registeredAgent?: { status: string } | null } | null }>>;
  /** A state whose registry had no entry (or several) for it, from the state-record check. */
  registryMiss?: Record<string, { outcome: "not_found" | "ambiguous"; at: number }>;
};

export type Check = { tone: "good" | "warn" | "bad" | "info"; text: string };

export type AgentLine = {
  /** Two-letter state code. */
  state: string;
  stateLabel: string;
  /** "Registered agent" or Arizona's "Statutory agent". */
  term: string;
  home: boolean;
  name: string | null;
  address: string | null;
  palm: boolean;
  fileNumber: string | null;
  record: StateRecord | null;
  /** Only its address puts it here: ask whether it does business in this state. */
  ask: boolean;
  checks: Check[];
};

/**
 * Whether Palm is the registered agent, one answer for every card: Palm's own
 * word (its service active) unless the record and the state both name
 * someone else, which means Palm's answer is stale.
 */
export function palmServes(a: Pick<AddressInput, "palm" | "registeredAgent" | "registeredAgentSource" | "stateRecord">): boolean {
  if (/^Palm stopped/.test(a.registeredAgentSource ?? "")) return false;
  const active = a.palm?.live?.ra?.status === "active" || /^Palm, active/.test(a.registeredAgentSource ?? "");
  if (!active) return false;
  const named = [a.registeredAgent, a.stateRecord?.agent].filter((n): n is string => !!n?.trim());
  return !named.length || named.some((n) => /palm/i.test(n)) || /^Palm, active/.test(a.registeredAgentSource ?? "");
}

/** A formation still with the state (through Palm), in either mode. */
export function formingNow(a: AddressInput): { palmAgent: boolean } | null {
  for (const m of ["live", "test"] as const) {
    const f = a.palm?.[m]?.formation;
    if (f && f.status !== "completed" && f.status !== "canceled") return { palmAgent: !!f.registeredAgent };
  }
  return null;
}

export type Addresses = {
  principal: { value: string | null; checks: Check[] };
  mailing: { value: string | null; same: boolean; checks: Check[] };
  agents: AgentLine[];
  /** States its address is in that it doesn't do business in, as someone said. */
  notNeeded: string[];
  /** Everything not "good", worst first: the gaps. */
  gaps: (Check & { where: string })[];
};

const PO_BOX = /\b(p\.?\s*o\.?\s*box|post office box|pmb|private mail ?box|box\s+\d+)\b/i;
/** A mailbox store or virtual mailbox: fine for mail, never for an agent. */
const MAILBOX = /\b(pmb|#\s*\d{5,}|ste\.?\s*\d{5,}|suite\s*\d{5,})\b/i;

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[.,]/g, "").replace(/\b(llc|inc|corp|corporation|company|co|ltd)\b/g, "").replace(/\s+/g, " ").trim();

/** The states that need a foreign registration: where it's run from, plus any already on record. */
export function foreignStates(a: AddressInput): string[] {
  const home = stateCode(a.state);
  const out = new Set(Object.entries(a.foreign ?? {}).filter(([c, f]) => c !== home && !f?.notNeeded).map(([c]) => c));
  const host = hostState(a);
  if (home && host && host !== home) out.add(host);
  return [...out].sort();
}

function agentChecks(line: Omit<AgentLine, "checks">): Check[] {
  const where = line.stateLabel || line.state;
  const out: Check[] = [];
  if (!line.name) {
    out.push({ tone: "bad", text: line.home ? `No ${line.term.toLowerCase()} on record. Every entity must keep one in ${where}.` : `${where} needs a ${line.term.toLowerCase()} before it can register there.` });
  } else if (!line.address) {
    out.push({ tone: "warn", text: line.palm ? "Palm's address appears once Palm reports it: refresh on Compliance." : `Add the agent's street address in ${where}.` });
  }
  if (line.address) {
    if (PO_BOX.test(line.address) || MAILBOX.test(line.address)) out.push({ tone: "bad", text: "An agent's address must be a street address where papers can be handed over, not a PO box or mailbox." });
    const at = addressState(line.address);
    if (at && at !== line.state) out.push({ tone: "bad", text: `The agent's address is in ${stateName(at)}; it must be in ${where}.` });
  }
  const rec = line.record;
  if (rec) {
    if (rec.agent && line.name && norm(rec.agent) !== norm(line.name) && !(line.palm && /palm/i.test(rec.agent))) {
      out.push({ tone: "warn", text: `${where}'s record names ${rec.agent} as agent.` });
    } else if (rec.agentAddress && line.address && !sameAddressText(rec.agentAddress, line.address)) {
      out.push({ tone: "warn", text: `${where}'s record has the agent at ${rec.agentAddress}.` });
    } else if (rec.agent && line.name) {
      out.push({ tone: "good", text: `Matches ${where}'s record` });
    }
  }
  return out;
}

export function entityAddresses(a: AddressInput): Addresses {
  const principal = (a.address ?? "").trim() || null;
  const mailingOwn = (a.mailingAddress ?? "").trim() || null;
  const rec = a.stateRecord ?? null;
  const home = stateCode(a.state);
  const trust = entityType(a) === "Trust";

  const pChecks: Check[] = [];
  if (!principal) pChecks.push({ tone: "warn", text: trust ? "Add its address under Edit." : "Add it under Edit: it's the address the state lists for the business." });
  else if (rec?.address) {
    pChecks.push(sameAddressText(rec.address, principal) ? { tone: "good", text: "Matches the state's record" } : { tone: "warn", text: `The state has ${rec.address}.` });
  }

  const mChecks: Check[] = [];
  if (mailingOwn && PO_BOX.test(mailingOwn) && !principal) mChecks.push({ tone: "info", text: "A mailbox works for mail; the principal office should be where the business is." });

  const agents: AgentLine[] = [];
  if (!trust && home) {
    const palmActive = palmServes(a);
    const base = {
      state: home,
      stateLabel: stateName(home),
      term: agentTerm(home),
      home: true,
      name: (a.registeredAgent ?? "").trim() || null,
      // Ours, else what Palm or the state reported for the same agent.
      address:
        (a.registeredAgentAddress ?? "").trim() ||
        (palmActive ? a.palm?.live?.ra?.address?.trim() : null) ||
        (rec?.agentAddress && (!a.registeredAgent?.trim() || norm(rec.agent) === norm(a.registeredAgent) || (palmActive && /palm/i.test(rec.agent ?? ""))) ? rec.agentAddress : null) ||
        null,
      palm: palmActive,
      fileNumber: null,
      record: rec,
      ask: false,
    };
    const forming = formingNow(a);
    if (forming?.palmAgent && !base.name) Object.assign(base, { name: "Palm", palm: true });
    const homeMiss = !rec && !forming ? a.registryMiss?.[home] : undefined;
    const homeLead: Check[] = homeMiss
      ? [{ tone: "warn", text: `${base.stateLabel}'s registry had ${homeMiss.outcome === "not_found" ? "no entry" : "more than one entry"} for this name (checked ${new Date(homeMiss.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}). Add the state file number under Edit, unless it's still being formed.` }]
      : [];
    agents.push({
      ...base,
      checks: forming?.palmAgent && base.palm
        ? [{ tone: "info", text: `Palm becomes the registered agent when ${base.stateLabel} approves the formation; its address shows then.` }]
        : [...homeLead, ...agentChecks(base)],
    });
    for (const code of foreignStates(a)) {
      const f = a.foreign?.[code] ?? {};
      const line = {
        state: code,
        stateLabel: stateName(code),
        term: agentTerm(code),
        home: false,
        name: (f.agent ?? "").trim() || null,
        address: (f.agentAddress ?? "").trim() || null,
        palm: /palm/i.test(f.agent ?? ""),
        fileNumber: (f.fileNumber ?? "").trim() || null,
        record: f.record ?? null,
        ask: !f.confirmed && !f.agent?.trim() && !f.fileNumber?.trim() && !f.record,
      };
      const miss = !f.record && !forming ? a.registryMiss?.[code] : undefined;
      const when = miss ? new Date(miss.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      const lead: Check[] = miss
        ? [
            miss.outcome === "not_found"
              ? { tone: "bad", text: `Not registered in ${line.stateLabel}: its registry had no entry for this name (checked ${when}). File the foreign registration, or add the file number under Edit if it is registered.` }
              : { tone: "warn", text: `${line.stateLabel}'s registry has more than one entry like this name (checked ${when}). Add the file number under Edit.` },
          ]
        : [];
      const what = entityType(a) === "C-Corp" ? "corporation" : "LLC";
      agents.push({
        ...line,
        checks: line.ask
          ? [{ tone: "warn", text: `Its address is in ${line.stateLabel}. If it does business there (an office, staff, patients or customers, operating property), it must register there as a foreign ${what}, with a ${line.term.toLowerCase()} in ${line.stateLabel}. If ${line.stateLabel} is only where its mail goes, it doesn't.` }]
          : [...lead, ...agentChecks(line)],
      });
    }
  }

  const rank = { bad: 0, warn: 1, info: 2, good: 3 } as const;
  const gaps = [
    ...pChecks.map((c) => ({ ...c, where: trust ? "Address" : "Principal office" })),
    ...mChecks.map((c) => ({ ...c, where: "Mailing address" })),
    ...agents.flatMap((g) => g.checks.map((c) => ({ ...c, where: `${g.term} · ${g.stateLabel}` }))),
  ]
    .filter((c) => c.tone !== "good")
    .sort((x, y) => rank[x.tone] - rank[y.tone]);

  return {
    principal: { value: principal, checks: pChecks },
    mailing: { value: mailingOwn ?? principal, same: !mailingOwn, checks: mChecks },
    agents,
    notNeeded: Object.entries(a.foreign ?? {}).filter(([, f]) => f?.notNeeded).map(([c]) => c).sort(),
    gaps,
  };
}
