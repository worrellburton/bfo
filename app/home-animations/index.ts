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
    id: "sunbeam",
    name: "The Sunbeam",
    line: "One shaft of four-o'clock sun crosses a dark room, and all you ever see is the dust it touches, turning slowly in the warm air.",
    load: () => import("./sunbeam"),
  },
  {
    id: "lens",
    name: "The Lens",
    line: "A still room of dust too fine to see, watched through a lens wide open at f/1: one thin plane is ever sharp, and it drifts through the cloud as slowly as a hand turns a focus ring.",
    load: () => import("./lens"),
  },
];

export const DEFAULT_BACKDROP = "sunbeam";

export const backdropById = (id: string | null | undefined): Backdrop => BACKDROPS.find((b) => b.id === id) ?? BACKDROPS.find((b) => b.id === DEFAULT_BACKDROP) ?? BACKDROPS[0];
