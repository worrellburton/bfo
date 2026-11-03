import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { lockupOf, modelOf, type Logo } from "./brand";
import { BrandLockup } from "./brand-lockup";
import { backdropById } from "./home-animations";
import type { BackdropProps } from "./home-animations/types";
import { Logo3D } from "./logo-3d";

/**
 * The front door's parts that draw, shared by the landing page and the
 * owner's gallery of backdrops: the backdrop (lazy, by id) and the mark in
 * the middle (app.css ".door"). Its state (typeface ready, screen lock,
 * reduced motion) is in door-state.ts.
 */

const cache = new Map<string, ComponentType<BackdropProps>>();

/** The backdrop with this id, loaded on first use; a deep-blue flat sky while it loads. */
export function DoorSky({ id, still }: { id: string | null | undefined; still: boolean }) {
  const backdrop = backdropById(id);
  const Backdrop = useMemo(() => {
    const hit = cache.get(backdrop.id);
    if (hit) return hit;
    const L = lazy(backdrop.load);
    cache.set(backdrop.id, L);
    return L;
  }, [backdrop]);
  return (
    <Suspense fallback={<canvas aria-hidden className="door-sky door-sky-flat" />}>
      <Backdrop key={backdrop.id} still={still} />
    </Suspense>
  );
}

/** The mark: the logo studio's 3D model if one is in use, else the lockup, letter by letter. */
export function DoorMark({ logo, still }: { logo: Logo | null | undefined; still: boolean }) {
  const model = modelOf(logo);
  const lockup = lockupOf(logo);
  return model ? (
    <h1 className="landing-logo door-mark" aria-label="BFO">
      <Logo3D src={model.glbUrl} poster={model.posterUrl} className="landing-logo-model" interactive spin={!still} exposure={1.1} />
    </h1>
  ) : (
    <h1 className="door-mark m-0">
      <BrandLockup font={lockup.font} finish={lockup.finish} size="hero" letters />
    </h1>
  );
}
