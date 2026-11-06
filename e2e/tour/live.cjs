/**
 * The design tour against BFO's real records, read-only.
 *
 * The SPA runs locally (this branch's code); every /api request it makes is
 * answered here. A request that provably changes nothing and costs nothing
 * is forwarded to the live site and its answer kept on disk, so later runs
 * see the same records without asking again. Everything else gets a canned
 * answer and never leaves this machine: no mail synced, nothing marked read,
 * no text or email sent, no Palm call that bills, no sync, no filing, no
 * signature. The rules come from a read of every handler in api/ and the
 * lib/ code behind it; when in doubt a request is refused.
 *
 * Plaid's three reads (Treasury, one account's transactions, Investments)
 * refresh from Plaid and rewrite the balance baseline, so they are fetched
 * at most once and then replayed for every later capture, exactly as one
 * visit by the owner would.
 *
 * Env:
 *   BFO_TOUR_SESSION  path to a JSON { token, expiresAt, user } (never in the repo)
 *   BFO_TOUR_CACHE    where answers are kept (default: next to the session file, ./cache)
 *   BFO_LIVE          the live origin (default https://www.burtonfamilyoffice.com)
 *   BFO_TOUR_REFRESH  1 = ask the live site again for every allowed read (Plaid's stay replayed)
 *   BFO_TOUR_PLAID    1 = allow Plaid's three reads once; otherwise they answer empty
 *   BFO_TOUR_UNREAD   the unread count shown on the Mail badge (the live count runs a mail sync)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ORIGIN = process.env.BFO_LIVE || "https://www.burtonfamilyoffice.com";

let held;
function session() {
  if (held) return held;
  const file = process.env.BFO_TOUR_SESSION;
  if (!file) throw new Error("BFO_TOUR_SESSION is not set: the live tour needs a session file.");
  held = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!held.token || !held.user) throw new Error("The session file has no token or user.");
  return held;
}

const cacheDir = () => process.env.BFO_TOUR_CACHE || path.join(path.dirname(process.env.BFO_TOUR_SESSION || "."), "cache");

// ── What may reach the live site ─────────────────────────────────────

const BOOKS_REPORTS = new Set([
  "home",
  "rules",
  "settings",
  "history",
  "meta",
  "transactions",
  "pnl",
  "cell",
  "statements",
  "tax1099",
  "review",
  "recurring",
  "reconciliation",
  "loans",
  "balance-sheet",
  "vendors",
]);
const PALM_READS = new Set(["status", "usage", "ra", "documents", "inbox", "cases", "form-requirements", "form-fee", "form-validate"]);
const PLAID_ONCE = new Set(["treasury", "bank-transactions", "investments"]);
/** Answers that carry a short-lived signed link: always asked fresh, never kept. */
const FRESH = (p, q) => p === "/api/documents/url" || (p === "/api/mail" && q.get("view") === "attachment") || p === "/api/sign";

const ok = (body) => ({ kind: "reply", status: 200, body });
const blocked = { kind: "reply", status: 503, body: { error: "tour_blocked", message: "Disabled in the screenshot tour." } };
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/**
 * Decide what one request gets. Pure: method, URL and parsed body in, a plan out.
 *   { kind: "live", url?, body? }   forward (optionally rewritten) and keep the answer
 *   { kind: "once" }                Plaid: forward the first time only, replay after
 *   { kind: "reply", status, body } answer here
 *   { kind: "png" }                 a transparent pixel (remote mail pictures)
 *   { kind: "derive", ... }         answer here from another allowed read
 */
function plan(method, url, body) {
  const u = new URL(url);
  const p = u.pathname;
  const q = u.searchParams;
  const action = body && typeof body === "object" ? body.action : undefined;

  if (method === "GET") {
    if (["/api/auth/session", "/api/auth/preferences", "/api/auth/users"].includes(p)) return { kind: "live" };
    if (p === "/api/ask") return ["chats", "chat"].includes(q.get("view")) ? { kind: "live" } : blocked;
    if (p === "/api/books/data") return BOOKS_REPORTS.has(q.get("report")) ? { kind: "live" } : blocked;
    if (["/api/brand", "/api/health", "/api/game-assets", "/api/ops", "/api/push"].includes(p)) return { kind: "live" };
    if (p === "/api/documents/url") return q.get("path") ? { kind: "live" } : blocked;
    if (p === "/api/members") return q.get("assetId") ? { kind: "live" } : blocked;
    if (p === "/api/mail-image") return { kind: "png" };
    if (p === "/api/mail") {
      const view = q.get("view");
      if (["list", "thread", "attachment", "faces"].includes(view)) return { kind: "live" };
      if (view === "message") {
        // Opening a message marks it read unless it's a peek.
        const v = new URL(url);
        v.searchParams.set("peek", "1");
        return { kind: "live", url: v.toString() };
      }
      if (view === "count") return { kind: "derive", what: "mail-count" }; // the live count runs the inbound sync
      return blocked;
    }
    if (p === "/api/plaid/data") {
      const report = q.get("report");
      if (report === "list") return { kind: "live" };
      if (PLAID_ONCE.has(report)) return process.env.BFO_TOUR_PLAID === "1" ? { kind: "once" } : { kind: "derive", what: `plaid-empty-${report}` };
      return blocked;
    }
    if (p === "/api/sign") return q.get("token") ? blocked : { kind: "live" }; // a token is the signer's path: it records a view
    if (p === "/api/stable") return { kind: "live" };
    if (p === "/api/texts") {
      const view = q.get("view");
      if (!view || view === "count") return { kind: "live" };
      if (view === "setup") return { kind: "derive", what: "sms-setup" }; // the live check fires a test event at production
      return blocked;
    }
    if (p === "/api/tree") return { kind: "live" };
    return blocked;
  }

  if (method === "POST") {
    if (p === "/api/csp-report") return { kind: "reply", status: 204, body: null };
    if (p === "/api/ask") return action === "tool" ? { kind: "live" } : blocked;
    if (p === "/api/palm") {
      if (PALM_READS.has(action)) return { kind: "live" };
      if (action === "entity-bundle") {
        // Monitors can write; every other part is a free read.
        const parts = (Array.isArray(body.parts) ? body.parts : ["ra", "documents", "inbox", "inboxUnread", "cases", "monitors"]).filter((x) => x !== "monitors");
        return { kind: "live", body: { ...body, parts } };
      }
      if (action === "monitor-list") return ok({ mode: "live", cents: 0, registrations: [] });
      if (action === "inbox-read") return ok({ ok: true });
      if (action === "form-status") return ok({ mode: "live", formation: null, patch: {} });
      if (action === "document") return { kind: "reply", status: 404, body: { error: "document_unavailable", message: "Not available in the tour." } };
      return blocked;
    }
    if (p === "/api/palm-sync") return action === "plan" ? { kind: "live" } : blocked;
    if (p === "/api/sign") return action === "download" && !body.token ? { kind: "live" } : blocked;
    if (p === "/api/stable") {
      if (action === "read") return ok({ ok: true });
      if (action === "read-piece" && body.id) return { kind: "derive", what: "stable-piece", id: String(body.id) };
      return blocked;
    }
    if (p === "/api/texts") return action === "read" ? ok({ ok: true }) : blocked;
    if (p === "/api/tree") return ok({ rows: [] });
    if (p === "/api/documents/classify")
      return ok({
        kind: "other",
        confidence: "low",
        entityName: null,
        ein: null,
        date: null,
        state: null,
        trustees: [],
        grantors: [],
        beneficiaries: [],
        taxClass: null,
      });
    if (p === "/api/documents/profile")
      return ok({ whatItIs: "", purpose: null, properties: [], management: null, managers: [], members: [], taxTreatment: null, taxEvidence: null, governingLaw: null });
    return blocked;
  }

  if (method === "DELETE" && p === "/api/auth/session") return ok({ ok: true }); // signing out never ends the tour's session
  return blocked;
}

// ── Asking the live site, and remembering ─────────────────────────────

function keyOf(method, url, body) {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].filter(([k]) => !["_", "t", "ts"].includes(k)).sort();
  const raw = `${method} ${u.pathname}?${new URLSearchParams(params)} ${body ? JSON.stringify(body) : ""}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function recall(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir(), `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

function keep(key, entry) {
  fs.mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  const file = path.join(cacheDir(), `${key}.json`);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const stats = { live: 0, replayed: 0, canned: 0, blocked: [] };

async function ask(method, url, body) {
  const u = new URL(url);
  const target = ORIGIN + u.pathname + u.search;
  const res = await fetch(target, {
    method,
    headers: { authorization: `Bearer ${session().token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  stats.live++;
  return { status: res.status, contentType: res.headers.get("content-type") || "application/json", body: buf.toString("base64") };
}

async function answer(method, url, body, { once = false, fresh = false } = {}) {
  const key = keyOf(method, url, body);
  const refresh = process.env.BFO_TOUR_REFRESH === "1" && !once;
  if (!fresh && !refresh) {
    const kept = recall(key);
    if (kept) {
      stats.replayed++;
      return kept;
    }
  }
  const got = await ask(method, url, body);
  // A refusal isn't worth remembering; the next run asks again.
  if (!fresh && got.status < 400) keep(key, got);
  return got;
}

async function derive(step, sess) {
  if (step.what === "mail-count") {
    const n = Number(process.env.BFO_TOUR_UNREAD || 0);
    return ok({ unread: n, otherUnread: 0, address: sess.user.mailAddress ?? null, aliases: [], canSeeOther: true, sync: {} });
  }
  if (step.what === "sms-setup")
    return ok({
      setup: {
        ok: true,
        webhook: { id: "tour", url: `${ORIGIN}/api/mail-webhook`, events: ["sms.received"], status: "active" },
        number: null,
        test: { delivered: true, code: 200 },
        problems: [],
        notes: [],
        sending: { ready: true, state: "ready", message: "" },
        missed: 0,
      },
    });
  if (step.what === "stable-piece") {
    const got = await answer("GET", `${ORIGIN}/api/stable?id=${encodeURIComponent(step.id)}`, null);
    const j = JSON.parse(Buffer.from(got.body, "base64").toString("utf8") || "{}");
    return ok({ mail: j.mail ?? null });
  }
  if (step.what === "plaid-empty-treasury") return ok({ connections: [], accounts: [] });
  if (step.what === "plaid-empty-bank-transactions") return ok({ transactions: [], total: 0 });
  if (step.what === "plaid-empty-investments")
    return ok({ asOf: new Date().toISOString(), accounts: [], holdings: [], errors: [], history: [], historyRebuilt: null, income: null, activity: { buys90: 0, sells90: 0, recent: [] } });
  return blocked;
}

/** Playwright's route handler for **\/api/**. */
async function handle(route, request) {
  const method = request.method();
  const url = request.url();
  let body = null;
  try {
    body = request.postDataJSON();
  } catch {
    body = null;
  }
  try {
    let step = plan(method, url, body);
    if (step.kind === "derive") step = await derive(step, session());
    if (step.kind === "png") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX });
    if (step.kind === "reply") {
      stats.canned++;
      if (step.status === 503) stats.blocked.push(`${method} ${new URL(url).pathname}${body?.action ? ` ${body.action}` : ""}`);
      if (step.body === null) return route.fulfill({ status: step.status });
      return route.fulfill({ status: step.status, contentType: "application/json", body: JSON.stringify(step.body) });
    }
    const u = new URL(step.url || url);
    const got = await answer(method, step.url || url, step.body ?? body, { once: step.kind === "once", fresh: FRESH(u.pathname, u.searchParams) });
    return route.fulfill({ status: got.status, contentType: got.contentType, body: Buffer.from(got.body, "base64") });
  } catch (err) {
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "tour_error", message: String(err.message || err).slice(0, 200) }) });
  }
}

/** Belt and braces for traffic that never touches /api: storage writes, the voice line, Plaid Link. */
async function install(context) {
  await context.route(/^https:\/\/[^/]*\.supabase\.co\//, (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
  await context.route(/^https:\/\/(api\.openai\.com|cdn\.plaid\.com|[^/]*\.plaid\.com)\//, (route) => route.abort());
}

module.exports = { session, handle, install, plan, stats };
