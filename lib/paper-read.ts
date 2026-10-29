import Anthropic from "@anthropic-ai/sdk";
import { sb } from "./auth.js";
import type { MailRow } from "./stable.js";
import { storageRead } from "./storage.js";

/**
 * Reading a piece of paper mail (lib/stable.ts) the way a person would: the
 * envelope's sender, return address, recipient and postage, and, once Stable
 * has scanned it, what the piece is, what it asks for and by when. Kept on the
 * row (stable_mail.reading) with the copies it came from, so it's read once
 * per envelope and again when a scan arrives.
 */

const MODEL = "claude-opus-5-5";
const MAX_BYTES = 20 * 1024 * 1024;

export const KINDS = ["bill", "statement", "check", "tax", "government", "legal", "bank", "insurance", "notice", "personal", "marketing", "other"] as const;
export type PaperKind = (typeof KINDS)[number];

export type PaperReading = {
  /** One plain sentence: what this piece is. */
  headline: string;
  kind: PaperKind;
  /** action: someone should do something; fyi: worth knowing; junk: safe to ignore. */
  urgency: "action" | "fyi" | "junk";
  sender: { name: string | null; address: string | null };
  recipient: { name: string | null; address: string | null };
  /** The postage as printed, e.g. "Presorted First-Class Mail, U.S. postage paid, San Francisco, CA, Permit No. 634". */
  postage: string | null;
  mailClass: string | null;
  /** What to do about it, when the scan says. */
  action: string | null;
  dueDate: string | null;
  amounts: { label: string; amount: string }[];
  dates: { label: string; date: string }[];
  /** Account, invoice, case or notice numbers; account numbers only by their last four. */
  references: { label: string; value: string }[];
  /** What the contents say, a few sentences, when there's a scan. */
  contents: string | null;
  /** Every line printed on the envelope, top to bottom. */
  envelopeText: string[];
  /** Whether the scan was read too, or only the envelope. */
  fromScan: boolean;
};

const pair = (a: string, b: string) => ({
  type: "array",
  items: { type: "object", additionalProperties: false, required: [a, b], properties: { [a]: { type: "string" }, [b]: { type: "string" } } },
});
const party = { type: "object", additionalProperties: false, required: ["name", "address"], properties: { name: { type: ["string", "null"] }, address: { type: ["string", "null"] } } };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "kind", "urgency", "sender", "recipient", "postage", "mailClass", "action", "dueDate", "amounts", "dates", "references", "contents", "envelopeText"],
  properties: {
    headline: { type: "string" },
    kind: { type: "string", enum: [...KINDS] },
    urgency: { type: "string", enum: ["action", "fyi", "junk"] },
    sender: party,
    recipient: party,
    postage: { type: ["string", "null"] },
    mailClass: { type: ["string", "null"] },
    action: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
    amounts: pair("label", "amount"),
    dates: pair("label", "date"),
    references: pair("label", "value"),
    contents: { type: ["string", "null"] },
    envelopeText: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = [
  "You read paper mail for a family office. Its mailbox service photographs each envelope and, when asked, scans what's inside.",
  "You get the envelope photo, and the scanned contents when there are any. Report only what is printed; use null or an empty list for anything you can't read. Never guess.",
  "- sender: the return address block (name, then the address on one line, comma-separated). recipient: the delivery address block, the same way.",
  "- postage: the indicia or stamp as printed (e.g. 'Presorted First-Class Mail, U.S. Postage Paid, San Francisco, CA, Permit No. 634'). mailClass: just the class (First-Class, Presorted First-Class, Standard / Marketing Mail, Certified, Priority...).",
  "- envelopeText: every legible line on the envelope, top to bottom, as printed. Leave out barcode strings you can't read as text.",
  "- kind: bill (asks for payment), statement (account or periodic statement), check (a check or payment enclosed), tax (IRS or state tax), government (other agencies, licenses, courts' administrative notices), legal (lawyers, lawsuits, service of process), bank, insurance, notice (other notices or letters), personal, marketing (ads, solicitations, offers), other.",
  "- With only an envelope, judge kind from the sender and envelope markings, and say in the headline that it's from the envelope (e.g. 'Likely a statement from Stable, judging by the envelope').",
  "- urgency: action when the piece asks for payment, a reply, a signature or has a deadline; junk for marketing; fyi otherwise.",
  "- From the scan: action (what someone should do, one sentence), dueDate as YYYY-MM-DD, amounts with what each is (e.g. 'Amount due', '$1,240.00'), dates with labels, references (account, invoice, policy, case, notice numbers).",
  "- Account and card numbers: give only the last four digits, as '••1234'. Never write out a full account, card or Social Security number.",
  "- contents: two to four plain sentences on what the scan says, or null without a scan.",
  "- headline: one plain sentence a busy person reads first.",
].join("\n");

/** Which copies a reading came from: a new scan means read again. */
export function readingKey(row: Pick<MailRow, "envelope_path" | "scan_path">): string {
  return [row.envelope_path ?? "", row.scan_path ?? ""].join("|");
}

/** Whether the row's reading is missing or older than its copies. */
export function needsReading(row: Pick<MailRow, "envelope_path" | "scan_path"> & { reading_from?: string | null }): boolean {
  if (!row.envelope_path && !row.scan_path) return false;
  return row.reading_from !== readingKey(row);
}

type Block = Anthropic.Messages.ContentBlockParam;

async function blockFor(path: string): Promise<Block | null> {
  const file = await storageRead(path, "mail", { maxBytes: MAX_BYTES, timeoutMs: 20_000 });
  if (!file) return null;
  const ct = file.contentType.toLowerCase().split(";")[0].trim();
  const data = Buffer.from(file.bytes).toString("base64");
  if (ct === "application/pdf" || path.endsWith(".pdf")) return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  const img = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(ct) ? ct : path.endsWith(".png") ? "image/png" : path.match(/\.jpe?g$/) ? "image/jpeg" : null;
  return img ? { type: "image", source: { type: "base64", media_type: img as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data } } : null;
}

/** Shapes the model's JSON into a reading, dropping anything malformed. */
export function toReading(raw: unknown, fromScan: boolean): PaperReading {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const who = (v: unknown) => {
    const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { name: str(p.name), address: str(p.address) };
  };
  const pairs = <A extends string, B extends string>(v: unknown, a: A, b: B) =>
    (Array.isArray(v) ? v : [])
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .filter((x) => str(x[a]) && str(x[b]))
      .map((x) => ({ [a]: str(x[a])!, [b]: str(x[b])! }) as Record<A | B, string>)
      .slice(0, 20);
  const kind = KINDS.includes(o.kind as PaperKind) ? (o.kind as PaperKind) : "other";
  const urgency = o.urgency === "action" || o.urgency === "junk" ? o.urgency : "fyi";
  const due = str(o.dueDate);
  return {
    headline: str(o.headline) ?? "A piece of mail",
    kind,
    urgency,
    sender: who(o.sender),
    recipient: who(o.recipient),
    postage: str(o.postage),
    mailClass: str(o.mailClass),
    action: str(o.action),
    dueDate: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    amounts: pairs(o.amounts, "label", "amount"),
    dates: pairs(o.dates, "label", "date"),
    references: pairs(o.references, "label", "value"),
    contents: fromScan ? str(o.contents) : null,
    envelopeText: (Array.isArray(o.envelopeText) ? o.envelopeText : []).map(str).filter((s): s is string => !!s).slice(0, 40),
    fromScan,
  };
}

export class ReadingUnavailable extends Error {}

/** Reads the piece's envelope (and scan), keeps the reading on the row, and returns it. */
export async function readPiece(row: MailRow): Promise<PaperReading> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ReadingUnavailable("Add ANTHROPIC_API_KEY in Vercel to read mail.");
  const [envelope, scan] = await Promise.all([row.envelope_path ? blockFor(row.envelope_path) : null, row.scan_path ? blockFor(row.scan_path) : null]);
  if (!envelope && !scan) throw new ReadingUnavailable("There's no envelope or scan to read yet.");

  const content: Block[] = [];
  if (envelope) content.push({ type: "text", text: "The envelope:" }, envelope);
  if (scan) content.push({ type: "text", text: "The scanned contents:" }, scan);
  content.push({
    type: "text",
    text: `Stable lists it as from ${row.from_name || "an unknown sender"} to ${[row.recipient, row.recipient2].filter(Boolean).join(", ") || "an unknown recipient"}. Read this piece of mail.`,
  });

  const client = new Anthropic({ apiKey });
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  };
  let message: Anthropic.Messages.Message;
  try {
    // Server-side fallback on a safety decline (not yet in this SDK's types).
    message = await client.messages.create({ ...params, ...({ fallbacks: "default" } as Record<string, unknown>) }, { headers: { "anthropic-beta": "server-side-fallback-2026-07-01" } });
  } catch (err) {
    // If the fallback option itself is refused, run the plain request.
    if (!(err instanceof Anthropic.BadRequestError) || /credit balance/i.test(err.message)) throw err;
    message = await client.messages.create(params);
  }
  if (message.stop_reason === "refusal") throw new ReadingUnavailable("This piece couldn't be read.");
  if (message.stop_reason === "max_tokens") throw new ReadingUnavailable("The reading ran long; try again.");
  const text = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const reading = toReading(JSON.parse(text), !!scan);
  await sb(`stable_mail?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: { reading, reading_from: readingKey(row), reading_at: new Date().toISOString() },
  });
  return reading;
}
