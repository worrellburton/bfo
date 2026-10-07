import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { canWrite, currentUser } from "../../lib/auth.js";
import { fetchDocument } from "../../lib/fetch-document.js";

/**
 * Reads an uploaded entity document and says which piece of paperwork it is
 * — formation filing, IRS letter or election, governance document, state
 * annual filing, trust document — so the entity page can file it in the
 * right slot and fill or check the record's key facts.
 */

const MODEL = "claude-sonnet-5-5";
const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/** Anthropic refused because the account behind ANTHROPIC_API_KEY has no credit. */
function outOfCredit(err: unknown): boolean {
  return err instanceof Anthropic.APIError && /credit balance/i.test(err.message);
}

const KINDS = [
  "ein_letter",
  "w9",
  "articles",
  "operating_agreement",
  "trust_agreement",
  "trust_certificate",
  "trust_schedule",
  "s_election",
  "s_election_accepted",
  "classification_election",
  "annual_report",
  "foreign_registration",
  "good_standing",
  "ownership_ledger",
  "minutes",
  "other",
] as const;
export type DocKind = (typeof KINDS)[number];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind", "confidence", "entityName", "ein", "date", "state", "trustees", "grantors", "beneficiaries",
    "taxClassification", "taxClassificationEvidence", "filingYear", "registeredAgent", "principalAddress", "members",
  ],
  properties: {
    kind: { type: "string", enum: [...KINDS] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    entityName: { type: ["string", "null"] },
    ein: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    trustees: { type: ["string", "null"] },
    grantors: { type: ["string", "null"] },
    beneficiaries: { type: ["string", "null"] },
    taxClassification: {
      anyOf: [{ type: "string", enum: ["Disregarded Entity", "Partnership", "S Corporation", "C Corporation"] }, { type: "null" }],
    },
    taxClassificationEvidence: { type: ["string", "null"] },
    filingYear: { type: ["integer", "null"] },
    registeredAgent: { type: ["string", "null"] },
    principalAddress: { type: ["string", "null"] },
    members: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "percent", "role"],
            properties: {
              name: { type: "string" },
              percent: { type: ["number", "null"] },
              role: { type: ["string", "null"] },
            },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

const SYSTEM = [
  "You sort a family office's entity documents (LLCs, corporations, limited partnerships, trusts) and read their key facts.",
  "Decide which one document type this is:",
  "- ein_letter: the IRS notice assigning an Employer Identification Number (CP 575 any version, a digital CP 575, Letter 147C), or an SS-4 confirmation.",
  "- w9: IRS Form W-9, Request for Taxpayer Identification Number.",
  "- articles: the state formation filing — Articles of Organization, Certificate of Formation, Articles/Certificate of Incorporation, Certificate of Organization, Certificate of Limited Partnership (an Arizona corporation's Certificate of Disclosure filed with it counts too).",
  "- operating_agreement: the governing agreement — LLC Operating Agreement / LLC Agreement, corporate Bylaws, or a Limited Partnership Agreement.",
  "- trust_agreement: a trust instrument — trust agreement, declaration of trust, an amendment or an amended and restated trust.",
  "- trust_certificate: a certification / certificate / abstract / memorandum of trust (the short summary banks ask for).",
  "- trust_schedule: a trust's Schedule A of assets, or an assignment / deed transferring property or membership interests into the trust.",
  "- s_election: IRS Form 2553, Election by a Small Business Corporation.",
  "- s_election_accepted: IRS notice CP261 (or other letter) accepting an S corporation election.",
  "- classification_election: IRS Form 8832 (entity classification election) or the IRS letter accepting it.",
  "- annual_report: a state's recurring filing or its receipt — Arizona corporation Annual Report, Nevada Annual List (and State Business License), Delaware Annual Franchise Tax Report, Delaware LLC/LP annual tax receipt, a New York Biennial Statement.",
  "- foreign_registration: registration to do business in another state — Arizona Foreign Registration Statement (L025), Application for Registration / for Authority to Transact Business, NY Application for Authority.",
  "- good_standing: a Certificate of Good Standing / Certificate of Existence / Certificate of Status from a state.",
  "- ownership_ledger: a membership ledger, member list, cap table, stock ledger, stock certificate or partner register.",
  "- minutes: meeting minutes, written consents or resolutions of members, managers, directors or shareholders (including organizational minutes).",
  "- other: anything else (contracts, statements, invoices, tax returns, statements of change, amendments to articles).",
  "Also extract, only when printed in the document (null otherwise — never guess):",
  "- entityName: the entity's legal name. ein: format NN-NNNNNNN.",
  "- date as YYYY-MM-DD: EIN letter — date issued; articles — filing/effective date; operating agreement or bylaws — effective date; trust documents — the date the trust was made; w9 — signature date; annual report — filing date; good standing — date issued; elections — effective date.",
  "- state: the state of formation as a full state name (for a trust: the state whose law governs it).",
  "- filingYear: for an annual report, list, franchise tax report or tax receipt, the year it covers.",
  "- registeredAgent: the statutory / registered agent's name, when the document names one.",
  "- principalAddress: the entity's principal office / known place of business, as printed.",
  "- members: the owners the document lists with their ownership — LLC members and percentages (operating agreement schedule, ledger, articles' member list), shareholders and shares percent, general/limited partners. role: 'member', 'manager', 'shareholder', 'general partner', 'limited partner', 'director' or 'officer'. Managers, directors and officers have percent null.",
  "For trust documents (agreement, certification, appointment of trustees, amendments, schedules), also list the trustees, the grantors / settlors / trustors,",
  "and the beneficiaries as named, comma-separated (people or entities). Use null when not stated.",
  "Federal tax classification (taxClassification) — report it only when this document states or proves it, else null:",
  "- EIN letter: CP 575 versions A/B list 'you must file the following form(s)' — Form 1065 = Partnership, Form 1120-S = S Corporation, Form 1120 = C Corporation.",
  "  The single-member version (CP 575 G, name line ending 'SOLE MBR', no filing requirement, explaining Form 8832/2553) = Disregarded Entity.",
  "- W-9 line 3a: LLC box with P = Partnership, S = S Corporation, C = C Corporation. A W-9 in the owner's name with the LLC on line 2, or 'Individual/sole proprietor or single-member LLC' checked = Disregarded Entity. Partnership / C corporation / S corporation boxes map directly.",
  "- Form 2553 or CP261 = S Corporation; Form 8832 = whichever classification it elects.",
  "- An operating agreement naming two or more members with no election = Partnership; exactly one member = Disregarded Entity.",
  "taxClassificationEvidence: one short phrase quoting what you read (e.g. 'CP 575: required to file Form 1065', 'W-9: LLC box, P', 'Operating agreement: 2 members').",
  "confidence: high when the document's title or form number makes the type unambiguous.",
].join("\n");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "missing_api_key" });

  const { url, fileName, contentType } = (req.body || {}) as {
    url?: string;
    fileName?: string;
    contentType?: string;
  };
  if (!url) return res.status(400).json({ error: "missing_url" });

  // Fetch the document so Claude can read it — PDFs and common images only.
  let block: Anthropic.Messages.ContentBlockParam | null = null;
  const file = await fetchDocument(url, MAX_FETCH_BYTES);
  if (file) {
    const ct = (contentType || file.contentType).toLowerCase().split(";")[0];
    const data = file.buf.toString("base64");
    if (ct.includes("pdf")) {
      block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    } else if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(ct)) {
      block = {
        type: "image",
        source: { type: "base64", media_type: ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data },
      };
    }
  }
  if (!block) return res.status(200).json({ kind: "other", confidence: "low", read: false });

  const client = new Anthropic({ apiKey });
  try {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [block, { type: "text", text: `File name: ${fileName ?? "(unknown)"}\nClassify this document.` }],
        },
      ],
    };
    let message: Anthropic.Messages.Message;
    try {
      // Server-side fallback on a safety decline (not yet in this SDK's types).
      message = await client.messages.create(
        { ...params, ...({ fallbacks: "default" } as Record<string, unknown>) },
        { headers: { "anthropic-beta": "server-side-fallback-2026-07-01" } }
      );
    } catch (err) {
      // If the fallback option itself is refused, run the plain request.
      if (!(err instanceof Anthropic.BadRequestError) || outOfCredit(err)) throw err;
      message = await client.messages.create(params);
    }
    if (message.stop_reason === "refusal") {
      return res.status(200).json({ kind: "other", confidence: "low", read: true });
    }
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as {
      kind: DocKind;
      confidence: "high" | "medium" | "low";
      entityName: string | null;
      ein: string | null;
      date: string | null;
      state: string | null;
      trustees: string | null;
      grantors: string | null;
      beneficiaries: string | null;
      taxClassification: "Disregarded Entity" | "Partnership" | "S Corporation" | "C Corporation" | null;
      taxClassificationEvidence: string | null;
      filingYear: number | null;
      registeredAgent: string | null;
      principalAddress: string | null;
      members: { name: string; percent: number | null; role: string | null }[] | null;
    };
    const ein = parsed.ein && /^\d{2}-?\d{7}$/.test(parsed.ein.trim())
      ? parsed.ein.trim().replace(/^(\d{2})-?(\d{7})$/, "$1-$2")
      : null;
    const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
    return res.status(200).json({ ...parsed, ein, date, read: true });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "rate_limited" });
    }
    if (outOfCredit(err)) {
      console.error("classify-doc: Anthropic account is out of credit");
      return res.status(503).json({ error: "ai_unavailable", message: "Document reading is paused — the Anthropic account behind BFO is out of credit." });
    }
    console.error("classify-doc failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return res.status(502).json({ error: "classify_failed" });
  }
}
