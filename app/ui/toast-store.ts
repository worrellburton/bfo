/** The toast on screen (toast.ts writes it; the region in toast-region.tsx reads it). */

export type ToastOptions = {
  /** Past tense, with the count: "Archived 3 messages". */
  message: string;
  /** One action, usually Undo. */
  action?: { label: string; run: () => void };
  /** Milliseconds; 5000, or 8000 with an action. */
  duration?: number;
};

export type CurrentToast = ToastOptions & { id: number };

let current: CurrentToast | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function setToast(o: ToastOptions | null): void {
  current = o ? { ...o, id: ++seq } : null;
  for (const fn of [...listeners]) fn();
}

export function currentToast(): CurrentToast | null {
  return current;
}

export function subscribeToast(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
