import type { ReactElement, Ref, RefCallback } from "react";

/** One ref callback that feeds several refs (a component's own and its caller's). */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined | null>): RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(value);
      else (ref as { current: T | null }).current = value;
    }
  };
}

/** The ref a caller put on an element (React 19 passes it as a prop). */
export function elementRef<T>(el: ReactElement): Ref<T> | undefined {
  return (el.props as { ref?: Ref<T> }).ref;
}

/** A handler that runs the caller's own first, then ours unless theirs prevented the default. */
export function chain<E extends { defaultPrevented?: boolean }>(theirs: ((e: E) => void) | undefined, ours: (e: E) => void): (e: E) => void {
  return (e: E) => {
    theirs?.(e);
    if (!e.defaultPrevented) ours(e);
  };
}
