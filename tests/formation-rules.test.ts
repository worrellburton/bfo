import { describe, expect, it } from "vitest";
import {
  absentSigners,
  addToDate,
  articlesStatement,
  draftProblems,
  effectiveDateProblem,
  electionDeadline,
  emptyDraft,
  emptyEin,
  emptyOfficial,
  emptyOwner,
  emptyParty,
  expectedCosts,
  feeFoots,
  feeLabel,
  fiscalYearFollowsOwners,
  hostState,
  isPersonFiling,
  looksLikeMailbox,
  ownerFilingName,
  sentenceCase,
  signerProblems,
  ss4Statement,
  stateQuestionCopy,
  taxOutcome,
  type FormationDraft,
} from "../app/formation";
import { buildFormationRequest, formationAudit, formationPatch, formationRecord, isSsnIssue, normalizeWebsite, noteToPalm, summarizeFiling, validationDraft } from "../lib/palm-formation";

const person = (first: string, last: string) => ({ first, middle: "", last, suffix: "" });
const ME = { name: "Alex Rivera" };

function draft(): FormationDraft {
  const d = emptyDraft();
  d.jurisdiction = "US-WY";
  d.legalName = "Northwind Holdings, LLC";
  d.email = "office@example.com";
  d.contact = { name: "Alex Rivera", email: "alex@example.com", phone: "" };
  d.principal = { street1: "1 Main St", street2: "", city: "Cheyenne", region: "WY", postal: "82001", county: "" };
  d.organizers = [emptyParty("Organizer", person("Alex", "Rivera"))];
  return d;
}

describe("tax", () => {
  it("follows the IRS defaults, and elections", () => {
    const d = draft();
    d.owners = [{ ...emptyOwner("entity", "100"), entityId: "e1", entityName: "Alder Partners, LLC" }];
    expect(taxOutcome(d)).toEqual({ value: "Disregarded Entity", elected: false, form: null });
    d.owners = [
      { ...emptyOwner("person", "50"), name: person("Ann", "Birch") },
      { ...emptyOwner("person", "50"), name: person("Ben", "Birch") },
    ];
    expect(taxOutcome(d).value).toBe("Partnership");
    // Spouses holding it as community property may choose to be disregarded.
    d.ein = { ...emptyEin(), marriedCouple: "yes", llcClassification: "single_member" };
    expect(taxOutcome(d).value).toBe("Disregarded Entity");
    d.taxElection = "s_corp";
    expect(taxOutcome(d)).toEqual({ value: "S Corporation", elected: true, form: "2553" });
    d.taxElection = "c_corp";
    expect(taxOutcome(d)).toEqual({ value: "C Corporation", elected: true, form: "8832" });
    d.entityType = "corporation";
    d.taxElection = "default";
    expect(taxOutcome(d)).toEqual({ value: "C Corporation", elected: false, form: null });
    expect(fiscalYearFollowsOwners(d)).toBe(false);
    d.taxElection = "s_corp";
    expect(fiscalYearFollowsOwners(d)).toBe(true);
  });

  it("counts an election's deadline from the effective date", () => {
    expect(addToDate("2027-01-31", { months: 1 })).toBe("2027-02-28");
    const d = draft();
    d.taxElection = "s_corp";
    d.effectiveDate = "2027-01-07";
    // The IRS's own example: a tax year starting Jan 7 elects by Mar 21.
    expect(electionDeadline(d)).toEqual({ form: "2553", dueBy: "2027-03-21", from: "2027-01-07", estimated: false });
    d.effectiveDate = "2027-01-01";
    expect(electionDeadline(d)?.dueBy).toBe("2027-03-15");
    d.taxElection = "c_corp";
    expect(electionDeadline(d)?.dueBy).toBe("2027-03-17");
    d.effectiveDate = "";
    expect(electionDeadline(d, "2026-11-06")).toMatchObject({ from: "2026-11-06", estimated: true });
    d.taxElection = "default";
    expect(electionDeadline(d)).toBeNull();
  });
});

describe("dates", () => {
  it("keeps the effective date between today and 90 days out", () => {
    expect(effectiveDateProblem("", "2026-11-06")).toBeNull();
    expect(effectiveDateProblem("2026-11-05", "2026-11-06")).toBe("The effective date can't be in the past.");
    expect(effectiveDateProblem("2026-11-06", "2026-11-06")).toBeNull();
    expect(effectiveDateProblem("2027-02-04", "2026-11-06")).toBeNull();
    expect(effectiveDateProblem("2027-02-05", "2026-11-06")).toBe("The effective date can be at most 90 days ahead.");
    const d = draft();
    d.effectiveDate = "2020-01-01";
    expect(draftProblems(d, {}, [], "2026-11-06").map((p) => p.text)).toEqual(["The effective date can't be in the past."]);
  });
});

describe("who signs", () => {
  it("knows the person filing by first and last name", () => {
    expect(isPersonFiling(person("Alex", "Rivera"), ME)).toBe(true);
    expect(isPersonFiling({ first: "alex", last: "Rivera Jr." }, { name: "Alex J. Rivera Jr." })).toBe(true);
    expect(isPersonFiling(person("Sam", "Rivera"), ME)).toBe(false);
    expect(isPersonFiling(person("Alex", "Rivera"), null)).toBe(false);
  });

  it("stops filing in someone else's name until they agree", () => {
    const d = draft();
    expect(signerProblems(d, ME)).toEqual([]);
    d.organizers.push(emptyParty("Organizer", person("Sam", "Lee")));
    expect(absentSigners(d, ME)).toEqual(["Sam Lee"]);
    expect(signerProblems(d, ME)).toEqual([{ step: "filers", text: "Sam Lee must sign as organizer. Name yourself, or have Sam Lee file it." }]);
    d.organizers = [{ ...emptyParty("Organizer"), kind: "entity", entityName: "Alder Partners, LLC", signerName: "Alex Rivera", signerCapacity: "Manager" }];
    expect(signerProblems(d, ME)).toEqual([]);
    d.ein = { ...emptyEin(), responsible: { first: "Kim", middle: "", last: "Lee", ssn: "" } };
    expect(signerProblems(d, ME).map((p) => p.text)).toEqual(["Confirm the responsible party agreed to be named."]);
    d.ein.responsibleConsent = true;
    expect(signerProblems(d, ME)).toEqual([]);
  });

  it("asks a company organizer who signs for it", () => {
    const d = draft();
    d.organizers = [{ ...emptyParty("Organizer"), kind: "entity", entityName: "Alder Partners, LLC" }];
    expect(draftProblems(d).map((p) => p.text)).toEqual(["The organizer: who signs for the company?", "The organizer: in what capacity they sign (Manager, President…)"]);
  });

  it("says what the person filing affirms", () => {
    expect(articlesStatement(draft(), "Alex Rivera")).toBe(
      "I am Alex Rivera, the organizer named in these articles of organization. I authorize Palm to sign and file them in my name, and the information in them is true and correct.",
    );
    expect(ss4Statement(draft())).toMatch(/^I'm authorized to sign Form SS-4 for Northwind Holdings, LLC\. Under penalties of perjury/);
  });
});

describe("owners", () => {
  it("names a trust through its trustee, and asks for the trustee", () => {
    const trust = { ...emptyOwner("entity", "100"), entityKind: "trust" as const, entityName: "Birch Family Trust", trustee: "Ann Birch", trustDate: "2020-05-01" };
    expect(ownerFilingName(trust)).toBe("Ann Birch, Trustee of the Birch Family Trust dated May 1, 2020");
    const d = draft();
    d.owners = [{ ...trust, trustee: "" }];
    expect(draftProblems(d).map((p) => p.text)).toEqual(["The owner: name the trustee who holds it."]);
    d.owners = [trust];
    const body = buildFormationRequest(d, "a") as { initial_governing_persons: { name: unknown }[] };
    expect(body.initial_governing_persons[0].name).toEqual({ type: "entity", entity_name: "Ann Birch, Trustee of the Birch Family Trust dated May 1, 2020" });
  });

  it("checks a contribution when one is given", () => {
    const d = draft();
    d.owners = [{ ...emptyOwner("person", "100"), name: person("Ann", "Birch"), contribution: "ten", contributionKind: "property" }];
    expect(draftProblems(d).map((p) => p.text)).toEqual(["The owner: check the contribution.", "The owner: say what property is contributed."]);
  });

  it("keeps the members off the request where the state's filing doesn't ask for them", () => {
    const d = draft();
    d.owners = [{ ...emptyOwner("person", "100"), name: person("Ann", "Birch") }];
    d.managed = "managers";
    d.managers = [{ ...emptyOfficial("Manager"), name: person("Alex", "Rivera") }];
    d.membersRequired = false;
    const body = buildFormationRequest(d, "a") as { initial_governing_persons: { role: string }[] };
    expect(body.initial_governing_persons.map((g) => g.role)).toEqual(["manager"]);
    d.membersRequired = true;
    expect((buildFormationRequest(d, "a") as { initial_governing_persons: unknown[] }).initial_governing_persons).toHaveLength(2);
  });
});

describe("addresses and costs", () => {
  it("spots a mail-receiving address", () => {
    const a = { street1: "100 Main St", street2: "", city: "Phoenix", region: "AZ", postal: "85001", county: "" };
    expect(looksLikeMailbox(a)).toBe(false);
    expect(looksLikeMailbox({ ...a, street2: "PMB 4410" })).toBe(true);
    expect(looksLikeMailbox({ ...a, street1: "100 Main St STE 48810" })).toBe(true);
    expect(looksLikeMailbox({ ...a, street2: "Suite 300" })).toBe(false);
    expect(looksLikeMailbox({ ...a, street1: "P.O. Box 12" })).toBe(true);
  });

  it("lists what forming in one state and running it from another commits it to", () => {
    const d = draft();
    expect(hostState(d)).toBeNull();
    expect(expectedCosts(d)).toEqual([
      { label: "Wyoming annual report and license tax (the minimum)", dollars: 60, per: "year" },
      { label: "Registered agent (Palm's yearly fee)", dollars: null, per: "year" },
    ]);
    d.principal.region = "AZ";
    expect(hostState(d)).toBe("AZ");
    expect(expectedCosts(d).slice(2)).toEqual([
      { label: "Arizona foreign registration, if it does business there", dollars: 150, per: "once" },
      { label: "A registered agent in Arizona", dollars: null, per: "year" },
    ]);
    d.hostBusiness = "no";
    expect(expectedCosts(d)).toHaveLength(2);
  });

  it("names Palm's price lines plainly, and checks they foot", () => {
    const items = [
      { kind: "state_fee", name: "Filing", amount: 100 },
      { kind: "other", name: "Default", amount: 2.4 },
    ];
    expect(feeLabel(items[0], items)).toBe("State filing fee");
    expect(feeLabel(items[1], items)).toBe("Other charge (2.4% of the state fee)");
    expect(feeLabel({ kind: "expedite", name: "x", amount: 50 }, items)).toBe("Expedited processing");
    expect(feeFoots(102.4, items)).toBe(true);
    expect(feeFoots(103, items)).toBe(false);
  });
});

describe("the state's own questions", () => {
  it("puts plain words on a close-LLC election and on free text for the articles", () => {
    const close = stateQuestionCopy(
      {
        key: "close_llc",
        label: "Close limited liability company election",
        description: "The entity elects to be a close limited liability company under W.S. 17-25-101 through 17-25-109",
        type: "boolean",
      },
      "Wyoming",
    );
    expect(close.label).toBe("Make it a close LLC?");
    expect(close.preset).toBe(false);
    expect(close.hint).toMatch(/W\.S\. 17-25-101 to 17-25-109/);
    const more = stateQuestionCopy({ key: "additional_articles", label: "Additional articles (free text)", description: null, type: "string" }, "Wyoming");
    expect(more).toMatchObject({ label: "Anything else for the articles", long: true });
    expect(stateQuestionCopy({ key: "x", label: "Wyoming Business Purpose Code", description: null, type: "enum" }, "Wyoming").label).toBe("Wyoming business purpose code");
    expect(sentenceCase("Close Limited Liability Company Election")).toBe("Close limited liability company election");
  });
});

describe("what goes to Palm", () => {
  it("checks the filing with every SSN left out", () => {
    const d = draft();
    d.owners = [{ ...emptyOwner("person", "100"), name: person("Ann", "Birch"), ssn: "111-22-3333" }];
    d.ein = { ...emptyEin(), responsible: { first: "Alex", middle: "", last: "Rivera", ssn: "123-45-6789" } };
    expect(JSON.stringify(validationDraft(d))).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(d.ein.responsible.ssn).toBe("123-45-6789");
    expect(isSsnIssue({ field: "/ein/responsible_party/ssn", message: "Required" })).toBe(true);
    expect(isSsnIssue({ field: null, message: "SSN is required for the responsible party" })).toBe(true);
    expect(isSsnIssue({ field: "/principal_address/postal_code", message: "Invalid" })).toBe(false);
    expect(isSsnIssue({ field: "/legal_name", message: "Lessons learned" })).toBe(false);
  });

  it("puts a corporation's S election on the SS-4", () => {
    const d = draft();
    d.entityType = "corporation";
    d.ein = { ...emptyEin(), responsible: { first: "Alex", middle: "", last: "Rivera", ssn: "123-45-6789" } };
    const subtype = () => (buildFormationRequest(d, "a") as { ein: { corporation_subtype?: string } }).ein.corporation_subtype;
    expect(subtype()).toBeUndefined();
    d.taxElection = "s_corp";
    expect(subtype()).toBe("s_corporation");
    d.ein.corporationSubtype = "personal_service_corporation";
    expect(subtype()).toBe("personal_service_corporation");
  });

  it("adds a scheme to the website and tells Palm's team what the request can't carry", () => {
    expect(normalizeWebsite("example.com")).toBe("https://example.com");
    expect(normalizeWebsite("http://example.com")).toBe("http://example.com");
    expect(normalizeWebsite(" ")).toBe("");
    const d = draft();
    d.website = "example.com";
    d.organizers = [{ ...emptyParty("Organizer"), kind: "entity", entityName: "Alder Partners, LLC", signerName: "Alex Rivera", signerCapacity: "Manager" }];
    d.taxElection = "s_corp";
    d.note = "Reserve the name first.";
    expect(noteToPalm(d)).toBe(
      "Reserve the name first.\n\nOrganizer Alder Partners, LLC signs through Alex Rivera, Manager.\nFor federal tax, the LLC will elect to be treated as an S corporation (Form 2553).",
    );
    expect((buildFormationRequest(d, "a") as { website: string }).website).toBe("https://example.com");
    d.note = "x".repeat(5000);
    expect(noteToPalm(d).length).toBe(2000);
    expect(noteToPalm(d)).toMatch(/Form 2553\)\.$/);
  });
});

describe("the new entity's record", () => {
  const filing = () => summarizeFiling({ id: "f1", status: "queued", fee: { total: { amount: 102.4, currency: "USD" } }, created_at: "2026-11-06T10:00:00Z" });

  it("keeps everything the wizard collected, and no SSN", () => {
    const d = draft();
    d.principal.region = "AZ";
    d.hostBusiness = "no";
    d.owners = [
      { ...emptyOwner("entity", "60"), entityId: "e1", entityName: "Alder Partners, LLC", contribution: "6,000", contributionDate: "2026-11-10" },
      { ...emptyOwner("person", "40"), name: person("Ann", "Birch"), ssn: "111-22-3333", address: { street1: "2 Elm St", street2: "", city: "Mesa", region: "AZ", postal: "85201", county: "" } },
    ];
    d.managed = "managers";
    d.managers = [{ ...emptyOfficial("Manager"), name: person("Alex", "Rivera") }];
    d.taxElection = "s_corp";
    d.effectiveDate = "2027-01-07";
    d.payer = { entityId: "e1", name: "Alder Partners, LLC", treatment: "contribution" };
    d.ein = { ...emptyEin(), responsible: { first: "Alex", middle: "", last: "Rivera", ssn: "123-45-6789" } };
    const attestation = { version: "v1", articles: "I am…", ss4: "I'm authorized…", responsibleConsent: null, agentConsent: null, typed: "Northwind Holdings, LLC", at: 1 };
    const r = formationRecord(d, { stateName: "Wyoming", mode: "live", state: filing(), businessId: "b1", now: Date.UTC(2026, 10, 6), attestation });
    expect(JSON.stringify(r)).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(r).toMatchObject({
      name: "Northwind Holdings, LLC",
      type: "LLC",
      state: "Wyoming",
      ownerId: "e1",
      managed: "managers",
      llcType: "S Corporation",
      llcTypeSource: "Set at formation: elects S Corporation on Form 2553",
      taxElection: { form: "2553", dueBy: "2027-03-21", filed: false },
      foreign: { AZ: { notNeeded: true } },
      formationCost: { amount: 102.4, currency: "USD", payerId: "e1", treatment: "contribution" },
      status: "Forming",
    });
    expect(r.members).toEqual([
      { name: "Alder Partners, LLC", percent: 60, role: "Member", entityId: "e1", address: "1 Main St, Cheyenne, AZ 82001", contribution: { amount: 6000, kind: "cash", date: "2026-11-10" } },
      { name: "Ann Birch", percent: 40, role: "Member", address: "2 Elm St, Mesa, AZ 85201" },
      { name: "Alex Rivera", role: "Manager" },
    ]);
    const kept = (r.palm as { live: { formation: { request: FormationDraft; attestation: unknown } } }).live.formation;
    expect(kept.request.legalName).toBe("Northwind Holdings, LLC");
    expect(kept.attestation).toEqual(attestation);
  });

  it("writes an audit line that says who filed what", () => {
    const a = formationAudit(draft(), { assetId: "n1", stateName: "Wyoming", mode: "live", filingId: "f1", actorName: "Alex Rivera", fee: { total: 102.4, currency: "USD" }, ip: "203.0.113.5" });
    expect(a.action).toBe("entity.form");
    expect(a.summary).toBe("Filed articles of organization with Wyoming (organizer Alex Rivera), confirmed by Alex Rivera, $102.40, Palm filing f1");
    expect(a.detail).toMatchObject({ mode: "live", filingId: "f1", ip: "203.0.113.5" });
  });

  it("only fills blanks on a later update, and sets differences aside", () => {
    const done = summarizeFiling({ id: "f1", status: "completed", result: { registration_number: "2026-001", formation_date: "2026-11-08" } }, filing());
    const patch = formationPatch(done, "live", null, { status: "Dissolved", fileNumber: "2026-999", formationDate: "", registeredAgentSource: "" });
    expect(patch.status).toBeUndefined();
    expect(patch.fileNumber).toBeUndefined();
    expect(patch.formationDate).toBe("2026-11-08");
    expect(patch["palm/live/formationDifferences"]).toEqual({ fileNumber: { record: "2026-999", palm: "2026-001" } });
    expect(formationPatch(done, "live", null, { status: "Forming" }).status).toBe("Active");
  });
});
