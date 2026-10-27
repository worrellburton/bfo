# BFO

Private family-office app. React Router 7 SPA (`app/`, SSR off) + Vercel
functions (`api/`) + shared server code (`lib/`) + Supabase Postgres via
PostgREST (`sb()` in `lib/auth.ts`). iOS shell in `ios/` (Capacitor).
Docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`,
`docs/CONTRIBUTING.md`, `docs/ios-app.md`.

## Commands

- `npm run dev` — SPA only at :5173; `/api/*` needs `vercel dev`.
- `npm run typecheck` — `react-router typegen` then `tsc`.
- `npm test` — Vitest; tests are pure or mock `sb()`, never the network.
- `npm run build` — `build/client`, what Vercel serves.
- Deploy: push to `main`. iOS build: GitHub Action "iOS → TestFlight".

## Conventions

- Commit titles: one plain-English sentence about the change for the person
  using the app ("Mail: unread mail is easy to see"). Squash-merge PRs.
- Every `api/` and `lib/` file opens with a block comment: what it is for,
  the HTTP surface, who may call it, env vars it needs.
- Server imports end in `.js` (`../lib/auth.js`). Pure logic is exported
  separately from I/O so it can be tested.
- Endpoints: `guard` → `currentUser(req, opts)` → role check (`isAdmin`,
  `canWrite`, `isPartner`) → `try/catch` with `handleError`. Refuse with
  `fail(res, status, code, message)`.
- Reads that may exceed 1,000 rows use `fetchAll` from `lib/db-pages.ts`
  with an `order=` on a unique column; PostgREST truncates silently.
- Tailwind v4; root font is 11.9px, so rem sizes are 85% of usual. Exact
  sizes (44px tap targets) are written in px: `h-[44px]`.
- Avoid `any` where a type is easy. `strict` is on.
- Migrations are SQL files in `supabase/migrations/`, applied by hand in the
  Supabase SQL editor or MCP; say "Applied to the project" in the commit.

## Never

- Never put an API key, token or secret in the browser bundle, a log line, a
  commit or these docs. Name env vars only. Log booleans, not values.
- Never store an SSN: the EIN application's responsible-party SSN goes
  straight to Palm (`app/formation.ts`).
- Never take a webhook's body as truth: verify the signature or token, then
  re-read the object from the provider by id (`api/stable-webhook.ts`).
- Never let a partner or email-only user through `currentUser` without an
  explicit opt-in, and never send a partner the staff-only parts of a record
  (`notes`, `contracts`, `verification`).
- Never answer a partner with 401; use 403 (`PartnerRefused`).
- Never overwrite a filled field from a state record or a Palm sync; fill
  blanks and flag differences (`lib/state-records.ts`).
- Never fetch a stored document URL as given; resolve it to a bucket path
  (`lib/fetch-document.ts`, `lib/document-path.ts`).
- Never file with Palm from a sync or a cron; only the wizard's final
  confirmation files, and only on a live key.
- Never point a webhook at the bare domain; use `www` (the apex redirects,
  senders don't follow).
- Never trust `x-vercel-cron-schedule`; only `Bearer $CRON_SECRET` proves a
  cron.
