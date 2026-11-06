import { describe, expect, it } from "vitest";
import {
  activeGroup,
  buildNav,
  buildPlaces,
  contentInset,
  groupCount,
  leafActive,
  lockRequired,
  matchRanges,
  parseThemeSetting,
  resolveTheme,
  scoreMatch,
  shellSize,
  sidebarMode,
} from "../app/shell-model";

describe("theme", () => {
  it("is Automatic unless Light or Dark was chosen", () => {
    expect(parseThemeSetting(null)).toBe("auto");
    expect(parseThemeSetting("sepia")).toBe("auto");
    expect(parseThemeSetting("light")).toBe("light");
    expect(parseThemeSetting("dark")).toBe("dark");
  });
  it("follows the device only when Automatic", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("the sidebar", () => {
  it("knows phones, tablets and desktops by width", () => {
    expect(shellSize(390)).toBe("phone");
    expect(shellSize(768)).toBe("tablet");
    expect(shellSize(1023)).toBe("tablet");
    expect(shellSize(1024)).toBe("desktop");
  });
  it("defaults to expanded from 1280px and keeps the person's choice", () => {
    expect(sidebarMode(null, 1440)).toBe("expanded");
    expect(sidebarMode(null, 1100)).toBe("collapsed");
    expect(sidebarMode("collapsed", 1440)).toBe("collapsed");
    expect(sidebarMode("expanded", 1100)).toBe("expanded");
    expect(sidebarMode("junk", 1440)).toBe("expanded");
  });
  it("insets the content by the sidebar: none on phones, the rail on tablets", () => {
    expect(contentInset("phone", "expanded")).toBe(0);
    expect(contentInset("tablet", "expanded")).toBe(64);
    expect(contentInset("desktop", "expanded")).toBe(240);
    expect(contentInset("desktop", "collapsed")).toBe(64);
  });
});

describe("the nav", () => {
  const mail = { inbox: 2, other: 3, paper: 1 };
  it("shows staff the office, Phone only to owners and admins", () => {
    const owner = buildNav({ role: "owner", canSeeOther: true, mail }).map((e) => e.id);
    expect(owner).toEqual(["home", "mail", "phone", "entities", "treasury", "investments", "books", "tools"]);
    expect(buildNav({ role: "member", canSeeOther: false }).map((e) => e.id)).not.toContain("phone");
  });
  it("shows a partner only their entities, and an email-only member only Mail", () => {
    expect(buildNav({ role: "partner", canSeeOther: false, entities: [{ id: "x", name: "Northwind Holdings, LLC" }] })).toEqual([
      { id: "entity:x", to: "/assets/x", label: "Northwind Holdings, LLC", glyph: "entities" },
    ]);
    const email = buildNav({ role: "email", canSeeOther: false, mail });
    expect(email.map((e) => e.id)).toEqual(["mail"]);
    expect(email[0].children!.map((c) => c.label)).toEqual(["Active", "Inbox", "Sent", "Archive"]);
  });
  it("counts unread mail once, on the folder it's in, and the group's count foots", () => {
    const m = buildNav({ role: "owner", canSeeOther: true, mail }).find((e) => e.id === "mail")!;
    expect(m.children!.map((c) => [c.label, c.count ?? 0])).toEqual([
      ["Active", 0],
      ["Inbox", 2],
      ["Sent", 0],
      ["Archive", 0],
      ["Unclaimed", 3],
      ["Paper mail", 1],
    ]);
    expect(m.count).toBe(6);
    expect(m.count).toBe(groupCount(m.children!));
    // Without access to unclaimed mail, its count isn't in the total either.
    expect(buildNav({ role: "member", canSeeOther: false, mail }).find((e) => e.id === "mail")!.count).toBe(3);
  });
  it("names the recurring forecast for what it is", () => {
    const books = buildNav({ role: "owner", canSeeOther: true }).find((e) => e.id === "books")!;
    expect(books.children!.find((c) => c.to === "/books/calendar")!.label).toBe("Recurring");
  });
  it("tells Mail's folders apart by ?f=, with Active as the default", () => {
    const m = buildNav({ role: "owner", canSeeOther: true }).find((e) => e.id === "mail")!;
    const [active, inbox] = m.children!;
    expect(leafActive(active, "/inbox", "")).toBe(true);
    expect(leafActive(inbox, "/inbox", "")).toBe(false);
    expect(leafActive(inbox, "/inbox", "?f=inbox")).toBe(true);
    expect(leafActive(active, "/inbox", "?f=inbox")).toBe(false);
    expect(leafActive({ to: "/books/reports", label: "Reports" }, "/books/reports/cell", "")).toBe(true);
    expect(activeGroup([m], "/mailbox/abc", "")).toBe("mail");
  });
});

describe("the palette's places", () => {
  const nav = buildNav({ role: "owner", canSeeOther: true });
  const places = buildPlaces(nav, { role: "owner" });
  const find = (q: string) => places.filter((p) => scoreMatch(p.label, `${p.section ?? ""} ${p.keywords ?? ""}`, q) > 0).map((p) => p.label);
  it("finds the books by an accountant's words", () => {
    expect(find("trial balance")).toContain("Statements");
    expect(find("1099")).toContain("Vendors");
    expect(find("balance sheet")).toContain("Balance sheet");
    expect(find("reconciliation")).toContain("Review");
    expect(find("p&l")).toContain("Profit & loss");
  });
  it("finds Terms and Privacy", () => {
    expect(find("privacy")).toContain("Privacy policy");
    expect(find("terms")).toContain("Terms of use");
  });
  it("gives every place its own address", () => {
    const tos = places.map((p) => p.to);
    expect(new Set(tos).size).toBe(tos.length);
  });
  it("offers People only to owners and admins, and Labs only when asked", () => {
    expect(places.some((p) => p.label === "People")).toBe(true);
    expect(buildPlaces(buildNav({ role: "member", canSeeOther: false }), { role: "member" }).some((p) => p.label === "People")).toBe(false);
    expect(places.some((p) => p.section === "Labs")).toBe(false);
    expect(buildPlaces(nav, { role: "owner", labs: true }).some((p) => p.label === "Games")).toBe(true);
  });
});

describe("matching", () => {
  it("ranks a prefix over a word start over anywhere", () => {
    expect(scoreMatch("Transactions", "", "tra")).toBe(4);
    expect(scoreMatch("Account mappings", "", "map")).toBe(3);
    expect(scoreMatch("Estate map", "structure", "struct")).toBe(2);
    expect(scoreMatch("Notes", "", "zzz")).toBe(0);
  });
  it("marks the letters that matched", () => {
    expect(matchRanges("Transactions", "act")).toEqual([[5, 8]]);
    expect(matchRanges("Balance sheet", "sheet bal")).toEqual([
      [0, 3],
      [8, 13],
    ]);
    expect(matchRanges("Home", "")).toEqual([]);
  });
});

describe("App lock", () => {
  it("can't be turned off by anyone who sees the office's codes or changes the books", () => {
    expect(lockRequired("owner")).toBe(true);
    expect(lockRequired("admin")).toBe(true);
    expect(lockRequired("member")).toBe(true);
    expect(lockRequired("viewer")).toBe(false);
    expect(lockRequired("partner")).toBe(false);
  });
});
