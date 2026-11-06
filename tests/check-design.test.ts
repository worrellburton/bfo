import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script, without type declarations
import { findings, isStrict, stripComments } from "../scripts/check-design.mjs";

type Finding = { line: number; rule: string; text: string };
const rules = (file: string, src: string) => (findings(file, src) as Finding[]).map((f) => `${f.rule}:${f.text}`);

describe("check:design", () => {
  it("finds raw palette colours and hex values, not tokens", () => {
    expect(rules("app/x.tsx", `<p className="text-gray-500 hover:bg-white/5 border-b-gray-200 bg-[#111113]" />`)).toEqual([
      "raw-colour:text-gray",
      "raw-colour:bg-white",
      "raw-colour:border-b-gray",
      "hex-colour:[#111113]",
    ]);
    expect(rules("app/x.tsx", `<p className="text-ink-2 bg-raised border-line text-accent" style={{ color: "var(--color-ink)" }} />`)).toEqual([]);
    expect(rules("app/x.tsx", `const s = { color: "#fff" };`)).toEqual(['hex-colour:color: "#fff']);
  });

  it("finds legacy type, tracked caps, rem and half steps", () => {
    expect(rules("app/x.tsx", `<p className="text-xs text-[11px] uppercase tracking-[0.08em] pb-[5.5rem] gap-1.5 -mt-0.5" />`)).toEqual([
      "legacy-type:text-xs",
      "legacy-type:text-[11px]",
      "tracked-caps:uppercase … tracking-",
      "rem:[5.5rem]",
      "half-step:gap-1.5",
      "half-step:-mt-0.5",
    ]);
    expect(rules("app/x.tsx", `<p className="text-caption text-body gap-[6px] p-4 h-(--control-md)" />`)).toEqual([]);
  });

  it("finds glass, pulses, theme branches, arbitrary z and legacy radii and widths", () => {
    expect(rules("app/x.tsx", `<div className={isDark ? "glass-card" : "z-[80] rounded-xl max-w-md animate-pulse"} />`)).toEqual([
      "glass-or-pulse:glass-card",
      "glass-or-pulse:animate-pulse",
      "theme-branch:isDark ?",
      "z-index:z-[",
      "legacy-radius:rounded-xl",
      "legacy-width:max-w-md",
    ]);
    expect(rules("app/x.tsx", `<div className="z-modal rounded-card rounded-full max-w-reading" />`)).toEqual([]);
  });

  it("finds hand-made overlays outside app/ui, and native controls", () => {
    expect(rules("app/routes/x.tsx", `<div role="dialog" aria-modal="true"><select /></div>; window.confirm("x")`)).toEqual([
      'own-overlay:role="dialog"',
      "own-overlay:aria-modal",
      "native-control:<select",
      "native-control:window.confirm(",
    ]);
    expect(rules("app/ui/overlay.tsx", `<div role="dialog" aria-modal="true" />`)).toEqual([]);
  });

  it("ignores comments but keeps line numbers", () => {
    const src = `// text-gray-500 in a comment\n/* bg-white\n rounded-xl */\n<p className="text-xs" />`;
    expect(stripComments(src).split("\n")).toHaveLength(4);
    expect((findings("app/x.tsx", src) as Finding[]).map((f) => [f.line, f.rule])).toEqual([[4, "legacy-type"]]);
    expect(rules("app/x.tsx", `<a href="https://example.com/text-xs" />`)).toEqual([]);
  });

  it("calls a file strict when it imports Page from app/ui", () => {
    expect(isStrict(`import { Button, Page, PageHeader } from "../ui";`)).toBe(true);
    expect(isStrict(`import {\n  Card,\n  Page,\n} from "../../ui";`)).toBe(true);
    expect(isStrict(`import { Page } from "./ui/page";`)).toBe(true);
    expect(isStrict(`import { Button } from "../ui";`)).toBe(false);
    expect(isStrict(`import { PageHeader } from "../ui";`)).toBe(false);
  });
});
