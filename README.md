# BFO

BFO is the Burton family office's private web app: one place for the family's
entities (LLCs, corporations, trusts), their documents and compliance, bank and
brokerage balances (Treasury), bookkeeping (Books), everyone's mail on the
family domain, paper mail from the Phoenix mailbox, texts to the office number,
and an assistant ("Ask BFO") that answers from those records. It is also an
iPhone and iPad app that wraps the live site.

## Stack

A React Router 7 single-page app (`app/`, SSR off, Vite, Tailwind v4,
TypeScript) served as static files from Vercel, with Vercel serverless
functions under `api/` for everything that needs a secret or a database.
Shared server code lives in `lib/`. Data is Supabase Postgres, reached over
PostgREST with the service key through `sb()` in `lib/auth.ts` (no ORM; the
Files live in private
Supabase Storage buckets (`documents`, `mail`, `receipts`; `brand` is public).
Integrations: Plaid (banks, brokerages), Mercury (bank history), Palm (state
registries, registered agent, formations), Bird (SMS codes, email in and out,
inbound texts), Stable (paper mail), Apple APNs (push), OpenAI (voice and the
logo studio), Anthropic (Ask BFO and document reading), Meshy (3D logo), and
a one-way bridge out of the old Firebase project. The iOS shell is Capacitor
(`ios/`, `capacitor.config.ts`).

## Run it locally

```bash
npm install
npm run dev        # the SPA at http://localhost:5173
```

`npm run dev` serves only the SPA. Every `/api/*` function needs the Vercel
runtime: run `vercel dev` (Vercel CLI, linked to the project) with the
variables below in `.env` or pulled with `vercel env pull`. Without the API you
can look at the public pages and the sign-in screen, nothing more.

### Environment variables

Set these on the Vercel project (Production, and Preview if you use it).
Optional ones are marked. Never commit values.

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | The Supabase project and its service-role key. Every read and write goes through them. |
| `AUTH_SECRET` | optional. Pepper for hashed codes; also the fallback signing key for mail image links. |
| `SIGNIN_COUNTRY_CODES` | optional. Comma list of country codes that may receive sign-in texts (default `+1`; `*` = any). |
| `SIGNIN_HOURLY_CAP` | optional. Sign-in codes sent to everyone per hour (default 60). |
| `BIRD_ACCESS_KEY` | Bird API key (`bk_<region>_…`). Sends codes, email, reads inbound mail. |
| `BIRD_WORKSPACE_ID` | optional. Bird workspace UUID; discovered from the key when unset. |
| `BIRD_SMS_CHANNEL_ID`, `BIRD_EMAIL_CHANNEL_ID` | optional. Pin a channel instead of discovering it. |
| `BIRD_SMS_FROM` | optional. The number texts are sent from (and texts arrive on). |
| `BIRD_EMAIL_FROM`, `BIRD_EMAIL_REPLY_TO` | optional. Sender for system email (default `BFO <reports@burtonfamilyoffice.com>`). |
| `BIRD_WEBHOOK_SECRET` | optional. Signing secret of the Bird webhook at `/api/mail-webhook`. Without it, mail arrives by polling only. |
| `MAIL_DOMAIN` | optional. The mail domain (default `burtonfamilyoffice.com`). |
| `MAIL_IMAGE_SECRET` | optional. Signs proxied image URLs in mail (falls back to `AUTH_SECRET`, then the service key). |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid credentials; `PLAID_ENV` names a key of the SDK's `PlaidEnvironments` (`sandbox` by default, `production` live). |
| `PLAID_REDIRECT_URI` | optional. Needed for OAuth banks in production; must match the Plaid dashboard. |
| `MERCURY_API_TOKEN` | optional. Mercury's own API, for history older than Plaid serves. |
| `REPORT_ACTIVITY_MASK` | optional. Account last-fours whose activity rides in the Treasury report (default `1886,1116`). |
| `CRON_SECRET` | Vercel sends `Authorization: Bearer $CRON_SECRET` on cron fires; without it every cron is refused. |
| `PALM_API_KEY` | Palm key. `sk_test_…` files nothing and bills nothing; `sk_live_…` files with states and is billed. |
| `PALM_WEBHOOK_SECRET` | optional. Signing secret of the Palm webhook at `/api/palm-webhook`. |
| `STABLE_API_KEY` | Stable (paper mail) API key. |
| `STABLE_WEBHOOK_TOKEN` | Shared token in the Stable webhook URL (`/api/stable-webhook?token=…`). |
| `ANTHROPIC_API_KEY` | Ask BFO, document classification, profile and verification, document renaming. |
| `OPENAI_API_KEY` | Voice (transcription, speech, Realtime) and the logo reference sheet. |
| `MESHY_API_KEY` | optional. Image-to-3D for the logo studio. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` | Apple push key for the iPhone app. `APNS_BUNDLE_ID` optional (default `com.burtonfamilyoffice.app`). |
| `SITE_URL` | optional. Site origin used in emails (default `https://www.burtonfamilyoffice.com`). |

## Check, test, build

```bash
npm run typecheck   # react-router typegen, then tsc
npm test            # vitest run (tests/*.test.ts and lib/*.test.ts)
npm run build       # react-router build → build/client
```

CI (`.github/workflows/ci.yml`) runs typegen, `tsc --noEmit`, the tests and the
build on every push and pull request to `main`. Tests are pure-function tests
plus mocked `sb()`; none touches a network.

## Deploy

Vercel builds `main` on every push (`vercel.json`: `npm run build`, output
`build/client`, functions from `api/**/*.ts`). There is no manual deploy step.
Pull requests get preview deployments. Crons, function memory and timeouts,
redirects and headers are all in `vercel.json`.

The iPhone app opens the live site, so a web deploy reaches it at once. Only
changes to `ios/`, `capacitor.config.ts` or the Capacitor plugins need a new
build, which the "iOS → TestFlight" GitHub Action makes (see the runbook).

## Where to look next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how a request flows, auth and
  roles, the JSON tree, mail, Books, entities, push, Ask BFO, directory map.
- [docs/RUNBOOK.md](docs/RUNBOOK.md): each integration, its env vars and
  dashboard, key rotation, failure modes and log lines, crons, migrations,
  shipping an iOS build.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): branches, commits, code style,
  how to add a route, an endpoint, a migration, a test.
- [docs/ios-app.md](docs/ios-app.md): App Store Connect setup, listing,
  privacy answers.
- [CLAUDE.md](CLAUDE.md): the short version for tools and new contributors.
