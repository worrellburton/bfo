import { useEffect, useRef, useState, type RefObject } from "react";
import { getMessage, getThread, notifyMailChanged, type MailMessage, type MailSummary } from "../mail-client";
import { listRows, type ListState } from "./list-state";

/** The message open in the reader (from the URL's `m`), its cache, and its conversation. */
export function useOpenMessage({ openId, listRef, patchRow }: { openId: string | null; listRef: RefObject<ListState | null>; patchRow: (id: string, patch: Partial<MailSummary>) => void }) {
  // ── The open message ──────────────────────────────────────────────────

  const cache = useRef(new Map<string, MailMessage>());
  const [open, setOpen] = useState<{ id: string; message: MailMessage | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!openId) {
      setOpen(null);
      return;
    }
    const hit = cache.current.get(openId) ?? null;
    const row = listRows(listRef.current).find((m) => m.id === openId);
    setOpen({ id: openId, message: hit, error: null });
    // A cached copy will do, unless the list says it's unread again (fetching marks it read).
    if (hit && (!row || row.read)) return;
    let alive = true;
    // From Active, the row stood for the whole conversation: opening it reads all of it.
    const cur = listRef.current;
    getMessage(openId, { conversation: cur?.folder === "active" && !cur.q })
      .then(({ message }) => {
        if (!alive) return;
        cache.current.set(openId, message);
        // The Reader has it at once: it renders under the envelope (so its pictures and frame load meanwhile)
        // and is revealed as the letter comes forward. A page already showing the message takes the fresh copy quietly.
        setOpen({ id: openId, message, error: null });
        if (!row || !row.read) {
          patchRow(openId, { read: true });
          notifyMailChanged();
        }
      })
      .catch((e) => alive && setOpen({ id: openId, message: null, error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [openId]);

  /** The open message's conversation (newest first), and the one just sent into it, which animates in. */
  const [thread, setThread] = useState<{ id: string; messages: MailMessage[] } | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => {
    setFreshId(null);
    if (!openId) return setThread(null);
    let alive = true;
    getThread(openId)
      .then(({ messages }) => alive && setThread({ id: openId, messages }))
      .catch(() => alive && setThread(null));
    return () => {
      alive = false;
    };
  }, [openId]);

  return { cache, open, setOpen, thread, setThread, freshId, setFreshId };
}
