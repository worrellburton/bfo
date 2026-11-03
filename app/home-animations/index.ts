import type { ComponentType } from "react";
import type { BackdropProps } from "./types";

/**
 * The home-page backdrops: what the front door (routes/landing.tsx) can show
 * behind the mark, and what the owner's gallery (routes/home-animations.tsx)
 * flips through. Each is its own lazy chunk; `load` is handed to React.lazy.
 * The one the site shows is the "home-animation" brand setting (api/brand.ts),
 * or DEFAULT_BACKDROP when none is set or the id is unknown.
 */
export type Backdrop = {
  id: string;
  name: string;
  /** One sentence for the gallery card. */
  line: string;
  load: () => Promise<{ default: ComponentType<BackdropProps> }>;
};

export const BACKDROPS: Backdrop[] = [
  {
    id: "orrery",
    name: "The Orrery",
    line: "A family's holdings as a system: rings of light in slow orbit around one point.",
    load: () => import("./orrery"),
  },
];

export const DEFAULT_BACKDROP = "orrery";

export const backdropById = (id: string | null | undefined): Backdrop => BACKDROPS.find((b) => b.id === id) ?? BACKDROPS.find((b) => b.id === DEFAULT_BACKDROP) ?? BACKDROPS[0];
