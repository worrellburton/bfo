#!/usr/bin/env node
/**
 * The screenshot tour for a design, accounting and legal review: every page
 * and every pop-up of BFO, at phone and desktop widths, in light and dark,
 * on the office's real records read through a read-only guard (live.cjs),
 * or on the browser checks' fixtures (--mock). Each capture is labelled with
 * the files that draw it, so whoever fixes a surface knows where to look.
 * Recipes only open things; see "The surfaces" below. e2e/tour/README.md
 * says how to run it.
 *
 *   node e2e/tour/run.cjs                                  # everything, live
 *   node e2e/tour/run.cjs --mock                           # on e2e/fixtures.cjs instead
 *   node e2e/tour/run.cjs --only home,palette              # a few surfaces (a trailing * matches a prefix)
 *   node e2e/tour/run.cjs --sizes desk --themes dark       # one size, one theme
 *   node e2e/tour/run.cjs --out /tmp/tour-round-2          # somewhere else (default: the scratchpad)
 *   node e2e/tour/run.cjs --workers 6                      # pages at once (default 4)
 *   BASE=http://localhost:5174 node e2e/tour/run.cjs       # another dev server (default :5173)
 *   PW_CHROMIUM=/path/to/chrome node e2e/tour/run.cjs      # another browser build
 *
 * Writes ${OUT}/<surface id>/<size>-<theme>.png and ${OUT}/manifest.json
 * (each surface, its files, its captures and whatever went wrong while it was
 * taken). A run with --only updates those surfaces in an existing manifest
 * and keeps the rest. A recipe that fails is recorded and the tour goes on.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

// ── Settings ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const takes = ["only", "out", "sizes", "themes", "workers"].includes(m[1]);
    out[m[1]] = m[2] !== undefined ? m[2] : takes && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const list = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const BASE = (process.env.BASE || "http://localhost:5173").replace(/\/$/, "");
const OUT = path.resolve(args.out || "/tmp/claude-0/-home-user-catalog2/81f6845e-bea6-561c-bc76-c5dc0b7ecfba/scratchpad/tour/latest");
const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const THEMES = ["light", "dark"];
const sizes = args.sizes ? list(args.sizes) : Object.keys(SIZES);
const themes = args.themes ? list(args.themes) : THEMES;
const only = args.only ? list(args.only) : null;
const WORKERS = Math.max(1, Number(args.workers || process.env.TOUR_WORKERS || 4));
/** Entrance animations finish within this after the page has settled. */
const SETTLE_MS = 1500;
/** A full-page capture stops here; anything longer is cut off. */
const MAX_PAGE_H = 3200;
/** One surface gets this long, recipe and capture together. */
const SURFACE_TIMEOUT_MS = 75000;
// Headless Chromium prints these about its own software renderer; they never occur on a device.
const IGNORE = /WebGL|GPU stall|swiftshader|GroupMarkerNotSet|Automatic fallback to software/i;

for (const s of sizes) if (!SIZES[s]) throw new Error(`Unknown size "${s}" (phone, desk)`);
for (const t of themes) if (!THEMES.includes(t)) throw new Error(`Unknown theme "${t}" (light, dark)`);

// ── Where the data comes from ────────────────────────────────────────────
// --live (the default): every /api request goes to e2e/tour/live.cjs, which
// answers it from the production API behind a read-only guard (and a disk
// cache), and the session is its own; live.cjs's environment must be set
// (see e2e/tour/README.md). --mock: the browser checks' small fixtures
// (e2e/fixtures.cjs), or --mock=<file> for another module with the same
// { session, mock } shape.

const MODE = args.mock && args.mock !== "false" ? "mock" : "live";
const api = (() => {
  if (MODE === "live") {
    const live = require("./live.cjs");
    return {
      session: async () => live.session(),
      handle: (route, request) => live.handle(route, request),
      install: (ctx) => (live.install ? live.install(ctx) : undefined),
      stats: () => live.stats,
    };
  }
  const file = args.mock === "true" ? path.join(__dirname, "../fixtures.cjs") : path.resolve(args.mock);
  const { session, mock } = require(file);
  return {
    session: async () => session,
    handle: async (route, req) => {
      let body = null;
      try {
        body = req.postDataJSON();
      } catch {
        /* not JSON */
      }
      let r;
      try {
        r = mock(req.url(), req.method(), body);
      } catch (e) {
        r = [500, { error: "fixture_error", message: String(e && e.message) }];
      }
      if (!r) return route.fulfill({ status: 200, contentType: "text/event-stream", body: 'data: {"type":"done"}\n\n' });
      return route.fulfill({ status: r[0], contentType: "application/json", body: JSON.stringify(r[1]) });
    },
    install: () => undefined,
    stats: () => null,
  };
})();

/** A GET answered the way the browser's would be (through the same guard), from here: the JSON body, or null. */
async function apiGet(p) {
  let out = null;
  const request = { method: () => "GET", url: () => `${BASE}${p}`, postDataJSON: () => null, headers: () => ({}), postData: () => null };
  const route = {
    request: () => request,
    fulfill: async (o) => {
      out = o;
    },
    fallback: async () => undefined,
    continue: async () => undefined,
    abort: async () => undefined,
  };
  await api.handle(route, request);
  if (!out || (out.status ?? 200) >= 400 || out.body == null) return null;
  try {
    return JSON.parse(Buffer.isBuffer(out.body) ? out.body.toString("utf8") : String(out.body));
  } catch {
    return null;
  }
}
let SESSION = null;

// ── Recipe helpers ───────────────────────────────────────────────────────

/** The records don't have what a surface needs (no notes to delete, one mail address): not a broken recipe. */
class Unavailable extends Error {}

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;
const pause = (page, ms = 500) => page.waitForTimeout(ms);

/** Wait for the first visible match and click it. */
async function tap(locator, opts = {}) {
  const el = locator.locator("visible=true").first();
  await el.waitFor({ state: "visible", timeout: opts.timeout ?? 10000 });
  await el.scrollIntoViewIfNeeded().catch(() => undefined);
  await el.click({ timeout: 5000, ...(opts.force ? { force: true } : {}) });
  await pause(el.page(), opts.after ?? 300);
}

/** The first visible match, once it shows. */
async function seen(locator, timeout = 10000) {
  const el = locator.locator("visible=true").first();
  await el.waitFor({ state: "visible", timeout });
  return el;
}

const button = (page, name, exact = false) => page.getByRole("button", { name, exact });
const dialog = (page, name) => (name ? page.getByRole("dialog", { name }) : page.locator('[role="dialog"],[role="alertdialog"]'));
const anyOverlay = (page) => page.locator('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"]');

/** On a phone the account menu lives in the drawer: open that first. */
async function openAccountMenu(page) {
  if (isPhone(page)) await tap(button(page, "Open menu"), { after: 500 });
  await tap(button(page, /account menu/));
}

/** A shell dialog from the account menu. */
async function fromAccountMenu(page, item) {
  await openAccountMenu(page);
  await tap(page.getByRole("menuitem", { name: item }));
}

/** Open the command palette the way a person would: the search button on a phone, ⌘K at a desk. */
async function openPalette(page) {
  if (isPhone(page)) await tap(button(page, "Search and jump to"));
  else {
    await page
      .locator("body")
      .click({ position: { x: 5, y: 5 } })
      .catch(() => undefined);
    await page.keyboard.press("Meta+k");
    await pause(page, 400);
    if (
      !(await dialog(page, "Jump to")
        .isVisible()
        .catch(() => false))
    )
      await page.keyboard.press("Control+k");
  }
  await seen(dialog(page, "Jump to"));
}

/** Answer one API path (a substring of the URL) with this JSON for the surface, before it loads. */
function answer(match, body, status = 200) {
  return async (page) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/") && (typeof match === "string" ? (url.pathname + url.search).includes(match) : match.test(url.pathname + url.search)),
      (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(typeof body === "function" ? body(route.request()) : body) }),
    );
  };
}

/** Mail's composer, opened the way a person does; with more than one address it first asks which to send from (`pick` chooses the first). */
async function openComposer(page, pick = true) {
  await tap(isPhone(page) ? button(page, "New message") : button(page, "New", true));
  const panel = await seen(page.locator('[aria-labelledby="compose-title"]'));
  const chooser = panel.getByRole("listbox", { name: "Send from" });
  if (pick && (await chooser.isVisible().catch(() => false))) await tap(chooser.locator("button, [role=option]").first());
  return panel;
}

// ── Finding real records at run time ─────────────────────────────────────
// No id is written down: a detail page is reached from its list (the first
// row or link), or, for an entity of a given kind, from the entities on
// record. What one surface finds is kept for the rest of the run, so the
// others go straight there.

const found = new Map();
/** The promise for `key`, made once per run. */
function once(key, make, { keepFailure = false } = {}) {
  if (!found.has(key))
    found.set(
      key,
      make().catch((e) => {
        // A search that found nothing stays found-nothing for the run; a slip (a slow page) is tried again.
        if (!keepFailure) found.delete(key);
        throw e;
      }),
    );
  return found.get(key);
}

/** The entities on record (read once, through the same API the pages use): id, name, type, contracts, owners. */
function entities() {
  return once("entities", async () => {
    const tree = await apiGet("/api/tree?path=assets");
    return Object.entries(tree?.value || {})
      .filter(([, a]) => a && typeof a === "object" && a.name)
      .map(([id, a]) => ({ id, name: a.name, type: a.type, active: a.status !== "Dissolved", contracts: Object.keys(a.contracts || {}), members: Array.isArray(a.members) ? a.members.length : 0 }));
  });
}

/** Which entity a surface wants: the fullest LLC, the first corporation or trust. */
const PICK = {
  llc: (all) => all.filter((e) => e.type === "LLC" && e.active).sort((a, b) => b.contracts.length - a.contracts.length || b.members - a.members)[0],
  corp: (all) => all.find((e) => e.type === "C-Corp" && e.active) || all.find((e) => e.type === "C-Corp"),
  trust: (all) => all.find((e) => e.type === "Trust" && e.active) || all.find((e) => e.type === "Trust"),
  contract: (all) => all.find((e) => e.contracts.length && e.type === "LLC") || all.find((e) => e.contracts.length),
};

/** Open an entity of this kind (PICK), at this tab. */
async function goEntity(page, kind, tab = "") {
  const e = PICK[kind](await entities());
  if (!e) throw new Unavailable(`no ${kind} entity on record`);
  await open(page, `${BASE}/assets/${encodeURIComponent(e.id)}${tab ? `/${tab}` : ""}`);
  return e;
}

/** Entities of a kind, the likeliest first: active, then those with the most owners and contracts. */
function candidates(all, kind) {
  const type = { llc: "LLC", corp: "C-Corp", trust: "Trust" }[kind];
  return all.filter((e) => e.type === type).sort((a, b) => b.active - a.active || b.members - a.members || b.contracts.length - a.contracts.length);
}

/**
 * Open the first entity of these kinds whose `tab` shows what `has` finds
 * (someone to invite, a document to view): the records decide which entity
 * has it, so a few are tried. The one found is kept for the rest of the run.
 */
async function goEntityWith(page, key, kinds, tab, has, why) {
  const all = await entities();
  const id = await once(
    `with:${key}`,
    async () => {
      const list = kinds.flatMap((k) => candidates(all, k)).slice(0, 8);
      for (const e of list) {
        await open(page, `${BASE}/assets/${encodeURIComponent(e.id)}/${tab}`);
        await page
          .getByText(/^Loading entity/)
          .waitFor({ state: "hidden", timeout: 10000 })
          .catch(() => undefined);
        if (
          await has(page)
            .locator("visible=true")
            .first()
            .waitFor({ state: "visible", timeout: 5000 })
            .then(() => true)
            .catch(() => false)
        )
          return e.id;
      }
      throw new Unavailable(why);
    },
    { keepFailure: true },
  );
  if (!page.url().endsWith(`/assets/${encodeURIComponent(id)}/${tab}`)) await open(page, `${BASE}/assets/${encodeURIComponent(id)}/${tab}`);
}

/** A read paper-mail piece that has been scanned (the first few read pieces are tried). */
async function goScannedPiece(page) {
  const href = await once(
    "piece-scan",
    async () => {
      await open(page, `${BASE}/mailbox`);
      await settle(page, 400);
      const hrefs = [...new Set(await readPaperRow(page).evaluateAll((els) => els.map((a) => a.getAttribute("href"))))].slice(0, 6);
      for (const h of hrefs) {
        await open(page, `${BASE}${h}`);
        if (
          await button(page, "Enlarge the scan")
            .first()
            .waitFor({ state: "visible", timeout: 6000 })
            .then(() => true)
            .catch(() => false)
        )
          return h;
      }
      throw new Unavailable("no read piece of paper mail has a scan");
    },
    { keepFailure: true },
  );
  if (!page.url().endsWith(href)) await open(page, `${BASE}${href}`);
}

/** The first visible match within a few seconds, or a plain reason why not (the records don't have one). */
async function need(locator, why, timeout = 5000) {
  const el = locator.locator("visible=true").first();
  await el.waitFor({ state: "visible", timeout }).catch(() => {
    throw new Unavailable(why);
  });
  return el;
}

/** The first record behind `selector` on the list at `from`, clicked; its URL is kept for the rest of the run. */
async function goFirst(page, key, from, selector) {
  const url = await once(key, async () => {
    await open(page, `${BASE}${from}`);
    await settle(page, 600);
    const el = await seen(typeof selector === "function" ? await selector(page) : page.locator(selector), 15000);
    const before = page.url();
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await el.click();
    await page.waitForURL((u) => u.href !== before, { timeout: 10000 });
    const u = new URL(page.url());
    return u.pathname + u.search;
  });
  if (`${new URL(page.url()).pathname}${new URL(page.url()).search}` !== url) await open(page, `${BASE}${url}`);
}

/** The first contract on record, on its own page; `unsent`: one with no signature request yet. */
async function goContract(page, unsent = false) {
  const all = await entities();
  let pairs = [PICK.contract(all), ...all].filter(Boolean).flatMap((e) => e.contracts.map((c) => [e.id, c]));
  if (unsent) {
    const sent = await once(
      "contracts-sent",
      async () => new Set(((await apiGet("/api/sign"))?.requests || []).filter((r) => r.contract_id && r.status !== "voided").map((r) => `${r.asset_id}:${r.contract_id}`)),
    );
    pairs = pairs.filter(([a, c]) => !sent.has(`${a}:${c}`));
  }
  if (!pairs.length) throw new Unavailable(unsent ? "every contract on record has been sent for signature" : "no entity has a contract on record");
  await open(page, `${BASE}/assets/${encodeURIComponent(pairs[0][0])}/contract/${encodeURIComponent(pairs[0][1])}`);
}

/** The first signature request, after choosing a filter on the list ("Waiting", "Drafts"). */
function goSignature(page, filter) {
  return goFirst(page, `signature:${filter || "all"}`, "/tools/signatures", async (p) => {
    if (filter) await tap(p.getByRole("button", { name: new RegExp(`^${filter}\\s*\\d+`) }));
    return p.locator('main a[href^="/tools/signatures/"]');
  });
}

/**
 * Anything but a read, to API paths matching `re`, answered in the browser:
 * for a recipe whose click only asks (a choice that opens a confirm), so
 * nothing could reach the server even if the app changed underneath it.
 */
function holdWrites(re) {
  return (page) =>
    page.route(
      (url) => re.test(url.pathname),
      (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", body: "{}" })),
    );
}

// ── The formation wizard ─────────────────────────────────────────────────
// Each step is a surface, reached the way a person gets there: a sample
// entity's details typed in, Continue, and so on. Palm's name check is billed,
// so it's answered in the browser; on live data what the state requires, the
// fee and Palm's final check come from Palm (free reads the guard allows), on
// the fixtures they're samples. Nothing is ever filed.

const WIZARD_ORDER = ["entity", "business", "ownership", "filers", "agent", "ein", "state", "review"];
const WIZARD_LABELS = { Entity: "entity", Business: "business", Ownership: "ownership", Signers: "filers", Agent: "agent", EIN: "ein", State: "state", Review: "review" };

function palmFormAnswers(page) {
  return page.route(
    (url) => url.pathname === "/api/palm",
    (route) => {
      let action = "";
      try {
        action = route.request().postDataJSON()?.action || "";
      } catch {
        /* not JSON */
      }
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (action === "form-name") return reply({ eligible: true, compliant: true, available: true, violations: [], alternatives: [] });
      if (MODE === "mock") {
        if (action === "form-requirements")
          return reply({
            supported: true,
            expeditedTiers: [],
            extra: [{ key: "close_company", label: "Close limited liability company election", description: "A sample question of the state's own.", type: "boolean", options: [], required: false }],
            rules: {},
          });
        if (action === "form-fee") return reply({ total: 100, currency: "USD", items: [{ kind: "base", name: "filing", amount: 100 }], expeditedTiers: [] });
        if (action === "form-validate") return reply({ ok: true, errors: [], warnings: [] });
      }
      if (["form-requirements", "form-fee", "form-validate"].includes(action)) return route.fallback();
      if (action.startsWith("form")) return reply({ error: "tour", message: "Nothing is filed during the tour." }, 409);
      return route.fallback();
    },
  );
}

async function openWizard(page) {
  await tap(button(page, "New entity"));
  await tap(page.getByRole("button", { name: /Form a new entity with Palm/ }));
  await seen(page.locator('[aria-labelledby="wiz-title"]'));
}

/** Fill a field only when it's empty (the wizard starts from the signed-in person and the office). */
async function fillIfEmpty(locator, value) {
  const el = locator.locator("visible=true").first();
  if (!(await el.count())) return;
  if (!(await el.inputValue().catch(() => "x"))) await el.fill(value);
}

/** Choose the first real option of a select that has nothing chosen. */
async function chooseIfEmpty(locator) {
  const el = locator.locator("visible=true").first();
  if (!(await el.count()) || (await el.inputValue().catch(() => "x"))) return;
  const values = await el.locator("option").evaluateAll((os) => os.map((o) => o.value).filter((v) => v && !v.startsWith("__")));
  if (values[0]) await el.selectOption(values[0]);
}

/** Whatever this step marks required and is still empty, filled with a sample (an SSN never is: a step that needs one stops). */
async function fillRequired(wiz) {
  const labels = wiz.locator('label:has([aria-label="required"])').locator("visible=true");
  for (let i = 0; i < (await labels.count()); i++) {
    const label = labels.nth(i);
    const text = (await label.innerText()).split("\n")[0].trim();
    const control = label.locator("input:not([type=checkbox]):not([type=radio]), select, textarea").first();
    if (!(await control.count()) || /SSN|ITIN/i.test(text)) continue;
    if (await control.evaluate((el) => el.tagName === "SELECT")) {
      await chooseIfEmpty(control);
      continue;
    }
    const sample = /e-?mail/i.test(text)
      ? "sam@example.com"
      : /phone/i.test(text)
        ? "(307) 555-0142"
        : /ZIP/i.test(text)
          ? "82001"
          : /street/i.test(text)
            ? "1712 Pioneer Avenue"
            : /city/i.test(text)
              ? "Cheyenne"
              : /county/i.test(text)
                ? "Laramie"
                : /first name/i.test(text)
                  ? "Sam"
                  : /last name/i.test(text)
                    ? "Sample"
                    : /title|office/i.test(text)
                      ? "Organizer"
                      : /name/i.test(text)
                        ? "Sam Sample"
                        : "Sample";
    await fillIfEmpty(control, sample);
  }
}

/** Which step the wizard is on (the rail on a wide screen, the header's "Step n of m · Label" on a narrow one). */
async function wizardStep(wiz) {
  const rail = wiz.locator('[aria-current="step"]').locator("visible=true");
  // The rail's first line is the label; the narrow header reads "Step 2 of 8 · Business" (upper-cased in CSS, so its text, not innerText).
  const label = (await rail.count())
    ? (await rail.first().innerText()).split("\n")[0].trim()
    : (
        (await wiz
          .getByText(/^Step \d+ of \d+ · /i)
          .first()
          .textContent()) || ""
      )
        .split("·")
        .pop()
        .trim();
  return WIZARD_LABELS[label] || null;
}

/** Fill the wizard's steps up to (not past) `until`, continuing between them. */
async function fillWizard(page, until) {
  const wiz = page.locator('[aria-labelledby="wiz-title"]');
  for (let i = 0; i < WIZARD_ORDER.length + 1; i++) {
    const step = await wizardStep(wiz);
    if (step === "entity") {
      await wiz.getByLabel("State of formation").selectOption("US-WY");
      await wiz.getByLabel("Legal name").fill("Sample Holdings, LLC");
      // The name is checked with the state a moment after typing stops: wait for it only where it shows.
      if (until === "entity") await pause(page, 1300);
    } else if (step === "business") {
      await fillIfEmpty(wiz.getByLabel(/^Business email/), "office@example.com");
      await fillIfEmpty(wiz.getByLabel(/^Street/), "1712 Pioneer Avenue");
      await fillIfEmpty(wiz.getByLabel(/^City/), "Cheyenne");
      await chooseIfEmpty(wiz.getByRole("combobox", { name: /^State/ }));
      await fillIfEmpty(wiz.getByLabel(/^ZIP/), "82001");
      await fillIfEmpty(wiz.getByLabel(/^Name/), "Sam Sample");
      await fillIfEmpty(wiz.getByLabel(/^Email/), "sam@example.com");
    } else if (step === "ownership") {
      await chooseIfEmpty(wiz.getByRole("combobox", { name: /^Entity/ }));
    } else if (step === "filers") {
      await fillIfEmpty(wiz.getByLabel(/^First name/), "Sam");
      await fillIfEmpty(wiz.getByLabel(/^Last name/), "Sample");
    }
    if (step !== "entity") await fillRequired(wiz);
    if (step === until) return;
    if (WIZARD_ORDER.indexOf(step) > WIZARD_ORDER.indexOf(until)) throw new Unavailable(`no ${until} step for this filing`);
    const next = wiz.getByRole("button", { name: /^Continue/ });
    if (!(await next.count())) throw new Error(`stopped at the ${step} step`);
    for (let t = 0; t < 8 && (await next.isDisabled()); t++) await pause(page, 250);
    if (await next.isDisabled()) {
      const why = await wiz
        .locator("footer")
        .locator("xpath=preceding-sibling::div[1]")
        .innerText()
        .catch(() => "");
      throw new Error(`the ${step} step won't continue${why ? `: ${why.split("\n")[0]}` : ""}`);
    }
    await next.click();
    await pause(page, 350);
  }
  throw new Error(`never reached the ${until} step`);
}

function WIZARD_STEPS() {
  const titles = {
    entity: "the kind, state and name",
    business: "where it does business",
    ownership: "who owns it",
    filers: "who signs the articles",
    agent: "registered agent",
    ein: "the EIN application",
    state: "what the state asks",
    review: "review and file",
  };
  return WIZARD_ORDER.map((step, i) => ({
    id: `wizard-${step}`,
    kind: "popup",
    title: `Form an entity, step ${i + 1}: ${titles[step]}`,
    path: "/assets",
    before: palmFormAnswers,
    steps: async (p) => {
      await openWizard(p);
      await fillWizard(p, step);
      if (step === "review") await pause(p, 900);
    },
    expect: (p) => p.locator('[aria-labelledby="wiz-title"]'),
    files: WIZARD,
    note: `A sample Wyoming LLC typed in; the name check is answered in the browser, and nothing is filed.${step === "state" ? " Only when the state's filing has questions of its own." : ""}`,
  })).concat({
    id: "wizard-file-confirm",
    kind: "popup",
    title: "Form an entity: file it (confirm)",
    path: "/assets",
    before: palmFormAnswers,
    steps: async (p) => {
      await openWizard(p);
      await fillWizard(p, "review");
      const file = p.locator('[aria-labelledby="wiz-title"] footer').getByRole("button", { name: /^(File with|Submit test filing)/ });
      await file.waitFor({ state: "visible", timeout: 10000 });
      for (let i = 0; i < 20 && (await file.isDisabled()); i++) await pause(p, 500);
      await tap(file);
    },
    expect: (p) => confirmNamed(p, /^File .* with /),
    files: [...WIZARD, CONFIRM],
    note: "The last question before filing, opened and not confirmed.",
  });
}

// ── Files, by area, for the labels ───────────────────────────────────────

const SHELL = ["app/routes/app-layout.tsx", "app/sidebar-nav.tsx", "app/sidebar.ts", "app/app.css"];
const ENTITY = ["app/routes/asset-detail.tsx", "app/entity/use-entity.tsx", "app/entity/header.tsx", "app/entity/derive.ts", "app/entity/ui.tsx"];
const MAIL = ["app/routes/inbox.tsx", "app/mail/header.tsx", "app/mail/toolbar.tsx", "app/mail/list-body.tsx", "app/mail/list-row.tsx", "app/mail/table.tsx", "app/mail-client.ts"];
const BOOKS = ["app/books-shared.tsx"];
const CONFIRM = "app/confirm-dialog.tsx";

// ── The surfaces ─────────────────────────────────────────────────────────
// kind "page": a full-page capture of where it lands. kind "popup": a
// viewport capture once `steps` has opened it. A surface opens `path`, or
// `go` finds its record and opens that (path then describes it). `before`
// runs before the page loads (a route override, a stored preference);
// `signedOut` captures it as a visitor sees it; `expect` says what must be on
// screen for the capture to count (default: any dialog, menu or listbox for a
// pop-up); `only` limits it to some sizes; `steps: null` lists a surface the
// tour can't reach, with a note saying why. When the records have nothing to
// open a surface on (no notes, one mail address), the recipe says so
// (Unavailable) and no picture is kept.
//
// Recipes only open things. Nothing here sends, syncs, files, signs, deletes,
// connects, categorizes, saves, marks read or pays; a confirm is opened and
// left open. Where a state can only be reached through such a button (the
// sign-in code, the wizard's billed name check, a held talk button), that one
// request is answered in the browser and never leaves it.

/** The accounts the games are shown to (app/sign/preview.ts), read from the app so the tour follows it. */
const PREVIEWERS = (() => {
  try {
    const src = fs.readFileSync(path.join(__dirname, "../../app/sign/preview.ts"), "utf8");
    const m = src.match(/PREVIEW_ACCOUNTS\s*=\s*new Set\(\[([^\]]*)\]/);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase()) : [];
  } catch {
    return [];
  }
})();
/** The session as one of those accounts, when it isn't one already (the menu's gate is in the browser only). */
const asPreviewer = (s) => (!PREVIEWERS.length || PREVIEWERS.includes(String(s.user.email || "").toLowerCase()) ? s : { ...s, user: { ...s.user, email: PREVIEWERS[0] } });
const PREVIEW = {
  session: asPreviewer,
  before: async (page) => {
    if (asPreviewer(SESSION) !== SESSION) await answer("/api/auth/session", { user: asPreviewer(SESSION).user })(page);
  },
  note: "Shown only to the accounts in app/sign/preview.ts; when the tour's session isn't one, its email is changed in the browser to pass that gate.",
};

const ENTITY_PATH = (tab) => `/assets/:id${tab ? `/${tab}` : ""}`;
const PAGES = [
  // Public
  {
    id: "landing",
    kind: "page",
    title: "Landing (the front door)",
    path: "/",
    signedOut: true,
    files: ["app/routes/landing.tsx", "app/door.tsx", "app/door-state.ts", "app/home-animations/index.ts", "app/brand-lockup.tsx"],
    note: "WebGL backdrop chosen in the brand settings.",
  },
  { id: "login-phone", kind: "page", title: "Sign in: phone number", path: "/login", signedOut: true, files: ["app/routes/login.tsx", "app/auth.ts"] },
  {
    id: "login-code",
    kind: "page",
    title: "Sign in: the 6-digit code",
    path: "/login",
    signedOut: true,
    before: answer("/api/auth/", { ok: true, sent: true, kind: "phone", to: "+1 (555) 010-0142" }),
    steps: async (page) => {
      await (await seen(page.getByLabel("Phone number"))).fill("5550100142");
      await tap(page.locator('button[type="submit"]'));
      await seen(page.getByLabel("6-digit code"));
    },
    files: ["app/routes/login.tsx", "app/auth.ts"],
    note: "Reached by asking for a code for a 555 number; that request is answered in the browser, so no text is sent.",
  },
  {
    id: "complete-profile",
    kind: "page",
    title: "Finish setup: add an email",
    path: "/complete-profile",
    session: (s) => ({ ...s, user: { ...s.user, email: null } }),
    before: async (page) => answer("/api/auth/session", { user: { ...SESSION.user, email: null } })(page),
    files: ["app/routes/complete-profile.tsx", "app/auth.ts"],
    note: "Seen right after a first sign-in by someone whose account has no email yet (the session is altered in the browser to show it).",
  },
  {
    id: "complete-profile-name",
    kind: "page",
    title: "Finish setup: your name",
    path: "/complete-profile",
    session: (s) => ({ ...s, user: { ...s.user, name: "", email: null } }),
    before: async (page) => answer("/api/auth/session", { user: { ...SESSION.user, name: "", email: null } })(page),
    files: ["app/routes/complete-profile.tsx", "app/auth.ts"],
    note: "Someone with no name on the account (the session is altered in the browser to show it).",
  },
  { id: "legal-terms", kind: "page", title: "Terms of use", path: "/legal/terms", signedOut: true, files: ["app/routes/legal-terms.tsx"] },
  { id: "legal-privacy", kind: "page", title: "Privacy policy", path: "/legal/privacy", signedOut: true, files: ["app/routes/legal-privacy.tsx"] },
  {
    id: "sign-token",
    kind: "page",
    title: "A signer's page (from the emailed link)",
    path: "/sign/:token",
    go: (page) => open(page, `${BASE}/sign/tour-not-a-real-token`),
    signedOut: true,
    before: signerPage,
    files: ["app/routes/sign.tsx", "app/sign/pdf-pages.tsx", "app/sign/signature-pad.tsx", "app/sign/use-poll.ts", "api/sign.ts"],
    note: "A real request as its signer sees it, answered in the browser for a made-up token: opening a real link would record a view.",
  },
  {
    id: "sign-preview",
    kind: "page",
    title: "Signing preview: the game",
    path: "/sign/preview",
    ...PREVIEW,
    files: ["app/routes/sign-preview.tsx", "app/sign/preview.ts", "app/sign/game/index.tsx", "app/sign/game/engine.ts"],
  },
  {
    id: "sign-preview-race",
    kind: "page",
    title: "Signing preview: the race",
    path: "/sign/preview?game=race",
    ...PREVIEW,
    files: ["app/routes/sign-preview.tsx", "app/sign/preview.ts", "app/sign/kart/index.tsx", "app/sign/kart/engine.ts"],
  },
  {
    id: "home-animations",
    kind: "page",
    title: "Home backdrops gallery",
    path: "/home-animations",
    ...PREVIEW,
    files: ["app/routes/home-animations.tsx", "app/home-animations/index.ts", "app/home-background.tsx"],
  },

  // Signed in
  { id: "home", kind: "page", title: "Home", path: "/home", files: ["app/routes/home.tsx", "app/home-search.tsx", "app/home-background.tsx", ...SHELL] },
  { id: "games", kind: "page", title: "Games", path: "/games", ...PREVIEW, files: ["app/routes/games.tsx"] },
  {
    id: "ask-voice",
    kind: "page",
    title: "Ask BFO: voice",
    path: "/ask",
    files: ["app/routes/ask.tsx", "app/ask-voice-stage.tsx", "app/particle-globe.tsx", "app/ask-voice.ts", "app/realtime-voice.ts"],
  },
  { id: "ask-text", kind: "page", title: "Ask BFO: text", path: "/ask?mode=text", files: ["app/routes/ask.tsx", "app/ask-markdown.tsx", "app/ask-client.ts"] },
  { id: "assets-list", kind: "page", title: "Entities: list", path: "/assets", storage: { "bfo-entities-view": "list" }, files: ["app/routes/assets.tsx", "app/entity-completeness.ts"] },
  { id: "assets-cards", kind: "page", title: "Entities: cards", path: "/assets", storage: { "bfo-entities-view": "cards" }, files: ["app/routes/assets.tsx", "app/entity-completeness.ts"] },
  { id: "assets-map", kind: "page", title: "Entities: map", path: "/assets", storage: { "bfo-entities-view": "map" }, files: ["app/routes/assets.tsx", "app/compliance-map.ts"] },
  {
    id: "entity-overview",
    kind: "page",
    title: "Entity: Overview (LLC)",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    files: [...ENTITY, "app/entity/overview.tsx", "app/entity/standing.tsx", "app/entity/palm-questions.tsx", "app/entity/closing.tsx"],
  },
  {
    id: "entity-documents",
    kind: "page",
    title: "Entity: Documents",
    path: ENTITY_PATH("documents"),
    go: (p) => goEntity(p, "llc", "documents"),
    files: [...ENTITY, "app/entity/documents.tsx", "app/entity-paperwork.ts", "app/stored-file.tsx"],
  },
  { id: "entity-owners", kind: "page", title: "Entity: Owners (LLC)", path: ENTITY_PATH("people"), go: (p) => goEntity(p, "llc", "people"), files: [...ENTITY, "app/entity/people.tsx"] },
  { id: "entity-trust-people", kind: "page", title: "Entity: People (trust)", path: ENTITY_PATH("people"), go: (p) => goEntity(p, "trust", "people"), files: [...ENTITY, "app/entity/people.tsx"] },
  {
    id: "entity-compliance",
    kind: "page",
    title: "Entity: Compliance",
    path: ENTITY_PATH("compliance"),
    go: (p) => goEntity(p, "llc", "compliance"),
    files: [...ENTITY, "app/entity/compliance.tsx", "app/entity/standing.tsx", "app/palm-cases.ts"],
  },
  {
    id: "entity-contracts",
    kind: "page",
    title: "Entity: Contracts (LLC)",
    path: ENTITY_PATH("agreements"),
    go: (p) => goEntity(p, "llc", "agreements"),
    files: [...ENTITY, "app/entity/agreements.tsx"],
  },
  {
    id: "entity-governance",
    kind: "page",
    title: "Entity: Governance (C-Corp)",
    path: ENTITY_PATH("governance"),
    go: (p) => goEntity(p, "corp", "governance"),
    files: [...ENTITY, "app/entity/governance.tsx"],
    note: "Only a C-Corp has this tab.",
  },
  { id: "entity-activity", kind: "page", title: "Entity: Activity", path: ENTITY_PATH("activity"), go: (p) => goEntity(p, "llc", "activity"), files: [...ENTITY, "app/entity/activity.tsx"] },
  {
    id: "entity-edit",
    kind: "page",
    title: "Entity: editing the record",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: async (page) => tap(button(page, "Edit", true)),
    files: [...ENTITY, "app/entity/overview.tsx"],
    note: "Edit opened, nothing saved.",
  },
  {
    id: "contract",
    kind: "page",
    title: "Contract (MSA) PDF",
    path: "/assets/:id/contract/:contractId",
    go: goContract,
    files: ["app/routes/contract-pdf.tsx", "app/sign/contract-signature.tsx", "app/entity/agreements.tsx"],
  },
  { id: "msas", kind: "page", title: "Tools: MSAs", path: "/msas", files: ["app/routes/msas.tsx"] },
  { id: "notes", kind: "page", title: "Notes", path: "/notes", files: ["app/routes/notes.tsx"] },
  { id: "settings", kind: "page", title: "Settings", path: "/settings", files: ["app/routes/settings.tsx", "app/brand-studio.tsx", "app/palm-usage.tsx"] },
  { id: "users", kind: "page", title: "Users", path: "/users", files: ["app/routes/users.tsx"] },
  { id: "treasury", kind: "page", title: "Treasury: cards", path: "/treasury", storage: { "bfo-treasury-view": "grid" }, files: ["app/routes/treasury.tsx", "app/plaid-link.ts", "app/currency.ts"] },
  { id: "treasury-list", kind: "page", title: "Treasury: list", path: "/treasury", storage: { "bfo-treasury-view": "list" }, files: ["app/routes/treasury.tsx", "app/currency.ts"] },
  {
    id: "treasury-account",
    kind: "page",
    title: "Treasury: one account",
    path: "/treasury/:accountId",
    storage: { "bfo-treasury-view": "grid" },
    go: (p) => goFirst(p, "treasury-account", "/treasury", "button.treasury-card"),
    files: ["app/routes/treasury-account.tsx"],
  },
  { id: "treasury-mappings", kind: "page", title: "Treasury: account mappings", path: "/treasury/mappings", files: ["app/routes/treasury-mappings.tsx"] },
  { id: "investments", kind: "page", title: "Investments", path: "/investments", files: ["app/routes/investments.tsx"] },
  {
    id: "books-transactions",
    kind: "page",
    title: "Books: transactions",
    path: "/books/transactions",
    files: ["app/routes/books-transactions.tsx", ...BOOKS, "app/books-batch.ts", "app/books-csv.ts"],
  },
  { id: "books-review", kind: "page", title: "Books: review desk", path: "/books/review", files: ["app/routes/books-review.tsx", ...BOOKS] },
  { id: "books-calendar", kind: "page", title: "Books: calendar", path: "/books/calendar", files: ["app/routes/books-calendar.tsx", ...BOOKS] },
  { id: "books-reports-pnl", kind: "page", title: "Books: reports, profit and loss", path: "/books/reports", files: ["app/routes/books-reports.tsx", ...BOOKS] },
  { id: "books-reports-balance", kind: "page", title: "Books: reports, balance sheet", path: "/books/reports?view=balance", files: ["app/routes/books-reports.tsx", ...BOOKS] },
  { id: "books-reports-statements", kind: "page", title: "Books: reports, statements and 1099s", path: "/books/reports?view=statements", files: ["app/routes/books-reports.tsx", ...BOOKS] },
  {
    id: "books-reports-cell",
    kind: "page",
    title: "Books: the transactions behind a report cell",
    path: "/books/reports/cell?entity&year&section&label",
    go: (p) => goFirst(p, "books-reports-cell", "/books/reports", (page) => page.getByRole("button", { name: /, full year: view transactions$/ })),
    files: ["app/routes/books-cell.tsx", ...BOOKS],
    note: "The first line of the profit and loss, for the full year.",
  },
  { id: "books-vendors", kind: "page", title: "Books: vendors", path: "/books/vendors", files: ["app/routes/books-vendors.tsx", ...BOOKS] },
  {
    id: "books-vendor-detail",
    kind: "page",
    title: "Books: one vendor",
    path: "/books/vendors/detail?name",
    go: (p) => goFirst(p, "books-vendor-detail", "/books/vendors", 'main a[href^="/books/vendors/detail"]'),
    files: ["app/routes/books-vendor-detail.tsx", ...BOOKS],
  },
  { id: "books-rules", kind: "page", title: "Books: rules", path: "/books/rules", files: ["app/routes/books-rules.tsx", ...BOOKS] },
  { id: "books-loans", kind: "page", title: "Books: loans", path: "/books/loans", files: ["app/routes/books-loans.tsx", ...BOOKS] },
  { id: "notifications", kind: "page", title: "Notifications", path: "/notifications", files: ["app/routes/notifications.tsx", "app/push.ts"] },
  { id: "estate-map", kind: "page", title: "Estate map", path: "/estate-map", files: ["app/routes/estate-map.tsx"] },
  { id: "inbox", kind: "page", title: "Mail: the list", path: "/inbox", files: MAIL },
  {
    id: "inbox-columns",
    kind: "page",
    title: "Mail: the list in columns",
    path: "/inbox",
    storage: { "bfo-mail-view": "columns" },
    only: ["desk"],
    files: MAIL,
    note: "A desktop layout; phones always show the one list.",
  },
  {
    id: "inbox-message",
    kind: "page",
    title: "Mail: an open message",
    path: "/inbox?m=:id",
    go: (p) => goFirst(p, "inbox-message", "/inbox", readMailRow),
    files: [...MAIL, "app/mail/reader.tsx", "app/mail-frame.tsx", "app/mail/use-open-message.ts"],
    note: "The first message already read, so opening it changes nothing.",
  },
  { id: "mailbox", kind: "page", title: "Paper mail", path: "/mailbox", files: ["app/routes/paper-mail.tsx", "app/paper-mail.tsx"] },
  {
    id: "mailbox-piece",
    kind: "page",
    title: "Paper mail: one piece",
    path: "/mailbox/:id",
    go: (p) => goFirst(p, "mailbox-piece", "/mailbox", readPaperRow),
    files: ["app/routes/paper-mail-piece.tsx", "app/paper-mail.tsx"],
    note: "The first piece already read.",
  },
  { id: "phone", kind: "page", title: "Phone (texts)", path: "/phone", files: ["app/routes/phone.tsx"] },
  { id: "tools-compliance-map", kind: "page", title: "Tools: compliance, map", path: "/tools/compliance", files: ["app/routes/tools-compliance.tsx", "app/compliance-map.ts"] },
  { id: "tools-compliance-list", kind: "page", title: "Tools: compliance, list", path: "/tools/compliance?view=list", files: ["app/routes/tools-compliance.tsx"] },
  { id: "tools-signatures", kind: "page", title: "Tools: signatures", path: "/tools/signatures", files: ["app/routes/tools-signatures.tsx", "app/sign/api.ts"] },
  {
    id: "signature-detail",
    kind: "page",
    title: "Tools: one signature request",
    path: "/tools/signatures/:id",
    go: (p) => goFirst(p, "signature-detail", "/tools/signatures", 'main a[href^="/tools/signatures/"]'),
    files: ["app/routes/signature-detail.tsx", "app/sign/api.ts", "app/sign/pdf-pages.tsx"],
  },
  { id: "not-found", kind: "page", title: "Page not found", path: "/no-such-page", files: ["app/routes/not-found.tsx"] },
];

/** The first mail row already read (opening an unread one would mark it read). */
const readMailRow = (page) => page.locator("[data-mail-row]").filter({ hasNotText: "Unread." });
/** The first paper-mail piece already read. */
const readPaperRow = (page) => page.locator('a[aria-label^="Open the mail from"]').filter({ hasNot: page.locator('[aria-label="Unread"]') });

// Pop-ups, by where they open. Each recipe clicks the real control.
const confirmNamed = (page, title) => page.getByRole("dialog", { name: title }).or(page.getByRole("alertdialog", { name: title }));
const books = (page) => page.getByRole("alertdialog");
const ASK = ["app/routes/ask.tsx"];
const ASSETS = ["app/routes/assets.tsx", "app/books-shared.tsx"];
const WIZARD = ["app/entity/form-wizard.tsx", "app/formation.ts", "app/routes/assets.tsx"];
const SIG = ["app/routes/signature-detail.tsx", "app/sign/api.ts"];
const TXNS = ["app/routes/books-transactions.tsx", "app/books-shared.tsx"];

const POPUPS = [
  // The shell
  {
    id: "nav-drawer",
    kind: "popup",
    title: "Navigation drawer",
    path: "/home",
    only: ["phone"],
    steps: (p) => tap(button(p, "Open menu")),
    expect: (p) => p.locator('aside[aria-label="Navigation"][role="dialog"]'),
    files: SHELL,
  },
  { id: "account-menu", kind: "popup", title: "Account menu", path: "/home", steps: openAccountMenu, expect: (p) => p.getByRole("menu"), files: SHELL },
  {
    id: "appearance",
    kind: "popup",
    title: "Appearance panel",
    path: "/home",
    steps: (p) => fromAccountMenu(p, /Appearance/),
    expect: (p) => dialog(p, "Appearance"),
    files: ["app/appearance-panel.tsx", "app/appearance.ts", "app/theme.tsx"],
  },
  {
    id: "palette",
    kind: "popup",
    title: "Command palette (⌘K)",
    path: "/home",
    steps: openPalette,
    expect: (p) => dialog(p, "Jump to"),
    files: ["app/command-palette.tsx", "app/routes/app-layout.tsx"],
  },
  {
    id: "palette-results",
    kind: "popup",
    title: "Command palette with a search typed",
    path: "/home",
    steps: async (p) => {
      await openPalette(p);
      await p.keyboard.type("books", { delay: 40 });
    },
    expect: (p) => dialog(p, "Jump to"),
    files: ["app/command-palette.tsx"],
  },
  {
    id: "shortcuts",
    kind: "popup",
    title: "Keyboard shortcuts",
    path: "/home",
    only: ["desk"],
    steps: async (p) => {
      await p.locator("main").click({ position: { x: 4, y: 4 } });
      await p.keyboard.press("?");
    },
    expect: (p) => dialog(p, "Keyboard shortcuts"),
    files: ["app/command-palette.tsx"],
  },
  {
    id: "shortcuts-mail",
    kind: "popup",
    title: "Keyboard shortcuts, in Mail",
    path: "/inbox",
    only: ["desk"],
    steps: async (p) => {
      await p.locator("main").click({ position: { x: 4, y: 4 } });
      await p.keyboard.press("?");
    },
    expect: (p) => dialog(p, "Keyboard shortcuts"),
    files: ["app/command-palette.tsx", "app/mail/shortcuts.ts"],
  },
  {
    id: "app-lock",
    kind: "popup",
    title: "Face ID lock (the iPhone app)",
    path: "/home",
    only: ["phone"],
    // The iPhone app's bridge, imitated: Capacitor sees iOS, and Face ID's plugin answers nothing, so the cover stays up.
    before: (p) =>
      p.addInitScript(() => {
        window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
        window.Capacitor = {
          PluginHeaders: [
            {
              name: "NativeBiometric",
              methods: [
                { name: "isAvailable", rtype: "promise" },
                { name: "verifyIdentity", rtype: "promise" },
              ],
            },
          ],
          nativePromise: () => new Promise(() => {}),
          nativeCallback: () => "0",
        };
      }),
    expect: (p) => dialog(p, "BFO is locked"),
    files: ["app/app-lock.tsx", "app/native.ts"],
    note: "The app's cover before Face ID; the native bridge is imitated in the browser so the web build shows it.",
  },
  {
    id: "offline-banner",
    kind: "popup",
    title: "Offline notice",
    path: "/home",
    steps: (p) => p.evaluate(() => window.dispatchEvent(new Event("offline"))),
    expect: (p) => p.getByRole("status").filter({ hasText: /offline/i }),
    files: ["app/shell-status.tsx"],
  },

  // Home
  {
    id: "home-search",
    kind: "popup",
    title: "Home search results",
    path: "/home",
    steps: async (p) => {
      await tap(p.getByRole("combobox", { name: "Search BFO" }));
      await p.keyboard.type("books", { delay: 40 });
    },
    expect: (p) => p.getByRole("listbox"),
    files: ["app/home-search.tsx", "app/routes/home.tsx"],
  },

  // Ask
  { id: "ask-history", kind: "popup", title: "Ask: conversation history (voice)", path: "/ask", steps: (p) => tap(button(p, "History", true)), expect: (p) => button(p, "Close history"), files: ASK },
  {
    id: "ask-history-text",
    kind: "popup",
    title: "Ask: conversation history (text)",
    path: "/ask?mode=text",
    only: ["phone"],
    steps: (p) => tap(button(p, "History", true)),
    expect: (p) => button(p, "Close history"),
    files: ASK,
  },
  {
    id: "ask-delete-confirm",
    kind: "popup",
    title: "Ask: delete a conversation",
    path: "/ask?mode=text",
    steps: async (p) => {
      if (isPhone(p)) await tap(button(p, "History", true));
      const del = p.getByRole("button", { name: "Delete conversation" });
      await del.first().waitFor({ state: "attached", timeout: 10000 });
      await del.first().click({ force: true });
    },
    expect: (p) => confirmNamed(p, "Delete this conversation?"),
    files: [...ASK, CONFIRM],
  },
  {
    id: "ask-voice-listening",
    kind: "popup",
    title: "Ask: the voice stage while you hold to talk",
    path: "/ask",
    // Held, never released: nothing is asked. The live voice's key and OpenAI are refused in the browser, so it listens on the recorder.
    before: async (p) => {
      await p.route("https://api.openai.com/**", (r) => r.abort());
      await p.route(
        (u) => u.pathname.startsWith("/api/ask"),
        (r) => (r.request().method() === "GET" ? r.fallback() : r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"tour","message":"Not during the tour."}' })),
      );
    },
    steps: async (p) => {
      const b = await seen(button(p, "Hold to talk"));
      await b.hover();
      await p.mouse.down();
      await pause(p, 1800);
    },
    expect: (p) => button(p, "Hold to talk"),
    files: ["app/ask-voice-stage.tsx", "app/particle-globe.tsx", "app/ask-voice.ts", "app/realtime-voice.ts", ...ASK],
    note: "Captured while the button is held; it is never released, so nothing is sent.",
  },

  // Entities
  {
    id: "assets-row-menu",
    kind: "popup",
    title: "Entities: a row's actions",
    path: "/assets",
    storage: { "bfo-entities-view": "list" },
    steps: (p) => tap(p.getByRole("button", { name: /^Actions for / })),
    expect: (p) => p.getByRole("menu"),
    files: ASSETS,
  },
  {
    id: "assets-state-filter",
    kind: "popup",
    title: "Entities: filter by state",
    path: "/assets",
    storage: { "bfo-entities-view": "list" },
    steps: (p) => tap(p.getByRole("button", { name: /^State: / })),
    files: ASSETS,
  },
  {
    id: "assets-compliance-tip",
    kind: "popup",
    title: "Entities: a compliance score's card",
    path: "/assets",
    storage: { "bfo-entities-view": "list" },
    steps: (p) => tap(p.getByRole("button", { name: /^Compliance \d+/ })),
    expect: (p) => p.getByRole("tooltip"),
    files: ASSETS,
  },
  {
    id: "assets-owner-picker",
    kind: "popup",
    title: "Entities: change an owner",
    path: "/assets",
    storage: { "bfo-entities-view": "cards" },
    steps: (p) => tap(p.getByRole("button", { name: /^Owned by: / })),
    expect: (p) => p.getByRole("listbox"),
    files: ASSETS,
    note: "Opened, nothing chosen.",
  },
  {
    id: "assets-new-entity",
    kind: "popup",
    title: "Entities: new entity",
    path: "/assets",
    steps: (p) => tap(button(p, "New entity")),
    expect: (p) => p.locator('[aria-labelledby="new-entity-title"]'),
    files: ASSETS,
  },
  {
    id: "assets-sync-palm-confirm",
    kind: "popup",
    title: "Entities: sync everything with Palm (confirm)",
    path: "/assets",
    steps: (p) => tap(p.getByRole("button", { name: /^Sync everything with Palm/ })),
    expect: (p) => confirmNamed(p, /^Sync \d+ entit/),
    files: [...ASSETS, CONFIRM],
    note: "Opened, not confirmed.",
  },
  {
    id: "assets-scan-confirm",
    kind: "popup",
    title: "Entities: scan every entity's documents (confirm)",
    path: "/assets",
    steps: (p) => tap(button(p, "Scan all documents")),
    expect: (p) => confirmNamed(p, "Scan every entity's documents?"),
    files: [...ASSETS, CONFIRM],
    note: "Opened, not confirmed.",
  },
  {
    id: "assets-palm-checks",
    kind: "popup",
    title: "Entities: monitor and verify with Palm",
    path: "/assets",
    steps: (p) => tap(button(p, "Monitor and verify with Palm")),
    files: ASSETS,
    note: "Shows Palm's plan; nothing is started.",
  },
  {
    id: "assets-palm-results",
    kind: "popup",
    title: "Entities: what a Palm sync found",
    path: "/assets",
    steps: null,
    files: ASSETS,
    note: "Shows after a sync or a check with Palm has run; the tour starts neither.",
  },
  ...WIZARD_STEPS(),
  {
    id: "wizard-leave-confirm",
    kind: "popup",
    title: "Form an entity: leave without filing (confirm)",
    path: "/assets",
    before: palmFormAnswers,
    steps: async (p) => {
      await openWizard(p);
      await fillWizard(p, "entity");
      await tap(p.getByRole("dialog").getByRole("button", { name: "Close" }));
    },
    expect: (p) => confirmNamed(p, "Leave without filing?"),
    files: [...WIZARD, CONFIRM],
  },

  // An entity
  {
    id: "entity-more-menu",
    kind: "popup",
    title: "Entity: more actions",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: (p) => tap(button(p, "More actions")),
    expect: (p) => button(p, "Delete entity"),
    files: ENTITY,
  },
  {
    id: "entity-delete-confirm",
    kind: "popup",
    title: "Entity: delete (confirm)",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: async (p) => {
      await tap(button(p, "More actions"));
      await tap(button(p, "Delete entity"));
    },
    expect: (p) => confirmNamed(p, /^Delete /),
    files: [...ENTITY, CONFIRM],
    note: "Opened, not confirmed.",
  },
  {
    id: "entity-close-confirm",
    kind: "popup",
    title: "Entity: start closing it (confirm)",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: async (p) => {
      await tap(button(p, "More actions"));
      await tap(button(p, /^Close this entity/));
    },
    expect: (p) => confirmNamed(p, /^Start closing /),
    files: [...ENTITY, "app/entity-closing.ts", CONFIRM],
    note: "Opened, not confirmed.",
  },
  {
    id: "entity-sync-confirm",
    kind: "popup",
    title: "Entity: sync with Palm (confirm)",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: async (p) => {
      const b = await seen(p.getByRole("button", { name: /^Sync everything with Palm/ }));
      // Free syncs start at once, with no question: only a billed one is clicked.
      if (!/est\. \$/.test((await b.getAttribute("aria-label")) || "")) throw new Unavailable("this sync is free, so it would start without asking; not clicked");
      await tap(b);
    },
    expect: (p) => confirmNamed(p, /^Sync .* with Palm\?/),
    files: [...ENTITY, CONFIRM],
    note: "Opened, not confirmed. Only a billed sync asks first; a free one isn't clicked.",
  },
  {
    id: "entity-sections-menu",
    kind: "popup",
    title: "Entity: the sections menu",
    path: ENTITY_PATH(""),
    only: ["phone"],
    go: (p) => goEntity(p, "llc"),
    steps: (p) => tap(p.getByRole("button", { name: /Section/ })),
    expect: (p) => p.getByRole("menu", { name: "Sections" }),
    files: ["app/entity/header.tsx"],
  },
  {
    id: "entity-edit-discard-confirm",
    kind: "popup",
    title: "Entity: discard edits (confirm)",
    path: ENTITY_PATH(""),
    go: (p) => goEntity(p, "llc"),
    steps: async (p) => {
      await tap(button(p, "Edit", true));
      const field = await seen(p.locator('main input[type="text"]:not([readonly]), main textarea').first());
      await field.click();
      await p.keyboard.type(" ");
      await tap(button(p, "Cancel editing"));
    },
    expect: (p) => confirmNamed(p, "Discard changes?"),
    files: [...ENTITY, "app/entity/overview.tsx", CONFIRM],
    note: "A space typed into a field, then Cancel; nothing is saved.",
  },
  {
    id: "entity-owner-add",
    kind: "popup",
    title: "Entity: add an owner (the people editor)",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "owner-add", ["llc"], "people", (q) => q.getByRole("button", { name: /^(\+ Add|Add owner)$/ }), "no entity offers to add an owner"),
    steps: (p) => tap(p.getByRole("button", { name: /^(\+ Add|Add owner)$/ })),
    expect: (p) => p.locator("main form"),
    files: ["app/entity/people.tsx"],
    note: "The form opened, nothing saved.",
  },
  {
    id: "entity-owner-edit",
    kind: "popup",
    title: "Entity: edit an owner",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "owner-row", ["llc", "corp"], "people", (q) => button(q, "Remove from owners"), "no entity lists an owner to edit"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: "Edit", exact: true }).last()),
    expect: (p) => p.locator("main form"),
    files: ["app/entity/people.tsx"],
    note: "The form opened, nothing saved.",
  },
  {
    id: "entity-owner-remove-confirm",
    kind: "popup",
    title: "Entity: remove an owner (confirm)",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "owner-row", ["llc", "corp"], "people", (q) => button(q, "Remove from owners"), "no entity lists an owner to edit"),
    steps: (p) => tap(button(p, "Remove from owners")),
    expect: (p) => confirmNamed(p, /^Remove /),
    files: ["app/entity/people.tsx", CONFIRM],
  },
  {
    id: "entity-access-remove-confirm",
    kind: "popup",
    title: "Entity: remove someone's access (confirm)",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "access", ["llc", "trust", "corp"], "people", (q) => button(q, "Remove access"), "no one outside the office has access to an entity"),
    steps: (p) => tap(button(p, "Remove access")),
    expect: (p) => confirmNamed(p, /access\?$/),
    files: ["app/entity/people.tsx", CONFIRM],
    note: "Only when someone outside the office has access to this entity.",
  },
  {
    id: "entity-invite",
    kind: "popup",
    title: "Entity: invite an owner to BFO",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "invite", ["llc", "trust", "corp"], "people", (q) => q.getByRole("button", { name: /^(Invite to BFO|Resend)$/ }), "no entity lists a person to invite"),
    steps: (p) => tap(p.getByRole("button", { name: /^(Invite to BFO|Resend)$/ })),
    expect: (p) => p.locator('[aria-labelledby="invite-title"]'),
    files: ["app/entity/people.tsx"],
    note: "Opened, not sent.",
  },
  {
    id: "entity-trust-add",
    kind: "popup",
    title: "Entity: add a trustee, grantor or beneficiary",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "trust-add", ["trust"], "people", (q) => q.getByRole("button", { name: /^(\+ Add|Add (trustee|grantor|beneficiary))$/i }), "no trust on record"),
    steps: (p) => tap(p.getByRole("button", { name: /^(\+ Add|Add (trustee|grantor|beneficiary))$/i })),
    expect: (p) => p.getByRole("textbox", { name: /'s name$/ }),
    files: ["app/entity/people.tsx"],
    note: "The field opened, nothing saved.",
  },
  {
    id: "entity-trust-remove-confirm",
    kind: "popup",
    title: "Entity: remove someone from a trust (confirm)",
    path: ENTITY_PATH("people"),
    go: (p) => goEntityWith(p, "trust-remove", ["trust"], "people", (q) => q.locator("main").getByRole("button", { name: /^Remove / }), "no trust lists anyone to remove"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^Remove / })),
    expect: (p) => confirmNamed(p, /^Remove .*\?$/),
    files: ["app/entity/people.tsx", CONFIRM],
  },
  {
    id: "entity-doc-viewer",
    kind: "popup",
    title: "Entity: a document in the viewer",
    path: ENTITY_PATH("documents"),
    go: (p) =>
      goEntityWith(
        p,
        "doc-view",
        ["llc", "corp", "trust"],
        "documents",
        (q) =>
          q
            .locator("main")
            .getByRole("link", { name: /^View / })
            .or(q.locator("main").getByRole("button", { name: /^View / })),
        "no entity has a stored document",
      ),
    steps: async (p) => {
      await tap(
        p
          .locator("main")
          .getByRole("link", { name: /^View / })
          .or(p.locator("main").getByRole("button", { name: /^View / })),
      );
      // The file comes from storage through a signed link: wait for it to be drawn.
      await p
        .getByText(/^Fetching the file/)
        .waitFor({ state: "hidden", timeout: 20000 })
        .catch(() => undefined);
      await pause(p, 800);
    },
    expect: (p) => p.locator('[role="dialog"][aria-modal="true"]'),
    files: ["app/doc-viewer.tsx", "app/stored-file.tsx", "app/entity/documents.tsx"],
  },
  {
    id: "entity-doc-delete-confirm",
    kind: "popup",
    title: "Entity: delete a document (confirm)",
    path: ENTITY_PATH("documents"),
    go: (p) => goEntityWith(p, "doc-delete", ["llc", "corp", "trust"], "documents", (q) => q.locator("main").getByRole("button", { name: /^Delete / }), "no entity has a document in its library"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^Delete / })),
    expect: (p) => confirmNamed(p, /^Delete /),
    files: ["app/entity/documents.tsx", CONFIRM],
  },
  {
    id: "entity-unfile-confirm",
    kind: "popup",
    title: "Entity: unfile or remove a filed document (confirm)",
    path: ENTITY_PATH("documents"),
    go: (p) => goEntityWith(p, "doc-unfile", ["llc", "corp", "trust"], "documents", (q) => q.locator("main").getByRole("button", { name: /^(Unfile|Remove) / }), "no entity has a filed document"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^(Unfile|Remove) / })),
    expect: (p) => confirmNamed(p, /^(Unfile|Remove the uploaded) /),
    files: ["app/entity/documents.tsx", CONFIRM],
  },
  {
    id: "entity-generate-confirm",
    kind: "popup",
    title: "Entity: fill in a form or draft the operating agreement (confirm)",
    path: ENTITY_PATH("documents"),
    go: (p) => goEntityWith(p, "doc-generate", ["llc", "corp"], "documents", (q) => q.locator("main").getByRole("button", { name: /^(Fill in|Draft) / }), "no entity offers a form to fill in"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^(Fill in|Draft) / })),
    expect: (p) => p.getByRole("dialog").or(p.getByRole("alertdialog")),
    files: ["app/entity/documents.tsx", "app/entity/use-entity.tsx", "app/paperwork-generate.ts", CONFIRM],
    note: "Opened, not confirmed (or the note saying what's missing).",
  },
  {
    id: "entity-agent-confirm",
    kind: "popup",
    title: "Entity: make Palm the registered agent (confirm)",
    path: ENTITY_PATH("compliance"),
    go: (p) => goEntityWith(p, "agent", ["llc", "corp"], "compliance", (q) => button(q, "Make Palm the agent"), "Palm is already every entity's agent (or none can move)"),
    steps: (p) => tap(button(p, "Make Palm the agent")),
    expect: (p) => p.getByRole("dialog").or(p.getByRole("alertdialog")),
    files: ["app/entity/compliance.tsx", "app/entity/use-entity.tsx", CONFIRM],
    note: "Opened, not confirmed. Only where Palm isn't already the agent.",
  },
  {
    id: "entity-contract-new",
    kind: "popup",
    title: "Entity: a new contract (MSA) form",
    path: ENTITY_PATH("agreements"),
    go: (p) => goEntity(p, "llc", "agreements"),
    steps: (p) => tap(button(p, "New contract")),
    expect: (p) => p.locator("main form, main input").first(),
    files: ["app/entity/agreements.tsx"],
    note: "The form opened, nothing saved.",
  },
  {
    id: "entity-contract-delete-confirm",
    kind: "popup",
    title: "Entity: delete a contract (confirm)",
    path: ENTITY_PATH("agreements"),
    go: (p) => goEntityWith(p, "contract-delete", ["llc"], "agreements", (q) => q.locator("main").getByRole("button", { name: /^Delete / }), "no entity has a contract"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^Delete / })),
    expect: (p) => confirmNamed(p, /^Delete the MSA /),
    files: ["app/entity/agreements.tsx", CONFIRM],
  },
  {
    id: "entity-governance-add",
    kind: "popup",
    title: "Entity: add a director",
    path: ENTITY_PATH("governance"),
    go: (p) => goEntityWith(p, "gov-add", ["corp"], "governance", (q) => q.getByRole("button", { name: /^Add director/ }), "no C-Corp on record"),
    steps: (p) => tap(p.getByRole("button", { name: /^Add director/ })),
    expect: (p) => p.locator("main input").first(),
    files: ["app/entity/governance.tsx"],
  },
  {
    id: "entity-governance-remove-confirm",
    kind: "popup",
    title: "Entity: remove a director, officer or shareholder (confirm)",
    path: ENTITY_PATH("governance"),
    go: (p) => goEntityWith(p, "gov-remove", ["corp"], "governance", (q) => q.locator("main").getByRole("button", { name: /^Remove/ }), "no C-Corp lists a director, officer or shareholder"),
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^Remove/ })),
    expect: (p) => confirmNamed(p, /^Remove /),
    files: ["app/entity/governance.tsx", CONFIRM],
  },
  {
    id: "entity-scan-toast",
    kind: "popup",
    title: "Entity: reading documents (toast)",
    path: ENTITY_PATH("documents"),
    steps: null,
    files: ["app/entity/overlay.tsx"],
    note: "Shows while documents are being read and filed; starting a read files things, so the tour doesn't.",
  },
  {
    id: "entity-monitor-confirm",
    kind: "popup",
    title: "Entity: turn on Palm Monitor (confirm)",
    path: ENTITY_PATH("compliance"),
    steps: null,
    files: ["app/entity/compliance.tsx"],
    note: "Uses the browser's own confirm(), which a screenshot can't show (app/entity/compliance.tsx).",
  },

  // Mail
  {
    id: "mail-compose",
    kind: "popup",
    title: "Mail: a new message",
    path: "/inbox",
    steps: (p) => openComposer(p, false),
    expect: (p) => p.locator('[aria-labelledby="compose-title"]'),
    files: ["app/mail/composer.tsx", "app/mail-editor.tsx", "app/mail/drafts.ts"],
    note: "With more than one address, it opens on the question of which to send from.",
  },
  {
    id: "mail-compose-filled",
    kind: "popup",
    title: "Mail: a new message, filled in",
    path: "/inbox",
    steps: async (p) => {
      await openComposer(p);
      await (await seen(p.locator("#compose-to"))).fill("someone@example.com");
      await p.locator("#compose-subject").fill("Quarterly statements");
      const body = p.getByPlaceholder("Write your message…").or(p.locator('[aria-labelledby="compose-title"] [contenteditable="true"]'));
      await body.first().click();
      await p.keyboard.type("Hi, the statements for last quarter are attached. Let me know if anything looks off.");
    },
    expect: (p) => p.locator('[aria-labelledby="compose-title"]'),
    files: ["app/mail/composer.tsx", "app/mail-editor.tsx"],
    note: "Typed, never sent.",
  },
  {
    id: "mail-compose-from",
    kind: "popup",
    title: "Mail: choosing the address to send from",
    path: "/inbox",
    steps: async (p) => {
      const panel = await openComposer(p, false);
      const list = p.getByRole("listbox", { name: "Send from" });
      if (!(await list.isVisible().catch(() => false))) await tap(await need(panel.locator('button[aria-haspopup="listbox"]'), "only one address to send from", 3000));
    },
    expect: (p) => p.getByRole("listbox", { name: "Send from" }),
    files: ["app/mail/composer.tsx"],
    note: "Only when the account has more than one address.",
  },
  {
    id: "mail-discard-confirm",
    kind: "popup",
    title: "Mail: discard a message (confirm)",
    path: "/inbox",
    steps: async (p) => {
      await openComposer(p);
      await (await seen(p.locator("#compose-subject"))).fill("Quarterly statements");
      await tap(p.locator('[aria-labelledby="compose-title"]').getByRole("button", { name: "Close" }));
    },
    expect: (p) => confirmNamed(p, "Discard this message?"),
    files: ["app/mail/composer.tsx", CONFIRM],
  },
  {
    id: "mail-reply",
    kind: "popup",
    title: "Mail: replying to a message",
    path: "/inbox?m=:id",
    go: (p) => goFirst(p, "inbox-message", "/inbox", readMailRow),
    steps: (p) => tap(button(p, "Reply", true)),
    expect: (p) => p.locator('[aria-labelledby="compose-title"]'),
    files: ["app/mail/composer.tsx", "app/mail/reader.tsx", "app/mail/drafts.ts"],
    note: "Opened, not sent.",
  },
  {
    id: "mail-delete-confirm",
    kind: "popup",
    title: "Mail: delete a message (confirm)",
    path: "/inbox?m=:id",
    go: (p) => goFirst(p, "inbox-message", "/inbox", readMailRow),
    steps: (p) => tap(button(p, "Delete", true)),
    expect: (p) => confirmNamed(p, /^Delete /),
    files: ["app/mail/reader.tsx", "app/mail/use-mail-actions.ts", CONFIRM],
  },
  {
    id: "mail-mailbox-picker",
    kind: "popup",
    title: "Mail: choose a mailbox",
    path: "/inbox",
    steps: (p) => tap(p.locator('main button[aria-haspopup="menu"]')),
    expect: (p) => p.getByRole("menu", { name: "Mailbox" }),
    files: ["app/mail/mailbox-picker.tsx", "app/mail/header.tsx"],
  },
  {
    id: "mail-folder-menu",
    kind: "popup",
    title: "Mail: folder and filters",
    path: "/inbox",
    only: ["phone"],
    steps: (p) => tap(p.getByRole("button", { name: /Change folder or filters$/ })),
    expect: (p) => dialog(p, "Folder and filters"),
    files: ["app/mail/folder-menu.tsx"],
  },
  {
    id: "mail-bulk-bar",
    kind: "popup",
    title: "Mail: messages picked",
    path: "/inbox",
    steps: (p) => tap(p.getByRole("checkbox", { name: "Select", exact: true }), { force: true }),
    expect: (p) => p.getByLabel("Selected messages"),
    files: ["app/mail/toolbar.tsx", "app/mail/controls.tsx", "app/routes/inbox.tsx"],
    note: "One row picked; nothing done with it.",
  },
  {
    id: "mail-bulk-delete-confirm",
    kind: "popup",
    title: "Mail: delete picked messages (confirm)",
    path: "/inbox",
    steps: async (p) => {
      await tap(p.getByRole("checkbox", { name: "Select", exact: true }), { force: true });
      await tap(p.getByLabel("Selected messages").getByRole("button", { name: "Delete", exact: true }));
    },
    expect: (p) => confirmNamed(p, /^Delete /),
    files: ["app/mail/toolbar.tsx", "app/routes/inbox.tsx", CONFIRM],
  },

  {
    id: "mail-undo-toast",
    kind: "popup",
    title: "Mail: the undo note after archiving or deleting",
    path: "/inbox",
    steps: null,
    files: ["app/mail/use-mail-actions.ts", "app/routes/inbox.tsx"],
    note: "Shows after mail is archived, moved or marked; the tour changes nothing.",
  },
  {
    id: "mail-remove-address-confirm",
    kind: "popup",
    title: "Mail: remove an extra address (confirm)",
    path: "/inbox",
    steps: async (p) => {
      await tap(p.locator('main button[aria-haspopup="menu"]'));
      await tap(await need(p.getByRole("menu", { name: "Mailbox" }).getByRole("button", { name: /^Remove / }), "no extra address on the account to remove", 3000));
    },
    expect: (p) => confirmNamed(p, /^Remove .*\?$/),
    files: ["app/mail/mailbox-picker.tsx", CONFIRM],
    note: "Only for an admin with an extra address on the account.",
  },

  // Paper mail
  {
    id: "mailbox-envelope",
    kind: "popup",
    title: "Paper mail: the envelope, enlarged",
    path: "/mailbox/:id",
    go: (p) => goFirst(p, "mailbox-piece", "/mailbox", readPaperRow),
    steps: (p) => tap(button(p, "Enlarge the envelope")),
    expect: (p) => dialog(p, "Envelope, enlarged"),
    files: ["app/routes/paper-mail-piece.tsx"],
  },
  {
    id: "mailbox-scan",
    kind: "popup",
    title: "Paper mail: the scan, enlarged",
    path: "/mailbox/:id",
    go: goScannedPiece,
    steps: (p) => tap(button(p, "Enlarge the scan")),
    expect: (p) => dialog(p, "Scan, enlarged"),
    files: ["app/routes/paper-mail-piece.tsx"],
    note: "Only for a piece that has been scanned.",
  },

  // Phone
  {
    id: "phone-thread",
    kind: "popup",
    title: "Phone: a conversation",
    path: "/phone",
    only: ["phone"],
    steps: (p) => tap(p.getByRole("list", { name: "Conversations" }).getByRole("button").filter({ hasNotText: "Unread" })),
    expect: (p) => p.locator('[role="dialog"][aria-labelledby="thread-title"]'),
    files: ["app/routes/phone.tsx"],
    note: "A conversation with nothing unread.",
  },
  {
    id: "phone-new-text",
    kind: "popup",
    title: "Phone: a new text",
    path: "/phone",
    steps: (p) => tap(p.getByRole("button", { name: "New text" })),
    expect: (p) => p.locator("#new-text-to"),
    files: ["app/routes/phone.tsx"],
    note: "Opened, nothing sent.",
  },

  // Treasury
  {
    id: "treasury-dormant-confirm",
    kind: "popup",
    title: "Treasury: hide dormant accounts (confirm)",
    path: "/treasury",
    steps: (p) => tap(p.getByRole("button", { name: /^\d+ dormant$/ })),
    expect: (p) => confirmNamed(p, /^Hide \d+ empty account/),
    files: ["app/routes/treasury.tsx", CONFIRM],
  },
  {
    id: "treasury-disconnect-confirm",
    kind: "popup",
    title: "Treasury: disconnect a bank (confirm)",
    path: "/treasury",
    steps: (p) => tap(button(p, "Disconnect", true)),
    expect: (p) => confirmNamed(p, /^Disconnect /),
    files: ["app/routes/treasury.tsx", CONFIRM],
  },

  // Books
  {
    id: "books-more-menu",
    kind: "popup",
    title: "Books: more actions",
    path: "/books/transactions",
    steps: (p) => tap(button(p, "More actions")),
    expect: (p) => p.getByRole("menu").or(p.getByRole("menuitem").first()),
    files: TXNS,
  },
  {
    id: "books-import",
    kind: "popup",
    title: "Books: import a CSV",
    path: "/books/transactions",
    steps: async (p) => {
      await tap(button(p, "More actions"));
      await tap(p.getByRole("menuitem", { name: /^Import CSV/ }));
    },
    expect: (p) => p.locator('[aria-labelledby="import-title"]'),
    files: TXNS,
  },
  {
    id: "books-entity-filter",
    kind: "popup",
    title: "Books: filter by entity",
    path: "/books/transactions",
    steps: (p) => tap(p.getByRole("button", { name: /^Entity: / })),
    expect: (p) => p.getByRole("listbox"),
    files: TXNS,
  },
  {
    id: "books-period-filter",
    kind: "popup",
    title: "Books: choose the period",
    path: "/books/transactions",
    steps: (p) => tap(p.getByRole("button", { name: /^Period: / })),
    expect: (p) => p.getByRole("listbox"),
    files: TXNS,
  },
  {
    id: "books-category-menu",
    kind: "popup",
    title: "Books: a transaction's account (categorize)",
    path: "/books/transactions",
    steps: (p) => tap(p.locator("main").getByRole("button", { name: /^Account: / })),
    expect: (p) => p.getByRole("listbox"),
    files: TXNS,
    note: "Opened, nothing chosen.",
  },
  {
    id: "books-categorize-confirm",
    kind: "popup",
    title: "Books: categorize all from this vendor (confirm)",
    path: "/books/transactions",
    // Choosing an account only asks; it's the dialog's buttons that categorize. Book writes are still answered in the browser, in case.
    before: holdWrites(/^\/api\/books/),
    steps: async (p) => {
      await tap(p.locator("main").getByRole("button", { name: /^Account: (?!—)/ }));
      const box = await seen(p.getByRole("listbox"));
      await tap(
        box
          .getByRole("option")
          .filter({ hasNot: p.locator('[aria-selected="true"]') })
          .and(box.locator('[aria-selected="false"]')),
      );
    },
    expect: books,
    files: [...TXNS],
    note: "Opened, not confirmed: the choice only asks. Book writes are answered in the browser while it's taken.",
  },
  {
    id: "books-row-detail",
    kind: "popup",
    title: "Books: a transaction's detail and history",
    path: "/books/transactions",
    steps: async (p) => {
      const details = p.locator("main").getByRole("button", { name: /^Details for / });
      const card = p.locator('main [data-txn-card] button[aria-expanded="false"]');
      if (await details.count()) await tap(details, { force: true });
      else if (await card.count()) await tap(card);
      else await tap(p.locator('main button[aria-expanded="false"]').filter({ hasText: /\S/ }));
    },
    expect: (p) => p.locator('main [aria-expanded="true"]'),
    files: TXNS,
  },
  {
    id: "books-batch",
    kind: "popup",
    title: "Books: transactions picked (batch edit)",
    path: "/books/transactions",
    steps: async (p) => {
      await tap(p.locator("main").getByRole("checkbox", { name: /^Select (?!all$)/ }), { force: true });
      if (isPhone(p)) await tap(p.getByRole("button", { name: /^Edit/ }));
    },
    expect: (p) => (isPhone(p) ? p.getByRole("dialog") : p.getByRole("button", { name: /^Apply/ })),
    files: ["app/books-shared.tsx", "app/books-batch.ts", "app/routes/books-transactions.tsx"],
    note: "One picked, nothing applied.",
  },
  {
    id: "books-rule-delete-confirm",
    kind: "popup",
    title: "Books: delete a rule (confirm)",
    path: "/books/rules",
    steps: (p) => tap(p.getByRole("button", { name: /^Delete rule / })),
    expect: books,
    files: ["app/routes/books-rules.tsx", "app/books-shared.tsx"],
  },
  {
    id: "books-vendor-account-menu",
    kind: "popup",
    title: "Books: a vendor's default account",
    path: "/books/vendors/detail?name",
    go: (p) => goFirst(p, "books-vendor-detail", "/books/vendors", 'main a[href^="/books/vendors/detail"]'),
    steps: (p) => tap(p.getByRole("button", { name: /^Default account: / })),
    expect: (p) => p.getByRole("listbox"),
    files: ["app/routes/books-vendor-detail.tsx", "app/books-shared.tsx"],
    note: "Opened, nothing chosen.",
  },
  {
    id: "books-vendor-merge-confirm",
    kind: "popup",
    title: "Books: merge one vendor into another (confirm)",
    path: "/books/vendors/detail?name",
    before: holdWrites(/^\/api\/books/),
    go: (p) => goFirst(p, "books-vendor-detail", "/books/vendors", 'main a[href^="/books/vendors/detail"]'),
    steps: async (p) => {
      await tap(p.getByRole("button", { name: /^Merge into: / }));
      await tap((await seen(p.getByRole("listbox"))).getByRole("option"));
    },
    expect: books,
    files: ["app/routes/books-vendor-detail.tsx", "app/books-shared.tsx"],
    note: "Opened, not confirmed: choosing the vendor only asks. Book writes are answered in the browser while it's taken.",
  },
  {
    id: "books-toast",
    kind: "popup",
    title: "Books: the note after a change",
    path: "/books/transactions",
    steps: null,
    files: ["app/books-shared.tsx"],
    note: "Shows after a transaction is changed; the tour changes nothing.",
  },
  {
    id: "books-split",
    kind: "popup",
    title: "Books: split a transaction",
    path: "/books/transactions",
    steps: null,
    files: ["app/books-shared.tsx"],
    note: "There is no split dialog in the app (app/books-shared.tsx has categorize, batch, rule and import).",
  },

  // Tools
  {
    id: "tools-compliance-entity",
    kind: "popup",
    title: "Compliance: one entity's sheet",
    path: "/tools/compliance",
    steps: (p) => tap(p.locator("button.cmp-card")),
    expect: (p) => p.locator('aside[role="dialog"]'),
    files: ["app/routes/tools-compliance.tsx"],
  },
  {
    id: "tools-compliance-check-confirm",
    kind: "popup",
    title: "Compliance: check every entity with the state (confirm)",
    path: "/tools/compliance",
    steps: (p) => tap(p.locator("main header button, main button").filter({ hasText: /^Check / })),
    expect: (p) => confirmNamed(p, /with the state\?$/),
    files: ["app/routes/tools-compliance.tsx", CONFIRM],
    note: "Opened, not confirmed.",
  },
  {
    id: "signatures-void-confirm",
    kind: "popup",
    title: "Signatures: void a request (confirm)",
    path: "/tools/signatures",
    steps: (p) => tap(button(p, "Void", true)),
    expect: (p) => confirmNamed(p, /^Void /),
    files: ["app/routes/tools-signatures.tsx", CONFIRM],
  },
  {
    id: "signatures-delete-confirm",
    kind: "popup",
    title: "Signatures: delete a request (confirm)",
    path: "/tools/signatures",
    steps: (p) => tap(button(p, "Delete", true)),
    expect: (p) => confirmNamed(p, /^Delete /),
    files: ["app/routes/tools-signatures.tsx", CONFIRM],
  },
  {
    id: "signature-void-confirm",
    kind: "popup",
    title: "Signature request: void (confirm)",
    path: "/tools/signatures/:id",
    go: (p) => goSignature(p, "Waiting"),
    steps: (p) => tap(button(p, "Void", true)),
    expect: (p) => confirmNamed(p, "Void this request?"),
    files: [...SIG, CONFIRM],
  },
  {
    id: "signature-delete-confirm",
    kind: "popup",
    title: "Signature request: delete (confirm)",
    path: "/tools/signatures/:id",
    go: (p) => goSignature(p),
    steps: (p) => tap(button(p, "Delete", true)),
    expect: (p) => confirmNamed(p, /^Delete /),
    files: [...SIG, CONFIRM],
  },
  {
    id: "signature-resend",
    kind: "popup",
    title: "Signature request: resend (how they sign)",
    path: "/tools/signatures/:id",
    go: (p) => goSignature(p, "Waiting"),
    steps: (p) => tap(button(p, "Resend for signature")),
    expect: (p) => p.locator('[aria-labelledby="resend-title"]'),
    files: SIG,
    note: "Opened, not sent.",
  },
  {
    id: "signature-field-editor",
    kind: "popup",
    title: "Signature request: placing the signature fields (a draft)",
    path: "/tools/signatures/:id",
    go: (p) => goSignature(p, "Drafts"),
    // "+ Signature" only arms the placing; the field would land (and save) on a click on the page, which isn't made.
    steps: (p) => tap(p.getByRole("button", { name: "+ Signature" })),
    expect: (p) => p.getByText(/^Click where the /),
    files: [...SIG, "app/sign/pdf-pages.tsx"],
    note: "A draft's editor with a signature field about to be placed; nothing placed or saved.",
  },
  {
    id: "signature-invite",
    kind: "popup",
    title: "Signature request: invite a signer to BFO",
    path: "/tools/signatures/:id",
    go: (p) => goSignature(p),
    steps: (p) => tap(p.getByRole("button", { name: /^Invite / })),
    expect: (p) => p.locator('[aria-labelledby="invite-title"]'),
    files: [...SIG, "app/entity/people.tsx"],
    note: "Opened, not sent. Only for a request tied to an entity.",
  },
  {
    id: "contract-signature-form",
    kind: "popup",
    title: "Contract: send it for signature (the form)",
    path: "/assets/:id/contract/:contractId",
    go: (p) => goContract(p, true),
    steps: (p) => tap(p.getByRole("button", { name: "Request Signature" })),
    expect: (p) => p.locator("main form, main input").first(),
    files: ["app/routes/contract-pdf.tsx", "app/sign/contract-signature.tsx"],
    note: "The form opened, nothing sent. Only for a contract not yet sent for signature.",
  },

  // People, notes, notifications
  {
    id: "users-add",
    kind: "popup",
    title: "Users: add someone",
    path: "/users",
    steps: (p) => tap(button(p, "Add user", true)),
    expect: (p) => p.getByRole("textbox", { name: "Phone" }),
    files: ["app/routes/users.tsx"],
    note: "The form opened, nothing saved.",
  },
  {
    id: "users-remove-confirm",
    kind: "popup",
    title: "Users: remove someone (confirm)",
    path: "/users",
    steps: async (p) => tap(await need(p.locator('main button[aria-label^="Remove "]:not([disabled])'), "no one but you to remove")),
    expect: (p) => confirmNamed(p, /^Remove /),
    files: ["app/routes/users.tsx", CONFIRM],
    note: "Opened, not confirmed. You can't remove yourself, so it's someone else's row.",
  },
  {
    id: "notes-delete-confirm",
    kind: "popup",
    title: "Notes: delete a note (confirm)",
    path: "/notes",
    steps: async (p) => tap(await need(p.locator("main").getByRole("button", { name: /^Delete / }), "no notes on record")),
    expect: (p) => confirmNamed(p, /^Delete /),
    files: ["app/routes/notes.tsx", CONFIRM],
  },
  {
    id: "notifications-send-confirm",
    kind: "popup",
    title: "Notifications: send the report now (confirm)",
    path: "/notifications",
    steps: (p) => tap(p.getByRole("button", { name: /^Send now/ })),
    expect: (p) => confirmNamed(p, "Send the report now?"),
    files: ["app/routes/notifications.tsx", CONFIRM],
    note: "Opened, not confirmed.",
  },

  // A signer's page
  {
    id: "sign-consent",
    kind: "popup",
    title: "Signing: the e-signature consent",
    path: "/sign/:token",
    go: (p) => open(p, `${BASE}/sign/tour-not-a-real-token`),
    signedOut: true,
    before: signerPage,
    steps: async (p) => {
      // Their name typed as the signature (the pad's Type tab), then Sign: that only asks for the consent.
      await tap(button(p, "Type", true));
      await tap(button(p, "Sign", true));
    },
    expect: (p) => p.getByRole("dialog"),
    files: ["app/routes/sign.tsx", "app/sign/signature-pad.tsx"],
    note: "A real request as its signer sees it (answered in the browser for a made-up token); the name typed as the signature, the consent opened and not agreed to.",
  },
  {
    id: "sign-decline",
    kind: "popup",
    title: "Signing: declining to sign",
    path: "/sign/:token",
    go: (p) => open(p, `${BASE}/sign/tour-not-a-real-token`),
    signedOut: true,
    before: signerPage,
    steps: (p) => tap(button(p, "I'd rather not sign")),
    expect: (p) => p.getByPlaceholder(/^Why not/),
    files: ["app/routes/sign.tsx"],
    note: "A real request as its signer sees it (answered in the browser for a made-up token); nothing is declined.",
  },
];

const SURFACES = [...PAGES, ...POPUPS];

// ── Special answers ──────────────────────────────────────────────────────

/**
 * A signer's page needs their token, and opening a real link records them as
 * having viewed it. So it's shown with a real request as its signer sees it:
 * the request read as the office (GET /api/sign, then ?id=), reshaped into
 * what the signer's link returns (api/sign.ts, signer()), and answered in the
 * browser for a made-up token. Whatever the page posts still goes to the guard.
 */
async function signerPage(page) {
  const view = await once("signer-view", async () => {
    const list = (await apiGet("/api/sign"))?.requests || [];
    const shown = (r) => r && Array.isArray(r.pages) && r.pages.length && Array.isArray(r.parties) && r.parties.length;
    const pick = list.find((r) => shown(r) && (r.status === "sent" || r.status === "partial")) || list.find((r) => shown(r) && r.status !== "draft" && r.status !== "voided");
    if (!pick) throw new Unavailable("no sent signature request to show a signer");
    const full = await apiGet(`/api/sign?id=${encodeURIComponent(pick.id)}`);
    const r = full?.request && shown(full.request) ? full.request : pick;
    const you = r.parties.find((p) => p.status !== "signed") || r.parties[r.parties.length - 1];
    const pdfUrl = full?.pdfUrl || `${BASE}/__tour/sample.pdf`;
    return {
      brand: r.brand ?? null,
      mode: "normal",
      pdfKey: r.current_path || r.signed_path || r.original_path || "tour",
      title: r.title,
      status: r.status,
      completed: r.status === "completed",
      you: { key: you.key, role: you.role, name: you.name, email: you.email, status: you.status === "sent" ? "viewed" : you.status },
      parties: r.parties.map((p) => ({ key: p.key, role: p.role, name: p.name, status: p.status })),
      fields: r.fields || [],
      pages: r.pages,
      pdfUrl,
      downloadUrl: pdfUrl,
      sentBy: r.created_by_name ?? null,
    };
  });
  await page.route(
    (url) => url.pathname === "/api/sign" && url.searchParams.has("token"),
    (route) => (route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) }) : route.fallback()),
  );
}

// ── A sample PDF, for the document viewer and the signer's page ──────────

let SAMPLE_PDF = null;
async function samplePdf() {
  if (SAMPLE_PDF) return SAMPLE_PDF;
  try {
    const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const lines = [
      "This Services Agreement is a sample document, drawn for the screenshot tour. It names no",
      "real person or company, and nothing in it is an offer or a record.",
      "",
      "1. Services. The Manager provides bookkeeping, bill pay and entity compliance services.",
      "",
      "2. Fees. The Client pays the fee set out in Schedule A each month, in arrears.",
      "",
      "3. Term. The agreement runs for twelve months and renews unless either party ends it",
      "with thirty days' written notice.",
      "",
      "4. Records. The Manager keeps the Client's books and documents in confidence.",
      "",
      "5. Governing law. The laws of the State of Arizona govern this agreement.",
    ];
    for (let p = 0; p < 2; p++) {
      const pg = doc.addPage([612, 792]);
      pg.drawText(p ? "Schedule A: Fees" : "SAMPLE SERVICES AGREEMENT", { x: 72, y: 700, size: 18, font: bold, color: rgb(0.1, 0.1, 0.12) });
      pg.drawText("A sample for the screenshot tour", { x: 72, y: 676, size: 12, font, color: rgb(0.3, 0.3, 0.35) });
      lines.forEach((l, i) => pg.drawText(l, { x: 72, y: 640 - i * 18, size: 11, font, color: rgb(0.12, 0.12, 0.14) }));
      pg.drawLine({ start: { x: 72, y: 150 }, end: { x: 260, y: 150 }, thickness: 0.6 });
      pg.drawText("Sam Sample, Client", { x: 72, y: 136, size: 9, font });
    }
    SAMPLE_PDF = Buffer.from(await doc.save());
  } catch {
    SAMPLE_PDF = Buffer.from("%PDF-1.4\n%EOF\n");
  }
  return SAMPLE_PDF;
}

// ── Capturing ────────────────────────────────────────────────────────────

const contexts = new Map();
/** Each open page's ear for requests the guard refused. */
const listeners = new WeakMap();

/**
 * One context per size and theme, shared by its surfaces, with what's in
 * localStorage fixed for all of them: the session (or none, signed out), the
 * theme, and any stored preference a surface needs (a view, say). Pages in a
 * context share localStorage, so a surface that needs something different
 * gets its own context rather than changing it under the others.
 */
async function contextFor(browser, size, theme, surface) {
  const signedIn = !surface.signedOut;
  const storage = surface.storage || {};
  const session = !signedIn ? null : typeof surface.session === "function" ? surface.session(SESSION) : SESSION;
  const key = [size, theme, signedIn ? "in" : "out", JSON.stringify(storage), session && session !== SESSION ? JSON.stringify(session.user) : ""].join("/");
  if (!contexts.has(key))
    contexts.set(
      key,
      (async () => {
        const ctx = await browser.newContext({ ...SIZES[size], colorScheme: theme, locale: "en-US", timezoneId: "America/Phoenix" });
        await ctx.addInitScript(
          ({ session, theme, storage }) => {
            if (window.top !== window) return;
            try {
              if (session) localStorage.setItem("bfo-session", JSON.stringify(session));
              else localStorage.removeItem("bfo-session");
              localStorage.setItem("bfo-theme", theme);
              localStorage.setItem("bfo-mail-theme", theme);
              // Already asked: without it /assets fires a one-time write.
              localStorage.setItem("bfo-trust-type-v1", "1");
              for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
            } catch {
              /* storage blocked: the page shows as a visitor */
            }
          },
          { session, theme, storage },
        );
        await ctx.grantPermissions(["microphone", "clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
        await api.install(ctx);
        // Every /api request goes to the data source; a surface's own page.route overrides win over this.
        await ctx.route("**/api/**", async (route) => {
          const req = route.request();
          let status = 200;
          let body = "";
          const watched = {
            request: () => req,
            fulfill: (o) => {
              status = o.status ?? 200;
              body = o.body;
              return route.fulfill(o);
            },
            fallback: (o) => route.fallback(o),
            continue: (o) => route.continue(o),
            abort: (e) => route.abort(e),
            fetch: (o) => route.fetch(o),
          };
          await api.handle(watched, req);
          if (status === 503 && /tour_blocked/.test(Buffer.isBuffer(body) ? body.toString("utf8") : String(body || ""))) {
            let page = null;
            try {
              page = req.frame().page();
            } catch {
              /* a worker's request */
            }
            const hear = page && listeners.get(page);
            if (hear) hear(req);
          }
        });
        // The sample PDF behind every viewer, and pdf.js from the local package rather than its CDN.
        await ctx.route("**/__tour/sample.pdf", async (route) =>
          route.fulfill({ status: 200, contentType: "application/pdf", headers: { "Access-Control-Allow-Origin": "*" }, body: await samplePdf() }),
        );
        await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**", (route) => {
          const file = /worker/.test(route.request().url()) ? "pdf.worker.min.mjs" : "pdf.min.mjs";
          return route.fulfill({
            status: 200,
            contentType: "text/javascript",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: fs.readFileSync(path.join(__dirname, "../../node_modules/pdfjs-dist/build", file)),
          });
        });
        return ctx;
      })(),
    );
  return contexts.get(key);
}

/** Navigation that survives Vite's reloads: a retry or two, and the DOM is enough. */
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

/** Network quiet (where it ever gets quiet), then time for entrance animations. */
async function settle(page, ms = SETTLE_MS, idle = 5000) {
  await page.waitForLoadState("networkidle", { timeout: idle }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Every finite animation still playing has finished (a menu caught mid-fade reads as broken). Loops are left alone. */
async function animationsDone(page, ms = 2500) {
  await page
    .evaluate(
      (limit) =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming?.().endTime ?? Infinity))
              .map((a) => a.finished.catch(() => undefined)),
          ),
          new Promise((r) => setTimeout(r, limit)),
        ]),
      ms,
    )
    .catch(() => undefined);
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)))]).finally(() => clearTimeout(timer));
}

async function capture(browser, surface, size, theme) {
  const ctx = await contextFor(browser, size, theme, surface);
  const t0 = Date.now();
  const page = await ctx.newPage();
  const problems = [];
  const note = (kind, text) => {
    const line = `${kind}: ${String(text).replace(/\s+/g, " ").slice(0, 300)}`;
    if (!problems.includes(line)) problems.push(line);
  };
  page.on("pageerror", (e) => note("page error", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.test(m.text())) note("console", m.text());
  });
  // Every request that isn't a plain read, so a reviewer can see what a surface tried to change.
  const writes = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/") || req.method() === "GET" || req.method() === "HEAD" || req.method() === "OPTIONS") return;
    let action = "";
    try {
      action = req.postDataJSON()?.action || "";
    } catch {
      /* not JSON */
    }
    const line = `${req.method()} ${u.pathname}${action ? ` (${action})` : ""}`;
    if (!writes.includes(line)) writes.push(line);
  });
  // What the guard refused (live only): on load, a page shows less than it would; during the steps, a click was stopped.
  const blocked = [];
  let phase = "load";
  listeners.set(page, (req) => {
    let action = "";
    try {
      action = req.postDataJSON()?.action || "";
    } catch {
      /* not JSON */
    }
    const u = new URL(req.url());
    const line = `${phase}: ${req.method()} ${u.pathname}${u.searchParams.get("view") ? `?view=${u.searchParams.get("view")}` : u.searchParams.get("report") ? `?report=${u.searchParams.get("report")}` : ""}${action ? ` (${action})` : ""}`;
    if (!blocked.includes(line)) blocked.push(line);
  });
  const dir = path.join(OUT, surface.id);
  const file = path.join(dir, `${size}-${theme}.png`);
  let ok = false;
  let url = null;
  let unavailable = null;
  try {
    await withTimeout(
      (async () => {
        if (surface.before) await surface.before(page);
        if (surface.go) await surface.go(page);
        else await open(page, `${BASE}${surface.path}`);
        // A page is captured once its entrance has played; a pop-up only needs the page ready to click, and settles after.
        if (surface.kind === "page") await settle(page);
        else await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
        if (surface.steps) {
          phase = "steps";
          await surface.steps(page);
          // A pop-up's entrance is a few hundred ms; a page mode may load more first.
          if (surface.kind === "popup") await pause(page, 800);
          else await settle(page, 1200, 2500);
        }
        if (surface.kind === "popup" && surface.expect !== false) {
          const want = surface.expect ? surface.expect(page) : anyOverlay(page);
          const shown = await want
            .locator("visible=true")
            .first()
            .isVisible()
            .catch(() => false);
          if (!shown) note("recipe", "the pop-up isn't on screen");
        }
        await animationsDone(page);
        url = page.url().replace(BASE, "");
        fs.mkdirSync(dir, { recursive: true });
        if (surface.kind === "page") {
          await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
          const { width } = page.viewportSize();
          const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)).catch(() => 900);
          await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width, height: Math.min(Math.max(height, page.viewportSize().height), MAX_PAGE_H) }, timeout: 20000 });
        } else {
          await page.screenshot({ path: file, timeout: 20000 });
        }
        ok = true;
      })(),
      SURFACE_TIMEOUT_MS,
      "surface",
    );
  } catch (e) {
    url = url || (page.url().startsWith(BASE) ? page.url().replace(BASE, "") : null);
    if (e instanceof Unavailable) {
      // Nothing to capture: no picture beats a stale one or one without the pop-up.
      unavailable = e.message;
      fs.rmSync(file, { force: true });
    } else {
      note("recipe", (e && e.message ? e.message.split("\n")[0] : String(e)) || "failed");
      // Whatever is on screen is still worth seeing beside the failure.
      try {
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: file, timeout: 8000 });
      } catch {
        /* nothing to show */
      }
    }
  }
  await page.close().catch(() => undefined);
  return {
    size,
    theme,
    file: unavailable ? null : path.relative(OUT, file),
    url,
    ok: ok && !problems.some((p) => p.startsWith("recipe")),
    unavailable,
    problems,
    writes,
    blocked,
    ms: Date.now() - t0,
  };
}

// ── The run ──────────────────────────────────────────────────────────────

/** live.cjs's counts, with its refusals tallied. */
function summarizeStats(st) {
  const tally = new Map();
  for (const b of st.blocked || []) tally.set(b, (tally.get(b) || 0) + 1);
  return { live: st.live, replayed: st.replayed, canned: st.canned, blockedTotal: (st.blocked || []).length, blocked: [...tally.entries()].sort((a, b) => b[1] - a[1]) };
}

function selected() {
  if (!only) return SURFACES;
  const match = (id) => only.some((o) => (o.endsWith("*") ? id.startsWith(o.slice(0, -1)) : id === o));
  const picked = SURFACES.filter((s) => match(s.id));
  const unknown = only.filter((o) => !o.endsWith("*") && !SURFACES.some((s) => s.id === o));
  if (unknown.length) console.warn(`Unknown surface id(s): ${unknown.join(", ")}`);
  return picked;
}

(async () => {
  const ids = new Set();
  for (const s of SURFACES) {
    if (ids.has(s.id)) throw new Error(`Duplicate surface id ${s.id}`);
    ids.add(s.id);
  }
  const surfaces = selected();
  const started = Date.now();
  SESSION = await api.session();
  if (!SESSION || !SESSION.user) throw new Error("No signed-in session to tour with.");
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  fs.mkdirSync(OUT, { recursive: true });
  const tasks = [];
  for (const size of sizes) for (const theme of themes) for (const s of surfaces) if (s.steps !== null && (!s.only || s.only.includes(size))) tasks.push({ s, size, theme });
  const results = new Map(surfaces.map((s) => [s.id, []]));
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(WORKERS, tasks.length) }, async () => {
    while (next < tasks.length) {
      const { s, size, theme } = tasks[next++];
      const r = await capture(browser, s, size, theme);
      results.get(s.id).push(r);
      done++;
      if (!r.ok && !r.unavailable) console.log(`  ✗ ${s.id} ${size}-${theme}: ${r.problems.filter((p) => p.startsWith("recipe")).join("; ") || r.problems[0] || "failed"}`);
      if (done % 25 === 0) console.log(`  ${done}/${tasks.length} captures, ${Math.round((Date.now() - started) / 1000)}s`);
    }
  });
  await Promise.all(workers);
  for (const c of contexts.values()) await (await c).close().catch(() => undefined);
  await browser.close();

  // The manifest: these surfaces replace their old entries; the others are kept.
  const manifestPath = path.join(OUT, "manifest.json");
  let previous = null;
  if (only) {
    try {
      previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      previous = null;
    }
  }
  const order = (a, b) => `${a.size}-${a.theme}`.localeCompare(`${b.size}-${b.theme}`);
  const entries = new Map((previous?.surfaces || []).map((e) => [e.id, e]));
  for (const s of surfaces) {
    const caps = results.get(s.id).sort(order);
    entries.set(s.id, {
      id: s.id,
      kind: s.kind,
      title: s.title,
      path: s.path,
      files: s.files,
      note: s.note,
      reachable: s.steps !== null,
      captures: caps.map((c) => ({
        size: c.size,
        theme: c.theme,
        file: c.file,
        url: c.url,
        ok: c.ok,
        unavailable: c.unavailable || undefined,
        problems: c.problems,
        requests: c.writes,
        blocked: c.blocked,
        ms: c.ms,
      })),
    });
  }
  const ordered = SURFACES.map((s) => entries.get(s.id)).filter(Boolean);
  const seconds = Math.round((Date.now() - started) / 1000);
  const failed = ordered.filter((e) => e.captures.some((c) => !c.ok && !c.unavailable));
  const lacking = ordered.filter((e) => e.captures.some((c) => c.unavailable));
  const manifest = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    out: OUT,
    seconds,
    sizes: Object.fromEntries(sizes.map((s) => [s, SIZES[s].viewport])),
    themes,
    mode: MODE,
    counts: {
      surfaces: ordered.length,
      pages: ordered.filter((e) => e.kind === "page").length,
      popups: ordered.filter((e) => e.kind === "popup").length,
      captures: ordered.reduce((n, e) => n + e.captures.filter((c) => c.file).length, 0),
    },
    failed: failed.map((e) => ({ id: e.id, why: [...new Set(e.captures.flatMap((c) => c.problems.filter((p) => p.startsWith("recipe"))))] })),
    unreachable: ordered.filter((e) => !e.reachable).map((e) => ({ id: e.id, why: e.note })),
    // Reachable in principle, but today's records have nothing to open it on.
    unavailable: lacking.map((e) => ({ id: e.id, why: [...new Set(e.captures.map((c) => c.unavailable).filter(Boolean))] })),
    // Refused while the page loaded: these pages show less than they would for real.
    degraded: ordered
      .map((e) => ({ id: e.id, blocked: [...new Set(e.captures.flatMap((c) => (c.blocked || []).filter((b) => b.startsWith("load: ")).map((b) => b.slice(6))))] }))
      .filter((e) => e.blocked.length),
    live: api.stats() ? summarizeStats(api.stats()) : null,
    surfaces: ordered,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const captured = surfaces.reduce((n, s) => n + results.get(s.id).filter((c) => c.file).length, 0);
  const pages = surfaces.filter((s) => s.kind === "page").length;
  console.log(`\n${surfaces.length} surfaces (${pages} pages, ${surfaces.length - pages} pop-ups), ${captured} captures in ${seconds}s → ${OUT}`);
  const now = failed.filter((e) => surfaces.some((s) => s.id === e.id));
  if (now.length) {
    console.log(`${now.length} recipe(s) failed:`);
    for (const e of now) {
      const why = [...new Set(e.captures.flatMap((c) => c.problems.filter((p) => p.startsWith("recipe"))))];
      console.log(`  ${e.id}: ${why.join("; ") || "see manifest"}`);
    }
  } else console.log("Every recipe opened its surface.");
  const nowLacking = lacking.filter((e) => surfaces.some((s) => s.id === e.id));
  if (nowLacking.length) {
    console.log(`${nowLacking.length} surface(s) with nothing to open in today's records:`);
    for (const e of nowLacking) console.log(`  ${e.id}: ${[...new Set(e.captures.map((c) => c.unavailable).filter(Boolean))].join("; ")}`);
  }
  const unreachable = surfaces.filter((s) => s.steps === null);
  if (unreachable.length) console.log(`${unreachable.length} listed but not reachable: ${unreachable.map((s) => s.id).join(", ")}`);
  const noisy = ordered.filter((e) => surfaces.some((s) => s.id === e.id) && e.captures.some((c) => c.problems.some((p) => !p.startsWith("recipe"))));
  if (noisy.length) console.log(`${noisy.length} surface(s) logged page or console errors (see manifest.json).`);
  const degraded = manifest.degraded.filter((e) => surfaces.some((s) => s.id === e.id));
  if (degraded.length) {
    console.log(`${degraded.length} surface(s) had a request refused while loading (they show less than they would):`);
    for (const e of degraded) console.log(`  ${e.id}: ${e.blocked.join(", ")}`);
  }
  if (manifest.live) {
    const l = manifest.live;
    console.log(`live: ${l.live} asked live, ${l.replayed} replayed from the cache, ${l.canned} answered here, ${l.blockedTotal} refused`);
    for (const [line, n] of l.blocked) console.log(`  blocked ${n}× ${line}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
