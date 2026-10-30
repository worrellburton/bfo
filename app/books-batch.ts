// Batch edits and multi-page reads for the Books pages. Pure apart from the
// fetcher each function is handed, so the chunking and paging can be tested.

/** The most ids one batch_update accepts (lib/books/writes.ts batchUpdate). */
export const BATCH_MAX = 500;

/** The selection narrowed to the rows on screen — a batch never touches a row the person can't see. */
export function visibleSelection(selected: Set<string>, rows: Array<{ transaction_id: string }>): string[] {
  return rows.filter((r) => selected.has(r.transaction_id)).map((r) => r.transaction_id);
}

/** `ids` in runs of at most `size`. */
export function chunkIds(ids: string[], size = BATCH_MAX): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** A refusal the person can act on, from the server's status and error code. */
export function batchErrorMessage(status: number, code?: string): string {
  if (status === 403) return "You have view-only access to Books.";
  if (code === "bad_selection") return `Too many rows selected (at most ${BATCH_MAX} at a time).`;
  return "Couldn't apply that batch edit.";
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Apply one patch to every id, BATCH_MAX at a time, in order. Stops at the
 * first refusal; `done` says how many rows were saved before it.
 */
export async function postBatchEdit(
  fetcher: Fetcher,
  ids: string[],
  patch: Record<string, string>
): Promise<{ ok: true } | { ok: false; done: number; message: string }> {
  let done = 0;
  for (const part of chunkIds(ids)) {
    let res: Response;
    try {
      res = await fetcher("/api/books/data", {
        method: "POST",
        body: JSON.stringify({ action: "batch_update", transaction_ids: part, ...patch }),
      });
    } catch {
      return { ok: false, done, message: batchErrorMessage(0) };
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const base = batchErrorMessage(res.status, d?.error);
      return { ok: false, done, message: done ? `${base} ${done} of ${ids.length} were saved.` : base };
    }
    done += part.length;
  }
  return { ok: true };
}

/**
 * Every row of a transactions query, 500 at a time until a short page. The
 * server caps a page at 500, so a single request silently drops the rest.
 */
export async function fetchAllTxns<T>(fetcher: Fetcher, params: URLSearchParams, failMessage = "Couldn't load transactions."): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const qs = new URLSearchParams(params);
    qs.set("limit", "500");
    qs.set("offset", String(offset));
    qs.set("summary", "0");
    const res = await fetcher(`/api/books/data?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || failMessage);
    const page: T[] = data.transactions ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
