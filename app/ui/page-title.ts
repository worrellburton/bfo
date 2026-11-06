/**
 * The tab title (docs/DESIGN.md §5.5: "Page · BFO", "Record · Section · BFO")
 * and the shell's palette, for pages and the error page.
 */

import { useEffect } from "react";

/** Sets the tab title: useDocumentTitle("Northwind Holdings, LLC", "Entities") → "Northwind Holdings, LLC · Entities · BFO". */
export function useDocumentTitle(...parts: Array<string | null | undefined | false>) {
  const title = [...parts.filter(Boolean), "BFO"].join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Ask the shell to open the command palette (it listens for this event). */
export function openPalette() {
  window.dispatchEvent(new CustomEvent("bfo:open-palette"));
}
