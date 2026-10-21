/**
 * Closing an entity down, step by step: the owners' consent, winding up, the
 * state filing that ends it (and a withdrawal in each state it's registered
 * in as a foreign entity), the final tax return, closing the EIN account,
 * ending the registered agent, and the mail. Each step is marked done with
 * its date on the entity (asset.closing.steps); once they are, the entity is
 * marked Dissolved.
 *
 * Palm files none of this: there is no dissolution filing in its API. It
 * does end its own registered agent service, which is the last step.
 */

import { entityType, stateCode, stateName, taxClassOf } from "./entity-paperwork";

export type Closing = {
  /** YYYY-MM-DD the closing was started. */
  startedAt: string;
  /** Each step's key → the date it was done (YYYY-MM-DD). */
  steps?: Record<string, string | null>;
  /** YYYY-MM-DD the entity was marked dissolved. */
  closedAt?: string | null;
};

export type ClosingStep = {
  key: string;
  title: string;
  /** What to do, plainly. */
  how: string;
  /** A note that matters before doing it (fees, order). */
  note?: string;
  link?: { label: string; url: string };
  /** Something BFO makes for this step. */
  generate?: "consent" | "ein-letter";
  /** Ending Palm's agent service from here. */
  palmEnd?: boolean;
  /** Can be skipped without leaving anything undone (e.g. no return of its own). */
  optional?: boolean;
};

type Input = {
  name?: string;
  type?: string;
  state?: string;
  llcType?: string;
  ein?: string;
  registeredAgent?: string;
  registeredAgentSource?: string;
  foreign?: Record<string, { notNeeded?: boolean; confirmed?: boolean; agent?: string; fileNumber?: string; record?: unknown }>;
  palm?: Partial<Record<"live" | "test", { ra?: { status?: string | null } | null }>>;
};

const SOS: Record<string, { llc: string; corp: string; where: { label: string; url: string }; note?: string }> = {
  AZ: {
    llc: "Articles of Termination",
    corp: "Articles of Dissolution",
    where: { label: "Arizona eCorp", url: "https://ecorp.azcc.gov/" },
  },
  NV: {
    llc: "Certificate of Dissolution",
    corp: "Certificate of Dissolution",
    where: { label: "Nevada SilverFlume", url: "https://www.nvsilverflume.gov/" },
    note: "Nevada wants its annual list and business license current before it accepts the dissolution.",
  },
  DE: {
    llc: "Certificate of Cancellation",
    corp: "Certificate of Dissolution",
    where: { label: "Delaware Division of Corporations", url: "https://corp.delaware.gov/" },
    note: "Delaware rejects it until every annual tax (and, for a corporation, the franchise tax report) is paid through the year it closes.",
  },
};

/** The entities' registered-in-other-states that need a withdrawal: confirmed, or with a registration on record. */
export function withdrawalStates(a: Input): string[] {
  const home = stateCode(a.state);
  return Object.entries(a.foreign ?? {})
    .filter(([c, f]) => c !== home && f && !f.notNeeded && (f.confirmed || f.record || f.fileNumber?.trim() || f.agent?.trim()))
    .map(([c]) => c)
    .sort();
}

export function closingSteps(a: Input): ClosingStep[] {
  const type = entityType(a);
  const corp = type === "C-Corp";
  const st = stateCode(a.state);
  const where = stateName(st) || "its state";
  const tax = taxClassOf(a).value;
  const steps: ClosingStep[] = [];

  steps.push({
    key: "consent",
    title: corp ? "Board and shareholders approve dissolving it" : "Owners approve dissolving it",
    how: corp
      ? "The board adopts a resolution to dissolve and the shareholders approve it, in writing. BFO drafts a written consent to sign."
      : "The members sign a written consent to dissolve, as the operating agreement requires. BFO drafts one from the owners on record.",
    generate: "consent",
  });
  steps.push({
    key: "windup",
    title: "Wind up its affairs",
    how: "Collect what it's owed, pay or settle its debts, end its contracts and leases, and distribute what's left to the owners by their shares. Keep the records.",
  });
  steps.push({
    key: "bank",
    title: "Close its bank and brokerage accounts",
    how: "Once the last payments clear, move any balance to the owners and close each account. Cancel cards and autopays in its name.",
  });

  const sos = st ? SOS[st] : undefined;
  steps.push({
    key: `state:${st ?? "home"}`,
    title: `File the ${sos ? (corp ? sos.corp : sos.llc) : corp ? "articles of dissolution" : "certificate of cancellation"} with ${where}`,
    how: `This ends ${a.name ?? "the entity"} with ${where}. File it once the owners have approved and its debts are handled.`,
    note: sos?.note,
    link: sos?.where,
  });
  for (const code of withdrawalStates(a)) {
    steps.push({
      key: `withdraw:${code}`,
      title: `Withdraw its registration in ${stateName(code)}`,
      how: `It's registered in ${stateName(code)} as a foreign ${corp ? "corporation" : "LLC"}: file a withdrawal there too, or ${stateName(code)} keeps billing annual reports and fees.`,
      link: SOS[code]?.where,
    });
  }

  const disregarded = tax === "Disregarded Entity";
  steps.push({
    key: "tax",
    title: disregarded ? "Report its last year on the owner's return" : "File its final tax return",
    how: disregarded
      ? "A disregarded entity files no return of its own: its income through the day it closes goes on its owner's return."
      : tax === "Partnership"
        ? "File a final Form 1065 with \"Final return\" checked, and final K-1s to each partner, for the year it closes. If it had employees, final payroll returns (941, 940) and W-2s too."
        : tax === "S Corporation"
          ? "File a final Form 1120-S with \"Final return\" checked and final K-1s. File Form 966 within 30 days of the vote to dissolve. If it had employees, final payroll returns and W-2s too."
          : corp
            ? "File a final Form 1120 with \"Final return\" checked. File Form 966 within 30 days of the vote to dissolve. If it had employees, final payroll returns and W-2s too."
            : "File its final federal return with \"Final return\" checked, and any final state return and payroll returns.",
    link: { label: "IRS: Closing a business", url: "https://www.irs.gov/businesses/small-businesses-self-employed/closing-a-business" },
    optional: disregarded,
  });
  if (a.ein?.trim() && a.ein.trim() !== "00-0000000") {
    steps.push({
      key: "ein",
      title: "Close its EIN account with the IRS",
      how: "Once the final return is filed, write to the IRS asking it to close the business account. BFO drafts the letter: the legal name, EIN, address and the reason.",
      note: "The IRS never reissues an EIN; closing the account just stops it expecting returns. Include a copy of the EIN letter if you have it.",
      generate: "ein-letter",
      link: { label: "IRS: Closing a business", url: "https://www.irs.gov/businesses/small-businesses-self-employed/closing-a-business" },
    });
  }

  const palmAgent = a.palm?.live?.ra?.status === "active" || /^Palm, active/.test(a.registeredAgentSource ?? "");
  steps.push({
    key: "agent",
    title: palmAgent ? "End Palm's registered agent service" : `Tell ${a.registeredAgent?.trim() || "the registered agent"} to stop service`,
    how: palmAgent
      ? "Palm stays the agent until the state has accepted the dissolution, then stops. BFO asks Palm from here."
      : "Once the state has accepted the dissolution, cancel the agent's service so it stops billing.",
    note: "Do this last: a live entity without an agent falls out of good standing.",
    palmEnd: palmAgent,
  });
  steps.push({
    key: "mail",
    title: "Stop its mail",
    how: "Take its name off the Stable mailbox, and update anyone who still sends it mail.",
  });
  return steps;
}

/** The steps still to do (optional ones never count). */
export function stepsLeft(a: Input & { closing?: Closing | null }): ClosingStep[] {
  const done = a.closing?.steps ?? {};
  return closingSteps(a).filter((s) => !s.optional && !done[s.key]);
}
