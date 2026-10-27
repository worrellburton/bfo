import { createContext, useCallback, useContext, useRef } from "react";
import { heldSeed, type PalmBundlePart, type PalmBundlePartName, type SeedHold } from "../palm";
import type { EntityView } from "./derive";
import type { Asset, EntityTab } from "./model";
import type { EntityPage } from "./use-entity";

/**
 * Everything a view needs: the page's state and actions (`page`), the
 * values worked out from the record (`view`), and the loaded record itself.
 */
export type EntityContext = {
  page: EntityPage;
  view: EntityView;
  asset: Asset;
  tabPath: (t: EntityTab) => string;
  goToTab: (t: EntityTab, anchor?: string, block?: ScrollLogicalPosition) => void;
};

const Ctx = createContext<EntityContext | null>(null);
export const EntityProvider = Ctx.Provider;

export function useEntity(): EntityContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEntity outside EntityProvider");
  return c;
}

/**
 * A card's share of the page's opening read of Palm. The returned function,
 * called in the card's effect with its key (entity and mode) and what it asks
 * for, gives the bundle's part when the page just opened with it, else null:
 * the card then reads Palm itself, as it does whenever it asks again.
 */
export function usePalmSeed<T>(name: PalmBundlePartName): (key: string, asks?: string) => PalmBundlePart<T> | null {
  const { page } = useEntity();
  const take = useRef(page.takePalmPart);
  take.current = page.takePalmPart;
  const hold = useRef<SeedHold<T> | null>(null);
  return useCallback((key: string, asks = "") => heldSeed(hold, `${key}|${asks}`, () => take.current<T>(name, key)), [name]);
}
