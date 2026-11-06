import { describe, expect, it, vi } from "vitest";
import {
  OverlayStack,
  isModalKind,
  namesWithMore,
  needsDiscard,
  normalizeTyped,
  pickInitialFocus,
  placeAnchored,
  returnFocusTarget,
  sheetDragCloses,
  trapTarget,
  typeAhead,
  typedMatches,
  type StackEntry,
} from "../app/ui/overlay-rules";

const entry = (id: number, kind: StackEntry["kind"], modal = isModalKind(kind)): StackEntry => ({ id, kind, modal });

describe("the overlay stack", () => {
  it("acts on the top entry only", () => {
    const s = new OverlayStack();
    s.push(entry(1, "dialog"));
    s.push(entry(2, "menu"));
    expect(s.top()?.id).toBe(2);
    expect(s.isTop(1)).toBe(false);
    s.remove(2);
    expect(s.isTop(1)).toBe(true);
    s.remove(1);
    expect(s.top()).toBeUndefined();
  });

  it("knows when a modal is open, so the app behind goes inert", () => {
    const s = new OverlayStack();
    s.push(entry(1, "menu"));
    expect(s.hasModal()).toBe(false);
    s.push(entry(2, "confirm"));
    expect(s.hasModal()).toBe(true);
    s.remove(2);
    expect(s.hasModal()).toBe(false);
  });

  it("never stacks scrims: only the lowest modal draws one", () => {
    const s = new OverlayStack();
    s.push(entry(1, "dialog"));
    s.push(entry(2, "confirm"));
    expect(s.scrimOwner()).toBe(1);
    expect(s.isCovered(1)).toBe(true);
    expect(s.isCovered(2)).toBe(false);
    s.remove(1);
    expect(s.scrimOwner()).toBe(2);
  });

  it("re-pushing an entry moves it to the top instead of duplicating it", () => {
    const s = new OverlayStack();
    s.push(entry(1, "dialog"));
    s.push(entry(2, "dialog"));
    s.push(entry(1, "dialog"));
    expect(s.entries.map((e) => e.id)).toEqual([2, 1]);
  });

  it("tells subscribers of each change, and not of a no-op", () => {
    const s = new OverlayStack();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.push(entry(1, "dialog"));
    s.remove(1);
    s.remove(1);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.push(entry(3, "dialog"));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("makes menus, popovers and selects modal only as phone sheets", () => {
    expect(isModalKind("menu")).toBe(false);
    expect(isModalKind("menu", true)).toBe(true);
    expect(isModalKind("popover")).toBe(false);
    expect(isModalKind("sheet")).toBe(true);
    expect(isModalKind("confirm")).toBe(true);
  });
});

describe("where focus goes on open", () => {
  const all = { initial: "init", typeField: "type", cancel: "cancel", narrowest: "narrow", primary: "go", firstField: "field", checkedItem: "checked", firstItem: "first", title: "title" };

  it("prefers the caller's choice", () => {
    expect(pickInitialFocus(all, "danger")).toBe("init");
  });
  it("puts a type-to-confirm dialog in its field", () => {
    expect(pickInitialFocus({ ...all, initial: null }, "danger")).toBe("type");
  });
  it("starts a destructive or binding confirm on Cancel", () => {
    const c = { cancel: "cancel", primary: "go", title: "title" };
    expect(pickInitialFocus(c, "danger")).toBe("cancel");
    expect(pickInitialFocus(c, "commit")).toBe("cancel");
  });
  it("starts a routine confirm on its action", () => {
    expect(pickInitialFocus({ cancel: "cancel", primary: "go" }, "default")).toBe("go");
  });
  it("offers the narrowest scope first", () => {
    expect(pickInitialFocus({ narrowest: "only this one", primary: "go" }, "default")).toBe("only this one");
  });
  it("goes to the first field of a form, a menu's checked item, then its first", () => {
    expect(pickInitialFocus({ firstField: "name", title: "t" })).toBe("name");
    expect(pickInitialFocus({ checkedItem: "b", firstItem: "a" })).toBe("b");
    expect(pickInitialFocus({ firstItem: "a", title: "t" })).toBe("a");
  });
  it("falls back to the title, then nothing", () => {
    expect(pickInitialFocus({ title: "t" })).toBe("t");
    expect(pickInitialFocus({})).toBeNull();
  });
});

describe("the focus trap", () => {
  const list = ["a", "b", "c"];
  it("wraps from the last to the first and back", () => {
    expect(trapTarget(list, "c", false, true)).toBe("a");
    expect(trapTarget(list, "a", true, true)).toBe("c");
  });
  it("lets the browser move within the overlay", () => {
    expect(trapTarget(list, "a", false, true)).toBeNull();
    expect(trapTarget(list, "b", true, true)).toBeNull();
  });
  it("pulls focus back in from outside", () => {
    expect(trapTarget(list, "x", false, false)).toBe("a");
    expect(trapTarget(list, "x", true, false)).toBe("c");
    expect(trapTarget(list, null, false, true)).toBe("a");
  });
  it("does nothing with nothing to focus", () => {
    expect(trapTarget([], "a", false, true)).toBeNull();
  });
});

describe("returning focus", () => {
  it("goes back to the opener while it is on the page, else to main", () => {
    expect(returnFocusTarget("opener", () => true, "main")).toBe("opener");
    expect(returnFocusTarget("opener", () => false, "main")).toBe("main");
    expect(returnFocusTarget(null, () => true, "main")).toBe("main");
  });
});

describe("unsaved input", () => {
  it("asks before Escape, the scrim or × throw it away, not before an action", () => {
    expect(needsDiscard(true, "escape")).toBe(true);
    expect(needsDiscard(true, "scrim")).toBe(true);
    expect(needsDiscard(true, "close")).toBe(true);
    expect(needsDiscard(true, "action")).toBe(false);
    expect(needsDiscard(false, "escape")).toBe(false);
  });
});

describe("typed confirmation", () => {
  it("ignores case, outer spaces and curly quotes", () => {
    expect(typedMatches("  northwind holdings, llc ", "Northwind Holdings, LLC")).toBe(true);
    expect(typedMatches("Alder's Trust", "Alder’s Trust")).toBe(true);
    expect(typedMatches("“Northwind”", '"Northwind"')).toBe(true);
    expect(typedMatches("48", "48")).toBe(true);
  });
  it("refuses near misses and an empty target", () => {
    expect(typedMatches("Northwind Holdings", "Northwind Holdings, LLC")).toBe(false);
    expect(typedMatches("", "")).toBe(false);
    expect(normalizeTyped("  A’B  ")).toBe("a'b");
  });
});

describe("lists of names in a confirm", () => {
  it("shows five, then a count", () => {
    expect(namesWithMore(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], more: 0 });
    expect(namesWithMore(["a", "b", "c", "d", "e", "f"])).toEqual({ shown: ["a", "b", "c", "d", "e", "f"], more: 0 });
    expect(namesWithMore(["a", "b", "c", "d", "e", "f", "g", "h", "i"])).toEqual({ shown: ["a", "b", "c", "d", "e"], more: 4 });
  });
});

describe("anchored placement", () => {
  const viewport = { width: 1440, height: 900 };
  const trigger = { top: 100, bottom: 132, left: 200, right: 300, width: 100 };
  it("opens below the trigger's start edge, 4px away", () => {
    expect(placeAnchored(trigger, { width: 240, height: 200 }, viewport)).toMatchObject({ left: 200, top: 136, above: false });
  });
  it("aligns to the end edge when asked", () => {
    expect(placeAnchored(trigger, { width: 240, height: 200 }, viewport, { align: "end" }).left).toBe(60);
  });
  it("flips above when there is no room below, without covering the trigger", () => {
    const low = { top: 800, bottom: 832, left: 200, right: 300, width: 100 };
    const p = placeAnchored(low, { width: 240, height: 300 }, viewport);
    expect(p.above).toBe(true);
    expect(p.bottom).toBe(viewport.height - low.top + 4);
  });
  it("stays inside the viewport", () => {
    const edge = { top: 100, bottom: 132, left: 1400, right: 1430, width: 30 };
    expect(placeAnchored(edge, { width: 240, height: 100 }, viewport).left).toBe(1440 - 240 - 8);
  });
});

describe("sheets and type-ahead", () => {
  it("closes a dragged sheet past a quarter, or on a flick", () => {
    expect(sheetDragCloses(120, 400, 0)).toBe(true);
    expect(sheetDragCloses(60, 400, 0.1)).toBe(false);
    expect(sheetDragCloses(40, 400, 0.9)).toBe(true);
    expect(sheetDragCloses(5, 400, 2)).toBe(false);
  });
  it("jumps to the next label starting with what was typed", () => {
    const labels = ["Arizona", "California", "Colorado", "Nevada"];
    expect(typeAhead(labels, "c", 0)).toBe(1);
    expect(typeAhead(labels, "c", 1)).toBe(2);
    expect(typeAhead(labels, "c", 2)).toBe(1);
    expect(typeAhead(labels, "ne", 0)).toBe(3);
    expect(typeAhead(labels, "z", 0)).toBe(-1);
  });
});
