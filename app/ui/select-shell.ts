/**
 * The open state, trigger ref and overlay registration a listbox needs
 * (select.tsx): an anchored panel on desktop, a sheet on touch.
 */

import { useId, useRef, useState } from "react";
import { useTouch } from "./media";
import { useAnchor, useOverlay, usePresence } from "./overlay-manager";

export type ListboxShell = ReturnType<typeof useListbox>;

/** Use with ListboxPanel: put `triggerRef` on the trigger and toggle `setOpen`. */
export function useListbox() {
  const [open, setOpen] = useState(false);
  const touch = useTouch();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const { mounted, leaving } = usePresence(open, touch ? 200 : 120);
  const handle = useOverlay({ open, onClose: () => setOpen(false), kind: "select", modal: touch, trigger: triggerRef });
  const pos = useAnchor(open && !touch, triggerRef, handle.panelRef, { matchWidth: true, minWidth: 200 });
  return { open, setOpen, touch, triggerRef, listId, mounted, leaving, handle, pos };
}
