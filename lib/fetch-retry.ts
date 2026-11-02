/**
 * fetch with a timeout and, for calls that are safe to repeat, a short retry
 * on the answers that mean "not now": 429, 502, 503, 504 and a dropped
 * connection. Three attempts with a growing pause (300 ms, then 900 ms, and
 * a little jitter), honouring Retry-After when the server sends one, all
 * inside one overall deadline. Only GET/HEAD retry unless `idempotent` says
 * the call is (a PUT with a key, a POST with an Idempotency-Key); anything
 * else is sent once, so a payment or a filing can never be made twice.
 *
 *   const r = await fetchRetry(url, { headers }, { timeoutMs: 20_000 });
 */

export type RetryOptions = {
  /** The whole call, attempts and pauses included; default 30 s. */
  timeoutMs?: number;
  /** Attempts in all; default 3. */
  tries?: number;
  /** Retry even though the method isn't GET/HEAD (the request carries an idempotency key). */
  idempotent?: boolean;
  /** Which answers to try again; default 429 and 502–504. */
  retryOn?: (res: Response) => boolean;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
};

export class FetchTimeout extends Error {
  constructor(url: string, ms: number) {
    super(`${new URL(url).host} didn't answer within ${Math.round(ms / 1000)}s.`);
  }
}

const defaultRetryOn = (res: Response) => res.status === 429 || (res.status >= 502 && res.status <= 504);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long the server asked us to wait (Retry-After in seconds or as a date), capped so one header can't stall the call. */
export function retryAfterMs(res: Response, capMs = 5_000): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, capMs) : null;
}

export async function fetchRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const tries = Math.max(1, opts.tries ?? 3);
  const method = (init.method ?? "GET").toUpperCase();
  const canRetry = opts.idempotent || method === "GET" || method === "HEAD";
  const retryOn = opts.retryOn ?? defaultRetryOn;
  const sleep = opts.sleep ?? wait;
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw lastError instanceof Error ? lastError : new FetchTimeout(url, timeoutMs);
    // The caller's own signal still aborts; ours adds the deadline.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    const onOuterAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!canRetry || attempt === tries || !retryOn(res)) return res;
      // The body is read and dropped so the connection can be reused.
      await res.arrayBuffer().catch(() => undefined);
      lastError = new Error(`${new URL(url).host} answered ${res.status}`);
      const pause = retryAfterMs(res) ?? 300 * 3 ** (attempt - 1) * (0.8 + Math.random() * 0.4);
      if (Date.now() + pause >= deadline) return res;
      await sleep(pause);
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      if (aborted && init.signal?.aborted) throw err; // the caller gave up
      lastError = aborted ? new FetchTimeout(url, timeoutMs) : err;
      if (!canRetry || attempt === tries || aborted) throw lastError;
      const pause = 300 * 3 ** (attempt - 1) * (0.8 + Math.random() * 0.4);
      if (Date.now() + pause >= deadline) throw lastError;
      await sleep(pause);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}
