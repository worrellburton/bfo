/**
 * One JSON line per event, so Vercel's log search can filter by `area`
 * (e.g. area:"cron:books-sync") or by `reqId`, the id Vercel stamps on the
 * request (x-vercel-id), which ties every line of one request together.
 *
 *   log.info("cron:books-sync", "synced", { items: 3 })
 *   → {"level":"info","area":"cron:books-sync","msg":"synced","items":3,"at":"2026-…"}
 *
 *   const l = reqLog(req, "mail");   l.warn("refused", { status: 403 })
 *   → {"level":"warn","area":"mail","msg":"refused","status":403,"reqId":"iad1::…","at":"…"}
 */

type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

/** An error as a log field: its message (and name when it isn't a plain Error). */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function replacer(_key: string, value: unknown) {
  if (value instanceof Error) return errorText(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function write(level: LogLevel, area: string, msg: string, fields?: LogFields) {
  let line: string;
  try {
    line = JSON.stringify({ level, area, msg, ...(fields ?? {}), at: new Date().toISOString() }, replacer);
  } catch {
    line = JSON.stringify({ level, area, msg, at: new Date().toISOString() });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (area: string, msg: string, fields?: LogFields) => write("info", area, msg, fields),
  warn: (area: string, msg: string, fields?: LogFields) => write("warn", area, msg, fields),
  error: (area: string, msg: string, fields?: LogFields) => write("error", area, msg, fields),
};

/** Vercel's id for the request (x-vercel-id), the key to every log line it wrote; "" outside Vercel. */
export function requestId(req: { headers: Record<string, string | string[] | undefined> } | undefined): string {
  const v = req?.headers?.["x-vercel-id"];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** A logger for one request: every line carries its reqId and the area. */
export function reqLog(req: { headers: Record<string, string | string[] | undefined> } | undefined, area: string) {
  const reqId = requestId(req);
  const tag = (fields?: LogFields) => (reqId ? { ...(fields ?? {}), reqId } : fields);
  return {
    info: (msg: string, fields?: LogFields) => write("info", area, msg, tag(fields)),
    warn: (msg: string, fields?: LogFields) => write("warn", area, msg, tag(fields)),
    error: (msg: string, fields?: LogFields) => write("error", area, msg, tag(fields)),
  };
}
