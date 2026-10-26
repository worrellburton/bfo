// App Store screenshots, fictional sample data only:
//   iphone  6.9" iPhone (1320 x 2868)
//   ipad    13" iPad (2064 x 2752)
import { chromium, devices } from "playwright-core";
import fs from "node:fs";

// Usage (with the dev server on :5173): node scripts/appstore-screenshots.mjs [iphone|ipad] [out-dir]
const DEVICE = process.argv[2] === "ipad" ? "ipad" : "iphone";
const IPAD = DEVICE === "ipad";
const OUT = process.argv[3] ?? (IPAD ? "appstore/screenshots/ipad-13" : "appstore/screenshots/iphone-6.9");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:5173";
const ME = "office@burtonfamilyoffice.com";
const user = { id: "11111111-1111-4111-8111-111111111111", name: "Alex Burton", email: "alex@example.com", phone: "+15555550100", phoneFormatted: "(555) 555-0100", role: "owner", status: "approved", createdAt: "2026-01-01T00:00:00Z", approvedAt: "2026-01-01T00:00:00Z", lastLoginAt: "2026-10-17T12:00:00Z", mailAddress: ME };
const now = new Date("2026-10-23T16:20:00-05:00").getTime();
const ago = (m) => new Date(now - m * 60000).toISOString();
const id = (i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;
const row = (i, o) => ({ id: id(i), folder: "inbox", direction: "in", to: [{ email: ME }], cc: [], read: true, starred: false, attachmentCount: 0, attachmentKinds: [], status: null, other: false, threadKey: "t" + i, occurredAt: ago(i * 47), ...o });
const rows = [
  row(1, { from: { email: "elena@parkpartners.example", name: "Elena Park" }, subject: "Closing documents for 14 Elm Street", snippet: "Everything is signed on our side. The deed and settlement statement are attached for your records.", read: false, attachmentCount: 2, attachmentKinds: ["pdf", "doc"], occurredAt: ago(12) }),
  row(2, { from: { email: "notices@northwind.example", name: "Northwind Capital" }, subject: "Capital call notice: Fund IV", snippet: "A capital call of 8% of commitment is due November 14. Wire instructions are in the attached notice.", read: false, starred: true, attachmentCount: 1, attachmentKinds: ["pdf"], occurredAt: ago(64) }),
  row(3, { from: { email: "statements@harbortrust.example", name: "Harbor Trust Company" }, subject: "Your Q3 trust statement is ready", snippet: "The quarterly statement for the Burton Family Trust is available to download.", attachmentCount: 1, attachmentKinds: ["pdf"], occurredAt: ago(180) }),
  row(4, { direction: "out", folder: "sent", from: { email: ME, name: "Alex Burton" }, to: [{ email: "marcus@reid.example", name: "Marcus Reid" }], subject: "Re: Board dinner next Thursday", snippet: "Thursday at 7 works. I'll bring the draft agenda.", occurredAt: ago(260) }),
  row(5, { from: { email: "avery@studio.example", name: "Avery Chen" }, subject: "Photos from the property walk-through", snippet: "Twelve photos from Saturday, including the roof and the north field.", attachmentCount: 12, attachmentKinds: ["image"], starred: true, occurredAt: ago(60 * 24 + 40) }),
  row(6, { from: { email: "docs@suttonhale.example", name: "Sutton & Hale LLP" }, subject: "Signed operating agreement", snippet: "Attached is the fully executed operating agreement for Elm Street Holdings LLC.", attachmentCount: 1, attachmentKinds: ["pdf"], occurredAt: ago(60 * 24 + 300) }),
  row(7, { from: { email: "renewals@atlasins.example", name: "Atlas Insurance" }, subject: "Your umbrella policy renews December 1", snippet: "No changes to your coverage. Review the renewal summary before then.", attachmentCount: 1, attachmentKinds: ["pdf"], occurredAt: ago(60 * 24 * 2 + 90) }),
  row(8, { from: { email: "jordan@burtonfamilyoffice.com", name: "Jordan Lee" }, subject: "Budget for the spring trip", snippet: "Here's the spreadsheet with flights, the house, and the guide. Two options for the second week.", attachmentCount: 1, attachmentKinds: ["sheet"], occurredAt: ago(60 * 24 * 3 + 30) }),
];
const full = (m) => ({
  ...m,
  bcc: [],
  text:
    m.id === id(1)
      ? "Hi Alex,\n\nEverything is signed on our side. The deed and settlement statement are attached for your records, and the title company will record the deed on Monday.\n\nKeys are with the listing agent whenever you'd like to pick them up.\n\nBest,\nElena"
      : m.snippet,
  html: null,
  attachments:
    m.id === id(1)
      ? [
          { id: "a1", filename: "Settlement statement.pdf", contentType: "application/pdf", size: 412_000, available: true },
          { id: "a2", filename: "Deed, 14 Elm Street.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 88_000, available: true },
        ]
      : [],
  deliveredTo: ME, messageId: "<x@y>", unverifiedSender: false,
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function shoot(name, theme, fn) {
  const ctx = await browser.newContext(
    IPAD
      ? { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BFO-iOS", timezoneId: "America/Chicago", locale: "en-US" }
      : { ...devices["iPhone 15 Pro Max"], viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, timezoneId: "America/Chicago", locale: "en-US" }
  );
  await ctx.addInitScript((s) => {
    localStorage.setItem("bfo-session", JSON.stringify(s.session));
    localStorage.setItem("bfo-theme", s.theme);
    localStorage.setItem("bfo-mail-theme", s.theme);
    // The app runs under iOS's status bar: show one, and keep the page clear of it.
    const bar = () => {
      if (document.getElementById("ios-bar")) return;
      const dark = s.theme === "dark";
      const c = dark ? "#fff" : "#000";
      const el = document.createElement("div");
      el.id = "ios-bar";
      el.setAttribute("style", `position:fixed;inset:0 0 auto 0;height:54px;z-index:2147483647;display:flex;align-items:flex-end;justify-content:space-between;padding:0 34px 12px 48px;pointer-events:none;font:600 17px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:${c}`);
      el.innerHTML = `<span style="letter-spacing:-0.2px">9:41</span><span style="display:flex;gap:7px;align-items:center"><svg width="19" height="12" viewBox="0 0 19 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="${c}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${c}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${c}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${c}"/></svg><svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.6c2.4 0 4.6.9 6.3 2.5l1.2-1.3C14 1.9 11.4.8 8.5.8S3 1.9 1 3.8l1.2 1.3C3.9 3.5 6.1 2.6 8.5 2.6zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3C12.1 5.1 10.4 4.4 8.5 4.4S4.9 5.1 3.6 6.3l1.2 1.3c1-.9 2.3-1.4 3.7-1.4zm0 3.6c-.6 0-1.1.2-1.5.6L8.5 12 10 10.4c-.4-.4-.9-.6-1.5-.6z" fill="${c}"/></svg><svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="${c}" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2.5" fill="${c}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="${c}" fill-opacity="0.45"/></svg></span>`;
      if (s.ipad) {
        // iPad: a 24pt bar with the date, and the page keeps clear of it through the safe-area inset (set below).
        el.setAttribute("style", `position:fixed;inset:0 0 auto 0;height:24px;z-index:2147483647;display:flex;align-items:center;justify-content:space-between;padding:0 22px;pointer-events:none;font:600 13px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:${c}`);
        el.innerHTML = el.innerHTML.replace(">9:41<", ">9:41 AM&nbsp;&nbsp;Fri Oct 23<");
        document.documentElement.appendChild(el);
        return;
      }
      document.documentElement.appendChild(el);
      const st = document.createElement("style");
      st.textContent = "body{padding-top:50px!important} .sticky{top:50px!important} [aria-labelledby=compose-title]{padding-top:50px!important}";
      document.head.appendChild(st);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bar);
    else bar();
  }, { session: { token: "t", expiresAt: "2027-01-01T00:00:00Z", user }, theme, ipad: IPAD });
  // Sender logos come from a favicon service; the sample senders are fictional, so show initials.
  await ctx.route("**/s2/favicons**", (r) => r.abort());
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname === "/api/auth/session") return json({ user });
    if (url.pathname !== "/api/mail") return json({});
    const view = url.searchParams.get("view");
    if (view === "faces") return json({ faces: {} });
    if (view === "count") return json({ unread: 2, otherUnread: 0, address: ME, aliases: [], canSeeOther: false, sync: {} });
    if (view === "list") {
      const filter = url.searchParams.get("filter") || "all";
      let list = rows;
      if (filter.includes("starred")) list = list.filter((r) => r.starred);
      return json({ messages: list, hasMore: false });
    }
    if (view === "message") return json({ message: full(rows.find((r) => r.id === url.searchParams.get("id")) ?? rows[0]) });
    if (view === "thread") return json({ messages: [] });
    return json({});
  });
  await ctx.addInitScript((t) => {
    const Real = Date;
    // A fixed clock, so the list reads "Today", "Yesterday" consistently.
    // eslint-disable-next-line no-global-assign
    Date = class extends Real {
      constructor(...a) { super(...(a.length ? a : [t])); }
      static now() { return t; }
    };
  }, now);
  const page = await ctx.newPage();
  if (IPAD) await (await ctx.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 24, bottom: 20, left: 0, right: 0 } });
  await fn(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

const list = async (page) => {
  await page.goto(`${BASE}/inbox`);
  await page.locator(IPAD ? "[data-mail-row]" : "ul.md\\:hidden li [data-mail-row]").locator("visible=true").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
};
const open = async (page) => {
  await page.getByText("Closing documents for 14 Elm Street", { exact: true }).locator("visible=true").first().click();
  await page.waitForTimeout(3200);
};

if (IPAD) {
  // The list beside the open message, the starred filter, compose over the table, and dark.
  await shoot("01-message-light", "light", async (page) => {
    await list(page);
    await page.locator('[aria-label="Columns"]').locator("visible=true").first().click();
    await page.waitForTimeout(600);
    await open(page);
  });
  await shoot("02-inbox-light", "light", list);
  await shoot("03-starred-light", "light", async (page) => {
    await list(page);
    await page.getByRole("button", { name: "Starred", exact: true }).locator("visible=true").first().click();
    await page.waitForTimeout(1200);
  });
  await shoot("04-compose-light", "light", async (page) => {
    await list(page);
    await page.getByRole("button", { name: "New", exact: true }).locator("visible=true").first().click();
    await page.waitForTimeout(500);
    await page.fill("#compose-to", "elena@parkpartners.example");
    await page.fill("#compose-subject", "Re: Closing documents for 14 Elm Street");
    await page.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type("Thank you, Elena. I'll pick up the keys on Monday afternoon.");
    await page.waitForTimeout(400);
  });
  await shoot("05-message-dark", "dark", async (page) => {
    await list(page);
    await page.locator('[aria-label="Columns"]').locator("visible=true").first().click();
    await page.waitForTimeout(600);
    await open(page);
  });
  await browser.close();
  console.log("done");
  process.exit(0);
}

await shoot("01-inbox-light", "light", list);
await shoot("02-message-light", "light", async (page) => {
  await list(page);
  await open(page);
});
await shoot("03-filters-light", "light", async (page) => {
  await list(page);
  await page.locator('button[aria-label^="Showing "]').locator("visible=true").first().click();
  await page.waitForTimeout(400);
  await page.locator('[role="switch"]').filter({ hasText: "Starred" }).click();
  await page.waitForTimeout(500);
});
await shoot("04-compose-light", "light", async (page) => {
  await list(page);
  await page.locator('button[aria-label="New message"]').locator("visible=true").click();
  await page.waitForTimeout(500);
  await page.fill("#compose-to", "elena@parkpartners.example");
  await page.fill("#compose-subject", "Re: Closing documents for 14 Elm Street");
  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("Thank you, Elena. I'll pick up the keys on Monday afternoon.");
  await page.waitForTimeout(400);
});
await shoot("05-inbox-dark", "dark", list);
await browser.close();
console.log("done");
