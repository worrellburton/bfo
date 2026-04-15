import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_FETCH_BYTES = 5 * 1024 * 1024; // 5 MB cap on the document we send to Claude

function sanitizeName(raw: string): string {
  return raw
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?<>|]+/g, "-")
    .trim()
    .slice(0, 120);
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]{1,6}$/, "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "missing_api_key", message: "ANTHROPIC_API_KEY is not set" });
  }

  const { currentName, contentType, url, context } = (req.body || {}) as {
    currentName?: string;
    contentType?: string;
    url?: string;
    context?: string;
  };

  if (!currentName) {
    return res.status(400).json({ error: "missing_current_name" });
  }

  const client = new Anthropic({ apiKey });

  // Try to fetch a small amount of the file so the model can actually look
  // at the document when it's a PDF or image. If the file is large or the
  // fetch fails we still answer based on the filename alone.
  let fileBlock: Anthropic.Messages.ContentBlockParam | null = null;
  if (url) {
    try {
      const fetchRes = await fetch(url);
      if (fetchRes.ok) {
        const len = Number(fetchRes.headers.get("content-length") || "0");
        if (!len || len <= MAX_FETCH_BYTES) {
          const buf = Buffer.from(await fetchRes.arrayBuffer());
          if (buf.byteLength <= MAX_FETCH_BYTES) {
            const ct = (contentType || fetchRes.headers.get("content-type") || "").toLowerCase();
            const b64 = buf.toString("base64");
            if (ct.includes("pdf")) {
              fileBlock = {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: b64 },
              } as Anthropic.Messages.ContentBlockParam;
            } else if (ct.startsWith("image/")) {
              const mt = ct.split(";")[0];
              if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mt)) {
                fileBlock = {
                  type: "image",
                  source: { type: "base64", media_type: mt as any, data: b64 },
                } as Anthropic.Messages.ContentBlockParam;
              }
            }
          }
        }
      }
    } catch {
      // ignore — fall back to name-only
    }
  }

  const instructions = [
    "You rename document files for a family-office document vault.",
    "Suggest one clean, descriptive, human-readable title for this document.",
    "Rules:",
    "- Use Title Case.",
    "- No file extension.",
    "- No quotes, brackets, or slashes.",
    "- Keep it under ~80 characters.",
    "- Prefer the form: <Document Type> — <Counterparty or Subject> (<Year or Date if visible>).",
    "- If the document is clearly a specific form (W-9, Articles of Organization, Operating Agreement, MSA, Invoice, Trial Balance, Balance Sheet, etc.), name it that way.",
    "- Do not invent information not supported by the filename or content.",
    "Return ONLY the new name as plain text — no preamble, no explanation, no markdown.",
  ].join("\n");

  const userText = [
    `Current filename: ${currentName}`,
    contentType ? `MIME type: ${contentType}` : "",
    context ? `Context: ${context}` : "",
    fileBlock ? "The document is attached — read it to decide the best name." : "No file content available; rename based on the filename alone.",
  ]
    .filter(Boolean)
    .join("\n");

  const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: userText }];
  if (fileBlock) content.unshift(fileBlock);

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      system: instructions,
      messages: [{ role: "user", content }],
    });

    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = sanitizeName(stripExtension(text.split("\n")[0] || ""));
    if (!cleaned) {
      return res.status(502).json({ error: "empty_response" });
    }
    return res.status(200).json({ name: cleaned, usedFileContent: !!fileBlock });
  } catch (err: any) {
    console.error("rename-doc failed", err);
    return res.status(500).json({
      error: "claude_error",
      message: err?.message || "Claude request failed",
    });
  }
}
