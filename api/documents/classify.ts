import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser } from "../../lib/auth.js";

/**
 * Reads an uploaded entity document and says which formation filing it is,
 * so the entity page can file it in the right slot (EIN letter, W-9,
 * Articles/Certificate, Operating Agreement) and fill blank key facts.
 */

const MODEL = "claude-opus-5-5";
const MAX_FETCH_BYTES = 20 * 1024 * 1024;

export type DocKind = "ein_letter" | "w9" | "articles" | "operating_agreement" | "other";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "confidence", "entityName", "ein", "date", "state"],
  properties: {
    kind: { type: "string", enum: ["ein_letter", "w9", "articles", "operating_agreement", "other"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    entityName: { type: ["string", "null"] },
    ein: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
  },
} as const;

const SYSTEM = [
  "You sort a family office's entity documents into formation filings.",
  "Decide which one document type this is:",
  "- ein_letter: the IRS letter assigning an Employer Identification Number (CP 575, 147C), or an SS-4 confirmation.",
  "- w9: IRS Form W-9, Request for Taxpayer Identification Number.",
  "- articles: the state formation filing — Articles of Organization, Articles of Incorporation, Certificate of Formation, Certificate of Incorporation, Certificate of Organization.",
  "- operating_agreement: an LLC Operating Agreement or corporate Bylaws.",
  "- other: anything else (contracts, statements, invoices, tax returns, amendments, annual reports).",
  "Also extract, only when printed in the document: the entity's legal name, its EIN (format NN-NNNNNNN),",
  "the key date as YYYY-MM-DD (EIN letter: date issued; articles: filing/effective date; operating agreement: effective date; w9: signature date),",
  "and the state of formation as a full state name. Use null for anything not visible. Never guess.",
  "confidence: high when the document's title or form number makes the type unambiguous.",
].join("\n");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

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
  try {
    const r = await fetch(url);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.byteLength <= MAX_FETCH_BYTES) {
        const ct = (contentType || r.headers.get("content-type") || "").toLowerCase().split(";")[0];
        const data = buf.toString("base64");
        if (ct.includes("pdf")) {
          block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
        } else if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(ct)) {
          block = {
            type: "image",
            source: { type: "base64", media_type: ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data },
          };
        }
      }
    }
  } catch {
    // fall through — nothing to read
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
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
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
    console.error("classify-doc failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return res.status(502).json({ error: "classify_failed" });
  }
}
