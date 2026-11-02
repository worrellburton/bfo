import type { VercelRequest } from "@vercel/node";
import { z, type ZodType } from "zod";

/**
 * Request bodies and query strings checked against a schema (zod) before an
 * endpoint acts on them, so a field that is missing, the wrong shape or too
 * long is refused with a plain sentence instead of reaching the database or
 * a provider. `parseBody` and `parseQuery` throw BadRequest, which
 * handleError (lib/auth.ts) answers as 400 { error, message }.
 *
 *   const body = parseBody(req, z.object({ ids: idList, note: z.string().max(2000).optional() }));
 */

export class BadRequest extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The request body as sent (Vercel parses JSON; a string body is parsed here), or {} when there is none. */
export function rawBody(req: VercelRequest): unknown {
  const b = req.body;
  if (b === undefined || b === null || b === "") return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      throw new BadRequest("bad_json", "The request body isn't valid JSON.");
    }
  }
  return b;
}

/** The first problem a schema found, as one sentence a person can act on ("ids: expected an array"). */
export function problemText(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "The request isn't valid.";
  const where = issue.path.length ? `${issue.path.map(String).join(".")}: ` : "";
  return `${where}${issue.message}`;
}

export function parse<T>(value: unknown, schema: ZodType<T>, code = "bad_request"): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequest(code, problemText(r.error));
  return r.data;
}

/** The body checked against `schema`; unknown fields are dropped (zod's default), so extras can't ride along. */
export function parseBody<T>(req: VercelRequest, schema: ZodType<T>): T {
  return parse(rawBody(req), schema, "bad_request");
}

/** The query string checked against `schema` (every value arrives as a string or an array of them). */
export function parseQuery<T>(req: VercelRequest, schema: ZodType<T>): T {
  return parse(req.query ?? {}, schema, "bad_query");
}

// ── Pieces most endpoints share ─────────────────────────────────────────

/** A tree row id or any short opaque id BFO mints: word characters and dashes. */
export const id = z.string().regex(/^[\w-]{1,128}$/, "expected an id");
/** A UUID (sessions, Palm businesses, Bird messages). */
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "expected a UUID");
/** A list of ids, bounded so one request can't name the whole table. */
export const idList = z.array(id).min(1, "expected at least one id").max(500, "too many ids at once");
/** Short free text as typed by a person: trimmed, bounded. */
export const shortText = (max = 300) => z.string().trim().max(max, `at most ${max} characters`);
/** Longer free text (notes, a message), bounded. */
export const longText = (max = 20_000) => z.string().max(max, `at most ${max} characters`);
/** "YYYY-MM-DD". */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a date like 2026-01-31");
/** A two-letter state code. */
export const stateCode = z.string().regex(/^[A-Z]{2}$/, "expected a two-letter state");
/** A phone number as dialled: digits, with an optional leading +. */
export const phone = z.string().regex(/^\+?\d{7,15}$/, "expected a phone number");
/** The `action` field of the POST { action, … } endpoints. */
export const action = <const T extends readonly [string, ...string[]]>(...names: T) => z.enum(names);

export { z };
