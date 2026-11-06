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
 *
 * A company that owns others first transfers each interest (a step per
 * entity it owns), and its books are closed before it's marked dissolved.
 * A trust ends under its own terms: the trustee winds it up and distributes
 * what's left; there's no state filing.
 */

import { palmServes } from "./entity-addresses";
import { entityType, stateCode, stateName, taxClassOf } from "./entity-paperwork";

export type Closing = {
  /** YYYY-MM-DD the closing was started. */
  startedAt: string;
  /** Each step's key → the date it was done (YYYY-MM-DD). */
  steps?: Record<string, string | null>;
  /** YYYY-MM-DD the entity was marked dissolved. */
  closedAt?: string | null;
};

type ClosingStep = {
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
  /** The family's entities it owns on record: each interest is transferred before it ends. */
  owned?: { id: string; name: string; percent?: number | null }[];
  /** Who owns it, by name: where its interests and anything left go. */
  ownerName?: string | null;
};

const SOS: Record<string, { llc: string; corp: string; where: { label: string; url: string }; note?: string }> = {
  AZ: {
    llc: "Articles of Termination",
    corp: "Articles of Dissolution",
    where: { label: "Arizona Business Center", url: "https://arizonabusinesscenter.azcc.gov/" },
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
  if (entityType(a) === "Trust") return trustSteps(a);
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
  for (const o of a.owned ?? []) {
    steps.push({
      key: `transfer:${o.id}`,
      title: `Transfer its interest in ${o.name}`,
      how: `Assign its ${o.percent != null ? `${o.percent}% ` : ""}interest in ${o.name} to ${a.ownerName ? a.ownerName : "its owner"} (or as the owners decide), in a signed assignment with an effective date, with ${o.name}'s consent where its operating agreement requires it. Then record the new owner on ${o.name}'s Owners tab.`,
      note: "Until this is done the dissolved company would still be the owner of record.",
    });
  }
  steps.push({
    key: "windup",
    title: "Wind up its affairs",
    how: `Collect what it's owed, pay or settle its debts, and end its contracts and leases. ${
      tax === "Partnership"
        ? "Distribute what's left as the operating agreement provides, normally by positive capital accounts (not by percentages)."
        : corp || tax === "C Corporation" || tax === "S Corporation"
          ? "Distribute what's left to the shareholders; a liquidating distribution is taxable to the company and to them."
          : "Distribute what's left as the operating agreement provides."
    } Record each distribution in Books, and keep the records.`,
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
    title: disregarded ? "Report its last year on the owner's return" : "File its final tax returns",
    how: disregarded
      ? "A disregarded entity files no income tax return of its own: its income through the day it closes goes on its owner's return."
      : tax === "Partnership"
        ? 'File a final Form 1065 with "Final return" checked, and final K-1s to each partner, for the year it closes, and the final state partnership return(s).'
        : tax === "S Corporation"
          ? 'File a final Form 1120-S with "Final return" checked and final K-1s, and the final state return(s). File Form 966 within 30 days of the vote to dissolve.'
          : corp
            ? 'File a final Form 1120 with "Final return" checked, and the final state return(s). File Form 966 within 30 days of the vote to dissolve.'
            : 'File its final federal return with "Final return" checked, and the final state return(s).',
    link: { label: "IRS: Closing a business", url: "https://www.irs.gov/businesses/small-businesses-self-employed/closing-a-business" },
    optional: disregarded,
  });
  steps.push({
    key: "payroll",
    title: "Final payroll returns and 1099s",
    how: `Under its own EIN${disregarded ? " (a disregarded entity is still the employer for payroll)" : ""}: a final Form 941 and 940 with W-2s if it had employees, and 1099s for anyone it paid $600 or more in its last year. Close its state payroll and sales tax accounts. Mark it done if it had none of these.`,
  });
  steps.push({
    key: "books",
    title: "Close its books",
    how: "A final balance sheet as of the dissolution date, each liquidating distribution recorded in Books (what, how much, to whom, when), then the last period locked and its accounts unmapped once they're closed.",
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

  const palmAgent = palmServes(a as never);
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

/**
 * A trust ends under its own terms, with no state filing: the trustee winds
 * it up, pays what it owes, distributes what's left, and files its last
 * return (a grantor trust's last year stays on the grantors' Form 1040).
 */
function trustSteps(a: Input): ClosingStep[] {
  const grantor = /^grantor/i.test(a.llcType ?? "") || (!a.llcType && /\brevocable\b/i.test(a.name ?? "") && !/\birrevocable\b/i.test(a.name ?? ""));
  const steps: ClosingStep[] = [
    {
      key: "consent",
      title: "The trustee decides to end it, as the trust agreement allows",
      how: "Check the trust agreement for when and how it ends (a revocable trust can be revoked by the grantors in writing). Keep the written revocation or the trustee's decision with the trust's papers.",
    },
  ];
  for (const o of a.owned ?? []) {
    steps.push({
      key: `transfer:${o.id}`,
      title: `Transfer its interest in ${o.name}`,
      how: `Assign the trust's ${o.percent != null ? `${o.percent}% ` : ""}interest in ${o.name} to the beneficiaries as the trust agreement provides, in a signed assignment with an effective date. Then record the new owner on ${o.name}'s Owners tab.`,
    });
  }
  steps.push({
    key: "windup",
    title: "Pay its debts and distribute what's left",
    how: "Pay the trust's final expenses and debts, then distribute the remaining assets (the corpus) to the beneficiaries as the trust agreement says. Record each distribution and keep the receipts.",
  });
  steps.push({
    key: "bank",
    title: "Close its bank and brokerage accounts",
    how: "Once the last distributions clear, close each account in the trust's name.",
  });
  steps.push({
    key: "tax",
    title: grantor ? "Report its last year on the grantors' return" : "File its final Form 1041",
    how: grantor
      ? "A grantor trust files no income tax return of its own: its income through the day it ends goes on the grantors' Form 1040."
      : 'File a final Form 1041 with "Final return" checked, with final K-1s to each beneficiary who received a distribution.',
    link: { label: "IRS: Form 1041", url: "https://www.irs.gov/forms-pubs/about-form-1041" },
    optional: grantor,
  });
  if (a.ein?.trim() && a.ein.trim() !== "00-0000000") {
    steps.push({
      key: "ein",
      title: "Close its EIN account with the IRS",
      how: "Once the final return is filed, write to the IRS asking it to close the account. BFO drafts the letter.",
      generate: "ein-letter",
      link: { label: "IRS: Closing a business", url: "https://www.irs.gov/businesses/small-businesses-self-employed/closing-a-business" },
    });
  }
  steps.push({ key: "mail", title: "Stop its mail", how: "Update anyone who still sends the trust mail." });
  return steps;
}

/** The steps still to do (optional ones never count). */
export function stepsLeft(a: Input & { closing?: Closing | null }): ClosingStep[] {
  const done = a.closing?.steps ?? {};
  return closingSteps(a).filter((s) => !s.optional && !done[s.key]);
}
