import { createContext, useContext } from "react";
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
