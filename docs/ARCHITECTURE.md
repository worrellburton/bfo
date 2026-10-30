# Architecture

How BFO is put together, as the code has it. File paths are relative to the
repo root. Where the code leaves something open, this says so.

## Request flow

```
browser (React Router SPA, app/)
  → authFetch("/api/…")            app/auth.ts: adds Authorization: Bearer <session token>
    → Vercel function (api/**.ts)  currentUser(req) resolves the token; guard/fail/handleError plumbing
      → sb()/sbFetch()             lib/auth.ts: PostgREST with the service key
        → Supabase Postgres        tables with RLS on; only ever touched from the server
```

- The SPA is static (`react-router.config.ts` has `ssr: false`). `vercel.json`
  rewrites everything but `/api/*` and a few policy PDFs to `/index.html`.
- `authFetch` (app/auth.ts) carries the token from `localStorage`
  (`bfo-session`). On a 401 whose body is `{ error: "unauthorized" }` it clears
  the session; other 401s (a bank that needs reconnecting) are left to the page.
- Every function starts with `currentUser(req, opts)` from `lib/auth.ts`. It
  looks the token up in `app_sessions`, loads the `app_users` row, and returns
  null for anything not `approved`. "Email only" and "partner" users are
  refused unless the endpoint opts in (`allowEmailOnly`, `allowPartner`).
- `sb(path, { method, body, prefer })` is a thin PostgREST call: the path is a
  PostgREST query string (`app_users?id=eq.…&select=*`). It throws on non-2xx.
  `sbFetch` returns the raw `Response` for callers that read headers.
  `lib/db-pages.ts` (`fetchAll`, `countRows`) pages past PostgREST's silent
  1,000-row cap; anything that must see every row goes through it with an
  `order=` on a unique column.
- `handleError` turns `ConfigError` into 503 `not_configured` (a missing env
  var), `PartnerRefused` into 403, and everything else into a plain 500 with
  the detail only in the server log.
- Webhooks (`api/mail-webhook.ts`, `api/palm-webhook.ts`,
  `api/stable-webhook.ts`) and crons (`api/cron/*`, `api/stable.ts?cron=1`)
  skip sessions and authenticate their own way (see the runbook).

## Auth model

Sign-in is by phone number only (`api/auth/request-code.ts` refuses an email
identifier; emails stay on the profile as contact info).

1. `POST /api/auth/request-code { identifier }`: normalises to E.164, checks
   the country allow-list (`SIGNIN_COUNTRY_CODES`), writes a held row in
   `login_codes`, applies the limits (global `SIGNIN_HOURLY_CAP`, one code per
   number per 45 s, five per number per hour), creates an `incoming`
   `app_users` row for an unknown number, then asks Bird Verify to send the
   code. Bird holds the code; BFO stores only `bird:<verificationId>` in
   `login_codes.code_hash`, good for 10 minutes.
2. `POST /api/auth/verify-code { identifier, code }`: five attempts, then
   `verifyCheck` with Bird. A verified user who is not `approved` gets
   `{ verified: true, status, token: null }` and waits. An approved user gets a
   row in `app_sessions` (30 days) and the token.
3. `GET /api/auth/session` re-checks the token; `DELETE` signs out.
4. `POST /api/auth/complete-profile` collects a missing name, email or phone
   after sign-in (the new email or phone is verified with a code first).

Owners and admins approve `incoming` users on `/users` (`api/auth/users.ts`),
which also assigns a mail address on the family domain. A browser can hold
several accounts and switch between them (`app/auth.ts`, "More than one
account"). The iPhone app adds a Face ID lock on top (`app/app-lock.tsx`).

### Roles (`lib/auth.ts`, `app/auth.ts`)

| Role | Can see | Can change |
| --- | --- | --- |
| `owner` | everything | everything; manage users; billed Palm actions; answer Palm cases; see Phone (texts) and "Other" mail |
| `admin` | same as owner | same as owner (no code path tells owner and admin apart) |
| `member` | everything but Users, Phone and "Other" mail | entities, Books, Treasury, mail (`canWrite`) |
| `viewer` | same as member | nothing shared (`canWrite` is false); own mail and settings |
| `email` | "Email only": their own inbox, their session, profile, push devices | their own mail |
| `partner` | an invited entity owner or member: only the entities in `entity_access` (`lib/entity-access.ts`), read-only, without the staff-only parts of the record (`notes`, `contracts`, `verification`); their own mail; paper mail for those entities | nothing on the tree; their own profile and preferences |

`isAdmin` = owner or admin. `canWrite` = owner, admin or member. Endpoints
that are open to partners call `currentUser(req, { allowPartner: true })` and
narrow by `accessibleAssetIds`. A partner hitting anything else gets a 403,
never a 401, so they are not signed out of the portal they do have.

## The tree: `tree_nodes` and `lib/tree.ts`

Entities, the estate map, frameworks and notes are one JSON
tree, the shape the app had in Firebase Realtime Database.

- Table `public.tree_nodes(collection, id, data jsonb, updated_at)`
  (`supabase/migrations/20261017_tree_nodes.sql`). Collections are fixed:
  `assets`, `estate-map`, `frameworks`, `notes` (`COLLECTIONS` in
  `lib/tree.ts`); anything else is refused. Old `agents` rows (the retired
  Office page, which kept provider API keys in them) stay in the table but are
  never served.
- A path is `collection/id/…`: `assets` is every entity, `assets/x` one,
  `assets/x/documents/d` one of its documents.
- Writes are `{ op: "set" | "update", path, value }` operations, validated by
  `parseOps` (JSON only, depth and size caps, at most 200 ops, 4 MB body) and
  applied by the Postgres function `tree_apply()` in one statement, so
  concurrent edits to different fields don't clobber each other
  (`20261026_tree_lock.sql` fixed the earlier read-modify-write race). Nulls
  remove keys and empty objects are pruned, as in Firebase.
- `api/tree.ts` is the only endpoint. `GET ?path=…` reads a node or a whole
  collection; `?view=index` returns `(id, updated_at)` for change polling;
  `?view=activity` returns the entity's activity log (staff only). `POST
  { ops }` writes and returns the touched rows. Writes are described and logged
  to `entity_activity` (`lib/activity.ts`).
- The browser uses `app/store.ts`, which keeps the small Firebase surface the
  pages were written against (`ref`, `get`, `onValue`, `update`, `set`, `push`,
  `remove`). Each collection is loaded once and cached; a write updates the
  cache from the rows the server returns; other people's changes arrive by
  polling the index every 30 s while the tab is visible and on focus.
- `lib/firebase-bridge.ts` is the one-way import from the old Firebase
  project: a collection is copied the first time it is asked for after a
  deploy (`tree_imports` remembers), and files in Firebase Storage are moved
  into the `documents` bucket as their entities are read. When every
  `tree_imports` row is `done` with `files_done`, Firebase is no longer read.

## Mail pipeline

```
Bird receives mail for the domain
  → POST /api/mail-webhook (email.received, Standard Webhooks signature)   api/mail-webhook.ts, lib/mail-webhook.ts
    → getInbound / ingestInbound                                          lib/mail.ts
      → one mail_messages row per mailbox it belongs to; attachments in the private "mail" bucket
      → thread_key / thread_at set by Postgres triggers                   20261023_mail_threads.sql
      → notifyNewMail → APNs                                              lib/push.ts
  ← syncInbound (throttled, 30 s) catches anything the webhook missed, from the inbox's own requests
```

- Addresses: each user has `app_users.mail_address` on `MAIL_DOMAIN`, plus
  extras in `mail_aliases` (`lib/mail-address.ts`). Mail to an address nobody
  has lands in "Other", visible to owners and admins.
- Threading is done in the database: a message joins the conversation of any
  earlier message it names (Message-ID, In-Reply-To, References); a reply to
  our own sent mail (whose Message-ID Bird assigned and we never saw) is
  matched to the sent message by sender and base subject. Otherwise the key is
  the root id, else the row id. `thread_at` is the conversation's latest
  message, and the "Active" folder lists each conversation once by it.
- Sending (`sendMail` in `lib/mail.ts`) goes through Bird's email endpoint
  from the user's own address; the sent copy is stored; `mail_sends` is a
  per-user send ledger and rate limit that deleting mail never touches.
- Remote images in a message are rewritten to signed `/api/mail-image` URLs
  and fetched by the server (`lib/mail-image.ts`), so the sender's tracking
  pixel sees BFO, not the reader.
- `api/mail.ts` is the user-facing endpoint (list, message, count, attachment
  links, send, archive, star, aliases, photo). The mailbox always comes from the
  session, never the request.
- The same webhook also takes `sms.received`: texts to the office's Bird
  number go to `sms_messages` (`lib/sms-inbound.ts`) for the Phone page
  (`api/texts.ts`, owners and admins only), with any one-time code extracted.

## Books pipeline

```
Vercel cron 12:00–15:00 UTC hourly → GET /api/cron/books-sync (Bearer CRON_SECRET)
  → sunrise gate (books_settings.sync_at_sunrise, lib/sunrise.ts): sync once, at the first fire after local sunrise
  → Plaid transactions/sync per plaid_items row (cursor) → book_transactions
  → each row stamped with the entity its account is mapped to (plaid_account_prefs), vendor cleaned (lib/vendor-parse.ts)
  → classified: user rules in book_rules first, then the built-in chart in lib/books-rules.ts
  → transfers and intercompany movements flagged
→ pages read book_transactions only (api/books/data.ts), never Plaid directly
```

- `POST /api/cron/books-sync` is "Sync now" from the app and skips the gate.
- The chart of accounts (`lib/books-accounts.ts`) is numbered: 4000s revenue,
  6000s operating, 7000s other, 9000s flow accounts (transfers, intercompany,
  loans) that never hit the income statement.
- A transaction's effective type (`lib/books-report.ts`, `effType`): a loan
  attachment wins, then the user's `type_override`, then the intercompany
  flag, then `txn_type`. `normal` rows hit the P&L; `transfer` rows sit in
  Transfers; `intercompany` rows are eliminated when both legs' entities are
  in the selection.
- Reports: `api/books/data.ts?report=pnl|cell|vendors|transactions|home|meta`.
  Loans: `lib/books-loans.ts`. Anticipated inflows: `lib/books-inflows.ts`.
  CSV import (`api/books/import-csv.ts`) and Mercury backfill
  (`api/mercury/backfill.ts`) fill history Plaid won't serve, with
  deterministic ids so re-runs are no-ops.
- Treasury (`api/plaid/*`) reads balances and holdings live from Plaid, keeps
  `plaid_account_state`, `plaid_account_prefs` (nickname, hidden, entity
  mapping; `lib/plaid-mappings.ts` re-adopts mappings after a reconnect) and
  `treasury_daily`. `api/cron/treasury-report.ts` emails the Treasury report
  on each user's schedule (`notification_prefs.treasuryReport`).

## Entity model

An entity is one `assets/<id>` row in the tree. `app/entity/model.ts` has the
record type (`Asset`: name, type LLC/C-Corp/LP/Trust, state, EIN, addresses,
foreign registrations, documents, people, Palm links per mode, closing).

- `app/routes/asset-detail.tsx` renders the page; all state and actions live in
  `app/entity/use-entity.tsx`; `app/entity/derive.ts` works out tabs,
  paperwork, deadlines and completeness from the record (pure); the tabs are
  `overview`, `documents`, `people`, `compliance`, `agreements`, `governance`,
  `activity` (`app/entity/*.tsx`).
- The rule book for what each entity type in each state must have is
  `app/entity-paperwork.ts`; `app/entity-completeness.ts` scores it;
  `app/paperwork-generate.ts` drafts the operating agreement, W-9 and 8822-B
  (PDF forms in `public/forms`).
- Documents live in the private `documents` bucket under
  `assets/<assetId>/…` (`lib/document-path.ts`); the browser gets short-lived
  signed links from `api/documents/url.ts`. Claude reads them server-side
  (`lib/fetch-document.ts`) for `api/documents/classify.ts` (which slot a file
  fills), `profile.ts` (what the entity is, from its governing documents) and
  `verify.ts` (record vs documents), and `api/rename-doc.ts`.
- Palm (`lib/palm.ts`, `api/palm.ts`): state registry search and detail
  (billed per call, logged in `palm_usage` with prices from
  `lib/palm-pricing.ts`), the Palm business linked to each entity, Palm as
  registered agent (`lib/palm-agent.ts`), forming a new entity
  (`lib/palm-formation.ts`, `app/formation.ts`, `app/entity/form-wizard.tsx`),
  Palm Monitor (`lib/palm-monitor.ts`, `palm_monitors`), Palm's open questions
  ("cases", `app/palm-cases.ts`). Everything Palm reports back arrives at
  `api/palm-webhook.ts` and is kept once in `palm_events`. Palm state is kept
  per mode under `palm.<test|live>` on the record so a test key never pollutes
  live data.
- `api/cron/state-records.ts` / `lib/state-records.ts` reads every entity's
  state record (home and foreign states, `lib/state-reads.ts`) through Palm
  once a week, fills blanks and flags differences; it never overwrites a
  filled field.
- `lib/palm-sync.ts` / `api/palm-sync.ts` is "Sync everything with Palm" from
  the Entities page (owners and admins; billed).
- Partners: `api/members.ts` invites an entity's owner or member as a
  `partner` user and grants `entity_access`.
- Paper mail from Stable (`lib/stable.ts`, `api/stable.ts`) is matched to the
  entity it is addressed to and shown on its page and on `/mailbox`
  (`app/routes/paper-mail.tsx`).
- Activity: every tree write, Palm event, Stable piece and invite is a row in
  `entity_activity` (`lib/activity.ts`).

## Push notifications

- `app/push.ts` (iPhone app only): after permission, the phone registers with
  Apple on every launch and posts its token to `POST /api/push { action:
  "register" }` under the current account; tapping a notice navigates to its
  `url`.
- `push_devices` (`20261029_push_devices.sql`) maps token → user; a token
  belongs to whoever registered it last.
- `lib/push.ts` sends on new mail, new texts and new paper mail, filtered by
  each user's `notification_prefs.push`. `lib/apns.ts` speaks HTTP/2 to APNs
  with a token-based (.p8) ES256 JWT, tries the device's known environment
  first and the other on `BadDeviceToken`, and forgets tokens Apple says are
  dead.

## Signatures

- `signature_requests` (`20261028_signature_requests.sql`): one row per
  document sent for signature. `parties` (two at most) carry a sha-256 of the
  token in each signer's emailed link; `fields` say where each signer's
  signature, initials, name or date goes as fractions of a page; `events` is
  the audit trail.
- The PDFs live in the private `documents` bucket under `signatures/<id>/`:
  `original.pdf`, `current.pdf` (signatures stamped so far), `signed.pdf`
  (everyone has signed; a certificate page is appended).
- `api/sign.ts`: the office (canWrite) creates a request, uploads the PDF
  through a one-time signed upload URL, places fields, sends (Bird email with
  the link), reminds, voids, downloads, and emails the signed copy to both
  parties. A signer calls the same endpoint with `token=`: reads the document,
  signs (`lib/sign.ts` stamps the PNG and text with pdf-lib) or declines.
  Admins get a push on each signature.
- `app/routes/tools-signatures.tsx` (the sheet, drag-and-drop upload),
  `app/routes/signature-detail.tsx` (pages drawn with pdf.js, fields dragged
  into place), `app/routes/sign.tsx` (the public signing page: draw or type a
  signature), `app/sign/contract-signature.tsx` (an MSA's "Request Signature"
  builds a request from the generated PDF with fields on its signature block).

## Ask BFO

- `lib/ask.ts`: the assistant answers from the office's own records through
  Anthropic tool use. Each tool reads one kind of record (entities, state
  records, deadlines, mail, paper mail, texts, treasury, books) as the asking
  user is allowed to see it (`scopeFor`: partners get only their entities and
  their own mail). `ASK_MODEL` is `claude-sonnet-5-5`; at most 8 tool rounds;
  tool results are capped at 24k characters.
- `api/ask.ts` streams the answer as JSON lines over `text/event-stream`
  (`supportsResponseStreaming`), keeps conversations in `chats` and
  `chat_messages` per user, and also handles voice:
  - recorded: `transcribe` and `speak` through OpenAI (`lib/voice.ts`);
  - live: `realtime-secret` mints a short-lived OpenAI Realtime key with the
    same tools attached as functions (`lib/realtime.ts`); the browser runs the
    WebRTC call (`app/realtime-voice.ts`) and, when the model calls a tool,
    posts `{ action: "tool" }` back to `/api/ask` to run it as the user.
- `app/routes/ask.tsx`, `app/ask-client.ts`, `app/ask-voice.ts`,
  `app/ask-voice-stage.tsx` are the client side.

## Directory map

| Path | What it is |
| --- | --- |
| `app/` | The SPA. `root.tsx` (document, theme boot), `routes.ts` (route table), `app.css` (Tailwind v4, 11.9px root font). |
| `app/routes/` | One file per page. `app-layout.tsx` is the signed-in shell (rail, menu, lock, push); `public-layout.tsx` the landing. |
| `app/entity/` | The entity page: `model.ts`, `derive.ts`, `use-entity.tsx`, one view per tab, `form-wizard.tsx`. |
| `app/auth.ts` | Session storage, `authFetch`, account switcher, role helpers. |
| `app/store.ts` | Firebase-shaped client for `/api/tree`. |
| `app/mail-*.ts(x)` | Mail client, frame, editor, loaders, pull-to-refresh, aurora. |
| `app/books-*.ts(x)`, `app/plaid-link.ts` | Books and Treasury client code. |
| `app/palm*.ts(x)`, `app/formation.ts` | Palm client code and the formation wizard's rules. |
| `app/native.ts`, `app/push.ts`, `app/app-lock.tsx`, `app/pwa.ts` | Capacitor bridge, push, Face ID lock, installable PWA. |
| `api/` | Vercel functions. Top-level: `tree.ts`, `mail.ts`, `mail-webhook.ts`, `mail-image.ts`, `ask.ts`, `palm.ts`, `palm-sync.ts`, `palm-webhook.ts`, `stable.ts`, `stable-webhook.ts`, `push.ts`, `texts.ts`, `members.ts`, `brand.ts`, `rename-doc.ts`. |
| `api/auth/` | `request-code`, `verify-code`, `session`, `complete-profile`, `users`, `preferences`, `bird-check`. |
| `api/books/`, `api/plaid/`, `api/mercury/` | Books reads and edits, Plaid Link and data, Mercury backfill. |
| `api/documents/` | Signed links, upload URLs, delete, and the Claude readers (`classify`, `profile`, `verify`). |
| `api/cron/` | `books-sync`, `treasury-report`, `state-records`. |
| `lib/` | Server code shared by functions. `auth.ts` (sessions, roles, `sb`, Bird, cron auth), `tree.ts`, `mail.ts`, `push.ts`, `apns.ts`, `palm*.ts`, `stable.ts`, `ask.ts`, `realtime.ts`, `voice.ts`, `storage.ts`, `db-pages.ts`, `activity.ts`, `firebase-bridge.ts`, `books-*.ts`. Pure pieces are exported for tests. |
| `supabase/migrations/` | SQL applied by hand to the Supabase project (see the runbook). The base tables predate this folder. |
| `tests/` | Vitest tests (plus a few `lib/*.test.ts`). |
| `public/` | Static assets: icons, `manifest.webmanifest`, `sw.js`, `offline.html`, `forms/` (IRS PDFs), `policies/`. |
| `ios/`, `capacitor.config.ts`, `native/www`, `resources/`, `appstore/` | The iPhone/iPad shell, its offline fallback, icon and splash sources, App Store screenshots. Excluded from the Vercel upload (`.vercelignore`). |
| `scripts/appstore-screenshots.mjs` | Playwright script that makes App Store screenshots from fictional data. |
| `docs/` | This folder. |
