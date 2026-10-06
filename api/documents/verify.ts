import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser } from "../../lib/auth.js";

/**
 * Cross-checks an entity's record against its own documents: Claude reads
 * the filings and other PDFs on file and reports, field by field, whether
 * the record matches what the documents say — plus who the documents say
 * owns the entity. Read-only: the page decides what to apply.
 */

const MODEL = "claude-opus-5-5";
const MAX_DOCS = 8;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const FIELDS = [
  "name",
  "type",
  "state",
  "ein",
  "formationDate",
  "address",
  "registeredAgent",
  "llcType",
  "operatingAgreementDate",
  "articlesOfOrgDate",
  "trustees",
  "grantors",
  "beneficiaries",
] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "fields", "owners", "ownershipStatus", "issues"],
  properties: {
    summary: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "found", "status", "source", "note"],
        properties: {
          field: { type: "string", enum: [...FIELDS] },
          found: { type: ["string", "null"] },
          status: { type: "string", enum: ["match", "mismatch", "missing_on_record", "not_found"] },
          source: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
        },
      },
    },
    owners: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "percent", "source"],
        properties: {
          name: { type: "string" },
          percent: { type: ["number", "null"] },
          source: { type: ["string", "null"] },
        },
      },
    },
    ownershipStatus: { type: "string", enum: ["match", "mismatch", "unclear"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "message"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          message: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You audit a family office's entity records against the entity's own legal documents.",
  "You are given the record as currently entered and the documents on file (EIN letter, W-9, articles/certificate, operating agreement or bylaws, and others).",
  "For each field in the record, report what the documents state and whether it matches:",
  "- match: the documents state the same value (ignore formatting differences: punctuation, case, 'LLC' vs ', LLC', date formats, address abbreviations).",
  "- mismatch: the documents clearly state a different value.",
  "- missing_on_record: the record is blank but the documents state a value.",
  "- not_found: no document states this field.",
  "Field meanings: name = legal name; type = LLC, C-Corp or Trust; state = state of formation (full name); ein = NN-NNNNNNN;",
  "formationDate = date the entity was formed/filed with the state (YYYY-MM-DD); address = principal/mailing address;",
  "registeredAgent = statutory/registered agent name; llcType = federal tax classification, one of 'Disregarded Entity', 'Partnership', 'C Corporation';",
  "operatingAgreementDate = effective date of the operating agreement or bylaws (YYYY-MM-DD); articlesOfOrgDate = filing date of the articles/certificate (YYYY-MM-DD).",
  "Report `found` in the record's format (dates as YYYY-MM-DD). `source` is the document name you read it from.",
  "Owners: list the members/shareholders and ownership percentages the documents state (operating agreement schedule of members, articles' members/managers, K-1/W-9 context).",
  "ownershipStatus compares them to the recorded owner: match, mismatch, or unclear when the documents don't say.",
  "issues: anything else a careful paralegal would flag — a document for a different entity, conflicting values between documents, an unsigned agreement, a W-9 with the wrong tax classification. Severity high for anything that could be legally or tax-relevant.",
  "For a trust (type Trust): name = the trust's name; state = governing law; formationDate = the date the trust was made; llcType = 'Grantor trust' or 'Non-grantor trust';",
  "trustees, grantors and beneficiaries = the people or entities named, comma-separated; registeredAgent, operatingAgreementDate and articlesOfOrgDate don't apply (not_found). A revocable living trust usually has no EIN of its own while the grantor is alive.",
  "Owners of a trust: report the grantors / settlors as owners only if the documents say so; otherwise ownershipStatus is unclear.",
  "Never guess. Only report what the documents actually state. The summary is one or two plain sentences.",
].join("\n");

/** Anthropic refused because the account behind ANTHROPIC_API_KEY has no credit. */
function outOfCredit(err: unknown): boolean {
  return err instanceof Anthropic.APIError && /credit balance/i.test(err.message);
}

type Body = {
  entity?: Record<string, string | null | undefined> & { owner?: string | null };
  documents?: { name: string; url: string; contentType?: string; filedAs?: string | null }[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "missing_api_key" });

  const { entity, documents } = (req.body || {}) as Body;
  if (!entity || !Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: "missing_params" });
  }

  // Read the documents (PDFs and images), filings first, within a size budget.
  const ordered = [...documents].sort((a, b) => Number(!!b.filedAs) - Number(!!a.filedAs)).slice(0, MAX_DOCS);
  const fetched = await Promise.all(
    ordered.map(async (d) => {
      try {
        const r = await fetch(d.url);
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = (d.contentType || r.headers.get("content-type") || "").toLowerCase().split(";")[0];
        return { doc: d, buf, ct };
      } catch {
        return null;
      }
    })
  );
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  const read: string[] = [];
  let total = 0;
  for (const f of fetched) {
    if (!f || total + f.buf.byteLength > MAX_TOTAL_BYTES) continue;
    const data = f.buf.toString("base64");
    const label = `${f.doc.name}${f.doc.filedAs ? ` (filed as ${f.doc.filedAs})` : ""}`;
    if (f.ct.includes("pdf")) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: label });
    } else if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(f.ct)) {
      content.push({ type: "text", text: `Image: ${label}` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: f.ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data },
      });
    } else {
      continue;
    }
    total += f.buf.byteLength;
    read.push(f.doc.name);
  }
  if (read.length === 0) return res.status(422).json({ error: "no_readable_documents" });

  const record = FIELDS.map((k) => `${k}: ${entity[k] ? String(entity[k]) : "(blank)"}`).join("\n");
  content.push({
    type: "text",
    text: `The entity record as entered:\n${record}\nrecorded owner: ${entity.owner || "(none)"}\n\nAudit the record against the documents above.`,
  });

  const client = new Anthropic({ apiKey });
  try {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    };
    let message: Anthropic.Messages.Message;
    try {
      // Server-side fallback on a safety decline (not yet in this SDK's types).
      message = await client.messages
        .stream(
          { ...params, ...({ fallbacks: "default" } as Record<string, unknown>) },
          { headers: { "anthropic-beta": "server-side-fallback-2026-07-01" } }
        )
        .finalMessage();
    } catch (err) {
      // If the fallback option itself is refused, run the plain request.
      if (!(err instanceof Anthropic.BadRequestError) || outOfCredit(err)) throw err;
      message = await client.messages.stream(params).finalMessage();
    }
    if (message.stop_reason === "refusal") return res.status(422).json({ error: "declined" });
    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "truncated" });
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const result = JSON.parse(text);
    return res.status(200).json({ ...result, documentsRead: read, checkedAt: Date.now() });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (outOfCredit(err)) return res.status(503).json({ error: "ai_unavailable" });
    console.error("verify failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return res.status(502).json({ error: "verify_failed" });
  }
}
