/**
 * A sent message waits ten seconds before it goes, so Send can be undone
 * (a notice sent by mistake can't be called back once it leaves). The wait
 * lives here, outside any page, so leaving Mail doesn't drop it, and closing
 * the tab while one waits asks first (a tab closed anyway doesn't send it).
 * Nothing reaches the mail service until the wait is over.
 */

export const UNDO_SEND_MS = 10_000;

type Pending = { id: string; timer: number; go: () => void; cancel: () => void };

const pending = new Map<string, Pending>();

function guardUnload(e: BeforeUnloadEvent) {
  if (pending.size) e.preventDefault();
}

function watch() {
  if (typeof window === "undefined") return;
  if (pending.size) window.addEventListener("beforeunload", guardUnload);
  else window.removeEventListener("beforeunload", guardUnload);
}

/**
 * Hold a send for `ms`, then run it. Returns `undo` (cancels it, if it hasn't
 * gone) and `now` (sends at once). `onCancelled` runs after an undo.
 */
export function holdSend(o: { send: () => Promise<void>; onCancelled: () => void; ms?: number }): { id: string; undo: () => boolean; now: () => void } {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
  const go = () => {
    const p = pending.get(id);
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.delete(id);
    watch();
    void o.send();
  };
  const timer = window.setTimeout(go, o.ms ?? UNDO_SEND_MS);
  pending.set(id, { id, timer, go, cancel: o.onCancelled });
  watch();
  return {
    id,
    undo: () => {
      const p = pending.get(id);
      if (!p) return false;
      window.clearTimeout(p.timer);
      pending.delete(id);
      watch();
      p.cancel();
      return true;
    },
    now: go,
  };
}

/** Sends waiting their ten seconds. */
export const sendsWaiting = () => pending.size;

/** A message whose send failed after Mail was left: kept here and reopened, with what went wrong, when Mail opens again. */
let failed: unknown = null;
export function keepFailed<T>(draft: T) {
  failed = draft;
}
export function takeFailed<T>(): T | null {
  const d = failed as T | null;
  failed = null;
  return d;
}
