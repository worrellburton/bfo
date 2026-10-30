/**
 * One JSON line per event, so Vercel's log search can filter by `area`
 * (e.g. area:"cron:books-sync"). The rest of the repo still uses console.*
 * directly; new operational code logs through here.
 *
 *   log.info("cron:books-sync", "synced", { items: 3 })
 *   → {"level":"info","area":"cron:books-sync","msg":"synced","items":3,"at":"2026-…"}
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
