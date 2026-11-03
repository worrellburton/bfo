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
    line: "A family's holdings as a system: seven rings of light in slow orbit around one small point, seen low and close, like a watch movement through its glass.",
    load: () => import("./orrery"),
  },
  {
    id: "sunbeam",
    name: "The Sunbeam",
    line: "One shaft of four-o'clock sun crosses a dark room, and all you ever see is the dust it touches, turning slowly in the warm air.",
    load: () => import("./sunbeam"),
  },
  {
    id: "glitter-path",
    name: "The Glitter Path",
    line: "Moonlight on a black sea: ten thousand gold glints that form, break and form again with every swell, a path that widens toward you and never once hurries.",
    load: () => import("./glitter-path"),
  },
  {
    id: "silk",
    name: "Champagne Silk",
    line: "A single length of silk hangs behind the mark and breathes once every half minute, and you only see it where the light catches a fold.",
    load: () => import("./silk"),
  },
  {
    id: "ink",
    name: "Ink in Water",
    line: "A bead of gold ink opens in black water and takes ninety seconds to become the water.",
    load: () => import("./ink"),
  },
];

export const DEFAULT_BACKDROP = "orrery";

export const backdropById = (id: string | null | undefined): Backdrop => BACKDROPS.find((b) => b.id === id) ?? BACKDROPS.find((b) => b.id === DEFAULT_BACKDROP) ?? BACKDROPS[0];
