import { flushSync } from "react-dom";

/**
 * Mail's page transitions, on the View Transitions API.
 *
 * The browser snapshots the page before an update and animates to the page
 * after it, so a transition always plays to its end whatever arrives in the
 * meantime: the list sliding out and the message in, or a loader fading into
 * the content it was waiting for. Transitions queue rather than interrupt
 * one another, so a message that loads while the page is still sliding waits
 * its turn instead of cutting the slide short.
 *
 * The <html> element carries data-vt (the kind) and data-vt-dir (the
 * direction) while a transition runs; app.css keys its animations off them.
 * Without the API, or under reduced motion, the update simply runs.
 */

export type TransitionKind = "mail" | "mail-swap";
export type TransitionDirection = "forward" | "back";

type Doc = Document & { startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> } };

export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && typeof (document as Doc).startViewTransition === "function" && !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

let active: Promise<void> = Promise.resolve();

/**
 * Run `update` (which changes the DOM, synchronously or via the promise it
 * returns) as a view transition of the given kind. Sync updates are flushed
 * so the snapshot after them is complete.
 */
export function transition(kind: TransitionKind, dir: TransitionDirection, update: () => void | Promise<void>): Promise<void> {
  if (!supportsViewTransitions()) {
    const r = update();
    return r instanceof Promise ? r : Promise.resolve();
  }
  const doc = document as Doc;
  const run = async () => {
    const html = document.documentElement;
    html.dataset.vt = kind;
    html.dataset.vtDir = dir;
    try {
      const vt = doc.startViewTransition!(() => {
        const r = update();
        if (r instanceof Promise) return r;
        return undefined;
      });
      await vt.finished;
    } catch {
      // Skipped (another started, or the tab went away): the update still happened.
    } finally {
      if (html.dataset.vt === kind) {
        delete html.dataset.vt;
        delete html.dataset.vtDir;
      }
    }
  };
  // One at a time, so a later update never cuts a running transition short.
  const next = active.then(run, run);
  active = next;
  return next;
}

/** A sync state update as a transition: the update is flushed inside the snapshot window. */
export function transitionSync(kind: TransitionKind, dir: TransitionDirection, update: () => void): Promise<void> {
  return transition(kind, dir, () => {
    flushSync(update);
  });
}

/** True on a phone-sized screen, where Mail moves between the list and a message as whole pages. */
export function phoneScreen(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(max-width: 767px)").matches ?? false);
}
