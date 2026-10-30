#!/usr/bin/env node
/**
 * Browser checks for CI and for a last look before a push:
 *
 *   node e2e/run.cjs            # against http://localhost:5173 (start `npm run dev` first)
 *   BASE=http://localhost:5174 node e2e/run.cjs
 *
 * Every route at phone, iPad and desktop widths in both themes: no page
 * errors, no console errors, no horizontal overflow. Then an accessibility
 * pass (every visible control named, inputs labelled, images with alt, one
 * h1, a lang) and a few flows that must keep working (the drawer, home
 * search, the Ask button, Mail on a phone, the iPad rail). Exits 1 on any
 * failure and prints what failed.
 */
const { chromium, devices } = require("playwright");
const { session, mock } = require("./fixtures.cjs");

const BASE = process.env.BASE || "http://localhost:5173";
const ENTITY = "-E2";
const ROUTES = ["home", "ask?mode=text", "inbox", "mailbox", "phone", "assets", `assets/${ENTITY}`, `assets/${ENTITY}/compliance`, "msas", "notes", "settings", "users", "treasury", "investments", "books/transactions", "books/review", "books/calendar", "books/vendors", "books/rules", "books/loans", "treasury/mappings", "notifications", "estate-map", "tools/compliance", "tools/signatures", "tools/signatures/00000000-0000-4000-8000-00000000s001"];
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ipad: { ...devices["iPad Pro 11"], viewport: { width: 820, height: 1180 } },
  desk: { viewport: { width: 1440, height: 900 } },
};
// Headless Chromium prints these about its own software renderer; they never occur on a device.
const IGNORE = /WebGL|GPU stall|swiftshader|GroupMarkerNotSet/i;

const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

async function context(browser, size, theme) {
  const ctx = await browser.newContext(SIZES[size]);
  await ctx.addInitScript((a) => {
    localStorage.setItem("bfo-session", JSON.stringify(a.session));
    localStorage.setItem("bfo-theme", a.theme);
    localStorage.setItem("bfo-mail-theme", a.theme);
  }, { session, theme });
  await ctx.route("**/api/**", async (route) => {
    const req = route.request();
    let body = null;
    try { body = req.postDataJSON(); } catch { /* not JSON */ }
    const r = mock(req.url(), req.method(), body);
    if (!r) return route.fulfill({ status: 200, contentType: "text/event-stream", body: 'data: {"type":"done"}\n\n' });
    return route.fulfill({ status: r[0], contentType: "application/json", body: JSON.stringify(r[1]) });
  });
  return ctx;
}

function watch(page, where) {
  page.on("pageerror", (e) => fail(where, `page error: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.test(m.text())) fail(where, `console: ${m.text().slice(0, 160)}`);
  });
}

async function sweep(browser) {
  for (const size of Object.keys(SIZES)) for (const theme of ["dark", "light"]) {
    const ctx = await context(browser, size, theme);
    for (const route of ROUTES) {
      const where = `${size}/${theme}/${route}`;
      const page = await ctx.newPage();
      watch(page, where);
      try {
        await open(page, `${BASE}/${route}`);
        await page.waitForTimeout(1500);
        const o = await evaluate(page, () => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, err: !!document.querySelector("main h1")?.textContent?.match(/Something went wrong/) }));
        if (o.sw > o.iw) fail(where, `horizontal overflow ${o.sw - o.iw}px`);
        if (o.err) fail(where, "error page rendered");
      } catch (e) {
        fail(where, e.message.slice(0, 120));
      }
      await page.close();
    }
    await ctx.close();
  }
}

/** A navigation that survives Vite's reloads: one retry, and the DOM is enough. */
async function open(page, url) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" });
      return;
    } catch (e) {
      if (attempt >= 2) throw e;
      await page.waitForTimeout(800);
    }
  }
}

/** Evaluate after the page has settled; a redirect (login → home) can destroy the first context. */
async function evaluate(page, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(fn);
    } catch (e) {
      if (attempt >= 2) throw e;
      await page.waitForTimeout(1000);
    }
  }
}

async function a11y(browser) {
  const ctx = await context(browser, "desk", "dark");
  const page = await ctx.newPage();
  for (const route of [...ROUTES, "login"]) {
    await open(page, `${BASE}/${route}`);
    // A page is judged once it has its heading (the entity page loads for a moment first).
    await page.locator("h1").first().waitFor({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const r = await evaluate(page, () => {
      const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && b.width > 0 && b.height > 0; };
      const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim() || el.getAttribute("aria-labelledby");
      return {
        unnamed: [...document.querySelectorAll("button,a[href]")].filter((el) => vis(el) && !name(el)).length,
        noAlt: [...document.querySelectorAll("img")].filter((i) => vis(i) && !i.hasAttribute("alt")).length,
        unlabeled: [...document.querySelectorAll("input,textarea,select")].filter((el) => vis(el) && el.type !== "hidden" && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest("label")).length,
        h1: document.querySelectorAll("h1").length,
        lang: document.documentElement.lang,
      };
    });
    const where = `a11y/${route}`;
    if (r.unnamed) fail(where, `${r.unnamed} control(s) without a name`);
    if (r.noAlt) fail(where, `${r.noAlt} image(s) without alt`);
    if (r.unlabeled) fail(where, `${r.unlabeled} input(s) without a label`);
    if (r.h1 !== 1) fail(where, `${r.h1} h1 elements`);
    if (!r.lang) fail(where, "no lang on <html>");
  }
  await ctx.close();
}

async function flows(browser) {
  // Phone: the drawer, home search, the Ask button, Mail.
  {
    const ctx = await context(browser, "phone", "dark");
    const page = await ctx.newPage();
    watch(page, "flow/phone");
    await open(page, `${BASE}/home`); await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Open menu" }).click(); await page.waitForTimeout(400);
    await page.getByLabel("Main").getByRole("link", { name: /^Treasury$/ }).click(); await page.waitForTimeout(1000);
    if (!page.url().endsWith("/treasury")) fail("flow/phone", "drawer link didn't navigate");
    if ((await page.locator('aside[aria-label="Navigation"]').getAttribute("inert")) === null) fail("flow/phone", "drawer stayed open after navigating");
    await open(page, `${BASE}/home`); await page.waitForTimeout(1500);
    await page.getByRole("combobox", { name: "Search BFO" }).click(); await page.keyboard.type("ledger"); await page.waitForTimeout(700); await page.keyboard.press("Enter"); await page.waitForTimeout(1000);
    if (!/\/assets\//.test(page.url())) fail("flow/phone", "home search Enter didn't open the entity");
    await open(page, `${BASE}/home`); await page.waitForTimeout(1200);
    await page.getByRole("link", { name: "Ask BFO" }).click(); await page.waitForTimeout(800);
    if (!page.url().includes("/ask")) fail("flow/phone", "Ask button didn't open /ask");
    await open(page, `${BASE}/inbox`); await page.waitForTimeout(1500);
    await page.locator("text=Address change 0 >> visible=true").first().click(); await page.waitForTimeout(1200);
    if (!page.url().includes("m=")) fail("flow/phone", "mail row didn't open the message");
    // One mailbox chosen: opening a message keeps it (the list beside or behind stays that mailbox's).
    await open(page, `${BASE}/inbox?a=${encodeURIComponent(session.user.mail_address)}`); await page.waitForTimeout(1500);
    await page.locator("text=Address change 0 >> visible=true").first().click(); await page.waitForTimeout(1200);
    if (!(page.url().includes("m=") && page.url().includes("a="))) fail("flow/phone", "opening a message dropped the chosen mailbox");
    // The entity's sections: a button naming the current one opens the whole list.
    await open(page, `${BASE}/assets/${ENTITY}`); await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Section.*Overview/ }).click(); await page.waitForTimeout(300);
    await page.getByRole("menuitem", { name: /^Compliance/ }).click(); await page.waitForTimeout(800);
    if (!page.url().includes("/compliance")) fail("flow/phone", "section menu didn't open Compliance");
    if (await page.getByRole("menu", { name: "Sections" }).isVisible().catch(() => false)) fail("flow/phone", "section menu stayed open after choosing");
    await ctx.close();
  }
  // iPad: the rail opens by default, collapses on a tap, and is remembered.
  {
    const ctx = await context(browser, "ipad", "light");
    const page = await ctx.newPage();
    watch(page, "flow/ipad");
    await open(page, `${BASE}/home`); await page.waitForTimeout(1500);
    const railW = async () => (await page.locator('aside[aria-label="Navigation"]').boundingBox())?.width ?? 0;
    const w1 = await railW();
    await page.getByRole("button", { name: "Collapse menu" }).click(); await page.waitForTimeout(600);
    const w2 = await railW();
    if (!(w1 > 200 && w2 < 100)) fail("flow/ipad", `rail widths ${w1}→${w2}`);
    await page.reload(); await page.waitForTimeout(1500);
    if ((await railW()) >= 100) fail("flow/ipad", "rail didn't remember being collapsed");
    await ctx.close();
  }
  // Desktop: ⌘K and the account menu.
  {
    const ctx = await context(browser, "desk", "dark");
    const page = await ctx.newPage();
    watch(page, "flow/desk");
    await open(page, `${BASE}/home`); await page.waitForTimeout(1500);
    await page.keyboard.press("Meta+k"); await page.waitForTimeout(400);
    if (!(await page.getByRole("dialog", { name: "Jump to" }).isVisible().catch(() => false))) fail("flow/desk", "⌘K didn't open the palette");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /account menu/ }).click(); await page.waitForTimeout(300);
    if (!(await page.getByRole("menuitem", { name: /Appearance/ }).isVisible().catch(() => false))) fail("flow/desk", "account menu has no Appearance item");
    await ctx.close();
  }
  // Desktop Phone: the composer in view, focus kept, Retry's Idempotency-Key, a stale poll during a send.
  {
    const ctx = await context(browser, "desk", "light");
    const OURS = "+18445192725";
    const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
    const texts = [{ id: "in-1", from: "+14805551234", to: OURS, body: "Can you call me back?", code: null, receivedAt: ago(5), readAt: ago(4), direction: "in", status: null, error: null }];
    const sends = [];
    let answers = [];
    let stale = false;
    await ctx.route("**/api/texts**", async (route) => {
      const req = route.request();
      const reply = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (req.url().includes("view=count")) return reply(200, { unread: 0 });
      if (req.url().includes("view=setup")) return reply(200, { setup: { ok: true, webhook: { id: "wh_1", url: "", events: [], status: "paused" }, number: null, test: { delivered: true, code: 200 }, problems: [], notes: [], sending: null, missed: 2 } });
      if (req.method() === "GET") {
        const list = JSON.stringify({ number: OURS, texts: [...texts].reverse() });
        if (stale) await new Promise((r) => setTimeout(r, 1200)); // read before the send was stored, answered after it
        return route.fulfill({ status: 200, contentType: "application/json", body: list });
      }
      const body = req.postDataJSON();
      if (body.action !== "send") return reply(200, { ok: true });
      sends.push(body);
      await new Promise((r) => setTimeout(r, 300));
      const [status, error] = answers.shift() ?? [200];
      if (status !== 200) return reply(status, { error, message: "Not this time." });
      const t = { id: `sms_${sends.length}`, from: OURS, to: body.to, body: body.text, code: null, receivedAt: new Date().toISOString(), readAt: new Date().toISOString(), direction: "out", status: "accepted", error: null };
      texts.push(t);
      return reply(200, { text: t });
    });
    const page = await ctx.newPage();
    // Not watch(): the refused sends below log their 4xx/5xx as console errors on purpose.
    page.on("pageerror", (e) => fail("flow/desk-phone", `page error: ${e.message.slice(0, 160)}`));
    await open(page, `${BASE}/phone`);
    await page.getByRole("list", { name: "Conversations" }).waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
    const box = page.locator("textarea");
    const sendBtn = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
    if (!sendBtn || sendBtn.y + sendBtn.height > 900) fail("flow/desk-phone", `Send starts below the fold (bottom ${sendBtn && Math.round(sendBtn.y + sendBtn.height)} of 900)`);
    if (await page.getByRole("button", { name: /Bring in missed texts/ }).count()) fail("flow/desk-phone", "replay offered on a paused webhook");
    // The open conversation clicked again, then a poll: focus stays in the composer.
    await page.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
    await box.click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(800);
    if (!(await box.evaluate((el) => el === document.activeElement))) fail("flow/desk-phone", "focus left the composer after clicking the open conversation");
    // A timeout (504) or Bird still on it (409): Retry keeps the key. A plain refusal (422): a new one.
    answers = [[504, "timeout"], [409, "still_sending"], [422, "bird_refused"]];
    await box.fill("Key test");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Retry" }).waitFor({ timeout: 4000 });
      await page.getByRole("button", { name: "Retry" }).click();
    }
    await page.waitForTimeout(800);
    const keys = sends.map((s) => s.key);
    if (!(keys.length === 4 && keys[0] === keys[1] && keys[1] === keys[2] && keys[3] !== keys[2])) fail("flow/desk-phone", `Retry keys ${JSON.stringify(keys)}`);
    // A poll that read the list before the send was stored, answering after: the text doesn't vanish.
    stale = true;
    await box.fill("Race me");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.keyboard.press("Enter");
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(200);
      if ((await page.getByText("Race me", { exact: true }).count()) !== 1) { fail("flow/desk-phone", "a stale poll hid or doubled the text just sent"); break; }
    }
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await sweep(browser);
    await a11y(browser);
    await flows(browser);
  } finally {
    await browser.close();
  }
  const unique = [...new Set(failures)];
  if (unique.length) {
    console.log(`\n${unique.length} failure(s):`);
    for (const f of unique) console.log("  " + f);
    process.exit(1);
  }
  console.log(`ok: ${ROUTES.length} routes × 3 sizes × 2 themes, accessibility pass, flows`);
})();
