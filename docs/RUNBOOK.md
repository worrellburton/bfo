# Runbook

Operating BFO: each integration, where its settings live, how to rotate a key,
what goes wrong and what the logs say. Logs are the Vercel function logs
(Vercel → project → Logs, or `vercel logs`). Every line quoted below is a
`console.error` in the code; search the repo for it to find the handler.

General rules the code enforces:

- A missing env var is a 503 `not_configured` with a message naming the
  variable (`ConfigError` in `lib/auth.ts`). Fix the variable and redeploy;
  functions read env at cold start.
- Rotating any key is: make the new key in the provider's dashboard, set it in
  Vercel → Settings → Environment Variables (Production), redeploy, confirm,
  then revoke the old key. No key is read by the browser.
- Webhook URLs use the `www` host: `https://www.burtonfamilyoffice.com/api/…`.
  The bare domain redirects everything but `/api` (`vercel.json`), and webhook
  senders do not follow redirects.

## Supabase

- Used for: every table and the storage buckets. Service-role access only,
  from functions, through `sb()`/`sbFetch()` in `lib/auth.ts` and
  `lib/storage.ts`. RLS is on; the browser never talks to Supabase.
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- Dashboard: supabase.com → the project. SQL editor for migrations; Storage for
  the buckets `documents`, `mail`, `receipts` (private) and `brand` (public);
  Logs → Postgres/PostgREST for query errors; Advisors for the security linter.
- Rotate: Project Settings → API → regenerate the service role key; set
  `SUPABASE_SERVICE_KEY`; redeploy. Nothing else holds the key.
- Failure modes:
  - `supabase <status>: <text>` thrown from `sb()` and logged by `handleError`
    as the bare error: a bad query, a missing column (migration not applied),
    or an expired key. The client sees "Something went wrong."
  - `DB error <status>` from `lib/db-pages.ts`: a paged read failed; the
    caller deliberately throws rather than treating a partial page as empty.
  - Silent truncation: PostgREST serves at most 1,000 rows. Anything that
    needs more must use `fetchAll`. If a report is missing rows, look for a
    direct `sb()` on a large table.
  - Storage: `storage upload failed: <status>`; `stable: couldn't sign a
    link`, `books: couldn't sign a receipt link`, `mail-photo: couldn't sign a
    link`. Signed links need the bucket to exist and the key to be service
    role.
- Recover: fix the query or apply the migration; for data, the Supabase
  dashboard has point-in-time recovery on paid plans (check the plan).

### Applying a migration

`supabase/migrations/*.sql` are applied by hand. There is no migration runner
in CI or at deploy time.

1. Open the Supabase SQL editor (or use the Supabase MCP `apply_migration`
   tool) on the project.
2. Paste the file and run it. Files are written to be re-runnable
   (`create … if not exists`, `add column if not exists`), but read the file
   first; some alter functions or constraints.
3. Deploy the code that needs it after, not before: a function hitting a
   column that isn't there logs `supabase 400` and fails the request.
4. The commit message says it was applied (see `b2b240e`: "Applied to the
   project.").

The tables that predate `20261017_tree_nodes.sql` (`app_users`,
`app_sessions`, `login_codes`, `plaid_items`, `plaid_account_prefs`,
`plaid_account_state`, `treasury_daily`, `book_transactions`, `book_rules`,
`book_loans`, `book_txn_receipt`, `book_txn_log`, `books_settings`,
`books_expected_inflows`, `mail_messages`, `mail_sync`, `mail_sends`,
`mail_deleted`, `chats`, `chat_messages`, `brand_settings`,
`report_deliveries`, `palm_events`) have no SQL in the repo. Their shape is
whatever the project has; read the TypeScript row types in `lib/` and `api/`
before touching them, and dump the schema from the dashboard if you need it.

## Vercel

- Used for: hosting the SPA, the `api/**/*.ts` functions, crons, redirects.
- Env: `CRON_SECRET` (Vercel sets the header itself once the var exists),
  `SITE_URL` optional.
- Dashboard: vercel.com → the project. Deployments, Logs, Settings →
  Environment Variables, Settings → Cron Jobs, Settings → Domains.
- Deploys: every push to `main` builds and goes live; pull requests get
  previews. To roll back, promote an earlier deployment from the Deployments
  tab.
- Function sizing (`vercel.json`): documents `profile`/`verify` and `brand`
  1024 MB / 300 s; `ask`, `palm-sync` 512 MB / 300 s; `cron/state-records`
  256 MB / 300 s; everything else 256 MB / 60 s.
- Failure modes:
  - `<name> cron rejected { reason: "unconfigured" | "unauthorized", … }`:
    `CRON_SECRET` missing (503 `cron_secret_missing`) or wrong (401). Set it in
    Production and redeploy. Booleans only are logged, never the secret.
  - A function timing out: look for 300 s workloads moved into a 60 s
    function; add it to `functions` in `vercel.json`.
  - Domains: the apex redirects to `www` for pages; webhooks must point at
    `www` (Palm disables a webhook after ten failures).

### Cron schedule (`vercel.json`)

| Path | Schedule (UTC) | What it does | Auth |
| --- | --- | --- | --- |
| `/api/cron/treasury-report` | `0 12 * * *` (daily 12:00) | Emails the Treasury report to each user whose `notification_prefs.treasuryReport` says today (daily/weekly/monthly), with balances, trend, loans and anticipated inflows. `POST` from the app sends a sample to the caller. | Bearer `CRON_SECRET` |
| `/api/cron/books-sync` | `0 12-15 * * *` (hourly 12:00–15:00) | Plaid transactions/sync into `book_transactions`, then classification. Fires four times so one run lands after local sunrise (`books_settings.sync_at_sunrise`, `sync_lat/lng`); it syncs once per day and skips with `already_synced_today`, `before_sunrise` or `sunrise_sync_disabled`. | Bearer `CRON_SECRET` |
| `/api/stable?cron=1` | `20 * * * *` (hourly at :20) | Re-reads the last 7 days of Stable paper mail for anything a webhook missed. Returns `{ configured: false }` quietly when `STABLE_API_KEY` is unset. | Bearer `CRON_SECRET` |
| `/api/cron/state-records` | `40 21 * * *` (daily 21:40) | Reads each entity's state records through Palm (home and foreign states), skipping records read in the last 7 days. Billed on a live key. Logs `state-records {counts, results}` as `console.log`. | Bearer `CRON_SECRET` |

## Plaid

- Used for: bank connections on `/treasury` (Transactions product) and
  brokerage connections on `/investments` (Investments); balances, holdings
  and the nightly Books sync. Access tokens live in `plaid_items`.
- Env: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` default),
  `PLAID_REDIRECT_URI` optional (OAuth banks; must match the dashboard).
- Dashboard: dashboard.plaid.com → Team Settings → Keys; Activity → Logs for
  per-request errors; Allowed redirect URIs under API.
- Rotate: Keys → rotate the secret for the environment; set `PLAID_SECRET`;
  redeploy. Existing item access tokens stay valid.
- Failure modes (all log `err.response?.data || err.message`, which is Plaid's
  JSON with `error_code`):
  - `Plaid link token error:` — bad credentials or a product not enabled.
  - `Plaid exchange error:` / `Plaid institution lookup failed:` — on connect.
  - `books-sync: <institution> failed:` — one item failed; the run continues.
    `ITEM_LOGIN_REQUIRED` means the user must relink from Treasury (update
    mode in `api/plaid/create-link-token.ts`).
  - `books-sync error:` — the whole run failed; today's date is not claimed,
    so the next hourly fire retries.
  - `Plaid data error:`, `prune-accounts error:`, `Plaid disconnect error:`,
    `reset-cursor failed:`, `account-prefs save failed:`, `mapping adoption
    failed:`.
- Recover: relink the item from Treasury; for a bad cursor, "Reset cursor"
  (`api/plaid/reset-cursor.ts`) and sync again; upserts are idempotent.
- Mercury (`MERCURY_API_TOKEN`, optional) backfills history older than Plaid
  serves (`api/mercury/backfill.ts`, logs `mercury backfill error:`); rows go
  under the Plaid account id and never overlap Plaid's dates.

## Palm

- Used for: state registry records, Palm as registered agent, forming
  entities, Palm Monitor, EIN checks, Palm's documents and open questions.
- Env: `PALM_API_KEY` (`sk_test_…` sandbox: files nothing, bills nothing;
  `sk_live_…`: files with states and is billed), `PALM_WEBHOOK_SECRET`
  optional.
- Dashboard: Palm Console (getpalm.com) → API keys; Webhooks (URL
  `https://www.burtonfamilyoffice.com/api/palm-webhook`, events
  `document.created`, `registered_agent.*`, `filing.*`, `case.*`,
  `business.*`). In BFO: Tools → Entity compliance → Palm costs shows what was
  billed (`palm_usage`) and when the last webhook arrived.
- Rotate: make a new key in the Console; set `PALM_API_KEY`; redeploy.
  Switching test ↔ live changes which `palm.<mode>` branch of each record is
  used; billed bulk actions refuse with 409 `mode_changed` if the mode moved
  under the page.
- Failure modes:
  - `palm failed <action>` — `api/palm.ts`; `PalmError` carries Palm's status
    and detail.
  - `palm webhook store failed`, `palm-webhook: couldn't record the <what>`,
    `palm-webhook: couldn't record the filing` — the event wasn't written to
    `palm_events` or the entity; Palm retries on a non-2xx.
  - `palm alert email failed`, `palm case email failed`, `palm monitor email
    failed` — the Bird email didn't go; the event itself was kept.
  - `palm: couldn't log a billed call` — `palm_usage` insert failed; the call
    still happened.
  - `palm-sync: couldn't save a document` — a Palm document didn't land in
    the `documents` bucket.
  - A webhook that stops arriving: Palm disables it after ten failures. Check
    the URL is the `www` host, re-enable it in the Console.
- Recover: "Sync everything with Palm" on the Entities page re-reads state
  records (billed), the agent, documents and cases. Nothing in sync ever
  files.

## Bird

- Used for: sign-in codes (Bird Verify, SMS), system email (invites, reports,
  Palm alerts), receiving every email on the family domain, texts to the
  office number and replies from it (the Phone page).
- Env: `BIRD_ACCESS_KEY` (must be `bk_<region>_…`; the region prefix picks the
  platform host), `BIRD_WORKSPACE_ID` optional, `BIRD_SMS_CHANNEL_ID` /
  `BIRD_EMAIL_CHANNEL_ID` optional, `BIRD_SMS_FROM` optional,
  `BIRD_EMAIL_FROM` / `BIRD_EMAIL_REPLY_TO` optional, `BIRD_WEBHOOK_SECRET`
  optional, `MAIL_DOMAIN` optional.
- Dashboard: app.bird.com. Settings → Security → Access Keys (the key needs
  the "Application Developer" role; scopes alone 401). Email → Domains →
  burtonfamilyoffice.com with Receiving on. Developers → Webhooks: URL
  `https://www.burtonfamilyoffice.com/api/mail-webhook`, events
  `email.received`, `sms.received`, and the receipts for texts BFO sends
  (`sms.sent`, `sms.delivered`, `sms.undelivered`, `sms.failed`,
  `sms.rejected`, `sms.expired`), signing secret into `BIRD_WEBHOOK_SECRET`.
  The Phone page's setup card adds missing events in one tap ("Fix it in
  Bird"); missing receipts don't stop texts arriving, they only leave sent
  texts at "Sent". The workspace is shared with Impact Advisory: only BFO's
  own webhook (the one whose signed test BFO accepts) is ever changed or
  replayed.
- Texting out: the office number is toll-free, so carriers only accept texts
  from it once its toll-free verification is approved (Bird → SMS → Senders;
  the setup card reads the sender's destinations and says "Replies can't go
  out yet" while the US is pending or needs attention). Until then a send is
  refused with that sentence and nothing is kept.
- Missed texts: when deliveries to the webhook failed (a bad secret, a
  deploy), the setup card counts the texts Bird couldn't deliver in the last
  day and "Bring in N missed texts" replays them (`POST
  /v1/webhooks/{id}/replay`, never twice; Bird keeps attempts three days and
  allows 20 replays a day).
- In BFO: `/api/auth/bird-check` (admin) reports the key's shape and what the
  API says, never the key; Mail → status (owner/admin) shows the sync state.
- Rotate: make a new access key with the same role; set `BIRD_ACCESS_KEY`;
  redeploy; delete the old key. The webhook secret rotates separately
  (Standard Webhooks allows two signatures during rotation).
- Failure modes:
  - 503 "Bird rejected the access key (401)…" — wrong role or key.
  - "This Bird key can send but can't list channels…" — set the channel ids.
  - "No sms channel in this Bird workspace…" — install the channel or pin it.
  - `bird verify start <status>` / `bird verify check <status>` — Verify
    refused; 429 is Bird's own resend cooldown.
  - `request-code: global cap reached (N codes in the last hour)` — the
    `SIGNIN_HOURLY_CAP` tripped (SMS pumping defence); the client sees 429
    `busy` with Retry-After 600.
  - `mail webhook ingest failed`, `mail: couldn't store <id>`, `mail: couldn't
    save the sync cursor`, `sms webhook store failed` — the inbox's throttled
    `syncInbound` (every 30 s on use) catches what the webhook missed.
  - `bird email <status>` / `bird sms <status>` thrown by `sendEmail` /
    `sendSms`; the sender must be on a domain verified in the workspace.
  - `sms-send: Bird refused a text` (status and Bird's words; the person
    sees one plain sentence: verification not approved, balance, opted out,
    invalid number, too long, rate limit). `sms status update failed` — a
    receipt couldn't be read back from Bird; Bird retries it.
  - `members: invite text failed` / `invite email failed` — the invite was
    recorded; resend from the People tab.
- Recover: nothing is lost on the BFO side; Bird keeps inbound mail 30 days,
  and the sync pages it from the last cursor (first run: 30 days back).

## Stable

- Used for: paper mail at the family's Phoenix mailbox: envelope photo, scan,
  summary, forwarding and shredding status, tied to an entity.
- Env: `STABLE_API_KEY`, `STABLE_WEBHOOK_TOKEN`.
- Dashboard: usestable.com → Settings → API keys; Settings → Webhooks with
  URL `https://www.burtonfamilyoffice.com/api/stable-webhook?token=<STABLE_WEBHOOK_TOKEN>`
  and the `mailItem.*` (and `check.*`) events. Stable does not sign webhooks,
  so the token in the URL is the only check, and the item is always re-read
  from Stable's API by id, never taken from the request body.
- Rotate: new API key → `STABLE_API_KEY`; new token → `STABLE_WEBHOOK_TOKEN`
  and update the webhook URL in Stable; redeploy.
- Failure modes: `stable webhook failed <event> <id>` (BFO answers 500 so
  Stable retries); `stable: couldn't keep <name>` (a copy of the envelope or
  scan didn't land in the `mail` bucket); `stable <status>: …` thrown by the
  client. 404 from Stable is ignored (not our piece).
- Recover: the hourly cron (`/api/stable?cron=1`) and "Sync" on
  `/mailbox` re-read the last 7 days (`POST { action: "sync", days }` for
  more).

## APNs and TestFlight

- Used for: push notifications in the iPhone app (new mail, texts, paper
  mail) and shipping the app.
- Env (Vercel): `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` (the .p8 text;
  `\n` for newlines is fine), `APNS_BUNDLE_ID` optional.
- GitHub repository secrets (for `.github/workflows/ios-testflight.yml`):
  `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`.
- Dashboards: developer.apple.com → Keys (APNs key, Team ID);
  appstoreconnect.apple.com → Users and Access → Integrations (API key,
  Issuer ID); → TestFlight for builds. Setup walkthrough: `docs/ios-app.md`.
- Rotate the APNs key: make a new key with the Apple Push Notifications
  service enabled; set the three `APNS_*` vars; redeploy; revoke the old one.
  Device tokens are unaffected.
- Failure modes: `push: <what> notices failed`, `push: new-mail notices
  failed`, `push: text notices failed`, `push: paper-mail notices failed`,
  `push: couldn't tidy devices`. `GET /api/push` returns `configured: false`
  when the vars are missing; "Send a test notification" in the app exercises
  the path end to end. A device token lives in one APNs environment
  (production for TestFlight/App Store, sandbox for Xcode builds); the sender
  tries the known one, then the other.

### Shipping an iOS build

Only needed for native changes (`ios/`, `capacitor.config.ts`, plugins, icon,
splash). Web changes reach the app on deploy.

1. Make sure the four repository secrets above are set (the workflow checks
   and names any missing one).
2. GitHub → Actions → "iOS → TestFlight" → Run workflow. Optionally give a
   version (e.g. `1.0.1`); the build number is the run number.
3. The job runs on `macos-26` with the latest stable Xcode: `npm ci`, `npx
   cap sync ios`, writes the ASC key, `xcodebuild archive` with automatic
   signing, `xcodebuild -exportArchive` with `ios/ExportOptions.plist`, and
   uploads to App Store Connect. About 45 minutes max.
4. The build appears in App Store Connect → TestFlight after Apple processes
   it (5–15 minutes). Add testers there.
5. If signing fails: the `ASC_KEY_P8` paste is checked to be a parseable EC
   key; re-download the .p8 and paste the whole file.

## OpenAI

- Used for: Ask BFO voice (`gpt-4o-mini-transcribe`/`whisper-1` to
  transcribe, `gpt-4o-mini-tts`/`tts-1` to speak, `gpt-realtime` or
  `gpt-4o-realtime-preview` for the live call) and the logo reference sheet
  in Settings (gpt-image).
- Env: `OPENAI_API_KEY`. `MESHY_API_KEY` is the companion for image-to-3D.
- Dashboard: platform.openai.com → API keys; Usage for spend.
- Rotate: new key → `OPENAI_API_KEY`; redeploy.
- Failure modes: 503 "Voice isn't set up (OPENAI_API_KEY)."; `VoiceError`
  and `RealtimeError` carry OpenAI's status (the code falls back from the GA
  Realtime API to the beta one, and from newer models to older, when an
  account lacks them). `brand:` logs provider errors for the logo studio. The
  Ask page falls back to the recorded voice path when the live call fails.

## Anthropic

- Used for: Ask BFO (`lib/ask.ts`, `claude-sonnet-5-5`, tool use, streaming),
  document classification, entity profile, record verification
  (`api/documents/*`), and renaming a document from its contents
  (`api/rename-doc.ts`).
- Env: `ANTHROPIC_API_KEY`.
- Dashboard: console.anthropic.com → API keys; Plans & billing for credit.
- Rotate: new key → `ANTHROPIC_API_KEY`; redeploy.
- Failure modes: `ask:` (the conversation failed; the stream ends with an
  `error` event); `classify-doc: Anthropic account is out of credit` (Claude
  refused on credit balance; the entity page shows AI as down); `classify-doc
  failed`, `profile failed`, `verify failed`, `rename-doc failed` with
  `<status> <message>` for API errors. Documents over the size caps (20–28 MB
  total) are skipped, not failed.

## Firebase (legacy)

`lib/firebase-bridge.ts` still reads the old Firebase Realtime Database and
Storage with anonymous auth on first request per collection and as entities
are opened. Logs: `firebase-bridge: file move failed`, `firebase-bridge:
couldn't move <path>`, `firebase-bridge: couldn't record files_given_up`.
When every `tree_imports` row is `done` with `files_done` (or
`files_given_up`), the Firebase project can be deleted and the bridge
removed.

## Sign-in troubleshooting

- "Sign-in isn't configured yet" on the login page: a 503 from
  `request-code`; check `BIRD_ACCESS_KEY` and the Supabase vars.
- A user verified but can't get in: their `app_users.status` is `incoming`;
  approve on `/users`.
- Too many codes: per-number limits are 45 s between codes and 5 per hour;
  the global cap is `SIGNIN_HOURLY_CAP`. Numbers outside
  `SIGNIN_COUNTRY_CODES` are refused before anything is sent.
- Sessions last 30 days (`app_sessions.expires_at`); deleting the row signs
  the device out.
