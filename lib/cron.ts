import { alertAdmins } from "./alert.js";
import { sb } from "./auth.js";
import { errorText, log } from "./log.js";

/**
 * A scheduled run, recorded in cron_runs (migration 20261027_ops_alerts) so
 * the System card can say when each cron last ran and how it went. The job
 * marks what went wrong with `run.failed(...)`; an error it doesn't catch
 * counts the same and is rethrown. Either way the owners/admins are alerted
 * once (lib/alert.ts, kind "cron:<name>"). The bookkeeping itself never
 * throws: a database that can't record the run doesn't stop the run.
 */

export type CronRun = {
  /** Something worth seeing beside the run (e.g. why it was skipped). */
  note: (text: string) => void;
  /** Part of the job didn't finish and the data is now stale. */
  failed: (text: string) => void;
};

export async function recordCronRun<T>(name: string, fn: (run: CronRun) => Promise<T>): Promise<T> {
  const area = `cron:${name}`;
  const notes: string[] = [];
  const failures: string[] = [];
  const run: CronRun = {
    note: (t) => notes.push(t),
    failed: (t) => {
      failures.push(t);
      log.error(area, t);
    },
  };
  const id = await start(name);
  log.info(area, "started", { run: id });
  let result: T;
  try {
    result = await fn(run);
  } catch (err) {
    failures.push(errorText(err));
    log.error(area, "threw", { error: err });
    await finish(id, false, [...failures, ...notes].join("\n"));
    await alertAdmins(area, `${name} cron failed`, failures.join("\n"));
    throw err;
  }
  const ok = failures.length === 0;
  await finish(id, ok, [...failures, ...notes].join("\n"));
  if (ok) log.info(area, "finished", { note: notes.join("; ") || undefined });
  else await alertAdmins(area, `${name} cron didn't finish cleanly`, failures.join("\n"));
  return result;
}

async function start(name: string): Promise<string | null> {
  try {
    const rows = await sb<{ id: string }[]>("cron_runs", { method: "POST", body: { name, started_at: new Date().toISOString() }, prefer: "return=representation" });
    return rows?.[0]?.id ?? null;
  } catch (err) {
    log.warn(`cron:${name}`, "couldn't record the run's start", { error: err });
    return null;
  }
}

async function finish(id: string | null, ok: boolean, note: string): Promise<void> {
  if (!id) return;
  try {
    await sb(`cron_runs?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { finished_at: new Date().toISOString(), ok, note: note.slice(0, 4000) || null }, prefer: "return=minimal" });
  } catch (err) {
    log.warn("cron", "couldn't record the run's end", { error: err, run: id });
  }
}
