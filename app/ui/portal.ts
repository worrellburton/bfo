/**
 * The single portal root every overlay renders into: <div id="overlays"> at
 * the end of <body> (docs/DESIGN.md §8.19, §14.4). Created on first use and
 * never moved (moving it would blur whatever has focus inside). Found by its
 * data attribute, so a page element that happens to use the id can't
 * capture it.
 */
export function overlayRoot(): HTMLElement {
  let el = document.querySelector<HTMLElement>("body > [data-overlay-root]");
  if (!el) {
    el = document.createElement("div");
    el.id = "overlays";
    el.setAttribute("data-overlay-root", "");
    document.body.appendChild(el);
  }
  return el;
}
