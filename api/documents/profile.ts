import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { canWrite, currentUser } from "../../lib/auth.js";
import { fetchDocument } from "../../lib/fetch-document.js";

/**
 * What an entity IS, read from its own governing documents: the operating
 * agreement (or bylaws, partnership or trust agreement) first, then its
 * formation filing and anything else on file. Returns a structured profile —
 * purpose, what it owns, who runs it, who owns it and how much, how it's
 * taxed, the terms that matter — for the entity page to show and keep.
 * Read-only: nothing is written here.
 */

const MODEL = "claude-sonnet-5-5";
const MAX_DOCS = 8;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;

const nullableString = { type: ["string", "null"] } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "whatItIs", "purpose", "properties", "management", "managers", "members", "taxTreatment",
    "taxEvidence", "governingLaw", "partnershipRepresentative", "keyTerms", "issues", "sources",
  ],
  properties: {
    whatItIs: { type: "string" },
    purpose: nullableString,
    properties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "state", "status"],
        properties: { description: { type: "string" }, state: nullableString, status: nullableString },
      },
    },
    management: {
      anyOf: [{ type: "string", enum: ["member-managed", "manager-managed", "board", "trustees", "general partner"] }, { type: "null" }],
    },
    managers: { type: "array", items: { type: "string" } },
    members: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "percent", "since"],
        properties: { name: { type: "string" }, percent: { type: ["number", "null"] }, since: nullableString },
      },
    },
    taxTreatment: {
      anyOf: [
        { type: "string", enum: ["Disregarded Entity", "Partnership", "S Corporation", "C Corporation", "Grantor trust", "Non-grantor trust"] },
        { type: "null" },
      ],
    },
    taxEvidence: nullableString,
    governingLaw: nullableString,
    partnershipRepresentative: nullableString,
    keyTerms: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = [
  "You explain a family office's entity from its own legal documents, for the family and their CPA.",
  "Read the governing document first — LLC operating agreement, corporate bylaws, partnership agreement or trust agreement — then the formation filing and the rest.",
  "When several versions exist (an original and a 2023 restatement), the latest signed one governs; earlier ones are history.",
  "whatItIs: two or three plain sentences — what the entity is for, what it owns or operates, and where it sits in the family structure (who owns it, what it owns).",
  "purpose: the purpose clause, condensed. properties: real estate or businesses it owns or owned, with the state and 'owned' or 'sold YYYY-MM-DD' when stated.",
  "management: how it is run. managers: the managers / directors / trustees / general partners named now.",
  "members: the CURRENT owners and percentages (the member schedule of the latest agreement, as amended by later assignments on file); since = the date they were admitted, when stated.",
  "taxTreatment: the federal classification the documents support, applying the IRS defaults —",
  "an LLC with one member is a Disregarded Entity, two or more a Partnership, unless an election (8832 / 2553) says otherwise. Template 'partnership' language in a single-member LLC's agreement does not make it a partnership; say so in taxEvidence.",
  "A revocable living trust is a Grantor trust. taxEvidence: one short line saying what decided it, naming the document.",
  "keyTerms: 3–6 provisions that matter in practice (transfer restrictions, distributions, capital calls, dissolution, who signs, indemnification), one short line each.",
  "issues: contradictions between documents, missing signatures, stale schedules or anything a careful paralegal would flag — one line each, most important first.",
  "sources: the document names you relied on. Never guess: use null or an empty list when the documents don't say. Never include Social Security or bank account numbers.",
].join("\n");

/** Anthropic refused because the account behind ANTHROPIC_API_KEY has no credit. */
function outOfCredit(err: unknown): boolean {
  return err instanceof Anthropic.APIError && /credit balance/i.test(err.message);
}

type Body = {
  entity?: { name?: string; type?: string; state?: string };
  documents?: { name: string; url: string; contentType?: string; filedAs?: string | null }[];
};

/** Governing documents first, then formation, then anything else. */
function rank(d: { name: string; filedAs?: string | null }): number {
  const k = d.filedAs ?? "";
  if (k === "operatingAgreement" || k === "trustAgreement") return 0;
  if (/operating agreement|bylaws|partnership agreement|trust agreement|declaration of trust|restated/i.test(d.name)) return 1;
  if (k === "articles" || k === "trustCertificate" || /articles|certificate of (formation|incorporation|trust)/i.test(d.name)) return 2;
  if (k) return 3;
  if (/assign|resolution|amendment|ledger|minutes|schedule/i.test(d.name)) return 4;
  return 5;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!canWrite(user)) return res.status(403).json({ error: "forbidden" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "missing_api_key" });

  const { entity, documents } = (req.body || {}) as Body;
  if (!entity?.name || !Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: "missing_params" });
  }

  const ordered = [...documents].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_DOCS);
  const fetched = await Promise.all(
    ordered.map(async (d) => {
      const file = await fetchDocument(d.url, MAX_DOC_BYTES);
      if (!file) return null;
      return { doc: d, buf: file.buf, ct: (d.contentType || file.contentType).toLowerCase().split(";")[0] };
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
      content.push({ type: "image", source: { type: "base64", media_type: f.ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data } });
    } else {
      continue;
    }
    total += f.buf.byteLength;
    read.push(f.doc.name);
  }
  if (read.length === 0) return res.status(422).json({ error: "no_readable_documents" });

  content.push({
    type: "text",
    text: `Entity on record: ${entity.name}${entity.type ? ` (${entity.type})` : ""}${entity.state ? `, ${entity.state}` : ""}.\nExplain what this entity is from the documents above.`,
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
      if (!(err instanceof Anthropic.BadRequestError) || outOfCredit(err)) throw err;
      message = await client.messages.stream(params).finalMessage();
    }
    if (message.stop_reason === "refusal") return res.status(422).json({ error: "declined" });
    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "truncated" });
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return res.status(200).json({ ...JSON.parse(text), documentsRead: read, checkedAt: Date.now() });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (outOfCredit(err)) {
      return res.status(503).json({ error: "ai_unavailable", message: "Document reading is paused — the Anthropic account behind BFO is out of credit." });
    }
    console.error("profile failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return res.status(502).json({ error: "profile_failed" });
  }
}
